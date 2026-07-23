import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { fileTypeFromBuffer } from 'file-type'
import multer from 'multer'
import { Server as SocketServer } from 'socket.io'
import { createServer, type Server as HttpServer } from 'node:http'
import { z, ZodError } from 'zod'
import {
  AppErrorSchema,
  ArtifactHistorySchema,
  AssetBatchBindingDraftSchema,
  AssetTypeSchema,
  AssetUnitSchema,
  CandidateBatchRetryRequestSchema,
  CandidateSchema,
  CreativeBriefCandidateRequestSchema,
  CreativeBriefCandidateReviewRequestSchema,
  CreativeBriefRevisionRequestSchema,
  EpisodeContinuitySummaryRequestSchema,
  ReconcileDecisionSchema,
  ExportApprovalRequestSchema,
  ExportRequestSchema,
  GraphCommandSchema,
  HealthSchema,
  IdSchema,
  JsonObjectSchema,
  MediaReferenceSchema,
  ProviderConnectionCreateRequestSchema,
  ProviderCredentialUpdateRequestSchema,
  ProviderRoutePolicyUpdateRequestSchema,
  RoutedCandidateGenerationRequestSchema,
  PromptPolishRequestSchema,
  ProjectGenerationPolicyUpdateRequestSchema,
  ScopedRegenerationRequestSchema,
  ScenePatchApplyRequestSchema,
  SourceImportCommitSchema,
  TaskRetryRequestSchema,
  type ApiEnvelope,
  type AppErrorPayload,
  type Candidate,
  type CandidateBatch,
  type GenerationTask,
  type GraphProjection,
  type MediaReference,
  type ProjectSnapshot,
  type Shot,
  parseAssetMetadata,
} from '@aigc-director/contracts'
import {
  EgressBroker,
  FakeProvider,
  type EgressRuntimePolicy,
  type ProviderRouter,
} from '@aigc-director/providers'
import { createDemoPackProvider } from '@aigc-director/agents'
import { getModel, listModels } from '@aigc-director/model-catalog'
import { previewMediaResolution } from '@aigc-director/media'
import { DirectorDatabase } from '../db/database.js'
import { sharpRuntime } from '../runtimeModules.js'
import { DirectorService, type TaskEvent } from '../services/directorService.js'
import { AssetContinuityService } from '../services/assetContinuityService.js'
import { ProjectPackageService } from '../services/projectPackageService.js'
import { SourceImportService } from '../services/sourceImportService.js'
import { SharedAssetMediaService } from '../services/sharedAssetMediaService.js'
import { PromptOperationsService } from '../services/promptOperationsService.js'
import { MemoryService } from '../services/memoryService.js'
import { SecurityAuditService } from '../services/securityAuditService.js'
import { createCredentialVault, type CredentialVault } from '../services/credentialVault.js'
import { BrokerProviderConnectionProbe, ProviderConnectionService, type ProviderConnectionProbe } from '../services/providerConnectionService.js'

const createProjectInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2_000).optional() })
const defaultEgressPolicies = [
  {
    id: 'media-fetch.default', channel: 'media-fetch', enabled: false, allowedHosts: [], allowedMethods: ['GET'],
    timeoutMs: 15_000, maxRequestBytes: 0, maxResponseBytes: 50_000_000, maxRedirects: 2,
    allowedResponseMimePrefixes: ['image/', 'video/', 'audio/', 'application/octet-stream'],
  },
  {
    id: 'model-api.default', channel: 'model-api', enabled: false, allowedHosts: [], allowedMethods: ['POST'],
    timeoutMs: 60_000, maxRequestBytes: 2_000_000, maxResponseBytes: 10_000_000, maxRedirects: 0,
    allowedResponseMimePrefixes: ['application/json'],
  },
  {
    id: 'temporary-upload.default', channel: 'temporary-upload', enabled: false, allowedHosts: [], allowedMethods: ['POST', 'PUT'],
    timeoutMs: 120_000, maxRequestBytes: 20_000_000, maxResponseBytes: 2_000_000, maxRedirects: 0,
    allowedResponseMimePrefixes: ['application/json'],
  },
] satisfies EgressRuntimePolicy[]
const importSourceInput = z.object({ title: z.string().trim().min(1).max(200), content: z.string().min(4).max(2_000_000), language: z.string().min(2).max(16).optional() })
const planInput = z.object({ idempotencyKey: z.string().min(16).max(200) })
const approvalInput = z.object({ token: z.string().min(20).max(200) })
const viewSchema = z.enum(['story', 'production', 'delivery'])
const createAssetInput = AssetUnitSchema.pick({ type: true, scope: true, name: true, description: true, metadata: true })
const createSeriesInput = z.object({
  name: z.string().trim().min(1).max(160), description: z.string().max(4_000).optional(),
  artDirection: z.string().max(8_000).optional(), defaults: z.record(z.string(), z.unknown()).optional(),
})
const attachEpisodeInput = z.object({ projectId: IdSchema, ordinal: z.number().int().nonnegative().optional() })
const createSharedAssetInput = z.object({
  scope: z.enum(['global', 'series']), seriesId: IdSchema.optional(), logicalId: IdSchema.optional(),
  type: AssetTypeSchema, name: z.string().trim().min(1).max(160), description: z.string().max(4_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).superRefine((asset, context) => {
  if (asset.scope === 'series' && !asset.seriesId) context.addIssue({ code: 'custom', path: ['seriesId'], message: 'Series 资产必须绑定系列' })
  if (asset.scope === 'global' && asset.seriesId) context.addIssue({ code: 'custom', path: ['seriesId'], message: 'Global 资产不能绑定系列' })
})
const createSharedVariantInput = z.object({
  label: z.string().trim().min(1).max(160), prompt: z.string().max(8_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), favorite: z.boolean().optional(),
})
const reviseSharedAssetInput = z.object({
  name: z.string().trim().min(1).max(160).optional(), description: z.string().max(4_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), selectedVariantId: IdSchema.optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), { message: '至少提供一个变更字段' })
const forkAssetInput = z.object({ projectId: IdSchema, sharedAssetId: IdSchema, sharedVariantId: IdSchema })
const promoteAssetInput = z.object({
  projectId: IdSchema, assetId: IdSchema, variantId: IdSchema, scope: z.enum(['global', 'series']), seriesId: IdSchema.optional(),
})
const reconcilePreviewInput = z.object({ expectedProjectRevision: z.number().int().nonnegative(), decisions: z.array(ReconcileDecisionSchema).min(1).max(500) })
const operationApplyInput = z.object({ operationId: IdSchema, approvalToken: z.string().min(20).max(200) })
const batchBindPreviewInput = z.object({
  episodeId: IdSchema, expectedProjectRevision: z.number().int().nonnegative(), bindings: z.array(AssetBatchBindingDraftSchema).min(1).max(500),
})
const promptRevisionInput = z.object({
  projectId: IdSchema.optional(), stableKey: z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/), title: z.string().trim().min(1).max(160),
  role: z.enum(['decision', 'execution', 'supervision']),
  languageDrafts: z.object({ original: z.string().min(1).max(30_000), zhReview: z.string().min(1).max(30_000), enExecution: z.string().min(1).max(30_000) }),
  feedback: z.string().max(8_000).optional(), variablesSchema: JsonObjectSchema, outputSchema: JsonObjectSchema,
  modelPolicy: JsonObjectSchema.optional(), status: z.enum(['draft', 'published', 'retired']).optional(),
  source: z.enum(['builtin', 'original-clean-room', 'project-override']).optional(),
})
const goldenInput = z.object({ name: z.string().trim().min(1).max(160), input: JsonObjectSchema, expectedSchema: JsonObjectSchema, fakeOutput: JsonObjectSchema })
const skillCreateInput = z.object({
  projectId: IdSchema.optional(), stableKey: z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/), name: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).optional(), markdown: z.string().min(1).max(100_000),
  resources: z.array(z.object({
    path: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/), mime: z.string().min(3).max(160),
    size: z.number().int().nonnegative().max(10 * 1024 * 1024), sha256: z.string().length(64),
  })).max(50).optional(),
})
const artifactScopeType = z.enum(['project', 'series', 'episode', 'source', 'chapter', 'event', 'scene', 'shot', 'candidate'])
const candidateAnnotationInput = z.object({
  label: z.string().trim().max(120).optional(), favorite: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), { message: '至少提供一个候选标注字段' })
const mediaResolutionPreviewInput = z.object({
  projectId: IdSchema, modelId: z.string().min(1).max(160),
  inputs: z.array(z.object({ mediaId: IdSchema, role: z.enum(['reference', 'first-frame', 'last-frame']), order: z.number().int().nonnegative() })).max(100),
})
const boundaryExtractionInput = z.object({ projectId: IdSchema, candidateId: IdSchema, idempotencyKey: z.string().min(16).max(200) })
const memorySearchInput = z.object({ projectId: IdSchema, q: z.string().trim().min(1).max(500), limit: z.coerce.number().int().min(1).max(50).optional() })
const memoryToggleInput = z.object({ disabled: z.boolean() })

interface AppOptions {
  databasePath: string
  dataDirectory: string
  sessionToken: string
  bootstrapToken?: string
  allowedOrigins?: string[]
  studioDirectory?: string
  packProviderFactory?: () => ReturnType<typeof createDemoPackProvider>
  onTaskEvent?: (event: TaskEvent) => void
  onUnhandledError?: (error: unknown) => void
  providerNetworkDisabled?: boolean
  maxConcurrentTasks?: number
  credentialVault?: CredentialVault
  providerConnectionProbe?: ProviderConnectionProbe
  providerRouter?: ProviderRouter
}

interface RequestWithCorrelation extends Request {
  correlationId?: string
  localAuthMode?: 'bearer' | 'cookie'
}

const browserSessionCookie = 'aigc_director_session'
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function secretEquals(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

function cookieValue(rawCookie: string | undefined, name: string): string | undefined {
  for (const item of rawCookie?.split(';') ?? []) {
    const separator = item.indexOf('=')
    if (separator < 1) continue
    if (item.slice(0, separator).trim() !== name) continue
    try { return decodeURIComponent(item.slice(separator + 1).trim()) } catch { return undefined }
  }
  return undefined
}

function safeStudioReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/studio'
  return /^\/studio(?:[/?#][^\r\n]*)?$/u.test(raw) ? raw : '/studio'
}

const errorMap: Readonly<Record<string, { status: number; code: string; message: string; retryable: boolean }>> = {
  PROJECT_NOT_FOUND: { status: 404, code: 'PROJECT_NOT_FOUND', message: '项目不存在。', retryable: false },
  PROVIDER_CONNECTION_NOT_FOUND: { status: 404, code: 'PROVIDER_CONNECTION_NOT_FOUND', message: 'Provider 连接不存在。', retryable: false },
  PROVIDER_CONNECTION_REVISION_CONFLICT: { status: 409, code: 'PROVIDER_CONNECTION_REVISION_CONFLICT', message: 'Provider 连接已被更新，请刷新后重试。', retryable: true },
  PROVIDER_CREDENTIAL_KEY_IN_USE: { status: 409, code: 'PROVIDER_CREDENTIAL_KEY_IN_USE', message: '凭据别名已被其他连接使用。', retryable: false },
  PROVIDER_CREDENTIAL_UNSUPPORTED: { status: 422, code: 'PROVIDER_CREDENTIAL_UNSUPPORTED', message: '此连接不使用外部凭据。', retryable: false },
  CREDENTIAL_STORE_READ_ONLY: { status: 409, code: 'CREDENTIAL_STORE_READ_ONLY', message: 'Docker 凭据为只读 Secret，请在宿主凭据文件中更新。', retryable: false },
  PROVIDER_ROUTE_REVISION_CONFLICT: { status: 409, code: 'PROVIDER_ROUTE_REVISION_CONFLICT', message: 'Provider 路由已被更新，请刷新后重试。', retryable: true },
  PROVIDER_ROUTE_CONNECTION_NOT_FOUND: { status: 422, code: 'PROVIDER_ROUTE_CONNECTION_NOT_FOUND', message: '路由引用了不存在的 Provider 连接。', retryable: false },
  PROVIDER_ROUTE_CONNECTION_NOT_READY: { status: 409, code: 'PROVIDER_ROUTE_CONNECTION_NOT_READY', message: '路由中的 Provider 连接尚未通过测试。', retryable: true },
  PROVIDER_ROUTE_CAPABILITY_MISMATCH: { status: 422, code: 'PROVIDER_ROUTE_CAPABILITY_MISMATCH', message: 'Provider 连接不支持该生成模态。', retryable: false },
  SERIES_NOT_FOUND: { status: 404, code: 'SERIES_NOT_FOUND', message: '系列不存在。', retryable: false },
  SERIES_EPISODES_REQUIRED: { status: 422, code: 'SERIES_EPISODES_REQUIRED', message: '系列至少需要一个分集才能打包。', retryable: false },
  SERIES_REFERENCED: { status: 409, code: 'SERIES_REFERENCED', message: '系列仍包含分集，不能删除。', retryable: false },
  EPISODE_NOT_FOUND: { status: 404, code: 'EPISODE_NOT_FOUND', message: '分集不存在。', retryable: false },
  EPISODE_CONTINUITY_SOURCE_REQUIRED: { status: 422, code: 'EPISODE_CONTINUITY_SOURCE_REQUIRED', message: '当前分集没有可生成连续性摘要的来源内容。', retryable: false },
  EPISODE_CONTINUITY_SOURCE_CHANGED: { status: 409, code: 'EPISODE_CONTINUITY_SOURCE_CHANGED', message: '来源内容已在审阅后变化，请刷新并重新确认。', retryable: true },
  EPISODE_CONTINUITY_IDEMPOTENCY_CORRUPT: { status: 500, code: 'EPISODE_CONTINUITY_IDEMPOTENCY_CORRUPT', message: '跨集摘要幂等记录不完整，请使用关联 ID 诊断。', retryable: false },
  ASSET_NOT_FOUND: { status: 404, code: 'ASSET_NOT_FOUND', message: '资产不存在。', retryable: false },
  ASSET_VARIANT_NOT_FOUND: { status: 404, code: 'ASSET_VARIANT_NOT_FOUND', message: '资产版本不存在或不属于该资产。', retryable: false },
  ASSET_REFERENCED: { status: 409, code: 'ASSET_REFERENCED', message: '资产仍被镜头或任务引用，请先处理影响项。', retryable: false },
  ASSET_MEDIA_NOT_FOUND: { status: 409, code: 'ASSET_MEDIA_NOT_FOUND', message: '资产媒体已丢失，请修复引用后重试。', retryable: true },
  ASSET_MEDIA_HASH_MISMATCH: { status: 409, code: 'ASSET_MEDIA_HASH_MISMATCH', message: '资产媒体内容已变化，请重新选择素材。', retryable: true },
  ASSET_MEDIA_PATH_INVALID: { status: 422, code: 'ASSET_MEDIA_PATH_INVALID', message: '资产媒体路径无效。', retryable: false },
  ASSET_MEDIA_PROJECT_MISMATCH: { status: 409, code: 'ASSET_MEDIA_PROJECT_MISMATCH', message: '资产媒体不属于当前分集。', retryable: false },
  BINDING_NOT_FOUND: { status: 404, code: 'BINDING_NOT_FOUND', message: '资产绑定不存在。', retryable: false },
  RECONCILE_NOT_FOUND: { status: 404, code: 'RECONCILE_NOT_FOUND', message: '影响预览不存在。', retryable: false },
  RECONCILE_ALREADY_APPLIED: { status: 409, code: 'RECONCILE_ALREADY_APPLIED', message: '该审批已执行，不能重复应用。', retryable: false },
  RECONCILE_EXPIRED: { status: 410, code: 'RECONCILE_EXPIRED', message: '影响预览已过期，请重新预览。', retryable: true },
  RECONCILE_HAS_CONFLICTS: { status: 409, code: 'RECONCILE_HAS_CONFLICTS', message: '影响预览仍有冲突，不能执行。', retryable: true },
  PLAN_NOT_FOUND: { status: 404, code: 'PLAN_NOT_FOUND', message: '制作计划不存在。', retryable: false },
  APPROVAL_NOT_FOUND: { status: 404, code: 'APPROVAL_NOT_FOUND', message: '审批点不存在。', retryable: false },
  AGENT_CHECKPOINT_NOT_FOUND: { status: 404, code: 'AGENT_CHECKPOINT_NOT_FOUND', message: 'Agent 运行证据不存在。', retryable: false },
  AGENT_CHECKPOINT_INVALID: { status: 409, code: 'AGENT_CHECKPOINT_INVALID', message: 'Agent 计划与记忆快照不一致，请重新生成计划。', retryable: true },
  AGENT_CHECKPOINT_IMMUTABLE: { status: 409, code: 'AGENT_CHECKPOINT_IMMUTABLE', message: 'Agent 运行证据不可覆盖。', retryable: false },
  APPROVAL_ALREADY_CONSUMED: { status: 409, code: 'APPROVAL_ALREADY_CONSUMED', message: '该审批已经使用，不能重复执行。', retryable: false },
  APPROVAL_STALE_CHECKPOINT: { status: 409, code: 'APPROVAL_STALE_CHECKPOINT', message: '项目已发生变化，请重新审阅计划。', retryable: true },
  APPROVAL_EXPIRED: { status: 409, code: 'APPROVAL_EXPIRED', message: '审批已过期，请重新生成计划。', retryable: true },
  APPROVAL_TOKEN_INVALID: { status: 403, code: 'APPROVAL_TOKEN_INVALID', message: '审批凭证无效。', retryable: false },
  GRAPH_REVISION_CONFLICT: { status: 409, code: 'GRAPH_REVISION_CONFLICT', message: '画布已在其他操作中更新，请刷新后重试。', retryable: true },
  BRIEF_REVISION_CONFLICT: { status: 409, code: 'BRIEF_REVISION_CONFLICT', message: '创意简报已被其他操作更新，请刷新后对比重试。', retryable: true },
  BRIEF_CANDIDATE_NOT_FOUND: { status: 404, code: 'BRIEF_CANDIDATE_NOT_FOUND', message: '创意简报候选不存在或不属于当前项目。', retryable: false },
  BRIEF_CANDIDATE_ALREADY_REVIEWED: { status: 409, code: 'BRIEF_CANDIDATE_ALREADY_REVIEWED', message: '该创意简报候选已经审阅，不能重复改变结论。', retryable: false },
  BRIEF_CANDIDATE_IDEMPOTENCY_CORRUPT: { status: 500, code: 'BRIEF_CANDIDATE_IDEMPOTENCY_CORRUPT', message: '创意简报候选的幂等记录不完整，请使用关联 ID 诊断。', retryable: false },
  SCENE_PATCH_NOT_FOUND: { status: 404, code: 'SCENE_PATCH_NOT_FOUND', message: '场景修订不存在或不属于当前项目。', retryable: false },
  SCENE_PATCH_REVISION_CONFLICT: { status: 409, code: 'SCENE_PATCH_REVISION_CONFLICT', message: '场景已在修订生成后变更，请重新生成 patch。', retryable: true },
  SCENE_PATCH_ALREADY_APPLIED: { status: 409, code: 'SCENE_PATCH_ALREADY_APPLIED', message: '该场景修订已应用，不能重放。', retryable: false },
  SHOT_PATCH_SCENE_MISMATCH: { status: 409, code: 'SHOT_PATCH_SCENE_MISMATCH', message: '镜头修订不属于当前场景，未应用任何变更。', retryable: false },
  SHOT_PATCH_REVISION_CONFLICT: { status: 409, code: 'SHOT_PATCH_REVISION_CONFLICT', message: '镜头已在修订生成后变更，请重新生成 patch。', retryable: true },
  SHOT_PATCH_INVALID: { status: 422, code: 'SHOT_PATCH_INVALID', message: '镜头修订与时长、Beat 或字段契约不一致，未应用任何变更。', retryable: false },
  SHOT_NOT_FOUND: { status: 404, code: 'SHOT_NOT_FOUND', message: '镜头不存在。', retryable: false },
  PREVIOUS_SHOT_MISSING: { status: 422, code: 'PREVIOUS_SHOT_MISSING', message: '第一个镜头没有可沿用的上一镜头。', retryable: false },
  PREVIOUS_END_FRAME_MISSING: { status: 409, code: 'PREVIOUS_END_FRAME_MISSING', message: '上一镜头尚未绑定尾帧，请先生成或选择尾帧。', retryable: true },
  BOUNDARY_FRAME_MEDIA_INVALID: { status: 409, code: 'BOUNDARY_FRAME_MEDIA_INVALID', message: '边界帧媒体丢失或已变化，请重新绑定。', retryable: true },
  BOUNDARY_EXTRACTION_REQUIRES_VIDEO: { status: 422, code: 'BOUNDARY_EXTRACTION_REQUIRES_VIDEO', message: '只有已完成的视频候选可以提取真实尾帧。', retryable: false },
  EXPORT_REQUIRES_SHOTS: { status: 422, code: 'EXPORT_REQUIRES_SHOTS', message: '当前项目没有可导出镜头。', retryable: false },
  EXPORT_REQUIRES_SELECTED_CANDIDATES: { status: 409, code: 'EXPORT_REQUIRES_SELECTED_CANDIDATES', message: '每个镜头都必须先明确选定候选。', retryable: true },
  EXPORT_CANDIDATE_INVALID: { status: 409, code: 'EXPORT_CANDIDATE_INVALID', message: '已选候选不存在、已归档或不属于相应镜头。', retryable: true },
  EXPORT_MEDIA_MISSING: { status: 409, code: 'EXPORT_MEDIA_MISSING', message: '已选候选的媒体引用缺失。', retryable: true },
  EXPORT_MEDIA_CHANGED: { status: 409, code: 'EXPORT_MEDIA_CHANGED', message: '导出快照中的媒体已变化，请修复后创建新导出。', retryable: true },
  EXPORT_MEDIA_LOCATOR_INVALID: { status: 422, code: 'EXPORT_MEDIA_LOCATOR_INVALID', message: '导出媒体定位不符合受管路径约束。', retryable: false },
  EXPORT_ARCHIVE_INTEGRITY_FAILED: { status: 500, code: 'EXPORT_ARCHIVE_INTEGRITY_FAILED', message: '成片归档完整性校验失败，原导出文件未被覆盖。', retryable: true },
  EXPORT_PREFLIGHT_NOT_FOUND: { status: 404, code: 'EXPORT_PREFLIGHT_NOT_FOUND', message: '导出预检不存在，请重新选择目录并预检。', retryable: true },
  EXPORT_PREFLIGHT_EXPIRED: { status: 409, code: 'EXPORT_PREFLIGHT_EXPIRED', message: '导出预检已过期，请重新检查当前项目。', retryable: true },
  EXPORT_PREFLIGHT_STALE: { status: 409, code: 'EXPORT_PREFLIGHT_STALE', message: '镜头或候选已在预检后变化，请重新预检。', retryable: true },
  EXPORT_PREFLIGHT_IDEMPOTENCY_CORRUPT: { status: 500, code: 'EXPORT_PREFLIGHT_IDEMPOTENCY_CORRUPT', message: '导出预检的幂等记录不完整，请使用关联 ID 诊断。', retryable: false },
  PLAN_REQUIRES_EVENTS: { status: 422, code: 'PLAN_REQUIRES_EVENTS', message: '请先导入内容并生成章节事件。', retryable: false },
  PRODUCTION_REQUIRES_SHOTS: { status: 422, code: 'PRODUCTION_REQUIRES_SHOTS', message: '计划批准后才能进入生产。', retryable: false },
  TASK_NOT_FOUND: { status: 404, code: 'TASK_NOT_FOUND', message: '任务不存在。', retryable: false },
  TASK_RECONCILE_REQUIRED: { status: 409, code: 'TASK_RECONCILE_REQUIRED', message: '任务结果未知，必须先对账，不能直接重试。', retryable: true },
  TASK_RECONCILE_UNSUPPORTED: { status: 409, code: 'TASK_RECONCILE_UNSUPPORTED', message: '缺少可验证的 Provider receipt，请人工检查任务。', retryable: false },
  TASK_NOT_RETRYABLE: { status: 409, code: 'TASK_NOT_RETRYABLE', message: '任务当前状态不允许重试。', retryable: false },
  TASK_CONCURRENCY_LIMIT: { status: 429, code: 'TASK_CONCURRENCY_LIMIT', message: '项目并发任务已达安全上限，请等待或处理未知任务。', retryable: true },
  CANDIDATE_POLICY_LIMIT: { status: 422, code: 'CANDIDATE_POLICY_LIMIT', message: '候选数量超过当前项目安全策略，请减少批次规模。', retryable: false },
  EXPORT_DURATION_POLICY_LIMIT: { status: 422, code: 'EXPORT_DURATION_POLICY_LIMIT', message: '导出总时长超过当前项目安全策略，请调整时间线或策略。', retryable: false },
  PAID_BUDGET_EXCEEDED: { status: 403, code: 'PAID_BUDGET_EXCEEDED', message: '该操作超过项目当日外部 Provider 成本上限，请调整预算或等待下一周期。', retryable: false },
  GENERATION_POLICY_REVISION_CONFLICT: { status: 409, code: 'GENERATION_POLICY_REVISION_CONFLICT', message: '项目生成策略已更新，请刷新后重新确认。', retryable: true },
  GENERATION_POLICY_REVISION_INVALID: { status: 409, code: 'GENERATION_POLICY_REVISION_INVALID', message: '项目生成策略 revision 无效。', retryable: false },
  GENERATION_POLICY_RUNTIME_LIMIT: { status: 422, code: 'GENERATION_POLICY_RUNTIME_LIMIT', message: '并发上限不能超过当前运行时安全上限。', retryable: false },
  PAID_PROVIDER_DISABLED: { status: 403, code: 'PAID_PROVIDER_DISABLED', message: '项目尚未显式启用用户自付 Provider，当前只允许零 Key Demo。', retryable: false },
  PROVIDER_ROUTE_NOT_CONFIGURED: { status: 409, code: 'PROVIDER_ROUTE_NOT_CONFIGURED', message: '项目尚未配置对应模态的可用 Provider 路由。', retryable: false },
  PROVIDER_ROUTER_UNAVAILABLE: { status: 503, code: 'PROVIDER_ROUTER_UNAVAILABLE', message: 'Provider 路由运行时当前不可用。', retryable: true },
  EXECUTABLE_PROVIDER_ADAPTERS_DISABLED: { status: 410, code: 'EXECUTABLE_PROVIDER_ADAPTERS_DISABLED', message: '可执行 Provider 插件已永久停用。请改用内置适配器或声明式 HTTPS 连接。', retryable: false },
  TASK_RETRY_UNSUPPORTED: { status: 409, code: 'TASK_RETRY_UNSUPPORTED', message: '该任务必须从对应工作区局部重新生成，不能在任务中心盲目重提。', retryable: false },
  TASK_RETRY_INPUT_INVALID: { status: 409, code: 'TASK_RETRY_INPUT_INVALID', message: '任务输入快照不完整，无法安全重试。', retryable: false },
  TASK_RETRY_IDEMPOTENCY_CORRUPT: { status: 500, code: 'TASK_RETRY_IDEMPOTENCY_CORRUPT', message: '重试记录不完整，请使用关联 ID 诊断。', retryable: false },
  CANDIDATE_NOT_FOUND: { status: 404, code: 'CANDIDATE_NOT_FOUND', message: '候选不存在。', retryable: false },
  CANDIDATE_BATCH_NOT_FOUND: { status: 404, code: 'CANDIDATE_BATCH_NOT_FOUND', message: '候选批次不存在。', retryable: false },
  CANDIDATE_BATCH_HAS_NO_FAILED_ITEMS: { status: 409, code: 'CANDIDATE_BATCH_HAS_NO_FAILED_ITEMS', message: '该批次没有可安全重试的失败项。', retryable: false },
  CANDIDATE_BATCH_RETRY_UNSUPPORTED: { status: 409, code: 'CANDIDATE_BATCH_RETRY_UNSUPPORTED', message: '该批次不具备可验证的本地重试快照，请从领域工作区重新生成。', retryable: false },
  CANDIDATE_BATCH_RETRY_IDEMPOTENCY_CORRUPT: { status: 500, code: 'CANDIDATE_BATCH_RETRY_IDEMPOTENCY_CORRUPT', message: '候选重试记录不完整，请使用关联 ID 诊断。', retryable: false },
  MEDIA_REFERENCE_NOT_FOUND: { status: 404, code: 'MEDIA_REFERENCE_NOT_FOUND', message: '媒体引用不存在。', retryable: false },
  MODEL_NOT_FOUND: { status: 404, code: 'MODEL_NOT_FOUND', message: '模型目录中不存在该模型。', retryable: false },
  MODEL_CAPABILITY_UNSUPPORTED: { status: 422, code: 'MODEL_CAPABILITY_UNSUPPORTED', message: '模型不支持所需能力或输入形式。', retryable: false },
  MEDIA_RESOLUTION_UNSUPPORTED: { status: 422, code: 'MEDIA_RESOLUTION_UNSUPPORTED', message: '媒体输入不能安全解析为该模型支持的形式。', retryable: false },
  MEDIA_REFERENCE_LIMIT_EXCEEDED: { status: 422, code: 'MEDIA_REFERENCE_LIMIT_EXCEEDED', message: '媒体引用数量超过模型限制。', retryable: false },
  MEDIA_ORDER_INVALID: { status: 422, code: 'MEDIA_ORDER_INVALID', message: '媒体引用顺序不连续。', retryable: false },
  MEDIA_PROJECT_MISMATCH: { status: 409, code: 'MEDIA_PROJECT_MISMATCH', message: '媒体引用不属于当前项目。', retryable: false },
  MEDIA_SIZE_LIMIT_EXCEEDED: { status: 422, code: 'MEDIA_SIZE_LIMIT_EXCEEDED', message: '媒体大小超过模型限制。', retryable: false },
  MEDIA_MIME_UNSUPPORTED: { status: 422, code: 'MEDIA_MIME_UNSUPPORTED', message: '模型不支持该媒体类型。', retryable: false },
  MEDIA_LOCATOR_INVALID: { status: 422, code: 'MEDIA_LOCATOR_INVALID', message: '媒体定位信息不安全。', retryable: false },
  UPLOAD_FILE_REQUIRED: { status: 400, code: 'UPLOAD_FILE_REQUIRED', message: '请选择要上传的图片。', retryable: false },
  UPLOAD_TYPE_REJECTED: { status: 422, code: 'UPLOAD_TYPE_REJECTED', message: '文件扩展、声明 MIME 与实际内容不一致。', retryable: false },
  UPLOAD_CONTENT_INVALID: { status: 422, code: 'UPLOAD_CONTENT_INVALID', message: '图片内容损坏、尺寸异常或无法安全解码。', retryable: false },
  UPLOAD_ANIMATION_UNSUPPORTED: { status: 422, code: 'UPLOAD_ANIMATION_UNSUPPORTED', message: '当前参考素材只接受静态图片，请导出单帧后重试。', retryable: false },
  MEMORY_NOT_FOUND: { status: 404, code: 'MEMORY_NOT_FOUND', message: '记忆记录不存在。', retryable: false },
  TASK_NOT_CANCELLABLE: { status: 409, code: 'TASK_NOT_CANCELLABLE', message: '任务当前状态不能取消。', retryable: false },
  TASK_CANCEL_UNSUPPORTED: { status: 409, code: 'TASK_CANCEL_UNSUPPORTED', message: 'Provider 不支持或无法确认取消，请继续对账。', retryable: false },
  TASK_CANCEL_OUTCOME_UNKNOWN: { status: 409, code: 'TASK_CANCEL_OUTCOME_UNKNOWN', message: '取消结果未知，不能重新提交任务。', retryable: true },
  STORY_GRAPH_INVALID: { status: 422, code: 'STORY_GRAPH_INVALID', message: '事件关系不符合图谱约束。', retryable: false },
  SOURCE_IMPORT_FILE_REQUIRED: { status: 400, code: 'SOURCE_IMPORT_FILE_REQUIRED', message: '请选择 TXT 或 Markdown 文件。', retryable: false },
  SOURCE_IMPORT_FILE_TOO_LARGE: { status: 413, code: 'SOURCE_IMPORT_FILE_TOO_LARGE', message: '文本文件超过 6 MB 安全限制。', retryable: false },
  SOURCE_IMPORT_EXTENSION_UNSUPPORTED: { status: 422, code: 'SOURCE_IMPORT_EXTENSION_UNSUPPORTED', message: '目前只支持 .txt、.md 和 .markdown。', retryable: false },
  SOURCE_IMPORT_FILENAME_UNSAFE: { status: 422, code: 'SOURCE_IMPORT_FILENAME_UNSAFE', message: '文件名包含不安全路径。', retryable: false },
  SOURCE_IMPORT_ENCODING_UNSUPPORTED: { status: 422, code: 'SOURCE_IMPORT_ENCODING_UNSUPPORTED', message: '文件不是有效 UTF-8 文本，请转换编码后重试。', retryable: false },
  SOURCE_IMPORT_BINARY_REJECTED: { status: 422, code: 'SOURCE_IMPORT_BINARY_REJECTED', message: '文件包含二进制或控制字符，已拒绝导入。', retryable: false },
  SOURCE_IMPORT_CONTENT_TOO_SHORT: { status: 422, code: 'SOURCE_IMPORT_CONTENT_TOO_SHORT', message: '文本内容过短，无法提取章节事件。', retryable: false },
  SOURCE_IMPORT_CHARACTER_LIMIT: { status: 413, code: 'SOURCE_IMPORT_CHARACTER_LIMIT', message: '文本字符数超过 200 万限制。', retryable: false },
  SOURCE_IMPORT_HASH_MISMATCH: { status: 409, code: 'SOURCE_IMPORT_HASH_MISMATCH', message: '隔离内容已变化，请重新选择文件。', retryable: true },
  SOURCE_IMPORT_NOT_FOUND: { status: 404, code: 'SOURCE_IMPORT_NOT_FOUND', message: '导入预览不存在或已取消。', retryable: false },
  SOURCE_IMPORT_EXPIRED: { status: 410, code: 'SOURCE_IMPORT_EXPIRED', message: '导入预览已过期，请重新选择文件。', retryable: true },
  SOURCE_IMPORT_PROJECT_MISMATCH: { status: 404, code: 'SOURCE_IMPORT_NOT_FOUND', message: '导入预览不存在。', retryable: false },
  SOURCE_IMPORT_ALREADY_CONSUMED: { status: 409, code: 'SOURCE_IMPORT_ALREADY_CONSUMED', message: '该预览已经提交，不能执行不同操作。', retryable: false },
  SOURCE_IMPORT_COMMIT_CONFLICT: { status: 409, code: 'SOURCE_IMPORT_COMMIT_CONFLICT', message: '该导入已使用不同参数提交。', retryable: false },
  SOURCE_IMPORT_IDEMPOTENCY_CORRUPT: { status: 409, code: 'SOURCE_IMPORT_IDEMPOTENCY_CORRUPT', message: '导入记录不完整，请使用关联 ID 诊断。', retryable: false },
  SOURCE_IMPORT_QUARANTINE_CORRUPT: { status: 422, code: 'SOURCE_IMPORT_QUARANTINE_CORRUPT', message: '隔离预览已损坏，请重新选择文件。', retryable: true },
  PROJECT_PACKAGE_ARCHIVE_SIZE_INVALID: { status: 413, code: 'PROJECT_PACKAGE_ARCHIVE_SIZE_INVALID', message: '项目包超出大小限制。', retryable: false },
  PROJECT_PACKAGE_UNCOMPRESSED_LIMIT: { status: 413, code: 'PROJECT_PACKAGE_UNCOMPRESSED_LIMIT', message: '项目包解压后超出安全限制。', retryable: false },
  PROJECT_PACKAGE_COMPRESSION_RATIO: { status: 422, code: 'PROJECT_PACKAGE_COMPRESSION_RATIO', message: '项目包压缩率异常，已拒绝导入。', retryable: false },
  PROJECT_PACKAGE_PATH_UNSAFE: { status: 422, code: 'PROJECT_PACKAGE_PATH_UNSAFE', message: '项目包包含不安全路径。', retryable: false },
  PROJECT_PACKAGE_SYMLINK_REJECTED: { status: 422, code: 'PROJECT_PACKAGE_SYMLINK_REJECTED', message: '项目包不允许符号链接。', retryable: false },
  PROJECT_PACKAGE_HASH_MISMATCH: { status: 422, code: 'PROJECT_PACKAGE_HASH_MISMATCH', message: '项目包完整性校验失败。', retryable: false },
  PROJECT_PACKAGE_VERSION_UNSUPPORTED: { status: 422, code: 'PROJECT_PACKAGE_VERSION_UNSUPPORTED', message: '项目包版本高于当前应用，请升级后导入。', retryable: false },
  PROJECT_PACKAGE_MEDIA_MISSING: { status: 409, code: 'PROJECT_PACKAGE_MEDIA_MISSING', message: '项目媒体丢失，暂时无法创建完整备份。', retryable: true },
  PROJECT_PACKAGE_SHARED_MEDIA_MISSING: { status: 409, code: 'PROJECT_PACKAGE_SHARED_MEDIA_MISSING', message: '共享资产媒体丢失，暂时无法创建完整备份。', retryable: true },
  PROJECT_PACKAGE_MEDIA_HASH_MISMATCH: { status: 409, code: 'PROJECT_PACKAGE_MEDIA_HASH_MISMATCH', message: '项目媒体已变化，请完成资产修复后再导出。', retryable: true },
  PROJECT_PACKAGE_FILE_REQUIRED: { status: 400, code: 'PROJECT_PACKAGE_FILE_REQUIRED', message: '请选择 .aigcproj 项目包。', retryable: false },
  PROJECT_PACKAGE_EXTENSION_INVALID: { status: 422, code: 'PROJECT_PACKAGE_EXTENSION_INVALID', message: '只能导入 .aigcproj 项目包。', retryable: false },
  PROJECT_PACKAGE_ZIP_INVALID: { status: 422, code: 'PROJECT_PACKAGE_ZIP_INVALID', message: '项目包压缩结构已损坏。', retryable: false },
  PROJECT_PACKAGE_ZIP_UNSUPPORTED: { status: 422, code: 'PROJECT_PACKAGE_ZIP_UNSUPPORTED', message: '项目包使用了不支持的压缩或加密方式。', retryable: false },
  PROJECT_PACKAGE_SCHEMA_INVALID: { status: 422, code: 'PROJECT_PACKAGE_SCHEMA_INVALID', message: '项目包数据不符合当前契约。', retryable: false },
  PROJECT_PACKAGE_REQUIRED_ENTRY_MISSING: { status: 422, code: 'PROJECT_PACKAGE_REQUIRED_ENTRY_MISSING', message: '项目包缺少 manifest 或项目数据。', retryable: false },
  PROJECT_PACKAGE_DECLARED_FILE_MISSING: { status: 422, code: 'PROJECT_PACKAGE_DECLARED_FILE_MISSING', message: '项目包缺少清单中声明的文件。', retryable: false },
  PROJECT_PACKAGE_UNDECLARED_ENTRY: { status: 422, code: 'PROJECT_PACKAGE_UNDECLARED_ENTRY', message: '项目包包含未声明文件。', retryable: false },
  PROJECT_PACKAGE_PROJECT_MISMATCH: { status: 422, code: 'PROJECT_PACKAGE_PROJECT_MISMATCH', message: '项目包清单与数据不匹配。', retryable: false },
  PROJECT_PACKAGE_CRC_MISMATCH: { status: 422, code: 'PROJECT_PACKAGE_CRC_MISMATCH', message: '项目包 CRC 校验失败。', retryable: false },
  PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH: { status: 422, code: 'PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH', message: '项目包媒体清单与引用不匹配。', retryable: false },
  PROMPT_REVISION_NOT_FOUND: { status: 404, code: 'PROMPT_REVISION_NOT_FOUND', message: 'Prompt 版本不存在。', retryable: false },
  PROMPT_POLISH_REQUIRES_PROJECT_SCOPE: { status: 422, code: 'PROMPT_POLISH_REQUIRES_PROJECT_SCOPE', message: '交互式润色必须在具体项目的 Prompt override 中进行。', retryable: false },
  PROMPT_REVISION_CONFLICT: { status: 409, code: 'PROMPT_REVISION_CONFLICT', message: 'Prompt 已产生较新 revision，请刷新后重新审阅。', retryable: true },
  PROMPT_POLISH_IDEMPOTENCY_CONFLICT: { status: 409, code: 'PROMPT_POLISH_IDEMPOTENCY_CONFLICT', message: '相同幂等键已绑定另一份润色输入。', retryable: false },
  PROMPT_VARIABLE_MISSING: { status: 422, code: 'PROMPT_VARIABLE_MISSING', message: 'Prompt 缺少必需变量。', retryable: false },
  PROMPT_PUBLISH_GATE_FAILED: { status: 409, code: 'PROMPT_PUBLISH_GATE_FAILED', message: 'Prompt 尚未通过变量校验和黄金样例。', retryable: true },
  PROMPT_REVISION_NOT_PUBLISHED: { status: 409, code: 'PROMPT_REVISION_NOT_PUBLISHED', message: '只有已发布的 Prompt revision 可以进入生产任务。', retryable: true },
  SCOPED_REGENERATION_TARGET_NOT_FOUND: { status: 404, code: 'SCOPED_REGENERATION_TARGET_NOT_FOUND', message: '局部重生成目标不存在或不属于当前项目。', retryable: false },
  SCOPED_REGENERATION_IN_PROGRESS: { status: 409, code: 'SCOPED_REGENERATION_IN_PROGRESS', message: '同一局部重生成请求仍在执行。', retryable: true },
  SCOPED_REGENERATION_RESULT_MISSING: { status: 409, code: 'SCOPED_REGENERATION_RESULT_MISSING', message: '局部重生成结果证据不完整，请使用关联 ID 诊断。', retryable: true },
  IDEMPOTENCY_PAYLOAD_CONFLICT: { status: 409, code: 'IDEMPOTENCY_PAYLOAD_CONFLICT', message: '幂等键已用于不同的局部重生成输入。', retryable: false },
  ARTIFACT_VERSION_NOT_FOUND: { status: 404, code: 'ARTIFACT_VERSION_NOT_FOUND', message: 'Artifact 版本不存在。', retryable: false },
  ARTIFACT_SCOPE_MISMATCH: { status: 404, code: 'ARTIFACT_SCOPE_MISMATCH', message: 'Artifact 不属于该作用域。', retryable: false },
  ARTIFACT_HEAD_CONFLICT: { status: 409, code: 'ARTIFACT_HEAD_CONFLICT', message: 'Artifact head 已变化，请刷新后重试。', retryable: true },
  SKILL_VERSION_NOT_FOUND: { status: 404, code: 'SKILL_VERSION_NOT_FOUND', message: 'Skill 版本不存在。', retryable: false },
  SKILL_PUBLISH_GATE_FAILED: { status: 409, code: 'SKILL_PUBLISH_GATE_FAILED', message: 'Skill 尚未通过资源校验和黄金样例。', retryable: true },
  PROVIDER_NETWORK_DISABLED: { status: 403, code: 'PROVIDER_NETWORK_DISABLED', message: 'Provider 网络门禁已关闭，不能下载可选运行时。', retryable: false },
  DENO_RUNTIME_PLATFORM_UNSUPPORTED: { status: 422, code: 'DENO_RUNTIME_PLATFORM_UNSUPPORTED', message: '当前系统没有受支持的 Deno 运行时资产。', retryable: false },
  DENO_RUNTIME_DOWNLOAD_FAILED: { status: 502, code: 'DENO_RUNTIME_DOWNLOAD_FAILED', message: 'Deno 运行时下载失败，请检查网络后重试。', retryable: true },
  DENO_RUNTIME_DOWNLOAD_TOO_LARGE: { status: 422, code: 'DENO_RUNTIME_DOWNLOAD_TOO_LARGE', message: 'Deno 下载内容超过固定大小，已拒绝安装。', retryable: false },
  DENO_RUNTIME_ARCHIVE_SIZE_MISMATCH: { status: 422, code: 'DENO_RUNTIME_ARCHIVE_SIZE_MISMATCH', message: 'Deno 运行时大小校验失败，已拒绝安装。', retryable: true },
  DENO_RUNTIME_ARCHIVE_HASH_MISMATCH: { status: 422, code: 'DENO_RUNTIME_ARCHIVE_HASH_MISMATCH', message: 'Deno 运行时完整性校验失败，已拒绝安装。', retryable: false },
  DENO_RUNTIME_ARCHIVE_INVALID: { status: 422, code: 'DENO_RUNTIME_ARCHIVE_INVALID', message: 'Deno 运行时压缩结构无效，已拒绝安装。', retryable: false },
  DENO_RUNTIME_PROBE_FAILED: { status: 422, code: 'DENO_RUNTIME_PROBE_FAILED', message: 'Deno 运行时版本验证失败，未启用该运行时。', retryable: true },
  DENO_RUNTIME_INSTALL_CONFLICT: { status: 409, code: 'DENO_RUNTIME_INSTALL_CONFLICT', message: '已有 Deno 运行时状态异常，请先诊断或移除损坏安装。', retryable: false },
  DENO_RUNTIME_ABORTED: { status: 409, code: 'DENO_RUNTIME_ABORTED', message: 'Deno 运行时安装已取消，没有发布半成品。', retryable: true },
  DENO_RUNTIME_INSTALL_NOT_RUNNING: { status: 409, code: 'DENO_RUNTIME_INSTALL_NOT_RUNNING', message: '当前没有进行中的 Deno 运行时安装。', retryable: false },
  PLUGIN_MANIFEST_INVALID: { status: 422, code: 'PLUGIN_MANIFEST_INVALID', message: 'Provider 插件清单无效。', retryable: false },
  PLUGIN_BUNDLE_HASH_MISMATCH: { status: 422, code: 'PLUGIN_BUNDLE_HASH_MISMATCH', message: 'Provider 插件内容完整性校验失败。', retryable: false },
  PLUGIN_PUBLISHER_UNTRUSTED: { status: 403, code: 'PLUGIN_PUBLISHER_UNTRUSTED', message: '该 Provider 插件发布者未被当前安装信任。', retryable: false },
  PLUGIN_SIGNATURE_INVALID: { status: 422, code: 'PLUGIN_SIGNATURE_INVALID', message: 'Provider 插件签名无效。', retryable: false },
  PROVIDER_PLUGIN_BUNDLE_INVALID: { status: 422, code: 'PROVIDER_PLUGIN_BUNDLE_INVALID', message: 'Provider 插件包编码或大小无效。', retryable: false },
  PROVIDER_PLUGIN_VERSION_CONFLICT: { status: 409, code: 'PROVIDER_PLUGIN_VERSION_CONFLICT', message: '同一 Provider 插件版本已存在不同内容。', retryable: false },
  PROVIDER_PLUGIN_NOT_FOUND: { status: 404, code: 'PROVIDER_PLUGIN_NOT_FOUND', message: 'Provider 插件不存在。', retryable: false },
  PROVIDER_PLUGIN_REVISION_CONFLICT: { status: 409, code: 'PROVIDER_PLUGIN_REVISION_CONFLICT', message: 'Provider 插件状态已变化，请刷新后重试。', retryable: true },
  PROVIDER_PLUGIN_IDENTITY_IMMUTABLE: { status: 409, code: 'PROVIDER_PLUGIN_IDENTITY_IMMUTABLE', message: 'Provider 插件身份与版本不可更改。', retryable: false },
  PROVIDER_PLUGIN_STATE_INVALID: { status: 409, code: 'PROVIDER_PLUGIN_STATE_INVALID', message: 'Provider 插件当前状态不允许该操作。', retryable: false },
  PROVIDER_PLUGIN_QUARANTINED: { status: 409, code: 'PROVIDER_PLUGIN_QUARANTINED', message: 'Provider 插件已被隔离，需安装新版本后重新验证。', retryable: false },
  PROVIDER_PLUGIN_BUNDLE_MISSING: { status: 409, code: 'PROVIDER_PLUGIN_BUNDLE_MISSING', message: 'Provider 插件文件丢失，已禁止运行。', retryable: false },
  PROVIDER_PUBLISHER_KEY_INVALID: { status: 422, code: 'PROVIDER_PUBLISHER_KEY_INVALID', message: '发布者公钥必须是有效的 Ed25519 SPKI PEM。', retryable: false },
  PROVIDER_PUBLISHER_KEY_CONFLICT: { status: 409, code: 'PROVIDER_PUBLISHER_KEY_CONFLICT', message: '该发布者 ID 已绑定不同公钥，不能静默替换。', retryable: false },
  PROVIDER_PUBLISHER_MANAGED_EXTERNALLY: { status: 409, code: 'PROVIDER_PUBLISHER_MANAGED_EXTERNALLY', message: '该发布者由本机外部配置管理，不能在工作台中改写。', retryable: false },
  PROVIDER_PUBLISHER_NOT_FOUND: { status: 404, code: 'PROVIDER_PUBLISHER_NOT_FOUND', message: '发布者信任记录不存在。', retryable: false },
  PROVIDER_PUBLISHER_REVISION_CONFLICT: { status: 409, code: 'PROVIDER_PUBLISHER_REVISION_CONFLICT', message: '发布者信任状态已变化，请刷新后重试。', retryable: true },
  PROVIDER_PUBLISHER_IDENTITY_IMMUTABLE: { status: 409, code: 'PROVIDER_PUBLISHER_IDENTITY_IMMUTABLE', message: '发布者身份不可更改。', retryable: false },
  PROVIDER_PUBLISHER_IN_USE: { status: 409, code: 'PROVIDER_PUBLISHER_IN_USE', message: '该发布者仍有已启用插件，请先停用插件。', retryable: true },
  PROVIDER_PLUGIN_BUNDLE_TAMPERED: { status: 409, code: 'PROVIDER_PLUGIN_BUNDLE_TAMPERED', message: 'Provider 插件内容已变化，已禁止运行。', retryable: false },
  PROVIDER_PLUGIN_PATH_INVALID: { status: 422, code: 'PROVIDER_PLUGIN_PATH_INVALID', message: 'Provider 插件存储路径无效。', retryable: false },
  PROVIDER_PLUGIN_TEST_FAILED: { status: 422, code: 'PROVIDER_PLUGIN_TEST_FAILED', message: 'Provider 插件沙箱测试失败，已进入隔离状态。', retryable: false },
  PROVIDER_PLUGIN_HEALTH_FAILED: { status: 422, code: 'PROVIDER_PLUGIN_HEALTH_FAILED', message: 'Provider 插件未通过健康检查，已进入隔离状态。', retryable: false },
  PROVIDER_PLUGIN_RUNTIME_NOT_READY: { status: 409, code: 'PROVIDER_PLUGIN_RUNTIME_NOT_READY', message: '请先安装并验证 Deno 运行时。', retryable: true },
  PROVIDER_PLUGINS_DISABLED: { status: 403, code: 'PROVIDER_PLUGINS_DISABLED', message: 'Provider 插件功能门禁尚未开启。', retryable: false },
}

const correlationId = (request: RequestWithCorrelation): string => request.correlationId ?? randomUUID()
const success = <T>(request: RequestWithCorrelation, data: T): ApiEnvelope<T> => ({ ok: true, data, correlationId: correlationId(request) })

function publicTask(task: GenerationTask): GenerationTask {
  const sensitiveKey = /(?:api[-_]?key|secret|token|authorization|cookie|password|credential|signed[-_]?url|output[-_]?directory|file[-_]?path|absolute[-_]?path)/iu
  const localPath = /^(?:\/(?:Users|home|private|var\/folders)\/|[a-z]:\\|\\\\)/iu
  const sanitize = (value: unknown, key = ''): unknown => {
    if (sensitiveKey.test(key)) return '[redacted]'
    if (typeof value === 'string') return localPath.test(value) ? '[protected-local-path]' : value
    if (Array.isArray(value)) return value.map((item) => sanitize(item))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]))
    return value
  }
  return { ...task, inputSnapshot: JsonObjectSchema.parse(sanitize(task.inputSnapshot)) }
}

function publicSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return { ...snapshot, tasks: snapshot.tasks.map(publicTask) }
}

function asAppError(error: unknown, request: RequestWithCorrelation): { status: number; payload: AppErrorPayload } {
  if (error instanceof multer.MulterError) {
    const sourceImport = request.path.includes('/source-imports/')
    const tooLarge = error.code === 'LIMIT_FILE_SIZE'
    const code = sourceImport && tooLarge ? 'SOURCE_IMPORT_FILE_TOO_LARGE' : tooLarge ? 'UPLOAD_FILE_TOO_LARGE' : 'UPLOAD_REJECTED'
    return {
      status: tooLarge ? 413 : 400,
      payload: AppErrorSchema.parse({
        code, userMessage: sourceImport && tooLarge ? '文本文件超过 6 MB 安全限制。' : tooLarge ? '上传文件超过大小限制。' : '上传请求无效。',
        technicalMessage: code, retryable: false, correlationId: correlationId(request), timestamp: new Date().toISOString(),
      }),
    }
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      payload: AppErrorSchema.parse({
        code: 'VALIDATION_FAILED', userMessage: '输入格式无效，请检查后重试。', technicalMessage: 'runtime schema validation failed',
        retryable: false, correlationId: correlationId(request), details: { issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }, timestamp: new Date().toISOString(),
      }),
    }
  }
  const raw = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
  const prefix = raw.split(':')[0] ?? 'UNKNOWN_ERROR'
  const mapped = errorMap[prefix] ?? { status: 500, code: 'INTERNAL_ERROR', message: '操作未完成，请使用关联 ID 查看诊断。', retryable: true }
  return {
    status: mapped.status,
    payload: AppErrorSchema.parse({
      code: mapped.code, userMessage: mapped.message, technicalMessage: mapped.code,
      retryable: mapped.retryable, correlationId: correlationId(request), timestamp: new Date().toISOString(),
    }),
  }
}

function stableAuditErrorCode(error: unknown): string {
  if (error instanceof ZodError) return 'VALIDATION_FAILED'
  if (error instanceof multer.MulterError) return error.code === 'LIMIT_FILE_SIZE' ? 'UPLOAD_FILE_TOO_LARGE' : 'UPLOAD_REJECTED'
  const raw = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
  const prefix = raw.split(':')[0] ?? 'UNKNOWN_ERROR'
  return errorMap[prefix]?.code ?? 'INTERNAL_ERROR'
}

export function createDirectorApp(options: AppOptions): {
  app: express.Express; httpServer: HttpServer; io: SocketServer; db: DirectorDatabase;
  service: DirectorService; memory: MemoryService; egress: EgressBroker;
  providerConnections: ProviderConnectionService;
  allowOrigin: (origin: string) => void;
} {
  const app = express()
  const httpServer = createServer(app)
  const browserSessionToken = randomBytes(32).toString('base64url')
  const csrfToken = randomBytes(32).toString('base64url')
  let bootstrapAvailable = Boolean(options.bootstrapToken)
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://127.0.0.1:5173', 'http://localhost:5173'])
  const originAllowed = (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void): void => {
    if (!origin || allowedOrigins.has(origin)) callback(null, true)
    else callback(null, false)
  }
  const io = new SocketServer(httpServer, { path: '/studio-v2/socket.io', cors: { origin: originAllowed } })
  const studioNamespace = io.of('/studio-v2')
  const db = new DirectorDatabase(options.databasePath)
  const providerNetworkDisabled = options.providerNetworkDisabled ?? process.env.PROVIDER_NETWORK_DISABLED !== '0'
  const credentialVault = options.credentialVault ?? createCredentialVault()
  const providerConnections = new ProviderConnectionService(
    db, credentialVault, providerNetworkDisabled, options.providerConnectionProbe ?? new BrokerProviderConnectionProbe(),
  )
  const service = new DirectorService(
    db,
    options.dataDirectory,
    (event) => {
      studioNamespace.to(`project:${event.task.projectId}`).emit('task:update', publicTask(event.task))
      options.onTaskEvent?.({ task: publicTask(event.task) })
    },
    options.packProviderFactory ?? (() => createDemoPackProvider()),
    options.maxConcurrentTasks ?? 4,
    providerNetworkDisabled,
    options.providerRouter ?? providerConnections.router(),
  )
  const projectPackages = new ProjectPackageService(db, options.dataDirectory)
  const sourceImports = new SourceImportService(db, service, options.dataDirectory)
  const assetContinuity = new AssetContinuityService(db)
  const sharedAssetMedia = new SharedAssetMediaService(db, options.dataDirectory)
  const promptOperations = new PromptOperationsService(db)
  const memory = new MemoryService(db)
  const securityAudit = new SecurityAuditService(db)
  const egress = new EgressBroker({ policies: defaultEgressPolicies })

  app.disable('x-powered-by')
  app.use((request: RequestWithCorrelation, response, next) => {
    const supplied = request.header('x-request-id')
    request.correlationId = supplied && /^[a-zA-Z0-9-]{8,100}$/u.test(supplied) ? supplied : randomUUID()
    response.setHeader('x-request-id', request.correlationId)
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('x-frame-options', 'DENY')
    response.setHeader('referrer-policy', 'no-referrer')
    if (request.path.startsWith('/api/')) response.setHeader('cache-control', 'no-store')
    response.setHeader('content-security-policy', request.path.startsWith('/api')
      ? "default-src 'none'; frame-ancestors 'none'"
      : "default-src 'self'; connect-src 'self' ws:; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    next()
  })
  app.use((request: RequestWithCorrelation, response, next) => {
    const origin = request.header('origin')
    if (!origin || allowedOrigins.has(origin)) {
      next()
      return
    }
    response.status(403).json({
      ok: false,
      error: {
        code: 'ORIGIN_REJECTED', userMessage: '请从本地工作台打开此操作。', retryable: false,
        correlationId: correlationId(request), timestamp: new Date().toISOString(),
      },
    })
  })
  app.use(cors({
    credentials: true,
    origin: originAllowed,
  }))
  app.use(express.json({ limit: '2mb' }))

  app.get('/local-session/bootstrap', (request, response) => {
    const supplied = typeof request.query.token === 'string' ? request.query.token : undefined
    if (!bootstrapAvailable || !options.bootstrapToken || !secretEquals(supplied, options.bootstrapToken)) {
      response.status(404).type('text/plain').send('Not found')
      return
    }
    bootstrapAvailable = false
    response.setHeader('cache-control', 'no-store')
    response.cookie(browserSessionCookie, browserSessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 12 * 60 * 60 * 1_000,
    })
    response.redirect(303, safeStudioReturnPath(request.query.return))
  })

  app.get('/api/v2/health', (request: RequestWithCorrelation, response) => {
    response.json(success(request, HealthSchema.parse({
      status: 'ok', version: '2.0.0', demoMode: process.env.DEMO_MODE === '1',
      providerNetworkDisabled, schemaVersion: db.schemaVersion(), timestamp: new Date().toISOString(),
    })))
  })

  app.get('/api/v2/session', (request: RequestWithCorrelation, response) => {
    const bearerAuthorized = secretEquals(request.header('authorization'), `Bearer ${options.sessionToken}`)
    const cookieAuthorized = secretEquals(cookieValue(request.header('cookie'), browserSessionCookie), browserSessionToken)
    if (!bearerAuthorized && !cookieAuthorized) {
      const rid = correlationId(request)
      response.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', userMessage: '本地会话已失效，请重新启动本地服务并刷新页面。', retryable: false, correlationId: rid, timestamp: new Date().toISOString() } })
      return
    }
    response.json(success(request, { authMode: bearerAuthorized ? 'bearer' : 'cookie', csrfToken }))
  })

  app.use('/api/v2', (request: RequestWithCorrelation, response, next) => {
    const authorization = request.header('authorization')
    if (secretEquals(authorization, `Bearer ${options.sessionToken}`)) {
      request.localAuthMode = 'bearer'
      next()
      return
    }
    const browserCookie = cookieValue(request.header('cookie'), browserSessionCookie)
    if (!secretEquals(browserCookie, browserSessionToken)) {
      const rid = correlationId(request as RequestWithCorrelation)
      response.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', userMessage: '本地会话已失效，请重新启动本地服务并刷新页面。', retryable: false, correlationId: rid, timestamp: new Date().toISOString() } })
      return
    }
    if (unsafeMethods.has(request.method)) {
      const origin = request.header('origin')
      if (!origin || !allowedOrigins.has(origin) || !secretEquals(request.header('x-csrf-token'), csrfToken)) {
        const rid = correlationId(request)
        response.status(403).json({ ok: false, error: { code: 'CSRF_REJECTED', userMessage: '安全校验失败，请刷新页面后重试。', retryable: true, correlationId: rid, timestamp: new Date().toISOString() } })
        return
      }
    }
    request.localAuthMode = 'cookie'
    next()
  })

  studioNamespace.use((socket, next) => {
    const bearerAuthorized = secretEquals(socket.handshake.auth.token, options.sessionToken)
    const cookieAuthorized = secretEquals(cookieValue(socket.request.headers.cookie, browserSessionCookie), browserSessionToken)
    next(bearerAuthorized || cookieAuthorized ? undefined : new Error('UNAUTHORIZED'))
  })
  studioNamespace.on('connection', (socket) => {
    socket.on('project:subscribe', (rawProjectId: unknown) => {
      const parsed = IdSchema.safeParse(rawProjectId)
      if (parsed.success) void socket.join(`project:${parsed.data}`)
    })
  })

  app.get('/api/v2/projects', (request: RequestWithCorrelation, response) => response.json(success(request, db.listProjects())))
  app.post('/api/v2/projects', (request: RequestWithCorrelation, response) => {
    const parsed = createProjectInput.parse(request.body)
    const project = db.createProject({ name: parsed.name, ...(parsed.description === undefined ? {} : { description: parsed.description }) })
    response.status(201).json(success(request, project))
  })
  app.get('/api/v2/projects/:projectId', (request: RequestWithCorrelation, response) => response.json(success(request, publicSnapshot(db.snapshot(IdSchema.parse(request.params.projectId))))))
  app.get('/api/v2/projects/:projectId/brief', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.creativeBrief(IdSchema.parse(request.params.projectId))))
  })
  app.put('/api/v2/projects/:projectId/brief', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.reviseCreativeBrief(
      IdSchema.parse(request.params.projectId), CreativeBriefRevisionRequestSchema.parse(request.body),
    )))
  })
  app.post('/api/v2/projects/:projectId/brief/candidates', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, service.createCreativeBriefCandidates(
      IdSchema.parse(request.params.projectId), CreativeBriefCandidateRequestSchema.parse(request.body),
    )))
  })
  app.post('/api/v2/projects/:projectId/brief/candidates/:artifactId/review', async (request: RequestWithCorrelation, response, next) => {
    try {
      const projectId = IdSchema.parse(request.params.projectId)
      const artifactId = IdSchema.parse(request.params.artifactId)
      const result = await securityAudit.capture({
        projectId, action: 'creative_brief.review', targetType: 'artifact', targetId: artifactId, correlationId: correlationId(request),
      }, () => service.reviewCreativeBriefCandidate(
        projectId, artifactId, CreativeBriefCandidateReviewRequestSchema.parse(request.body),
      ), stableAuditErrorCode)
      response.json(success(request, result))
    } catch (error) { next(error) }
  })

  app.get('/api/v2/series', (request: RequestWithCorrelation, response) => response.json(success(request, db.listSeries())))
  app.post('/api/v2/series', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, db.createSeries(createSeriesInput.parse(request.body))))
  })
  app.get('/api/v2/series/:seriesId', (request: RequestWithCorrelation, response) => {
    const series = db.getSeries(IdSchema.parse(request.params.seriesId))
    if (!series) throw new Error('SERIES_NOT_FOUND')
    response.json(success(request, { series, episodes: db.listEpisodes(series.id) }))
  })
  app.get('/api/v2/series/:seriesId/package', async (request: RequestWithCorrelation, response, next) => {
    try {
      const exported = await projectPackages.exportSeries(IdSchema.parse(request.params.seriesId))
      response.setHeader('content-type', 'application/vnd.aigc-director.project+zip')
      response.setHeader('content-disposition', `attachment; filename="aigc-director-series.aigcproj"; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`)
      response.setHeader('content-length', String(exported.buffer.byteLength))
      response.send(exported.buffer)
    } catch (error) { next(error) }
  })
  app.post('/api/v2/series/:seriesId/episodes', (request: RequestWithCorrelation, response) => {
    const input = attachEpisodeInput.parse(request.body)
    response.status(201).json(success(request, db.attachEpisode(input.projectId, IdSchema.parse(request.params.seriesId), input.ordinal)))
  })
  app.get('/api/v2/episodes/:episodeId/context', (request: RequestWithCorrelation, response) => {
    response.json(success(request, db.getEpisodeContext(IdSchema.parse(request.params.episodeId))))
  })
  app.get('/api/v2/episodes/:episodeId/continuity', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.episodeContinuity(IdSchema.parse(request.params.episodeId))))
  })
  app.post('/api/v2/episodes/:episodeId/continuity-summary', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, service.createEpisodeContinuitySummary(
      IdSchema.parse(request.params.episodeId), EpisodeContinuitySummaryRequestSchema.parse(request.body),
    )))
  })
  app.post('/api/v2/episodes/:episodeId/reconcile/preview', (request: RequestWithCorrelation, response) => {
    const input = reconcilePreviewInput.parse(request.body)
    response.status(201).json(success(request, assetContinuity.previewReconcile(IdSchema.parse(request.params.episodeId), input.expectedProjectRevision, input.decisions)))
  })
  app.post('/api/v2/episodes/:episodeId/reconcile/apply', (request: RequestWithCorrelation, response) => {
    const input = operationApplyInput.parse(request.body)
    response.json(success(request, assetContinuity.applyReconcile(IdSchema.parse(request.params.episodeId), input.operationId, input.approvalToken)))
  })

  app.get('/api/v2/assets/shared', (request: RequestWithCorrelation, response) => {
    const scope = z.enum(['global', 'series']).optional().parse(request.query.scope)
    const seriesId = request.query.seriesId === undefined ? undefined : IdSchema.parse(request.query.seriesId)
    response.json(success(request, db.listSharedAssets(scope, seriesId)))
  })
  app.post('/api/v2/assets/shared', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, db.createSharedAsset(createSharedAssetInput.parse(request.body))))
  })
  app.post('/api/v2/assets/shared/:assetId/variants', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, db.createSharedAssetVariant(IdSchema.parse(request.params.assetId), createSharedVariantInput.parse(request.body))))
  })
  app.patch('/api/v2/assets/shared/:assetId', (request: RequestWithCorrelation, response) => {
    response.json(success(request, db.reviseSharedAsset(IdSchema.parse(request.params.assetId), reviseSharedAssetInput.parse(request.body))))
  })
  app.get('/api/v2/assets/resolve', (request: RequestWithCorrelation, response) => {
    response.json(success(request, db.resolveAssets(IdSchema.parse(request.query.projectId))))
  })
  app.post('/api/v2/assets/fork', async (request: RequestWithCorrelation, response, next) => {
    try {
      const input = forkAssetInput.parse(request.body)
      response.status(201).json(success(request, await sharedAssetMedia.forkSharedAsset(input.projectId, input.sharedAssetId, input.sharedVariantId)))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/assets/promote', async (request: RequestWithCorrelation, response, next) => {
    try {
      const input = promoteAssetInput.parse(request.body)
      response.status(201).json(success(request, await sharedAssetMedia.promoteLocalAsset(input.projectId, input.assetId, input.variantId, {
        scope: input.scope, ...(input.seriesId ? { seriesId: input.seriesId } : {}),
      })))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/assets/:assetId/impact', (request: RequestWithCorrelation, response) => {
    response.json(success(request, db.assetImpact(IdSchema.parse(request.params.assetId))))
  })
  app.delete('/api/v2/assets/shared/:assetId', async (request: RequestWithCorrelation, response, next) => {
    try {
      response.json(success(request, { deleted: await sharedAssetMedia.deleteSharedAsset(IdSchema.parse(request.params.assetId)) }))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/assets/batch-bind/preview', (request: RequestWithCorrelation, response) => {
    const input = batchBindPreviewInput.parse(request.body)
    response.status(201).json(success(request, assetContinuity.previewBatchBind(input.episodeId, input.expectedProjectRevision, input.bindings)))
  })
  app.post('/api/v2/assets/batch-bind/apply', (request: RequestWithCorrelation, response) => {
    const input = operationApplyInput.extend({ episodeId: IdSchema }).parse(request.body)
    response.json(success(request, assetContinuity.applyBatchBind(input.episodeId, input.operationId, input.approvalToken)))
  })

  app.get('/api/v2/prompt-definitions', (request: RequestWithCorrelation, response) => {
    const stableKey = request.query.stableKey === undefined ? undefined : z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/).parse(request.query.stableKey)
    const projectId = request.query.projectId === undefined ? undefined : IdSchema.parse(request.query.projectId)
    response.json(success(request, db.listPromptRevisions(stableKey, projectId)))
  })
  app.post('/api/v2/prompt-definitions', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, promptOperations.createPromptRevision(promptRevisionInput.parse(request.body))))
  })
  app.get('/api/v2/prompt-revisions/:revisionId/diff', (request: RequestWithCorrelation, response) => {
    response.json(success(request, promptOperations.diffPrompt(IdSchema.parse(request.params.revisionId), IdSchema.parse(request.query.to))))
  })
  app.post('/api/v2/prompt-revisions/:revisionId/compile', (request: RequestWithCorrelation, response) => {
    response.json(success(request, promptOperations.compilePrompt(IdSchema.parse(request.params.revisionId), JsonObjectSchema.parse(request.body?.variables ?? {}))))
  })
  app.post('/api/v2/prompt-revisions/:revisionId/polish', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, promptOperations.polishPrompt(
      IdSchema.parse(request.params.revisionId),
      PromptPolishRequestSchema.parse(request.body),
    )))
  })
  app.post('/api/v2/prompt-revisions/:revisionId/restore', async (request: RequestWithCorrelation, response, next) => {
    try {
      const revisionId = IdSchema.parse(request.params.revisionId)
      const revision = db.getPromptRevision(revisionId)
      const result = revision?.projectId
        ? await securityAudit.capture({
            projectId: revision.projectId, action: 'prompt.rollback', targetType: 'prompt', targetId: revisionId, correlationId: correlationId(request),
          }, () => promptOperations.restorePrompt(revisionId), stableAuditErrorCode)
        : promptOperations.restorePrompt(revisionId)
      response.status(201).json(success(request, result))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/prompt-revisions/:revisionId/publish', async (request: RequestWithCorrelation, response, next) => {
    try {
      const revisionId = IdSchema.parse(request.params.revisionId)
      const revision = db.getPromptRevision(revisionId)
      const result = revision?.projectId
        ? await securityAudit.capture({
            projectId: revision.projectId, action: 'prompt.publish', targetType: 'prompt', targetId: revisionId, correlationId: correlationId(request),
          }, () => promptOperations.publishPrompt(revisionId), stableAuditErrorCode)
        : promptOperations.publishPrompt(revisionId)
      response.status(201).json(success(request, result))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/prompt-revisions/:revisionId/evaluations', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, promptOperations.evaluateGolden({
      targetType: 'prompt', targetVersionId: IdSchema.parse(request.params.revisionId), ...goldenInput.parse(request.body),
    })))
  })
  app.post('/api/v2/projects/:projectId/scoped-regenerations', async (request: RequestWithCorrelation, response, next) => {
    try {
      const projectId = IdSchema.parse(request.params.projectId)
      const input = ScopedRegenerationRequestSchema.parse(request.body)
      const compiled = promptOperations.compilePrompt(input.promptRevisionId, input.variables)
      const result = await service.runScopedRegeneration(projectId, input, compiled)
      response.status(201).json(success(request, { ...result, task: publicTask(result.task) }))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/projects/:projectId/scene-patches/:artifactId/apply', async (request: RequestWithCorrelation, response, next) => {
    try {
      const projectId = IdSchema.parse(request.params.projectId)
      const artifactId = IdSchema.parse(request.params.artifactId)
      const result = await securityAudit.capture({
        projectId, action: 'scene_patch.apply', targetType: 'artifact', targetId: artifactId, correlationId: correlationId(request),
      }, () => service.applyScenePatch(projectId, artifactId, ScenePatchApplyRequestSchema.parse(request.body)), stableAuditErrorCode)
      response.json(success(request, result))
    } catch (error) { next(error) }
  })

  app.get('/api/v2/skills', (request: RequestWithCorrelation, response) => {
    const stableKey = request.query.stableKey === undefined ? undefined : z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/).parse(request.query.stableKey)
    const projectId = request.query.projectId === undefined ? undefined : IdSchema.parse(request.query.projectId)
    response.json(success(request, db.listSkillPackageVersions(stableKey, projectId)))
  })
  app.post('/api/v2/skills', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, promptOperations.createSkillVersion(skillCreateInput.parse(request.body))))
  })
  app.post('/api/v2/skills/:versionId/fork', (request: RequestWithCorrelation, response) => {
    const projectId = request.body?.projectId === undefined ? undefined : IdSchema.parse(request.body.projectId)
    response.status(201).json(success(request, promptOperations.forkSkill(IdSchema.parse(request.params.versionId), projectId)))
  })
  app.get('/api/v2/skills/:versionId/validate', (request: RequestWithCorrelation, response) => {
    response.json(success(request, promptOperations.validateSkill(IdSchema.parse(request.params.versionId))))
  })
  app.post('/api/v2/skills/:versionId/evaluations', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, promptOperations.evaluateGolden({
      targetType: 'skill', targetVersionId: IdSchema.parse(request.params.versionId), ...goldenInput.parse(request.body),
    })))
  })
  app.post('/api/v2/skills/:versionId/publish', async (request: RequestWithCorrelation, response, next) => {
    try {
      const versionId = IdSchema.parse(request.params.versionId)
      const version = db.getSkillPackageVersion(versionId)
      const result = version?.projectId
        ? await securityAudit.capture({
            projectId: version.projectId, action: 'skill.publish', targetType: 'skill', targetId: versionId, correlationId: correlationId(request),
          }, () => promptOperations.publishSkill(versionId), stableAuditErrorCode)
        : promptOperations.publishSkill(versionId)
      response.status(201).json(success(request, result))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/skills/:versionId/rollback', async (request: RequestWithCorrelation, response, next) => {
    try {
      const versionId = IdSchema.parse(request.params.versionId)
      const version = db.getSkillPackageVersion(versionId)
      const result = version?.projectId
        ? await securityAudit.capture({
            projectId: version.projectId, action: 'skill.rollback', targetType: 'skill', targetId: versionId, correlationId: correlationId(request),
          }, () => promptOperations.rollbackSkill(versionId), stableAuditErrorCode)
        : promptOperations.rollbackSkill(versionId)
      response.status(201).json(success(request, result))
    } catch (error) { next(error) }
  })

  app.get('/api/v2/artifacts/:scopeType/:scopeId/versions', (request: RequestWithCorrelation, response) => {
    const projectId = IdSchema.parse(request.query.projectId)
    const scope = { type: artifactScopeType.parse(request.params.scopeType), id: IdSchema.parse(request.params.scopeId) }
    const artifactType = z.string().min(1).max(160).parse(request.query.artifactType)
    response.json(success(request, ArtifactHistorySchema.parse({
      head: db.getArtifactHead(scope, artifactType), versions: promptOperations.listArtifactVersions(projectId, scope, artifactType),
    })))
  })
  app.get('/api/v2/artifacts/:scopeType/:scopeId/diff', (request: RequestWithCorrelation, response) => {
    const scope = { type: artifactScopeType.parse(request.params.scopeType), id: IdSchema.parse(request.params.scopeId) }
    response.json(success(request, promptOperations.diffArtifact(
      IdSchema.parse(request.query.projectId), IdSchema.parse(request.query.from), IdSchema.parse(request.query.to), scope,
    )))
  })
  app.post('/api/v2/artifacts/:scopeType/:scopeId/rollback', async (request: RequestWithCorrelation, response, next) => {
    try {
      const scope = { type: artifactScopeType.parse(request.params.scopeType), id: IdSchema.parse(request.params.scopeId) }
      const input = z.object({ projectId: IdSchema, targetVersionId: IdSchema, expectedHeadRevision: z.number().int().nonnegative() }).parse(request.body)
      const result = await securityAudit.capture({
        projectId: input.projectId, action: 'artifact.rollback', targetType: 'artifact', targetId: input.targetVersionId, correlationId: correlationId(request),
      }, () => promptOperations.rollbackArtifact(input.projectId, input.targetVersionId, input.expectedHeadRevision, scope), stableAuditErrorCode)
      response.status(201).json(success(request, result))
    } catch (error) { next(error) }
  })

  app.get('/api/v2/projects/:projectId/package', async (request: RequestWithCorrelation, response, next) => {
    try {
      const exported = await projectPackages.exportProject(IdSchema.parse(request.params.projectId))
      response.setHeader('content-type', 'application/vnd.aigc-director.project+zip')
      response.setHeader('content-disposition', `attachment; filename="aigc-director-project.aigcproj"; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`)
      response.setHeader('content-length', String(exported.buffer.byteLength))
      response.send(exported.buffer)
    } catch (error) { next(error) }
  })

  const projectPackageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 2 } })
  app.post('/api/v2/project-packages/import', projectPackageUpload.single('file'), async (request: RequestWithCorrelation, response, next) => {
    try {
      if (!request.file) throw new Error('PROJECT_PACKAGE_FILE_REQUIRED')
      if (!request.file.originalname.toLowerCase().endsWith('.aigcproj')) throw new Error('PROJECT_PACKAGE_EXTENSION_INVALID')
      if (request.file.buffer.byteLength < 4 || request.file.buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('PROJECT_PACKAGE_ZIP_INVALID')
      const requestedName = z.string().trim().min(1).max(120).optional().parse(request.body?.name || undefined)
      response.status(201).json(success(request, await projectPackages.importProject(request.file.buffer, requestedName)))
    } catch (error) { next(error) }
  })

  app.post('/api/v2/projects/:projectId/sources', (request: RequestWithCorrelation, response) => {
    const parsed = importSourceInput.parse(request.body)
    const source = { title: parsed.title, content: parsed.content, ...(parsed.language === undefined ? {} : { language: parsed.language }) }
    response.status(201).json(success(request, publicSnapshot(service.importSource(IdSchema.parse(request.params.projectId), source))))
  })
  const sourceImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 1 } })
  app.post('/api/v2/projects/:projectId/source-imports/preview', sourceImportUpload.single('file'), async (request: RequestWithCorrelation, response, next) => {
    try {
      const projectId = IdSchema.parse(request.params.projectId)
      if (!request.file) throw new Error('SOURCE_IMPORT_FILE_REQUIRED')
      const preview = await sourceImports.preview(projectId, {
        originalName: request.file.originalname, declaredMime: request.file.mimetype, buffer: request.file.buffer,
      })
      response.status(201).json(success(request, preview))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/projects/:projectId/source-imports/:importId/commit', async (request: RequestWithCorrelation, response, next) => {
    try {
      const projectId = IdSchema.parse(request.params.projectId)
      const importId = IdSchema.parse(request.params.importId)
      const result = await securityAudit.capture({
        projectId, action: 'source_import.commit', targetType: 'source_import', targetId: importId, correlationId: correlationId(request),
      }, () => sourceImports.commit(projectId, importId, SourceImportCommitSchema.parse(request.body)), stableAuditErrorCode)
      response.status(result.repeated ? 200 : 201).json(success(request, publicSnapshot(result.snapshot)))
    } catch (error) { next(error) }
  })
  app.delete('/api/v2/projects/:projectId/source-imports/:importId', async (request: RequestWithCorrelation, response, next) => {
    try {
      response.json(success(request, await sourceImports.cancel(IdSchema.parse(request.params.projectId), IdSchema.parse(request.params.importId))))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/projects/:projectId/graph', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.graph(IdSchema.parse(request.params.projectId), viewSchema.parse(request.query.view ?? 'story'))))
  })
  app.post('/api/v2/projects/:projectId/graph/commands', async (request: RequestWithCorrelation, response, next) => {
    try {
      const view = viewSchema.parse(request.query.view ?? 'story')
      const projectId = IdSchema.parse(request.params.projectId)
      const command = GraphCommandSchema.parse(request.body)
      const result = command.type === 'clear_boundary_frame'
        ? await securityAudit.capture({
          projectId, action: 'graph.clear_boundary', targetType: 'shot', targetId: command.shotId, correlationId: correlationId(request),
        }, () => service.applyGraphCommand(projectId, view, command), stableAuditErrorCode)
        : service.applyGraphCommand(projectId, view, command)
      response.json(success(request, result))
    } catch (error) { next(error) }
  })

  app.post('/api/v2/projects/:projectId/agent-plans', (request: RequestWithCorrelation, response) => {
    const projectId = IdSchema.parse(request.params.projectId)
    response.status(201).json(success(request, service.createPlan(projectId, planInput.parse(request.body).idempotencyKey, memory.checkpointContext(projectId))))
  })
  app.get('/api/v2/agent-runs/:runId/checkpoint', (request: RequestWithCorrelation, response) => {
    const checkpoint = db.getAgentRunCheckpoint(IdSchema.parse(request.params.runId))
    if (!checkpoint) throw new Error('AGENT_CHECKPOINT_NOT_FOUND')
    response.json(success(request, checkpoint))
  })
  app.post('/api/v2/plans/:planId/approve', (request: RequestWithCorrelation, response) => {
    response.json(success(request, publicSnapshot(service.approvePlan(IdSchema.parse(request.params.planId), approvalInput.parse(request.body).token))))
  })
  app.post('/api/v2/projects/:projectId/demo-production', async (request: RequestWithCorrelation, response, next) => {
    try {
      const { idempotencyKey } = planInput.parse(request.body)
      response.json(success(request, publicSnapshot(await service.runDemoProduction(IdSchema.parse(request.params.projectId), idempotencyKey))))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/shots/:shotId/provider-candidates', async (request: RequestWithCorrelation, response, next) => {
    try {
      const shotId = IdSchema.parse(request.params.shotId)
      const shot = db.get<Shot>('shots', shotId)
      if (!shot) throw new Error('SHOT_NOT_FOUND')
      const task = await securityAudit.capture({
        projectId: shot.projectId, action: 'provider_candidate.submit', targetType: 'shot', targetId: shotId, correlationId: correlationId(request),
      }, () => service.startRoutedCandidateGeneration(shotId, RoutedCandidateGenerationRequestSchema.parse(request.body)), stableAuditErrorCode)
      response.status(202).json(success(request, publicTask(task)))
    } catch (error) { next(error) }
  })

  app.get('/api/v2/projects/:projectId/assets', (request: RequestWithCorrelation, response) => response.json(success(request, db.list('assets', IdSchema.parse(request.params.projectId)))))
  app.post('/api/v2/projects/:projectId/assets', (request: RequestWithCorrelation, response) => {
    const projectId = IdSchema.parse(request.params.projectId)
    const input = createAssetInput.parse(request.body)
    const timestamp = new Date().toISOString()
    const id = randomUUID()
    const asset = AssetUnitSchema.parse({ ...input, metadata: parseAssetMetadata(input.type, input.metadata), id, logicalId: id, projectId, revision: 1, archived: false, createdAt: timestamp, updatedAt: timestamp })
    db.put('assets', projectId, asset)
    db.bumpGraphRevision(projectId)
    response.status(201).json(success(request, asset))
  })
  app.get('/api/v2/projects/:projectId/storyboards', (request: RequestWithCorrelation, response) => response.json(success(request, db.snapshot(IdSchema.parse(request.params.projectId)).shots)))
  app.get('/api/v2/projects/:projectId/candidates', (request: RequestWithCorrelation, response) => response.json(success(request, db.snapshot(IdSchema.parse(request.params.projectId)).candidates)))
  app.get('/api/v2/projects/:projectId/candidate-batches', (request: RequestWithCorrelation, response) => response.json(success(request, db.list<CandidateBatch>('candidate_batches', IdSchema.parse(request.params.projectId)))))
  app.post('/api/v2/candidate-batches/:batchId/retry-failed', async (request: RequestWithCorrelation, response, next) => {
    try {
      const batchId = IdSchema.parse(request.params.batchId)
      const batch = db.get<CandidateBatch>('candidate_batches', batchId)
      if (!batch) throw new Error('CANDIDATE_BATCH_NOT_FOUND')
      const result = await securityAudit.capture({
        projectId: batch.projectId, action: 'candidate_batch.retry_failed', targetType: 'candidate_batch', targetId: batchId, correlationId: correlationId(request),
      }, () => service.retryFailedCandidates(batchId, CandidateBatchRetryRequestSchema.parse(request.body)), stableAuditErrorCode)
      response.status(201).json(success(request, result))
    } catch (error) { next(error) }
  })
  app.patch('/api/v2/candidates/:candidateId', (request: RequestWithCorrelation, response) => {
    const candidateId = IdSchema.parse(request.params.candidateId)
    const current = db.get<Candidate>('candidates', candidateId)
    if (!current) throw new Error('CANDIDATE_NOT_FOUND')
    const patch = candidateAnnotationInput.parse(request.body)
    const candidate = CandidateSchema.parse({ ...current, ...patch, ...(patch.tags ? { tags: [...new Set(patch.tags)] } : {}) })
    db.put('candidates', candidate.projectId, candidate)
    response.json(success(request, candidate))
  })
  app.get('/api/v2/projects/:projectId/flows', (request: RequestWithCorrelation, response) => response.json(success(request, service.graph(IdSchema.parse(request.params.projectId), 'production'))))
  app.get('/api/v2/projects/:projectId/tracks', (request: RequestWithCorrelation, response) => response.json(success(request, db.snapshot(IdSchema.parse(request.params.projectId)).shots)))
  app.get('/api/v2/projects/:projectId/memory', (request: RequestWithCorrelation, response) => {
    const projectId = IdSchema.parse(request.params.projectId)
    response.json(success(request, memory.contexts(projectId).flatMap((context) => db.listMemoryRecords([context]))))
  })
  app.post('/api/v2/memory/rebuild', (request: RequestWithCorrelation, response) => {
    const projectId = z.object({ projectId: IdSchema }).parse(request.body).projectId
    response.json(success(request, memory.rebuild(projectId)))
  })
  app.get('/api/v2/memory/search', (request: RequestWithCorrelation, response) => {
    const input = memorySearchInput.parse(request.query)
    response.json(success(request, memory.search(input.projectId, input.q, input.limit)))
  })
  app.patch('/api/v2/memory/:memoryId', (request: RequestWithCorrelation, response) => {
    response.json(success(request, memory.setDisabled(IdSchema.parse(request.params.memoryId), memoryToggleInput.parse(request.body).disabled)))
  })
  app.delete('/api/v2/memory/:memoryId', (request: RequestWithCorrelation, response) => {
    memory.delete(IdSchema.parse(request.params.memoryId))
    response.json(success(request, { deleted: true }))
  })
  app.get('/api/v2/memory/model-status', (request: RequestWithCorrelation, response) => response.json(success(request, memory.modelStatus())))
  app.get('/api/v2/projects/:projectId/prompts', async (request: RequestWithCorrelation, response, next) => {
    try {
      db.snapshot(IdSchema.parse(request.params.projectId))
      response.json(success(request, (await service.promptPackInventory()).prompts))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/projects/:projectId/skills', async (request: RequestWithCorrelation, response, next) => {
    try {
      db.snapshot(IdSchema.parse(request.params.projectId))
      response.json(success(request, (await service.promptPackInventory()).skills))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/projects/:projectId/workflows', async (request: RequestWithCorrelation, response, next) => {
    try {
      db.snapshot(IdSchema.parse(request.params.projectId))
      response.json(success(request, (await service.promptPackInventory()).workflows))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/systems/prompt-pack', async (request: RequestWithCorrelation, response, next) => {
    try { response.json(success(request, await service.runtimePromptPackInventory())) } catch (error) { next(error) }
  })

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } })
  app.post('/api/v2/projects/:projectId/media', upload.single('file'), async (request: RequestWithCorrelation, response, next) => {
    try {
      const projectId = IdSchema.parse(request.params.projectId)
      db.snapshot(projectId)
      if (!request.file) throw new Error('UPLOAD_FILE_REQUIRED')
      const detected = await fileTypeFromBuffer(request.file.buffer)
      const allowed = new Set(['image/png', 'image/jpeg', 'image/webp'])
      if (!detected || !allowed.has(detected.mime) || detected.mime !== request.file.mimetype) throw new Error('UPLOAD_TYPE_REJECTED')
      let sanitizedBuffer: Buffer
      try {
        const metadata = await sharpRuntime(request.file.buffer, {
          failOn: 'error', limitInputPixels: 40_000_000, animated: true,
        }).metadata()
        const pages = metadata.pages ?? 1
        const frameHeight = metadata.pageHeight ?? metadata.height
        if (pages !== 1) throw new Error('UPLOAD_ANIMATION_UNSUPPORTED')
        if (!metadata.width || !frameHeight || metadata.width * frameHeight * pages > 40_000_000) throw new Error('UPLOAD_CONTENT_INVALID')
        const decoder = sharpRuntime(request.file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
        sanitizedBuffer = detected.mime === 'image/jpeg'
          ? await decoder.jpeg({ quality: 95, mozjpeg: true }).toBuffer()
          : detected.mime === 'image/png'
            ? await decoder.png({ compressionLevel: 9 }).toBuffer()
            : await decoder.webp({ quality: 95 }).toBuffer()
        if (sanitizedBuffer.byteLength === 0 || sanitizedBuffer.byteLength > 25 * 1024 * 1024) throw new Error('UPLOAD_CONTENT_INVALID')
      } catch (error) {
        if (error instanceof Error && error.message === 'UPLOAD_ANIMATION_UNSUPPORTED') throw error
        throw new Error('UPLOAD_CONTENT_INVALID')
      }
      const id = randomUUID()
      const directory = join(resolve(options.dataDirectory), 'media', projectId)
      await mkdir(directory, { recursive: true })
      const locator = `${id}.${detected.ext}`
      const finalPath = join(directory, locator)
      const stagingPath = join(directory, `.${id}.upload`)
      await writeFile(stagingPath, sanitizedBuffer, { flag: 'wx' })
      await rename(stagingPath, finalPath).catch(async (error) => { await unlink(stagingPath).catch(() => undefined); throw error })
      const media: MediaReference = MediaReferenceSchema.parse({
        id, projectId, kind: 'image', storage: 'managed-file', locator, mime: detected.mime,
        size: sanitizedBuffer.byteLength, sha256: createHash('sha256').update(sanitizedBuffer).digest('hex'), createdAt: new Date().toISOString(),
      })
      try { db.put('media_references', projectId, media) } catch (error) { await unlink(finalPath).catch(() => undefined); throw error }
      response.status(201).json(success(request, media))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/media/:projectId/:fileName', (request: RequestWithCorrelation, response, next) => {
    try {
      const projectId = IdSchema.parse(request.params.projectId)
      const fileName = z.string().regex(/^[a-zA-Z0-9-]+\.(?:png|jpe?g|webp|svg|wav|mp4)$/u).parse(request.params.fileName)
      if (basename(fileName) !== fileName) throw new Error('MEDIA_PATH_INVALID')
      // Express denies files below dot-directories by default. Development data
      // deliberately lives in `.director-data`, so authorize that already
      // validated root without weakening the filename/path boundary above.
      response.sendFile(fileName, {
        root: join(resolve(options.dataDirectory), 'media', projectId),
        dotfiles: 'allow',
      }, (error) => { if (error) next(error) })
    } catch (error) { next(error) }
  })
  app.get('/api/v2/shared-media/:fileName', (request: RequestWithCorrelation, response, next) => {
    try {
      const fileName = z.string().regex(/^[a-zA-Z0-9-]+\.(?:png|jpe?g|webp|svg|wav|mp4)$/u).parse(request.params.fileName)
      if (basename(fileName) !== fileName) throw new Error('ASSET_MEDIA_PATH_INVALID')
      response.sendFile(fileName, {
        root: join(resolve(options.dataDirectory), 'media', 'shared'),
        dotfiles: 'deny',
      }, (error) => { if (error) next(error) })
    } catch (error) { next(error) }
  })

  app.post('/api/v2/media/resolve/preview', (request: RequestWithCorrelation, response) => {
    const input = mediaResolutionPreviewInput.parse(request.body)
    db.snapshot(input.projectId)
    const media = input.inputs.map((item) => {
      const reference = db.get<MediaReference>('media_references', item.mediaId)
      if (!reference) throw new Error('MEDIA_REFERENCE_NOT_FOUND')
      return { ...item, media: reference }
    })
    response.json(success(request, previewMediaResolution(input.projectId, getModel(input.modelId), media)))
  })

  app.post('/api/v2/exports/preflight', (request: RequestWithCorrelation, response) => {
    response.status(201).json(success(request, service.prepareExport(ExportRequestSchema.parse(request.body))))
  })
  app.post('/api/v2/exports', async (request: RequestWithCorrelation, response, next) => {
    try {
      const input = ExportApprovalRequestSchema.parse(request.body)
      const preflight = db.getIdempotent<{ projectId: string }>(`export-preflight:${input.preflightId}`)
      if (!preflight) throw new Error('EXPORT_PREFLIGHT_NOT_FOUND')
      const task = await securityAudit.capture({
        projectId: preflight.projectId, action: 'export.approve', targetType: 'export', targetId: input.preflightId, correlationId: correlationId(request),
      }, () => service.approveExport(input), stableAuditErrorCode)
      response.status(202).json(success(request, publicTask(task)))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/shots/:shotId/boundary/extract', (request: RequestWithCorrelation, response) => {
    const input = boundaryExtractionInput.parse(request.body)
    response.status(202).json(success(request, publicTask(service.startBoundaryExtraction({
      ...input, shotId: IdSchema.parse(request.params.shotId),
    }))))
  })
  app.get('/api/v2/projects/:projectId/tasks', (request: RequestWithCorrelation, response) => response.json(success(request, db.list<GenerationTask>('generation_tasks', IdSchema.parse(request.params.projectId)).map(publicTask))))
  app.get('/api/v2/projects/:projectId/task-admission', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.taskAdmission(IdSchema.parse(request.params.projectId))))
  })
  app.get('/api/v2/projects/:projectId/generation-policy', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.generationPolicy(IdSchema.parse(request.params.projectId))))
  })
  app.put('/api/v2/projects/:projectId/generation-policy', async (request: RequestWithCorrelation, response, next) => {
    try {
      const projectId = IdSchema.parse(request.params.projectId)
      const policy = await securityAudit.capture({
        projectId, action: 'generation_policy.update', targetType: 'project', targetId: projectId, correlationId: correlationId(request),
      }, () => service.updateGenerationPolicy(projectId, ProjectGenerationPolicyUpdateRequestSchema.parse(request.body)), stableAuditErrorCode)
      response.json(success(request, policy))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/projects/:projectId/security-audit', (request: RequestWithCorrelation, response) => {
    const projectId = IdSchema.parse(request.params.projectId)
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(request.query.limit)
    response.json(success(request, securityAudit.list(projectId, limit)))
  })
  app.get('/api/v2/projects/:projectId/diagnostic-bundle', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.projectDiagnosticBundle(IdSchema.parse(request.params.projectId))))
  })
  app.get('/api/v2/projects/:projectId/recovery', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.projectRecoveryReport(IdSchema.parse(request.params.projectId))))
  })
  app.get('/api/v2/tasks/:taskId', (request: RequestWithCorrelation, response) => {
    const task = db.get<GenerationTask>('generation_tasks', IdSchema.parse(request.params.taskId))
    if (!task) throw new Error('TASK_NOT_FOUND')
    response.json(success(request, publicTask(task)))
  })
  app.post('/api/v2/tasks/:taskId/cancel', async (request: RequestWithCorrelation, response, next) => {
    try {
      const taskId = IdSchema.parse(request.params.taskId)
      const task = db.get<GenerationTask>('generation_tasks', taskId)
      if (!task) throw new Error('TASK_NOT_FOUND')
      const cancelled = await securityAudit.capture({
        projectId: task.projectId, action: 'task.cancel', targetType: 'task', targetId: taskId, correlationId: correlationId(request),
      }, () => service.cancelTask(taskId), stableAuditErrorCode)
      response.json(success(request, publicTask(cancelled)))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/tasks/:taskId/diagnostic', (request: RequestWithCorrelation, response) => {
    response.json(success(request, service.diagnoseTask(IdSchema.parse(request.params.taskId))))
  })
  app.post('/api/v2/tasks/:taskId/retry', async (request: RequestWithCorrelation, response, next) => {
    try {
      const taskId = IdSchema.parse(request.params.taskId)
      const task = db.get<GenerationTask>('generation_tasks', taskId)
      if (!task) throw new Error('TASK_NOT_FOUND')
      const result = await securityAudit.capture({
        projectId: task.projectId, action: 'task.retry', targetType: 'task', targetId: taskId, correlationId: correlationId(request),
      }, () => service.retryTask(taskId, TaskRetryRequestSchema.parse(request.body)), stableAuditErrorCode)
      response.status(202).json(success(request, { ...result, task: publicTask(result.task) }))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/tasks/:taskId/reconcile', async (request: RequestWithCorrelation, response) => {
    const taskId = IdSchema.parse(request.params.taskId)
    const task = db.get<GenerationTask>('generation_tasks', taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    const result = await securityAudit.capture({
      projectId: task.projectId, action: 'task.reconcile', targetType: 'task', targetId: taskId, correlationId: correlationId(request),
    }, async () => {
      z.object({}).strict().parse(request.body)
      return await service.reconcileTask(taskId)
    }, stableAuditErrorCode)
    response.json(success(request, { ...result, task: publicTask(result.task) }))
  })

  app.get('/api/v2/providers/catalog', (request: RequestWithCorrelation, response) => {
    const provider = new FakeProvider()
    response.json(success(request, {
      catalogVersion: listModels()[0]?.catalogVersion ?? '1.0.0',
      providers: [{ id: provider.id, status: 'ready', billing: { verified: true, billedRequests: 0 }, models: listModels().filter((model) => model.providerId === provider.id) }],
    }))
  })
  app.get('/api/v2/models/catalog', (request: RequestWithCorrelation, response) => response.json(success(request, { models: listModels() })))
  app.get('/api/v2/systems/egress/status', (request: RequestWithCorrelation, response) => response.json(success(request, egress.status())))
  app.all(/^\/api\/v2\/provider-(?:plugins(?:\/.*)?|plugin-publishers(?:\/.*)?)$/u, (_request, _response, next) => {
    next(new Error('EXECUTABLE_PROVIDER_ADAPTERS_DISABLED'))
  })
  app.get('/api/v2/provider-connections', async (request: RequestWithCorrelation, response, next) => {
    try { response.json(success(request, await providerConnections.list())) } catch (error) { next(error) }
  })
  app.post('/api/v2/provider-connections', async (request: RequestWithCorrelation, response, next) => {
    try {
      response.status(201).json(success(request, await providerConnections.create(ProviderConnectionCreateRequestSchema.parse(request.body))))
    } catch (error) { next(error) }
  })
  app.put('/api/v2/provider-connections/:connectionId/credential', async (request: RequestWithCorrelation, response, next) => {
    try {
      response.json(success(request, await providerConnections.replaceCredential(
        IdSchema.parse(request.params.connectionId), ProviderCredentialUpdateRequestSchema.parse(request.body),
      )))
    } catch (error) { next(error) }
  })
  app.post('/api/v2/provider-connections/:connectionId/test', async (request: RequestWithCorrelation, response, next) => {
    try {
      response.json(success(request, await providerConnections.test(IdSchema.parse(request.params.connectionId), request.body)))
    } catch (error) { next(error) }
  })
  app.get('/api/v2/projects/:projectId/provider-route', (request: RequestWithCorrelation, response) => {
    response.json(success(request, providerConnections.routePolicy(IdSchema.parse(request.params.projectId))))
  })
  app.put('/api/v2/projects/:projectId/provider-route', (request: RequestWithCorrelation, response) => {
    response.json(success(request, providerConnections.updateRoutePolicy(
      IdSchema.parse(request.params.projectId), ProviderRoutePolicyUpdateRequestSchema.parse(request.body),
    )))
  })
  app.get('/api/v2/projects/:projectId/provider-costs', (request: RequestWithCorrelation, response) => {
    const projectId = IdSchema.parse(request.params.projectId)
    if (!db.getProject(projectId)) throw new Error('PROJECT_NOT_FOUND')
    response.json(success(request, db.listProviderCosts(projectId)))
  })
  app.get('/api/v2/systems', (request: RequestWithCorrelation, response) => response.json(success(request, {
    schemaVersion: db.schemaVersion(), dataMode: 'local', demoMode: process.env.DEMO_MODE === '1', providerNetworkDisabled,
    capabilities: {
      storyGraph: true, multiFormatSourceImport: true, agentApproval: true, durableTasks: true, localExport: true,
      declarativeProviderConnections: true, executableProviderAdapters: false,
    },
  })))

  app.use('/api', (request: RequestWithCorrelation, response) => {
    response.status(404).json({ ok: false, error: { code: 'ROUTE_NOT_FOUND', userMessage: '接口不存在。', retryable: false, correlationId: correlationId(request), timestamp: new Date().toISOString() } })
  })
  if (options.studioDirectory) {
    const studioDirectory = resolve(options.studioDirectory)
    app.get('/', (request, response) => {
      response.setHeader('cache-control', 'no-store')
      response.cookie(browserSessionCookie, browserSessionToken, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 12 * 60 * 60 * 1_000,
      })
      response.redirect(302, safeStudioReturnPath(request.query.return ?? '/studio?workspace=project_center'))
    })
    app.use(express.static(studioDirectory, { index: false, dotfiles: 'deny', fallthrough: true }))
    app.get(['/studio', '/studio/*path'], (_request, response) => response.sendFile(join(studioDirectory, 'index.html')))
  }
  app.use((error: unknown, request: RequestWithCorrelation, response: Response, _next: NextFunction) => {
    if (!(error instanceof ZodError) && !errorMap[(error instanceof Error ? error.message : '').split(':')[0] ?? '']) options.onUnhandledError?.(error)
    const mapped = asAppError(error, request)
    response.status(mapped.status).json({ ok: false, error: mapped.payload })
  })

  return { app, httpServer, io, db, service, memory, egress, providerConnections, allowOrigin: (origin: string) => { allowedOrigins.add(origin) } }
}
