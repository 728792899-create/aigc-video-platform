'use strict';

class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
    this.code = code;
    this.provider = options.provider || null;
    this.status = options.status || null;
    this.retryable = Boolean(options.retryable);
    this.safeMessage = options.safeMessage || message;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      provider: this.provider,
      status: this.status,
      retryable: this.retryable,
      message: this.safeMessage,
    };
  }
}

function assertCredentials(provider, credentials = {}) {
  const hasToken = Boolean(String(credentials.apiKey || '').trim());
  const hasPair = Boolean(String(credentials.accessKey || '').trim() && String(credentials.secretKey || '').trim());
  if (!hasToken && !hasPair) {
    throw new ProviderError('MISSING_CREDENTIALS', `${provider} 未配置凭证`, {
      provider,
      retryable: false,
    });
  }
  return true;
}

function normalizeProviderError(error, provider) {
  if (error instanceof ProviderError) return error;
  const status = Number(error?.status || error?.statusCode || error?.response?.status) || null;
  const message = String(error?.message || error || 'Provider 调用失败');
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || /timeout|timed out|超时|aborted/i.test(message)) {
    return new ProviderError('TIMEOUT', `${provider} 请求超时`, { provider, status, retryable: true, cause: error });
  }
  if (status === 429 || /rate.?limit|too many|限流/i.test(message)) {
    return new ProviderError('RATE_LIMITED', `${provider} 请求过于频繁`, { provider, status: status || 429, retryable: true, cause: error });
  }
  if (error instanceof SyntaxError || /invalid.*json|unexpected token|格式异常|解析失败/i.test(message)) {
    return new ProviderError('INVALID_RESPONSE', `${provider} 返回格式异常`, { provider, status, retryable: false, cause: error });
  }
  if (status && status >= 500) {
    return new ProviderError('UPSTREAM_UNAVAILABLE', `${provider} 服务暂不可用`, { provider, status, retryable: true, cause: error });
  }
  if (status === 401 || status === 403 || /unauthor|forbidden|鉴权|密钥/i.test(message)) {
    return new ProviderError('AUTH_FAILED', `${provider} 鉴权失败`, { provider, status, retryable: false, cause: error });
  }
  return new ProviderError('PROVIDER_FAILED', `${provider} 调用失败`, { provider, status, retryable: false, cause: error });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(factory, timeoutMs, provider) {
  if (!timeoutMs || timeoutMs <= 0) return factory(undefined);
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      factory(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderError('TIMEOUT', `${provider} 请求超时`, { provider, retryable: true }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function executeWithFallback({
  providers,
  execute,
  validate = () => true,
  placeholder = null,
  retries = 1,
  timeoutMs = 60000,
  retryDelayMs = 50,
} = {}) {
  if (!Array.isArray(providers) || providers.length === 0) throw new Error('providers 不能为空');
  if (typeof execute !== 'function') throw new Error('execute 必须是函数');
  const attempts = [];

  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const provider = providers[providerIndex];
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const value = await withTimeout(
          (signal) => execute(provider, { signal, attempt: attempt + 1 }),
          timeoutMs,
          provider,
        );
        if (!validate(value)) throw new ProviderError('INVALID_RESPONSE', `${provider} 返回格式异常`, { provider });
        attempts.push({ provider, attempt: attempt + 1, ok: true });
        return {
          ...value,
          provider: value?.provider || provider,
          downgraded: providerIndex > 0,
          attempts,
        };
      } catch (rawError) {
        const error = normalizeProviderError(rawError, provider);
        attempts.push({ provider, attempt: attempt + 1, ok: false, ...error.toJSON() });
        if (!error.retryable || attempt >= retries) break;
        await sleep(retryDelayMs * (2 ** attempt));
      }
    }
  }

  if (typeof placeholder === 'function') {
    const value = await placeholder({ attempts });
    return {
      ...value,
      provider: 'placeholder',
      downgraded: true,
      is_placeholder: true,
      attempts,
    };
  }

  const error = new ProviderError('ALL_PROVIDERS_FAILED', '所有 Provider 均失败', { retryable: false });
  error.attempts = attempts;
  throw error;
}

async function executeBatch(inputs, execute) {
  const settled = await Promise.all(inputs.map(async (input) => {
    try {
      return { ok: true, input, value: await execute(input) };
    } catch (error) {
      return { ok: false, input, error: normalizeProviderError(error, 'batch') };
    }
  }));
  const successes = settled.filter((item) => item.ok);
  const failures = settled.filter((item) => !item.ok);
  return {
    status: failures.length === 0 ? 'success' : successes.length === 0 ? 'failed' : 'partial',
    successes,
    failures,
  };
}

module.exports = {
  ProviderError,
  assertCredentials,
  normalizeProviderError,
  executeWithFallback,
  executeBatch,
};
