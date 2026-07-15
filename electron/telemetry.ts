'use strict';

type JsonObject = Record<string, unknown>

interface SentryScope {
  setExtras(extras: unknown): void
}

interface SentryClient {
  init(options: JsonObject): void
  withScope(callback: (scope: SentryScope) => void): void
  captureException(error: Error): void
}

let sentry: SentryClient | null = null;

function isSentryClient(value: unknown): value is SentryClient {
  return value !== null
    && typeof value === 'object'
    && 'init' in value && typeof value.init === 'function'
    && 'withScope' in value && typeof value.withScope === 'function'
    && 'captureException' in value && typeof value.captureException === 'function'
}

function redact(value: unknown): string {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:api_?key|token|secret)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/("(?:apiKey|accessKey|secretKey|token)"\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}

function scrubEvent(event: unknown): unknown {
  try {
    return JSON.parse(redact(JSON.stringify(event)));
  } catch {
    return event;
  }
}

function init({ appVersion, packaged }: { appVersion: string; packaged: boolean }): boolean {
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) return false;
  try {
    const client: unknown = require('@sentry/electron/main');
    if (!isSentryClient(client)) throw new Error('Sentry Electron 主进程模块契约不匹配');
    sentry = client;
    client.init({
      dsn,
      release: `aigc-video-studio@${appVersion}`,
      environment: packaged ? 'production' : 'development',
      sendDefaultPii: false,
      attachStacktrace: true,
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
    });
    return true;
  } catch (error: unknown) {
    console.error('[telemetry] Sentry 初始化失败:', redact(error instanceof Error ? error.message : error));
    return false;
  }
}

function captureException(error: unknown, context: JsonObject = {}): void {
  const client = sentry;
  if (!client) return;
  client.withScope((scope) => {
    scope.setExtras(scrubEvent(context));
    client.captureException(error instanceof Error ? error : new Error(redact(error)));
  });
}

export { init, captureException, redact };
