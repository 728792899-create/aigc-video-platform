import {
  PromptRevisionSchema,
  type ApiEnvelope,
  type PromptKind,
  type PromptRevision,
  type PromptRevisionCreate,
  type SceneRegeneration,
} from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'
import type { ProjectId } from './projects'

type EntityId = string | number

const PromptDiffSchema = z.object({
  current: PromptRevisionSchema,
  against: PromptRevisionSchema.nullable(),
  lines: z.array(z.object({ type: z.enum(['same', 'added', 'removed']), line: z.string() })),
})
export type PromptDiff = z.infer<typeof PromptDiffSchema>

const RegenerationTaskSchema = z.object({
  task_id: z.string().min(1),
  storyboard_id: z.number().int().positive(),
  stages: z.array(z.enum(['image', 'voice', 'video'])),
})
export type RegenerationTask = z.infer<typeof RegenerationTaskSchema>

export async function listPromptRevisions(
  projectId: ProjectId,
  storyboardId: EntityId | null,
  kind: PromptKind,
): Promise<PromptRevision[]> {
  return PromptRevisionSchema.array().parse(unwrap(await api.get<ApiEnvelope<unknown>>(
    `/projects/${encodeURIComponent(projectId)}/prompts`,
    { params: { storyboard_id: storyboardId, kind } },
  )))
}

export async function createPromptRevision(
  projectId: ProjectId,
  payload: PromptRevisionCreate,
): Promise<PromptRevision> {
  return PromptRevisionSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>(
    `/projects/${encodeURIComponent(projectId)}/prompts`, payload,
  )))
}

export async function diffPromptRevision(id: string, against?: string): Promise<PromptDiff> {
  return PromptDiffSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>(
    `/prompts/${encodeURIComponent(id)}/diff`, { params: against ? { against } : undefined },
  )))
}

export async function restorePromptRevision(id: string): Promise<PromptRevision> {
  return PromptRevisionSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>(
    `/prompts/${encodeURIComponent(id)}/restore`, {},
  )))
}

export async function regenerateStoryboard(
  storyboardId: EntityId,
  payload: SceneRegeneration,
): Promise<RegenerationTask> {
  return RegenerationTaskSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>(
    `/storyboards/${encodeURIComponent(storyboardId)}/regenerate`, payload,
    { headers: payload.idempotencyKey ? { 'Idempotency-Key': payload.idempotencyKey } : undefined },
  )))
}
