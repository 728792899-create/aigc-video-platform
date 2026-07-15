export function parseDbTimeMs(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value
  const text = String(value).trim()
  if (/^\d+$/.test(text)) return Number(text)

  const sqliteUtc = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (sqliteUtc) {
    const year = sqliteUtc[1]
    const month = sqliteUtc[2]
    const day = sqliteUtc[3]
    const hour = sqliteUtc[4]
    const minute = sqliteUtc[5]
    const second = sqliteUtc[6] ?? '0'
    if (year && month && day && hour && minute) {
      return Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      )
    }
  }

  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}

interface TimestampedRow {
  created_at?: unknown
  updated_at?: unknown
}

interface MillisecondTimestamps {
  created_at_ms: number | null
  updated_at_ms: number | null
}

export function attachTimeMs<T extends TimestampedRow>(row: T): T & MillisecondTimestamps
export function attachTimeMs<T extends null | undefined>(row: T): T
export function attachTimeMs<T extends TimestampedRow | null | undefined>(
  row: T,
): (T & MillisecondTimestamps) | T {
  if (!row) return row
  return {
    ...row,
    created_at_ms: parseDbTimeMs(row.created_at),
    updated_at_ms: parseDbTimeMs(row.updated_at),
  }
}
