import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArtifactVersion, PromptDiff, PromptRevision, ScopedRegenerationResult } from '@aigc-director/contracts'
import { createDirectorApp } from '../src/http/app.js'
import { inject, jsonBody, type InjectResponse } from './http-inject.js'

const token = 'prompt-api-session-token-with-enough-entropy'
const auth = { authorization: `Bearer ${token}` }
type Runtime = ReturnType<typeof createDirectorApp>

async function api<T>(runtime: Runtime, method: string, path: string, body?: unknown): Promise<InjectResponse<{ ok: true; data: T }>> {
  const payload = body === undefined ? { headers: {} as Record<string, string> } : jsonBody(body)
  return await inject(runtime.app, { method, path, headers: { ...auth, ...payload.headers }, ...('body' in payload ? { body: payload.body } : {}) })
}

describe('Prompt/Skill/Artifact API v2', () => {
  let runtime: Runtime

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-prompt-api-'))
    runtime = createDirectorApp({ databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token })
  })

  afterEach(() => {
    runtime.io.disconnectSockets(true)
    runtime.io.removeAllListeners()
    runtime.httpServer.removeAllListeners()
    runtime.db.close()
  })

  it('创建、diff、黄金样例和发布均保留 Prompt revision', async () => {
    const base = {
      stableKey: 'script.api-scene', title: 'API 场景编剧', role: 'execution',
      languageDrafts: { original: '写 {{topic}}', zhReview: '写 {{topic}}', enExecution: 'Write {{topic}}' },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } } }, outputSchema: { required: ['scene'] },
    }
    const first = (await api<PromptRevision>(runtime, 'POST', '/api/v2/prompt-definitions', base)).body.data
    const second = (await api<PromptRevision>(runtime, 'POST', '/api/v2/prompt-definitions', {
      ...base, languageDrafts: { ...base.languageDrafts, zhReview: '写可拍摄的 {{topic}}' }, feedback: '更可拍摄',
    })).body.data
    const diff = (await api<PromptDiff>(runtime, 'GET', `/api/v2/prompt-revisions/${first.id}/diff?to=${second.id}`)).body.data
    expect(diff.changes.map((change) => change.field)).toContain('zhReview')
    expect((await api(runtime, 'POST', `/api/v2/prompt-revisions/${second.id}/publish`)).status).toBe(409)
    expect((await api(runtime, 'POST', `/api/v2/prompt-revisions/${second.id}/evaluations`, {
      name: '结构输出', input: { topic: '雨夜' }, expectedSchema: { required: ['scene'] }, fakeOutput: { scene: {} },
    })).status).toBe(201)
    const published = (await api<PromptRevision>(runtime, 'POST', `/api/v2/prompt-revisions/${second.id}/publish`)).body.data
    expect(published).toMatchObject({ revision: 3, status: 'published' })
    expect((await api<PromptRevision[]>(runtime, 'GET', '/api/v2/prompt-definitions?stableKey=script.api-scene')).body.data).toHaveLength(3)
  })

  it('Artifact rollback 在 API 边界执行 expected head revision CAS', async () => {
    const project = runtime.db.createProject({ name: 'Artifact API' })
    const now = new Date().toISOString()
    const firstId = randomUUID()
    runtime.db.put('artifact_versions', project.id, {
      id: firstId, projectId: project.id, workflow: { id: 'workflow.api', version: '1.0.0' }, stageId: 'script',
      artifactType: 'SceneScript', revision: 1, scope: { type: 'project', id: project.id }, dependencies: [],
      content: { text: 'v1' }, contentHash: 'a'.repeat(64), status: 'approved', createdAt: now, updatedAt: now,
    })
    const rolled = await api<{ revision: number }>(runtime, 'POST', `/api/v2/artifacts/project/${project.id}/rollback`, {
      projectId: project.id, targetVersionId: firstId, expectedHeadRevision: 1,
    })
    expect(rolled).toMatchObject({ status: 201, body: { data: { revision: 2 } } })
    expect((await api(runtime, 'POST', `/api/v2/artifacts/project/${project.id}/rollback`, {
      projectId: project.id, targetVersionId: firstId, expectedHeadRevision: 1,
    })).status).toBe(409)
    expect((await api(runtime, 'POST', `/api/v2/artifacts/project/${randomUUID()}/rollback`, {
      projectId: project.id, targetVersionId: firstId, expectedHeadRevision: 2,
    })).status).toBe(404)
  })

  it('局部重生成固定 Prompt/目标 revision，且只追加目标 Artifact 或 Candidate', async () => {
    const project = runtime.db.createProject({ name: '局部重生成' })
    runtime.service.importSource(project.id, {
      title: '双场景', content: '第一章\n雨夜车站收到来信。\n\n第二章\n清晨码头确认约定。',
    })
    const planned = runtime.service.createPlan(project.id, 'scoped-plan-idempotency-0001', runtime.memory.checkpointContext(project.id))
    runtime.service.approvePlan(planned.plan.id, planned.approvalToken)
    const before = runtime.db.snapshot(project.id)
    expect(before.scenes.length).toBeGreaterThanOrEqual(2)
    expect(before.shots.length).toBeGreaterThanOrEqual(2)

    const base = {
      projectId: project.id, stableKey: 'script.scoped-regeneration', title: '局部场景修订', role: 'execution',
      languageDrafts: { original: '润色 {{topic}}', zhReview: '只润色 {{topic}}', enExecution: 'Polish only {{topic}}' },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } } }, outputSchema: { required: ['result'] },
    }
    const draft = (await api<PromptRevision>(runtime, 'POST', '/api/v2/prompt-definitions', base)).body.data
    await api(runtime, 'POST', `/api/v2/prompt-revisions/${draft.id}/evaluations`, {
      name: '局部输出', input: { topic: '雨夜车站' }, expectedSchema: { required: ['result'] }, fakeOutput: { result: 'ok' },
    })
    const published = (await api<PromptRevision>(runtime, 'POST', `/api/v2/prompt-revisions/${draft.id}/publish`)).body.data

    const scene = before.scenes[0]!
    const sceneResult = (await api<ScopedRegenerationResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'scene', targetId: scene.id,
      variables: { topic: scene.title }, idempotencyKey: 'scoped-scene-regeneration-0001',
    })).body.data
    expect(sceneResult.task).toMatchObject({ status: 'succeeded', inputSnapshot: { promptBinding: {
      promptRevisionId: published.id, targetType: 'scene', targetId: scene.id, targetRevision: scene.revision,
    } } })
    expect(sceneResult.artifact).toMatchObject({ scope: { type: 'scene', id: scene.id }, artifactType: 'SceneScriptRevision' })
    expect(runtime.db.snapshot(project.id).scenes).toEqual(before.scenes)
    expect(runtime.db.list<ArtifactVersion>('artifact_versions', project.id).filter((item) => item.scope.type === 'scene' && item.scope.id !== scene.id)).toHaveLength(0)

    const repeated = (await api<ScopedRegenerationResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'scene', targetId: scene.id,
      variables: { topic: scene.title }, idempotencyKey: 'scoped-scene-regeneration-0001',
    })).body.data
    expect(repeated).toMatchObject({ task: { id: sceneResult.task.id }, artifact: { id: sceneResult.artifact.id } })
    expect((await api(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'scene', targetId: scene.id,
      variables: { topic: '不同变量' }, idempotencyKey: 'scoped-scene-regeneration-0001',
    })).status).toBe(409)
    expect((await api(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'scene', targetId: before.scenes[1]!.id,
      variables: { topic: before.scenes[1]!.title }, idempotencyKey: 'scoped-scene-regeneration-0001',
    })).status).toBe(409)

    const shot = before.shots[0]!
    const shotResult = (await api<ScopedRegenerationResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'shot', targetId: shot.id,
      variables: { topic: shot.description }, idempotencyKey: 'scoped-shot-regeneration-0001',
    })).body.data
    expect(shotResult.candidate).toMatchObject({ shotId: shot.id, promptRevisionId: published.id, status: 'ready' })
    const after = runtime.db.snapshot(project.id)
    expect(after.shots.find((item) => item.id === shot.id)?.selectedCandidateId).toBeUndefined()
    expect(after.candidates.filter((candidate) => candidate.shotId !== shot.id)).toHaveLength(0)
  })
})
