/**
 * 服务重启后的任务恢复协调器。
 *
 * 安全原则：只对明确声明 safe-auto 的确定性本地/Demo 任务重新执行；
 * 只要任务已经拿到 Provider task ID，就查询 Provider，而不是重新提交。
 */
import type { ProviderAdapter } from '@aigc-video/contracts'

import { reconcileTask, type ReconcileTask, type TaskUpdate } from './taskReconciler'

type JsonObject = Record<string, unknown>

export interface RecoverableTask extends ReconcileTask {
  type: string
  meta: JsonObject
  error_details?: unknown
  diagnosis?: unknown
}

interface TaskManagerLike {
  list(): RecoverableTask[]
  update(id: string, patch: TaskUpdate & Partial<RecoverableTask>): RecoverableTask | null
}

type RecoveryRunner = (task: RecoverableTask) => Promise<unknown> | unknown

export interface RecoveryOptions {
  taskManager?: TaskManagerLike
  runners?: Record<string, RecoveryRunner>
  getAdapter?: (provider: string) => ProviderAdapter | undefined
  awaitRunners?: boolean
}

export interface RecoverySummary {
  scanned: number
  reconciled: number
  resumed: number
  orphaned: number
  failed: number
  skipped: number
}

export const RECOVERABLE_STATUSES = new Set(['pending', 'waiting', 'running', 'composing', 'interrupted'])

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function requiredUpdate(
  taskManager: TaskManagerLike,
  id: string,
  patch: TaskUpdate & Partial<RecoverableTask>,
): RecoverableTask {
  const updated = taskManager.update(id, patch)
  if (!updated) throw new Error(`恢复任务不存在：${id}`)
  return updated
}

export async function recoverTasks(options: RecoveryOptions = {}): Promise<RecoverySummary> {
  const { taskManager, runners = {}, getAdapter = () => undefined, awaitRunners = true } = options
  if (!taskManager || typeof taskManager.list !== 'function') throw new Error('taskManager 不可用')

  const summary: RecoverySummary = {
    scanned: 0,
    reconciled: 0,
    resumed: 0,
    orphaned: 0,
    failed: 0,
    skipped: 0,
  }
  const pending = taskManager.list().filter((task) => RECOVERABLE_STATUSES.has(task.status))
  const started: Promise<unknown>[] = []

  for (const task of pending) {
    summary.scanned += 1

    // Provider 已经受理过的任务只能查询，不允许在启动恢复中重新提交。
    if (task.provider_task_id || task.provider) {
      const reconciled = await reconcileTask(task, {
        getAdapter,
        updateTask: (id, patch) => requiredUpdate(taskManager, id, patch),
      })
      if (reconciled.status === 'orphaned') summary.orphaned += 1
      else summary.reconciled += 1
      continue
    }

    const recovery = asObject(task.meta.recovery)
    const kind = typeof recovery.kind === 'string' && recovery.kind ? recovery.kind : task.type
    const attempts = Number(recovery.attempts) || 0
    const maxAttempts = Math.max(1, Number(recovery.max_attempts) || 3)
    const runner = runners[kind]
    const safeAuto = recovery.mode === 'safe-auto' || task.meta.demo_mode === true

    if (!safeAuto) {
      const nextMeta = {
        ...task.meta,
        cancel_requested: false,
        recovery: {
          ...recovery,
          kind,
          mode: 'manual-reconcile',
          orphaned_at: Date.now(),
        },
      }
      requiredUpdate(taskManager, task.id, {
        status: 'orphaned',
        message: '服务重启后任务结果待核对，已阻止自动重复提交',
        error: 'RECOVERY_OUTCOME_UNCERTAIN',
        meta: nextMeta,
        diagnosis: {
          code: 'RECOVERY_OUTCOME_UNCERTAIN',
          title: '任务结果待核对',
          reason: '程序退出时 Provider 是否已受理任务无法可靠确认。',
          retryable: true,
          advice: ['先检查任务历史和已有媒体资产', '确认没有远端任务仍在运行后，再手动重试当前阶段'],
        },
      })
      summary.orphaned += 1
      continue
    }

    if (attempts >= maxAttempts) {
      requiredUpdate(taskManager, task.id, {
        status: 'failed',
        message: '任务自动恢复失败',
        error: `任务已达到自动恢复次数上限（${maxAttempts}）`,
      })
      summary.failed += 1
      continue
    }
    if (!runner) {
      requiredUpdate(taskManager, task.id, {
        status: 'interrupted',
        message: '任务已中断，当前版本没有可用的恢复执行器',
        error: 'RECOVERY_RUNNER_MISSING',
      })
      summary.skipped += 1
      continue
    }

    const nextMeta = {
      ...task.meta,
      cancel_requested: false,
      recovery: {
        ...recovery,
        kind,
        attempts: attempts + 1,
        max_attempts: maxAttempts,
        resumed_at: Date.now(),
      },
    }
    const restored = requiredUpdate(taskManager, task.id, {
      status: 'waiting',
      message: `服务重启后正在恢复任务（${attempts + 1}/${maxAttempts}）`,
      meta: nextMeta,
    })
    summary.resumed += 1
    const promise = Promise.resolve().then(() => runner(restored))
    if (awaitRunners) started.push(promise)
    else promise.catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      requiredUpdate(taskManager, task.id, {
        status: 'failed',
        message: '任务恢复执行失败',
        error: message,
      })
    })
  }

  if (started.length) await Promise.all(started)
  return summary
}
