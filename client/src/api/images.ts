import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'
import type { ProjectId } from './projects'

const EntityIdSchema = z.union([z.string(), z.number()])

export const ImageCandidateSchema = z.object({
  id: EntityIdSchema,
  storyboard_id: EntityIdSchema,
  prompt: z.string().default(''),
  file_path: z.string().default(''),
  file_url: z.string().default(''),
  filename: z.string().optional(),
  gen_status: z.string().default('pending'),
  stale: z.coerce.boolean().default(false),
  stale_reason: z.string().nullish(),
  task_id: z.string().nullish(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  favorite: z.coerce.boolean().default(false),
  archived_at: z.union([z.string(), z.number()]).nullish(),
  selected: z.boolean().optional(),
}).passthrough()
export type ImageCandidate = z.infer<typeof ImageCandidateSchema> & { url: string }

const TaskSubmissionSchema = z.object({ task_id: z.string().min(1) }).passthrough()
export type TaskSubmission = z.infer<typeof TaskSubmissionSchema>

export const ImageGenerationResultSchema = z.object({
  is_placeholder: z.boolean().optional(),
  notice: z.string().optional(),
  downgraded: z.boolean().optional(),
  image_count: z.number().default(0),
  prompt: z.string().optional(),
  continuity: z.object({ warnings: z.array(z.string()).default([]) }).passthrough().optional(),
}).passthrough()
export type ImageGenerationResult = z.infer<typeof ImageGenerationResultSchema>

const BatchFailureSchema = z.object({
  storyboard_id: EntityIdSchema.optional(),
  error: z.string().optional(),
  diagnosis: z.object({ reason: z.string().optional() }).passthrough().optional(),
}).passthrough()
export const BatchImageResultSchema = z.object({
  successes: z.array(z.unknown()).default([]),
  failures: z.array(BatchFailureSchema).default([]),
}).passthrough()
export type BatchImageResult = z.infer<typeof BatchImageResultSchema>

const BatchSubmissionSchema = TaskSubmissionSchema.extend({
  target_count: z.number().int().min(0).default(0),
})
export type BatchSubmission = z.infer<typeof BatchSubmissionSchema>

const CreditInfoSchema = z.object({
  available: z.boolean().optional(),
  demo_mode: z.boolean().optional(),
  credit: z.unknown().nullable().optional(),
  total_credit: z.union([z.number(), z.string()]).optional(),
}).passthrough()
export type CreditInfo = z.infer<typeof CreditInfoSchema>

export async function listStoryboardImages(
  storyboardId: string | number,
  includeArchived = false,
): Promise<ImageCandidate[]> {
  const rows = ImageCandidateSchema.array().parse(unwrap(await api.get<ApiEnvelope<unknown>>(
    `/images/storyboard/${encodeURIComponent(storyboardId)}`,
    { params: { include_archived: includeArchived ? 'true' : undefined } },
  )))
  return rows.map((row) => ({ ...row, url: row.file_url }))
}

export async function getDreaminaCredit(): Promise<CreditInfo> {
  return CreditInfoSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/ai/dreamina-credit')))
}

export async function submitImageGeneration(payload: object): Promise<TaskSubmission> {
  return TaskSubmissionSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>('/ai/generate-image', payload)))
}

export async function submitBatchImageGeneration(projectId: ProjectId, payload: object): Promise<BatchSubmission> {
  return BatchSubmissionSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>(
    `/projects/${encodeURIComponent(projectId)}/images/generate-all`, payload,
  )))
}

export function parseImageGenerationResult(value: unknown): ImageGenerationResult {
  return ImageGenerationResultSchema.parse(value)
}

export function parseBatchImageResult(value: unknown): BatchImageResult {
  return BatchImageResultSchema.parse(value)
}

export function parseBatchSubmission(value: unknown): BatchSubmission {
  return BatchSubmissionSchema.parse(value)
}

export async function deleteImageCandidate(id: string | number): Promise<void> {
  await api.delete(`/images/${encodeURIComponent(id)}`)
}
