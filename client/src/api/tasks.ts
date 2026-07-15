import {
  GenerationTaskSchema,
  type ApiEnvelope,
  type GenerationTask,
  type TaskStatus,
} from '@aigc-video/contracts'

import api, { AigcClientError, unwrap } from './index'
import { API_URL } from './config'

export interface TaskHandlers {
  onProgress?(task: GenerationTask): void
  onSuccess?(task: GenerationTask): void
  onError?(error: TaskClientError): void
}

export class TaskClientError extends AigcClientError {
  readonly task?: GenerationTask
  readonly diagnosis?: unknown

  constructor(message: string, task?: GenerationTask, cause?: unknown) {
    const structured = task?.error_details
    super(message, {
      code: structured?.code || 'TASK_FAILED',
      retryable: structured?.retryable ?? task?.retryable ?? false,
      details: structured || undefined,
      cause,
    })
    this.name = 'TaskClientError'
    this.task = task
    this.diagnosis = task?.meta?.diagnosis
      || (task?.result && typeof task.result === 'object' && 'diagnosis' in task.result ? task.result.diagnosis : undefined)
  }
}

const TERMINAL = new Set<TaskStatus>(['success', 'failed', 'partial', 'timed_out', 'interrupted', 'orphaned', 'canceled'])
const ERROR_STATUSES = new Set<TaskStatus>(['failed', 'partial', 'timed_out', 'interrupted', 'orphaned', 'canceled'])

function taskError(task: GenerationTask): TaskClientError {
  const legacyMessage = typeof task.error === 'string' ? task.error : task.error?.userMessage
  return new TaskClientError(legacyMessage || task.message || '任务失败', task)
}

function parseTask(value: unknown): GenerationTask {
  const parsed = GenerationTaskSchema.safeParse(value)
  if (!parsed.success) throw new TaskClientError('任务状态格式异常，已停止自动操作', undefined, parsed.error)
  return parsed.data
}

export function trackTask(taskId: string, handlers: TaskHandlers = {}): () => void {
  let stopped = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  const dispatch = (task: GenerationTask): boolean => {
    handlers.onProgress?.(task)
    if (task.status === 'success') {
      handlers.onSuccess?.(task)
      return true
    }
    if (ERROR_STATUSES.has(task.status)) {
      handlers.onError?.(taskError(task))
      return true
    }
    return false
  }

  const startPolling = () => {
    const poll = async () => {
      if (stopped) return
      try {
        const response = await api.get<ApiEnvelope<GenerationTask>>(`/tasks/${encodeURIComponent(taskId)}`)
        const task = parseTask(unwrap(response))
        if (!dispatch(task) && !TERMINAL.has(task.status)) pollTimer = setTimeout(poll, 1_500)
      } catch (cause) {
        handlers.onError?.(cause instanceof TaskClientError
          ? cause
          : new TaskClientError(cause instanceof Error ? cause.message : String(cause), undefined, cause))
      }
    }
    void poll()
  }

  if (typeof EventSource !== 'undefined') {
    const eventSource = new EventSource(`${API_URL}/tasks/${encodeURIComponent(taskId)}/stream`)
    eventSource.onmessage = (event) => {
      if (stopped) return
      try {
        const task = parseTask(JSON.parse(event.data))
        if (dispatch(task)) eventSource.close()
      } catch (cause) {
        eventSource.close()
        handlers.onError?.(cause instanceof TaskClientError
          ? cause
          : new TaskClientError('任务事件格式异常', undefined, cause))
      }
    }
    eventSource.onerror = () => {
      eventSource.close()
      if (!stopped) startPolling()
    }
    return () => {
      stopped = true
      eventSource.close()
      if (pollTimer) clearTimeout(pollTimer)
    }
  }

  startPolling()
  return () => {
    stopped = true
    if (pollTimer) clearTimeout(pollTimer)
  }
}

export async function retryFailedTask(
  taskId: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return unwrap(await api.post<ApiEnvelope<Record<string, unknown>>>(
    `/tasks/${encodeURIComponent(taskId)}/retry-failed`,
    payload,
  ))
}
