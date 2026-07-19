import { describe, expect, it } from 'vitest'
import { extractReadyPort, sanitizeServerDiagnostic, startupErrorDescription } from '../src/serverLifecycle.js'

describe('desktop server lifecycle', () => {
  it('extracts an operating-system assigned port from split startup output', () => {
    expect(extractReadyPort('noise\nDIRECTOR_SERVER_RE')).toBeUndefined()
    expect(extractReadyPort('noise\nDIRECTOR_SERVER_READY {"host":"127.0.0.1","port":43127,"version":"2.0.0"}\n')).toBe(43127)
    expect(extractReadyPort('DIRECTOR_SERVER_READY {"host":"127.0.0.1","port":0}\n')).toBeUndefined()
  })

  it('redacts tokens, keys and private paths while bounding diagnostics', () => {
    const fakeProviderKey = ['sk', 'abcdefghijklmnopqrstuvwxyz123456'].join('-')
    const privatePath = ['', 'Users', 'private-user', 'project', 'file.ts'].join('/')
    const result = sanitizeServerDiagnostic(
      `token=session-secret ${fakeProviderKey} path=${privatePath} ${'x'.repeat(12_000)}`,
      ['session-secret'],
    )
    expect(result).not.toContain('session-secret')
    expect(result).not.toContain(fakeProviderKey)
    expect(result).not.toContain(privatePath)
    expect(result).toContain('[redacted-token]')
    expect(result).toContain('[redacted-path]')
    expect(result.length).toBeLessThanOrEqual(8_000)
  })

  it('turns stable startup codes into actionable local-only guidance', () => {
    expect(startupErrorDescription('SERVER_EXITED')).toContain('logs/desktop-startup.log')
    expect(startupErrorDescription('SERVER_EXITED')).toContain('本地服务')
    expect(startupErrorDescription('UNKNOWN')).not.toContain('/Users/')
  })
})
