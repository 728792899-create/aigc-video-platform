import { z } from 'zod'

export const IdSchema = z.string().uuid()
export const IsoDateSchema = z.string().datetime()
export const JsonObjectSchema = z.record(z.string(), z.unknown())
export type JsonObject = z.infer<typeof JsonObjectSchema>

export const AppErrorSchema = z.object({
  code: z.string().min(1),
  userMessage: z.string().min(1),
  technicalMessage: z.string().optional(),
  retryable: z.boolean(),
  correlationId: z.string().min(1),
  taskId: IdSchema.optional(),
  details: JsonObjectSchema.optional(),
  timestamp: IsoDateSchema,
})
export type AppErrorPayload = z.infer<typeof AppErrorSchema>

export const apiSuccess = <T extends z.ZodType>(schema: T) => z.object({
  ok: z.literal(true),
  data: schema,
  correlationId: z.string().min(1),
})
export const ApiFailureSchema = z.object({ ok: z.literal(false), error: AppErrorSchema })
export type ApiEnvelope<T> = { ok: true; data: T; correlationId: string } | { ok: false; error: AppErrorPayload }

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).default(''),
  status: z.enum(['active', 'archived']).default('active'),
  graphRevision: z.number().int().nonnegative().default(0),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type Project = z.infer<typeof ProjectSchema>

export const SourceDocumentSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(2_000_000),
  language: z.string().min(2).max(16).default('zh-CN'),
  contentHash: z.string().length(64),
  revision: z.number().int().positive(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type SourceDocument = z.infer<typeof SourceDocumentSchema>

export const SourceImportFormatSchema = z.enum(['text', 'markdown'])
export type SourceImportFormat = z.infer<typeof SourceImportFormatSchema>

export const SourceImportPreviewSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  originalFileName: z.string().min(1).max(255).regex(/^[^\u0000-\u001F\u007F/\\]+$/u),
  format: SourceImportFormatSchema,
  encoding: z.literal('utf-8'),
  byteSize: z.number().int().min(4).max(6 * 1024 * 1024),
  characterCount: z.number().int().min(4).max(2_000_000),
  contentHash: z.string().length(64),
  suggestedTitle: z.string().trim().min(1).max(200),
  previewText: z.string().min(1).max(20_000),
  previewTruncated: z.boolean(),
  chapterTitles: z.array(z.string().trim().min(1).max(200)).max(100),
  warnings: z.array(z.string().max(500)).max(20),
  expiresAt: IsoDateSchema,
})
export type SourceImportPreview = z.infer<typeof SourceImportPreviewSchema>

export const SourceImportCommitSchema = z.object({
  title: z.string().trim().min(1).max(200),
  language: z.string().min(2).max(16).default('zh-CN'),
  expectedContentHash: z.string().length(64),
})
export type SourceImportCommit = z.infer<typeof SourceImportCommitSchema>

export const SourceImportCancelReportSchema = z.object({ id: IdSchema, status: z.literal('cancelled') })
export type SourceImportCancelReport = z.infer<typeof SourceImportCancelReportSchema>

export const ChapterSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sourceId: IdSchema,
  title: z.string().trim().min(1).max(200),
  ordinal: z.number().int().nonnegative(),
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().positive(),
  summary: z.string().max(4_000),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type Chapter = z.infer<typeof ChapterSchema>

export const StoryEventTypeSchema = z.enum([
  'setup', 'inciting_incident', 'action', 'dialogue', 'revelation', 'turning_point',
  'climax', 'resolution', 'foreshadowing', 'chapter_summary',
])
export const StoryEventSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  chapterId: IdSchema,
  type: StoryEventTypeSchema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4_000),
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().positive(),
  narrativeOrder: z.number().int().nonnegative(),
  chronologicalOrder: z.number().int().nonnegative(),
  characterStateBefore: JsonObjectSchema.default({}),
  characterStateAfter: JsonObjectSchema.default({}),
  lockedFacts: z.array(z.string().max(500)).default([]),
  revision: z.number().int().positive(),
  contentHash: z.string().length(64),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type StoryEvent = z.infer<typeof StoryEventSchema>

export const StoryEventEdgeTypeSchema = z.enum([
  'follows', 'causes', 'depends_on', 'foreshadows', 'resolves', 'contradicts', 'parallel',
])
export const StoryEventEdgeSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sourceEventId: IdSchema,
  targetEventId: IdSchema,
  type: StoryEventEdgeTypeSchema,
  createdAt: IsoDateSchema,
}).refine((edge) => edge.sourceEventId !== edge.targetEventId, { message: '事件不能连接自身' })
export type StoryEventEdge = z.infer<typeof StoryEventEdgeSchema>

export const CreativeBriefSchema = z.object({
  goal: z.string().trim().min(1).max(2_000),
  targetAudience: z.string().trim().min(1).max(500),
  platform: z.enum(['douyin', 'kuaishou', 'bilibili', 'youtube', 'generic']),
  genre: z.string().trim().min(1).max(200),
  tone: z.string().trim().min(1).max(500),
  targetDurationSeconds: z.number().int().min(5).max(3_600),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3']),
  language: z.string().trim().min(2).max(16),
  constraints: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
}).strict()
export type CreativeBrief = z.infer<typeof CreativeBriefSchema>

export const CreativeBriefRevisionRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  brief: CreativeBriefSchema,
}).strict()
export type CreativeBriefRevisionRequest = z.infer<typeof CreativeBriefRevisionRequestSchema>

export const CreativeBriefFieldSchema = z.enum([
  'goal', 'targetAudience', 'platform', 'genre', 'tone',
  'targetDurationSeconds', 'aspectRatio', 'language', 'constraints',
])
export type CreativeBriefField = z.infer<typeof CreativeBriefFieldSchema>

export const CreativeBriefCandidateRequestSchema = z.object({
  count: z.number().int().min(2).max(3).default(3),
  feedback: z.string().trim().max(2_000).default(''),
  lockedFields: z.array(CreativeBriefFieldSchema).max(9).default([]),
  idempotencyKey: z.string().min(16).max(200),
}).strict()
export type CreativeBriefCandidateRequest = z.infer<typeof CreativeBriefCandidateRequestSchema>

export const CreativeBriefCandidateReviewRequestSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    expectedApprovedRevision: z.number().int().nonnegative(),
    confirmation: z.literal('APPROVE_CREATIVE_BRIEF'),
    idempotencyKey: z.string().min(16).max(200),
  }).strict(),
  z.object({
    decision: z.literal('reject'),
    expectedApprovedRevision: z.number().int().nonnegative(),
    confirmation: z.literal('REJECT_CREATIVE_BRIEF'),
    idempotencyKey: z.string().min(16).max(200),
  }).strict(),
])
export type CreativeBriefCandidateReviewRequest = z.infer<typeof CreativeBriefCandidateReviewRequestSchema>

export const SceneSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  eventId: IdSchema.optional(),
  title: z.string().trim().min(1).max(200),
  synopsis: z.string().max(4_000),
  ordinal: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  staleFields: z.array(z.string()).default([]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type Scene = z.infer<typeof SceneSchema>

export const ShotBeatSchema = z.object({
  id: IdSchema,
  ordinal: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().min(100).max(120_000),
  action: z.string().trim().min(1).max(2_000),
  camera: z.string().trim().min(1).max(1_000),
  dialogue: z.string().max(2_000).default(''),
  referenceIds: z.array(IdSchema).max(20).default([]),
})
export type ShotBeat = z.infer<typeof ShotBeatSchema>

export const BoundaryFrameSchema = z.object({
  id: IdSchema,
  role: z.enum(['start', 'end']),
  mediaId: IdSchema,
  mediaSha256: z.string().length(64),
  sourceShotId: IdSchema,
  sourceCandidateId: IdSchema.optional(),
  sourceBoundaryFrameId: IdSchema.optional(),
  sourceRevision: z.number().int().positive(),
  provenance: z.enum(['generated_candidate', 'linked_previous_end', 'selected_existing', 'extracted_video']),
  createdAt: IsoDateSchema,
})
export type BoundaryFrame = z.infer<typeof BoundaryFrameSchema>

export const ShotSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sceneId: IdSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4_000),
  dialogue: z.string().max(2_000).default(''),
  visualPrompt: z.string().max(8_000).default(''),
  videoPrompt: z.string().max(8_000).default(''),
  negativePrompt: z.string().max(4_000).default(''),
  durationMs: z.number().int().min(500).max(120_000),
  beats: z.array(ShotBeatSchema).max(16).default([]),
  boundaryFrames: z.array(BoundaryFrameSchema).max(2).default([]),
  ordinal: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  staleFields: z.array(z.string()).default([]),
  selectedCandidateId: IdSchema.optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
}).superRefine((shot, context) => {
  if (shot.beats.length > 0) {
    let cursor = 0
    for (const [index, beat] of shot.beats.entries()) {
      if (beat.ordinal !== index) context.addIssue({ code: 'custom', path: ['beats', index, 'ordinal'], message: 'Beat ordinal 必须连续' })
      if (beat.startMs !== cursor) context.addIssue({ code: 'custom', path: ['beats', index, 'startMs'], message: 'Beat 必须首尾连续' })
      cursor += beat.durationMs
    }
    if (cursor !== shot.durationMs) context.addIssue({ code: 'custom', path: ['beats'], message: 'Beat 时长之和必须等于镜头总时长' })
  }
  if (new Set(shot.boundaryFrames.map((frame) => frame.role)).size !== shot.boundaryFrames.length) {
    context.addIssue({ code: 'custom', path: ['boundaryFrames'], message: '每个镜头只能有一个首帧和一个尾帧' })
  }
})
export type Shot = z.infer<typeof ShotSchema>

export const AssetTypeSchema = z.enum(['character', 'scene', 'prop', 'style', 'voice', 'music'])
export const AssetScopeSchema = z.enum(['global', 'series', 'episode', 'project'])

export const VoiceAssetMetadataSchema = z.object({
  language: z.string().trim().min(2).max(16).default('zh-CN'),
  purpose: z.enum(['narrator', 'character', 'ambient']).default('narrator'),
  voiceId: z.string().trim().min(1).max(200).optional(),
  speed: z.number().min(0.5).max(2).default(1),
  pitchSemitones: z.number().min(-12).max(12).default(0),
  emotion: z.string().trim().max(120).default('neutral'),
  provider: z.string().trim().max(120).optional(),
  model: z.string().trim().max(160).optional(),
  previewMediaId: IdSchema.optional(),
  rightsStatus: z.enum(['original', 'licensed', 'review_required']).default('review_required'),
  rightsNote: z.string().max(1_000).default(''),
}).strict()
export type VoiceAssetMetadata = z.infer<typeof VoiceAssetMetadataSchema>

export const MusicAssetMetadataSchema = z.object({
  mood: z.string().trim().max(160).default(''),
  bpm: z.number().int().min(20).max(300).optional(),
  musicalKey: z.string().trim().max(24).default(''),
  durationMs: z.number().int().min(100).max(7_200_000).optional(),
  loopStartMs: z.number().int().nonnegative().optional(),
  loopEndMs: z.number().int().positive().optional(),
  source: z.enum(['original', 'licensed', 'generated', 'demo_fixture']).default('original'),
  previewMediaId: IdSchema.optional(),
  rightsStatus: z.enum(['original', 'licensed', 'review_required']).default('review_required'),
  licenseNote: z.string().max(1_000).default(''),
}).strict().superRefine((metadata, context) => {
  if (metadata.loopStartMs !== undefined && metadata.loopEndMs !== undefined && metadata.loopEndMs <= metadata.loopStartMs) {
    context.addIssue({ code: 'custom', path: ['loopEndMs'], message: '循环结束必须晚于循环起点' })
  }
  if (metadata.durationMs !== undefined && metadata.loopEndMs !== undefined && metadata.loopEndMs > metadata.durationMs) {
    context.addIssue({ code: 'custom', path: ['loopEndMs'], message: '循环结束不能超过音乐时长' })
  }
})
export type MusicAssetMetadata = z.infer<typeof MusicAssetMetadataSchema>

export function parseAssetMetadata(type: z.infer<typeof AssetTypeSchema>, value: unknown): JsonObject {
  if (type === 'voice') return VoiceAssetMetadataSchema.parse(value ?? {})
  if (type === 'music') return MusicAssetMetadataSchema.parse(value ?? {})
  return JsonObjectSchema.parse(value ?? {})
}

export const SeriesSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(4_000).default(''),
  artDirection: z.string().max(8_000).default(''),
  defaults: JsonObjectSchema.default({}),
  revision: z.number().int().positive(),
  archived: z.boolean().default(false),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type Series = z.infer<typeof SeriesSchema>

export const EpisodeSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  seriesId: IdSchema.optional(),
  ordinal: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(160),
  previousSummaryArtifactId: IdSchema.optional(),
  nextHookArtifactId: IdSchema.optional(),
  revision: z.number().int().positive(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type Episode = z.infer<typeof EpisodeSchema>

export const EpisodeContinuitySummarySchema = z.object({
  episodeId: IdSchema,
  seriesId: IdSchema.optional(),
  source: z.object({ id: IdSchema, revision: z.number().int().positive(), contentHash: z.string().length(64) }),
  summary: z.string().trim().min(1).max(4_000),
  nextHook: z.string().trim().max(2_000).default(''),
  lockedFacts: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  eventRevisionHash: z.string().length(64),
  generatedAt: IsoDateSchema,
})
export type EpisodeContinuitySummary = z.infer<typeof EpisodeContinuitySummarySchema>

export const EpisodeContinuitySummaryRequestSchema = z.object({
  expectedSourceId: IdSchema,
  expectedSourceRevision: z.number().int().positive(),
  expectedSourceHash: z.string().length(64),
  idempotencyKey: z.string().min(16).max(200),
  confirmation: z.literal('CREATE_EPISODE_CONTINUITY_SUMMARY'),
})
export type EpisodeContinuitySummaryRequest = z.infer<typeof EpisodeContinuitySummaryRequestSchema>

export const SharedAssetSchema = z.object({
  id: IdSchema,
  logicalId: IdSchema,
  scope: z.enum(['global', 'series']),
  seriesId: IdSchema.optional(),
  type: AssetTypeSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(4_000).default(''),
  metadata: JsonObjectSchema.default({}),
  selectedVariantId: IdSchema.optional(),
  revision: z.number().int().positive(),
  forkedFromAssetId: IdSchema.optional(),
  archived: z.boolean().default(false),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
}).superRefine((asset, context) => {
  if (asset.scope === 'series' && !asset.seriesId) context.addIssue({ code: 'custom', path: ['seriesId'], message: 'Series 资产必须绑定系列' })
  if (asset.scope === 'global' && asset.seriesId) context.addIssue({ code: 'custom', path: ['seriesId'], message: 'Global 资产不能绑定系列' })
})
export type SharedAsset = z.infer<typeof SharedAssetSchema>

export const SharedMediaReferenceSchema = z.object({
  id: IdSchema,
  kind: z.enum(['image', 'video', 'audio', 'subtitle', 'document']),
  storage: z.literal('managed-file'),
  locator: z.string().regex(/^[a-zA-Z0-9-]+\.[a-z0-9]{1,8}$/u),
  mime: z.string().min(3).max(160),
  size: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  createdAt: IsoDateSchema,
})
export type SharedMediaReference = z.infer<typeof SharedMediaReferenceSchema>

export const SharedAssetVariantSchema = z.object({
  id: IdSchema,
  sharedAssetId: IdSchema,
  revision: z.number().int().positive(),
  label: z.string().trim().min(1).max(160),
  prompt: z.string().max(8_000).default(''),
  metadata: JsonObjectSchema.default({}),
  mediaSnapshot: z.object({
    sharedMediaId: IdSchema,
    kind: z.enum(['image', 'video', 'audio', 'subtitle', 'document']),
    mime: z.string().min(3).max(160),
    size: z.number().int().nonnegative(),
    sha256: z.string().length(64),
  }).optional(),
  forkedFromVariantId: IdSchema.optional(),
  favorite: z.boolean().default(false),
  archived: z.boolean().default(false),
  createdAt: IsoDateSchema,
})
export type SharedAssetVariant = z.infer<typeof SharedAssetVariantSchema>

export const AssetBindingSlotSchema = z.enum(['character', 'scene', 'prop', 'style', 'voice', 'music', 'reference'])
export const AssetBindingSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  shotId: IdSchema,
  slot: AssetBindingSlotSchema,
  assetKind: z.enum(['local', 'shared']),
  assetId: IdSchema,
  variantId: IdSchema,
  assetRevision: z.number().int().positive(),
  originScope: AssetScopeSchema,
  originScopeId: IdSchema.optional(),
  drifted: z.boolean().default(false),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type AssetBinding = z.infer<typeof AssetBindingSchema>

export const ResolvedAssetSchema = z.object({
  logicalId: IdSchema,
  source: z.enum(['episode', 'series', 'global']),
  sourceId: IdSchema,
  assetKind: z.enum(['local', 'shared']),
  assetId: IdSchema,
  variantId: IdSchema,
  revision: z.number().int().positive(),
  type: AssetTypeSchema,
  name: z.string().min(1).max(160),
  drifted: z.boolean(),
})
export type ResolvedAsset = z.infer<typeof ResolvedAssetSchema>

export const EpisodeContextSchema = z.object({
  project: ProjectSchema,
  episode: EpisodeSchema,
  series: SeriesSchema.optional(),
  previousEpisode: EpisodeSchema.optional(),
  nextEpisode: EpisodeSchema.optional(),
  resolvedAssets: z.array(ResolvedAssetSchema),
})
export type EpisodeContext = z.infer<typeof EpisodeContextSchema>

export const AssetImpactSchema = z.object({
  assetId: IdSchema,
  bindingIds: z.array(IdSchema),
  shotIds: z.array(IdSchema),
  taskIds: z.array(IdSchema),
  candidateIds: z.array(IdSchema),
  boundaryFrameIds: z.array(IdSchema),
  canDelete: z.boolean(),
})
export type AssetImpact = z.infer<typeof AssetImpactSchema>

export const ReconcileDecisionSchema = z.object({
  bindingId: IdSchema,
  action: z.enum(['merge', 'promote', 'keep_local', 'rebind']),
  targetAssetId: IdSchema.optional(),
  targetVariantId: IdSchema.optional(),
  expectedAssetRevision: z.number().int().positive().optional(),
  targetScope: z.enum(['global', 'series']).optional(),
  targetSeriesId: IdSchema.optional(),
})
export type ReconcileDecision = z.infer<typeof ReconcileDecisionSchema>

export const ReconcilePreviewSchema = z.object({
  operationId: IdSchema,
  episodeId: IdSchema,
  expectedProjectRevision: z.number().int().nonnegative(),
  decisions: z.array(ReconcileDecisionSchema).min(1).max(500),
  changed: z.array(IdSchema),
  skipped: z.array(IdSchema),
  conflicts: z.array(z.object({ bindingId: IdSchema, code: z.string().min(1), message: z.string().min(1).max(500) })),
  approvalToken: z.string().min(20).max(200),
  expiresAt: IsoDateSchema,
})
export type ReconcilePreview = z.infer<typeof ReconcilePreviewSchema>

export const ReconcileReportSchema = z.object({
  operationId: IdSchema,
  episodeId: IdSchema,
  projectRevision: z.number().int().nonnegative(),
  changed: z.array(IdSchema),
  skipped: z.array(IdSchema),
  conflicts: z.array(z.object({ bindingId: IdSchema, code: z.string().min(1), message: z.string().min(1).max(500) })),
  appliedAt: IsoDateSchema,
})
export type ReconcileReport = z.infer<typeof ReconcileReportSchema>

export const AssetBatchBindingDraftSchema = z.object({
  shotId: IdSchema,
  slot: AssetBindingSlotSchema,
  assetKind: z.enum(['local', 'shared']),
  assetId: IdSchema,
  variantId: IdSchema,
  expectedAssetRevision: z.number().int().positive().optional(),
})
export type AssetBatchBindingDraft = z.infer<typeof AssetBatchBindingDraftSchema>

export const AssetBatchBindPreviewSchema = z.object({
  operationId: IdSchema,
  episodeId: IdSchema,
  expectedProjectRevision: z.number().int().nonnegative(),
  bindings: z.array(AssetBindingSchema).max(500),
  changed: z.array(IdSchema),
  skipped: z.array(IdSchema),
  conflicts: z.array(z.object({ shotId: IdSchema, code: z.string().min(1), message: z.string().min(1).max(500) })),
  approvalToken: z.string().min(20).max(200),
  expiresAt: IsoDateSchema,
})
export type AssetBatchBindPreview = z.infer<typeof AssetBatchBindPreviewSchema>

export const AssetBatchBindReportSchema = z.object({
  operationId: IdSchema,
  episodeId: IdSchema,
  projectRevision: z.number().int().nonnegative(),
  bindingIds: z.array(IdSchema),
  appliedAt: IsoDateSchema,
})
export type AssetBatchBindReport = z.infer<typeof AssetBatchBindReportSchema>
export const AssetUnitSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  logicalId: IdSchema.optional(),
  type: AssetTypeSchema,
  scope: AssetScopeSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(4_000).default(''),
  metadata: JsonObjectSchema.default({}),
  selectedVariantId: IdSchema.optional(),
  revision: z.number().int().positive().default(1),
  forkedFromAssetId: IdSchema.optional(),
  archived: z.boolean().default(false),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type AssetUnit = z.infer<typeof AssetUnitSchema>

export const MediaReferenceSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  kind: z.enum(['image', 'video', 'audio', 'subtitle', 'document']),
  storage: z.enum(['managed-file', 'object-key']),
  locator: z.string().min(1).max(1_024),
  mime: z.string().min(3).max(160),
  size: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  createdAt: IsoDateSchema,
})
export type MediaReference = z.infer<typeof MediaReferenceSchema>

export const ModelModalitySchema = z.enum(['text', 'image', 'video', 'audio'])
export type ModelModality = z.infer<typeof ModelModalitySchema>
export const ModelDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,159}$/),
  providerId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/),
  displayName: z.string().trim().min(1).max(160),
  modality: ModelModalitySchema,
  features: z.array(z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/)).max(80),
  inputModes: z.array(z.enum(['managed-file', 'base64', 'signed-url', 'temporary-upload', 'local-fixture'])).min(1),
  limits: z.object({
    maxMediaReferences: z.number().int().nonnegative().max(100),
    maxBytesPerReference: z.number().int().positive(),
    acceptedMimePrefixes: z.array(z.string().regex(/^[a-z]+\/$/)).max(20),
  }),
  parameterSchema: JsonObjectSchema.default({}),
  defaults: JsonObjectSchema.default({}),
  surfaces: z.array(z.enum(['studio', 'demo', 'provider-plugin'])).min(1),
  status: z.enum(['enabled', 'disabled', 'experimental']),
  availability: z.enum(['ready', 'unavailable', 'unverified']),
  credentialReference: z.string().min(1).max(160).optional(),
  catalogVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  contentHash: z.string().length(64),
})
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>

export const ProviderProtocolSchema = z.enum(['demo-local', 'openai-compatible', 'declarative-http'])
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>

const ProviderEndpointOriginSchema = z.string().url().max(512).refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === ''
}, { message: 'Provider endpoint 必须是不含凭据、路径、查询或片段的 HTTPS origin' })

export const DeclarativeProviderManifestSchema = z.object({
  version: z.literal(1),
  submit: z.object({
    method: z.literal('POST'), path: z.string().regex(/^\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]{1,300}$/u),
    response: z.object({ jobId: z.string().regex(/^[a-zA-Z0-9_.-]{1,160}$/u), status: z.string().regex(/^[a-zA-Z0-9_.-]{1,160}$/u) }).strict(),
  }).strict(),
  poll: z.object({
    method: z.literal('GET'), pathTemplate: z.string().regex(/^\/[a-zA-Z0-9._~!$&'()*+,;=:@%/{}/-]{1,300}$/u).refine((value) => value.includes('{jobId}')),
    response: z.object({ status: z.string().regex(/^[a-zA-Z0-9_.-]{1,160}$/u), outputUrl: z.string().regex(/^[a-zA-Z0-9_.-]{1,160}$/u).optional() }).strict(),
  }).strict().optional(),
  cancel: z.object({ method: z.literal('POST'), pathTemplate: z.string().regex(/^\/[a-zA-Z0-9._~!$&'()*+,;=:@%/{}/-]{1,300}$/u).refine((value) => value.includes('{jobId}')) }).strict().optional(),
  terminalStates: z.object({ succeeded: z.array(z.string().min(1).max(80)).min(1).max(20), failed: z.array(z.string().min(1).max(80)).min(1).max(20) }).strict(),
}).strict()
export type DeclarativeProviderManifest = z.infer<typeof DeclarativeProviderManifestSchema>

export const ProviderConnectionSchema = z.object({
  id: IdSchema,
  displayName: z.string().trim().min(1).max(120),
  protocol: ProviderProtocolSchema,
  endpointOrigin: ProviderEndpointOriginSchema.optional(),
  credentialRef: z.string().regex(/^(?:keychain|docker-secret):[a-zA-Z0-9._-]{3,120}$/u).optional(),
  credentialConfigured: z.boolean(),
  capabilities: z.array(ModelModalitySchema).min(1).max(4),
  manifest: DeclarativeProviderManifestSchema.optional(),
  state: z.enum(['draft', 'ready', 'disabled', 'error']),
  trust: z.enum(['builtin', 'verified-endpoint', 'unverified']),
  revision: z.number().int().positive(),
  lastTestedAt: IsoDateSchema.optional(),
  lastErrorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/u).optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
}).strict().superRefine((connection, context) => {
  if (connection.protocol === 'demo-local') {
    if (connection.endpointOrigin) context.addIssue({ code: 'custom', path: ['endpointOrigin'], message: 'Demo Provider 不允许外部 endpoint' })
    if (connection.credentialRef || connection.credentialConfigured) context.addIssue({ code: 'custom', path: ['credentialRef'], message: 'Demo Provider 不使用凭据' })
  } else {
    if (!connection.endpointOrigin) context.addIssue({ code: 'custom', path: ['endpointOrigin'], message: '外部 Provider 必须配置 HTTPS origin' })
    if (!connection.credentialRef) context.addIssue({ code: 'custom', path: ['credentialRef'], message: '外部 Provider 必须只保存凭据引用' })
  }
  if (connection.protocol === 'declarative-http' && !connection.manifest) context.addIssue({ code: 'custom', path: ['manifest'], message: '声明式 Provider 必须提供 manifest' })
  if (connection.protocol !== 'declarative-http' && connection.manifest) context.addIssue({ code: 'custom', path: ['manifest'], message: '只有声明式 Provider 可配置 manifest' })
})
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>

export const ProviderConnectionCreateRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  protocol: ProviderProtocolSchema.exclude(['demo-local']),
  endpointOrigin: ProviderEndpointOriginSchema,
  credentialKey: z.string().regex(/^[a-zA-Z0-9._-]{3,120}$/u),
  credential: z.string().min(8).max(16_384).optional(),
  capabilities: z.array(ModelModalitySchema).min(1).max(4),
  manifest: DeclarativeProviderManifestSchema.optional(),
  confirmation: z.literal('CREATE_LOCAL_PROVIDER_CONNECTION'),
}).strict().superRefine((request, context) => {
  if (request.protocol === 'declarative-http' && !request.manifest) context.addIssue({ code: 'custom', path: ['manifest'], message: '声明式 Provider 必须提供 manifest' })
  if (request.protocol !== 'declarative-http' && request.manifest) context.addIssue({ code: 'custom', path: ['manifest'], message: 'OpenAI-compatible 连接不接受自定义 manifest' })
})
export type ProviderConnectionCreateRequest = z.infer<typeof ProviderConnectionCreateRequestSchema>

export const ProviderCredentialUpdateRequestSchema = z.object({
  expectedRevision: z.number().int().positive(), credential: z.string().min(8).max(16_384),
  confirmation: z.literal('REPLACE_PROVIDER_CREDENTIAL'),
}).strict()
export type ProviderCredentialUpdateRequest = z.infer<typeof ProviderCredentialUpdateRequestSchema>

export const ProviderConnectionTestRequestSchema = z.object({
  expectedRevision: z.number().int().positive(), confirmation: z.literal('TEST_PROVIDER_CONNECTION'),
}).strict()
export type ProviderConnectionTestRequest = z.infer<typeof ProviderConnectionTestRequestSchema>

export const ProviderConnectionTestReportSchema = z.object({
  connection: ProviderConnectionSchema,
  outcome: z.enum(['ready', 'network_disabled', 'credential_missing', 'timeout', 'rate_limited', 'invalid_response', 'unreachable']),
  latencyMs: z.number().int().nonnegative(),
  checkedAt: IsoDateSchema,
}).strict()
export type ProviderConnectionTestReport = z.infer<typeof ProviderConnectionTestReportSchema>

export const ProviderRouteSchema = z.object({
    modality: ModelModalitySchema,
    primaryConnectionId: IdSchema,
    fallbackConnectionIds: z.array(IdSchema).max(8),
    fallbackConnectionModels: z.record(IdSchema, z.string().min(1).max(160)).optional(),
    model: z.string().min(1).max(160),
    maxAttempts: z.number().int().min(1).max(8),
    timeoutMs: z.number().int().min(1_000).max(600_000),
  }).strict()
export type ProviderRoute = z.infer<typeof ProviderRouteSchema>

export const ProviderRoutePolicySchema = z.object({
  projectId: IdSchema,
  revision: z.number().int().nonnegative(),
  routes: z.array(ProviderRouteSchema).max(4),
  dailyBudgetMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  updatedAt: IsoDateSchema,
}).strict().superRefine((policy, context) => {
  const modalities = policy.routes.map((route) => route.modality)
  if (new Set(modalities).size !== modalities.length) context.addIssue({ code: 'custom', path: ['routes'], message: '每种模态只能定义一条路由' })
  for (const [index, route] of policy.routes.entries()) {
    if (route.fallbackConnectionIds.includes(route.primaryConnectionId) || new Set(route.fallbackConnectionIds).size !== route.fallbackConnectionIds.length) {
      context.addIssue({ code: 'custom', path: ['routes', index, 'fallbackConnectionIds'], message: '降级链不得重复或包含主连接' })
    }
    if (Object.keys(route.fallbackConnectionModels ?? {}).some((connectionId) => !route.fallbackConnectionIds.includes(connectionId))) {
      context.addIssue({ code: 'custom', path: ['routes', index, 'fallbackConnectionModels'], message: '降级模型只能引用降级链中的连接' })
    }
  }
})
export type ProviderRoutePolicy = z.infer<typeof ProviderRoutePolicySchema>

export const ProviderRoutePolicyUpdateRequestSchema = z.object({
  routes: z.array(ProviderRouteSchema).max(4),
  dailyBudgetMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  expectedRevision: z.number().int().nonnegative(),
  confirmation: z.literal('UPDATE_PROVIDER_ROUTE_POLICY'),
}).strict().superRefine((request, context) => {
  const parsed = ProviderRoutePolicySchema.safeParse({
    projectId: '00000000-0000-4000-8000-000000000000', revision: request.expectedRevision,
    routes: request.routes, dailyBudgetMicros: request.dailyBudgetMicros, currency: request.currency,
    updatedAt: new Date(0).toISOString(),
  })
  for (const issue of parsed.success ? [] : parsed.error.issues) context.addIssue({ ...issue, path: issue.path.filter((part) => part !== 'projectId') })
})
export type ProviderRoutePolicyUpdateRequest = z.infer<typeof ProviderRoutePolicyUpdateRequestSchema>

export const RoutedCandidateGenerationRequestSchema = z.object({
  expectedRouteRevision: z.number().int().nonnegative(),
  expectedPolicyRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(16).max(200),
  maxCostMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  promptAppendix: z.string().trim().max(4_000).optional(),
  confirmation: z.literal('GENERATE_WITH_USER_PROVIDER'),
}).strict()
export type RoutedCandidateGenerationRequest = z.infer<typeof RoutedCandidateGenerationRequestSchema>

export const ProviderCostLedgerEntrySchema = z.object({
  id: IdSchema, projectId: IdSchema, taskId: IdSchema, attemptId: IdSchema.optional(),
  connectionId: IdSchema, model: z.string().min(1).max(160),
  amountMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), currency: z.string().regex(/^[A-Z]{3}$/u),
  source: z.enum(['provider-reported', 'local-estimate', 'demo-zero']), billed: z.boolean(),
  createdAt: IsoDateSchema,
}).strict()
export type ProviderCostLedgerEntry = z.infer<typeof ProviderCostLedgerEntrySchema>

export const EgressChannelSchema = z.enum(['media-fetch', 'model-api', 'temporary-upload'])
export const EgressPolicySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{2,119}$/),
  channel: EgressChannelSchema,
  enabled: z.boolean(),
  allowedHosts: z.array(z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)).max(40),
  allowedMethods: z.array(z.enum(['GET', 'POST', 'PUT'])).min(1).max(3),
  timeoutMs: z.number().int().min(500).max(120_000),
  maxRequestBytes: z.number().int().nonnegative().max(20_000_000),
  maxResponseBytes: z.number().int().positive().max(200_000_000),
  maxRedirects: z.number().int().nonnegative().max(5),
  allowedResponseMimePrefixes: z.array(z.string().regex(/^[a-z0-9.+-]+\/$|^[a-z0-9.+-]+\/[a-z0-9.+*-]+$/)).max(30).default([]),
  credentialConfigured: z.boolean(),
})
export type EgressPolicy = z.infer<typeof EgressPolicySchema>

export const EgressRequestDescriptorSchema = z.object({
  id: IdSchema,
  channel: EgressChannelSchema,
  url: z.string().url().max(2_048),
  method: z.enum(['GET', 'POST', 'PUT']),
  headers: z.record(
    z.string().regex(/^[a-z0-9-]{1,80}$/),
    z.string().max(8_192),
  ).default({}),
  bodyText: z.string().max(2_000_000).optional(),
}).superRefine((request, context) => {
  const forbidden = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'host', 'connection', 'content-length', 'transfer-encoding'])
  for (const header of Object.keys(request.headers)) {
    if (forbidden.has(header)) context.addIssue({ code: 'custom', path: ['headers', header], message: '凭据头只能由宿主 Broker 注入' })
  }
})
export type EgressRequestDescriptor = z.infer<typeof EgressRequestDescriptorSchema>

export const EgressBrokerStatusSchema = z.object({
  enabled: z.boolean(),
  networkDisabled: z.boolean(),
  policies: z.array(EgressPolicySchema),
})
export type EgressBrokerStatus = z.infer<typeof EgressBrokerStatusSchema>

export const ProviderPluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{2,119}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  apiVersion: z.literal(1),
  displayName: z.string().trim().min(1).max(160),
  publisherKeyId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/),
  bundleSha256: z.string().length(64),
  signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(512),
  channels: z.array(EgressChannelSchema).min(1).max(3),
  runtime: z.object({ name: z.literal('deno'), version: z.literal('2.9.2') }),
})
export type ProviderPluginManifest = z.infer<typeof ProviderPluginManifestSchema>

export const ProviderPluginStateSchema = z.enum(['installed', 'tested', 'enabled', 'quarantined'])
export type ProviderPluginState = z.infer<typeof ProviderPluginStateSchema>

export const ProviderPluginRecordSchema = z.object({
  id: IdSchema,
  pluginId: z.string().regex(/^[a-z][a-z0-9._-]{2,119}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  manifest: ProviderPluginManifestSchema,
  state: ProviderPluginStateSchema,
  bundleLocator: z.string().regex(/^provider-plugins\/[a-z][a-z0-9._-]{2,119}\/\d+\.\d+\.\d+\/[a-f0-9]{64}\.ts$/),
  bundleSize: z.number().int().positive().max(512 * 1024),
  revision: z.number().int().positive(),
  installedAt: IsoDateSchema,
  testedAt: IsoDateSchema.optional(),
  enabledAt: IsoDateSchema.optional(),
  quarantinedAt: IsoDateSchema.optional(),
  quarantineReason: z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/).optional(),
  testEvidenceHash: z.string().length(64).optional(),
  updatedAt: IsoDateSchema,
}).superRefine((record, context) => {
  if (record.pluginId !== record.manifest.id) context.addIssue({ code: 'custom', path: ['pluginId'], message: '插件 ID 必须与 manifest 一致' })
  if (record.version !== record.manifest.version) context.addIssue({ code: 'custom', path: ['version'], message: '插件版本必须与 manifest 一致' })
  const expectedLocator = `provider-plugins/${record.pluginId}/${record.version}/${record.manifest.bundleSha256}.ts`
  if (record.bundleLocator !== expectedLocator) context.addIssue({ code: 'custom', path: ['bundleLocator'], message: '插件定位必须与受验 manifest 一致' })
  if (record.state === 'tested' && (!record.testedAt || !record.testEvidenceHash)) context.addIssue({ code: 'custom', path: ['testedAt'], message: 'tested 状态必须包含测试证据' })
  if (record.state === 'enabled' && (!record.testedAt || !record.testEvidenceHash || !record.enabledAt)) context.addIssue({ code: 'custom', path: ['enabledAt'], message: 'enabled 状态必须包含测试和启用证据' })
  if (record.state === 'quarantined' && (!record.quarantinedAt || !record.quarantineReason)) context.addIssue({ code: 'custom', path: ['quarantineReason'], message: 'quarantined 状态必须包含原因' })
})
export type ProviderPluginRecord = z.infer<typeof ProviderPluginRecordSchema>

export const ProviderPluginInstallRequestSchema = z.object({
  manifest: ProviderPluginManifestSchema,
  bundleBase64: z.string().min(4).max(700_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
})
export type ProviderPluginInstallRequest = z.infer<typeof ProviderPluginInstallRequestSchema>

export const ProviderPluginTestReportSchema = z.object({
  plugin: ProviderPluginRecordSchema,
  passed: z.boolean(),
  evidenceHash: z.string().length(64),
  timestamp: IsoDateSchema,
})
export type ProviderPluginTestReport = z.infer<typeof ProviderPluginTestReportSchema>

export const ProviderPluginTestRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  confirmation: z.literal('TEST_SIGNED_PROVIDER_PLUGIN'),
})
export type ProviderPluginTestRequest = z.infer<typeof ProviderPluginTestRequestSchema>

export const ProviderPluginEnableRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  confirmation: z.literal('ENABLE_SIGNED_PROVIDER_PLUGIN'),
})
export type ProviderPluginEnableRequest = z.infer<typeof ProviderPluginEnableRequestSchema>

export const ProviderPluginDisableRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
})
export type ProviderPluginDisableRequest = z.infer<typeof ProviderPluginDisableRequestSchema>

export const ProviderPublisherTrustSchema = z.object({
  id: IdSchema,
  keyId: z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/u),
  displayName: z.string().trim().min(1).max(120),
  publicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(['trusted', 'revoked']),
  revision: z.number().int().positive(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  revokedAt: IsoDateSchema.optional(),
})
export type ProviderPublisherTrust = z.infer<typeof ProviderPublisherTrustSchema>

const Ed25519PublicKeyPemSchema = z.string().trim().min(80).max(2_048)
  .refine((value) => value.startsWith('-----BEGIN PUBLIC KEY-----\n') && value.endsWith('\n-----END PUBLIC KEY-----'), {
    message: '必须提供 SPKI PEM 公钥',
  })

export const ProviderPublisherTrustRequestSchema = z.object({
  keyId: z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/u),
  displayName: z.string().trim().min(1).max(120),
  publicKeyPem: Ed25519PublicKeyPemSchema,
  confirmation: z.literal('TRUST_PROVIDER_PLUGIN_PUBLISHER'),
})
export type ProviderPublisherTrustRequest = z.infer<typeof ProviderPublisherTrustRequestSchema>

export const ProviderPublisherRevokeRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  confirmation: z.literal('REVOKE_PROVIDER_PLUGIN_PUBLISHER'),
})
export type ProviderPublisherRevokeRequest = z.infer<typeof ProviderPublisherRevokeRequestSchema>

export const DenoRuntimeStatusSchema = z.object({
  version: z.literal('2.9.2'),
  platform: z.string().min(1).max(40),
  arch: z.string().min(1).max(40),
  supported: z.boolean(),
  state: z.enum(['not-installed', 'ready', 'invalid', 'unsupported', 'installing']),
  assetName: z.string().min(1).max(160).optional(),
  downloadBytes: z.number().int().nonnegative().optional(),
  archiveSha256: z.string().length(64).optional(),
  binarySha256: z.string().length(64).optional(),
  installedAt: IsoDateSchema.optional(),
  networkDisabled: z.boolean(),
  installAllowed: z.boolean(),
  progress: z.object({
    phase: z.enum(['downloading', 'verifying', 'extracting', 'probing', 'publishing']),
    receivedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().positive(),
  }).refine((progress) => progress.receivedBytes <= progress.totalBytes, { message: '已接收字节不能超过总字节' }).optional(),
})
export type DenoRuntimeStatus = z.infer<typeof DenoRuntimeStatusSchema>

export const DenoRuntimeInstallRequestSchema = z.object({
  confirmation: z.literal('INSTALL_DENO_2.9.2'),
})
export type DenoRuntimeInstallRequest = z.infer<typeof DenoRuntimeInstallRequestSchema>

export const DenoRuntimeCancelRequestSchema = z.object({
  confirmation: z.literal('CANCEL_DENO_2.9.2_INSTALL'),
})
export type DenoRuntimeCancelRequest = z.infer<typeof DenoRuntimeCancelRequestSchema>

export const DenoRuntimeCancelReportSchema = z.object({
  status: z.literal('cancelled'),
  runtime: DenoRuntimeStatusSchema,
})
export type DenoRuntimeCancelReport = z.infer<typeof DenoRuntimeCancelReportSchema>

export const ProviderMediaReceiptSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  taskId: IdSchema.optional(),
  candidateId: IdSchema.optional(),
  modelId: z.string().min(1).max(160),
  mediaId: IdSchema,
  role: z.enum(['reference', 'first-frame', 'last-frame']),
  order: z.number().int().nonnegative(),
  sourceSha256: z.string().length(64),
  transmission: z.enum(['local-fixture', 'base64', 'signed-url', 'temporary-upload']),
  redactedLocatorHash: z.string().length(64),
  createdAt: IsoDateSchema,
})
export type ProviderMediaReceipt = z.infer<typeof ProviderMediaReceiptSchema>

export const MediaResolutionPreviewSchema = z.object({
  projectId: IdSchema,
  modelId: z.string().min(1).max(160),
  supported: z.boolean(),
  transmission: z.enum(['local-fixture', 'base64', 'signed-url', 'temporary-upload']),
  receipts: z.array(ProviderMediaReceiptSchema),
  totalBytes: z.number().int().nonnegative(),
  issues: z.array(z.string().min(1).max(300)).max(100),
})
export type MediaResolutionPreview = z.infer<typeof MediaResolutionPreviewSchema>

export const AssetVariantSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  revision: z.number().int().positive(),
  label: z.string().trim().min(1).max(160),
  prompt: z.string().max(8_000).default(''),
  metadata: JsonObjectSchema.default({}),
  mediaId: IdSchema.optional(),
  forkedFromVariantId: IdSchema.optional(),
  favorite: z.boolean().default(false),
  archived: z.boolean().default(false),
  createdAt: IsoDateSchema,
})
export type AssetVariant = z.infer<typeof AssetVariantSchema>

export const CandidateSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  shotId: IdSchema,
  kind: z.enum(['image', 'video', 'audio']),
  taskId: IdSchema,
  promptRevisionId: IdSchema.optional(),
  batchId: IdSchema.optional(),
  parentCandidateId: IdSchema.optional(),
  mediaId: IdSchema.optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  inputSnapshot: JsonObjectSchema,
  parametersSnapshot: JsonObjectSchema.default({}),
  label: z.string().trim().max(120).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  status: z.enum(['ready', 'failed', 'archived']),
  favorite: z.boolean().default(false),
  createdAt: IsoDateSchema,
})
export type Candidate = z.infer<typeof CandidateSchema>

export const CandidateBatchSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  shotId: IdSchema,
  kind: z.enum(['image', 'video', 'audio']),
  modelId: z.string().min(1).max(160),
  idempotencyKey: z.string().min(16).max(200),
  quantity: z.number().int().min(1).max(20),
  maxConcurrent: z.number().int().min(1).max(8),
  status: z.enum(['queued', 'running', 'partial', 'succeeded', 'failed', 'cancelled']),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  parametersSnapshot: JsonObjectSchema,
  source: z.enum(['demo-production', 'user', 'retry']),
  parentBatchId: IdSchema.optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  finishedAt: IsoDateSchema.optional(),
})
export type CandidateBatch = z.infer<typeof CandidateBatchSchema>

export const CandidateBatchRetryRequestSchema = z.object({
  idempotencyKey: z.string().min(16).max(200),
  confirmation: z.literal('RETRY_FAILED_CANDIDATES'),
})
export type CandidateBatchRetryRequest = z.infer<typeof CandidateBatchRetryRequestSchema>

export const MemoryScopeSchema = z.enum(['episode', 'series', 'global'])
export const MemorySourceTypeSchema = z.enum(['story_event', 'artifact', 'series_bible', 'shared_asset', 'user_feedback', 'selected_candidate'])
export const MemorySensitiveFlagSchema = z.enum(['credential', 'signed-url', 'private-path', 'provider-response', 'binary-content'])
export const MemoryRecordSchema = z.object({
  id: IdSchema,
  scope: MemoryScopeSchema,
  scopeId: IdSchema,
  originProjectId: IdSchema.optional(),
  sourceType: MemorySourceTypeSchema,
  sourceKey: z.string().trim().min(3).max(240),
  sourceRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(4_000),
  content: z.string().trim().min(1).max(12_000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(100),
  contentHash: z.string().length(64),
  stale: z.boolean().default(false),
  disabled: z.boolean().default(false),
  sensitiveFlags: z.array(MemorySensitiveFlagSchema).max(10).default([]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>

export const MemoryChunkSchema = z.object({
  id: IdSchema,
  memoryId: IdSchema,
  ordinal: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(2_000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(60),
  contentHash: z.string().length(64),
  createdAt: IsoDateSchema,
})
export type MemoryChunk = z.infer<typeof MemoryChunkSchema>

export const MemorySearchResultSchema = z.object({
  record: MemoryRecordSchema,
  score: z.number().finite().nonnegative(),
  matchedKeywords: z.array(z.string().min(1).max(80)).max(60),
  reasons: z.array(z.string().min(1).max(240)).min(1).max(10),
})
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>

export const AgentMemoryCitationSchema = z.object({
  memoryId: IdSchema,
  scope: MemoryScopeSchema,
  sourceType: MemorySourceTypeSchema,
  sourceKey: z.string().trim().min(3).max(240),
  sourceRevision: z.number().int().positive(),
  contentHash: z.string().length(64),
  score: z.number().finite().nonnegative(),
  matchedKeywords: z.array(z.string().trim().min(1).max(80)).max(60),
  reasons: z.array(z.string().trim().min(1).max(240)).min(1).max(10),
}).strict()
export type AgentMemoryCitation = z.infer<typeof AgentMemoryCitationSchema>

export const MemoryRebuildReportSchema = z.object({
  projectId: IdSchema,
  created: z.number().int().nonnegative(),
  reused: z.number().int().nonnegative(),
  markedStale: z.number().int().nonnegative(),
  skippedSensitive: z.number().int().nonnegative(),
  indexedChunks: z.number().int().nonnegative(),
})
export type MemoryRebuildReport = z.infer<typeof MemoryRebuildReportSchema>

export const MemoryModelStatusSchema = z.object({
  mode: z.enum(['keyword', 'hybrid']),
  keywordReady: z.literal(true),
  onnx: z.object({ enabled: z.boolean(), installed: z.boolean(), status: z.enum(['not-requested', 'ready', 'unavailable', 'hash-mismatch']), modelId: z.string(), revision: z.string(), expectedSha256: z.string().length(64) }),
})
export type MemoryModelStatus = z.infer<typeof MemoryModelStatusSchema>

export const PromptPackRefSchema = z.object({
  id: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  contentHash: z.string().length(64),
})

export const PromptRunSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  workflow: z.object({ id: z.string().min(1).max(160), version: z.string().regex(/^\d+\.\d+\.\d+$/) }).optional(),
  prompt: PromptPackRefSchema,
  skills: z.array(PromptPackRefSchema).max(31),
  providerProfile: PromptPackRefSchema,
  modelSnapshot: z.object({
    modelId: z.string().min(1).max(160),
    providerId: z.string().min(1).max(120),
    capabilities: z.array(z.string().min(1).max(120)).max(50),
    snapshotVersion: z.string().min(1).max(120),
  }),
  variablesHash: z.string().length(64),
  compiledHash: z.string().length(64),
  compiled: z.object({
    system: z.string().min(1).max(30_000),
    canonical: z.string().min(1).max(50_000),
    zhReview: z.string().min(1).max(20_000),
    enExecution: z.string().min(1).max(20_000),
    outputSchema: JsonObjectSchema,
    warnings: z.array(z.string().max(1_000)).max(50),
  }),
  status: z.enum(['compiled', 'submitted', 'succeeded', 'failed', 'rolled_back']),
  parentPromptRunId: IdSchema.optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type PromptRun = z.infer<typeof PromptRunSchema>

export const PromptPackInventorySchema = z.object({
  package: z.literal('@local/ai-video-director-prompt-pack@0.1.0'),
  prompts: z.array(z.object({
    id: z.string().min(1).max(120), version: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: z.string().min(1).max(200), stage: z.string().min(1).max(80),
    status: z.enum(['draft', 'canary', 'active', 'retired']), contentHash: z.string().length(64),
  })),
  skills: z.array(z.object({
    id: z.string().min(1).max(120), version: z.string().regex(/^\d+\.\d+\.\d+$/),
    title: z.string().min(1).max(200), family: z.enum(['story.genre', 'art.style', 'production']),
    trustLevel: z.enum(['builtin', 'reviewed', 'project', 'untrusted']), contentHash: z.string().length(64),
  })),
  workflows: z.array(z.object({
    id: z.string().min(1).max(160), version: z.string().regex(/^\d+\.\d+\.\d+$/), title: z.string().min(1).max(200), stepCount: z.number().int().positive(),
  })),
  providerProfileCount: z.number().int().nonnegative(),
})
export type PromptPackInventory = z.infer<typeof PromptPackInventorySchema>

export const TaskAttemptSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  taskId: IdSchema,
  promptRunId: IdSchema.optional(),
  attempt: z.number().int().positive(),
  status: z.enum(['created', 'submitting', 'accepted', 'polling', 'reconciling', 'succeeded', 'failed', 'cancelled', 'outcome_unknown']),
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(160),
  idempotencyKey: z.string().min(16).max(200),
  receiptId: IdSchema.optional(),
  diagnosticHash: z.string().length(64).optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  finishedAt: IsoDateSchema.optional(),
})
export type TaskAttempt = z.infer<typeof TaskAttemptSchema>

export const ProviderReceiptRecordSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  taskId: IdSchema,
  attemptId: IdSchema,
  providerId: z.string().min(1).max(120),
  remoteJobId: z.string().min(1).max(500),
  acceptedAt: IsoDateSchema,
  rawStatusHash: z.string().length(64).optional(),
  createdAt: IsoDateSchema,
})
export type ProviderReceiptRecord = z.infer<typeof ProviderReceiptRecordSchema>

export const ReviewDecisionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  candidateId: IdSchema,
  promptRunId: IdSchema.optional(),
  source: z.enum(['automatic_critic', 'human']),
  decision: z.enum(['pending', 'approved', 'rejected']),
  rubric: z.record(z.string(), z.number().min(0).max(1)).default({}),
  reasons: z.array(z.string().max(1_000)).max(50).default([]),
  createdAt: IsoDateSchema,
})
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>

export const ArtifactVersionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  workflow: z.object({ id: z.string().min(1).max(160), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  stageId: z.string().min(1).max(120),
  artifactType: z.string().min(1).max(160),
  revision: z.number().int().positive(),
  promptRunId: IdSchema.optional(),
  parentArtifactVersionId: IdSchema.optional(),
  scope: z.object({ type: z.enum(['project', 'series', 'episode', 'source', 'chapter', 'event', 'scene', 'shot', 'candidate']), id: IdSchema }),
  dependencies: z.array(z.object({ artifactVersionId: IdSchema, contentHash: z.string().length(64) })).max(100).default([]),
  content: JsonObjectSchema,
  contentHash: z.string().length(64),
  status: z.enum(['draft', 'approved', 'rejected', 'superseded']),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>

export const EpisodeContinuityArtifactStateSchema = z.object({
  episode: EpisodeSchema,
  artifact: ArtifactVersionSchema.optional(),
  summary: EpisodeContinuitySummarySchema.optional(),
  currentSource: z.object({ id: IdSchema, revision: z.number().int().positive(), contentHash: z.string().length(64) }).optional(),
  stale: z.boolean(),
  staleReasons: z.array(z.enum(['missing_summary', 'missing_source', 'source_changed', 'event_revision_changed'])),
})
export type EpisodeContinuityArtifactState = z.infer<typeof EpisodeContinuityArtifactStateSchema>

export const EpisodeContinuityStateSchema = z.object({
  current: EpisodeContinuityArtifactStateSchema,
  previous: EpisodeContinuityArtifactStateSchema.optional(),
})
export type EpisodeContinuityState = z.infer<typeof EpisodeContinuityStateSchema>

export const CreativeBriefCandidateSchema = z.object({
  batchId: IdSchema,
  artifact: ArtifactVersionSchema,
  brief: CreativeBriefSchema,
  label: z.string().trim().min(1).max(120),
  changedFields: z.array(CreativeBriefFieldSchema).max(9),
  lockedFields: z.array(CreativeBriefFieldSchema).max(9),
}).strict()
export type CreativeBriefCandidate = z.infer<typeof CreativeBriefCandidateSchema>

export const CreativeBriefStateSchema = z.object({
  projectId: IdSchema,
  brief: CreativeBriefSchema,
  artifact: ArtifactVersionSchema.optional(),
  candidates: z.array(CreativeBriefCandidateSchema).max(30).default([]),
  invalidArtifactIds: z.array(IdSchema).max(100).default([]),
  staleSceneCount: z.number().int().nonnegative(),
  staleShotCount: z.number().int().nonnegative(),
})
export type CreativeBriefState = z.infer<typeof CreativeBriefStateSchema>

export const CreativeBriefCandidateBatchSchema = z.object({
  batchId: IdSchema,
  candidates: z.array(CreativeBriefCandidateSchema).min(2).max(3),
  reused: z.boolean(),
}).strict()
export type CreativeBriefCandidateBatch = z.infer<typeof CreativeBriefCandidateBatchSchema>

export const TaskStatusSchema = z.enum([
  'queued', 'running', 'waiting_approval', 'retrying', 'succeeded', 'failed',
  'cancel_requested', 'cancelled', 'timed_out', 'orphaned', 'reconciling',
  'outcome_unknown', 'needs_attention',
])
export const TaskCancelStateSchema = z.enum([
  'not_requested', 'local_requested', 'provider_requested', 'provider_confirmed', 'unsupported',
])
export const GenerationTaskSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  type: z.enum(['event_extract', 'adaptation', 'asset', 'image', 'video', 'voice', 'subtitle', 'boundary_extract', 'export']),
  status: TaskStatusSchema,
  stage: z.string().min(1),
  idempotencyKey: z.string().min(16).max(200),
  provider: z.string().min(1),
  model: z.string().min(1),
  providerTaskId: z.string().max(500).optional(),
  promptRunId: IdSchema.optional(),
  providerProfileVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  modelCapabilitySnapshot: JsonObjectSchema.optional(),
  mediaInputOrder: z.array(z.string().min(1).max(500)).max(100).optional(),
  attempt: z.number().int().positive(),
  parentTaskId: IdSchema.optional(),
  inputSnapshot: JsonObjectSchema,
  result: JsonObjectSchema.optional(),
  error: AppErrorSchema.optional(),
  retryable: z.boolean(),
  cancelState: TaskCancelStateSchema.optional(),
  lastReconciledAt: IsoDateSchema.optional(),
  needsAttentionReason: z.string().min(1).max(500).optional(),
  progress: z.number().min(0).max(1).optional(),
  createdAt: IsoDateSchema,
  startedAt: IsoDateSchema.optional(),
  updatedAt: IsoDateSchema,
  finishedAt: IsoDateSchema.optional(),
})
export type GenerationTask = z.infer<typeof GenerationTaskSchema>

export const CandidateBatchRetryResultSchema = z.object({
  batch: CandidateBatchSchema,
  tasks: z.array(GenerationTaskSchema).max(20),
  candidates: z.array(CandidateSchema).max(20),
  reused: z.boolean(),
})
export type CandidateBatchRetryResult = z.infer<typeof CandidateBatchRetryResultSchema>

export const TaskRetryRequestSchema = z.object({
  idempotencyKey: z.string().min(16).max(200),
  confirmation: z.literal('RETRY_FAILED_TASK'),
}).strict()
export type TaskRetryRequest = z.infer<typeof TaskRetryRequestSchema>

export const TaskDiagnosticSchema = z.object({
  taskId: IdSchema,
  projectId: IdSchema,
  status: TaskStatusSchema,
  outcomeCertainty: z.enum(['certain', 'unknown']),
  reconcileRequired: z.boolean(),
  retryAllowed: z.boolean(),
  cancelSemantics: z.enum(['none', 'local_only', 'provider_requested', 'provider_confirmed', 'unsupported']),
  correlationId: IdSchema,
  providerReferenceHash: z.string().length(64).optional(),
  errorCode: z.string().min(1).max(160).optional(),
  suggestedActions: z.array(z.enum(['wait', 'reconcile', 'retry', 'cancel', 'inspect'])).max(5),
  elapsedMs: z.number().int().nonnegative(),
  updatedAt: IsoDateSchema,
})
export type TaskDiagnostic = z.infer<typeof TaskDiagnosticSchema>

export const SecurityAuditActionSchema = z.enum([
  'creative_brief.review',
  'scene_patch.apply',
  'source_import.commit',
  'graph.clear_boundary',
  'candidate_batch.retry_failed',
  'provider_candidate.submit',
  'export.approve',
  'generation_policy.update',
  'task.cancel',
  'task.retry',
  'task.reconcile',
  'artifact.rollback',
  'prompt.publish',
  'prompt.rollback',
  'skill.publish',
  'skill.rollback',
]).describe('固定高风险动作；新增动作必须同步契约、审计 UI 与测试')
export type SecurityAuditAction = z.infer<typeof SecurityAuditActionSchema>

export const SecurityAuditEventSchema = z.object({
  id: IdSchema,
  operationId: IdSchema,
  projectId: IdSchema,
  action: SecurityAuditActionSchema,
  status: z.enum(['started', 'succeeded', 'rejected']),
  targetType: z.enum(['project', 'task', 'shot', 'candidate_batch', 'export', 'source_import', 'artifact', 'prompt', 'skill']),
  targetReferenceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  correlationId: z.string().regex(/^[a-zA-Z0-9-]{8,100}$/u),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,159}$/u).optional(),
  createdAt: IsoDateSchema,
}).strict().superRefine((event, context) => {
  if (event.status === 'rejected' && !event.errorCode) {
    context.addIssue({ code: 'custom', path: ['errorCode'], message: '拒绝事件必须记录稳定错误码' })
  }
  if (event.status !== 'rejected' && event.errorCode) {
    context.addIssue({ code: 'custom', path: ['errorCode'], message: '只有拒绝事件可以记录错误码' })
  }
})
export type SecurityAuditEvent = z.infer<typeof SecurityAuditEventSchema>

export const ProjectSecurityAuditLogSchema = z.object({
  projectId: IdSchema,
  generatedAt: IsoDateSchema,
  events: z.array(SecurityAuditEventSchema).max(500),
}).strict()
export type ProjectSecurityAuditLog = z.infer<typeof ProjectSecurityAuditLogSchema>

export const ProjectDiagnosticTaskSchema = z.object({
  taskReferenceHash: z.string().length(64),
  type: GenerationTaskSchema.shape.type,
  status: TaskStatusSchema,
  stage: z.string().min(1).max(200),
  provider: z.string().min(1).max(160),
  model: z.string().min(1).max(200),
  attempt: z.number().int().positive(),
  outcomeCertainty: z.enum(['certain', 'unknown']),
  reconcileRequired: z.boolean(),
  retryAllowed: z.boolean(),
  cancelSemantics: z.enum(['none', 'local_only', 'provider_requested', 'provider_confirmed', 'unsupported']),
  correlationId: IdSchema,
  providerReferenceHash: z.string().length(64).optional(),
  errorCode: z.string().min(1).max(160).optional(),
  suggestedActions: z.array(z.enum(['wait', 'reconcile', 'retry', 'cancel', 'inspect'])).max(5),
  elapsedMs: z.number().int().nonnegative(),
  updatedAt: IsoDateSchema,
}).strict()
export type ProjectDiagnosticTask = z.infer<typeof ProjectDiagnosticTaskSchema>

export const ProjectIntegrityIssueCodeSchema = z.enum([
  'SHOT_SELECTED_CANDIDATE_MISSING',
  'SELECTED_CANDIDATE_MEDIA_MISSING',
  'CANDIDATE_MEDIA_MISSING',
  'CANDIDATE_TASK_MISSING',
  'BOUNDARY_MEDIA_MISSING',
])
export type ProjectIntegrityIssueCode = z.infer<typeof ProjectIntegrityIssueCodeSchema>

export const ProjectDiagnosticBundleSchema = z.object({
  format: z.literal('aigc-director-diagnostic'),
  version: z.literal(1),
  generatedAt: IsoDateSchema,
  projectReferenceHash: z.string().length(64),
  runtime: z.object({
    productVersion: z.literal('2.0.0'),
    schemaVersion: z.number().int().positive(),
    providerNetworkDisabled: z.boolean(),
    billingMode: z.enum(['demo-only', 'user-funded']),
  }).strict(),
  counts: z.object({
    sources: z.number().int().nonnegative(),
    chapters: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    scenes: z.number().int().nonnegative(),
    shots: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    candidates: z.number().int().nonnegative(),
    media: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
  }).strict(),
  taskStatusCounts: z.record(z.string().min(1).max(80), z.number().int().nonnegative()),
  tasks: z.array(ProjectDiagnosticTaskSchema).max(10_000),
  integrityIssues: z.array(z.object({
    code: ProjectIntegrityIssueCodeSchema,
    severity: z.enum(['warning', 'error']),
    entityReferenceHash: z.string().length(64),
    message: z.string().min(1).max(300),
  }).strict()).max(20_000),
  privacy: z.object({
    credentialsIncluded: z.literal(false),
    absolutePathsIncluded: z.literal(false),
    rawUserContentIncluded: z.literal(false),
    rawPromptsIncluded: z.literal(false),
    providerPayloadsIncluded: z.literal(false),
    signedUrlsIncluded: z.literal(false),
  }).strict(),
  bundleHash: z.string().length(64),
}).strict()
export type ProjectDiagnosticBundle = z.infer<typeof ProjectDiagnosticBundleSchema>

export const ProjectRecoveryIssueSchema = z.object({
  code: ProjectIntegrityIssueCodeSchema,
  severity: z.enum(['warning', 'error']),
  entityType: z.enum(['shot', 'candidate']),
  entityId: IdSchema,
  relatedEntityId: IdSchema.optional(),
  boundaryRole: z.enum(['start', 'end']).optional(),
  action: z.enum(['open_shot', 'open_candidate', 'clear_boundary']),
  message: z.string().min(1).max(300),
}).strict()
export type ProjectRecoveryIssue = z.infer<typeof ProjectRecoveryIssueSchema>

export const ProjectRecoveryTaskSchema = z.object({
  taskId: IdSchema,
  type: GenerationTaskSchema.shape.type,
  status: TaskStatusSchema,
  stage: z.string().min(1).max(200),
  actions: z.array(z.enum(['reconcile', 'retry', 'inspect'])).min(1).max(3),
  updatedAt: IsoDateSchema,
}).strict()
export type ProjectRecoveryTask = z.infer<typeof ProjectRecoveryTaskSchema>

export const ProjectRecoveryReportSchema = z.object({
  projectId: IdSchema,
  generatedAt: IsoDateSchema,
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    recoverableTasks: z.number().int().nonnegative(),
  }).strict(),
  issues: z.array(ProjectRecoveryIssueSchema).max(20_000),
  tasks: z.array(ProjectRecoveryTaskSchema).max(10_000),
}).strict()
export type ProjectRecoveryReport = z.infer<typeof ProjectRecoveryReportSchema>

export const TaskRetryResultSchema = z.object({
  task: GenerationTaskSchema,
  diagnostic: TaskDiagnosticSchema,
  reused: z.boolean(),
})
export type TaskRetryResult = z.infer<typeof TaskRetryResultSchema>

export const TaskReconcileResultSchema = z.object({
  task: GenerationTaskSchema,
  diagnostic: TaskDiagnosticSchema,
  observation: z.enum(['succeeded', 'failed', 'cancelled', 'running', 'unknown', 'local_active', 'unsupported', 'terminal']),
})
export type TaskReconcileResult = z.infer<typeof TaskReconcileResultSchema>

export const ProjectGenerationPolicySchema = z.object({
  projectId: IdSchema,
  revision: z.number().int().nonnegative(),
  billingMode: z.enum(['demo-only', 'user-funded']),
  paidProviders: z.enum(['blocked', 'enabled']),
  maxConcurrentTasks: z.number().int().min(1).max(32),
  maxCandidatesPerBatch: z.number().int().min(1).max(8),
  maxExportDurationMs: z.number().int().min(5_000).max(3_600_000),
  dailyPaidBudgetMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updatedAt: IsoDateSchema,
}).strict().superRefine((policy, context) => {
  if (policy.billingMode === 'demo-only' && (policy.paidProviders !== 'blocked' || policy.dailyPaidBudgetMicros !== 0)) {
    context.addIssue({ code: 'custom', path: ['billingMode'], message: 'Demo-only 必须关闭外部 Provider 且预算为 0' })
  }
  if (policy.billingMode === 'user-funded' && policy.paidProviders !== 'enabled') {
    context.addIssue({ code: 'custom', path: ['paidProviders'], message: '用户自付模式必须显式启用 Provider' })
  }
})
export type ProjectGenerationPolicy = z.infer<typeof ProjectGenerationPolicySchema>

export const ProjectGenerationPolicyUpdateRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  billingMode: z.enum(['demo-only', 'user-funded']).optional(),
  dailyPaidBudgetMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  maxConcurrentTasks: z.number().int().min(1).max(32),
  maxCandidatesPerBatch: z.number().int().min(1).max(8),
  maxExportDurationMs: z.number().int().min(5_000).max(3_600_000),
  confirmation: z.enum(['UPDATE_GENERATION_POLICY', 'ENABLE_USER_FUNDED_PROVIDERS']),
}).strict().superRefine((request, context) => {
  if ((request.billingMode === 'user-funded' || (request.dailyPaidBudgetMicros ?? 0) > 0) && request.confirmation !== 'ENABLE_USER_FUNDED_PROVIDERS') {
    context.addIssue({ code: 'custom', path: ['confirmation'], message: '启用外部 Provider 或付费预算需要专用二次确认' })
  }
})
export type ProjectGenerationPolicyUpdateRequest = z.infer<typeof ProjectGenerationPolicyUpdateRequestSchema>

export const TaskAdmissionSchema = z.object({
  projectId: IdSchema,
  allowed: z.boolean(),
  activeTasks: z.number().int().nonnegative(),
  maxConcurrentTasks: z.number().int().min(1).max(32),
  maxCandidatesPerBatch: z.number().int().min(1).max(8),
  maxExportDurationMs: z.number().int().min(5_000).max(3_600_000),
  policyRevision: z.number().int().nonnegative(),
  paidProviders: z.enum(['blocked', 'enabled']),
  dailyPaidBudgetMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dailyPaidSpentMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  remainingPaidBudgetMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  providerNetworkDisabled: z.boolean(),
  reasons: z.array(z.enum([
    'concurrency_limit', 'candidate_limit', 'export_duration_limit', 'paid_budget_exceeded',
    'paid_provider_disabled', 'provider_network_disabled',
  ])).max(6),
  checkedAt: IsoDateSchema,
}).strict()
export type TaskAdmission = z.infer<typeof TaskAdmissionSchema>

export const PlanStepSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2_000),
  action: z.enum(['analyze', 'extract_events', 'write_scenes', 'plan_assets', 'plan_shots', 'generate', 'export']),
  risk: z.enum(['read_only', 'writes_project', 'paid_provider', 'destructive', 'export']),
  status: z.enum(['pending', 'approved', 'running', 'succeeded', 'failed', 'cancelled']),
})
export const ExecutionPlanSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema,
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(2_000),
  checkpointRevision: z.number().int().nonnegative(),
  memoryContextHash: z.string().length(64).optional(),
  memoryCitationCount: z.number().int().nonnegative().max(20).default(0),
  status: z.enum(['draft', 'awaiting_approval', 'approved', 'running', 'succeeded', 'failed', 'cancelled']),
  steps: z.array(PlanStepSchema).min(1).max(20),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>

export const AgentRunCheckpointSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema,
  planId: IdSchema,
  graphRevision: z.number().int().nonnegative(),
  memoryQuery: z.string().max(500),
  memoryCitations: z.array(AgentMemoryCitationSchema).max(20),
  memoryContextHash: z.string().length(64),
  inputArtifactHashes: z.array(z.object({ artifactVersionId: IdSchema, contentHash: z.string().length(64) })).max(100).default([]),
  createdAt: IsoDateSchema,
}).strict()
export type AgentRunCheckpoint = z.infer<typeof AgentRunCheckpointSchema>

export const AgentApprovalSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  planId: IdSchema,
  checkpointRevision: z.number().int().nonnegative(),
  tokenHash: z.string().length(64),
  status: z.enum(['pending', 'consumed', 'rejected', 'expired']),
  expiresAt: IsoDateSchema,
  consumedAt: IsoDateSchema.optional(),
  createdAt: IsoDateSchema,
})
export type AgentApproval = z.infer<typeof AgentApprovalSchema>

export const PromptDefinitionSchema = z.object({
  id: IdSchema,
  stableKey: z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/),
  role: z.enum(['decision', 'execution', 'supervision']),
  version: z.number().int().positive(),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(30_000),
  variables: z.array(z.string().regex(/^[a-z][a-zA-Z0-9_]*$/)).max(50),
  outputSchema: JsonObjectSchema,
  status: z.enum(['draft', 'published', 'retired']),
  source: z.literal('original-clean-room'),
  contentHash: z.string().length(64),
  createdAt: IsoDateSchema,
})
export type PromptDefinition = z.infer<typeof PromptDefinitionSchema>

export const PromptRevisionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema.optional(),
  stableKey: z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/),
  revision: z.number().int().positive(),
  parentRevisionId: IdSchema.optional(),
  title: z.string().trim().min(1).max(160),
  role: z.enum(['decision', 'execution', 'supervision']),
  languageDrafts: z.object({
    original: z.string().min(1).max(30_000),
    zhReview: z.string().min(1).max(30_000),
    enExecution: z.string().min(1).max(30_000),
  }),
  feedback: z.string().max(8_000).default(''),
  variablesSchema: JsonObjectSchema,
  outputSchema: JsonObjectSchema,
  modelPolicy: JsonObjectSchema.default({}),
  status: z.enum(['draft', 'published', 'retired']),
  source: z.enum(['builtin', 'original-clean-room', 'project-override']),
  contentHash: z.string().length(64),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type PromptRevision = z.infer<typeof PromptRevisionSchema>

export const PromptPolishRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  feedback: z.string().trim().min(1).max(8_000),
  direction: z.enum(['clarity', 'cinematic', 'structure', 'brevity']).default('clarity'),
  idempotencyKey: z.string().min(16).max(200),
}).strict()
export type PromptPolishRequest = z.infer<typeof PromptPolishRequestSchema>

export const ScopedPromptBindingSchema = z.object({
  promptRevisionId: IdSchema,
  stableKey: z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/),
  promptRevision: z.number().int().positive(),
  promptContentHash: z.string().length(64),
  targetType: z.enum(['event', 'scene', 'shot']),
  targetId: IdSchema,
  targetRevision: z.number().int().positive(),
  projectGraphRevision: z.number().int().nonnegative(),
}).strict()
export type ScopedPromptBinding = z.infer<typeof ScopedPromptBindingSchema>

export const ScopedRegenerationRequestSchema = z.object({
  promptRevisionId: IdSchema,
  targetType: z.enum(['event', 'scene', 'shot']),
  targetId: IdSchema,
  variables: JsonObjectSchema.default({}),
  idempotencyKey: z.string().min(16).max(200),
}).strict()
export type ScopedRegenerationRequest = z.infer<typeof ScopedRegenerationRequestSchema>

export const ScopedRegenerationResultSchema = z.object({
  task: GenerationTaskSchema,
  artifact: ArtifactVersionSchema,
  candidate: CandidateSchema.optional(),
}).strict()
export type ScopedRegenerationResult = z.infer<typeof ScopedRegenerationResultSchema>

export const ShotRevisionPatchSchema = z.object({
  shotId: IdSchema,
  baseRevision: z.number().int().positive(),
  changes: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(4_000).optional(),
    dialogue: z.string().max(2_000).optional(),
    visualPrompt: z.string().max(8_000).optional(),
    videoPrompt: z.string().max(8_000).optional(),
    negativePrompt: z.string().max(4_000).optional(),
    durationMs: z.number().int().min(500).max(120_000).optional(),
    beats: z.array(ShotBeatSchema).max(16).optional(),
  }).strict().refine((changes) => Object.keys(changes).length > 0, { message: '镜头 patch 至少包含一个变更' }),
}).strict()
export type ShotRevisionPatch = z.infer<typeof ShotRevisionPatchSchema>

export const SceneRevisionPatchSchema = z.object({
  sceneId: IdSchema,
  baseRevision: z.number().int().positive(),
  changes: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    synopsis: z.string().max(4_000).optional(),
  }).strict().default({}),
  shotPatches: z.array(ShotRevisionPatchSchema).max(500).default([]),
}).strict().superRefine((patch, context) => {
  if (Object.keys(patch.changes).length === 0 && patch.shotPatches.length === 0) {
    context.addIssue({ code: 'custom', path: ['changes'], message: '场景 patch 至少包含一个场景或镜头变更' })
  }
  const shotIds = patch.shotPatches.map((item) => item.shotId)
  if (new Set(shotIds).size !== shotIds.length) {
    context.addIssue({ code: 'custom', path: ['shotPatches'], message: '同一镜头只能出现一次' })
  }
})
export type SceneRevisionPatch = z.infer<typeof SceneRevisionPatchSchema>

export const ScenePatchApplyRequestSchema = z.object({
  expectedProjectRevision: z.number().int().nonnegative(),
  expectedSceneRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(16).max(200),
  confirmation: z.literal('APPLY_SCENE_PATCH'),
}).strict()
export type ScenePatchApplyRequest = z.infer<typeof ScenePatchApplyRequestSchema>

export const ScenePatchApplyResultSchema = z.object({
  artifact: ArtifactVersionSchema,
  scene: SceneSchema,
  staleShotIds: z.array(IdSchema),
  updatedShots: z.array(ShotSchema).default([]),
  changedFields: z.array(z.object({
    targetType: z.enum(['scene', 'shot']),
    targetId: IdSchema,
    fields: z.array(z.string().min(1).max(120)).min(1),
    staleFields: z.array(z.string().min(1).max(120)),
  }).strict()).default([]),
  projectGraphRevision: z.number().int().nonnegative(),
  reused: z.boolean(),
}).strict()
export type ScenePatchApplyResult = z.infer<typeof ScenePatchApplyResultSchema>

export const PromptDiffSchema = z.object({
  fromRevisionId: IdSchema,
  toRevisionId: IdSchema,
  changes: z.array(z.object({
    field: z.enum(['title', 'original', 'zhReview', 'enExecution', 'feedback', 'variablesSchema', 'outputSchema', 'modelPolicy', 'status']),
    kind: z.enum(['added', 'removed', 'changed']),
    before: z.string().max(30_000).optional(),
    after: z.string().max(30_000).optional(),
  })).max(100),
})
export type PromptDiff = z.infer<typeof PromptDiffSchema>

export const PromptPolishResultSchema = z.object({
  sourceRevisionId: IdSchema,
  revision: PromptRevisionSchema,
  diff: PromptDiffSchema,
  lastKnownGoodRevisionId: IdSchema.optional(),
  requestHash: z.string().length(64),
  mode: z.literal('demo-deterministic'),
  reused: z.boolean(),
}).strict()
export type PromptPolishResult = z.infer<typeof PromptPolishResultSchema>

export const ArtifactHeadSchema = z.object({
  scope: ArtifactVersionSchema.shape.scope,
  artifactType: z.string().min(1).max(160),
  currentVersionId: IdSchema,
  expectedRevision: z.number().int().positive(),
  updatedAt: IsoDateSchema,
})
export type ArtifactHead = z.infer<typeof ArtifactHeadSchema>

export const ArtifactHistorySchema = z.object({
  head: ArtifactHeadSchema.optional(),
  versions: z.array(ArtifactVersionSchema).max(1_000),
})
export type ArtifactHistory = z.infer<typeof ArtifactHistorySchema>

export const ArtifactDiffSchema = z.object({
  fromVersionId: IdSchema,
  toVersionId: IdSchema,
  changes: z.array(z.object({
    field: z.string().min(1).max(240),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  }).strict()).max(500),
})
export type ArtifactDiff = z.infer<typeof ArtifactDiffSchema>

export const SkillManifestSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(1_000),
  entry: z.literal('SKILL.md'),
  resources: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/)).max(50),
  sha256: z.string().length(64),
})
export type SkillManifest = z.infer<typeof SkillManifestSchema>

export const SkillPackageVersionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema.optional(),
  stableKey: z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  parentVersionId: IdSchema.optional(),
  manifest: SkillManifestSchema,
  markdown: z.string().min(1).max(100_000),
  resources: z.array(z.object({
    path: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/),
    mime: z.string().min(3).max(160),
    size: z.number().int().nonnegative().max(10 * 1024 * 1024),
    sha256: z.string().length(64),
  })).max(50),
  trustLevel: z.enum(['builtin', 'reviewed', 'project', 'untrusted']),
  status: z.enum(['draft', 'published', 'retired']),
  source: z.enum(['builtin', 'original-clean-room', 'user-fork']),
  contentHash: z.string().length(64),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
})
export type SkillPackageVersion = z.infer<typeof SkillPackageVersionSchema>

export const GoldenEvaluationSchema = z.object({
  id: IdSchema,
  targetType: z.enum(['prompt', 'skill']),
  targetVersionId: IdSchema,
  name: z.string().trim().min(1).max(160),
  input: JsonObjectSchema,
  expectedSchema: JsonObjectSchema,
  fakeOutput: JsonObjectSchema,
  status: z.enum(['passed', 'failed']),
  diagnosticCode: z.string().max(160).optional(),
  createdAt: IsoDateSchema,
})
export type GoldenEvaluation = z.infer<typeof GoldenEvaluationSchema>

export const GraphNodeTypeSchema = z.enum([
  'series', 'episode', 'project', 'source', 'chapter', 'event', 'character', 'plan', 'scene', 'shot',
  'manual', 'style', 'asset', 'candidate', 'track', 'task', 'export',
])
export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  entityId: IdSchema,
  type: GraphNodeTypeSchema,
  label: z.string().min(1).max(200),
  subtitle: z.string().max(500).default(''),
  status: z.enum(['idle', 'ready', 'running', 'warning', 'failed', 'stale', 'selected']).default('idle'),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  metadata: JsonObjectSchema.default({}),
})
export type GraphNode = z.infer<typeof GraphNodeSchema>

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().min(1),
  label: z.string().max(120).optional(),
  animated: z.boolean().default(false),
})
export type GraphEdge = z.infer<typeof GraphEdgeSchema>

export const GraphProjectionSchema = z.object({
  projectId: IdSchema,
  view: z.enum(['story', 'production', 'delivery']),
  revision: z.number().int().nonnegative(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  generatedAt: IsoDateSchema,
})
export type GraphProjection = z.infer<typeof GraphProjectionSchema>

export const GraphCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move_nodes'), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().min(16), positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })) }),
  z.object({ type: z.literal('connect_events'), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().min(16), sourceEventId: IdSchema, targetEventId: IdSchema, edgeType: StoryEventEdgeTypeSchema }),
  z.object({ type: z.literal('select_candidate'), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().min(16), shotId: IdSchema, candidateId: IdSchema }),
  z.object({ type: z.literal('archive_entity'), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().min(16), entityType: z.enum(['asset', 'candidate']), entityId: IdSchema }),
  z.object({ type: z.literal('update_shot_beats'), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().min(16), shotId: IdSchema, beats: z.array(ShotBeatSchema).min(1).max(16) }),
  z.object({ type: z.literal('link_previous_boundary'), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().min(16), shotId: IdSchema }),
  z.object({ type: z.literal('clear_boundary_frame'), expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().min(16), shotId: IdSchema, role: z.enum(['start', 'end']) }),
])
export type GraphCommand = z.infer<typeof GraphCommandSchema>

export const ProjectSnapshotSchema = z.object({
  project: ProjectSchema,
  episode: EpisodeSchema.optional(),
  series: SeriesSchema.optional(),
  sources: z.array(SourceDocumentSchema),
  chapters: z.array(ChapterSchema),
  events: z.array(StoryEventSchema),
  eventEdges: z.array(StoryEventEdgeSchema),
  scenes: z.array(SceneSchema),
  shots: z.array(ShotSchema),
  assets: z.array(AssetUnitSchema),
  variants: z.array(AssetVariantSchema),
  assetBindings: z.array(AssetBindingSchema).default([]),
  resolvedAssets: z.array(ResolvedAssetSchema).default([]),
  media: z.array(MediaReferenceSchema),
  candidates: z.array(CandidateSchema),
  candidateBatches: z.array(CandidateBatchSchema).default([]),
  providerMediaReceipts: z.array(ProviderMediaReceiptSchema).default([]),
  tasks: z.array(GenerationTaskSchema),
  plans: z.array(ExecutionPlanSchema),
  promptRuns: z.array(PromptRunSchema),
  attempts: z.array(TaskAttemptSchema),
  providerReceipts: z.array(ProviderReceiptRecordSchema),
  reviews: z.array(ReviewDecisionSchema),
  artifactVersions: z.array(ArtifactVersionSchema),
})
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>

export const ProjectPackageFileSchema = z.object({
  path: z.string().regex(/^(?:project\.json|series\.json|projects\/[a-f0-9-]+\.json|media\/(?:[a-f0-9-]+\/)?[a-f0-9-]+\.[a-z0-9]+|shared-media\/[a-f0-9-]+\.[a-z0-9]+)$/),
  kind: z.enum(['project', 'series', 'media', 'shared-media']),
  size: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  mime: z.string().min(3).max(160).optional(),
  mediaId: IdSchema.optional(),
})
export type ProjectPackageFile = z.infer<typeof ProjectPackageFileSchema>

export const ProjectPackageManifestV1Schema = z.object({
  format: z.literal('aigc-director-project'),
  formatVersion: z.literal(1),
  appVersion: z.literal('2.0.0'),
  schemaVersion: z.number().int().positive(),
  sourceProjectId: IdSchema,
  projectName: z.string().trim().min(1).max(120),
  createdAt: IsoDateSchema,
  files: z.array(ProjectPackageFileSchema).min(1).max(5_001),
  excluded: z.array(z.enum(['credentials', 'provider-secrets', 'logs', 'absolute-paths'])),
})
export const ProjectPackageManifestV2Schema = z.object({
  format: z.literal('aigc-director-project'),
  formatVersion: z.literal(2),
  appVersion: z.literal('2.0.0'),
  schemaVersion: z.number().int().positive(),
  bundleKind: z.enum(['project', 'series']),
  sourceProjectId: IdSchema.optional(),
  sourceSeriesId: IdSchema.optional(),
  bundleName: z.string().trim().min(1).max(160),
  createdAt: IsoDateSchema,
  files: z.array(ProjectPackageFileSchema).min(1).max(5_001),
  excluded: z.array(z.enum(['credentials', 'provider-secrets', 'logs', 'absolute-paths'])),
}).superRefine((manifest, context) => {
  if (manifest.bundleKind === 'project' && !manifest.sourceProjectId) context.addIssue({ code: 'custom', path: ['sourceProjectId'], message: 'Project 包必须声明来源项目' })
  if (manifest.bundleKind === 'series' && !manifest.sourceSeriesId) context.addIssue({ code: 'custom', path: ['sourceSeriesId'], message: 'Series 包必须声明来源系列' })
})
export type ProjectPackageManifestV2 = z.infer<typeof ProjectPackageManifestV2Schema>
export const ProjectPackageManifestSchema = z.union([ProjectPackageManifestV1Schema, ProjectPackageManifestV2Schema])
export type ProjectPackageManifest = z.infer<typeof ProjectPackageManifestSchema>

export const SeriesPackagePayloadSchema = z.object({
  series: SeriesSchema,
  episodes: z.array(EpisodeSchema).min(1).max(1_000),
  projects: z.array(ProjectSnapshotSchema).min(1).max(1_000),
  sharedAssets: z.array(SharedAssetSchema).max(10_000),
  sharedVariants: z.array(SharedAssetVariantSchema).max(50_000),
  sharedMediaReferences: z.array(SharedMediaReferenceSchema).max(50_000).default([]),
}).superRefine((payload, context) => {
  const projectIds = new Set(payload.projects.map((snapshot) => snapshot.project.id))
  const episodeProjectIds = new Set(payload.episodes.map((episode) => episode.projectId))
  if (payload.episodes.some((episode) => episode.seriesId !== payload.series.id)) context.addIssue({ code: 'custom', path: ['episodes'], message: '分集必须属于声明的 Series' })
  if (projectIds.size !== payload.projects.length || episodeProjectIds.size !== payload.episodes.length || [...projectIds].some((id) => !episodeProjectIds.has(id))) {
    context.addIssue({ code: 'custom', path: ['projects'], message: 'Series 包的 Project 与 Episode 必须一一对应' })
  }
})
export type SeriesPackagePayload = z.infer<typeof SeriesPackagePayloadSchema>

export const ProjectPackageImportReportSchema = z.object({
  project: ProjectSchema,
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  bundleKind: z.enum(['project', 'series']).default('project'),
  fileCount: z.number().int().positive(),
  mediaCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  remappedEntityCount: z.number().int().nonnegative(),
  warnings: z.array(z.string().max(500)).max(100),
  series: SeriesSchema.optional(),
  projects: z.array(ProjectSchema).optional(),
})
export type ProjectPackageImportReport = z.infer<typeof ProjectPackageImportReportSchema>

export const ExportRequestSchema = z.object({
  projectId: IdSchema,
  outputDirectory: z.string().min(1).max(2_048),
  fileName: z.string().regex(/^[^/\\]+\.mp4$/i),
  width: z.number().int().min(320).max(3_840).default(1_280),
  height: z.number().int().min(320).max(2_160).default(720),
  fps: z.number().int().min(12).max(60).default(24),
})
export type ExportRequest = z.infer<typeof ExportRequestSchema>

export const ExportPreflightSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  fileName: z.string().regex(/^[^/\\]+\.mp4$/i),
  shotCount: z.number().int().positive().max(10_000),
  selectedCandidateCount: z.number().int().positive().max(10_000),
  durationMs: z.number().int().positive(),
  width: z.number().int().min(320).max(3_840),
  height: z.number().int().min(320).max(2_160),
  fps: z.number().int().min(12).max(60),
  assemblyHash: z.string().length(64),
  destination: z.literal('local-directory-selected'),
  billing: z.object({
    provider: z.literal('demo-local'),
    verified: z.literal(true),
    amountMicros: z.literal(0),
    currency: z.literal('none'),
  }).strict(),
  approvalToken: z.string().min(20).max(200),
  expiresAt: IsoDateSchema,
}).strict()
export type ExportPreflight = z.infer<typeof ExportPreflightSchema>

export const ExportApprovalRequestSchema = z.object({
  preflightId: IdSchema,
  approvalToken: z.string().min(20).max(200),
  confirmation: z.literal('START_LOCAL_EXPORT'),
}).strict()
export type ExportApprovalRequest = z.infer<typeof ExportApprovalRequestSchema>

export const ExportSelectionSchema = z.object({
  shotId: IdSchema,
  shotRevision: z.number().int().positive(),
  candidateId: IdSchema,
  mediaId: IdSchema,
  mediaSha256: z.string().length(64),
  kind: z.enum(['image', 'video']),
}).strict()
export type ExportSelection = z.infer<typeof ExportSelectionSchema>

export const ExportTaskInputSchema = ExportRequestSchema.extend({
  shotSnapshots: z.array(ShotSchema).min(1).max(10_000),
  selections: z.array(ExportSelectionSchema).min(1).max(10_000),
  assemblyHash: z.string().length(64),
  assembledAt: IsoDateSchema,
}).superRefine((input, context) => {
  if (input.shotSnapshots.length !== input.selections.length) context.addIssue({ code: 'custom', path: ['selections'], message: '每个镜头必须固定一个已选候选' })
  const shotIds = input.shotSnapshots.map((shot) => shot.id)
  if (new Set(shotIds).size !== shotIds.length || input.selections.some((selection, index) => selection.shotId !== shotIds[index])) {
    context.addIssue({ code: 'custom', path: ['selections'], message: '导出选择必须按镜头顺序一一对应' })
  }
})
export type ExportTaskInput = z.infer<typeof ExportTaskInputSchema>

export const HealthSchema = z.object({
  status: z.literal('ok'),
  version: z.literal('2.0.0'),
  demoMode: z.boolean(),
  providerNetworkDisabled: z.boolean(),
  schemaVersion: z.literal(12),
  timestamp: IsoDateSchema,
})
export type Health = z.infer<typeof HealthSchema>
