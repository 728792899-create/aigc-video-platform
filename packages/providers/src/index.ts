import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { MediaReference } from '@aigc-director/contracts'
import { getModel } from '@aigc-director/model-catalog'
import { isIP } from 'node:net'
import { isPublicNetworkAddress } from './egressBroker.js'

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

const sha256 = (input: Buffer | string): string => createHash('sha256').update(input).digest('hex')
const escapeXml = (value: string): string => value.replace(/[<>&"']/gu, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] ?? character)

export class FakeProvider implements ProviderAdapter {
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
