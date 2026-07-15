import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'

type EntityId = string | number
type JsonObject = Record<string, unknown>

export interface HistoryQuery {
  type?: string
  status?: string
  page?: number
  pageSize?: number
  [key: string]: unknown
}

export const HistoryRecordSchema = z.object({
  id: z.union([z.string(), z.number()]),
  type: z.string().default(''),
  status: z.string().default(''),
  theme: z.string().nullish(),
  project_name: z.string().nullish(),
  message: z.string().nullish(),
  error: z.string().nullish(),
  project_id: z.union([z.string(), z.number()]).nullish(),
  project_exists: z.coerce.boolean().default(false),
  created_at: z.union([z.string(), z.number()]).nullish(),
  diagnosis: z.unknown().optional(),
  meta: z.record(z.string(), z.unknown()).nullish(),
  result: z.record(z.string(), z.unknown()).nullish(),
}).passthrough()
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>

const HistoryPageSchema = z.object({
  list: z.array(HistoryRecordSchema).default([]),
  total: z.number().default(0),
  page: z.number().optional(),
  pageSize: z.number().optional(),
}).passthrough()
export type HistoryPage = z.infer<typeof HistoryPageSchema>

export function getHistory(params: HistoryQuery = {}): Promise<HistoryPage> {
  return api.get<ApiEnvelope<HistoryPage>>('/history', { params }).then(unwrap).then((value) => HistoryPageSchema.parse(value))
}

export function retryHistory(id: EntityId, payload: JsonObject = {}): Promise<JsonObject> {
  return api.post<ApiEnvelope<JsonObject>>(`/history/${encodeURIComponent(id)}/retry`, payload).then(unwrap)
}

export function deleteHistory(id: EntityId): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>(`/history/${encodeURIComponent(id)}`).then((response) => response.data)
}

export function deleteHistoryBatch(payload: { ids?: EntityId[]; all?: boolean }): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>('/history', { data: payload }).then((response) => response.data)
}
