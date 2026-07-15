import type { RequestHandler } from 'express'

/** 安全响应头：防 MIME 嗅探、点击劫持、引用泄露并限制页面能力。 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
  )
  res.removeHeader('X-Powered-By')
  next()
}

export interface RateLimitOptions {
  windowMs?: number
  max?: number
  message?: string
}

/** 单进程滑动窗口限流器，用于保护高成本生成接口。 */
export function rateLimit({
  windowMs = 60_000,
  max = 30,
  message = '请求过于频繁，请稍后再试',
}: RateLimitOptions = {}): RequestHandler {
  const hits = new Map<string, number[]>()
  setInterval(() => {
    const now = Date.now()
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((timestamp) => now - timestamp < windowMs)
      if (fresh.length) hits.set(key, fresh)
      else hits.delete(key)
    }
  }, windowMs).unref()

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const timestamps = (hits.get(ip) || []).filter((timestamp) => now - timestamp < windowMs)
    if (timestamps.length >= max) {
      const oldest = timestamps[0] ?? now
      const retryAfter = Math.ceil((windowMs - (now - oldest)) / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      res.status(429).json({ code: 429, data: null, message })
      return
    }
    timestamps.push(now)
    hits.set(ip, timestamps)
    next()
  }
}
