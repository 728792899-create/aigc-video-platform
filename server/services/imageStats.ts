import { getDb, type SqlRow } from '../db'

export interface ImageGenerationStat {
  projectId?: unknown
  storyboardId?: unknown
  requestedModel?: unknown
  firstModel?: unknown
  firstAttemptOk?: boolean
  finalOk?: boolean
  usedPlaceholder?: boolean
  downgraded?: boolean
  attemptsCount?: unknown
  finalProvider?: unknown
  source?: unknown
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function record(stat: ImageGenerationStat = {}): void {
  try {
    getDb().prepare(`INSERT INTO image_gen_stats
      (project_id, storyboard_id, requested_model, first_model, first_attempt_ok,
       final_ok, used_placeholder, downgraded, attempts_count, final_provider, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      stat.projectId ?? null,
      stat.storyboardId ?? null,
      String(stat.requestedModel || ''),
      String(stat.firstModel || ''),
      stat.firstAttemptOk ? 1 : 0,
      stat.finalOk ? 1 : 0,
      stat.usedPlaceholder ? 1 : 0,
      stat.downgraded ? 1 : 0,
      Number(stat.attemptsCount) || 0,
      String(stat.finalProvider || ''),
      String(stat.source || 'manual'),
      Date.now(),
    )
  } catch (cause) {
    console.warn('[imageStats] 记录失败:', errorMessage(cause))
  }
}

function percent(value: unknown, denominator: number): number {
  return denominator ? Math.round(((Number(value) || 0) / denominator) * 1_000) / 10 : 0
}

export function summary(): Record<string, unknown> {
  const db = getDb()
  const row: SqlRow = db.prepare(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(first_attempt_ok), 0) AS first_ok,
      COALESCE(SUM(final_ok), 0) AS final_ok,
      COALESCE(SUM(used_placeholder), 0) AS placeholder
    FROM image_gen_stats`).get() || {}
  const total = Number(row.total) || 0
  const byModel = db.prepare(`SELECT
      first_model, COUNT(*) AS n,
      COALESCE(SUM(first_attempt_ok), 0) AS first_ok,
      COALESCE(SUM(final_ok), 0) AS final_ok
    FROM image_gen_stats GROUP BY first_model ORDER BY n DESC, first_model ASC`).all()
  const byProvider = db.prepare(`SELECT
      final_provider, COUNT(*) AS n, COALESCE(SUM(final_ok), 0) AS final_ok
    FROM image_gen_stats GROUP BY final_provider ORDER BY n DESC, final_provider ASC`).all()

  return {
    total,
    first_attempt_success: Number(row.first_ok) || 0,
    first_attempt_rate: percent(row.first_ok, total),
    final_real_success: Number(row.final_ok) || 0,
    final_real_rate: percent(row.final_ok, total),
    placeholder_count: Number(row.placeholder) || 0,
    placeholder_rate: percent(row.placeholder, total),
    by_model: byModel.map((item) => {
      const attempts = Number(item.n) || 0
      return {
        model: item.first_model || '(未知)',
        attempts,
        first_ok: Number(item.first_ok) || 0,
        first_attempt_rate: percent(item.first_ok, attempts),
        final_ok: Number(item.final_ok) || 0,
        final_real_rate: percent(item.final_ok, attempts),
      }
    }),
    by_provider: byProvider.map((item) => {
      const attempts = Number(item.n) || 0
      return {
        provider: item.final_provider || '(未知)',
        attempts,
        final_ok: Number(item.final_ok) || 0,
        final_real_rate: percent(item.final_ok, attempts),
      }
    }),
  }
}
