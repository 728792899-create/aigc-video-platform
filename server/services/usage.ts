import fs from 'node:fs'
import path from 'node:path'

import { redactDiagnostic } from './appError'
import { SETTINGS_FILE } from './config'

interface UsageBucket {
  ok: number
  fail: number
  last_ms: number
  last_error: string
  last_at: number
}

export interface UsageSummary extends UsageBucket {
  total: number
  success_rate: number | null
}

const USAGE_FILE = path.join(path.dirname(SETTINGS_FILE), 'usage.json')
let stats: Record<string, UsageBucket> = {}
let dirty = false
let timer: NodeJS.Timeout | null = null

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function usageBucket(value: unknown): UsageBucket | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  return {
    ok: Math.max(0, Number(input.ok) || 0),
    fail: Math.max(0, Number(input.fail) || 0),
    last_ms: Math.max(0, Number(input.last_ms) || 0),
    last_error: redactDiagnostic(input.last_error).slice(0, 200),
    last_at: Math.max(0, Number(input.last_at) || 0),
  }
}

function load(): void {
  try {
    if (!fs.existsSync(USAGE_FILE)) return
    const parsed: unknown = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    stats = Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const bucket = usageBucket(value)
        return bucket ? [[key, bucket]] : []
      }),
    )
  } catch (cause) {
    console.error('[usage] 读取 usage.json 失败:', errorMessage(cause))
    stats = {}
  }
}

load()

function scheduleFlush(): void {
  dirty = true
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    if (!dirty) return
    dirty = false
    try {
      const directory = path.dirname(USAGE_FILE)
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true })
      const temporary = `${USAGE_FILE}.tmp`
      fs.writeFileSync(temporary, JSON.stringify(stats, null, 2), 'utf8')
      fs.renameSync(temporary, USAGE_FILE)
    } catch (cause) {
      console.error('[usage] 写入 usage.json 失败:', errorMessage(cause))
    }
  }, 1_000)
  timer.unref()
}

function bucket(kind: unknown, provider: unknown): UsageBucket {
  const key = `${kind || '?'}:${provider || '?'}`
  const current = stats[key]
  if (current) return current
  const created = { ok: 0, fail: 0, last_ms: 0, last_error: '', last_at: 0 }
  stats[key] = created
  return created
}

export function recordOk(kind: unknown, provider: unknown, milliseconds?: number): void {
  try {
    const current = bucket(kind, provider)
    current.ok += 1
    if (typeof milliseconds === 'number') current.last_ms = Math.round(milliseconds)
    current.last_at = Date.now()
    current.last_error = ''
    scheduleFlush()
  } catch { /* 旁路统计不得影响生成主流程 */ }
}

export function recordFail(kind: unknown, provider: unknown, cause: unknown, milliseconds?: number): void {
  try {
    const current = bucket(kind, provider)
    current.fail += 1
    if (typeof milliseconds === 'number') current.last_ms = Math.round(milliseconds)
    current.last_at = Date.now()
    current.last_error = redactDiagnostic(errorMessage(cause)).slice(0, 200)
    scheduleFlush()
  } catch { /* 旁路统计不得影响生成主流程 */ }
}

export async function track<T>(kind: unknown, provider: unknown, operation: () => T | Promise<T>): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await operation()
    recordOk(kind, provider, Date.now() - startedAt)
    return result
  } catch (cause) {
    recordFail(kind, provider, cause, Date.now() - startedAt)
    throw cause
  }
}

export function getAll(): Record<string, UsageSummary> {
  return Object.fromEntries(Object.entries(stats).map(([key, current]) => {
    const total = current.ok + current.fail
    return [key, {
      ...current,
      total,
      success_rate: total ? Number(((current.ok / total) * 100).toFixed(1)) : null,
    }]
  }))
}

export function reset(): void {
  stats = {}
  scheduleFlush()
}
