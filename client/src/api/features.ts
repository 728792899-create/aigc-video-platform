import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import { API_URL } from './config'
import api, { unwrap } from './index'

type EntityId = string | number
type JsonObject = Record<string, unknown>
type SpeedOptions = { videoSpeed?: number }

const JsonObjectSchema = z.record(z.string(), z.unknown())
const EntityIdSchema = z.union([z.string(), z.number()])

export const ExportRecordSchema = z.object({
  id: EntityIdSchema,
  project_id: EntityIdSchema,
  status: z.string(),
  file_url: z.string().nullish(),
  file_path: z.string().nullish(),
  duration: z.number().nullish(),
  chapter_count: z.number().nullish(),
  long_video_mode: z.union([z.number(), z.boolean()]).nullish(),
  video_speed: z.number().nullish(),
  external_file_path: z.string().nullish(),
  external_copy_status: z.string().nullish(),
  external_copy_error: z.string().nullish(),
  created_at: z.union([z.string(), z.number()]).nullish(),
}).passthrough()
export type ExportRecord = z.infer<typeof ExportRecordSchema>

export const ExportLocationSchema = z.object({
  library_directory: z.string().default(''),
  library_url_rule: z.string().default('/uploads/videos/...'),
  default_directory: z.string().default(''),
  has_custom_default: z.boolean().default(false),
})
export type ExportLocation = z.infer<typeof ExportLocationSchema>

const TimelineSceneSchema = z.object({
  storyboard_id: EntityIdSchema,
  duration_ms: z.number().positive(),
  original_duration_ms: z.number().positive(),
  sync_status: z.string(),
}).passthrough()
const ProjectTimelineSchema = z.object({
  project_id: z.number(),
  video_speed: z.number(),
  scene_count: z.number(),
  total_duration_ms: z.number(),
  original_total_duration_ms: z.number(),
  total_duration: z.number(),
  original_total_duration: z.number(),
  scenes: z.array(TimelineSceneSchema),
  subtitles: z.array(z.unknown()),
}).passthrough()
export type ProjectTimeline = z.infer<typeof ProjectTimelineSchema>

export const PresetSchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  description: z.string().default(''),
  config: JsonObjectSchema.default({}),
  is_builtin: z.boolean().default(false),
}).passthrough()
export type Preset = z.infer<typeof PresetSchema>

export const SnapshotSchema = z.object({
  id: EntityIdSchema,
  project_id: EntityIdSchema.optional(),
  label: z.string(),
  storyboard_count: z.number().default(0),
  created_at: z.union([z.string(), z.number()]).optional(),
}).passthrough()
export type Snapshot = z.infer<typeof SnapshotSchema>

const SuggestionSchema = z.object({
  id: EntityIdSchema,
  scene_number: z.number(),
  current: z.number(),
  suggested: z.number(),
}).passthrough()
const DurationSuggestionsSchema = z.object({
  suggestions: z.array(SuggestionSchema).default([]),
  applied: z.boolean(),
}).passthrough()
export type DurationSuggestions = z.infer<typeof DurationSuggestionsSchema>

export function listLibrary(): Promise<JsonObject[]> {
  return api.get<ApiEnvelope<JsonObject[]>>('/video/library').then(unwrap)
}

export function deleteExport(id: EntityId): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>(`/video/exports/${encodeURIComponent(id)}`).then((response) => response.data)
}

export async function projectExports(projectId: EntityId): Promise<ExportRecord[]> {
  return ExportRecordSchema.array().parse(unwrap(await api.get<ApiEnvelope<unknown>>(`/video/exports/${encodeURIComponent(projectId)}`)))
}

export async function getExportLocation(): Promise<ExportLocation> {
  return ExportLocationSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/video/export-location')))
}

export async function getProjectTimeline(projectId: EntityId, { videoSpeed = 1 }: SpeedOptions = {}): Promise<ProjectTimeline> {
  return ProjectTimelineSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>(`/projects/${encodeURIComponent(projectId)}/timeline`, {
    params: { videoSpeed },
  })))
}

export async function rebuildProjectTimeline(projectId: EntityId, { videoSpeed = 1 }: SpeedOptions = {}): Promise<ProjectTimeline> {
  return ProjectTimelineSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>(`/projects/${encodeURIComponent(projectId)}/timeline/rebuild`, {
    videoSpeed,
  })))
}

export function srtDownloadUrl(projectId: EntityId): string {
  return `${API_URL}/subtitle/project/${encodeURIComponent(projectId)}/download`
}

export function batchUpdateStoryboards(ids: EntityId[], patch: JsonObject): Promise<ApiEnvelope<{ updated: number; fields: string[] }>> {
  return api.post<ApiEnvelope<{ updated: number; fields: string[] }>>('/storyboards/batch-update', { ids, patch }).then((response) => response.data)
}

export function suggestDuration(
  projectId: EntityId,
  { apply = false, speed = 1 }: { apply?: boolean; speed?: number } = {},
): Promise<DurationSuggestions> {
  return api.get<ApiEnvelope<unknown>>(`/storyboards/suggest-duration/${encodeURIComponent(projectId)}`, {
    params: { apply, speed },
  }).then(unwrap).then((value) => DurationSuggestionsSchema.parse(value))
}

export async function listPresets(): Promise<Preset[]> {
  return PresetSchema.array().parse(unwrap(await api.get<ApiEnvelope<unknown>>('/presets')))
}

export function createPreset(payload: JsonObject): Promise<JsonObject> {
  return api.post<ApiEnvelope<JsonObject>>('/presets', payload).then(unwrap)
}

export function updatePreset(id: EntityId, payload: JsonObject): Promise<JsonObject> {
  return api.put<ApiEnvelope<JsonObject>>(`/presets/${encodeURIComponent(id)}`, payload).then(unwrap)
}

export function deletePreset(id: EntityId): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>(`/presets/${encodeURIComponent(id)}`).then((response) => response.data)
}

export async function listSnapshots(projectId: EntityId): Promise<Snapshot[]> {
  return SnapshotSchema.array().parse(unwrap(await api.get<ApiEnvelope<unknown>>(`/snapshots/project/${encodeURIComponent(projectId)}`)))
}

export function createSnapshot(projectId: EntityId, label: string): Promise<Snapshot> {
  return api.post<ApiEnvelope<Snapshot>>(`/snapshots/project/${encodeURIComponent(projectId)}`, { label }).then(unwrap).then((value) => SnapshotSchema.parse(value))
}

export function restoreSnapshot(id: EntityId): Promise<ApiEnvelope<JsonObject>> {
  return api.post<ApiEnvelope<JsonObject>>(`/snapshots/${encodeURIComponent(id)}/restore`).then((response) => response.data)
}

export function deleteSnapshot(id: EntityId): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>(`/snapshots/${encodeURIComponent(id)}`).then((response) => response.data)
}

export function listVoices(): Promise<JsonObject[]> {
  return api.get<ApiEnvelope<JsonObject[]>>('/ai/voices').then(unwrap)
}

export interface VoicePreviewOptions {
  voice?: string
  speed?: number
  pitch?: number
  text?: string
  emotion?: string
  volume?: number
}

export function voicePreview(options: VoicePreviewOptions = {}): Promise<{ file_url: string }> {
  return api.post<ApiEnvelope<{ file_url: string }>>('/ai/voice-preview', options).then(unwrap)
}
