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

export const PromptKindSchema = z.enum(['script', 'image', 'video', 'voice', 'negative'])
export type PromptKind = z.infer<typeof PromptKindSchema>
export const PromptSourceSchema = z.enum(['manual', 'polish', 'provider', 'compiled', 'restore', 'migration'])
export const PromptRevisionCreateSchema = z.object({
  storyboard_id: z.number().int().positive().nullable().optional(),
  kind: PromptKindSchema,
  content: z.string().max(24000),
  negative_content: z.string().max(12000).default(''),
  source: PromptSourceSchema.default('manual'),
  prompt_version: z.string().trim().max(160).default(''),
  provider: z.string().trim().max(80).default(''),
  model: z.string().trim().max(160).default(''),
  parent_revision_id: z.string().uuid().nullable().optional(),
})
export type PromptRevisionCreate = z.infer<typeof PromptRevisionCreateSchema>

export const PromptRevisionSchema = PromptRevisionCreateSchema.extend({
  id: z.string().uuid(),
  project_id: z.number().int().positive(),
  revision: z.number().int().positive(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.number().int().nonnegative(),
})
export type PromptRevision = z.infer<typeof PromptRevisionSchema>

export const SceneRegenerationSchema = z.object({
  stages: z.array(z.enum(['image', 'voice', 'video'])).min(1).max(3),
  prompt_revision_id: z.string().uuid().optional(),
  model: z.string().trim().max(160).optional(),
  provider: z.string().trim().max(80).optional(),
  confirm_cost: z.boolean().default(false),
  idempotencyKey: z.string().trim().max(200).optional(),
})
export type SceneRegeneration = z.infer<typeof SceneRegenerationSchema>

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
export const AssetIdSchema = z.union([z.string().min(1), z.number().int().positive()])
export type AssetId = z.infer<typeof AssetIdSchema>
const AssetBooleanSchema = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean)

export const AssetVariantSchema = z.object({
  id: AssetIdSchema,
  asset_id: AssetIdSchema,
  revision: z.number().int().positive(),
  status: z.enum(['active', 'archived']),
  selected: AssetBooleanSchema,
  favorite: AssetBooleanSchema,
  parent_variant_id: AssetIdSchema.nullable().optional(),
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
  id: AssetIdSchema,
  asset_type: AssetTypeSchema,
  name: z.string().min(1),
  scope: AssetScopeSchema,
  project_id: z.number().int().positive().nullable().optional(),
  series_id: z.number().int().positive().nullable().optional(),
  forked_from_unit_id: AssetIdSchema.nullable().optional(),
  forked_from_variant_id: AssetIdSchema.nullable().optional(),
  selected_variant_id: AssetIdSchema.nullable().optional(),
  variants: z.array(AssetVariantSchema).default([]),
  metadata: JsonRecordSchema.default({}),
}).passthrough()
export type AssetUnit = z.infer<typeof AssetUnitSchema>

export const AssetUnitCreateSchema = z.object({
  asset_type: AssetTypeSchema,
  name: z.string().trim().min(1).max(200),
  scope: AssetScopeSchema.default('episode'),
  metadata: JsonRecordSchema.default({}),
})
export type AssetUnitCreate = z.infer<typeof AssetUnitCreateSchema>

export const VoiceAssetMetadataSchema = z.object({
  language: z.string().trim().max(40).default('zh-CN'),
  voice_id: z.string().trim().max(160).default(''),
  role: z.enum(['narrator', 'character', 'other']).default('narrator'),
  speed: z.number().min(0.5).max(2).default(1),
  pitch: z.number().min(-12).max(12).default(0),
  emotion: z.string().trim().max(80).default('neutral'),
  provider: z.string().trim().max(80).default(''),
  model: z.string().trim().max(160).default(''),
}).passthrough()
export type VoiceAssetMetadata = z.infer<typeof VoiceAssetMetadataSchema>

export const MusicAssetMetadataSchema = z.object({
  mood: z.string().trim().max(120).default(''),
  bpm: z.number().int().min(20).max(300).nullable().default(null),
  musical_key: z.string().trim().max(32).default(''),
  duration_seconds: z.number().positive().max(86400).nullable().default(null),
  loop_start: z.number().min(0).nullable().default(null),
  loop_end: z.number().positive().nullable().default(null),
  source: z.string().trim().max(300).default(''),
  license: z.string().trim().max(300).default(''),
}).superRefine((value, context) => {
  if (value.loop_start != null && value.loop_end != null && value.loop_end <= value.loop_start) {
    context.addIssue({ code: 'custom', path: ['loop_end'], message: '循环终点必须晚于起点' })
  }
})
export type MusicAssetMetadata = z.infer<typeof MusicAssetMetadataSchema>

export const AssetUnitForkSchema = z.object({
  project_id: z.number().int().positive(),
  series_id: z.number().int().positive(),
  variant_id: AssetIdSchema.optional(),
})
export type AssetUnitFork = z.infer<typeof AssetUnitForkSchema>

export const AssetVariantCreateSchema = z.object({
  label: z.string().trim().max(200).default(''),
  provider: z.string().trim().max(80).default(''),
  model: z.string().trim().max(160).default(''),
  prompt: z.string().trim().max(12000).default(''),
  parent_variant_id: AssetIdSchema.nullable().optional(),
  content_hash: z.string().trim().max(128).default(''),
  media_reference: MediaReferenceSchema,
})
export type AssetVariantCreate = z.infer<typeof AssetVariantCreateSchema>

export const AssetBindingUpdateSchema = z.object({
  project_id: z.number().int().positive().optional(),
  asset_type: AssetTypeSchema,
  asset_id: AssetIdSchema,
  variant_id: AssetIdSchema,
  source_scope: AssetScopeSchema.optional(),
})
export type AssetBindingUpdate = z.infer<typeof AssetBindingUpdateSchema>

export const AssetBatchBindingSchema = AssetBindingUpdateSchema.extend({
  project_id: z.number().int().positive(),
  storyboard_ids: z.array(z.number().int().positive()).min(1).max(500),
})
export type AssetBatchBinding = z.infer<typeof AssetBatchBindingSchema>

export const AssetBindingSchema = z.object({
  storyboard_id: z.number().int().positive(),
  project_id: z.number().int().positive().nullable().optional(),
  asset_type: AssetTypeSchema,
  asset_id: AssetIdSchema,
  variant_id: AssetIdSchema,
  revision: z.number().int().positive(),
  source_scope: AssetScopeSchema,
  stale_fields: z.array(z.string()).default([]),
  stale_sources: z.array(z.string()).default([]),
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

export const TaskRealtimeEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('task.changed'),
    task: GenerationTaskSchema,
  }).strict(),
  z.object({
    type: z.literal('tasks.snapshot'),
    tasks: z.array(GenerationTaskSchema).max(1000),
    server_time: z.number().int().nonnegative(),
  }).strict(),
])
export type TaskRealtimeEvent = z.infer<typeof TaskRealtimeEventSchema>

export type TaskEvent =
  | { type: 'start'; at: number }
  | { type: 'progress'; progress: number; message?: string; at: number }
  | { type: 'succeed'; result: unknown; at: number }
  | { type: 'fail'; error: AppErrorPayload; at: number }
  | { type: 'cancel_request'; at: number }
  | { type: 'cancel_confirm'; providerConfirmed: boolean; at: number }
  | { type: 'orphan'; reason: string; at: number }

export const StudioStageKindSchema = z.enum([
  'topic', 'script', 'assets', 'storyboard', 'visuals', 'voice', 'subtitle', 'timeline', 'export',
])
export type StudioStageKind = z.infer<typeof StudioStageKindSchema>

export const StudioNodeIdSchema = z.string().regex(
  /^project:\d+:(topic|script|assets|storyboard|visuals|voice|subtitle|timeline|export)$/,
  'Studio 节点必须使用 project:<id>:<stage> 稳定 ID',
)
export const StudioPointSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
}).strict()
export const StudioPositionMapSchema = z.record(StudioNodeIdSchema, StudioPointSchema)
  .refine((positions) => Object.keys(positions).length <= 32, 'Studio 布局节点过多')

export const StudioViewportSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
  zoom: z.number().finite().min(0.1).max(4),
}).strict()

export const StudioLayoutUpdateSchema = z.object({
  schema_version: z.literal(1),
  positions: StudioPositionMapSchema,
  viewport: StudioViewportSchema.optional(),
  base_revision: z.number().int().nonnegative().optional(),
}).strict()
export type StudioLayoutUpdate = z.infer<typeof StudioLayoutUpdateSchema>

export const StudioLayoutSchema = StudioLayoutUpdateSchema.omit({ base_revision: true }).extend({
  project_id: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative().nullable(),
})
export type StudioLayout = z.infer<typeof StudioLayoutSchema>

export const DirectorAdviceOperationSchema = z.enum([
  'edit-brief',
  'edit-script',
  'design-assets',
  'plan-shots',
  'review-visuals',
  'complete-audio',
  'complete-subtitles',
  'review-timeline',
  'diagnose-task',
  'export-video',
])
export type DirectorAdviceOperation = z.infer<typeof DirectorAdviceOperationSchema>

export const DirectorAdviceActionSchema = z.object({
  id: z.string().regex(/^advice:[a-z0-9-]{3,48}$/),
  stage: StudioStageKindSchema,
  operation: DirectorAdviceOperationSchema,
  title: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  route: z.string().regex(/^\/(?:[a-z0-9_-]+\/?)+$/i).max(300),
  priority: z.number().int().min(0).max(100),
  risk: z.enum(['none', 'review', 'cost']),
  requires_confirmation: z.boolean(),
}).strict()
export type DirectorAdviceAction = z.infer<typeof DirectorAdviceActionSchema>

export const DirectorAdviceEvidenceSchema = z.object({
  shots: z.number().int().nonnegative(),
  selected_visuals: z.number().int().nonnegative(),
  voiced_shots: z.number().int().nonnegative(),
  subtitled_shots: z.number().int().nonnegative(),
  asset_units: z.number().int().nonnegative(),
  active_skills: z.number().int().nonnegative(),
  failed_tasks: z.number().int().nonnegative(),
  running_tasks: z.number().int().nonnegative(),
  exports: z.number().int().nonnegative(),
}).strict()
export type DirectorAdviceEvidence = z.infer<typeof DirectorAdviceEvidenceSchema>

export const DirectorAdvicePlanSchema = z.object({
  schema_version: z.literal(1),
  plan_id: z.string().regex(/^director:[a-f0-9]{16}$/),
  project_id: z.number().int().positive(),
  generated_at: z.number().int().nonnegative(),
  health_score: z.number().int().min(0).max(100),
  summary: z.string().trim().min(1).max(500),
  evidence: DirectorAdviceEvidenceSchema,
  actions: z.array(DirectorAdviceActionSchema).max(12),
  next_action_id: z.string().nullable(),
}).strict()
export type DirectorAdvicePlan = z.infer<typeof DirectorAdvicePlanSchema>

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

export const ProviderCapabilityStateSchema = z.enum(['supported', 'unsupported', 'unverified'])
export type ProviderCapabilityState = z.infer<typeof ProviderCapabilityStateSchema>

export const ProviderOperationCapabilitiesSchema = z.object({
  reconcile: ProviderCapabilityStateSchema,
  cancel: ProviderCapabilityStateSchema,
  billing: ProviderCapabilityStateSchema,
})
export type ProviderOperationCapabilities = z.infer<typeof ProviderOperationCapabilitiesSchema>

export const ProviderBillingStatusSchema = z.object({
  provider: z.string().min(1),
  capability: ProviderCapabilityStateSchema,
  configured: z.boolean(),
  status: z.enum(['available', 'unavailable', 'unknown']),
  reason_code: z.string().min(1),
  checked_at: z.number().int().nonnegative(),
  currency: z.string().max(16).nullable().optional(),
  balance: z.number().finite().nullable().optional(),
}).passthrough()
export type ProviderBillingStatus = z.infer<typeof ProviderBillingStatusSchema>

export interface ProviderAdapter<TInput = unknown, TResult = unknown> {
  readonly provider: string
  readonly modality: ModelDescriptor['modality']
  readonly capabilities?: ProviderOperationCapabilities
  submit(input: TInput, context: ProviderContext): Promise<ProviderSubmission<TResult>>
  reconcile?(providerTaskId: string, context: ProviderContext): Promise<ProviderReconciliation<TResult>>
  cancel?(providerTaskId: string, context: ProviderContext): Promise<'confirmed' | 'requested' | 'unsupported'>
  getBillingStatus?(context: ProviderContext): Promise<ProviderBillingStatus>
}

export interface AigcStudioBridge {
  setLocale(locale: 'zh' | 'en'): void
  selectExportDirectory(): Promise<string | null>
}

export const DesktopLocaleSchema = z.enum(['zh', 'en'])
export type DesktopLocale = z.infer<typeof DesktopLocaleSchema>
