import { SemanticVersionSchema, type ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'
import type { ProjectId } from './projects'

const EntityIdSchema = z.union([z.string(), z.number()])
const JsonObjectSchema = z.record(z.string(), z.unknown())

export const EditableStoryboardSchema = z.object({
  id: EntityIdSchema.optional(),
  project_id: EntityIdSchema.optional(),
  scene_number: z.coerce.number().int().positive().default(1),
  description: z.string().default(''),
  dialog: z.string().default(''),
  duration: z.coerce.number().positive().default(5),
  prompt: z.string().optional(),
  subtitle_text: z.string().nullish(),
  selected_image_id: EntityIdSchema.nullish(),
  voice: z.string().nullish(),
  no_voice: z.coerce.boolean().optional(),
  chapter_index: z.coerce.number().int().positive().optional(),
  chapter_title: z.string().nullish(),
  selected_image_url: z.string().nullish(),
  videoUrl: z.string().nullish(),
  characters_in_scene: z.union([z.string(), z.array(JsonObjectSchema)]).optional(),
  assets_stale: z.coerce.boolean().optional(),
  stale_reason: z.string().nullish(),
  _expanding: z.boolean().optional(),
}).passthrough()
export type EditableStoryboard = z.infer<typeof EditableStoryboardSchema>

export const ScriptResultSchema = z.object({
  schema_version: SemanticVersionSchema.optional(),
  title: z.string().default(''),
  summary: z.string().default(''),
  prompt_version: z.string().optional(),
  language: z.string().optional(),
  visual_anchor: z.string().optional(),
  generation: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
  }).passthrough().optional(),
  storyboards: z.array(EditableStoryboardSchema).default([]),
  quality_warnings: z.array(z.string()).optional(),
  _warnings: z.array(z.string()).optional(),
  narration_stats: z.object({
    char_count: z.number(),
    chars_per_second: z.number(),
    storyboard_duration_sec: z.number(),
    estimated_narration_sec: z.number(),
    target_duration_sec: z.number(),
    narration_coverage: z.number(),
  }).passthrough().optional(),
}).passthrough()
export type ScriptResult = z.infer<typeof ScriptResultSchema>

const ArtifactMetadataSchema = z.object({
  id: EntityIdSchema,
  stage: z.string(),
  revision: z.coerce.number().int().positive(),
  status: z.string(),
}).passthrough()
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>

const ArtifactStateSchema = z.object({
  current: z.array(ArtifactMetadataSchema).default([]),
  stale: z.array(ArtifactMetadataSchema).default([]),
  history: z.array(ArtifactMetadataSchema).default([]),
})
export type ArtifactState = z.infer<typeof ArtifactStateSchema>

const WorkbenchStatusSchema = z.object({
  status: z.string().optional(),
  status_label: z.string().optional(),
  summary: z.string().optional(),
  next_action: z.string().optional(),
  current_step: z.string().optional(),
  progress_steps: z.array(z.object({ key: z.string(), label: z.string(), done: z.boolean().optional() })).optional(),
  repair_items: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  primary_action: z.object({ label: z.string(), type: z.string().optional() }).passthrough().optional(),
  continuity_checks: z.array(z.object({
    image_id: EntityIdSchema.optional(),
    status: z.string(),
  }).passthrough()).optional(),
}).passthrough()
export type WorkbenchStatus = z.infer<typeof WorkbenchStatusSchema>
export type WorkbenchAction = NonNullable<WorkbenchStatus['primary_action']>

const ReconcileResultSchema = z.object({
  regenerate_ids: z.array(EntityIdSchema).default([]),
  storyboards: z.array(EditableStoryboardSchema).default([]),
}).passthrough()
export type ReconcileResult = z.infer<typeof ReconcileResultSchema>

export interface GenerateScriptInput {
  theme: string
  duration: string
  durationPreset: string
  durationMode: 'tolerance'
  targetDurationSec: number
  style: string
  scriptProvider?: string
  scriptModel?: string
  detailLevel: string
  skill_ids?: Array<string | number>
  project_id: ProjectId
}

async function getAndParse<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(unwrap(await api.get<ApiEnvelope<unknown>>(path)))
}

async function postAndParse<T>(path: string, payload: object, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(unwrap(await api.post<ApiEnvelope<unknown>>(path, payload)))
}

export function listStoryboards(projectId: ProjectId): Promise<EditableStoryboard[]> {
  return getAndParse(`/storyboards/project/${encodeURIComponent(projectId)}`, EditableStoryboardSchema.array())
}

export function getArtifactState(projectId: ProjectId): Promise<ArtifactState> {
  return getAndParse(`/projects/${encodeURIComponent(projectId)}/artifacts`, ArtifactStateSchema)
}

export function getScriptWorkbenchStatus(projectId: ProjectId): Promise<WorkbenchStatus> {
  return getAndParse(`/projects/${encodeURIComponent(projectId)}/workbench-status`, WorkbenchStatusSchema)
}

export function optimizeScriptTheme(payload: {
  theme: string
  style: string
  scriptProvider?: string
  scriptModel?: string
}): Promise<{ theme: string; original: string }> {
  return postAndParse('/ai/optimize-theme', payload, z.object({ theme: z.string().min(1), original: z.string() }))
}

export function generateStructuredScript(payload: GenerateScriptInput): Promise<ScriptResult> {
  return postAndParse('/ai/generate-script', payload, ScriptResultSchema)
}

export function expandStoryboardDialog(payload: {
  dialog: string
  storyboard_id?: string | number
  detailLevel: 'rich'
  skill_ids?: Array<string | number>
}): Promise<{ dialog: string }> {
  return postAndParse('/ai/expand-dialog', payload, z.object({ dialog: z.string().min(1) }))
}

export function reconcileStoryboards(payload: {
  project_id: ProjectId
  storyboards: EditableStoryboard[]
  visual_anchor?: string
  script_result?: ScriptResult
  duration_min: number
  duration_max: number
  targetDurationSec: number
  durationPreset: string
  durationMode: 'tolerance'
}): Promise<ReconcileResult> {
  return postAndParse('/storyboards/reconcile', payload, ReconcileResultSchema)
}

export function submitStoryboardImage(storyboardId: string | number): Promise<Record<string, unknown>> {
  return postAndParse('/ai/generate-image', {
    storyboard_id: storyboardId,
    async: true,
    batch_size: 1,
    repair_mode: true,
    auto_select_best: true,
    reuse_cache: false,
  }, JsonObjectSchema)
}

export function submitStoryboardVoice(storyboard: EditableStoryboard): Promise<Record<string, unknown>> {
  return postAndParse('/ai/generate-tts', {
    text: storyboard.dialog,
    storyboard_id: storyboard.id,
    voice: storyboard.voice || undefined,
  }, JsonObjectSchema)
}
