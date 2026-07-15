type JsonObject = Record<string, unknown>

interface ProviderErrorOptions {
  provider?: string | null
  status?: number | null
  retryable?: boolean
  safeMessage?: string
  cause?: unknown
}

interface ProviderAttempt extends JsonObject {
  provider: string
  attempt: number
  ok: boolean
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function property(value: unknown, key: string): unknown {
  return isJsonObject(value) ? value[key] : undefined
}

export class ProviderError extends Error {
  readonly code: string
  readonly provider: string | null
  readonly status: number | null
  readonly retryable: boolean
  readonly safeMessage: string
  attempts?: ProviderAttempt[]

  constructor(code: string, message: string, options: ProviderErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ProviderError'
    this.code = code
    this.provider = options.provider || null
    this.status = options.status || null
    this.retryable = Boolean(options.retryable)
    this.safeMessage = options.safeMessage || message
  }

  toJSON(): JsonObject {
    return {
      name: this.name,
      code: this.code,
      provider: this.provider,
      status: this.status,
      retryable: this.retryable,
      message: this.safeMessage,
    }
  }
}

export function assertCredentials(provider: string, credentials: JsonObject = {}): true {
  const hasToken = Boolean(String(credentials.apiKey || '').trim())
  const hasPair = Boolean(String(credentials.accessKey || '').trim() && String(credentials.secretKey || '').trim())
  if (!hasToken && !hasPair) throw new ProviderError('MISSING_CREDENTIALS', `${provider} 未配置凭证`, { provider, retryable: false })
  return true
}

export function normalizeProviderError(error: unknown, provider: string): ProviderError {
  if (error instanceof ProviderError) return error
  const response = property(error, 'response')
  const status = Number(property(error, 'status') || property(error, 'statusCode') || property(response, 'status')) || null
  const rawMessage = property(error, 'message')
  const message = String(rawMessage || error || 'Provider 调用失败')
  const name = property(error, 'name')
  if (name === 'AbortError' || name === 'TimeoutError' || /timeout|timed out|超时|aborted/i.test(message)) {
    return new ProviderError('TIMEOUT', `${provider} 请求超时`, { provider, status, retryable: true, cause: error })
  }
  if (status === 429 || /rate.?limit|too many|限流/i.test(message)) {
    return new ProviderError('RATE_LIMITED', `${provider} 请求过于频繁`, { provider, status: status || 429, retryable: true, cause: error })
  }
  if (error instanceof SyntaxError || /invalid.*json|unexpected token|格式异常|解析失败/i.test(message)) {
    return new ProviderError('INVALID_RESPONSE', `${provider} 返回格式异常`, { provider, status, retryable: false, cause: error })
  }
  if (status && status >= 500) return new ProviderError('UPSTREAM_UNAVAILABLE', `${provider} 服务暂不可用`, { provider, status, retryable: true, cause: error })
  if (status === 401 || status === 403 || /unauthor|forbidden|鉴权|密钥/i.test(message)) {
    return new ProviderError('AUTH_FAILED', `${provider} 鉴权失败`, { provider, status, retryable: false, cause: error })
  }
  return new ProviderError('PROVIDER_FAILED', `${provider} 调用失败`, { provider, status, retryable: false, cause: error })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(factory: (signal?: AbortSignal) => Promise<T>, timeoutMs: number, provider: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return factory(undefined)
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      factory(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new ProviderError('TIMEOUT', `${provider} 请求超时`, { provider, retryable: true }))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface FallbackOptions<T extends JsonObject> {
  providers: string[]
  execute(provider: string, context: { signal?: AbortSignal; attempt: number }): Promise<T>
  validate?: (value: T) => boolean
  placeholder?: ((context: { attempts: ProviderAttempt[] }) => Promise<T>) | null
  retries?: number
  timeoutMs?: number
  retryDelayMs?: number
}

export async function executeWithFallback<T extends JsonObject>({
  providers,
  execute,
  validate = () => true,
  placeholder = null,
  retries = 1,
  timeoutMs = 60000,
  retryDelayMs = 50,
}: FallbackOptions<T>): Promise<T & { provider: string; downgraded: boolean; is_placeholder?: boolean; attempts: ProviderAttempt[] }> {
  if (!Array.isArray(providers) || providers.length === 0) throw new Error('providers 不能为空')
  const attempts: ProviderAttempt[] = []

  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const provider = providers[providerIndex]
    if (!provider) continue
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const value = await withTimeout((signal) => execute(provider, { signal, attempt: attempt + 1 }), timeoutMs, provider)
        if (!validate(value)) throw new ProviderError('INVALID_RESPONSE', `${provider} 返回格式异常`, { provider })
        attempts.push({ provider, attempt: attempt + 1, ok: true })
        return { ...value, provider: typeof value.provider === 'string' ? value.provider : provider, downgraded: providerIndex > 0, attempts }
      } catch (rawError: unknown) {
        const error = normalizeProviderError(rawError, provider)
        attempts.push({ provider, attempt: attempt + 1, ok: false, ...error.toJSON() })
        if (!error.retryable || attempt >= retries) break
        await sleep(retryDelayMs * (2 ** attempt))
      }
    }
  }

  if (placeholder) {
    const value = await placeholder({ attempts })
    return { ...value, provider: 'placeholder', downgraded: true, is_placeholder: true, attempts }
  }

  const error = new ProviderError('ALL_PROVIDERS_FAILED', '所有 Provider 均失败', { retryable: false })
  error.attempts = attempts
  throw error
}

export async function executeBatch<TInput, TResult>(inputs: TInput[], execute: (input: TInput) => Promise<TResult>) {
  const settled = await Promise.all(inputs.map(async (input) => {
    try { return { ok: true as const, input, value: await execute(input) } }
    catch (error: unknown) { return { ok: false as const, input, error: normalizeProviderError(error, 'batch') } }
  }))
  const successes = settled.filter((item) => item.ok)
  const failures = settled.filter((item) => !item.ok)
  return {
    status: failures.length === 0 ? 'success' as const : successes.length === 0 ? 'failed' as const : 'partial' as const,
    successes,
    failures,
  }
}
