import { z } from 'zod'

const JsonRecordSchema = z.record(z.string(), z.unknown())

export const AppErrorPayloadSchema = z.object({
  code: z.string().min(1),
  userMessage: z.string().min(1),
  technicalMessage: z.string().optional(),
  retryable: z.boolean(),
  taskId: z.string().optional(),
  correlationId: z.string().optional(),
  details: JsonRecordSchema.optional(),
  timestamp: z.union([z.string(), z.number()]),
})
export type AppErrorPayload = z.infer<typeof AppErrorPayloadSchema>

export interface ApiEnvelope<T> {
  code: number
  data: T
  message: string
  request_id?: string
  error?: AppErrorPayload
}

export function apiEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    code: z.number(),
    data: dataSchema,
    message: z.string(),
    request_id: z.string().optional(),
    error: AppErrorPayloadSchema.optional(),
  })
}

export const ProjectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  theme: z.string().nullish(),
  style: z.string().nullish(),
  status: z.string().nullish(),
  series_id: z.number().int().positive().nullish(),
  episode_index: z.number().int().positive().nullish(),
  parent_project_id: z.number().int().positive().nullish(),
  ratio: z.string().nullish(),
  visual_anchor: z.string().nullish(),
  duration_min: z.number().nullish(),
  duration_max: z.number().nullish(),
  long_video_mode: z.union([z.number(), z.boolean()]).nullish(),
  created_at: z.union([z.number(), z.string()]).nullish(),
  updated_at: z.union([z.number(), z.string()]).nullish(),
}).passthrough()
export type Project = z.infer<typeof ProjectSchema>

export const SeriesSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().nullish(),
  style: z.string().nullish(),
}).passthrough()
export type Series = z.infer<typeof SeriesSchema>

export type Episode = Project & { series_id: number; episode_index: number }

export const ShotSchema = z.object({
  id: z.union([z.string(), z.number()]),
  scene_id: z.union([z.string(), z.number()]).nullish(),
  shot_number: z.number().int().nonnegative().optional(),
  description: z.string().default(''),
  dialogue: z.string().default(''),
  narration: z.string().default(''),
  action: z.string().default(''),
  duration: z.number().nonnegative().optional(),
  image_prompt: z.string().default(''),
  video_prompt: z.string().default(''),
  negative_prompt: z.string().default(''),
}).passthrough()
export type Shot = z.infer<typeof ShotSchema>

export const SceneSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string().default(''),
  description: z.string().default(''),
  shots: z.array(ShotSchema).default([]),
}).passthrough()
export type Scene = z.infer<typeof SceneSchema>

export const SemanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, '必须是语义版本字符串')

export const ScriptDocumentSchema = z.object({
  schema_version: SemanticVersionSchema,
  title: z.string().min(1),
  summary: z.string().default(''),
  language: z.string().default('zh-CN'),
  style: z.string().default(''),
  scenes: z.array(SceneSchema).min(1),
  prompt_version: z.string().min(1),
  provider: z.string().default(''),
  model: z.string().default(''),
}).passthrough()
export type ScriptDocument = z.infer<typeof ScriptDocumentSchema>

export const StageArtifactSchema = z.object({
  id: z.union([z.string(), z.number()]),
  project_id: z.number().int().positive(),
  stage: z.string().min(1),
  revision: z.number().int().positive(),
  status: z.enum(['current', 'stale', 'failed', 'partial', 'archived']),
  input_hash: z.string().min(1),
  payload: z.unknown(),
  upstream_revisions: JsonRecordSchema.default({}),
}).passthrough()
export type StageArtifact = z.infer<typeof StageArtifactSchema>

export const MediaReferenceSchema = z.object({
  kind: z.enum(['project_media', 'local_file', 'object_key', 'public_url']),
  media_id: z.number().int().positive().nullable().optional(),
  object_key: z.string().default(''),
  url: z.string().default(''),
  mime: z.string().default(''),
  content_hash: z.string().default(''),
})
export type MediaReference = z.infer<typeof MediaReferenceSchema>

export const AssetTypeSchema = z.enum(['character', 'scene', 'prop', 'style', 'voice', 'music'])
export type AssetType = z.infer<typeof AssetTypeSchema>
export const AssetScopeSchema = z.enum(['episode', 'series', 'global'])
export type AssetScope = z.infer<typeof AssetScopeSchema>

export const AssetVariantSchema = z.object({
  id: z.string().min(1),
  asset_id: z.union([z.string(), z.number()]),
  revision: z.number().int().positive(),
  status: z.enum(['active', 'archived']),
  selected: z.boolean(),
  favorite: z.boolean(),
  parent_variant_id: z.string().nullable().optional(),
  media_reference: MediaReferenceSchema,
  provider: z.string().default(''),
  model: z.string().default(''),
  prompt: z.string().default(''),
  content_hash: z.string().default(''),
  label: z.string().optional(),
  archived_at: z.union([z.string(), z.number()]).nullish(),
}).passthrough()
export type AssetVariant = z.infer<typeof AssetVariantSchema>

export const AssetUnitSchema = z.object({
  id: z.union([z.string(), z.number()]),
  asset_type: AssetTypeSchema,
  name: z.string().min(1),
  scope: AssetScopeSchema,
  project_id: z.number().int().positive().nullable().optional(),
  series_id: z.number().int().positive().nullable().optional(),
  selected_variant_id: z.string().nullable().optional(),
  variants: z.array(AssetVariantSchema).default([]),
  metadata: JsonRecordSchema.default({}),
}).passthrough()
export type AssetUnit = z.infer<typeof AssetUnitSchema>

export const AssetBindingSchema = z.object({
  storyboard_id: z.number().int().positive(),
  project_id: z.number().int().positive().nullable().optional(),
  asset_type: AssetTypeSchema,
  asset_id: z.union([z.string(), z.number()]),
  variant_id: z.string().min(1),
  revision: z.number().int().positive(),
  source_scope: AssetScopeSchema,
  snapshot: JsonRecordSchema,
}).passthrough()
export type AssetBinding = z.infer<typeof AssetBindingSchema>

export const ModelDescriptorSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  modality: z.enum(['text', 'image', 'video', 'audio']),
  input_types: z.array(z.string()),
  output_types: z.array(z.string()),
  capabilities: z.record(z.string(), z.boolean()),
  accepted_media: z.array(z.enum([
    'project_media', 'local_file', 'object_key', 'public_url', 'signed_url', 'data_url',
  ])).default([]),
  credential_required: z.boolean(),
  catalog_source: z.string().min(1),
}).passthrough()
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>

export const TaskStatusSchema = z.enum([
  'pending', 'waiting', 'running', 'composing', 'retrying', 'cancel_requested',
  'reconciling', 'success', 'failed', 'timed_out', 'interrupted', 'orphaned', 'partial', 'canceled',
])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const GenerationTaskSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: TaskStatusSchema,
  progress: z.number().min(0).max(100),
  message: z.string(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  provider_task_id: z.string().nullish(),
  attempt: z.number().int().positive().default(1),
  parent_task_id: z.string().nullish(),
  idempotency_key: z.string().nullish(),
  retryable: z.boolean().default(false),
  cancel_state: z.enum(['none', 'requested', 'confirmed', 'local_only']).default('none'),
  input_snapshot: JsonRecordSchema.nullish(),
  media_snapshot: z.array(MediaReferenceSchema).default([]),
  result: z.unknown().nullable(),
  // `error` 保留旧客户端使用的字符串；新客户端读取结构化 `error_details`。
  error: z.union([AppErrorPayloadSchema, z.string()]).nullish(),
  error_details: AppErrorPayloadSchema.nullish(),
  created_at: z.number(),
  started_at: z.number().nullish(),
  updated_at: z.number(),
  finished_at: z.number().nullish(),
  timeout_at: z.number().nullish(),
  correlation_id: z.string().nullish(),
  meta: JsonRecordSchema.default({}),
}).passthrough()
export type GenerationTask = z.infer<typeof GenerationTaskSchema>

export type TaskEvent =
  | { type: 'start'; at: number }
  | { type: 'progress'; progress: number; message?: string; at: number }
  | { type: 'succeed'; result: unknown; at: number }
  | { type: 'fail'; error: AppErrorPayload; at: number }
  | { type: 'cancel_request'; at: number }
  | { type: 'cancel_confirm'; providerConfirmed: boolean; at: number }
  | { type: 'orphan'; reason: string; at: number }

export interface ProviderContext {
  signal?: AbortSignal
  correlationId: string
  idempotencyKey: string
}

export interface ProviderSubmission<TResult = unknown> {
  providerTaskId?: string
  result?: TResult
  status: 'submitted' | 'succeeded'
}

export interface ProviderReconciliation<TResult = unknown> {
  status: 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown'
  result?: TResult
  error?: AppErrorPayload
}

export interface ProviderAdapter<TInput = unknown, TResult = unknown> {
  readonly provider: string
  readonly modality: ModelDescriptor['modality']
  submit(input: TInput, context: ProviderContext): Promise<ProviderSubmission<TResult>>
  reconcile?(providerTaskId: string, context: ProviderContext): Promise<ProviderReconciliation<TResult>>
  cancel?(providerTaskId: string, context: ProviderContext): Promise<'confirmed' | 'requested' | 'unsupported'>
}

export interface AigcStudioBridge {
  setLocale(locale: 'zh' | 'en'): void
  selectExportDirectory(): Promise<string | null>
}

export const DesktopLocaleSchema = z.enum(['zh', 'en'])
export type DesktopLocale = z.infer<typeof DesktopLocaleSchema>
