/**
 * 安全与限流中间件（零外部依赖，生产级基础加固）
 *
 *  - securityHeaders: 设置常见安全响应头（等价 helmet 的核心子集），
 *    防点击劫持、MIME 嗅探、引用泄露等；本地 SPA 友好（不启用过严 CSP）。
 *  - rateLimit(opts): 纯内存滑动窗口限流，按 IP+路径前缀计数，
 *    用于保护 AI 生成类高成本接口被刷。单实例够用（本项目单进程 PM2）。
 */

function securityHeaders(req, res, next) {
  // 禁止浏览器 MIME 嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // 防点击劫持
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // 引用策略：跨域只发送来源，不泄露完整路径
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // 关闭部分浏览器特性以减小攻击面
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // 隐藏 Express 指纹
  res.removeHeader('X-Powered-By');
  next();
}

// 限流器工厂：windowMs 时间窗内最多 max 次，超出返回 429
function rateLimit({ windowMs = 60000, max = 30, message = '请求过于频繁，请稍后再试' } = {}) {
  const hits = new Map(); // key -> [timestamps]
  // 周期清理过期 key，避免内存泄漏
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of hits) {
      const fresh = arr.filter(t => now - t < windowMs);
      if (fresh.length) hits.set(k, fresh); else hits.delete(k);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `${ip}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ code: 429, data: null, message });
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

module.exports = { securityHeaders, rateLimit };
