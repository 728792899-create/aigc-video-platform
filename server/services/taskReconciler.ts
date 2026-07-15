import type {
  AppErrorPayload,
  ProviderAdapter,
  ProviderReconciliation,
  TaskStatus,
} from '@aigc-video/contracts'

import { normalizeAppError } from './appError'

export interface ReconcileTask {
  id: string
  status: TaskStatus | 'waiting' | 'composing'
  message: string
  progress: number
  provider?: string | null
  provider_task_id?: string | null
  attempt?: number
  idempotency_key?: string | null
  correlation_id?: string | null
  retryable?: boolean
  cancel_state?: 'none' | 'requested' | 'confirmed' | 'local_only'
  result: unknown
  error?: string | AppErrorPayload | null
  finished_at?: number | null
}

export type TaskUpdate = Partial<ReconcileTask>

export interface TaskReconcileDependencies<TTask extends ReconcileTask> {
  getAdapter(provider: string): ProviderAdapter | undefined
  updateTask(id: string, patch: TaskUpdate): TTask
  now?: () => number
}

function orphan<TTask extends ReconcileTask>(
  task: TTask,
  deps: TaskReconcileDependencies<TTask>,
  message: string,
): TTask {
  return deps.updateTask(task.id, {
    status: 'orphaned',
    message,
    retryable: true,
    finished_at: (deps.now || Date.now)(),
  })
}

function applyReconciliation(
  task: ReconcileTask,
  reconciliation: ProviderReconciliation,
  deps: TaskReconcileDependencies<ReconcileTask>,
): ReconcileTask {
  const now = (deps.now || Date.now)()
  switch (reconciliation.status) {
    case 'running':
      return deps.updateTask(task.id, {
        status: 'running',
        message: '已与 Provider 对账，任务仍在运行',
        retryable: false,
      })
    case 'succeeded':
      return deps.updateTask(task.id, {
        status: 'success',
        progress: 100,
        message: 'Provider 任务已完成',
        result: reconciliation.result ?? null,
        retryable: false,
        finished_at: now,
      })
    case 'failed': {
      const error = reconciliation.error || normalizeAppError(new Error('Provider 任务失败'), {
        taskId: task.id,
        correlationId: task.correlation_id || undefined,
        fallbackCode: 'PROVIDER_TASK_FAILED',
      })
      return deps.updateTask(task.id, {
        status: 'failed',
        message: error.userMessage,
        error,
        retryable: error.retryable,
        finished_at: now,
      })
    }
    case 'canceled':
      return deps.updateTask(task.id, {
        status: 'canceled',
        message: 'Provider 已确认取消任务',
        cancel_state: 'confirmed',
        retryable: false,
        finished_at: now,
      })
    case 'unknown':
      return orphan(task, deps, 'Provider 无法确认任务状态，已保留原任务供人工诊断')
  }
}

export async function reconcileTask(
  task: ReconcileTask,
  deps: TaskReconcileDependencies<ReconcileTask>,
): Promise<ReconcileTask> {
  if (!task.provider_task_id) {
    return orphan(task, deps, '缺少 Provider task ID，禁止自动重新提交以避免重复计费')
  }
  if (!task.provider) {
    return orphan(task, deps, '缺少 Provider 标识，无法安全对账')
  }
  const adapter = deps.getAdapter(task.provider)
  if (!adapter?.reconcile) {
    return orphan(task, deps, '当前 Provider 不支持任务对账，已保留原任务供人工处理')
  }

  try {
    const reconciliation = await adapter.reconcile(task.provider_task_id, {
      correlationId: task.correlation_id || `reconcile-${task.id}`,
      idempotencyKey: task.idempotency_key || `reconcile-${task.id}-${task.attempt || 1}`,
    })
    return applyReconciliation(task, reconciliation, deps)
  } catch (cause) {
    const error = normalizeAppError(cause, {
      taskId: task.id,
      correlationId: task.correlation_id || undefined,
    })
    return deps.updateTask(task.id, {
      status: 'orphaned',
      message: `${error.userMessage}；未重新提交原任务`,
      error,
      retryable: error.retryable,
      finished_at: (deps.now || Date.now)(),
    })
  }
}

export async function reconcileTasks(
  tasks: ReconcileTask[],
  deps: TaskReconcileDependencies<ReconcileTask>,
): Promise<ReconcileTask[]> {
  const results: ReconcileTask[] = []
  for (const task of tasks) results.push(await reconcileTask(task, deps))
  return results
}
