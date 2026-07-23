import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ArtifactVersionSchema,
  CreativeBriefSchema,
  type CreativeBriefCandidateBatch,
  type CreativeBriefState,
  type ExecutionPlan,
  type Project,
  type ProjectSnapshot,
} from '@aigc-director/contracts'
import { createDirectorApp } from '../src/http/app.js'
import { inject, jsonBody, type InjectResponse } from './http-inject.js'

const token = 'creative-brief-test-session-token-with-enough-entropy'
type Runtime = ReturnType<typeof createDirectorApp>

async function api<T>(runtime: Runtime, method: string, path: string, body?: unknown): Promise<InjectResponse<T>> {
  const payload: { body?: string; headers: Record<string, string> } = body === undefined ? { headers: {} } : jsonBody(body)
  return await inject<T>(runtime.app, {
    method, path,
    headers: { authorization: `Bearer ${token}`, ...(payload.headers ?? {}) },
    ...(payload.body === undefined ? {} : { body: payload.body }),
  })
}

describe('创意简报阶段产物', () => {
  let runtime: Runtime

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-brief-'))
    runtime = createDirectorApp({
      databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token,
      providerNetworkDisabled: true,
    })
  })

  afterEach(() => {
    runtime.io.disconnectSockets(true)
    runtime.io.removeAllListeners()
    runtime.httpServer.removeAllListeners()
    runtime.db.close()
  })

  it('用 CAS 保存不可变版本，按字段传播 stale 且不覆盖候选', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '灯塔改编' })
    const projectId = created.body.data.id
    await api(runtime, 'POST', `/api/v2/projects/${projectId}/sources`, {
      title: '第一章', content: '第一章 暴雨之夜\n守灯人发现一封来自未来的信。信中警告灯塔即将熄灭，他必须在黎明前修复镜片。',
    })
    const planned = await api<{ data: { plan: ExecutionPlan; approvalToken: string } }>(runtime, 'POST', `/api/v2/projects/${projectId}/agent-plans`, {
      idempotencyKey: `brief-plan-${projectId}`,
    })
    await api(runtime, 'POST', `/api/v2/plans/${planned.body.data.plan.id}/approve`, { token: planned.body.data.approvalToken })
    await api(runtime, 'POST', `/api/v2/projects/${projectId}/demo-production`, { idempotencyKey: `brief-demo-${projectId}` })

    const before = await api<{ data: CreativeBriefState }>(runtime, 'GET', `/api/v2/projects/${projectId}/brief`)
    const snapshotBefore = await api<{ data: ProjectSnapshot }>(runtime, 'GET', `/api/v2/projects/${projectId}`)
    expect(before.body.data.artifact?.revision).toBe(1)
    expect(CreativeBriefSchema.safeParse(before.body.data.artifact?.content.result).success).toBe(true)
    expect(snapshotBefore.body.data.candidates.length).toBeGreaterThan(0)

    const revised = await api<{ data: CreativeBriefState }>(runtime, 'PUT', `/api/v2/projects/${projectId}/brief`, {
      expectedRevision: 1,
      brief: { ...before.body.data.brief, tone: '低饱和、克制、紧张的悬疑气质' },
    })
    expect(revised.status).toBe(200)
    expect(revised.body.data.staleSceneCount).toBe(snapshotBefore.body.data.scenes.length)
    expect(revised.body.data.staleShotCount).toBe(snapshotBefore.body.data.shots.length)
    expect(revised.body.data.artifact?.revision).toBe(2)

    const after = await api<{ data: ProjectSnapshot }>(runtime, 'GET', `/api/v2/projects/${projectId}`)
    expect(after.body.data.candidates.map((candidate) => candidate.id)).toEqual(snapshotBefore.body.data.candidates.map((candidate) => candidate.id))
    expect(after.body.data.scenes[0]?.staleFields).toContain('brief.tone')
    expect(after.body.data.shots[0]?.staleFields).toEqual(expect.arrayContaining(['brief.tone', 'image', 'video', 'timeline', 'export']))
    expect(after.body.data.artifactVersions.filter((artifact) => artifact.stageId === 'brief')).toHaveLength(2)
    expect(after.body.data.tasks.every((task) => task.result?.billed !== true)).toBe(true)

    const repeated = await api<{ data: CreativeBriefState }>(runtime, 'PUT', `/api/v2/projects/${projectId}/brief`, {
      expectedRevision: 2, brief: revised.body.data.brief,
    })
    expect(repeated.body.data.artifact?.id).toBe(revised.body.data.artifact?.id)
    expect(runtime.db.list('artifact_versions', projectId).filter((artifact) => (artifact as { stageId?: string }).stageId === 'brief')).toHaveLength(2)

    const conflict = await api<{ error: { code: string } }>(runtime, 'PUT', `/api/v2/projects/${projectId}/brief`, {
      expectedRevision: 1, brief: { ...revised.body.data.brief, tone: '过期编辑' },
    })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('BRIEF_REVISION_CONFLICT')
  })

  it('拒绝把不符合 schema 的历史 Artifact 伪装成当前简报', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '历史脏数据' })
    const projectId = created.body.data.id
    const timestamp = new Date().toISOString()
    const privatePath = ['', 'Users', 'private', 'story.txt'].join('/')
    const invalid = ArtifactVersionSchema.parse({
      id: randomUUID(), projectId, workflow: { id: 'workflow.legacy', version: '1.0.0' },
      stageId: 'brief', artifactType: 'CreativeBrief', revision: 1,
      scope: { type: 'project', id: projectId }, dependencies: [],
      content: { result: { goal: '缺字段的旧产物', sourceExcerpt: privatePath } },
      contentHash: 'a'.repeat(64), status: 'approved', createdAt: timestamp, updatedAt: timestamp,
    })
    runtime.db.put('artifact_versions', projectId, invalid)

    const state = await api<{ data: CreativeBriefState }>(runtime, 'GET', `/api/v2/projects/${projectId}/brief`)
    expect(state.body.data.artifact).toBeUndefined()
    expect(state.body.data.invalidArtifactIds).toEqual([invalid.id])
    expect(state.body.data.brief.goal).not.toBe('缺字段的旧产物')
    expect(JSON.stringify(state.body.data)).not.toContain(privatePath)
  })

  it('生成可审阅候选，保持锁定字段并只在批准后移动当前简报', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '简报候选' })
    const projectId = created.body.data.id
    const initial = await api<{ data: CreativeBriefState }>(runtime, 'GET', `/api/v2/projects/${projectId}/brief`)
    const approved = await api<{ data: CreativeBriefState }>(runtime, 'PUT', `/api/v2/projects/${projectId}/brief`, {
      expectedRevision: 0,
      brief: {
        ...initial.body.data.brief,
        goal: '保持灯塔原著事实',
        language: 'zh-CN',
        targetDurationSeconds: 60,
      },
    })
    const idempotencyKey = `brief-candidates-${randomUUID()}`
    const generated = await api<{ data: CreativeBriefCandidateBatch }>(runtime, 'POST', `/api/v2/projects/${projectId}/brief/candidates`, {
      count: 3,
      feedback: '加强悬疑和行动节奏',
      lockedFields: ['goal', 'language'],
      idempotencyKey,
    })
    expect(generated.status).toBe(201)
    expect(generated.body.data.candidates).toHaveLength(3)
    expect(generated.body.data.candidates.every((candidate) => candidate.brief.goal === '保持灯塔原著事实' && candidate.brief.language === 'zh-CN')).toBe(true)
    expect(generated.body.data.candidates.every((candidate) => candidate.artifact.status === 'draft')).toBe(true)

    const beforeReview = await api<{ data: CreativeBriefState }>(runtime, 'GET', `/api/v2/projects/${projectId}/brief`)
    expect(beforeReview.body.data.artifact?.id).toBe(approved.body.data.artifact?.id)
    const selected = generated.body.data.candidates[1]!
    const reviewKey = `brief-review-${randomUUID()}`
    const reviewed = await api<{ data: CreativeBriefState }>(runtime, 'POST', `/api/v2/projects/${projectId}/brief/candidates/${selected.artifact.id}/review`, {
      decision: 'approve',
      expectedApprovedRevision: approved.body.data.artifact?.revision ?? 0,
      confirmation: 'APPROVE_CREATIVE_BRIEF',
      idempotencyKey: reviewKey,
    })
    expect(reviewed.body.data.artifact?.revision).toBe(2)
    expect(reviewed.body.data.brief).toEqual(selected.brief)
    expect(reviewed.body.data.candidates.find((candidate) => candidate.artifact.id === selected.artifact.id)?.artifact.status).toBe('approved')

    const repeated = await api<{ data: CreativeBriefState }>(runtime, 'POST', `/api/v2/projects/${projectId}/brief/candidates/${selected.artifact.id}/review`, {
      decision: 'approve',
      expectedApprovedRevision: approved.body.data.artifact?.revision ?? 0,
      confirmation: 'APPROVE_CREATIVE_BRIEF',
      idempotencyKey: reviewKey,
    })
    expect(repeated.body.data.artifact?.id).toBe(reviewed.body.data.artifact?.id)
    expect(runtime.db.list('artifact_versions', projectId).filter((artifact) => (artifact as { artifactType?: string }).artifactType === 'CreativeBrief')).toHaveLength(2)

    const rejectedCandidate = generated.body.data.candidates[2]!
    const rejected = await api<{ data: CreativeBriefState }>(runtime, 'POST', `/api/v2/projects/${projectId}/brief/candidates/${rejectedCandidate.artifact.id}/review`, {
      decision: 'reject',
      expectedApprovedRevision: reviewed.body.data.artifact?.revision ?? 0,
      confirmation: 'REJECT_CREATIVE_BRIEF',
      idempotencyKey: `brief-reject-${randomUUID()}`,
    })
    expect(rejected.body.data.artifact?.id).toBe(reviewed.body.data.artifact?.id)
    expect(rejected.body.data.candidates.find((candidate) => candidate.artifact.id === rejectedCandidate.artifact.id)?.artifact.status).toBe('rejected')
  })
})
