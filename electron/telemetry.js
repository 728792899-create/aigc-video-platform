'use strict';

let sentry = null;

function redact(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:api_?key|token|secret)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/("(?:apiKey|accessKey|secretKey|token)"\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}

function scrubEvent(event) {
  try {
    return JSON.parse(redact(JSON.stringify(event)));
  } catch {
    return event;
  }
}

function init({ appVersion, packaged }) {
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) return false;
  try {
    sentry = require('@sentry/electron/main');
    sentry.init({
      dsn,
      release: `aigc-video-studio@${appVersion}`,
      environment: packaged ? 'production' : 'development',
      sendDefaultPii: false,
      attachStacktrace: true,
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
    });
    return true;
  } catch (error) {
    console.error('[telemetry] Sentry 初始化失败:', redact(error.message));
    return false;
  }
}

function captureException(error, context = {}) {
  if (!sentry) return;
  sentry.withScope((scope) => {
    scope.setExtras(scrubEvent(context));
    sentry.captureException(error instanceof Error ? error : new Error(redact(error)));
  });
}

module.exports = { init, captureException, redact };
