function parseDbTimeMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const sqliteUtc = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (sqliteUtc) {
    const [, y, mo, d, h, mi, sec = '0'] = sqliteUtc;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function attachTimeMs(row) {
  if (!row) return row;
  return {
    ...row,
    created_at_ms: parseDbTimeMs(row.created_at),
    updated_at_ms: parseDbTimeMs(row.updated_at),
  };
}

module.exports = { parseDbTimeMs, attachTimeMs };
