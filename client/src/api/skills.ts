import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'

type EntityId = string | number
type JsonObject = Record<string, unknown>

export const CreativeSkillSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  stage: z.string().default('all'),
  description: z.string().default(''),
  prompt: z.string().default(''),
  icon: z.string().default('✨'),
  enabled: z.coerce.boolean().default(true),
  auto_apply: z.coerce.boolean().default(false),
  is_builtin: z.coerce.boolean().default(false),
  source: z.string().optional(),
}).passthrough()
export type CreativeSkill = z.infer<typeof CreativeSkillSchema>

export const SkillVersionSchema = z.object({
  id: z.union([z.string(), z.number()]),
  skill_id: z.union([z.string(), z.number()]),
  summary: z.string().nullish(),
  created_at: z.union([z.string(), z.number()]).nullish(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
}).passthrough()
export type SkillVersion = z.infer<typeof SkillVersionSchema>

export async function listSkills(stage?: string, enabledOnly = false): Promise<CreativeSkill[]> {
  const params: Record<string, string | number> = {}
  if (stage) params.stage = stage
  if (enabledOnly) params.enabled_only = 1
  return CreativeSkillSchema.array().parse(unwrap(await api.get<ApiEnvelope<CreativeSkill[]>>('/skills', { params })))
}

export function getSkill(id: EntityId): Promise<CreativeSkill> {
  return api.get<ApiEnvelope<CreativeSkill>>(`/skills/${encodeURIComponent(id)}`).then(unwrap).then((value) => CreativeSkillSchema.parse(value))
}

export function createSkill(payload: JsonObject): Promise<CreativeSkill> {
  return api.post<ApiEnvelope<CreativeSkill>>('/skills', payload).then(unwrap).then((value) => CreativeSkillSchema.parse(value))
}

export function updateSkill(id: EntityId, payload: JsonObject): Promise<CreativeSkill> {
  return api.put<ApiEnvelope<CreativeSkill>>(`/skills/${encodeURIComponent(id)}`, payload).then(unwrap).then((value) => CreativeSkillSchema.parse(value))
}

export function deleteSkill(id: EntityId): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>(`/skills/${encodeURIComponent(id)}`).then((response) => response.data)
}

export function restoreBuiltinSkills(): Promise<{ restored: number }> {
  return api.post<ApiEnvelope<{ restored: number }>>('/skills/restore-builtins').then(unwrap)
}

export async function listSkillVersions(id: EntityId): Promise<SkillVersion[]> {
  return SkillVersionSchema.array().parse(unwrap(await api.get<ApiEnvelope<SkillVersion[]>>(`/skills/${encodeURIComponent(id)}/versions`)))
}

export function restoreSkillVersion(id: EntityId, versionId: EntityId): Promise<CreativeSkill> {
  return api.post<ApiEnvelope<CreativeSkill>>(
    `/skills/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
  ).then(unwrap).then((value) => CreativeSkillSchema.parse(value))
}

export function importSkills(list: JsonObject[]): Promise<{ imported: number }> {
  return api.post<ApiEnvelope<{ imported: number }>>('/skills/import', list).then(unwrap)
}

export async function listActiveSkills(stage?: string): Promise<CreativeSkill[]> {
  const params: Record<string, string> = {}
  if (stage) params.stage = stage
  return CreativeSkillSchema.array().parse(unwrap(await api.get<ApiEnvelope<CreativeSkill[]>>('/skills/active', { params })))
}
