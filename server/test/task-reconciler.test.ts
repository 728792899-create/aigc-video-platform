import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  ProviderAdapter,
  ProviderContext,
  ProviderReconciliation,
} from '@aigc-video/contracts'

import { normalizeAppError, redactDiagnostic } from '../services/appError'
import { reconcileTask, type ReconcileTask } from '../services/taskReconciler'

function task(patch: Partial<ReconcileTask> = {}): ReconcileTask {
  return {
    id: 'task-reconcile-1',
    status: 'running',
    progress: 20,
    message: 'Provider 处理中',
    provider: 'fake-video',
    provider_task_id: 'provider-123',
    attempt: 1,
    idempotency_key: 'idem-1',
    retryable: false,
    cancel_state: 'none',
    result: null,
    error: null,
    finished_at: null,
    correlation_id: 'rid-1',
    ...patch,
  }
}

function adapter(result: ProviderReconciliation): ProviderAdapter {
  return {
    provider: 'fake-video',
    modality: 'video',
    async submit() { throw new Error('reconcile 不得重新 submit') },
    async reconcile(_providerTaskId: string, _context: ProviderContext) { return result },
  }
}

test('缺少 provider task ID 的云任务标记 orphaned，绝不重新提交', async () => {
  let updates = 0
  const result = await reconcileTask(task({ provider_task_id: null }), {
    getAdapter: () => adapter({ status: 'running' }),
    updateTask: (_id, patch) => { updates += 1; return task(patch) },
    now: () => 10,
  })
  assert.equal(result.status, 'orphaned')
  assert.equal(updates, 1)
  assert.match(result.message, /缺少 Provider task ID/)
})

test('Provider 对账成功后写入结果和完成时间', async () => {
  const result = await reconcileTask(task(), {
    getAdapter: () => adapter({ status: 'succeeded', result: { file_url: '/uploads/video.mp4' } }),
    updateTask: (_id, patch) => task(patch),
    now: () => 20,
  })
  assert.equal(result.status, 'success')
  assert.equal(result.finished_at, 20)
  assert.deepEqual(result.result, { file_url: '/uploads/video.mp4' })
})

test('Provider 返回 unknown 或 adapter 不支持 reconcile 时保留证据并进入 orphaned', async () => {
  const noAdapter = await reconcileTask(task(), {
    getAdapter: () => ({ provider: 'fake-video', modality: 'video', async submit() { return { status: 'submitted' } } }),
    updateTask: (_id, patch) => task(patch),
  })
  assert.equal(noAdapter.status, 'orphaned')

  const unknown = await reconcileTask(task(), {
    getAdapter: () => adapter({ status: 'unknown' }),
    updateTask: (_id, patch) => task(patch),
  })
  assert.equal(unknown.status, 'orphaned')
})

test('限流、超时、鉴权和异常格式映射为稳定错误码且脱敏', () => {
  assert.equal(normalizeAppError(Object.assign(new Error('too many'), { status: 429 })).code, 'PROVIDER_RATE_LIMITED')
  assert.equal(normalizeAppError(Object.assign(new Error('aborted'), { name: 'AbortError' })).code, 'PROVIDER_TIMEOUT')
  assert.equal(normalizeAppError(Object.assign(new Error('invalid key'), { status: 401 })).code, 'PROVIDER_AUTH_FAILED')
  const malformed = normalizeAppError(Object.assign(new Error('bad response sk-secret-123456'), { code: 'INVALID_RESPONSE' }))
  assert.equal(malformed.code, 'PROVIDER_INVALID_RESPONSE')
  assert.doesNotMatch(malformed.technicalMessage || '', /sk-secret/)
  const unixPath = redactDiagnostic('at run (/Users/alice/Documents/private-project/server/app.ts:42:7)')
  const windowsPath = redactDiagnostic('at run (C:\\Users\\alice\\Documents\\private-project\\server\\app.ts:42:7)')
  assert.equal(unixPath, 'at run ([USER_PATH]:42:7)')
  assert.equal(windowsPath, 'at run ([USER_PATH]:42:7)')
  assert.doesNotMatch(`${unixPath}${windowsPath}`, /alice|private-project|Documents/)
})
