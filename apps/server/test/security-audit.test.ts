import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GenerationTaskSchema,
  ProjectSecurityAuditLogSchema,
  type GenerationTask,
  type Project,
  type ProjectSecurityAuditLog,
} from '@aigc-director/contracts'
import { createDirectorApp } from '../src/http/app.js'
import { inject, jsonBody, type InjectResponse } from './http-inject.js'

const token = 'security-audit-test-session-token'
const auth = { authorization: `Bearer ${token}` }
type Runtime = ReturnType<typeof createDirectorApp>

async function api<T>(runtime: Runtime, method: string, path: string, body?: unknown, requestId?: string): Promise<InjectResponse<T>> {
  const payload = body === undefined ? { headers: {} as Record<string, string> } : jsonBody(body)
  return await inject<T>(runtime.app, {
    method,
    path,
    headers: { ...auth, ...payload.headers, ...(requestId ? { 'x-request-id': requestId } : {}) },
    ...('body' in payload && payload.body !== undefined ? { body: payload.body } : {}),
  })
}

function stop(runtime: Runtime): void {
  runtime.io.disconnectSockets(true)
  runtime.io.removeAllListeners()
  runtime.httpServer.removeAllListeners()
  runtime.db.close()
}

describe('单用户高风险动作安全审计', () => {
  let runtime: Runtime
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aigc-security-audit-'))
    runtime = createDirectorApp({
      databasePath: join(directory, 'director.sqlite'),
      dataDirectory: directory,
      sessionToken: token,
      providerNetworkDisabled: true,
    })
  })

  afterEach(() => stop(runtime))

  async function createProject(name = '安全审计项目'): Promise<Project> {
    const response = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name })
    return response.body.data
  }

  it('为成功与拒绝的高风险操作追加 started/terminal 事件，且只暴露脱敏引用', async () => {
    const project = await createProject()
    const privateOutputDirectory = ['', 'Users', 'private', 'secret-output'].join('/')
    const acceptedRequestId = 'audit-policy-accepted-001'
    const accepted = await api(runtime, 'PUT', `/api/v2/projects/${project.id}/generation-policy`, {
      expectedRevision: 0,
      maxConcurrentTasks: 2,
      maxCandidatesPerBatch: 3,
      maxExportDurationMs: 90_000,
      confirmation: 'UPDATE_GENERATION_POLICY',
    }, acceptedRequestId)
    expect(accepted.status).toBe(200)

    const rejectedRequestId = 'audit-policy-rejected-001'
    const rejected = await api<{ error: { code: string } }>(runtime, 'PUT', `/api/v2/projects/${project.id}/generation-policy`, {
      expectedRevision: 0,
      maxConcurrentTasks: 2,
      maxCandidatesPerBatch: 3,
      maxExportDurationMs: 90_000,
      confirmation: 'UPDATE_GENERATION_POLICY',
      apiKey: 'must-never-enter-audit',
      outputDirectory: privateOutputDirectory,
    }, rejectedRequestId)
    expect(rejected.status).toBe(400)
    expect(rejected.body.error.code).toBe('VALIDATION_FAILED')

    const response = await api<{ data: ProjectSecurityAuditLog }>(runtime, 'GET', `/api/v2/projects/${project.id}/security-audit?limit=20`)
    expect(response.status).toBe(200)
    const log = ProjectSecurityAuditLogSchema.parse(response.body.data)
    expect(log.events).toHaveLength(4)
    expect(log.events.map((event) => [event.action, event.status, event.correlationId])).toEqual(expect.arrayContaining([
      ['generation_policy.update', 'started', acceptedRequestId],
      ['generation_policy.update', 'succeeded', acceptedRequestId],
      ['generation_policy.update', 'started', rejectedRequestId],
      ['generation_policy.update', 'rejected', rejectedRequestId],
    ]))
    expect(log.events.find((event) => event.status === 'rejected')?.errorCode).toBe('VALIDATION_FAILED')
    expect(log.events.every((event) => event.targetReferenceHash.length === 64)).toBe(true)
    expect(JSON.stringify(log)).not.toMatch(/must-never-enter-audit|secret-output|wangwentong|apiKey|outputDirectory/iu)
  })

  it('审计任务对账并在应用重启后保留 append-only 证据', async () => {
    const project = await createProject('重启审计')
    const now = new Date().toISOString()
    const task: GenerationTask = GenerationTaskSchema.parse({
      id: randomUUID(), projectId: project.id, type: 'video', status: 'outcome_unknown', stage: '等待安全对账',
      idempotencyKey: `security-audit-task-${randomUUID()}`, provider: 'demo-local', model: 'demo-video-v1', attempt: 1,
      inputSnapshot: { prompt: 'private story content', authorization: 'Bearer never-log-this' }, retryable: false,
      createdAt: now, updatedAt: now,
    })
    runtime.db.put('generation_tasks', project.id, task)

    const requestId = 'audit-task-reconcile-001'
    const reconciled = await api(runtime, 'POST', `/api/v2/tasks/${task.id}/reconcile`, {}, requestId)
    expect(reconciled.status).toBe(200)
    stop(runtime)
    runtime = createDirectorApp({
      databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token, providerNetworkDisabled: true,
    })

    const response = await api<{ data: ProjectSecurityAuditLog }>(runtime, 'GET', `/api/v2/projects/${project.id}/security-audit?limit=10`)
    expect(response.status).toBe(200)
    const events = response.body.data.events.filter((event) => event.correlationId === requestId)
    expect(events.map((event) => event.status).sort()).toEqual(['started', 'succeeded'])
    expect(events.every((event) => event.action === 'task.reconcile' && event.targetType === 'task')).toBe(true)
    expect(JSON.stringify(events)).not.toMatch(/private story content|never-log-this|Bearer/iu)

    expect(() => runtime.db.raw.prepare('UPDATE security_audit_events SET status = ?').run('rejected')).toThrow()
    expect(() => runtime.db.raw.prepare('DELETE FROM security_audit_events').run()).toThrow()
  })

  it('项目审计查询需要本地会话并严格限制分页', async () => {
    const project = await createProject()
    const unauthorized = await inject(runtime.app, { method: 'GET', path: `/api/v2/projects/${project.id}/security-audit` })
    expect(unauthorized.status).toBe(401)
    const invalidLimit = await api(runtime, 'GET', `/api/v2/projects/${project.id}/security-audit?limit=1000`)
    expect(invalidLimit.status).toBe(400)
  })

  it('覆盖项目 Prompt、Skill 与 Artifact 的发布和回滚入口', async () => {
    const project = await createProject('发布回滚审计')
    const prompt = await api<{ data: { id: string } }>(runtime, 'POST', '/api/v2/prompt-definitions', {
      projectId: project.id,
      stableKey: 'audit.project-prompt',
      title: '审计 Prompt',
      role: 'execution',
      languageDrafts: { original: '写 {{topic}}', zhReview: '写 {{topic}}', enExecution: 'Write {{topic}}' },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } } },
      outputSchema: { required: ['result'] },
    })
    const promptId = prompt.body.data.id
    expect((await api(runtime, 'POST', `/api/v2/prompt-revisions/${promptId}/publish`, undefined, 'audit-prompt-rejected')).status).toBe(409)
    await api(runtime, 'POST', `/api/v2/prompt-revisions/${promptId}/evaluations`, {
      name: 'Prompt gate', input: {}, expectedSchema: { required: ['result'] }, fakeOutput: { result: 'ok' },
    })
    const publishedPrompt = await api<{ data: { id: string } }>(runtime, 'POST', `/api/v2/prompt-revisions/${promptId}/publish`, undefined, 'audit-prompt-published')
    expect(publishedPrompt.status).toBe(201)
    expect((await api(runtime, 'POST', `/api/v2/prompt-revisions/${publishedPrompt.body.data.id}/restore`, undefined, 'audit-prompt-restored')).status).toBe(201)

    const skill = await api<{ data: { id: string } }>(runtime, 'POST', '/api/v2/skills', {
      projectId: project.id,
      stableKey: 'audit.project-skill',
      name: '审计 Skill',
      markdown: '# 审计 Skill\n只使用本地确定性规则。',
    })
    const skillId = skill.body.data.id
    expect((await api(runtime, 'POST', `/api/v2/skills/${skillId}/publish`, undefined, 'audit-skill-rejected')).status).toBe(409)
    await api(runtime, 'POST', `/api/v2/skills/${skillId}/evaluations`, {
      name: 'Skill gate', input: {}, expectedSchema: { required: ['result'] }, fakeOutput: { result: 'ok' },
    })
    const publishedSkill = await api<{ data: { id: string } }>(runtime, 'POST', `/api/v2/skills/${skillId}/publish`, undefined, 'audit-skill-published')
    expect(publishedSkill.status).toBe(201)
    expect((await api(runtime, 'POST', `/api/v2/skills/${publishedSkill.body.data.id}/rollback`, undefined, 'audit-skill-rollback')).status).toBe(201)

    const artifactId = randomUUID()
    const now = new Date().toISOString()
    runtime.db.put('artifact_versions', project.id, {
      id: artifactId,
      projectId: project.id,
      workflow: { id: 'workflow.audit', version: '1.0.0' },
      stageId: 'script',
      artifactType: 'SceneScript',
      revision: 1,
      scope: { type: 'project', id: project.id },
      dependencies: [],
      content: { privateDraft: 'must-not-be-audited' },
      contentHash: 'a'.repeat(64),
      status: 'approved',
      createdAt: now,
      updatedAt: now,
    })
    const rollbackPath = `/api/v2/artifacts/project/${project.id}/rollback`
    expect((await api(runtime, 'POST', rollbackPath, {
      projectId: project.id, targetVersionId: artifactId, expectedHeadRevision: 1,
    }, 'audit-artifact-rollback')).status).toBe(201)
    expect((await api(runtime, 'POST', rollbackPath, {
      projectId: project.id, targetVersionId: artifactId, expectedHeadRevision: 1,
    }, 'audit-artifact-conflict')).status).toBe(409)

    const response = await api<{ data: ProjectSecurityAuditLog }>(runtime, 'GET', `/api/v2/projects/${project.id}/security-audit?limit=100`)
    const terminalEvents = response.body.data.events.filter((event) => event.status !== 'started')
    expect(terminalEvents.map((event) => [event.action, event.status])).toEqual(expect.arrayContaining([
      ['prompt.publish', 'rejected'],
      ['prompt.publish', 'succeeded'],
      ['prompt.rollback', 'succeeded'],
      ['skill.publish', 'rejected'],
      ['skill.publish', 'succeeded'],
      ['skill.rollback', 'succeeded'],
      ['artifact.rollback', 'succeeded'],
      ['artifact.rollback', 'rejected'],
    ]))
    expect(JSON.stringify(response.body.data)).not.toContain('must-not-be-audited')
  })
})
