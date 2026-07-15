import type { AppErrorPayload } from '@aigc-video/contracts'

type ErrorContext = {
  taskId?: string
  correlationId?: string
  fallbackCode?: string
}

type ErrorLike = Record<string, unknown> & {
  message?: unknown
  name?: unknown
  code?: unknown
  status?: unknown
  statusCode?: unknown
  retryable?: unknown
  details?: unknown
}

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|key|token)-[A-Za-z0-9_-]{6,}\b/gi,
  /\b[A-Za-z0-9_-]*(?:api[_-]?key|secret|token)[A-Za-z0-9_-]*\s*[:=]\s*[^\s,;]+/gi,
]

function asErrorLike(value: unknown): ErrorLike {
  if (value && typeof value === 'object') return value as ErrorLike
  return { message: String(value ?? 'unknown error') }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numericStatus(error: ErrorLike): number | undefined {
  const value = error.status ?? error.statusCode
  const status = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(status) ? status : undefined
}

export function redactDiagnostic(value: unknown): string {
  let text = String(value ?? '')
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]')
  return text
    // Diagnostic payloads and logs must not disclose a user's name or the
    // remainder of their private home-directory layout. Preserve a trailing
    // stack line/column suffix so local debugging remains actionable.
    .replace(/\/Users\/[^/\s]+(?:\/[^\s:'"),]+)*/g, '[USER_PATH]')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s:'"),]+)*/g, '[USER_PATH]')
    .slice(0, 2000)
}

function classify(error: ErrorLike, status: number | undefined) {
  const code = optionalString(error.code)?.toUpperCase()
  const name = optionalString(error.name)?.toLowerCase()
  const message = optionalString(error.message) || 'unknown error'
  const normalizedMessage = message.toLowerCase()

  if (code === 'INVALID_RESPONSE' || code === 'PROVIDER_INVALID_RESPONSE') {
    return { code: 'PROVIDER_INVALID_RESPONSE', userMessage: '生成服务返回了无法识别的数据，可稍后重试', retryable: true }
  }
  if (name === 'aborterror' || code === 'ETIMEDOUT' || /timeout|timed out|超时/.test(normalizedMessage)) {
    return { code: 'PROVIDER_TIMEOUT', userMessage: '生成服务响应超时，请稍后重试', retryable: true }
  }
  if (status === 429 || code === 'RATE_LIMITED') {
    return { code: 'PROVIDER_RATE_LIMITED', userMessage: '生成服务当前请求过多，请稍后重试', retryable: true }
  }
  if (status === 401 || status === 403 || code === 'AUTH_FAILED') {
    return { code: 'PROVIDER_AUTH_FAILED', userMessage: 'Provider 凭据无效或权限不足，请检查设置', retryable: false }
  }
  if (status === 402 || /insufficient|balance|quota|余额|额度/.test(normalizedMessage)) {
    return { code: 'PROVIDER_BALANCE_INSUFFICIENT', userMessage: 'Provider 余额或额度不足，请检查账户', retryable: false }
  }
  if (code === 'CONTENT_REJECTED' || /content safety|moderation|内容安全|违规/.test(normalizedMessage)) {
    return { code: 'CONTENT_REJECTED', userMessage: '输入未通过内容安全检查，请修改后重试', retryable: false }
  }
  if ((status !== undefined && status >= 500) || code === 'ECONNRESET' || code === 'ECONNREFUSED') {
    return { code: 'PROVIDER_UNAVAILABLE', userMessage: '生成服务暂时不可用，请稍后重试', retryable: true }
  }
  if (code && /^[A-Z][A-Z0-9_]{2,80}$/.test(code)) {
    return {
      code,
      userMessage: optionalString(error.message) || '操作失败，请检查输入后重试',
      retryable: error.retryable === true,
    }
  }
  return { code: 'INTERNAL_ERROR', userMessage: '操作未完成，请查看任务诊断后重试', retryable: false }
}

export function normalizeAppError(value: unknown, context: ErrorContext = {}): AppErrorPayload {
  const error = asErrorLike(value)
  const status = numericStatus(error)
  const classification = classify(error, status)
  const fallbackCode = optionalString(context.fallbackCode)
  const details = error.details && typeof error.details === 'object'
    ? error.details as Record<string, unknown>
    : undefined
  return {
    code: fallbackCode || classification.code,
    userMessage: classification.userMessage,
    technicalMessage: redactDiagnostic(error.message),
    retryable: classification.retryable,
    ...(context.taskId ? { taskId: context.taskId } : {}),
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    ...(details ? { details } : {}),
    timestamp: Date.now(),
  }
}

export class AppError extends Error {
  readonly payload: AppErrorPayload

  constructor(payload: AppErrorPayload, options?: ErrorOptions) {
    super(payload.userMessage, options)
    this.name = 'AppError'
    this.payload = payload
  }
}

export function httpStatusForError(error: AppErrorPayload): number {
  if (error.code === 'PROVIDER_AUTH_FAILED') return 401
  if (error.code === 'PROVIDER_RATE_LIMITED') return 429
  if (error.code === 'PROVIDER_BALANCE_INSUFFICIENT') return 402
  if (error.code === 'CONTENT_REJECTED') return 422
  if (error.code === 'PROVIDER_TIMEOUT') return 504
  if (error.code === 'PROVIDER_UNAVAILABLE') return 503
  if (error.code === 'INTERNAL_ERROR') return 500
  return 400
}
