import assert from 'node:assert/strict'
import test from 'node:test'

import type { ProviderAdapter } from '@aigc-video/contracts'

import {
  recoverTasks,
  type RecoverableTask,
  type RecoveryOptions,
} from '../services/taskRecovery'

function recoverableTask(patch: Partial<RecoverableTask> = {}): RecoverableTask {
  return {
    id: 'task-1',
    type: 'auto-produce',
    status: 'running',
    progress: 47,
    message: '运行中',
    meta: {},
    result: null,
    error: null,
    provider: null,
    provider_task_id: null,
    attempt: 1,
    idempotency_key: null,
    correlation_id: null,
    retryable: false,
    cancel_state: 'none',
    finished_at: null,
    ...patch,
  }
}

function managerFor(task: RecoverableTask): NonNullable<RecoveryOptions['taskManager']> {
  return {
    list: () => [task],
    update: (_id, patch) => {
      Object.assign(task, patch)
      return task
    },
  }
}

test('服务重启后可恢复任务重新排队，并保留阶段检查点', async () => {
  const task = recoverableTask({
    meta: {
      project_id: 5,
      recovery: { kind: 'auto-produce', mode: 'safe-auto', attempts: 0, max_attempts: 3 },
      workflow: { current_stage: 'image', stages: { script: { status: 'succeeded' } } },
    },
  })
  const updates: Array<Partial<RecoverableTask>> = []
  const manager = managerFor(task)
  const originalUpdate = manager.update
  manager.update = (id, patch) => {
    updates.push(patch)
    return originalUpdate(id, patch)
  }
  const resumed: RecoverableTask[] = []
  const result = await recoverTasks({
    taskManager: manager,
    runners: { 'auto-produce': (restored) => { resumed.push(restored) } },
  })

  assert.equal(result.resumed, 1)
  assert.equal(task.status, 'waiting')
  const recovery = task.meta.recovery as Record<string, unknown>
  const workflow = task.meta.workflow as Record<string, unknown>
  assert.equal(recovery.attempts, 1)
  assert.equal(workflow.current_stage, 'image')
  assert.equal(resumed[0]?.id, 'task-1')
  assert.match(String(updates[0]?.message), /恢复/)
})

test('未明确声明安全自动恢复的云任务进入 orphaned，避免重启后重复计费提交', async () => {
  const task = recoverableTask({
    id: 'task-cloud-1',
    meta: {
      project_id: 7,
      providers: { script: 'deepseek', image: 'openai-image', video: 'kling' },
      recovery: { kind: 'auto-produce', mode: 'manual-reconcile', attempts: 0, max_attempts: 3 },
      workflow: { current_stage: 'image', stages: { script: { status: 'succeeded' } } },
    },
  })
  let runnerCalls = 0
  const result = await recoverTasks({
    taskManager: managerFor(task),
    runners: { 'auto-produce': () => { runnerCalls += 1 } },
  })

  assert.equal(result.orphaned, 1)
  assert.equal(result.resumed, 0)
  assert.equal(runnerCalls, 0)
  assert.equal(task.status, 'orphaned')
  assert.equal(task.error, 'RECOVERY_OUTCOME_UNCERTAIN')
  const workflow = task.meta.workflow as Record<string, unknown>
  const recovery = task.meta.recovery as Record<string, unknown>
  assert.equal(workflow.current_stage, 'image')
  assert.equal(recovery.attempts, 0)
})

test('已有 Provider task ID 时只对账，不调用恢复 runner 或 submit', async () => {
  const task = recoverableTask({
    type: 'video-generation',
    provider: 'fake-video',
    provider_task_id: 'remote-42',
  })
  let submitCalls = 0
  let runnerCalls = 0
  const adapter: ProviderAdapter = {
    provider: 'fake-video',
    modality: 'video',
    async submit() { submitCalls += 1; return { status: 'submitted' } },
    async reconcile() { return { status: 'running' } },
  }

  const result = await recoverTasks({
    taskManager: managerFor(task),
    getAdapter: () => adapter,
    runners: { 'video-generation': () => { runnerCalls += 1 } },
  })

  assert.equal(result.reconciled, 1)
  assert.equal(task.status, 'running')
  assert.equal(submitCalls, 0)
  assert.equal(runnerCalls, 0)
})

test('超过恢复上限的任务进入失败终态并给出诊断', async () => {
  const task = recoverableTask({
    id: 'task-2',
    progress: 20,
    meta: { recovery: { kind: 'auto-produce', mode: 'safe-auto', attempts: 3, max_attempts: 3 } },
  })
  const result = await recoverTasks({ taskManager: managerFor(task), runners: {} })
  assert.equal(result.failed, 1)
  assert.equal(task.status, 'failed')
  assert.match(String(task.error), /恢复次数上限/)
})
