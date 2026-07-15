import {
  AssetBindingSchema,
  AssetUnitSchema,
  AssetVariantSchema,
  type ApiEnvelope,
  type AssetBinding,
  type AssetBindingUpdate,
  type AssetBatchBinding,
  type AssetUnit,
  type AssetUnitCreate,
  type AssetVariant,
  type AssetVariantCreate,
} from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'
import { ImageCandidateSchema, type ImageCandidate } from './images'

type EntityId = string | number
type JsonObject = Record<string, unknown>

const AssetLibrarySchema = z.object({
  units: z.array(AssetUnitSchema),
  bindings: z.array(AssetBindingSchema),
  supported_asset_types: z.array(z.string()),
  resolution_order: z.array(z.string()),
})
export type AssetLibraryView = z.infer<typeof AssetLibrarySchema>

export async function getAssetLibrary(projectId: EntityId): Promise<AssetLibraryView> {
  return AssetLibrarySchema.parse(unwrap(await api.get<ApiEnvelope<AssetLibraryView>>(
    `/assets/projects/${encodeURIComponent(projectId)}`,
  )))
}

export async function createAssetUnit(projectId: EntityId, payload: AssetUnitCreate): Promise<AssetUnit> {
  return AssetUnitSchema.parse(unwrap(await api.post<ApiEnvelope<AssetUnit>>(
    `/assets/projects/${encodeURIComponent(projectId)}/units`, payload,
  )))
}

export async function addAssetVariant(unitId: EntityId, payload: AssetVariantCreate): Promise<AssetVariant> {
  return AssetVariantSchema.parse(unwrap(await api.post<ApiEnvelope<AssetVariant>>(
    `/assets/units/${encodeURIComponent(unitId)}/variants`, payload,
  )))
}

export async function addCharacterAssetVariant(
  characterId: EntityId,
  projectId: EntityId,
  payload: AssetVariantCreate,
): Promise<AssetVariant> {
  return AssetVariantSchema.parse(unwrap(await api.post<ApiEnvelope<AssetVariant>>(
    `/assets/characters/${encodeURIComponent(characterId)}/variants`,
    { ...payload, project_id: Number(projectId) },
  )))
}

export async function bindAssetVariant(storyboardId: EntityId, payload: AssetBindingUpdate): Promise<AssetBinding> {
  return AssetBindingSchema.parse(unwrap(await api.put<ApiEnvelope<AssetBinding>>(
    `/assets/storyboards/${encodeURIComponent(storyboardId)}/bindings`, payload,
  )))
}

export async function selectAssetVariant(characterId: EntityId, variantId: EntityId): Promise<AssetVariant> {
  return AssetVariantSchema.parse(unwrap(await api.post<ApiEnvelope<AssetVariant>>(
    `/assets/characters/${encodeURIComponent(characterId)}/variants/${encodeURIComponent(variantId)}/select`,
  )))
}

export async function selectUnitVariant(unitId: EntityId, variantId: EntityId): Promise<AssetVariant> {
  return AssetVariantSchema.parse(unwrap(await api.post<ApiEnvelope<AssetVariant>>(
    `/assets/units/${encodeURIComponent(unitId)}/variants/${encodeURIComponent(variantId)}/select`,
  )))
}

export async function archiveAssetVariant(variantId: EntityId): Promise<AssetVariant> {
  return AssetVariantSchema.parse(unwrap(await api.delete<ApiEnvelope<AssetVariant>>(
    `/assets/variants/${encodeURIComponent(variantId)}`,
  )))
}

export async function forkAssetUnit(unitId: EntityId, payload: {
  project_id: number
  series_id: number
  variant_id?: EntityId
}): Promise<{ unit: AssetUnit; variant: AssetVariant }> {
  const schema = z.object({ unit: AssetUnitSchema, variant: AssetVariantSchema })
  return schema.parse(unwrap(await api.post<ApiEnvelope<unknown>>(
    `/assets/units/${encodeURIComponent(unitId)}/fork`, payload,
  )))
}

export async function batchBindAssetVariant(payload: AssetBatchBinding): Promise<{
  changed_storyboard_ids: number[]
  skipped_storyboard_ids: number[]
  conflicts: Array<{ storyboard_id: number; code: string; message: string }>
}> {
  const schema = z.object({
    changed_storyboard_ids: z.array(z.number()), skipped_storyboard_ids: z.array(z.number()),
    conflicts: z.array(z.object({ storyboard_id: z.number(), code: z.string(), message: z.string() })),
  })
  return schema.parse(unwrap(await api.post<ApiEnvelope<unknown>>('/assets/bindings/batch', payload)))
}

export async function getAssetImpact(projectId: EntityId, unitId: EntityId): Promise<{
  affected_storyboard_ids: number[]
  forks: Array<Record<string, unknown>>
}> {
  const schema = z.object({ affected_storyboard_ids: z.array(z.number()), forks: z.array(z.record(z.string(), z.unknown())) }).passthrough()
  return schema.parse(unwrap(await api.get<ApiEnvelope<unknown>>(
    `/assets/projects/${encodeURIComponent(projectId)}/impact`, { params: { unit_id: String(unitId) } },
  )))
}

export async function selectCandidate(candidateId: EntityId, storyboardId: EntityId): Promise<ImageCandidate> {
  const candidate = ImageCandidateSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>(`/images/${encodeURIComponent(candidateId)}/select`, {
    storyboard_id: storyboardId,
  })))
  return { ...candidate, url: candidate.file_url }
}

export async function reviewCandidate(candidateId: EntityId, patch: JsonObject): Promise<ImageCandidate> {
  const candidate = ImageCandidateSchema.parse(unwrap(await api.put<ApiEnvelope<unknown>>(`/images/${encodeURIComponent(candidateId)}/review`, patch)))
  return { ...candidate, url: candidate.file_url }
}
