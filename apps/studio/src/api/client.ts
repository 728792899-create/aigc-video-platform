import {
  GenerationTaskSchema,
  ProjectPackageImportReportSchema,
  PromptPackInventorySchema,
  SourceImportCancelReportSchema,
  SourceImportPreviewSchema,
  type ApiEnvelope,
  type AgentRunCheckpoint,
  type ArtifactDiff,
  type ArtifactHistory,
  type ArtifactVersion,
  type AssetBatchBindingDraft,
  type AssetBatchBindPreview,
  type AssetBatchBindReport,
  type AssetImpact,
  type Candidate,
  type CreativeBriefCandidateBatch,
  type CreativeBriefCandidateRequest,
  type CreativeBriefCandidateReviewRequest,
  type CandidateBatchRetryResult,
  type CreativeBriefRevisionRequest,
  type CreativeBriefState,
  type Episode,
  type EpisodeContinuityState,
  type EpisodeContext,
  type EgressBrokerStatus,
  type ExecutionPlan,
  type ExportApprovalRequest,
  type ExportPreflight,
  type ExportRequest,
  type GenerationTask,
  type TaskDiagnostic,
  type TaskAdmission,
  type TaskReconcileResult,
  type TaskRetryResult,
  type GraphCommand,
  type GraphProjection,
  type Project,
  type ProjectDiagnosticBundle,
  type ProjectRecoveryReport,
  type ProjectSecurityAuditLog,
  type ProjectGenerationPolicy,
  type ProjectGenerationPolicyUpdateRequest,
  type ProjectPackageImportReport,
  type ProjectSnapshot,
  type PromptDiff,
  type PromptPolishRequest,
  type PromptPolishResult,
  type PromptPackInventory,
  type PromptRevision,
  type ScopedRegenerationRequest,
  type ScopedRegenerationResult,
  type ScenePatchApplyRequest,
  type ScenePatchApplyResult,
  type ProviderConnection,
  type ProviderConnectionCreateRequest,
  type ProviderConnectionTestReport,
  type ProviderCredentialUpdateRequest,
  type ProviderRoutePolicy,
  type ProviderRoutePolicyUpdateRequest,
  type ProviderCostLedgerEntry,
  type RoutedCandidateGenerationRequest,
  type SourceImportCancelReport,
  type SourceImportCommit,
  type SourceImportPreview,
  type ReconcileDecision,
  type ReconcilePreview,
  type ReconcileReport,
  type ResolvedAsset,
  type Series,
  type SharedAsset,
  type SharedAssetVariant,
  type SkillPackageVersion,
  type GoldenEvaluation,
  type JsonObject,
  type MemoryModelStatus,
  type MemoryRebuildReport,
  type MemoryRecord,
  type MemorySearchResult,
} from '@aigc-director/contracts'
import { io, type Socket } from 'socket.io-client'

export class DirectorApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly correlationId: string,
  ) { super(message) }
}

type LocalSession = {
  apiBaseUrl: string
  authMode: 'bearer' | 'cookie'
  sessionToken?: string
  csrfToken?: string
}

let session: LocalSession | undefined

function invalidateSessionOnUnauthorized(status: number, body?: ApiEnvelope<unknown>): void {
  if (status === 401 || (body && !body.ok && body.error.code === 'UNAUTHORIZED')) session = undefined
}

async function getSession(): Promise<LocalSession> {
  if (session) return session
  if (window.aigcDirector) {
    const desktop = await window.aigcDirector.getSessionConfig()
    session = { apiBaseUrl: desktop.apiBaseUrl, authMode: 'bearer', sessionToken: desktop.sessionToken }
  } else {
    const sessionToken = import.meta.env.VITE_DIRECTOR_SESSION_TOKEN
    if (sessionToken) {
      session = { apiBaseUrl: '', authMode: 'bearer', sessionToken }
    } else {
      const response = await fetch('/api/v2/session', {
        credentials: 'same-origin',
        headers: { 'x-request-id': crypto.randomUUID() },
      })
      const body = await response.json() as ApiEnvelope<{ authMode: 'cookie'; csrfToken: string }>
      if (!body.ok) throw new DirectorApiError(body.error.code, body.error.userMessage, body.error.retryable, body.error.correlationId)
      session = { apiBaseUrl: '', authMode: 'cookie', csrfToken: body.data.csrfToken }
    }
  }
  return session
}

function localHeaders(current: LocalSession, method: string | undefined, source?: HeadersInit): Headers {
  const headers = new Headers(source)
  headers.set('x-request-id', crypto.randomUUID())
  if (current.sessionToken) headers.set('authorization', `Bearer ${current.sessionToken}`)
  if (current.authMode === 'cookie' && method && !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    if (!current.csrfToken) throw new Error('DIRECTOR_CSRF_NOT_CONFIGURED')
    headers.set('x-csrf-token', current.csrfToken)
  }
  return headers
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const current = await getSession()
  const headers = localHeaders(current, init.method, init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(`${current.apiBaseUrl}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  })
  const body = await response.json() as ApiEnvelope<T>
  if (!body.ok) {
    invalidateSessionOnUnauthorized(response.status, body)
    throw new DirectorApiError(body.error.code, body.error.userMessage, body.error.retryable, body.error.correlationId)
  }
  return body.data
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const current = await getSession()
  const response = await fetch(`${current.apiBaseUrl}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: localHeaders(current, init.method, init.headers),
  })
  if (response.status === 401) session = undefined
  return response
}

async function throwApiFailure(response: Response): Promise<never> {
  const body = await response.json() as ApiEnvelope<never>
  if (!body.ok) {
    invalidateSessionOnUnauthorized(response.status, body)
    throw new DirectorApiError(body.error.code, body.error.userMessage, body.error.retryable, body.error.correlationId)
  }
  throw new Error('DIRECTOR_API_UNEXPECTED_RESPONSE')
}

export interface TaskEventStream {
  subscribe(projectId: string): void
  disconnect(): void
}

export async function connectTaskEvents(onTask: (task: GenerationTask) => void): Promise<TaskEventStream> {
  const current = await getSession()
  const socket: Socket = io(`${current.apiBaseUrl}/studio-v2`, {
    path: '/studio-v2/socket.io',
    auth: current.sessionToken ? { token: current.sessionToken } : {},
    withCredentials: true,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelayMax: 4_000,
  })
  socket.on('task:update', (raw: unknown) => {
    const parsed = GenerationTaskSchema.safeParse(raw)
    if (parsed.success) onTask(parsed.data)
  })
  return {
    subscribe(projectId: string): void { socket.emit('project:subscribe', projectId) },
    disconnect(): void { socket.disconnect() },
  }
}

export const directorApi = {
  providerConnections: (): Promise<ProviderConnection[]> => request('/api/v2/provider-connections'),
  createProviderConnection: (input: ProviderConnectionCreateRequest): Promise<ProviderConnection> => request('/api/v2/provider-connections', {
    method: 'POST', body: JSON.stringify(input),
  }),
  replaceProviderCredential: (connectionId: string, input: ProviderCredentialUpdateRequest): Promise<ProviderConnection> => request(`/api/v2/provider-connections/${connectionId}/credential`, {
    method: 'PUT', body: JSON.stringify(input),
  }),
  testProviderConnection: (connectionId: string, expectedRevision: number): Promise<ProviderConnectionTestReport> => request(`/api/v2/provider-connections/${connectionId}/test`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, confirmation: 'TEST_PROVIDER_CONNECTION' }),
  }),
  providerRoutePolicy: (projectId: string): Promise<ProviderRoutePolicy> => request(`/api/v2/projects/${projectId}/provider-route`),
  updateProviderRoutePolicy: (projectId: string, input: ProviderRoutePolicyUpdateRequest): Promise<ProviderRoutePolicy> => request(`/api/v2/projects/${projectId}/provider-route`, {
    method: 'PUT', body: JSON.stringify(input),
  }),
  providerCosts: (projectId: string): Promise<ProviderCostLedgerEntry[]> => request(`/api/v2/projects/${projectId}/provider-costs`),
  listProjects: (): Promise<Project[]> => request('/api/v2/projects'),
  createProject: (input: { name: string; description?: string }): Promise<Project> => request('/api/v2/projects', { method: 'POST', body: JSON.stringify(input) }),
  snapshot: (projectId: string): Promise<ProjectSnapshot> => request(`/api/v2/projects/${projectId}`),
  creativeBrief: (projectId: string): Promise<CreativeBriefState> => request(`/api/v2/projects/${projectId}/brief`),
  reviseCreativeBrief: (projectId: string, input: CreativeBriefRevisionRequest): Promise<CreativeBriefState> => request(`/api/v2/projects/${projectId}/brief`, {
    method: 'PUT', body: JSON.stringify(input),
  }),
  createCreativeBriefCandidates: (projectId: string, input: CreativeBriefCandidateRequest): Promise<CreativeBriefCandidateBatch> => request(`/api/v2/projects/${projectId}/brief/candidates`, {
    method: 'POST', body: JSON.stringify(input),
  }),
  reviewCreativeBriefCandidate: (projectId: string, artifactId: string, input: CreativeBriefCandidateReviewRequest): Promise<CreativeBriefState> => request(`/api/v2/projects/${projectId}/brief/candidates/${artifactId}/review`, {
    method: 'POST', body: JSON.stringify(input),
  }),
  listSeries: (): Promise<Series[]> => request('/api/v2/series'),
  createSeries: (input: { name: string; description?: string; artDirection?: string }): Promise<Series> => request('/api/v2/series', { method: 'POST', body: JSON.stringify(input) }),
  attachEpisode: (seriesId: string, input: { projectId: string; ordinal?: number }): Promise<Episode> => request(`/api/v2/series/${seriesId}/episodes`, { method: 'POST', body: JSON.stringify(input) }),
  episodeContext: (episodeId: string): Promise<EpisodeContext> => request(`/api/v2/episodes/${episodeId}/context`),
  episodeContinuity: (episodeId: string): Promise<EpisodeContinuityState> => request(`/api/v2/episodes/${episodeId}/continuity`),
  createEpisodeContinuitySummary: (
    episodeId: string,
    input: { expectedSourceId: string; expectedSourceRevision: number; expectedSourceHash: string; idempotencyKey: string },
  ): Promise<EpisodeContinuityState> => request(`/api/v2/episodes/${episodeId}/continuity-summary`, {
    method: 'POST', body: JSON.stringify({ ...input, confirmation: 'CREATE_EPISODE_CONTINUITY_SUMMARY' }),
  }),
  listSharedAssets: (scope?: 'global' | 'series', seriesId?: string): Promise<SharedAsset[]> => request(`/api/v2/assets/shared?${new URLSearchParams({ ...(scope ? { scope } : {}), ...(seriesId ? { seriesId } : {}) }).toString()}`),
  createSharedAsset: (input: {
    scope: 'global' | 'series'; seriesId?: string; logicalId?: string; type: SharedAsset['type']; name: string;
    description?: string; metadata?: Record<string, unknown>;
  }): Promise<SharedAsset> => request('/api/v2/assets/shared', { method: 'POST', body: JSON.stringify(input) }),
  createSharedAssetVariant: (assetId: string, input: { label: string; prompt?: string; metadata?: Record<string, unknown> }): Promise<SharedAssetVariant> => request(`/api/v2/assets/shared/${assetId}/variants`, { method: 'POST', body: JSON.stringify(input) }),
  resolveAssets: (projectId: string): Promise<ResolvedAsset[]> => request(`/api/v2/assets/resolve?projectId=${encodeURIComponent(projectId)}`),
  forkAsset: (input: { projectId: string; sharedAssetId: string; sharedVariantId: string }): Promise<{ asset: ProjectSnapshot['assets'][number]; variant: ProjectSnapshot['variants'][number] }> => request('/api/v2/assets/fork', { method: 'POST', body: JSON.stringify(input) }),
  promoteAsset: (input: { projectId: string; assetId: string; variantId: string; scope: 'global' | 'series'; seriesId?: string }): Promise<{ asset: SharedAsset; variant: SharedAssetVariant }> => request('/api/v2/assets/promote', { method: 'POST', body: JSON.stringify(input) }),
  assetImpact: (assetId: string): Promise<AssetImpact> => request(`/api/v2/assets/${assetId}/impact`),
  previewBatchBind: (input: { episodeId: string; expectedProjectRevision: number; bindings: AssetBatchBindingDraft[] }): Promise<AssetBatchBindPreview> => request('/api/v2/assets/batch-bind/preview', { method: 'POST', body: JSON.stringify(input) }),
  applyBatchBind: (input: { episodeId: string; operationId: string; approvalToken: string }): Promise<AssetBatchBindReport> => request('/api/v2/assets/batch-bind/apply', { method: 'POST', body: JSON.stringify(input) }),
  previewReconcile: (episodeId: string, input: { expectedProjectRevision: number; decisions: ReconcileDecision[] }): Promise<ReconcilePreview> => request(`/api/v2/episodes/${episodeId}/reconcile/preview`, { method: 'POST', body: JSON.stringify(input) }),
  applyReconcile: (episodeId: string, input: { operationId: string; approvalToken: string }): Promise<ReconcileReport> => request(`/api/v2/episodes/${episodeId}/reconcile/apply`, { method: 'POST', body: JSON.stringify(input) }),
  listPromptRevisions: (stableKey?: string, projectId?: string): Promise<PromptRevision[]> => request(`/api/v2/prompt-definitions?${new URLSearchParams({ ...(stableKey ? { stableKey } : {}), ...(projectId ? { projectId } : {}) }).toString()}`),
  createPromptRevision: (input: {
    projectId?: string; stableKey: string; title: string; role: PromptRevision['role']; languageDrafts: PromptRevision['languageDrafts'];
    feedback?: string; variablesSchema: JsonObject; outputSchema: JsonObject; modelPolicy?: JsonObject;
  }): Promise<PromptRevision> => request('/api/v2/prompt-definitions', { method: 'POST', body: JSON.stringify(input) }),
  promptDiff: (fromId: string, toId: string): Promise<PromptDiff> => request(`/api/v2/prompt-revisions/${fromId}/diff?to=${encodeURIComponent(toId)}`),
  compilePrompt: (revisionId: string, variables: JsonObject): Promise<{ zhReview: string; enExecution: string; compiledHash: string }> => request(`/api/v2/prompt-revisions/${revisionId}/compile`, { method: 'POST', body: JSON.stringify({ variables }) }),
  polishPrompt: (revisionId: string, input: PromptPolishRequest): Promise<PromptPolishResult> => request(`/api/v2/prompt-revisions/${revisionId}/polish`, { method: 'POST', body: JSON.stringify(input) }),
  evaluatePrompt: (revisionId: string, input: { name: string; input: JsonObject; expectedSchema: JsonObject; fakeOutput: JsonObject }): Promise<GoldenEvaluation> => request(`/api/v2/prompt-revisions/${revisionId}/evaluations`, { method: 'POST', body: JSON.stringify(input) }),
  publishPrompt: (revisionId: string): Promise<PromptRevision> => request(`/api/v2/prompt-revisions/${revisionId}/publish`, { method: 'POST' }),
  restorePrompt: (revisionId: string): Promise<PromptRevision> => request(`/api/v2/prompt-revisions/${revisionId}/restore`, { method: 'POST' }),
  scopedRegenerate: (projectId: string, input: ScopedRegenerationRequest): Promise<ScopedRegenerationResult> => request(`/api/v2/projects/${projectId}/scoped-regenerations`, {
    method: 'POST', body: JSON.stringify(input),
  }),
  applyScenePatch: (projectId: string, artifactId: string, input: ScenePatchApplyRequest): Promise<ScenePatchApplyResult> => request(`/api/v2/projects/${projectId}/scene-patches/${artifactId}/apply`, {
    method: 'POST', body: JSON.stringify(input),
  }),
  listSkillVersions: (stableKey?: string, projectId?: string): Promise<SkillPackageVersion[]> => request(`/api/v2/skills?${new URLSearchParams({ ...(stableKey ? { stableKey } : {}), ...(projectId ? { projectId } : {}) }).toString()}`),
  createSkillVersion: (input: { projectId?: string; stableKey: string; name: string; description?: string; markdown: string }): Promise<SkillPackageVersion> => request('/api/v2/skills', { method: 'POST', body: JSON.stringify(input) }),
  evaluateSkill: (versionId: string, input: { name: string; input: JsonObject; expectedSchema: JsonObject; fakeOutput: JsonObject }): Promise<GoldenEvaluation> => request(`/api/v2/skills/${versionId}/evaluations`, { method: 'POST', body: JSON.stringify(input) }),
  validateSkill: (versionId: string): Promise<{ valid: boolean; issues: string[]; evaluations: GoldenEvaluation[] }> => request(`/api/v2/skills/${versionId}/validate`),
  publishSkill: (versionId: string): Promise<SkillPackageVersion> => request(`/api/v2/skills/${versionId}/publish`, { method: 'POST' }),
  rollbackSkill: (versionId: string): Promise<SkillPackageVersion> => request(`/api/v2/skills/${versionId}/rollback`, { method: 'POST' }),
  artifactHistory: (projectId: string, scope: ArtifactVersion['scope'], artifactType: string): Promise<ArtifactHistory> => request(`/api/v2/artifacts/${scope.type}/${scope.id}/versions?${new URLSearchParams({ projectId, artifactType }).toString()}`),
  artifactDiff: (projectId: string, scope: ArtifactVersion['scope'], fromVersionId: string, toVersionId: string): Promise<ArtifactDiff> => request(`/api/v2/artifacts/${scope.type}/${scope.id}/diff?${new URLSearchParams({ projectId, from: fromVersionId, to: toVersionId }).toString()}`),
  rollbackArtifact: (projectId: string, scope: ArtifactVersion['scope'], targetVersionId: string, expectedHeadRevision: number): Promise<ArtifactVersion> => request(`/api/v2/artifacts/${scope.type}/${scope.id}/rollback`, {
    method: 'POST', body: JSON.stringify({ projectId, targetVersionId, expectedHeadRevision }),
  }),
  importSource: (projectId: string, input: { title: string; content: string }): Promise<ProjectSnapshot> => request(`/api/v2/projects/${projectId}/sources`, { method: 'POST', body: JSON.stringify(input) }),
  async previewSourceImport(projectId: string, file: File): Promise<SourceImportPreview> {
    const form = new FormData()
    form.append('file', file, file.name)
    const response = await authorizedFetch(`/api/v2/projects/${projectId}/source-imports/preview`, { method: 'POST', body: form })
    if (!response.ok) return await throwApiFailure(response)
    const body = await response.json() as ApiEnvelope<unknown>
    if (!body.ok) throw new DirectorApiError(body.error.code, body.error.userMessage, body.error.retryable, body.error.correlationId)
    return SourceImportPreviewSchema.parse(body.data)
  },
  commitSourceImport: (projectId: string, importId: string, input: SourceImportCommit): Promise<ProjectSnapshot> => request(`/api/v2/projects/${projectId}/source-imports/${importId}/commit`, { method: 'POST', body: JSON.stringify(input) }),
  async cancelSourceImport(projectId: string, importId: string): Promise<SourceImportCancelReport> {
    return SourceImportCancelReportSchema.parse(await request<unknown>(`/api/v2/projects/${projectId}/source-imports/${importId}`, { method: 'DELETE' }))
  },
  graph: (projectId: string, view: GraphProjection['view']): Promise<GraphProjection> => request(`/api/v2/projects/${projectId}/graph?view=${view}`),
  command: (projectId: string, view: GraphProjection['view'], command: GraphCommand): Promise<{ revision: number; changed: string[]; skipped: string[] }> => request(`/api/v2/projects/${projectId}/graph/commands?view=${view}`, { method: 'POST', body: JSON.stringify(command) }),
  createPlan: (projectId: string, idempotencyKey: string): Promise<{ plan: ExecutionPlan; approvalToken: string; checkpoint: AgentRunCheckpoint }> => request(`/api/v2/projects/${projectId}/agent-plans`, { method: 'POST', body: JSON.stringify({ idempotencyKey }) }),
  agentCheckpoint: (runId: string): Promise<AgentRunCheckpoint> => request(`/api/v2/agent-runs/${runId}/checkpoint`),
  approvePlan: (planId: string, token: string): Promise<ProjectSnapshot> => request(`/api/v2/plans/${planId}/approve`, { method: 'POST', body: JSON.stringify({ token }) }),
  runDemoProduction: (projectId: string, idempotencyKey: string): Promise<ProjectSnapshot> => request(`/api/v2/projects/${projectId}/demo-production`, { method: 'POST', body: JSON.stringify({ idempotencyKey }) }),
  generateRoutedCandidate: (shotId: string, input: RoutedCandidateGenerationRequest): Promise<GenerationTask> => request(`/api/v2/shots/${shotId}/provider-candidates`, { method: 'POST', body: JSON.stringify(input) }),
  annotateCandidate: (candidateId: string, patch: { favorite?: boolean; label?: string; tags?: string[] }): Promise<Candidate> => request(`/api/v2/candidates/${candidateId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  retryFailedCandidateBatch: (batchId: string, idempotencyKey: string): Promise<CandidateBatchRetryResult> => request(`/api/v2/candidate-batches/${batchId}/retry-failed`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey, confirmation: 'RETRY_FAILED_CANDIDATES' }),
  }),
  listMemory: (projectId: string): Promise<MemoryRecord[]> => request(`/api/v2/projects/${projectId}/memory`),
  rebuildMemory: (projectId: string): Promise<MemoryRebuildReport> => request('/api/v2/memory/rebuild', { method: 'POST', body: JSON.stringify({ projectId }) }),
  searchMemory: (projectId: string, query: string, limit = 12): Promise<MemorySearchResult[]> => request(`/api/v2/memory/search?${new URLSearchParams({ projectId, q: query, limit: String(limit) }).toString()}`),
  toggleMemory: (memoryId: string, disabled: boolean): Promise<MemoryRecord> => request(`/api/v2/memory/${memoryId}`, { method: 'PATCH', body: JSON.stringify({ disabled }) }),
  deleteMemory: (memoryId: string): Promise<{ deleted: true }> => request(`/api/v2/memory/${memoryId}`, { method: 'DELETE' }),
  memoryModelStatus: (): Promise<MemoryModelStatus> => request('/api/v2/memory/model-status'),
  egressStatus: (): Promise<EgressBrokerStatus> => request('/api/v2/systems/egress/status'),
  prepareExport: (input: ExportRequest): Promise<ExportPreflight> => request('/api/v2/exports/preflight', { method: 'POST', body: JSON.stringify(input) }),
  startExport: (input: ExportApprovalRequest): Promise<GenerationTask> => request('/api/v2/exports', { method: 'POST', body: JSON.stringify(input) }),
  tasks: (projectId: string): Promise<GenerationTask[]> => request(`/api/v2/projects/${projectId}/tasks`),
  taskAdmission: (projectId: string): Promise<TaskAdmission> => request(`/api/v2/projects/${projectId}/task-admission`),
  generationPolicy: (projectId: string): Promise<ProjectGenerationPolicy> => request(`/api/v2/projects/${projectId}/generation-policy`),
  updateGenerationPolicy: (projectId: string, input: ProjectGenerationPolicyUpdateRequest): Promise<ProjectGenerationPolicy> => request(`/api/v2/projects/${projectId}/generation-policy`, {
    method: 'PUT', body: JSON.stringify(input),
  }),
  projectDiagnosticBundle: (projectId: string): Promise<ProjectDiagnosticBundle> => request(`/api/v2/projects/${projectId}/diagnostic-bundle`),
  projectRecoveryReport: (projectId: string): Promise<ProjectRecoveryReport> => request(`/api/v2/projects/${projectId}/recovery`),
  projectSecurityAudit: (projectId: string, limit = 100): Promise<ProjectSecurityAuditLog> => request(`/api/v2/projects/${projectId}/security-audit?limit=${limit}`),
  task: (taskId: string): Promise<GenerationTask> => request(`/api/v2/tasks/${taskId}`),
  cancelTask: (taskId: string): Promise<GenerationTask> => request(`/api/v2/tasks/${taskId}/cancel`, { method: 'POST' }),
  taskDiagnostic: (taskId: string): Promise<TaskDiagnostic> => request(`/api/v2/tasks/${taskId}/diagnostic`),
  reconcileTask: (taskId: string): Promise<TaskReconcileResult> => request(`/api/v2/tasks/${taskId}/reconcile`, { method: 'POST', body: '{}' }),
  retryTask: (taskId: string, idempotencyKey: string): Promise<TaskRetryResult> => request(`/api/v2/tasks/${taskId}/retry`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey, confirmation: 'RETRY_FAILED_TASK' }),
  }),
  async exportProjectPackage(projectId: string): Promise<{ blob: Blob; fileName: string }> {
    const response = await authorizedFetch(`/api/v2/projects/${projectId}/package`)
    if (!response.ok) return await throwApiFailure(response)
    const disposition = response.headers.get('content-disposition') ?? ''
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1]
    return { blob: await response.blob(), fileName: encoded ? decodeURIComponent(encoded) : 'aigc-director-project.aigcproj' }
  },
  async exportSeriesPackage(seriesId: string): Promise<{ blob: Blob; fileName: string }> {
    const response = await authorizedFetch(`/api/v2/series/${seriesId}/package`)
    if (!response.ok) return await throwApiFailure(response)
    const disposition = response.headers.get('content-disposition') ?? ''
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1]
    return { blob: await response.blob(), fileName: encoded ? decodeURIComponent(encoded) : 'aigc-director-series.aigcproj' }
  },
  async importProjectPackage(file: File): Promise<ProjectPackageImportReport> {
    const form = new FormData()
    form.append('file', file, file.name)
    const response = await authorizedFetch('/api/v2/project-packages/import', { method: 'POST', body: form })
    if (!response.ok) return await throwApiFailure(response)
    const body = await response.json() as ApiEnvelope<unknown>
    if (!body.ok) throw new DirectorApiError(body.error.code, body.error.userMessage, body.error.retryable, body.error.correlationId)
    return ProjectPackageImportReportSchema.parse(body.data)
  },
  promptPackInventory: async (): Promise<PromptPackInventory> => PromptPackInventorySchema.parse(await request<unknown>('/api/v2/systems/prompt-pack')),
  async mediaBlob(projectId: string, locator: string): Promise<Blob> {
    const response = await authorizedFetch(`/api/v2/media/${projectId}/${encodeURIComponent(locator)}`)
    if (!response.ok) throw new Error('MEDIA_LOAD_FAILED')
    return await response.blob()
  },
}
