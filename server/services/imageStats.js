/**
 * 图片生成结果统计。
 *
 * 口径：
 * - first_attempt_ok：模型链第一个目标未经降级直接成功；
 * - final_ok：最终拿到真实生成图，占位图不算成功；
 * - 每次实际调用 imageGen.generate() 最多记录一条，缓存复用不重复计数。
 */
const { getDb } = require('../db');

function record(stat = {}) {
  try {
    getDb().prepare(`INSERT INTO image_gen_stats
      (project_id, storyboard_id, requested_model, first_model, first_attempt_ok,
       final_ok, used_placeholder, downgraded, attempts_count, final_provider, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        stat.projectId ?? null,
        stat.storyboardId ?? null,
        stat.requestedModel || '',
        stat.firstModel || '',
        stat.firstAttemptOk ? 1 : 0,
        stat.finalOk ? 1 : 0,
        stat.usedPlaceholder ? 1 : 0,
        stat.downgraded ? 1 : 0,
        stat.attemptsCount || 0,
        stat.finalProvider || '',
        stat.source || 'manual',
        Date.now()
      );
  } catch (e) {
    // 埋点失败不能阻断用户的生成链路。
    console.warn('[imageStats] 记录失败:', e.message);
  }
}

function summary() {
  const db = getDb();
  const row = db.prepare(`SELECT
      COUNT(*) AS total,
      COALESCE(SUM(first_attempt_ok), 0) AS first_ok,
      COALESCE(SUM(final_ok), 0) AS final_ok,
      COALESCE(SUM(used_placeholder), 0) AS placeholder
    FROM image_gen_stats`).get() || {};
  const total = Number(row.total) || 0;
  const pct = (value, denominator = total) => denominator
    ? Math.round(((Number(value) || 0) / denominator) * 1000) / 10
    : 0;
  const byModel = db.prepare(`SELECT
      first_model,
      COUNT(*) AS n,
      COALESCE(SUM(first_attempt_ok), 0) AS first_ok,
      COALESCE(SUM(final_ok), 0) AS final_ok
    FROM image_gen_stats
    GROUP BY first_model
    ORDER BY n DESC, first_model ASC`).all();
  const byProvider = db.prepare(`SELECT
      final_provider,
      COUNT(*) AS n,
      COALESCE(SUM(final_ok), 0) AS final_ok
    FROM image_gen_stats
    GROUP BY final_provider
    ORDER BY n DESC, final_provider ASC`).all();

  return {
    total,
    first_attempt_success: Number(row.first_ok) || 0,
    first_attempt_rate: pct(row.first_ok),
    final_real_success: Number(row.final_ok) || 0,
    final_real_rate: pct(row.final_ok),
    placeholder_count: Number(row.placeholder) || 0,
    placeholder_rate: pct(row.placeholder),
    by_model: byModel.map((item) => ({
      model: item.first_model || '(未知)',
      attempts: Number(item.n) || 0,
      first_ok: Number(item.first_ok) || 0,
      first_attempt_rate: pct(item.first_ok, Number(item.n) || 0),
      final_ok: Number(item.final_ok) || 0,
      final_real_rate: pct(item.final_ok, Number(item.n) || 0),
    })),
    by_provider: byProvider.map((item) => ({
      provider: item.final_provider || '(未知)',
      attempts: Number(item.n) || 0,
      final_ok: Number(item.final_ok) || 0,
      final_real_rate: pct(item.final_ok, Number(item.n) || 0),
    })),
  };
}

module.exports = { record, summary };
