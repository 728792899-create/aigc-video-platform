import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CandidateBatchSchema, ExportTaskInputSchema, GenerationTaskSchema, ProviderReceiptRecordSchema, type CandidateBatchRetryResult, type ExecutionPlan, type GenerationTask, type Project, type ProjectGenerationPolicy, type TaskAdmission, type TaskDiagnostic, type TaskReconcileResult, type TaskRetryResult } from '@aigc-director/contracts'
import { createDemoPackProvider } from '@aigc-director/agents'
import { createDirectorApp } from '../src/http/app.js'
import { inject, jsonBody, type InjectResponse } from './http-inject.js'

const token = 'task-lifecycle-test-session-token'
const auth = { authorization: `Bearer ${token}` }
type Runtime = ReturnType<typeof createDirectorApp>

async function api<T>(runtime: Runtime, method: string, path: string, body?: unknown): Promise<InjectResponse<T>> {
  const payload = body === undefined ? { headers: {} as Record<string, string> } : jsonBody(body)
  return await inject<T>(runtime.app, {
    method, path, headers: { ...auth, ...payload.headers },
    ...('body' in payload && payload.body !== undefined ? { body: payload.body } : {}),
  })
}

function stop(runtime: Runtime): void {
  runtime.io.disconnectSockets(true)
  runtime.io.removeAllListeners()
  runtime.httpServer.removeAllListeners()
  runtime.db.close()
}

describe('持久任务安全对账与重试', () => {
  let runtime: Runtime
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aigc-task-lifecycle-'))
    runtime = createDirectorApp({
      databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token,
    })
  })

  afterEach(() => stop(runtime))

  async function createProject(): Promise<Project> {
    const response = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '任务安全测试' })
    return response.body.data
  }

  it('未知 Provider 结果必须先对账，禁止直接重提', async () => {
    const project = await createProject()
    const now = new Date().toISOString()
    const task = GenerationTaskSchema.parse({
      id: randomUUID(), projectId: project.id, type: 'video', status: 'outcome_unknown', stage: '等待 Provider 对账',
      idempotencyKey: `unknown-provider-${randomUUID()}`, provider: 'demo-local', model: 'demo-video-v1', attempt: 1,
      inputSnapshot: { prompt: '不得出现在公开诊断', secret: 'demo-secret-must-not-leak' }, retryable: false,
      needsAttentionReason: '提交结果未知', createdAt: now, updatedAt: now,
    })
    runtime.db.put('generation_tasks', project.id, task)

    const diagnostic = await api<{ data: TaskDiagnostic }>(runtime, 'GET', `/api/v2/tasks/${task.id}/diagnostic`)
    expect(diagnostic.status).toBe(200)
    expect(diagnostic.body.data).toMatchObject({ status: 'outcome_unknown', outcomeCertainty: 'unknown', reconcileRequired: true, retryAllowed: false })
    expect(JSON.stringify(diagnostic.body.data)).not.toContain('demo-secret')
    expect(JSON.stringify(diagnostic.body.data)).not.toContain('不得出现在公开诊断')
    const publicTask = await api<{ data: GenerationTask }>(runtime, 'GET', `/api/v2/tasks/${task.id}`)
    expect(JSON.stringify(publicTask.body.data)).not.toContain('demo-secret')
    expect(publicTask.body.data.inputSnapshot.secret).toBe('[redacted]')

    const blocked = await api<{ error: { code: string } }>(runtime, 'POST', `/api/v2/tasks/${task.id}/retry`, {
      idempotencyKey: `retry-blocked-${randomUUID()}`, confirmation: 'RETRY_FAILED_TASK',
    })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('TASK_RECONCILE_REQUIRED')

    const reconciled = await api<{ data: TaskReconcileResult }>(runtime, 'POST', `/api/v2/tasks/${task.id}/reconcile`, {})
    expect(reconciled.status).toBe(200)
    expect(reconciled.body.data).toMatchObject({ observation: 'unsupported', task: { status: 'needs_attention', retryable: false } })
  })

  it('提交超时且对账仍未知时保留未知证据，不降级为普通失败', async () => {
    stop(runtime)
    runtime = createDirectorApp({
      databasePath: join(directory, 'unknown.sqlite'), dataDirectory: directory, sessionToken: token,
      packProviderFactory: () => createDemoPackProvider({ submit: 'timeout-after-accept', reconcile: 'outcome_unknown' }),
    })
    const project = await createProject()
    await api(runtime, 'POST', `/api/v2/projects/${project.id}/sources`, {
      title: '未知结果', content: '第一章 云端任务\n导演提交镜头。网络连接中断。系统等待对账。',
    })
    const planned = await api<{ data: { plan: ExecutionPlan; approvalToken: string } }>(runtime, 'POST', `/api/v2/projects/${project.id}/agent-plans`, {
      idempotencyKey: `unknown-plan-${project.id}`,
    })
    await api(runtime, 'POST', `/api/v2/plans/${planned.body.data.plan.id}/approve`, { token: planned.body.data.approvalToken })
    await expect(runtime.service.runDemoProduction(project.id, `unknown-production-${project.id}`)).rejects.toThrow('PROVIDER_OUTCOME_UNKNOWN_RECONCILE_REQUIRED')
    const snapshot = runtime.db.snapshot(project.id)
    const unknown = snapshot.tasks.find((task) => task.status === 'outcome_unknown')
    expect(unknown).toMatchObject({ retryable: false, error: { code: 'PROVIDER_OUTCOME_UNKNOWN_RECONCILE_REQUIRED' } })
    expect(snapshot.attempts.some((attempt) => attempt.taskId === unknown?.id && attempt.status === 'outcome_unknown')).toBe(true)
    expect(snapshot.promptRuns.some((run) => run.id === unknown?.promptRunId && run.status === 'submitted')).toBe(true)
  })

  it('本地失败任务使用新 attempt 幂等重试并保留父任务证据', async () => {
    const project = await createProject()
    await api(runtime, 'POST', `/api/v2/projects/${project.id}/sources`, {
      title: '本地导出', content: '第一章 工作室\n导演打开监视器。画面亮起。剪辑师确认导出。',
    })
    const planned = await api<{ data: { plan: ExecutionPlan; approvalToken: string } }>(runtime, 'POST', `/api/v2/projects/${project.id}/agent-plans`, {
      idempotencyKey: `task-retry-plan-${project.id}`,
    })
    await api(runtime, 'POST', `/api/v2/plans/${planned.body.data.plan.id}/approve`, { token: planned.body.data.approvalToken })
    const production = await runtime.service.runDemoProduction(project.id, `task-retry-production-${project.id}`)
    let graphRevision = runtime.db.getProject(project.id)?.graphRevision ?? 0
    for (const shot of production.shots) {
      const selected = production.candidates.find((candidate) => candidate.shotId === shot.id && candidate.status === 'ready')
      if (!selected) throw new Error('TEST_CANDIDATE_MISSING')
      const selection = await api<{ data: { revision: number } }>(runtime, 'POST', `/api/v2/projects/${project.id}/graph/commands?view=production`, {
        type: 'select_candidate', expectedRevision: graphRevision,
        idempotencyKey: `task-retry-select-${shot.id}`, shotId: shot.id, candidateId: selected.id,
      })
      expect(selection.status).toBe(200)
      graphRevision = selection.body.data.revision
    }
    const exportSnapshot = runtime.db.snapshot(project.id)
    const shotSnapshots = [...exportSnapshot.shots].sort((left, right) => left.ordinal - right.ordinal)
    const selections = shotSnapshots.map((shot) => {
      const candidate = exportSnapshot.candidates.find((item) => item.id === shot.selectedCandidateId && item.shotId === shot.id && item.status === 'ready')
      const media = exportSnapshot.media.find((item) => item.id === candidate?.mediaId)
      if (!candidate?.mediaId || !media || (candidate.kind !== 'image' && candidate.kind !== 'video')) throw new Error('TEST_EXPORT_SELECTION_MISSING')
      return {
        shotId: shot.id, shotRevision: shot.revision, candidateId: candidate.id,
        mediaId: media.id, mediaSha256: media.sha256, kind: candidate.kind,
      }
    })
    const assemblyHash = createHash('sha256').update(JSON.stringify({
      shots: shotSnapshots.map((shot) => ({ id: shot.id, revision: shot.revision, durationMs: shot.durationMs })), selections,
    })).digest('hex')
    const inputSnapshot = ExportTaskInputSchema.parse({
      projectId: project.id, outputDirectory: directory, fileName: 'retried-demo.mp4', width: 640, height: 360, fps: 24,
      shotSnapshots, selections, assemblyHash, assembledAt: new Date().toISOString(),
    })
    const now = new Date().toISOString()
    const original: GenerationTask = GenerationTaskSchema.parse({
      id: randomUUID(), projectId: project.id, type: 'export', status: 'failed', stage: '导出失败',
      idempotencyKey: `original-export-${randomUUID()}`, provider: 'demo-local', model: 'local-ffmpeg', attempt: 1,
      inputSnapshot,
      retryable: true, error: {
        code: 'TASK_EXECUTION_FAILED', userMessage: '任务失败。', retryable: true,
        correlationId: randomUUID(), taskId: randomUUID(), timestamp: now,
      }, createdAt: now, updatedAt: now, finishedAt: now,
    })
    runtime.db.put('generation_tasks', project.id, original)
    const idempotencyKey = `explicit-retry-${randomUUID()}`
    const first = await api<{ data: TaskRetryResult }>(runtime, 'POST', `/api/v2/tasks/${original.id}/retry`, {
      idempotencyKey, confirmation: 'RETRY_FAILED_TASK',
    })
    expect(first.status).toBe(202)
    expect(first.body.data).toMatchObject({ reused: false, task: { parentTaskId: original.id, attempt: 2 } })
    expect(first.body.data.task.id).not.toBe(original.id)
    expect(JSON.stringify(first.body.data)).not.toContain(directory)

    const second = await api<{ data: TaskRetryResult }>(runtime, 'POST', `/api/v2/tasks/${original.id}/retry`, {
      idempotencyKey, confirmation: 'RETRY_FAILED_TASK',
    })
    expect(second.status).toBe(202)
    expect(second.body.data).toMatchObject({ reused: true, task: { id: first.body.data.task.id } })

    const completed = await runtime.service.waitForTask(first.body.data.task.id)
    expect(completed.status, JSON.stringify(completed)).toBe('succeeded')
    expect(runtime.db.get<GenerationTask>('generation_tasks', original.id)).toMatchObject({ status: 'failed' })

    const policy = runtime.service.generationPolicy(project.id)
    runtime.service.updateGenerationPolicy(project.id, {
      expectedRevision: policy.revision,
      maxConcurrentTasks: policy.maxConcurrentTasks,
      maxCandidatesPerBatch: policy.maxCandidatesPerBatch,
      maxExportDurationMs: 5_000,
      confirmation: 'UPDATE_GENERATION_POLICY',
    })
    const overLimit = GenerationTaskSchema.parse({
      ...original,
      id: randomUUID(),
      idempotencyKey: `over-limit-export-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    runtime.db.put('generation_tasks', project.id, overLimit)
    const blockedByDuration = await api<{ error: { code: string } }>(runtime, 'POST', `/api/v2/tasks/${overLimit.id}/retry`, {
      idempotencyKey: `over-limit-retry-${randomUUID()}`, confirmation: 'RETRY_FAILED_TASK',
    })
    expect(blockedByDuration.status).toBe(422)
    expect(blockedByDuration.body.error.code).toBe('EXPORT_DURATION_POLICY_LIMIT')
  }, 60_000)

  it('候选批次只重试失败项，保留原批次、原候选和父任务', async () => {
    const project = await createProject()
    await api(runtime, 'POST', `/api/v2/projects/${project.id}/sources`, {
      title: '候选局部失败', content: '第一章 夜景\n灯光亮起。演员走进画面。镜头停在门口。',
    })
    const planned = await api<{ data: { plan: ExecutionPlan; approvalToken: string } }>(runtime, 'POST', `/api/v2/projects/${project.id}/agent-plans`, {
      idempotencyKey: `candidate-retry-plan-${project.id}`,
    })
    await api(runtime, 'POST', `/api/v2/plans/${planned.body.data.plan.id}/approve`, { token: planned.body.data.approvalToken })
    const produced = await runtime.service.runDemoProduction(project.id, `candidate-retry-production-${project.id}`)
    const sourceBatch = produced.candidateBatches[0]
    if (!sourceBatch) throw new Error('TEST_BATCH_MISSING')
    const original = produced.tasks.find((task) => task.inputSnapshot.batchId === sourceBatch.id)
    if (!original) throw new Error('TEST_BATCH_TASK_MISSING')
    const timestamp = new Date().toISOString()
    const failed = GenerationTaskSchema.parse({
      ...original, status: 'failed', retryable: true, progress: undefined, result: undefined,
      error: {
        code: 'TASK_EXECUTION_FAILED', userMessage: '候选生成失败。', retryable: true,
        correlationId: randomUUID(), taskId: original.id, timestamp,
      }, updatedAt: timestamp, finishedAt: timestamp,
    })
    runtime.db.put('generation_tasks', project.id, failed)
    runtime.db.put('candidate_batches', project.id, CandidateBatchSchema.parse({
      ...sourceBatch, status: 'partial', completedCount: sourceBatch.completedCount - 1,
      failedCount: 1, updatedAt: timestamp, finishedAt: timestamp,
    }))

    const idempotencyKey = `retry-failed-candidates-${randomUUID()}`
    const first = await api<{ data: CandidateBatchRetryResult }>(runtime, 'POST', `/api/v2/candidate-batches/${sourceBatch.id}/retry-failed`, {
      idempotencyKey, confirmation: 'RETRY_FAILED_CANDIDATES',
    })
    expect(first.status).toBe(201)
    expect(first.body.data).toMatchObject({
      reused: false,
      batch: { status: 'succeeded', source: 'retry', parentBatchId: sourceBatch.id, quantity: 1, completedCount: 1 },
      tasks: [{ status: 'succeeded', parentTaskId: original.id, attempt: original.attempt + 1 }],
    })
    expect(first.body.data.candidates).toHaveLength(1)
    expect(runtime.db.get<GenerationTask>('generation_tasks', original.id)).toMatchObject({ status: 'failed' })
    expect(runtime.db.snapshot(project.id).candidates.length).toBe(produced.candidates.length + 1)

    const repeated = await api<{ data: CandidateBatchRetryResult }>(runtime, 'POST', `/api/v2/candidate-batches/${sourceBatch.id}/retry-failed`, {
      idempotencyKey, confirmation: 'RETRY_FAILED_CANDIDATES',
    })
    expect(repeated.status).toBe(201)
    expect(repeated.body.data).toMatchObject({ reused: true, batch: { id: first.body.data.batch.id } })
    expect(repeated.body.data.tasks[0]?.id).toBe(first.body.data.tasks[0]?.id)
  })

  it('远端取消只有 Provider 确认后才标记 cancelled', async () => {
    const project = await createProject()
    const now = new Date().toISOString()
    const task = GenerationTaskSchema.parse({
      id: randomUUID(), projectId: project.id, type: 'image', status: 'running', stage: '远端生成',
      idempotencyKey: `cancel-provider-${randomUUID()}`, provider: 'demo-local', model: 'demo-frame-v1', attempt: 1,
      inputSnapshot: {}, retryable: true, createdAt: now, startedAt: now, updatedAt: now,
    })
    const receipt = ProviderReceiptRecordSchema.parse({
      id: randomUUID(), projectId: project.id, taskId: task.id, attemptId: randomUUID(), providerId: 'demo-local',
      remoteJobId: `fake_${'a'.repeat(20)}`, acceptedAt: now, createdAt: now,
    })
    runtime.db.put('generation_tasks', project.id, task)
    runtime.db.put('provider_receipts', project.id, receipt)
    const response = await api<{ data: GenerationTask }>(runtime, 'POST', `/api/v2/tasks/${task.id}/cancel`, {})
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ status: 'cancelled', cancelState: 'provider_confirmed', retryable: false })
  })

  it('Provider 不支持取消时进入人工关注，不伪造远端成功', async () => {
    stop(runtime)
    runtime = createDirectorApp({
      databasePath: join(directory, 'cancel-unsupported.sqlite'), dataDirectory: directory, sessionToken: token,
      packProviderFactory: () => createDemoPackProvider({ cancel: 'unsupported' }),
    })
    const project = await createProject()
    const now = new Date().toISOString()
    const task = GenerationTaskSchema.parse({
      id: randomUUID(), projectId: project.id, type: 'video', status: 'running', stage: '远端视频',
      idempotencyKey: `cancel-unsupported-${randomUUID()}`, provider: 'demo-local', model: 'demo-video-v1', attempt: 1,
      inputSnapshot: {}, retryable: true, createdAt: now, startedAt: now, updatedAt: now,
    })
    runtime.db.put('generation_tasks', project.id, task)
    runtime.db.put('provider_receipts', project.id, ProviderReceiptRecordSchema.parse({
      id: randomUUID(), projectId: project.id, taskId: task.id, attemptId: randomUUID(), providerId: 'demo-local',
      remoteJobId: `fake_${'b'.repeat(20)}`, acceptedAt: now, createdAt: now,
    }))
    const response = await api<{ data: GenerationTask }>(runtime, 'POST', `/api/v2/tasks/${task.id}/cancel`, {})
    expect(response.body.data).toMatchObject({ status: 'needs_attention', cancelState: 'unsupported', retryable: false })
    expect(response.body.data.needsAttentionReason).toContain('可能仍在远端执行')
  })

  it('未知任务计入并发预算，达到上限时拒绝创建新任务', async () => {
    stop(runtime)
    runtime = createDirectorApp({
      databasePath: join(directory, 'admission.sqlite'), dataDirectory: directory, sessionToken: token, maxConcurrentTasks: 1,
    })
    const project = await createProject()
    const now = new Date().toISOString()
    runtime.db.put('generation_tasks', project.id, GenerationTaskSchema.parse({
      id: randomUUID(), projectId: project.id, type: 'video', status: 'outcome_unknown', stage: '等待远端对账',
      idempotencyKey: `admission-unknown-${randomUUID()}`, provider: 'demo-local', model: 'demo-video-v1', attempt: 1,
      inputSnapshot: {}, retryable: false, createdAt: now, updatedAt: now,
    }))
    const admission = await api<{ data: { allowed: boolean; activeTasks: number; maxConcurrentTasks: number; paidProviders: string; reasons: string[] } }>(runtime, 'GET', `/api/v2/projects/${project.id}/task-admission`)
    expect(admission.body.data).toMatchObject({ allowed: false, activeTasks: 1, maxConcurrentTasks: 1, paidProviders: 'blocked', reasons: ['concurrency_limit'] })
    const blocked = await api<{ error: { code: string } }>(runtime, 'POST', '/api/v2/exports/preflight', {
      projectId: project.id, outputDirectory: directory, fileName: 'blocked.mp4', width: 640, height: 360, fps: 24,
    })
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('TASK_CONCURRENCY_LIMIT')
  })

  it('项目生成策略使用 revision CAS、精确确认并持久执行零付费硬门禁', async () => {
    const project = await createProject()
    const initial = await api<{ data: ProjectGenerationPolicy }>(runtime, 'GET', `/api/v2/projects/${project.id}/generation-policy`)
    expect(initial.body.data).toMatchObject({
      projectId: project.id, revision: 0, billingMode: 'demo-only', paidProviders: 'blocked',
      maxConcurrentTasks: 4, maxCandidatesPerBatch: 4, maxExportDurationMs: 3_600_000,
      dailyPaidBudgetMicros: 0,
    })

    const invalidConfirmation = await api<{ error: { code: string } }>(runtime, 'PUT', `/api/v2/projects/${project.id}/generation-policy`, {
      expectedRevision: 0, maxConcurrentTasks: 1, maxCandidatesPerBatch: 2, maxExportDurationMs: 5_000,
      confirmation: 'yes',
    })
    expect(invalidConfirmation.status).toBe(400)
    expect(invalidConfirmation.body.error.code).toBe('VALIDATION_FAILED')

    const updated = await api<{ data: ProjectGenerationPolicy }>(runtime, 'PUT', `/api/v2/projects/${project.id}/generation-policy`, {
      expectedRevision: 0, maxConcurrentTasks: 1, maxCandidatesPerBatch: 2, maxExportDurationMs: 5_000,
      confirmation: 'UPDATE_GENERATION_POLICY',
    })
    expect(updated.body.data).toMatchObject({ revision: 1, maxConcurrentTasks: 1, maxCandidatesPerBatch: 2, maxExportDurationMs: 5_000 })

    const stale = await api<{ error: { code: string } }>(runtime, 'PUT', `/api/v2/projects/${project.id}/generation-policy`, {
      expectedRevision: 0, maxConcurrentTasks: 1, maxCandidatesPerBatch: 2, maxExportDurationMs: 5_000,
      confirmation: 'UPDATE_GENERATION_POLICY',
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('GENERATION_POLICY_REVISION_CONFLICT')

    expect(runtime.service.taskAdmission(project.id, { provider: 'demo-local', candidateCount: 3 })).toMatchObject({
      allowed: false, reasons: ['candidate_limit'], policyRevision: 1,
    } satisfies Partial<TaskAdmission>)
    expect(runtime.service.taskAdmission(project.id, { provider: 'demo-local', exportDurationMs: 5_001 })).toMatchObject({
      allowed: false, reasons: ['export_duration_limit'], dailyPaidBudgetMicros: 0, remainingPaidBudgetMicros: 0,
    } satisfies Partial<TaskAdmission>)
    expect(runtime.service.taskAdmission(project.id, { provider: 'paid-provider', estimatedPaidAmountMicros: 1 }).reasons).toEqual([
      'paid_budget_exceeded', 'paid_provider_disabled', 'provider_network_disabled',
    ])

    stop(runtime)
    runtime = createDirectorApp({
      databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token,
    })
    expect(runtime.service.generationPolicy(project.id)).toMatchObject({ revision: 1, maxConcurrentTasks: 1, dailyPaidBudgetMicros: 0 })
  })
})
