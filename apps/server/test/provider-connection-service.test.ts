import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DirectorDatabase } from '../src/db/database.js'
import { InMemoryCredentialVault } from '../src/services/credentialVault.js'
import {
  ProviderConnectionService,
  builtInDemoConnectionId,
  type ProviderConnectionProbe,
} from '../src/services/providerConnectionService.js'

const openAiConnection = (name: string, key: string, credential?: string) => ({
  displayName: name,
  protocol: 'openai-compatible' as const,
  endpointOrigin: 'https://relay.example.com/',
  credentialKey: key,
  ...(credential ? { credential } : {}),
  capabilities: ['image' as const],
  confirmation: 'CREATE_LOCAL_PROVIDER_CONNECTION' as const,
})

describe('Provider 连接与路由服务契约', () => {
  const databases: DirectorDatabase[] = []

  async function database(): Promise<DirectorDatabase> {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-provider-connection-'))
    const instance = new DirectorDatabase(join(directory, 'director.sqlite'))
    databases.push(instance)
    return instance
  }

  afterEach(() => {
    for (const instance of databases.splice(0)) instance.close()
    vi.restoreAllMocks()
  })

  it('无密钥时不调用网络探针，响应和数据库都不出现凭据正文', async () => {
    const db = await database()
    const vault = new InMemoryCredentialVault()
    const probe: ProviderConnectionProbe = { test: vi.fn(async (): Promise<'ready'> => 'ready') }
    const service = new ProviderConnectionService(db, vault, false, probe)
    const connection = await service.create(openAiConnection('无密钥连接', 'missing-key'))

    const report = await service.test(connection.id, {
      expectedRevision: connection.revision,
      confirmation: 'TEST_PROVIDER_CONNECTION',
    })

    expect(report).toMatchObject({
      outcome: 'credential_missing',
      connection: { credentialConfigured: false, state: 'error', lastErrorCode: 'PROVIDER_CREDENTIAL_MISSING' },
    })
    expect(probe.test).not.toHaveBeenCalled()
    expect(JSON.stringify({ report, persisted: db.getProviderConnection(connection.id) })).not.toContain('missing-key-secret')
  })

  it.each([
    ['ready', 'ready', 'verified-endpoint', undefined],
    ['timeout', 'error', 'unverified', 'PROVIDER_TIMEOUT'],
    ['rate_limited', 'error', 'unverified', 'PROVIDER_RATE_LIMITED'],
    ['invalid_response', 'error', 'unverified', 'PROVIDER_INVALID_RESPONSE'],
    ['unreachable', 'error', 'unverified', 'PROVIDER_UNREACHABLE'],
  ] as const)('将探针结果 %s 映射为稳定、可诊断且不泄密的连接状态', async (outcome, state, trust, lastErrorCode) => {
    const db = await database()
    const vault = new InMemoryCredentialVault()
    const probe: ProviderConnectionProbe = { test: vi.fn(async () => outcome) }
    const service = new ProviderConnectionService(db, vault, false, probe)
    const secret = `provider-secret-${outcome}`
    const connection = await service.create(openAiConnection(`连接-${outcome}`, `key-${outcome.replace('_', '-')}`, secret))

    const report = await service.test(connection.id, {
      expectedRevision: connection.revision,
      confirmation: 'TEST_PROVIDER_CONNECTION',
    })

    expect(report.outcome).toBe(outcome)
    expect(report.connection).toMatchObject({ state, trust, revision: 2, credentialConfigured: true })
    if (lastErrorCode) expect(report.connection.lastErrorCode).toBe(lastErrorCode)
    else expect(report.connection.lastErrorCode).toBeUndefined()
    expect(probe.test).toHaveBeenCalledWith(expect.objectContaining({ id: connection.id }), secret, expect.any(AbortSignal))
    expect(JSON.stringify(report)).not.toContain(secret)
  })

  it('网络总开关关闭时保持草稿连接且绝不调用外部探针', async () => {
    const db = await database()
    const vault = new InMemoryCredentialVault()
    const probe: ProviderConnectionProbe = { test: vi.fn(async (): Promise<'ready'> => 'ready') }
    const service = new ProviderConnectionService(db, vault, true, probe)
    const connection = await service.create(openAiConnection('离线连接', 'offline-key', 'offline-secret-value'))

    const report = await service.test(connection.id, {
      expectedRevision: connection.revision,
      confirmation: 'TEST_PROVIDER_CONNECTION',
    })

    expect(report).toMatchObject({ outcome: 'network_disabled', connection: { state: 'draft', revision: 2 } })
    expect(probe.test).not.toHaveBeenCalled()
  })

  it('路由只接受 ready 且支持对应模态的连接，并通过 revision 防止覆盖', async () => {
    const db = await database()
    const project = db.createProject({ name: 'Provider 路由契约' })
    const service = new ProviderConnectionService(db, new InMemoryCredentialVault(), true)

    const accepted = service.updateRoutePolicy(project.id, {
      expectedRevision: 0,
      routes: [{
        modality: 'image', primaryConnectionId: builtInDemoConnectionId, fallbackConnectionIds: [],
        model: 'demo-frame-v1', maxAttempts: 1, timeoutMs: 60_000,
      }],
      dailyBudgetMicros: 0,
      currency: 'USD',
      confirmation: 'UPDATE_PROVIDER_ROUTE_POLICY',
    })
    expect(accepted).toMatchObject({ revision: 1, dailyBudgetMicros: 0 })

    expect(() => service.updateRoutePolicy(project.id, {
      expectedRevision: 0,
      routes: accepted.routes,
      dailyBudgetMicros: 0,
      currency: 'USD',
      confirmation: 'UPDATE_PROVIDER_ROUTE_POLICY',
    })).toThrow('PROVIDER_ROUTE_REVISION_CONFLICT')
  })
})
