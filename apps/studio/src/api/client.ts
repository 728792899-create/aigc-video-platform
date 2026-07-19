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
  type DenoRuntimeCancelReport,
  type DenoRuntimeStatus,
  type Episode,
  type EpisodeContext,
  type EgressBrokerStatus,
  type ExecutionPlan,
  type ExportRequest,
  type GenerationTask,
  type GraphCommand,
  type GraphProjection,
  type Project,
  type ProjectPackageImportReport,
  type ProjectSnapshot,
  type PromptDiff,
  type PromptPackInventory,
  type PromptRevision,
  type ScopedRegenerationRequest,
  type ScopedRegenerationResult,
  type ProviderPluginRecord,
  type ProviderPluginTestReport,
  type ProviderPublisherTrust,
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

let session: { apiBaseUrl: string; sessionToken: string } | undefined

async function getSession(): Promise<{ apiBaseUrl: string; sessionToken: string }> {
  if (session) return session
  if (window.aigcDirector) {
    const desktop = await window.aigcDirector.getSessionConfig()
    session = { apiBaseUrl: desktop.apiBaseUrl, sessionToken: desktop.sessionToken }
  } else {
    const sessionToken = import.meta.env.VITE_DIRECTOR_SESSION_TOKEN
    if (!sessionToken) throw new Error('DIRECTOR_SESSION_NOT_CONFIGURED')
    session = { apiBaseUrl: '', sessionToken }
  }
  return session
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const current = await getSession()
  const response = await fetch(`${current.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${current.sessionToken}`,
      'x-request-id': crypto.randomUUID(),
      ...init.headers,
    },
  })
  const body = await response.json() as ApiEnvelope<T>
  if (!body.ok) throw new DirectorApiError(body.error.code, body.error.userMessage, body.error.retryable, body.error.correlationId)
  return body.data
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const current = await getSession()
  return await fetch(`${current.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${current.sessionToken}`,
      'x-request-id': crypto.randomUUID(),
      ...init.headers,
    },
  })
}

async function throwApiFailure(response: Response): Promise<never> {
  const body = await response.json() as ApiEnvelope<never>
  if (!body.ok) throw new DirectorApiError(body.error.code, body.error.userMessage, body.error.retryable, body.error.correlationId)
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
    auth: { token: current.sessionToken },
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
  listProjects: (): Promise<Project[]> => request('/api/v2/projects'),
  createProject: (input: { name: string; description?: string }): Promise<Project> => request('/api/v2/projects', { method: 'POST', body: JSON.stringify(input) }),
  snapshot: (projectId: string): Promise<ProjectSnapshot> => request(`/api/v2/projects/${projectId}`),
  listSeries: (): Promise<Series[]> => request('/api/v2/series'),
  createSeries: (input: { name: string; description?: string; artDirection?: string }): Promise<Series> => request('/api/v2/series', { method: 'POST', body: JSON.stringify(input) }),
  attachEpisode: (seriesId: string, input: { projectId: string; ordinal?: number }): Promise<Episode> => request(`/api/v2/series/${seriesId}/episodes`, { method: 'POST', body: JSON.stringify(input) }),
  episodeContext: (episodeId: string): Promise<EpisodeContext> => request(`/api/v2/episodes/${episodeId}/context`),
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
  evaluatePrompt: (revisionId: string, input: { name: string; input: JsonObject; expectedSchema: JsonObject; fakeOutput: JsonObject }): Promise<GoldenEvaluation> => request(`/api/v2/prompt-revisions/${revisionId}/evaluations`, { method: 'POST', body: JSON.stringify(input) }),
  publishPrompt: (revisionId: string): Promise<PromptRevision> => request(`/api/v2/prompt-revisions/${revisionId}/publish`, { method: 'POST' }),
  restorePrompt: (revisionId: string): Promise<PromptRevision> => request(`/api/v2/prompt-revisions/${revisionId}/restore`, { method: 'POST' }),
  scopedRegenerate: (projectId: string, input: ScopedRegenerationRequest): Promise<ScopedRegenerationResult> => request(`/api/v2/projects/${projectId}/scoped-regenerations`, {
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
  annotateCandidate: (candidateId: string, patch: { favorite?: boolean; label?: string; tags?: string[] }): Promise<Candidate> => request(`/api/v2/candidates/${candidateId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  listMemory: (projectId: string): Promise<MemoryRecord[]> => request(`/api/v2/projects/${projectId}/memory`),
  rebuildMemory: (projectId: string): Promise<MemoryRebuildReport> => request('/api/v2/memory/rebuild', { method: 'POST', body: JSON.stringify({ projectId }) }),
  searchMemory: (projectId: string, query: string, limit = 12): Promise<MemorySearchResult[]> => request(`/api/v2/memory/search?${new URLSearchParams({ projectId, q: query, limit: String(limit) }).toString()}`),
  toggleMemory: (memoryId: string, disabled: boolean): Promise<MemoryRecord> => request(`/api/v2/memory/${memoryId}`, { method: 'PATCH', body: JSON.stringify({ disabled }) }),
  deleteMemory: (memoryId: string): Promise<{ deleted: true }> => request(`/api/v2/memory/${memoryId}`, { method: 'DELETE' }),
  memoryModelStatus: (): Promise<MemoryModelStatus> => request('/api/v2/memory/model-status'),
  egressStatus: (): Promise<EgressBrokerStatus> => request('/api/v2/systems/egress/status'),
  denoRuntimeStatus: (): Promise<DenoRuntimeStatus> => request('/api/v2/provider-plugins/runtime'),
  installDenoRuntime: (): Promise<DenoRuntimeStatus> => request('/api/v2/provider-plugins/runtime/install', {
    method: 'POST', body: JSON.stringify({ confirmation: 'INSTALL_DENO_2.9.2' }),
  }),
  cancelDenoRuntimeInstall: (): Promise<DenoRuntimeCancelReport> => request('/api/v2/provider-plugins/runtime/install/cancel', {
    method: 'POST', body: JSON.stringify({ confirmation: 'CANCEL_DENO_2.9.2_INSTALL' }),
  }),
  listProviderPlugins: (): Promise<ProviderPluginRecord[]> => request('/api/v2/provider-plugins'),
  listProviderPublishers: (): Promise<ProviderPublisherTrust[]> => request('/api/v2/provider-plugin-publishers'),
  trustProviderPublisher: (input: { keyId: string; displayName: string; publicKeyPem: string }): Promise<ProviderPublisherTrust> => request('/api/v2/provider-plugin-publishers', {
    method: 'POST', body: JSON.stringify({ ...input, confirmation: 'TRUST_PROVIDER_PLUGIN_PUBLISHER' }),
  }),
  revokeProviderPublisher: (id: string, expectedRevision: number): Promise<ProviderPublisherTrust> => request(`/api/v2/provider-plugin-publishers/${id}/revoke`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, confirmation: 'REVOKE_PROVIDER_PLUGIN_PUBLISHER' }),
  }),
  testProviderPlugin: (id: string, expectedRevision: number): Promise<ProviderPluginTestReport> => request(`/api/v2/provider-plugins/${id}/test`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, confirmation: 'TEST_SIGNED_PROVIDER_PLUGIN' }),
  }),
  enableProviderPlugin: (id: string, expectedRevision: number): Promise<ProviderPluginRecord> => request(`/api/v2/provider-plugins/${id}/enable`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, confirmation: 'ENABLE_SIGNED_PROVIDER_PLUGIN' }),
  }),
  disableProviderPlugin: (id: string, expectedRevision: number): Promise<ProviderPluginRecord> => request(`/api/v2/provider-plugins/${id}/disable`, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  }),
  startExport: (input: ExportRequest): Promise<GenerationTask> => request('/api/v2/exports', { method: 'POST', body: JSON.stringify(input) }),
  tasks: (projectId: string): Promise<GenerationTask[]> => request(`/api/v2/projects/${projectId}/tasks`),
  task: (taskId: string): Promise<GenerationTask> => request(`/api/v2/tasks/${taskId}`),
  cancelTask: (taskId: string): Promise<GenerationTask> => request(`/api/v2/tasks/${taskId}/cancel`, { method: 'POST' }),
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
    const current = await getSession()
    const response = await fetch(`${current.apiBaseUrl}/api/v2/media/${projectId}/${encodeURIComponent(locator)}`, { headers: { authorization: `Bearer ${current.sessionToken}` } })
    if (!response.ok) throw new Error('MEDIA_LOAD_FAILED')
    return await response.blob()
  },
}
