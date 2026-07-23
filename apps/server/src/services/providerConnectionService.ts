import { randomUUID } from 'node:crypto'
import {
  ProviderConnectionCreateRequestSchema,
  ProviderConnectionSchema,
  ProviderConnectionTestRequestSchema,
  ProviderConnectionTestReportSchema,
  ProviderCredentialUpdateRequestSchema,
  ProviderRoutePolicySchema,
  ProviderRoutePolicyUpdateRequestSchema,
  type ProviderConnection,
  type ProviderConnectionCreateRequest,
  type ProviderConnectionTestReport,
  type ProviderCredentialUpdateRequest,
  type ProviderRoutePolicy,
  type ProviderRoutePolicyUpdateRequest,
} from '@aigc-director/contracts'
import type { DirectorDatabase } from '../db/database.js'
import type { CredentialVault } from './credentialVault.js'
import {
  DeclarativeHttpProvider,
  EgressBroker,
  FakeProvider,
  OpenAiCompatibleProvider,
  ProviderRouter,
  type EgressRuntimePolicy,
  type ProviderAdapter,
} from '@aigc-director/providers'

const demoConnectionId = '00000000-0000-4000-8000-000000000012'

export interface ProviderConnectionProbe {
  test(connection: ProviderConnection, secret: string, signal: AbortSignal): Promise<Exclude<ProviderConnectionTestReport['outcome'], 'network_disabled' | 'credential_missing'>>
}

const unavailableProbe: ProviderConnectionProbe = {
  async test(): Promise<'unreachable'> { return 'unreachable' },
}

export class BrokerProviderConnectionProbe implements ProviderConnectionProbe {
  async test(connection: ProviderConnection, secret: string, signal: AbortSignal): Promise<'ready' | 'timeout' | 'rate_limited' | 'invalid_response' | 'unreachable'> {
    if (!connection.endpointOrigin) return 'invalid_response'
    const endpoint = new URL(connection.endpointOrigin)
    const policy: EgressRuntimePolicy = {
      id: `provider-probe.${connection.id}`, channel: 'model-api', enabled: true,
      allowedHosts: [endpoint.hostname], allowedMethods: ['GET'], timeoutMs: 15_000,
      maxRequestBytes: 0, maxResponseBytes: 1024 * 1024, maxRedirects: 0,
      allowedResponseMimePrefixes: ['application/json'],
      credential: { reference: connection.id, header: 'authorization', prefix: 'Bearer ' },
    }
    const broker = new EgressBroker({ policies: [policy], testNetworkEnabled: true, resolveSecret: async () => secret })
    try {
      const result = await broker.execute({
        id: randomUUID(), channel: 'model-api', url: new URL('/v1/models', endpoint).toString(), method: 'GET', headers: { accept: 'application/json' },
      }, signal)
      if (result.status === 429) return 'rate_limited'
      if (result.status < 200 || result.status >= 300) return 'unreachable'
      try {
        const parsed = JSON.parse(Buffer.from(result.body).toString('utf8')) as unknown
        return parsed !== null && typeof parsed === 'object' ? 'ready' : 'invalid_response'
      } catch { return 'invalid_response' }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code === 'EGRESS_TIMEOUT' || signal.aborted) return 'timeout'
      return 'unreachable'
    }
  }
}

export class ProviderConnectionService {
  constructor(
    private readonly database: DirectorDatabase,
    private readonly credentials: CredentialVault,
    private readonly networkDisabled: boolean,
    private readonly probe: ProviderConnectionProbe = unavailableProbe,
  ) { this.ensureDemoConnection() }

  private ensureDemoConnection(): void {
    if (this.database.getProviderConnection(demoConnectionId)) return
    const timestamp = new Date().toISOString()
    this.database.putProviderConnection(ProviderConnectionSchema.parse({
      id: demoConnectionId, displayName: '零 Key Demo', protocol: 'demo-local', credentialConfigured: false,
      capabilities: ['text', 'image', 'video', 'audio'], state: 'ready', trust: 'builtin', revision: 1,
      lastTestedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    }), 0)
  }

  async list(): Promise<ProviderConnection[]> {
    return await Promise.all(this.database.listProviderConnections().map(async (connection) => {
      if (!connection.credentialRef) return connection
      const key = connection.credentialRef.split(':', 2)[1]
      if (!key) return connection
      const credentialConfigured = await this.credentials.has(key)
      return ProviderConnectionSchema.parse({ ...connection, credentialConfigured })
    }))
  }

  adapter(connectionId: string): ProviderAdapter | undefined {
    const connection = this.database.getProviderConnection(connectionId)
    if (!connection || connection.state !== 'ready') return undefined
    if (connection.protocol === 'demo-local') return new FakeProvider()
    if (!connection.endpointOrigin || !connection.credentialRef) return undefined
    const endpoint = new URL(connection.endpointOrigin)
    const credentialReference = connection.credentialRef
    const policy: EgressRuntimePolicy = {
      id: `provider-execute.${connection.id}`,
      channel: 'model-api',
      enabled: true,
      allowedHosts: [endpoint.hostname],
      allowedMethods: connection.protocol === 'declarative-http' ? ['GET', 'POST'] : ['POST'],
      timeoutMs: 600_000,
      maxRequestBytes: 2 * 1024 * 1024,
      maxResponseBytes: 30 * 1024 * 1024,
      maxRedirects: 0,
      allowedResponseMimePrefixes: ['application/json'],
      credential: { reference: credentialReference, header: 'authorization', prefix: 'Bearer ' },
    }
    const broker = new EgressBroker({
      policies: [policy],
      testNetworkEnabled: !this.networkDisabled,
      resolveSecret: async (reference) => {
        if (reference !== credentialReference) return undefined
        const key = credentialReference.split(':', 2)[1]
        return key ? await this.credentials.get(key) : undefined
      },
    })
    if (connection.protocol === 'openai-compatible') {
      return new OpenAiCompatibleProvider({ id: connection.id, endpointOrigin: connection.endpointOrigin, broker })
    }
    if (!connection.manifest) return undefined
    return new DeclarativeHttpProvider({ id: connection.id, endpointOrigin: connection.endpointOrigin, manifest: connection.manifest, broker })
  }

  router(): ProviderRouter {
    return new ProviderRouter((connectionId) => this.adapter(connectionId))
  }

  async create(rawRequest: ProviderConnectionCreateRequest): Promise<ProviderConnection> {
    const request = ProviderConnectionCreateRequestSchema.parse(rawRequest)
    if (this.database.listProviderConnections().some((connection) => connection.credentialRef?.endsWith(`:${request.credentialKey}`))) {
      throw new Error('PROVIDER_CREDENTIAL_KEY_IN_USE')
    }
    if (request.credential) await this.credentials.set(request.credentialKey, request.credential)
    const credentialConfigured = await this.credentials.has(request.credentialKey)
    const timestamp = new Date().toISOString()
    const connection = ProviderConnectionSchema.parse({
      id: randomUUID(), displayName: request.displayName, protocol: request.protocol,
      endpointOrigin: request.endpointOrigin, credentialRef: this.credentials.reference(request.credentialKey), credentialConfigured,
      capabilities: request.capabilities, ...(request.manifest ? { manifest: request.manifest } : {}),
      state: 'draft', trust: 'unverified', revision: 1, createdAt: timestamp, updatedAt: timestamp,
    })
    return this.database.putProviderConnection(connection, 0)
  }

  async replaceCredential(connectionId: string, rawRequest: ProviderCredentialUpdateRequest): Promise<ProviderConnection> {
    const request = ProviderCredentialUpdateRequestSchema.parse(rawRequest)
    const current = this.database.getProviderConnection(connectionId)
    if (!current) throw new Error('PROVIDER_CONNECTION_NOT_FOUND')
    if (current.revision !== request.expectedRevision) throw new Error('PROVIDER_CONNECTION_REVISION_CONFLICT')
    const key = current.credentialRef?.split(':', 2)[1]
    if (!key) throw new Error('PROVIDER_CREDENTIAL_UNSUPPORTED')
    await this.credentials.set(key, request.credential)
    const updated = ProviderConnectionSchema.parse({
      ...current, credentialConfigured: true, state: 'draft', trust: 'unverified', revision: current.revision + 1,
      lastErrorCode: undefined, updatedAt: new Date().toISOString(),
    })
    return this.database.putProviderConnection(updated, current.revision)
  }

  async test(connectionId: string, rawRequest: unknown): Promise<ProviderConnectionTestReport> {
    const request = ProviderConnectionTestRequestSchema.parse(rawRequest)
    const current = this.database.getProviderConnection(connectionId)
    if (!current) throw new Error('PROVIDER_CONNECTION_NOT_FOUND')
    if (current.revision !== request.expectedRevision) throw new Error('PROVIDER_CONNECTION_REVISION_CONFLICT')
    const started = Date.now()
    let outcome: ProviderConnectionTestReport['outcome']
    if (current.protocol === 'demo-local') outcome = 'ready'
    else if (this.networkDisabled) outcome = 'network_disabled'
    else {
      const key = current.credentialRef?.split(':', 2)[1]
      const secret = key ? await this.credentials.get(key) : undefined
      if (!secret) outcome = 'credential_missing'
      else {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15_000)
        try { outcome = await this.probe.test(current, secret, controller.signal) } catch { outcome = controller.signal.aborted ? 'timeout' : 'unreachable' } finally { clearTimeout(timer) }
      }
    }
    const checkedAt = new Date().toISOString()
    const ready = outcome === 'ready'
    const updated = ProviderConnectionSchema.parse({
      ...current, state: ready ? 'ready' : outcome === 'network_disabled' ? current.state : 'error',
      trust: ready && current.protocol !== 'demo-local' ? 'verified-endpoint' : current.trust,
      credentialConfigured: outcome !== 'credential_missing' && current.credentialConfigured,
      revision: current.revision + 1, lastTestedAt: checkedAt,
      ...(ready || outcome === 'network_disabled' ? { lastErrorCode: undefined } : { lastErrorCode: `PROVIDER_${outcome.toUpperCase()}` }),
      updatedAt: checkedAt,
    })
    const persisted = this.database.putProviderConnection(updated, current.revision)
    return ProviderConnectionTestReportSchema.parse({ connection: persisted, outcome, latencyMs: Date.now() - started, checkedAt })
  }

  routePolicy(projectId: string): ProviderRoutePolicy {
    if (!this.database.getProject(projectId)) throw new Error('PROJECT_NOT_FOUND')
    return this.database.getProviderRoutePolicy(projectId) ?? ProviderRoutePolicySchema.parse({
      projectId, revision: 0, routes: [], dailyBudgetMicros: 0, currency: 'USD', updatedAt: new Date().toISOString(),
    })
  }

  updateRoutePolicy(projectId: string, rawRequest: ProviderRoutePolicyUpdateRequest): ProviderRoutePolicy {
    const request = ProviderRoutePolicyUpdateRequestSchema.parse(rawRequest)
    const current = this.routePolicy(projectId)
    if (current.revision !== request.expectedRevision) throw new Error('PROVIDER_ROUTE_REVISION_CONFLICT')
    const connections = new Map(this.database.listProviderConnections().map((connection) => [connection.id, connection]))
    for (const route of request.routes) {
      for (const connectionId of [route.primaryConnectionId, ...route.fallbackConnectionIds]) {
        const connection = connections.get(connectionId)
        if (!connection) throw new Error('PROVIDER_ROUTE_CONNECTION_NOT_FOUND')
        if (connection.state !== 'ready') throw new Error('PROVIDER_ROUTE_CONNECTION_NOT_READY')
        if (!connection.capabilities.includes(route.modality)) throw new Error('PROVIDER_ROUTE_CAPABILITY_MISMATCH')
      }
    }
    return this.database.putProviderRoutePolicy(ProviderRoutePolicySchema.parse({
      projectId, revision: current.revision + 1, routes: request.routes,
      dailyBudgetMicros: request.dailyBudgetMicros, currency: request.currency, updatedAt: new Date().toISOString(),
    }), current.revision)
  }
}

export const builtInDemoConnectionId = demoConnectionId
