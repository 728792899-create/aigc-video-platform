import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DeclarativeProviderManifest, MediaReference, ProviderRoute } from '@aigc-director/contracts'
import { getModel } from '@aigc-director/model-catalog'
import { isIP } from 'node:net'
import { EgressBrokerError, isPublicNetworkAddress } from './egressBroker.js'
import type { EgressBroker } from './egressBroker.js'

export * from './egressBroker.js'
export * from './pluginRuntime.js'
export * from './pluginSupervisor.js'
export * from './denoRuntime.js'

export type ProviderModality = 'text' | 'image' | 'video' | 'audio'

export interface ModelCapability {
  id: string
  provider: string
  modality: ProviderModality
  supportsStructuredOutput: boolean
  supportsReferenceImage: boolean
  supportsCancel: 'supported' | 'unsupported' | 'unverified'
  supportsReconcile: 'supported' | 'unsupported' | 'unverified'
}

export interface ProviderMediaInput {
  role: 'reference' | 'first-frame' | 'last-frame'
  order: number
  media: MediaReference
}

export interface ProviderContext {
  projectId: string
  taskId: string
  outputDirectory: string
  signal: AbortSignal
}

export interface ProviderResult {
  provider: string
  model: string
  providerTaskId?: string
  text?: string
  media?: MediaReference
  metadata: Record<string, unknown>
}

export interface ProviderAdapter {
  readonly id: string
  readonly models: readonly ModelCapability[]
  execute(input: { model: string; prompt: string; modality: ProviderModality; media?: ProviderMediaInput[] }, context: ProviderContext): Promise<ProviderResult>
  reconcile?(providerTaskId: string, context: ProviderContext): Promise<{ status: 'running' | 'succeeded' | 'failed' | 'unknown'; result?: ProviderResult }>
  cancel?(providerTaskId: string, context: ProviderContext): Promise<{ status: 'confirmed' | 'requested' | 'unsupported' }>
}

export class ProviderExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly outcomeKnown: boolean,
    readonly providerTaskId?: string,
    readonly providerId?: string,
  ) { super(code) }
}

export class ProviderRouter {
  constructor(private readonly resolveAdapter: (connectionId: string) => ProviderAdapter | undefined) {}

  adapter(connectionId: string): ProviderAdapter | undefined { return this.resolveAdapter(connectionId) }

  async execute(
    route: ProviderRoute,
    input: { prompt: string; modality: ProviderModality; media?: ProviderMediaInput[] },
    context: ProviderContext,
  ): Promise<ProviderResult> {
    const connectionIds = [route.primaryConnectionId, ...route.fallbackConnectionIds].slice(0, route.maxAttempts)
    const failures: string[] = []
    for (const connectionId of connectionIds) {
      const adapter = this.resolveAdapter(connectionId)
      if (!adapter) { failures.push('PROVIDER_ADAPTER_MISSING'); continue }
      const attemptController = new AbortController()
      let timedOut = false
      const abortAttempt = () => attemptController.abort()
      context.signal.addEventListener('abort', abortAttempt, { once: true })
      const timeout = setTimeout(() => { timedOut = true; attemptController.abort() }, route.timeoutMs)
      try {
        const model = connectionId === route.primaryConnectionId ? route.model : route.fallbackConnectionModels?.[connectionId] ?? route.model
        const result = await adapter.execute({ ...input, model }, { ...context, signal: attemptController.signal })
        return { ...result, metadata: { ...result.metadata, routeConnectionId: connectionId, fallbackCount: failures.length } }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (context.signal.aborted) throw error
          if (timedOut) throw new ProviderExecutionError('PROVIDER_RECONCILE_REQUIRED', false, false, undefined, connectionId)
          throw error
        }
        if (!(error instanceof ProviderExecutionError)) throw error
        failures.push(error.code)
        if (!error.outcomeKnown) throw new ProviderExecutionError('PROVIDER_RECONCILE_REQUIRED', false, false, error.providerTaskId, connectionId)
        if (!error.retryable) throw error
      } finally {
        clearTimeout(timeout)
        context.signal.removeEventListener('abort', abortAttempt)
      }
    }
    throw new ProviderExecutionError(`PROVIDER_FALLBACK_EXHAUSTED:${failures.join(',')}`, false, true)
  }
}

interface BrokerBackedProviderOptions {
  id: string
  endpointOrigin: string
  broker: EgressBroker
}

function providerHttpError(status: number): never {
  if (status === 429) throw new ProviderExecutionError('PROVIDER_RATE_LIMITED', true, true)
  if (status === 408 || status >= 500) throw new ProviderExecutionError('PROVIDER_OUTCOME_UNKNOWN', false, false)
  if (status === 401 || status === 403) throw new ProviderExecutionError('PROVIDER_AUTHENTICATION_FAILED', false, true)
  throw new ProviderExecutionError(`PROVIDER_HTTP_${status}`, false, true)
}

function mapBrokerError(error: unknown): never {
  if (error instanceof DOMException && error.name === 'AbortError') throw error
  if (!(error instanceof EgressBrokerError)) throw error
  if (error.code === 'EGRESS_ABORTED') throw new DOMException('Task cancelled', 'AbortError')
  if (error.code === 'EGRESS_DISABLED') throw new ProviderExecutionError('PROVIDER_NETWORK_DISABLED', false, true)
  if (error.code === 'EGRESS_TIMEOUT' || error.code === 'EGRESS_TRANSPORT_FAILED') {
    throw new ProviderExecutionError('PROVIDER_OUTCOME_UNKNOWN', false, false)
  }
  throw new ProviderExecutionError(error.code.replace(/^EGRESS_/u, 'PROVIDER_EGRESS_'), false, true)
}

function jsonObject(body: Uint8Array): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object')
    return parsed as Record<string, unknown>
  } catch {
    throw new ProviderExecutionError('PROVIDER_RESPONSE_INVALID', false, true)
  }
}

function mediaBytes(value: unknown): { bytes: Buffer; extension: 'png' | 'jpg' | 'webp'; mime: string } {
  if (typeof value !== 'string' || value.length === 0 || value.length > 30_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new ProviderExecutionError('PROVIDER_MEDIA_INVALID', false, true)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) throw new ProviderExecutionError('PROVIDER_MEDIA_INVALID', false, true)
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { bytes, extension: 'png', mime: 'image/png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return { bytes, extension: 'jpg', mime: 'image/jpeg' }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { bytes, extension: 'webp', mime: 'image/webp' }
  throw new ProviderExecutionError('PROVIDER_MEDIA_TYPE_UNSUPPORTED', false, true)
}

export class OpenAiCompatibleProvider implements ProviderAdapter {
  readonly models: readonly ModelCapability[] = []
  readonly id: string
  private readonly origin: string
  private readonly broker: EgressBroker

  constructor(options: BrokerBackedProviderOptions) {
    this.id = options.id
    this.origin = new URL(options.endpointOrigin).origin
    this.broker = options.broker
  }

  async execute(input: { model: string; prompt: string; modality: ProviderModality; media?: ProviderMediaInput[] }, context: ProviderContext): Promise<ProviderResult> {
    if (context.signal.aborted) throw new DOMException('Task cancelled', 'AbortError')
    if (input.media?.length) throw new ProviderExecutionError('PROVIDER_MEDIA_INPUT_UNSUPPORTED', false, true)
    if (input.modality !== 'text' && input.modality !== 'image') throw new ProviderExecutionError('PROVIDER_CAPABILITY_UNSUPPORTED', false, true)
    const image = input.modality === 'image'
    const path = image ? '/v1/images/generations' : '/v1/chat/completions'
    const payload = image
      ? { model: input.model, prompt: input.prompt, n: 1, response_format: 'b64_json' }
      : { model: input.model, messages: [{ role: 'user', content: input.prompt }] }
    try {
      const response = await this.broker.execute({
        id: randomUUID(), channel: 'model-api', url: `${this.origin}${path}`, method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' }, bodyText: JSON.stringify(payload),
      }, context.signal)
      if (response.status < 200 || response.status >= 300) providerHttpError(response.status)
      const parsed = jsonObject(response.body)
      const usage = parsed.usage && typeof parsed.usage === 'object' && !Array.isArray(parsed.usage) ? parsed.usage as Record<string, unknown> : undefined
      if (!image) {
        const choices = Array.isArray(parsed.choices) ? parsed.choices : []
        const first = choices[0]
        const message = first && typeof first === 'object' && !Array.isArray(first) ? (first as Record<string, unknown>).message : undefined
        const content = message && typeof message === 'object' && !Array.isArray(message) ? (message as Record<string, unknown>).content : undefined
        if (typeof content !== 'string' || content.length === 0) throw new ProviderExecutionError('PROVIDER_RESPONSE_INVALID', false, true)
        return { provider: this.id, model: input.model, text: content, metadata: { billed: 'provider-account', protocol: 'openai-compatible', ...(usage ? { usage } : {}) } }
      }
      const data = Array.isArray(parsed.data) ? parsed.data : []
      const first = data[0]
      const b64 = first && typeof first === 'object' && !Array.isArray(first) ? (first as Record<string, unknown>).b64_json : undefined
      const media = mediaBytes(b64)
      await mkdir(context.outputDirectory, { recursive: true })
      const fileName = `${context.taskId}.${media.extension}`
      const filePath = join(context.outputDirectory, fileName)
      await writeFile(filePath, media.bytes, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
        const existing = await readFile(filePath)
        if (sha256(existing) !== sha256(media.bytes)) throw new ProviderExecutionError('PROVIDER_MEDIA_IDEMPOTENCY_CONFLICT', false, true)
      })
      return {
        provider: this.id, model: input.model,
        media: { id: randomUUID(), projectId: context.projectId, kind: 'image', storage: 'managed-file', locator: basename(filePath), mime: media.mime, size: media.bytes.length, sha256: sha256(media.bytes), createdAt: new Date().toISOString() },
        metadata: { billed: 'provider-account', protocol: 'openai-compatible', ...(usage ? { usage } : {}) },
      }
    } catch (error) {
      if (error instanceof ProviderExecutionError || (error instanceof DOMException && error.name === 'AbortError')) throw error
      mapBrokerError(error)
    }
  }
}

function manifestField(payload: Record<string, unknown>, field: string): unknown {
  let current: unknown = payload
  for (const segment of field.split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(segment) || !current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export class DeclarativeHttpProvider implements ProviderAdapter {
  readonly models: readonly ModelCapability[] = []
  readonly id: string
  private readonly origin: string
  private readonly broker: EgressBroker
  private readonly manifest: DeclarativeProviderManifest

  constructor(options: BrokerBackedProviderOptions & { manifest: DeclarativeProviderManifest }) {
    this.id = options.id
    this.origin = new URL(options.endpointOrigin).origin
    this.broker = options.broker
    this.manifest = options.manifest
  }

  async execute(input: { model: string; prompt: string; modality: ProviderModality; media?: ProviderMediaInput[] }, context: ProviderContext): Promise<ProviderResult> {
    if (input.media?.length) throw new ProviderExecutionError('PROVIDER_MEDIA_INPUT_UNSUPPORTED', false, true)
    try {
      const response = await this.broker.execute({
        id: randomUUID(), channel: 'model-api', url: `${this.origin}${this.manifest.submit.path}`, method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        bodyText: JSON.stringify({ model: input.model, prompt: input.prompt, modality: input.modality, idempotency_key: context.taskId }),
      }, context.signal)
      if (response.status < 200 || response.status >= 300) providerHttpError(response.status)
      const parsed = jsonObject(response.body)
      const remoteId = manifestField(parsed, this.manifest.submit.response.jobId)
      const rawStatus = manifestField(parsed, this.manifest.submit.response.status)
      if (typeof remoteId !== 'string' || remoteId.length === 0 || remoteId.length > 500 || typeof rawStatus !== 'string') {
        throw new ProviderExecutionError('PROVIDER_RESPONSE_INVALID', false, true)
      }
      if (this.manifest.terminalStates.failed.includes(rawStatus)) throw new ProviderExecutionError('PROVIDER_REMOTE_FAILED', false, true, remoteId)
      if (!this.manifest.terminalStates.succeeded.includes(rawStatus)) throw new ProviderExecutionError('PROVIDER_OUTCOME_UNKNOWN', false, false, remoteId)
      return { provider: this.id, model: input.model, providerTaskId: remoteId, text: JSON.stringify(parsed), metadata: { billed: 'provider-account', protocol: 'declarative-http', remoteStatus: rawStatus } }
    } catch (error) {
      if (error instanceof ProviderExecutionError || (error instanceof DOMException && error.name === 'AbortError')) throw error
      mapBrokerError(error)
    }
  }

  async reconcile(providerTaskId: string, context: ProviderContext): Promise<{ status: 'running' | 'succeeded' | 'failed' | 'unknown'; result?: ProviderResult }> {
    if (!this.manifest.poll) return { status: 'unknown' }
    const path = this.manifest.poll.pathTemplate.replace('{jobId}', encodeURIComponent(providerTaskId))
    try {
      const response = await this.broker.execute({ id: randomUUID(), channel: 'model-api', url: `${this.origin}${path}`, method: 'GET', headers: { accept: 'application/json' } }, context.signal)
      if (response.status === 404) return { status: 'unknown' }
      if (response.status < 200 || response.status >= 300) providerHttpError(response.status)
      const parsed = jsonObject(response.body)
      const rawStatus = manifestField(parsed, this.manifest.poll.response.status)
      if (typeof rawStatus !== 'string') return { status: 'unknown' }
      if (this.manifest.terminalStates.failed.includes(rawStatus)) return { status: 'failed' }
      if (!this.manifest.terminalStates.succeeded.includes(rawStatus)) return { status: 'running' }
      return { status: 'succeeded', result: { provider: this.id, model: 'declarative', providerTaskId, text: JSON.stringify(parsed), metadata: { billed: 'provider-account', protocol: 'declarative-http', remoteStatus: rawStatus } } }
    } catch (error) {
      if (error instanceof ProviderExecutionError || (error instanceof DOMException && error.name === 'AbortError')) throw error
      mapBrokerError(error)
    }
  }

  async cancel(providerTaskId: string, context: ProviderContext): Promise<{ status: 'confirmed' | 'requested' | 'unsupported' }> {
    if (!this.manifest.cancel) return { status: 'unsupported' }
    const path = this.manifest.cancel.pathTemplate.replace('{jobId}', encodeURIComponent(providerTaskId))
    try {
      const response = await this.broker.execute({ id: randomUUID(), channel: 'model-api', url: `${this.origin}${path}`, method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, bodyText: '{}' }, context.signal)
      if (response.status < 200 || response.status >= 300) providerHttpError(response.status)
      return { status: 'requested' }
    } catch (error) {
      if (error instanceof ProviderExecutionError || (error instanceof DOMException && error.name === 'AbortError')) throw error
      mapBrokerError(error)
    }
  }
}

const sha256 = (input: Buffer | string): string => createHash('sha256').update(input).digest('hex')
const escapeXml = (value: string): string => value.replace(/[<>&"']/gu, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] ?? character)

export class FakeProvider implements ProviderAdapter {
  constructor(private readonly demoAssetDirectory = process.env.AIGC_DIRECTOR_DEMO_ASSET_DIR) {}

  readonly id = 'demo-local'
  readonly models: readonly ModelCapability[] = ['demo-structured-v1', 'demo-frame-v1', 'demo-tone-v1'].map((id) => {
    const model = getModel(id)
    return {
      id: model.id, provider: model.providerId, modality: model.modality,
      supportsStructuredOutput: model.features.includes('structured-output'),
      supportsReferenceImage: model.features.includes('reference-images'),
      supportsCancel: model.features.includes('cancel') ? 'supported' : 'unsupported',
      supportsReconcile: model.features.includes('reconcile') ? 'supported' : 'unsupported',
    }
  })

  async execute(input: { model: string; prompt: string; modality: ProviderModality; media?: ProviderMediaInput[] }, context: ProviderContext): Promise<ProviderResult> {
    if (context.signal.aborted) throw new DOMException('Task cancelled', 'AbortError')
    const capability = this.models.find((model) => model.id === input.model && model.modality === input.modality)
    if (!capability) throw new Error('PROVIDER_CAPABILITY_UNSUPPORTED')
    const orderedMedia = [...(input.media ?? [])].sort((left, right) => left.order - right.order)
    if (orderedMedia.length > 0 && !capability.supportsReferenceImage) throw new Error('PROVIDER_BOUNDARY_FRAME_UNSUPPORTED')
    if (new Set(orderedMedia.map((item) => item.order)).size !== orderedMedia.length) throw new Error('PROVIDER_MEDIA_ORDER_INVALID')
    if (orderedMedia.some((item, index) => item.order !== index || item.media.projectId !== context.projectId || item.media.kind !== 'image')) throw new Error('PROVIDER_MEDIA_INPUT_INVALID')
    const receivedMediaOrder = orderedMedia.map((item) => `${item.role}:${item.media.id}:${item.media.sha256}`)
    if (input.modality === 'text') {
      return { provider: this.id, model: input.model, text: input.prompt, metadata: { demo: true, billed: false, receivedMediaOrder } }
    }
    await mkdir(context.outputDirectory, { recursive: true })
    if (input.modality === 'image') {
      const demoAssetNames = ['candidate-01.png', 'candidate-02.png', 'candidate-03.png', 'storyboard-06.png', 'hero-archive-discovery.png'] as const
      const startIndex = Number.parseInt(sha256(context.taskId).slice(0, 8), 16) % demoAssetNames.length
      if (this.demoAssetDirectory) {
        for (let offset = 0; offset < demoAssetNames.length; offset += 1) {
          const demoAsset = demoAssetNames[(startIndex + offset) % demoAssetNames.length]!
          const bytes = await readFile(join(this.demoAssetDirectory, demoAsset)).catch(() => undefined)
          if (!bytes) continue
          const fileName = `${context.taskId}.png`
          const filePath = join(context.outputDirectory, fileName)
          await writeFile(filePath, bytes, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') throw error
            const existing = await readFile(filePath)
            if (sha256(existing) !== sha256(bytes)) throw new Error('DEMO_ASSET_IDEMPOTENCY_CONFLICT')
          })
          return {
            provider: this.id,
            model: input.model,
            media: { id: randomUUID(), projectId: context.projectId, kind: 'image', storage: 'managed-file', locator: basename(filePath), mime: 'image/png', size: bytes.length, sha256: sha256(bytes), createdAt: new Date().toISOString() },
            metadata: { demo: true, billed: false, receivedMediaOrder, demoAsset },
          }
        }
      }
      const fileName = `${context.taskId}.svg`
      const filePath = join(context.outputDirectory, fileName)
      const safePrompt = escapeXml(input.prompt.slice(0, 180))
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101827"/><stop offset="1" stop-color="#173b46"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1060" cy="130" r="220" fill="#65e6cb" opacity=".16"/><text x="72" y="574" fill="#f4f7fb" font-family="sans-serif" font-size="38">Demo local candidate</text><text x="72" y="632" fill="#a8b4c7" font-family="sans-serif" font-size="24">${safePrompt}</text></svg>`)
      await writeFile(filePath, svg)
      const timestamp = new Date().toISOString()
      return {
        provider: this.id,
        model: input.model,
        media: { id: randomUUID(), projectId: context.projectId, kind: 'image', storage: 'managed-file', locator: basename(filePath), mime: 'image/svg+xml', size: svg.length, sha256: sha256(svg), createdAt: timestamp },
        metadata: { demo: true, billed: false, receivedMediaOrder },
      }
    }
    if (input.modality === 'audio') {
      const fileName = `${context.taskId}.wav`
      const filePath = join(context.outputDirectory, fileName)
      const sampleRate = 16_000
      const seconds = 1
      const dataSize = sampleRate * seconds * 2
      const wav = Buffer.alloc(44 + dataSize)
      wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
      wav.write('data', 36); wav.writeUInt32LE(dataSize, 40)
      await writeFile(filePath, wav)
      return {
        provider: this.id,
        model: input.model,
        media: { id: randomUUID(), projectId: context.projectId, kind: 'audio', storage: 'managed-file', locator: basename(filePath), mime: 'audio/wav', size: wav.length, sha256: sha256(wav), createdAt: new Date().toISOString() },
        metadata: { demo: true, billed: false, silent: true, receivedMediaOrder },
      }
    }
    throw new Error('PROVIDER_CAPABILITY_UNSUPPORTED')
  }

  async reconcile(_providerTaskId: string, _context: ProviderContext): Promise<{ status: 'succeeded' }> {
    return { status: 'succeeded' }
  }

  async cancel(_providerTaskId: string, _context: ProviderContext): Promise<{ status: 'confirmed' }> {
    return { status: 'confirmed' }
  }
}

export function assertProviderNetworkPolicy(providerId: string): void {
  const disabled = process.env.PROVIDER_NETWORK_DISABLED !== '0'
  if (disabled && providerId !== 'demo-local') throw new Error('PROVIDER_NETWORK_DISABLED')
}

export function isSafeBrokerUrl(raw: string, allowedHosts: readonly string[]): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (!allowedHosts.map((item) => item.toLowerCase()).includes(host)) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (isIP(host) > 0 && !isPublicNetworkAddress(host)) return false
  return true
}
