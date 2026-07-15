import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'

function sameToken(given: unknown, expected: unknown): boolean {
  const left = Buffer.from(String(given || ''))
  const right = Buffer.from(String(expected || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * 可选 API Token 鉴权。
 * - 未配置 API_TOKEN：维持本地单机模式原行为；
 * - 配置后：仅保护 /api/*，健康检查、静态资源与浏览器预检继续放行；
 * - 支持 Authorization: Bearer <token> 与 X-API-Token。
 */
export const optionalAuth: RequestHandler = (req, res, next) => {
  const token = process.env.API_TOKEN
  if (!token || req.method === 'OPTIONS') {
    next()
    return
  }
  if (!req.path.startsWith('/api/')) {
    next()
    return
  }
  if (req.path === '/api/health' || req.path.startsWith('/api/health/')) {
    next()
    return
  }

  const authorization = String(req.headers.authorization || '')
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const given = bearer || req.headers['x-api-token'] || ''
  if (sameToken(given, token)) {
    next()
    return
  }

  res.status(401).json({
    code: 401,
    data: null,
    message: '未授权：缺少或错误的 API Token',
  })
}
