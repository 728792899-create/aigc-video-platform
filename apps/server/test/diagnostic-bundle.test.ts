import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GenerationTaskSchema,
  ProjectDiagnosticBundleSchema,
  ProjectRecoveryReportSchema,
  ShotSchema,
  type Project,
  type ProjectDiagnosticBundle,
  type ProjectRecoveryReport,
} from '@aigc-director/contracts'
import { createDirectorApp } from '../src/http/app.js'
import { inject, jsonBody, type InjectResponse } from './http-inject.js'

const token = 'diagnostic-bundle-test-session-token-with-enough-entropy'
type Runtime = ReturnType<typeof createDirectorApp>

async function api<T>(runtime: Runtime, method: string, path: string, body?: unknown, authorized = true): Promise<InjectResponse<T>> {
  const payload: { body?: string; headers: Record<string, string> } = body === undefined ? { headers: {} } : jsonBody(body)
  return await inject<T>(runtime.app, {
    method,
    path,
    headers: { ...(authorized ? { authorization: `Bearer ${token}` } : {}), ...(payload.headers ?? {}) },
    ...(payload.body === undefined ? {} : { body: payload.body }),
  })
}

describe('脱敏项目诊断包', () => {
  let runtime: Runtime

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-diagnostic-'))
    runtime = createDirectorApp({
      databasePath: join(directory, 'director.sqlite'),
      dataDirectory: directory,
      sessionToken: token,
      providerNetworkDisabled: true,
    })
  })

  afterEach(() => {
    runtime.io.disconnectSockets(true)
    runtime.io.removeAllListeners()
    runtime.httpServer.removeAllListeners()
    runtime.db.close()
  })

  it('只输出哈希化任务证据，不泄露原文、凭据、Provider ID 或本机路径', async () => {
    const projectName = '绝密未发布项目名称'
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: projectName })
    const projectId = created.body.data.id
    const taskId = randomUUID()
    const providerTaskId = 'remote-private-task-99731'
    const secret = ['sk', 'live', 'never-include-this-value'].join('-')
    const localPath = ['', 'Users', 'private-account', 'Movies', 'unreleased.mp4'].join('/')
    const now = new Date().toISOString()
    const task = GenerationTaskSchema.parse({
      id: taskId, projectId, type: 'video', status: 'failed', stage: '视频候选', idempotencyKey: `diagnostic-${randomUUID()}`,
      provider: 'demo-local', model: 'demo-video-v1', providerTaskId, attempt: 1,
      inputSnapshot: { apiKey: secret, sourceText: '私人原著正文', outputDirectory: localPath },
      result: { providerPayload: { authorization: secret }, localPath },
      error: {
        code: 'TASK_EXECUTION_FAILED', userMessage: '任务失败，可安全重试。',
        technicalMessage: `provider failed with ${secret} at ${localPath}`, retryable: true,
        correlationId: randomUUID(), timestamp: now,
      },
      retryable: true, createdAt: now, updatedAt: now, finishedAt: now,
    })
    runtime.db.put('generation_tasks', projectId, task)

    const response = await api<{ data: ProjectDiagnosticBundle }>(runtime, 'GET', `/api/v2/projects/${projectId}/diagnostic-bundle`)
    expect(response.status).toBe(200)
    const bundle = ProjectDiagnosticBundleSchema.parse(response.body.data)
    expect(bundle.tasks).toHaveLength(1)
    expect(bundle.tasks[0]).toMatchObject({
      taskReferenceHash: createHash('sha256').update(taskId).digest('hex'),
      providerReferenceHash: createHash('sha256').update(providerTaskId).digest('hex'),
      errorCode: 'TASK_EXECUTION_FAILED',
    })
    expect(bundle.privacy).toEqual({
      credentialsIncluded: false, absolutePathsIncluded: false, rawUserContentIncluded: false,
      rawPromptsIncluded: false, providerPayloadsIncluded: false, signedUrlsIncluded: false,
    })
    const serialized = JSON.stringify(bundle)
    for (const forbidden of [projectName, taskId, providerTaskId, secret, localPath, '私人原著正文', 'inputSnapshot', 'technicalMessage']) {
      expect(serialized).not.toContain(forbidden)
    }

    const unauthorized = await api(runtime, 'GET', `/api/v2/projects/${projectId}/diagnostic-bundle`, undefined, false)
    expect(unauthorized.status).toBe(401)
  })

  it('恢复中心返回可定位引用与安全任务动作，公开诊断包仍只保存 hash', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '恢复中心测试' })
    const projectId = created.body.data.id
    const now = new Date().toISOString()
    const shotId = randomUUID()
    const missingCandidateId = randomUUID()
    const missingMediaId = randomUUID()
    runtime.db.put('shots', projectId, ShotSchema.parse({
      id: shotId, projectId, sceneId: randomUUID(), title: '断裂镜头', description: '仅用于完整性测试',
      durationMs: 3_000, ordinal: 0, revision: 1, selectedCandidateId: missingCandidateId,
      boundaryFrames: [{
        id: randomUUID(), role: 'start', mediaId: missingMediaId, mediaSha256: 'a'.repeat(64),
        sourceShotId: shotId, sourceRevision: 1, provenance: 'selected_existing', createdAt: now,
      }], createdAt: now, updatedAt: now,
    }))
    const unknownTaskId = randomUUID()
    runtime.db.put('generation_tasks', projectId, GenerationTaskSchema.parse({
      id: unknownTaskId, projectId, type: 'video', status: 'outcome_unknown', stage: '等待 Provider 对账',
      idempotencyKey: `recovery-unknown-${randomUUID()}`, provider: 'demo-local', model: 'demo-video-v1',
      attempt: 1, inputSnapshot: {}, retryable: false, createdAt: now, updatedAt: now,
    }))

    const response = await api<{ data: ProjectRecoveryReport }>(runtime, 'GET', `/api/v2/projects/${projectId}/recovery`)
    expect(response.status).toBe(200)
    const report = ProjectRecoveryReportSchema.parse(response.body.data)
    expect(report.summary).toMatchObject({ errors: 1, warnings: 1, recoverableTasks: 1 })
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SHOT_SELECTED_CANDIDATE_MISSING', entityId: shotId, action: 'open_shot' }),
      expect.objectContaining({ code: 'BOUNDARY_MEDIA_MISSING', entityId: shotId, boundaryRole: 'start', action: 'clear_boundary' }),
    ]))
    expect(report.tasks).toEqual([expect.objectContaining({ taskId: unknownTaskId, actions: expect.arrayContaining(['reconcile', 'inspect']) })])

    const diagnostic = await api<{ data: ProjectDiagnosticBundle }>(runtime, 'GET', `/api/v2/projects/${projectId}/diagnostic-bundle`)
    expect(JSON.stringify(diagnostic.body.data)).not.toContain(shotId)
    expect(JSON.stringify(diagnostic.body.data)).not.toContain(missingCandidateId)
    expect(JSON.stringify(diagnostic.body.data)).not.toContain(missingMediaId)
  })
})
