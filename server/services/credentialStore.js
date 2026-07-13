'use strict';

const SECRET_FIELDS = new Set(['apiKey', 'accessKey', 'secretKey']);
const runtime = new Map();

function decodeInitialVault() {
  const encoded = String(process.env.AIGC_CREDENTIALS_B64 || '').trim();
  if (!encoded) return;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    for (const [provider, value] of Object.entries(parsed || {})) {
      if (value && typeof value === 'object') runtime.set(provider, { ...value });
    }
  } catch {
    console.error('[credentials] 无法读取桌面凭证缓存，已忽略');
  }
  delete process.env.AIGC_CREDENTIALS_B64;
}
decodeInitialVault();

function safeProvider(provider) {
  const value = String(provider || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) throw new Error('无效的 provider');
  return value;
}

function sanitize(fields = {}) {
  const value = {};
  for (const field of ['apiKey', 'accessKey', 'secretKey', 'appId', 'cluster', 'resourceId']) {
    if (fields[field] === undefined) continue;
    const text = String(fields[field] || '').trim();
    if (text.length > 8192) throw new Error(`凭证字段 ${field} 过长`);
    value[field] = text;
  }
  return value;
}

function send(action, provider, value) {
  if (typeof process.send !== 'function') return false;
  try {
    process.send({ channel: 'credential-vault', action, provider, value });
    return true;
  } catch {
    return false;
  }
}

function set(provider, fields = {}) {
  const key = safeProvider(provider);
  const next = { ...(runtime.get(key) || {}), ...sanitize(fields) };
  runtime.set(key, next);
  send('set', key, next);
  return { provider: key, persisted: typeof process.send === 'function' };
}

function clear(provider, fields = ['apiKey', 'accessKey', 'secretKey']) {
  const key = safeProvider(provider);
  const next = { ...(runtime.get(key) || {}) };
  for (const field of fields) delete next[field];
  if (Object.keys(next).length) runtime.set(key, next);
  else runtime.delete(key);
  send('set', key, next);
  return true;
}

function get(provider) {
  return { ...(runtime.get(String(provider || '')) || {}) };
}

function has(provider) {
  const value = get(provider);
  return Boolean(value.apiKey || (value.accessKey && value.secretKey));
}

function mask(value) {
  const text = String(value || '');
  if (!text) return '';
  return `****${text.slice(-4)}`;
}

function redact(input) {
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

function applyMasked(config) {
  const result = JSON.parse(JSON.stringify(config || {}));
  result.credentials = result.credentials || {};
  for (const [provider, value] of runtime.entries()) {
    result.credentials[provider] = { ...(result.credentials[provider] || {}) };
    for (const [field, fieldValue] of Object.entries(value)) {
      result.credentials[provider][field] = SECRET_FIELDS.has(field) ? mask(fieldValue) : fieldValue;
    }
  }
  const deepseek = runtime.get('deepseek');
  if (deepseek?.apiKey) {
    result.deepseek = { ...(result.deepseek || {}), apiKey: mask(deepseek.apiKey) };
  }
  return result;
}

function extractFromConfig(input = {}) {
  const clean = JSON.parse(JSON.stringify(input || {}));
  const extracted = [];
  for (const [provider, value] of Object.entries(clean.credentials || {})) {
    if (!value || typeof value !== 'object') continue;
    const secrets = {};
    for (const field of SECRET_FIELDS) {
      if (typeof value[field] === 'string' && value[field] && !value[field].startsWith('****')) {
        secrets[field] = value[field];
      }
      delete value[field];
    }
    if (Object.keys(secrets).length) {
      set(provider, secrets);
      extracted.push(provider);
    }
  }
  const legacy = clean.deepseek?.apiKey;
  if (typeof legacy === 'string' && legacy && !legacy.startsWith('****')) {
    set('deepseek', { apiKey: legacy });
    extracted.push('deepseek');
  }
  if (clean.deepseek) delete clean.deepseek.apiKey;
  return { clean, extracted: [...new Set(extracted)] };
}

module.exports = { set, clear, get, has, applyMasked, extractFromConfig, redact, SECRET_FIELDS };
