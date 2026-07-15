import {
  AssetBindingSchema,
  AssetUnitSchema,
  AssetVariantSchema,
  type ApiEnvelope,
  type AssetBinding,
  type AssetUnit,
  type AssetVariant,
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

export async function createAssetUnit(projectId: EntityId, payload: JsonObject): Promise<AssetUnit> {
  return AssetUnitSchema.parse(unwrap(await api.post<ApiEnvelope<AssetUnit>>(
    `/assets/projects/${encodeURIComponent(projectId)}/units`, payload,
  )))
}

export async function addAssetVariant(unitId: EntityId, payload: JsonObject): Promise<AssetVariant> {
  return AssetVariantSchema.parse(unwrap(await api.post<ApiEnvelope<AssetVariant>>(
    `/assets/units/${encodeURIComponent(unitId)}/variants`, payload,
  )))
}

export async function bindAssetVariant(storyboardId: EntityId, payload: JsonObject): Promise<AssetBinding> {
  return AssetBindingSchema.parse(unwrap(await api.put<ApiEnvelope<AssetBinding>>(
    `/assets/storyboards/${encodeURIComponent(storyboardId)}/bindings`, payload,
  )))
}

export async function selectAssetVariant(characterId: EntityId, variantId: EntityId): Promise<AssetVariant> {
  return AssetVariantSchema.parse(unwrap(await api.post<ApiEnvelope<AssetVariant>>(
    `/assets/characters/${encodeURIComponent(characterId)}/variants/${encodeURIComponent(variantId)}/select`,
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
