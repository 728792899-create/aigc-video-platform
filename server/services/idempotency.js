/**
 * 幂等性中间件（In-Memory Idempotency）
 * ------------------------------------------------------------------
 * 约束依据：企业级 AI 约束文档 4.1 —— 涉及核心资产变更的接口必须实现幂等性，
 * 防止用户重复提交 / 网络重放导致重复消耗 AI 配额、生成重复项目。
 *
 * 适用场景：一键成片、生图等"提交即扣资源"的写接口。
 * 工作方式：
 *   1. 客户端在 Header `Idempotency-Key` 或 body.idempotencyKey 传入唯一 token（建议 UUID v4）。
 *   2. 首次请求：放行 handler，并缓存其 JSON 响应。
 *   3. TTL 内携带相同 key 的重复请求：直接回放首次的缓存响应，不再执行 handler。
 *   4. 缺少 key 时：放行但不做幂等保护（向后兼容旧前端，不破坏现有功能）。
 *
 * 单机桌面应用，进程内 Map 足够；若未来改 Web 多实例部署，替换为 Redis 即可。
 */

// key -> { status: 'pending'|'done', code, body, expireAt }
const store = new Map();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 分钟
const CLEANUP_INTERVAL_MS = 60 * 1000; // 每分钟清一次过期项

// 后台定时清理过期 key，避免内存无限增长。unref 防止阻止进程退出。
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expireAt <= now) store.delete(key);
  }
}, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

/**
 * 从请求中提取幂等 key（Header 优先，其次 body）。
 */
function extractKey(req) {
  const headerKey = req.get && req.get('Idempotency-Key');
  const bodyKey = req.body && req.body.idempotencyKey;
  const key = (headerKey || bodyKey || '').toString().trim();
  return key || null;
}

/**
 * 幂等中间件工厂。
 * @param {object} opts
 * @param {number} opts.ttlMs 缓存有效期（默认 5 分钟）
 * @returns {import('express').RequestHandler}
 */
function idempotency(opts = {}) {
  const ttlMs = opts.ttlMs || DEFAULT_TTL_MS;

  return function idempotencyMiddleware(req, res, next) {
    const key = extractKey(req);
    // 无 key：不做幂等保护，向后兼容放行
    if (!key) return next();

    const now = Date.now();
    const existing = store.get(key);

    if (existing && existing.expireAt > now) {
      if (existing.status === 'pending') {
        // 同一 key 的请求仍在处理中 —— 典型的"双击连发"。返回 409 让前端知道在途，避免并发副作用。
        return res.status(409).json({
          code: 409,
          data: null,
          message: '请求正在处理中，请勿重复提交',
        });
      }
      // 已完成：回放首次缓存的响应
      return res.status(existing.code || 200).json(existing.body);
    }

    // 首次请求：标记 pending，占位防并发
    store.set(key, { status: 'pending', code: 0, body: null, expireAt: now + ttlMs });

    // 劫持 res.json，在 handler 返回时缓存响应
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const code = res.statusCode || 200;
      // 仅缓存成功响应（2xx）；失败响应不缓存，允许用户用同 key 重试
      if (code >= 200 && code < 300) {
        store.set(key, { status: 'done', code, body, expireAt: Date.now() + ttlMs });
      } else {
        store.delete(key);
      }
      return originalJson(body);
    };

    // handler 异常时清掉占位，允许重试
    res.on('close', () => {
      const cur = store.get(key);
      if (cur && cur.status === 'pending') store.delete(key);
    });

    next();
  };
}

// 测试 / 调试用
function _peek(key) { return store.get(key); }
function _clear() { store.clear(); }

module.exports = idempotency;
module.exports.idempotency = idempotency;
module.exports._peek = _peek;
module.exports._clear = _clear;
