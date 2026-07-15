import { ModelDescriptorSchema, type ApiEnvelope, type ModelDescriptor } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'

type JsonObject = Record<string, unknown>

export const ProviderViewSchema = z.object({
  key: z.string(),
  label: z.string(),
  models: z.array(z.string()).default([]),
  configured: z.boolean().default(false),
  userConfigured: z.boolean().optional(),
  free: z.boolean().optional(),
  note: z.string().optional(),
  auth: z.string().optional(),
  baseUrl: z.string().optional(),
  runtimeBaseUrl: z.string().optional(),
}).passthrough()
export type ProviderView = z.infer<typeof ProviderViewSchema>

export const ProviderGroupsSchema = z.object({
  llm: z.array(ProviderViewSchema).default([]),
  t2i: z.array(ProviderViewSchema).default([]),
  t2v: z.array(ProviderViewSchema).default([]),
  tts: z.array(ProviderViewSchema).default([]),
}).passthrough()
export type ProviderGroups = z.infer<typeof ProviderGroupsSchema>

export interface StageSelection { provider: string; model: string }
export interface StageModels extends JsonObject {
  script?: Partial<StageSelection>
  image?: Partial<StageSelection>
  video?: Partial<StageSelection>
  voice?: Partial<StageSelection>
  imageChain?: Array<string | { provider?: string; model?: string }>
}

export interface ProviderTestResult extends JsonObject {
  ok: boolean
  latency_ms?: number
  error?: string
}

const ImageModelOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
  cloud: z.boolean().optional(),
  configured: z.boolean().optional(),
}).passthrough()
export type ImageModelOption = z.infer<typeof ImageModelOptionSchema>

async function getRecord(path: string): Promise<JsonObject> {
  return unwrap(await api.get<ApiEnvelope<JsonObject>>(path))
}

async function postRecord(path: string, payload: JsonObject = {}): Promise<JsonObject> {
  return unwrap(await api.post<ApiEnvelope<JsonObject>>(path, payload))
}

export async function getProviders(): Promise<ProviderGroups> {
  return ProviderGroupsSchema.parse(await getRecord('/providers'))
}
export function getProviderHealth() { return getRecord('/providers/health') }

export async function getModelCatalog(modality = ''): Promise<ModelDescriptor[]> {
  const query = modality ? `?modality=${encodeURIComponent(modality)}` : ''
  return ModelDescriptorSchema.array().parse(
    unwrap(await api.get<ApiEnvelope<ModelDescriptor[]>>(`/providers/catalog${query}`)),
  )
}

export async function getImageModels(): Promise<ImageModelOption[]> {
  return ImageModelOptionSchema.array().parse(
    unwrap(await api.get<ApiEnvelope<unknown>>('/ai/image-models')),
  )
}

export function getStageModels(): Promise<StageModels> { return getRecord('/providers/stage-models') }
export function saveStageModels(patch: JsonObject) { return postRecord('/providers/stage-models', patch) }
export function saveCredentials(payload: JsonObject) { return postRecord('/providers/credentials', payload) }
export async function testProvider(payload: JsonObject): Promise<ProviderTestResult> {
  const result = await postRecord('/providers/test', payload)
  return {
    ...result,
    ok: result.ok === true,
    latency_ms: typeof result.latency_ms === 'number' ? result.latency_ms : undefined,
    error: typeof result.error === 'string' ? result.error : undefined,
  }
}
export function resetUsage() { return postRecord('/providers/usage/reset') }
