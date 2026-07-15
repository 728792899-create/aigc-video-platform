/**
 * 持久任务管理器：内存投影用于实时通知，SQLite 是跨进程重启的 canonical state。
 * v7 将 Provider 对账、attempt lineage、取消语义和脱敏错误提升为一等字段。
 */
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import type { AppErrorPayload, MediaReference, TaskStatus } from '@aigc-video/contracts'

import workflowStateMachine = require('./workflowStateMachine')
import { normalizeAppError } from './appError'

type JsonObject = Record<string, unknown>

interface DbStatement {
  run(...params: unknown[]): unknown
  all(...params: unknown[]): DbRow[]
  get(...params: unknown[]): DbRow | undefined
}

interface DbLike {
  prepare(sql: string): DbStatement
}

interface DbRow extends JsonObject {
  id?: unknown
  type?: unknown
  status?: unknown
  progress?: unknown
  message?: unknown
  meta?: unknown
  result?: unknown
  error?: unknown
  created_at?: unknown
  updated_at?: unknown
}

export interface TaskRecord {
  id: string
  type: string
  status: TaskStatus | 'waiting' | 'composing'
  progress: number
  message: string
  meta: JsonObject
  result: unknown
  error: string | null
  error_details: AppErrorPayload | null
  diagnosis?: unknown
  provider: string | null
  model: string | null
  provider_task_id: string | null
  attempt: number
  parent_task_id: string | null
  idempotency_key: string | null
  retryable: boolean
  cancel_state: 'none' | 'requested' | 'confirmed' | 'local_only'
  input_snapshot: JsonObject | null
  media_snapshot: MediaReference[]
  correlation_id: string | null
  created_at: number
  started_at: number | null
  updated_at: number
  finished_at: number | null
  timeout_at: number | null
}

export type TaskPatch = Partial<Omit<TaskRecord, 'id' | 'created_at'>>

const TERMINAL_STATUSES = new Set<TaskRecord['status']>([
  'success', 'failed', 'interrupted', 'orphaned', 'partial', 'canceled',
])

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveInteger(value: unknown, fallback = 1): number {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return value as T
  try { return JSON.parse(String(value)) as T } catch { return fallback }
}

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function errorFromRow(value: unknown): { message: string | null; payload: AppErrorPayload | null } {
  const raw = stringOrNull(value)
  if (!raw) return { message: null, payload: null }
  const parsed = parseJson<unknown>(raw, null)
  if (parsed && typeof parsed === 'object' && 'code' in parsed && 'userMessage' in parsed) {
    const payload = parsed as AppErrorPayload
    return { message: payload.userMessage, payload }
  }
  return { message: raw, payload: null }
}

function normalizeTaskRow(row: DbRow): TaskRecord {
  const meta = parseJson<JsonObject>(row.meta, {})
  const persistedError = errorFromRow(row.error)
  const diagnosis = meta.diagnosis
  return {
    id: String(row.id || ''),
    type: String(row.type || 'unknown'),
    status: String(row.status || 'pending') as TaskRecord['status'],
    progress: Math.max(0, Math.min(100, Number(row.progress) || 0)),
    message: String(row.message || ''),
    meta,
    result: parseJson<unknown>(row.result, null),
    error: persistedError.message,
    error_details: persistedError.payload,
    ...(diagnosis !== undefined ? { diagnosis } : {}),
    provider: stringOrNull(row.provider ?? meta.provider),
    model: stringOrNull(row.model ?? meta.model),
    provider_task_id: stringOrNull(row.provider_task_id ?? meta.provider_task_id ?? meta.submit_id),
    attempt: positiveInteger(row.attempt ?? meta.attempt),
    parent_task_id: stringOrNull(row.parent_task_id ?? meta.parent_task_id ?? meta.retry_of),
    idempotency_key: stringOrNull(row.idempotency_key ?? meta.idempotency_key),
    retryable: Number(row.retryable) === 1 || meta.retryable === true,
    cancel_state: (stringOrNull(row.cancel_state) || 'none') as TaskRecord['cancel_state'],
    input_snapshot: parseJson<JsonObject | null>(row.input_snapshot, objectOrNull(meta.input_snapshot)),
    media_snapshot: parseJson<MediaReference[]>(row.media_snapshot, Array.isArray(meta.media_snapshot) ? meta.media_snapshot as MediaReference[] : []),
    correlation_id: stringOrNull(row.correlation_id ?? meta.correlation_id),
    created_at: Number(row.created_at) || Date.now(),
    started_at: numberOrNull(row.started_at),
    updated_at: Number(row.updated_at) || Date.now(),
    finished_at: numberOrNull(row.finished_at),
    timeout_at: numberOrNull(row.timeout_at),
  }
}

export class TaskManager extends EventEmitter {
  private readonly tasks = new Map<string, TaskRecord>()
  private db: DbLike | null = null

  constructor() {
    super()
    setInterval(() => this.cleanup(), 30 * 60 * 1000).unref()
  }

  private getDb(): DbLike | null {
    if (this.db) return this.db
    try {
      const store = require('../db') as { getDb(): DbLike }
      this.db = store.getDb()
      return this.db
    } catch {
      return null
    }
  }

  private persist(task: TaskRecord): void {
    const db = this.getDb()
    if (!db) return
    const meta = { ...task.meta, ...(task.diagnosis !== undefined ? { diagnosis: task.diagnosis } : {}) }
    try {
      db.prepare(`INSERT INTO tasks
        (id, type, status, progress, message, meta, result, error, created_at, updated_at,
         provider, model, provider_task_id, attempt, parent_task_id, idempotency_key, started_at, finished_at,
         timeout_at, retryable, cancel_state, input_snapshot, media_snapshot, correlation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status, progress=excluded.progress, message=excluded.message,
          meta=excluded.meta, result=excluded.result, error=excluded.error, updated_at=excluded.updated_at,
          provider=excluded.provider, model=excluded.model, provider_task_id=excluded.provider_task_id,
          attempt=excluded.attempt, parent_task_id=excluded.parent_task_id, idempotency_key=excluded.idempotency_key,
          started_at=excluded.started_at, finished_at=excluded.finished_at, timeout_at=excluded.timeout_at,
          retryable=excluded.retryable, cancel_state=excluded.cancel_state,
          input_snapshot=excluded.input_snapshot, media_snapshot=excluded.media_snapshot,
          correlation_id=excluded.correlation_id`).run(
        task.id, task.type, task.status, task.progress, task.message, JSON.stringify(meta),
        task.result !== null && task.result !== undefined ? JSON.stringify(task.result) : null,
        task.error_details ? JSON.stringify(task.error_details) : task.error,
        task.created_at, task.updated_at, task.provider, task.model, task.provider_task_id, task.attempt,
        task.parent_task_id, task.idempotency_key, task.started_at, task.finished_at, task.timeout_at,
        task.retryable ? 1 : 0, task.cancel_state,
        task.input_snapshot ? JSON.stringify(task.input_snapshot) : null,
        JSON.stringify(task.media_snapshot), task.correlation_id,
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.error('[taskManager] 持久化失败:', message)
    }
  }

  loadFromDb(): void {
    const db = this.getDb()
    if (!db) return
    try {
      const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200').all()
      for (const row of rows) {
        const task = normalizeTaskRow(row)
        this.tasks.set(task.id, task)
      }
      console.log(`[taskManager] 已从 DB 恢复 ${rows.length} 条历史任务`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.error('[taskManager] 从 DB 恢复任务失败:', message)
    }
  }

  ensureWorkflow(id: string, options: JsonObject = {}): unknown {
    const task = this.get(id)
    if (!task) return null
    const workflow = workflowStateMachine.normalizeWorkflow(task.meta.workflow, {
      projectId: options.projectId || task.meta.project_id,
      topic: options.topic || task.meta.theme,
    })
    this.update(id, { meta: { ...task.meta, workflow } })
    return workflow
  }

  transitionStage(id: string, event: JsonObject): unknown {
    const task = this.get(id)
    if (!task) return null
    const current = workflowStateMachine.normalizeWorkflow(task.meta.workflow, {
      projectId: task.meta.project_id,
      topic: task.meta.theme,
    })
    const workflow = workflowStateMachine.transition(current, event)
    this.update(id, { meta: { ...task.meta, workflow } })
    return workflow
  }

  create(type: string, meta: JsonObject = {}): TaskRecord {
    const timestamp = Date.now()
    const task: TaskRecord = {
      id: randomUUID(),
      type,
      status: 'pending',
      progress: 0,
      message: '任务已创建',
      meta,
      result: null,
      error: null,
      error_details: null,
      provider: stringOrNull(meta.provider),
      model: stringOrNull(meta.model),
      provider_task_id: stringOrNull(meta.provider_task_id ?? meta.submit_id),
      attempt: positiveInteger(meta.attempt),
      parent_task_id: stringOrNull(meta.parent_task_id ?? meta.retry_of),
      idempotency_key: stringOrNull(meta.idempotency_key),
      retryable: meta.retryable === true,
      cancel_state: 'none',
      input_snapshot: objectOrNull(meta.input_snapshot),
      media_snapshot: Array.isArray(meta.media_snapshot) ? meta.media_snapshot as MediaReference[] : [],
      correlation_id: stringOrNull(meta.correlation_id),
      created_at: timestamp,
      started_at: null,
      updated_at: timestamp,
      finished_at: null,
      timeout_at: numberOrNull(meta.timeout_at),
    }
    this.tasks.set(task.id, task)
    this.persist(task)
    this.emit('change', task)
    return task
  }

  update(id: string, patch: TaskPatch): TaskRecord | null {
    const task = this.tasks.get(id) || this.get(id)
    if (!task) return null
    const timestamp = Date.now()
    const nextPatch: TaskPatch = { ...patch, updated_at: timestamp }
    if (patch.status === 'running' && !task.started_at) nextPatch.started_at = timestamp
    if (patch.status && TERMINAL_STATUSES.has(patch.status) && !task.finished_at) nextPatch.finished_at = timestamp
    Object.assign(task, nextPatch)
    this.persist(task)
    this.emit('change', task)
    this.emit(`change:${id}`, task)
    return task
  }

  start(id: string, message = '任务开始'): TaskRecord | null {
    return this.update(id, { status: 'running', message, progress: 1 })
  }

  progress(id: string, progress: number, message?: string): TaskRecord | null {
    const patch: TaskPatch = { progress: Math.min(99, Math.max(0, Math.round(progress))) }
    if (message !== undefined) patch.message = message
    return this.update(id, patch)
  }

  succeed(id: string, result: unknown, message = '完成'): TaskRecord | null {
    return this.update(id, { status: 'success', progress: 100, message, result, retryable: false })
  }

  fail(id: string, cause: unknown): TaskRecord | null {
    const task = this.get(id)
    if (!task) return null
    const error = normalizeAppError(cause, {
      taskId: id,
      correlationId: task.correlation_id || undefined,
    })
    return this.update(id, {
      status: 'failed',
      message: error.userMessage,
      error: error.userMessage,
      error_details: error,
      retryable: error.retryable,
      diagnosis: cause && typeof cause === 'object' && 'diagnosis' in cause
        ? (cause as { diagnosis?: unknown }).diagnosis
        : null,
    })
  }

  partial(id: string, result: unknown, message = '部分完成'): TaskRecord | null {
    return this.update(id, { status: 'partial', progress: 100, message, result, retryable: true })
  }

  cancel(id: string, message = '已取消'): TaskRecord | null {
    return this.update(id, { status: 'canceled', message, cancel_state: 'local_only', retryable: false })
  }

  get(id: string): TaskRecord | undefined {
    const cached = this.tasks.get(id)
    if (cached) return cached
    const db = this.getDb()
    if (!db) return undefined
    try {
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
      if (!row) return undefined
      const task = normalizeTaskRow(row)
      this.tasks.set(id, task)
      return task
    } catch {
      return undefined
    }
  }

  list(filter: { type?: string; status?: string } = {}): TaskRecord[] {
    return Array.from(this.tasks.values()).filter((task) => {
      if (filter.type && task.type !== filter.type) return false
      if (filter.status && task.status !== filter.status) return false
      return true
    })
  }

  findByIdempotency(idempotencyKey: string, type?: string): TaskRecord | undefined {
    if (!idempotencyKey) return undefined
    const cached = Array.from(this.tasks.values())
      .filter((task) => task.idempotency_key === idempotencyKey && (!type || task.type === type))
      .sort((left, right) => right.created_at - left.created_at)[0]
    if (cached) return cached

    const db = this.getDb()
    if (!db) return undefined
    try {
      const row = type
        ? db.prepare('SELECT * FROM tasks WHERE idempotency_key = ? AND type = ? ORDER BY created_at DESC LIMIT 1').get(idempotencyKey, type)
        : db.prepare('SELECT * FROM tasks WHERE idempotency_key = ? ORDER BY created_at DESC LIMIT 1').get(idempotencyKey)
      if (!row) return undefined
      const task = normalizeTaskRow(row)
      this.tasks.set(task.id, task)
      return task
    } catch {
      return undefined
    }
  }

  forget(id: string): void {
    this.tasks.delete(id)
  }

  cleanup(): void {
    const timestamp = Date.now()
    const db = this.getDb()
    for (const [id, task] of this.tasks.entries()) {
      if (TERMINAL_STATUSES.has(task.status) && timestamp - task.updated_at > 30 * 60 * 1000) this.tasks.delete(id)
    }
    if (!db) return
    try {
      db.prepare(`DELETE FROM tasks WHERE id IN (
        SELECT id FROM tasks
        WHERE status IN ('success','failed','interrupted','orphaned','partial','canceled')
        ORDER BY created_at DESC LIMIT -1 OFFSET 1000
      )`).run()
    } catch (cause) {
      console.error('[taskManager] 历史封顶清理失败:', cause instanceof Error ? cause.message : String(cause))
    }
    try {
      db.prepare(`DELETE FROM op_logs WHERE id IN (
        SELECT id FROM op_logs ORDER BY created_at DESC LIMIT -1 OFFSET 2000
      )`).run()
    } catch (cause) {
      console.error('[taskManager] op_logs 封顶清理失败:', cause instanceof Error ? cause.message : String(cause))
    }
  }
}

const taskManager = new TaskManager()
export const singletonTaskManager = taskManager
module.exports = taskManager
module.exports.TaskManager = TaskManager
module.exports.singletonTaskManager = taskManager
