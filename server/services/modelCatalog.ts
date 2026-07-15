import { ModelDescriptorSchema } from '@aigc-video/contracts'

import * as registry from './providers'

type Modality = 'text' | 'image' | 'video' | 'audio'
type MediaInput = 'project_media' | 'local_file' | 'object_key' | 'public_url' | 'signed_url' | 'data_url'

interface ProtocolProfile {
  input_types: string[]
  output_types: string[]
  capabilities: Record<string, boolean>
  accepted_media_references?: MediaInput[]
  allow_custom_model?: boolean
}

interface LocalModel {
  provider: string
  model: string
  modality: Modality
  aliases?: string[]
  capabilities: Record<string, boolean>
  input_types: string[]
  output_types: string[]
  accepted_media_references?: MediaInput[]
}

export interface CatalogModel {
  id: string
  provider: string
  model: string
  modality: Modality
  input_types: string[]
  output_types: string[]
  capabilities: Record<string, boolean>
  accepted_media: MediaInput[]
  accepted_media_references: MediaInput[]
  credential_required: boolean
  catalog_source: string
  limits: Record<string, unknown>
}

interface ProviderDefinition {
  protocol: string
  kind: string
  models: string[]
}

export const KIND_TO_MODALITY: Readonly<Record<string, Modality>> = Object.freeze({
  llm: 'text',
  t2i: 'image',
  t2v: 'video',
  tts: 'audio',
})

const PROTOCOL_PROFILES: Readonly<Record<string, ProtocolProfile>> = Object.freeze({
  openai: {
    input_types: ['text'], output_types: ['text', 'json'],
    capabilities: { structured_output: true, streaming: true },
    allow_custom_model: true,
  },
  'openai-image': {
    input_types: ['text'], output_types: ['image'],
    capabilities: { reference_image: false, negative_prompt: false, seed: false, async: false },
  },
  'zhipu-image': {
    input_types: ['text'], output_types: ['image'],
    capabilities: { reference_image: false, negative_prompt: false, seed: true, async: false },
  },
  'dashscope-image': {
    input_types: ['text'], output_types: ['image'],
    capabilities: { reference_image: false, negative_prompt: false, seed: false, async: true },
  },
  'zhipu-video': {
    input_types: ['text', 'image'], output_types: ['video'],
    capabilities: { image_to_video: true, first_last_frame: false, audio: false, async: true },
    accepted_media_references: ['data_url', 'public_url'],
  },
  kling: {
    input_types: ['text', 'image'], output_types: ['video'],
    capabilities: { image_to_video: true, first_last_frame: false, audio: false, async: true },
    accepted_media_references: ['data_url', 'public_url'],
  },
  'openai-tts': {
    input_types: ['text'], output_types: ['audio'],
    capabilities: { emotion: false, streaming: false },
    allow_custom_model: true,
  },
  'volcano-tts': {
    input_types: ['text'], output_types: ['audio'],
    capabilities: { emotion: true, streaming: true },
    allow_custom_model: true,
  },
  'volcano-tts-v3': {
    input_types: ['text'], output_types: ['audio'],
    capabilities: { emotion: false, streaming: true },
    allow_custom_model: true,
  },
})

const LOCAL_MODELS: readonly LocalModel[] = [
  { provider: 'pollinations', model: 'flux', modality: 'image', capabilities: { reference_image: false, negative_prompt: true, seed: true }, input_types: ['text'], output_types: ['image'] },
  { provider: 'pollinations', model: 'flux-realism', modality: 'image', capabilities: { reference_image: false, negative_prompt: true, seed: true }, input_types: ['text'], output_types: ['image'] },
  { provider: 'pollinations', model: 'turbo', modality: 'image', capabilities: { reference_image: false, negative_prompt: true, seed: true }, input_types: ['text'], output_types: ['image'] },
  { provider: 'dreamina', model: '4.0', modality: 'image', aliases: ['dreamina'], capabilities: { reference_image: false, negative_prompt: false, seed: false }, input_types: ['text'], output_types: ['image'] },
  { provider: 'dreamina', model: '5.0', modality: 'image', aliases: ['dreamina_5_0'], capabilities: { reference_image: false, negative_prompt: false, seed: false }, input_types: ['text'], output_types: ['image'] },
  { provider: 'static', model: 'static', modality: 'video', aliases: [''], capabilities: { image_to_video: true, first_last_frame: false, audio: true, async: false }, input_types: ['image', 'audio', 'subtitle'], output_types: ['video'], accepted_media_references: ['project_media', 'local_file'] },
  { provider: 'edge', model: 'edge', modality: 'audio', aliases: [''], capabilities: { emotion: true, streaming: false }, input_types: ['text'], output_types: ['audio'] },
  { provider: 'demo', model: 'placeholder', modality: 'image', capabilities: { reference_image: false, negative_prompt: false, seed: false }, input_types: ['text'], output_types: ['image'] },
]

export class ModelCatalogError extends Error {
  readonly code: string
  readonly status = 400
  readonly retryable = false
  readonly details: Record<string, unknown>

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ModelCatalogError'
    this.code = code
    this.details = details
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function providerDefinition(value: unknown): ProviderDefinition | null {
  const raw = record(value)
  if (!raw || typeof raw.protocol !== 'string' || typeof raw.kind !== 'string') return null
  return { protocol: raw.protocol, kind: raw.kind, models: stringArray(raw.models) }
}

function present(definition: {
  provider: string
  model: string
  modality: Modality
  input_types?: string[]
  output_types?: string[]
  capabilities?: Record<string, boolean>
  accepted_media_references?: MediaInput[]
  credential_required?: boolean
  catalog_source?: string
  limits?: Record<string, unknown>
}): CatalogModel {
  const accepted = [...(definition.accepted_media_references || [])]
  const descriptor: CatalogModel = {
    id: `${definition.provider}__${definition.model}`,
    provider: definition.provider,
    model: definition.model,
    modality: definition.modality,
    input_types: [...(definition.input_types || [])],
    output_types: [...(definition.output_types || [])],
    capabilities: { ...(definition.capabilities || {}) },
    accepted_media: accepted,
    accepted_media_references: accepted,
    credential_required: definition.credential_required !== false,
    catalog_source: definition.catalog_source || 'registry',
    limits: { ...(definition.limits || {}) },
  }
  ModelDescriptorSchema.parse(descriptor)
  return descriptor
}

function localDefinition(provider: string, model: unknown): CatalogModel | null {
  const rawModel = String(model == null ? '' : model)
  const found = LOCAL_MODELS.find((item) => item.provider === provider
    && (item.model === rawModel || (item.aliases || []).includes(rawModel)))
  return found ? present({ ...found, credential_required: false, catalog_source: 'local' }) : null
}

export function get(providerValue: unknown, model: unknown): CatalogModel | null {
  const provider = String(providerValue || '').trim()
  const local = localDefinition(provider, model)
  if (local) return local
  const providerDef = providerDefinition(registry.getProvider(provider))
  if (!providerDef) return null
  const profile = PROTOCOL_PROFILES[providerDef.protocol]
  if (!profile) return null
  const requested = String(model || providerDef.models[0] || '').trim()
  const known = providerDef.models.includes(requested)
  if (!known && !(profile.allow_custom_model && requested)) return null
  return present({
    provider,
    model: requested,
    modality: KIND_TO_MODALITY[providerDef.kind] || 'text',
    input_types: profile.input_types,
    output_types: profile.output_types,
    capabilities: profile.capabilities,
    accepted_media_references: profile.accepted_media_references,
    credential_required: true,
    catalog_source: known ? 'registry' : 'custom',
  })
}

export function list({ modality }: { modality?: Modality } = {}): CatalogModel[] {
  const models = LOCAL_MODELS.map((item) => present({ ...item, credential_required: false, catalog_source: 'local' }))
  const providers = record(registry.PROVIDERS) || {}
  for (const [provider, rawDefinition] of Object.entries(providers)) {
    const definition = providerDefinition(rawDefinition)
    if (!definition) continue
    for (const model of definition.models) {
      const candidate = get(provider, model)
      if (candidate) models.push(candidate)
    }
  }
  return models.filter((item) => !modality || item.modality === modality)
}

export function assertSelection({
  provider,
  model,
  modality,
  requires = [],
}: {
  provider?: unknown
  model?: unknown
  modality?: Modality
  requires?: string[]
} = {}): CatalogModel {
  const definition = get(provider, model)
  if (!definition) {
    throw new ModelCatalogError('MODEL_NOT_FOUND', `未知或未登记的模型：${provider || '(empty)'} / ${model || '(default)'}`, { provider, model })
  }
  if (modality && definition.modality !== modality) {
    throw new ModelCatalogError('MODEL_MODALITY_MISMATCH', `模型 ${definition.id} 不支持 ${modality} 阶段`, {
      expected: modality,
      actual: definition.modality,
    })
  }
  const unsupported = requires.filter((capability) => definition.capabilities[capability] !== true)
  if (unsupported.length) {
    throw new ModelCatalogError('MODEL_CAPABILITY_UNSUPPORTED', `模型 ${definition.id} 不支持能力：${unsupported.join(', ')}`, {
      model_id: definition.id,
      unsupported,
    })
  }
  return definition
}
