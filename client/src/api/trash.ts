import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'

type EntityId = string | number
type JsonObject = Record<string, unknown>
export type TrashCategory = 'all' | string

export const TrashDetailItemSchema = z.object({
  key: z.string(),
  type: z.string().optional(),
  label: z.string().optional(),
  name: z.string().optional(),
  path: z.string().optional(),
  restorable: z.boolean().optional(),
}).passthrough()
export type TrashDetailItem = z.infer<typeof TrashDetailItemSchema>

export const TrashRecordSchema = z.object({
  id: z.union([z.string(), z.number()]),
  trash_id: z.union([z.string(), z.number()]).optional(),
  row_key: z.string().optional(),
  category: z.string().default('mixed'),
  entity_type: z.string().optional(),
  group_key: z.string().nullish(),
  group_label: z.string().nullish(),
  name: z.string().nullish(),
  summary: z.string().nullish(),
  file_count: z.number().default(0),
  deleted_at: z.union([z.number(), z.string()]).nullish(),
  expires_at: z.number().default(0),
}).passthrough()
export type TrashRecord = z.infer<typeof TrashRecordSchema>

export const TrashDetailSchema = TrashRecordSchema.extend({
  details: z.array(TrashDetailItemSchema).default([]),
})
export type TrashDetail = z.infer<typeof TrashDetailSchema>

export const OperationLogSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  created_at: z.union([z.string(), z.number()]).nullish(),
  action_label: z.string().default(''),
  target_type: z.string().nullish(),
  target_id: z.union([z.string(), z.number()]).nullish(),
  detail: z.unknown(),
}).passthrough()
export type OperationLog = z.infer<typeof OperationLogSchema>

export interface TrashMutationResult extends JsonObject { trashRemoved?: boolean }

export function listTrash(category: TrashCategory = 'all'): Promise<TrashRecord[]> {
  return api.get<ApiEnvelope<TrashRecord[]>>('/trash', { params: { category } }).then(unwrap)
    .then((value) => TrashRecordSchema.array().parse(value))
}

export function getTrashDetail(id: EntityId, groupKey: string | null = null): Promise<TrashDetail> {
  return api.get<ApiEnvelope<TrashDetail>>(`/trash/${encodeURIComponent(id)}`, {
    params: groupKey ? { group_key: groupKey } : {},
  }).then(unwrap).then((value) => TrashDetailSchema.parse(value))
}

export function restoreTrash(id: EntityId): Promise<ApiEnvelope<JsonObject>> {
  return api.post<ApiEnvelope<JsonObject>>(`/trash/${encodeURIComponent(id)}/restore`).then((response) => response.data)
}

export function restoreTrashItems(id: EntityId, keys: string[]): Promise<ApiEnvelope<TrashMutationResult>> {
  return api.post<ApiEnvelope<TrashMutationResult>>(`/trash/${encodeURIComponent(id)}/restore-items`, { keys })
    .then((response) => response.data)
}

export function purgeTrashItems(id: EntityId, keys: string[]): Promise<ApiEnvelope<TrashMutationResult>> {
  return api.delete<ApiEnvelope<TrashMutationResult>>(`/trash/${encodeURIComponent(id)}/items`, { data: { keys } })
    .then((response) => response.data)
}

export function purgeTrash(id: EntityId): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>(`/trash/${encodeURIComponent(id)}`).then((response) => response.data)
}

export function emptyTrash(): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>('/trash').then((response) => response.data)
}

export function listLogs(limit = 100): Promise<OperationLog[]> {
  return api.get<ApiEnvelope<OperationLog[]>>('/logs', { params: { limit } }).then(unwrap)
    .then((value) => OperationLogSchema.array().parse(value))
}
