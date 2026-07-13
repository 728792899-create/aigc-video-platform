const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProviderError,
  assertCredentials,
  executeWithFallback,
  executeBatch,
  normalizeProviderError,
} = require('../services/providers/providerContract');

test('Provider 契约：无密钥在发起请求前失败', () => {
  assert.throws(
    () => assertCredentials('deepseek', { apiKey: '' }),
    (error) => error instanceof ProviderError && error.code === 'MISSING_CREDENTIALS',
  );
});

test('Provider 契约：超时、限流、异常格式被归一化为可诊断错误', () => {
  const timeout = normalizeProviderError(Object.assign(new Error('aborted'), { name: 'AbortError' }), 'demo');
  assert.equal(timeout.code, 'TIMEOUT');
  const limited = normalizeProviderError(Object.assign(new Error('too many'), { status: 429 }), 'demo');
  assert.equal(limited.code, 'RATE_LIMITED');
  const invalid = normalizeProviderError(new SyntaxError('Unexpected token'), 'demo');
  assert.equal(invalid.code, 'INVALID_RESPONSE');
  assert.equal(timeout.retryable, true);
  assert.equal(limited.retryable, true);
});

test('Provider 契约：主 Provider 失败时降级且不掩盖尝试记录', async () => {
  const result = await executeWithFallback({
    providers: ['primary', 'fallback'],
    execute: async (provider) => {
      if (provider === 'primary') throw Object.assign(new Error('busy'), { status: 503 });
      return { provider, url: '/uploads/demo.png' };
    },
    validate: (value) => Boolean(value?.url),
    retries: 0,
  });
  assert.equal(result.provider, 'fallback');
  assert.equal(result.downgraded, true);
  assert.deepEqual(result.attempts.map((item) => item.provider), ['primary', 'fallback']);
  assert.equal(result.attempts[0].code, 'UPSTREAM_UNAVAILABLE');
});

test('Provider 契约：全部失败时可产出明确标记的占位素材', async () => {
  const result = await executeWithFallback({
    providers: ['primary'],
    execute: async () => { throw new Error('broken'); },
    placeholder: async ({ attempts }) => ({ placeholder: true, attempts: attempts.length }),
    retries: 0,
  });
  assert.equal(result.placeholder, true);
  assert.equal(result.is_placeholder, true);
  assert.equal(result.attempts.length, 1);
});

test('Provider 契约：批任务保留成功项并报告部分失败', async () => {
  const result = await executeBatch([
    { id: 1, ok: true },
    { id: 2, ok: false },
    { id: 3, ok: true },
  ], async (item) => {
    if (!item.ok) throw Object.assign(new Error('rate limited'), { status: 429 });
    return { id: item.id };
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.successes.map((item) => item.input.id), [1, 3]);
  assert.equal(result.failures[0].error.code, 'RATE_LIMITED');
});
