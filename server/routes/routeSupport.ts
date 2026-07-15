import type { ParsedQs } from 'qs'

import type { SqlRow, SqlValue } from '../db'

export type JsonRecord = Record<string, unknown>

export interface RouteErrorDetails extends JsonRecord {
  code?: string
  status?: number
  retryable?: boolean
  technicalMessage?: string
}

export function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value))
}

export function asSqlRow(value: unknown): SqlRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const row: SqlRow = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      entry === null
      || typeof entry === 'string'
      || typeof entry === 'number'
      || entry instanceof Uint8Array
    ) {
      row[key] = entry
    }
  }
  return row
}

export function sqlText(value: SqlValue | unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function sqlNumber(value: SqlValue | unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const message = asRecord(error).message
  return typeof message === 'string' ? message : '未知错误'
}

export function errorDetails(error: unknown): RouteErrorDetails {
  const record = asRecord(error)
  return {
    ...record,
    code: typeof record.code === 'string' ? record.code : undefined,
    status: typeof record.status === 'number' ? record.status : undefined,
    retryable: typeof record.retryable === 'boolean' ? record.retryable : undefined,
    technicalMessage: errorMessage(error),
  }
}

export function queryText(
  value: string | ParsedQs | Array<string | ParsedQs> | undefined,
  fallback = '',
): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === 'string')
    return first ?? fallback
  }
  return fallback
}

export function pathText(value: string | string[] | undefined, fallback = ''): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? fallback
  return fallback
}

export function parseJsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return asRecord(value)
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return {}
  }
}
