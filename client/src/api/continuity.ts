import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'

type EntityId = string | number
export type ContinuityPayload = Record<string, unknown>

export const StoryBibleSchema = z.object({
  worldview: z.string().default(''),
  mainline: z.string().default(''),
  previous_summary: z.string().default(''),
  locked_facts: z.string().default(''),
  scene_rules: z.string().default(''),
}).passthrough()
export type StoryBible = z.infer<typeof StoryBibleSchema>

export const CharacterAssetSchema = z.object({
  id: z.union([z.string(), z.number()]),
  file_url: z.string().optional(),
  file_path: z.string().optional(),
  status: z.string().optional(),
  archived_at: z.union([z.string(), z.number()]).nullish(),
}).passthrough()
export type CharacterAsset = z.infer<typeof CharacterAssetSchema>
export const ContinuityRecordSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().default(''),
  role: z.string().nullish(),
  locked: z.coerce.boolean().default(false),
  prompt_anchor: z.string().default(''),
  assets: z.array(CharacterAssetSchema).default([]),
}).passthrough()
export type ContinuityRecord = z.infer<typeof ContinuityRecordSchema>

function projectPath(projectId: EntityId, suffix: string): string {
  return `/projects/${encodeURIComponent(projectId)}/${suffix}`
}

async function getRecord(path: string): Promise<ContinuityPayload> {
  return unwrap(await api.get<ApiEnvelope<ContinuityPayload>>(path))
}

async function postRecord(path: string, payload: ContinuityPayload = {}): Promise<ContinuityPayload> {
  return unwrap(await api.post<ApiEnvelope<ContinuityPayload>>(path, payload))
}

export async function getStoryBible(projectId: EntityId): Promise<StoryBible> {
  return StoryBibleSchema.parse(await getRecord(projectPath(projectId, 'story-bible')))
}

export async function updateStoryBible(projectId: EntityId, payload: ContinuityPayload): Promise<StoryBible> {
  return StoryBibleSchema.parse(unwrap(await api.put<ApiEnvelope<ContinuityPayload>>(projectPath(projectId, 'story-bible'), payload)))
}

export async function listCharacters(projectId: EntityId): Promise<ContinuityRecord[]> {
  return ContinuityRecordSchema.array().parse(unwrap(await api.get<ApiEnvelope<ContinuityRecord[]>>(projectPath(projectId, 'characters'))))
}

export async function extractCharacters(projectId: EntityId, force = false): Promise<ContinuityRecord[]> {
  return ContinuityRecordSchema.array().parse(await postRecord(projectPath(projectId, 'characters/extract'), { force }))
}

export function autoLockCharacters(projectId: EntityId) {
  return postRecord(projectPath(projectId, 'characters/auto-lock'))
}

export async function updateCharacter(characterId: EntityId, payload: ContinuityPayload): Promise<ContinuityRecord> {
  return ContinuityRecordSchema.parse(unwrap(await api.put<ApiEnvelope<ContinuityRecord>>(`/characters/${encodeURIComponent(characterId)}`, payload)))
}

export async function lockCharacter(characterId: EntityId, locked = true): Promise<ContinuityRecord> {
  return ContinuityRecordSchema.parse(await postRecord(`/characters/${encodeURIComponent(characterId)}/lock`, { locked }))
}

export async function addCharacterReference(characterId: EntityId, payload: ContinuityPayload): Promise<CharacterAsset> {
  return CharacterAssetSchema.parse(await postRecord(`/characters/${encodeURIComponent(characterId)}/reference-images`, payload))
}

export function continueProject(projectId: EntityId, payload: ContinuityPayload = {}) {
  return postRecord(projectPath(projectId, 'continue'), payload)
}

export function checkContinuity(projectId: EntityId, payload: ContinuityPayload = {}) {
  return postRecord(projectPath(projectId, 'continuity/check'), payload)
}

export function repairContinuity(projectId: EntityId, payload: ContinuityPayload = {}) {
  return postRecord(projectPath(projectId, 'continuity/repair'), payload)
}
