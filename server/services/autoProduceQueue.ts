import * as config from './config'
import { singletonTaskManager as taskManager, type TaskRecord } from './taskManager'

interface QueueItem {
  taskId: string
  runner: () => unknown | Promise<unknown>
}

export interface QueueStatus {
  status: 'running' | 'waiting'
  queue_position: number | null
}

export interface CancelResult {
  ok: boolean
  queued?: boolean
}

const queue: QueueItem[] = []
const running = new Set<string>()

function maxParallel(): number {
  const fromConfig = Number(config.get('autoProduce.maxParallel'))
  const fromEnvironment = Number(process.env.MAX_CONCURRENT_AUTO_PRODUCE)
  const value = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : (fromEnvironment || 2)
  return Math.max(1, Math.min(3, value))
}

export function queuePosition(taskId: string): number | null {
  const index = queue.findIndex((item) => item.taskId === taskId)
  return index >= 0 ? index + 1 : null
}

function refreshWaitingMeta(): void {
  queue.forEach((item, index) => {
    const task = taskManager.get(item.taskId)
    if (!task) return
    taskManager.update(item.taskId, {
      status: 'waiting',
      progress: 0,
      message: `已加入后台生成队列，前方还有 ${index} 个任务`,
      meta: { ...task.meta, queue_position: index + 1 },
    })
  })
}

export function enqueue(task: Pick<TaskRecord, 'id'>, runner: QueueItem['runner']): QueueStatus {
  const item = { taskId: task.id, runner }
  if (running.size < maxParallel()) {
    start(item)
    return { status: 'running', queue_position: null }
  }

  queue.push(item)
  const current = taskManager.get(task.id)
  taskManager.update(task.id, {
    status: 'waiting',
    progress: 0,
    message: `已加入后台生成队列，前方还有 ${queue.length - 1} 个任务`,
    meta: { ...(current?.meta || {}), queue_position: queue.length },
  })
  return { status: 'waiting', queue_position: queue.length }
}

function start(item: QueueItem): void {
  running.add(item.taskId)
  const task = taskManager.get(item.taskId)
  if (task) {
    taskManager.update(item.taskId, {
      status: 'running',
      progress: Math.max(1, task.progress || 0),
      message: task.message && task.message !== '任务已创建' ? task.message : '准备中...',
      meta: { ...task.meta, queue_position: null },
    })
  }

  Promise.resolve()
    .then(() => item.runner())
    .catch((cause: unknown) => {
      const current = taskManager.get(item.taskId)
      if (current && !['success', 'failed', 'partial', 'canceled'].includes(current.status)) {
        taskManager.fail(item.taskId, cause)
      }
    })
    .finally(() => {
      running.delete(item.taskId)
      startNext()
    })
}

function startNext(): void {
  while (running.size < maxParallel() && queue.length > 0) {
    const next = queue.shift()
    refreshWaitingMeta()
    if (next) start(next)
  }
}

export function cancel(taskId: string): CancelResult {
  const index = queue.findIndex((item) => item.taskId === taskId)
  if (index >= 0) {
    queue.splice(index, 1)
    taskManager.update(taskId, { status: 'canceled', progress: 0, message: '已取消排队任务' })
    refreshWaitingMeta()
    return { ok: true, queued: true }
  }

  const task = taskManager.get(taskId)
  if (task && running.has(taskId)) {
    taskManager.update(taskId, {
      meta: { ...task.meta, cancel_requested: true },
      message: '已收到取消请求，当前阶段结束后停止后续流程',
    })
    return { ok: true, queued: false }
  }
  return { ok: false }
}

export function stats(): { maxParallel: number; running: number; waiting: number } {
  return { maxParallel: maxParallel(), running: running.size, waiting: queue.length }
}
