import { afterEach, describe, expect, it, vi } from 'vitest'

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data, correlationId: crypto.randomUUID() }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function unauthorized(): Response {
  return new Response(JSON.stringify({
    ok: false,
    error: {
      code: 'UNAUTHORIZED',
      userMessage: '本地会话已失效，请重新启动本地服务并刷新页面。',
      retryable: false,
      correlationId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    },
  }), { status: 401, headers: { 'content-type': 'application/json' } })
}

describe('本地 API 会话恢复', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('收到 UNAUTHORIZED 后清除缓存会话并在下一次请求重新读取会话', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ authMode: 'cookie', csrfToken: 'csrf-one' }))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(envelope({ authMode: 'cookie', csrfToken: 'csrf-two' }))
      .mockResolvedValueOnce(envelope([]))
    vi.stubGlobal('fetch', fetchMock)
    const { directorApi, DirectorApiError } = await import('../src/api/client.js')

    await expect(directorApi.listProjects()).rejects.toBeInstanceOf(DirectorApiError)
    await expect(directorApi.listProjects()).resolves.toEqual([])

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/v2/session',
      '/api/v2/projects',
      '/api/v2/session',
      '/api/v2/projects',
    ])
  })
})
