import { createHash } from 'node:crypto'
import { ModelDescriptorSchema, type ModelDescriptor, type ModelModality } from '@aigc-director/contracts'

const CATALOG_VERSION = '1.0.0'

type ModelDefinition = Omit<ModelDescriptor, 'contentHash' | 'catalogVersion'>

const definitions: readonly ModelDefinition[] = [
  {
    id: 'demo-structured-v1', providerId: 'demo-local', displayName: 'Demo 结构化文本', modality: 'text',
    features: ['structured-output', 'reconcile', 'cancel'], inputModes: ['local-fixture'],
    limits: { maxMediaReferences: 0, maxBytesPerReference: 1, acceptedMimePrefixes: [] },
    parameterSchema: { type: 'object', additionalProperties: false }, defaults: {}, surfaces: ['studio', 'demo'],
    status: 'enabled', availability: 'ready',
  },
  {
    id: 'demo-frame-v1', providerId: 'demo-local', displayName: 'Demo 影像候选', modality: 'image',
    features: ['image-generation', 'reference-images', 'first-frame', 'last-frame', 'reconcile', 'cancel'],
    inputModes: ['local-fixture'], limits: { maxMediaReferences: 8, maxBytesPerReference: 20 * 1024 * 1024, acceptedMimePrefixes: ['image/'] },
    parameterSchema: { type: 'object', properties: { variant: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    defaults: { variant: 1 }, surfaces: ['studio', 'demo'], status: 'enabled', availability: 'ready',
  },
  {
    id: 'demo-tone-v1', providerId: 'demo-local', displayName: 'Demo 静音音轨', modality: 'audio',
    features: ['audio-generation', 'reconcile', 'cancel'], inputModes: ['local-fixture'],
    limits: { maxMediaReferences: 0, maxBytesPerReference: 1, acceptedMimePrefixes: [] },
    parameterSchema: { type: 'object', additionalProperties: false }, defaults: {}, surfaces: ['studio', 'demo'],
    status: 'enabled', availability: 'ready',
  },
]

function contentHash(definition: ModelDefinition): string {
  return createHash('sha256').update(JSON.stringify({ catalogVersion: CATALOG_VERSION, ...definition })).digest('hex')
}

export const MODEL_CATALOG: readonly ModelDescriptor[] = Object.freeze(definitions.map((definition) => ModelDescriptorSchema.parse({
  ...definition, catalogVersion: CATALOG_VERSION, contentHash: contentHash(definition),
})))

export function listModels(): ModelDescriptor[] {
  return MODEL_CATALOG.map((model) => structuredClone(model))
}

export function getModel(modelId: string): ModelDescriptor {
  const model = MODEL_CATALOG.find((candidate) => candidate.id === modelId)
  if (!model) throw new Error('MODEL_NOT_FOUND')
  return structuredClone(model)
}

export function requireModelCapability(input: { modelId: string; modality: ModelModality; features?: readonly string[] }): ModelDescriptor {
  const model = getModel(input.modelId)
  if (model.status !== 'enabled' || model.availability !== 'ready' || model.modality !== input.modality) throw new Error('MODEL_CAPABILITY_UNSUPPORTED')
  const missing = (input.features ?? []).filter((feature) => !model.features.includes(feature))
  if (missing.length > 0) throw new Error(`MODEL_CAPABILITY_UNSUPPORTED:${missing.join(',')}`)
  return model
}
