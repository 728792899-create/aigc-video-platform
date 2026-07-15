import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'
import type { ProjectId } from './projects'
import { EditableStoryboardSchema } from './script'

const EntityIdSchema = z.union([z.string(), z.number()])

export const PreviewStoryboardSchema = EditableStoryboardSchema.extend({
  id: EntityIdSchema,
  audio_url: z.string().nullish(),
  audio_words: z.union([z.string(), z.array(z.unknown())]).nullish(),
  motion: z.string().nullish(),
  transition: z.string().default('none'),
  sync_status: z.string().nullish(),
  quality_status: z.string().nullish(),
  sort_order: z.number().optional(),
}).passthrough()
export type PersistedPreviewStoryboard = z.infer<typeof PreviewStoryboardSchema>
export type PreviewStoryboard = PersistedPreviewStoryboard & {
  thumbnailUrl: string | null
  videoUrl: string | null
  audioUrl: string | null
  _audioDur: number
}

const TaskSubmissionSchema = z.object({ task_id: z.string().min(1) }).passthrough()

export const ExportResultSchema = z.object({
  id: EntityIdSchema.optional(),
  project_id: EntityIdSchema.optional(),
  status: z.string().optional(),
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
export type ExportResult = z.infer<typeof ExportResultSchema>

const QuickPreviewResultSchema = z.object({
  file_url: z.string().min(1),
  preview_scenes: z.number(),
  total_scenes: z.number(),
  video_speed: z.number().optional(),
  duration: z.number().optional(),
}).passthrough()
export type QuickPreviewResult = z.infer<typeof QuickPreviewResultSchema>

export async function listPreviewStoryboards(projectId: ProjectId): Promise<PersistedPreviewStoryboard[]> {
  return PreviewStoryboardSchema.array().parse(unwrap(await api.get<ApiEnvelope<unknown>>(
    `/storyboards/project/${encodeURIComponent(projectId)}`,
  )))
}

export async function updatePreviewStoryboard(
  storyboardId: string | number,
  patch: object,
): Promise<PersistedPreviewStoryboard> {
  return PreviewStoryboardSchema.parse(unwrap(await api.put<ApiEnvelope<unknown>>(
    `/storyboards/${encodeURIComponent(storyboardId)}`, patch,
  )))
}

export async function reorderPreviewStoryboards(
  projectId: ProjectId,
  orders: Array<{ id: string | number; sort_order: number }>,
): Promise<void> {
  await api.put(`/storyboards/reorder/${encodeURIComponent(projectId)}`, { orders })
}

export async function generateStoryboardVoice(payload: {
  storyboard_id: string | number
  text: string
  voice?: string
}): Promise<void> {
  await api.post('/ai/generate-tts', payload)
}

export async function requestStoryboardImage(payload: {
  storyboard_id: string | number
  ratio: string
  batch_size: number
}): Promise<void> {
  await api.post('/ai/generate-image', payload)
}

export async function submitVideoCompose(
  projectId: ProjectId,
  options: Record<string, unknown>,
): Promise<string> {
  const submission = TaskSubmissionSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>('/video/compose', {
    project_id: projectId,
    async: true,
    options,
  })))
  return submission.task_id
}

export function parseExportResult(value: unknown): ExportResult {
  return ExportResultSchema.parse(value)
}

export async function composeQuickPreview(
  projectId: ProjectId,
  options: Record<string, unknown>,
): Promise<QuickPreviewResult> {
  return QuickPreviewResultSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>('/video/preview-compose', {
    project_id: projectId,
    options,
    limit: 3,
  })))
}
