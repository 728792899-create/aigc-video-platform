'use strict';

const SECRET_FIELDS = new Set(['apiKey', 'accessKey', 'secretKey']);
type JsonObject = Record<string, unknown>
type CredentialFields = Record<string, string>
const runtime = new Map<string, CredentialFields>();

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function decodeInitialVault() {
  const encoded = String(process.env.AIGC_CREDENTIALS_B64 || '').trim();
  if (!encoded) return;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    for (const [provider, value] of Object.entries(asRecord(parsed))) {
      const record = asRecord(value);
      const fields = Object.fromEntries(Object.entries(record).map(([field, item]) => [field, String(item || '')]));
      runtime.set(provider, fields);
    }
  } catch {
    console.error('[credentials] 无法读取桌面凭证缓存，已忽略');
  }
  delete process.env.AIGC_CREDENTIALS_B64;
}
decodeInitialVault();

function safeProvider(provider: unknown): string {
  const value = String(provider || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) throw new Error('无效的 provider');
  return value;
}

function sanitize(fields: JsonObject = {}): CredentialFields {
  const value: CredentialFields = {};
  for (const field of ['apiKey', 'accessKey', 'secretKey', 'appId', 'cluster', 'resourceId']) {
    if (fields[field] === undefined) continue;
    const text = String(fields[field] || '').trim();
    if (text.length > 8192) throw new Error(`凭证字段 ${field} 过长`);
    value[field] = text;
  }
  return value;
}

function send(action: string, provider: string, value: CredentialFields): boolean {
  if (typeof process.send !== 'function') return false;
  try {
    process.send({ channel: 'credential-vault', action, provider, value });
    return true;
  } catch {
    return false;
  }
}

export function set(provider: unknown, fields: JsonObject = {}) {
  const key = safeProvider(provider);
  const next = { ...(runtime.get(key) || {}), ...sanitize(fields) };
  runtime.set(key, next);
  send('set', key, next);
  return { provider: key, persisted: typeof process.send === 'function' };
}

export function clear(provider: unknown, fields: string[] = ['apiKey', 'accessKey', 'secretKey']): true {
  const key = safeProvider(provider);
  const next = { ...(runtime.get(key) || {}) };
  for (const field of fields) delete next[field];
  if (Object.keys(next).length) runtime.set(key, next);
  else runtime.delete(key);
  send('set', key, next);
  return true;
}

export function get(provider: unknown): CredentialFields {
  return { ...(runtime.get(String(provider || '')) || {}) };
}

export function has(provider: unknown): boolean {
  const value = get(provider);
  return Boolean(value.apiKey || (value.accessKey && value.secretKey));
}

function mask(value: unknown): string {
  const text = String(value || '');
  if (!text) return '';
  return `****${text.slice(-4)}`;
}

export function redact(input: unknown): string {
  let text = String(input == null ? '' : input);
  for (const value of runtime.values()) {
    for (const field of SECRET_FIELDS) {
      const secret = String(value[field] || '');
      if (secret.length >= 4) text = text.split(secret).join('[REDACTED]');
    }
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|key|token)-[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]');
}

export function applyMasked(config: unknown): JsonObject {
  const result = asRecord(JSON.parse(JSON.stringify(config || {})));
  const credentials = asRecord(result.credentials);
  result.credentials = credentials;
  for (const [provider, value] of runtime.entries()) {
    const providerValue = asRecord(credentials[provider]);
    credentials[provider] = providerValue;
    for (const [field, fieldValue] of Object.entries(value)) {
      providerValue[field] = SECRET_FIELDS.has(field) ? mask(fieldValue) : fieldValue;
    }
  }
  const deepseek = runtime.get('deepseek');
  if (deepseek?.apiKey) {
    result.deepseek = { ...asRecord(result.deepseek), apiKey: mask(deepseek.apiKey) };
  }
  return result;
}

export function extractFromConfig(input: unknown = {}) {
  const clean = asRecord(JSON.parse(JSON.stringify(input || {})));
  const extracted: string[] = [];
  const credentials = asRecord(clean.credentials);
  clean.credentials = credentials;
  for (const [provider, value] of Object.entries(credentials)) {
    const providerValue = asRecord(value);
    const secrets: CredentialFields = {};
    for (const field of SECRET_FIELDS) {
      const fieldValue = providerValue[field];
      if (typeof fieldValue === 'string' && fieldValue && !fieldValue.startsWith('****')) {
        secrets[field] = fieldValue;
      }
      delete providerValue[field];
    }
    if (Object.keys(secrets).length) {
      set(provider, secrets);
      extracted.push(provider);
    }
  }
  const deepseek = asRecord(clean.deepseek);
  const legacy = deepseek.apiKey;
  if (typeof legacy === 'string' && legacy && !legacy.startsWith('****')) {
    set('deepseek', { apiKey: legacy });
    extracted.push('deepseek');
  }
  if (clean.deepseek) delete deepseek.apiKey;
  return { clean, extracted: [...new Set(extracted)] };
}

export { SECRET_FIELDS }
