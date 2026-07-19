const READY_PREFIX = 'DIRECTOR_SERVER_READY '
const MAX_DIAGNOSTIC_LENGTH = 8_000

export function extractReadyPort(output: string): number | undefined {
  for (const line of output.split(/\r?\n/u).reverse()) {
    if (!line.startsWith(READY_PREFIX)) continue
    try {
      const payload = JSON.parse(line.slice(READY_PREFIX.length)) as { port?: unknown }
      const port = payload.port
      if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65_535) return port
    } catch {
      return undefined
    }
  }
  return undefined
}

export function sanitizeServerDiagnostic(raw: string, sensitiveValues: readonly string[] = []): string {
  let sanitized = raw
  for (const value of sensitiveValues) {
    if (value) sanitized = sanitized.split(value).join('[redacted-token]')
  }
  sanitized = sanitized
    .replace(/\bsk-(?!test|fake|demo)[A-Za-z0-9_-]{20,}\b/gu, '[redacted-token]')
    .replace(/\b(?:api[_-]?key|authorization|token|secret)\s*[=:]\s*[^\s,;]+/giu, '$1=[redacted-token]')
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, '[redacted-path]')
    .replace(/[A-Za-z]:\\Users\\[^\s"']+/gu, '[redacted-path]')
  if (sanitized.length <= MAX_DIAGNOSTIC_LENGTH) return sanitized
  const marker = '\n[diagnostic-truncated]\n'
  const available = MAX_DIAGNOSTIC_LENGTH - marker.length
  const headLength = Math.floor(available / 2)
  return `${sanitized.slice(0, headLength)}${marker}${sanitized.slice(-(available - headLength))}`
}

export function startupErrorDescription(code: string): string {
  const descriptions: Readonly<Record<string, string>> = {
    SERVER_EXITED: '本地服务在完成启动前退出。请查看应用数据目录中的 logs/desktop-startup.log。',
    SERVER_START_TIMEOUT: '本地服务启动超时。请确认磁盘可写，并查看 logs/desktop-startup.log。',
    SERVER_SPAWN_FAILED: '无法启动本地服务进程。请重新安装应用或检查系统安全策略。',
  }
  return `${code}\n\n${descriptions[code] ?? '应用未能完成安全启动。请查看 logs/desktop-startup.log。'}`
}
