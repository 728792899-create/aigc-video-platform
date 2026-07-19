import { createHash, randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  AgentApprovalSchema,
  AgentRunCheckpointSchema,
  ArtifactVersionSchema,
  CandidateBatchSchema,
  CandidateSchema,
  ExportRequestSchema,
  GenerationTaskSchema,
  MediaReferenceSchema,
  BoundaryFrameSchema,
  ShotSchema,
  PromptRunSchema,
  PromptPackInventorySchema,
  ProviderMediaReceiptSchema,
  ProviderReceiptRecordSchema,
  ReviewDecisionSchema,
  ScopedPromptBindingSchema,
  ScopedRegenerationRequestSchema,
  ScopedRegenerationResultSchema,
  TaskAttemptSchema,
  type AgentApproval,
  type AgentRunCheckpoint,
  type ArtifactVersion,
  type AssetUnit,
  type AssetVariant,
  type CandidateBatch,
  type Candidate,
  type BoundaryFrame,
  type ExecutionPlan,
  type ExportRequest,
  type GenerationTask,
  type GraphCommand,
  type GraphProjection,
  type JsonObject,
  type MediaReference,
  type ProjectSnapshot,
  type PromptRun,
  type PromptPackInventory,
  type PromptRevision,
  type ProviderReceiptRecord,
  type ReviewDecision,
  type Scene,
  type ScopedRegenerationRequest,
  type ScopedRegenerationResult,
  type SourceDocument,
  type StoryEvent,
  type StoryEventEdge,
  type Shot,
  type TaskAttempt,
} from '@aigc-director/contracts'
import {
  asDirectorJsonObject,
  compileDirectorPrompt,
  createDemoPackProvider,
  createDeterministicDirectorPlan,
  demoProviderProfileRef,
  issueApproval,
  loadDirectorPromptPack,
  parseDirectorPromptOutput,
  PROMPT_PACK_PACKAGE,
  resolveDemoModelSelection,
  verifyApproval,
} from '@aigc-director/agents'
import { createAdaptationArtifacts, extractStoryDeterministically, linkPreviousEndFrame, nowIso, projectGraph, propagateStaleFields, sha256, validateStoryGraph } from '@aigc-director/domain'
import { exportProjectVideo, extractLastVideoFrame, previewMediaResolution } from '@aigc-director/media'
import { getModel } from '@aigc-director/model-catalog'
import { FakeProvider, type ProviderMediaInput } from '@aigc-director/providers'
import type { DirectorDatabase } from '../db/database.js'
import type { AgentCheckpointContext } from './memoryService.js'

export interface TaskEvent { task: GenerationTask }

const DEMO_WORKFLOW = { id: 'workflow.one_click_short_video', version: '1.0.0' } as const

interface DemoDirectorStage {
  stageId: string
  promptId: string
  artifactType: string
  taskType: GenerationTask['type']
  skills: Array<{ id: string; version: string }>
}

const DEMO_DIRECTOR_STAGES: readonly DemoDirectorStage[] = [
  { stageId: 'brief', promptId: 'intent.normalize', artifactType: 'CreativeBrief', taskType: 'adaptation', skills: [{ id: 'production.vertical-short', version: '1.0.0' }] },
  { stageId: 'outline', promptId: 'story.expand', artifactType: 'StoryOutline', taskType: 'adaptation', skills: [{ id: 'story.genre.mystery', version: '1.0.0' }] },
  { stageId: 'script', promptId: 'script.structure', artifactType: 'ScriptRevision', taskType: 'adaptation', skills: [{ id: 'production.novel-adaptation', version: '1.0.0' }] },
  { stageId: 'entities', promptId: 'entity.extract', artifactType: 'EntityCandidates', taskType: 'asset', skills: [{ id: 'production.character-consistency', version: '1.0.0' }] },
  { stageId: 'style', promptId: 'style.analyze', artifactType: 'StyleAnalysis', taskType: 'asset', skills: [{ id: 'art.style.cinematic-realism', version: '1.0.0' }] },
  { stageId: 'shots', promptId: 'shot.plan', artifactType: 'ShotPlan', taskType: 'adaptation', skills: [{ id: 'production.vertical-short', version: '1.0.0' }, { id: 'production.spatial-continuity', version: '1.0.0' }] },
  { stageId: 'characters', promptId: 'asset.character_refine', artifactType: 'CharacterVariants', taskType: 'asset', skills: [{ id: 'production.character-consistency', version: '1.0.0' }] },
  { stageId: 'locations', promptId: 'asset.location_refine', artifactType: 'LocationVariants', taskType: 'asset', skills: [{ id: 'production.spatial-continuity', version: '1.0.0' }] },
  { stageId: 'props', promptId: 'asset.prop_refine', artifactType: 'PropVariants', taskType: 'asset', skills: [{ id: 'production.prop-continuity', version: '1.0.0' }] },
  { stageId: 'continuity', promptId: 'continuity.snapshot', artifactType: 'ContinuitySnapshot', taskType: 'adaptation', skills: [{ id: 'production.character-consistency', version: '1.0.0' }, { id: 'production.spatial-continuity', version: '1.0.0' }, { id: 'production.prop-continuity', version: '1.0.0' }] },
  { stageId: 'frames', promptId: 'frame.compose', artifactType: 'FramePlans', taskType: 'image', skills: [{ id: 'production.vertical-short', version: '1.0.0' }, { id: 'art.style.cinematic-realism', version: '1.0.0' }] },
]

export class DirectorService {
  private readonly provider = new FakeProvider()
  private readonly controllers = new Map<string, AbortController>()
  private readonly taskWaiters = new Map<string, Promise<void>>()

  constructor(
    readonly db: DirectorDatabase,
    readonly dataDirectory: string,
    private readonly emitTask: (event: TaskEvent) => void = () => undefined,
    private readonly createPackProvider: () => ReturnType<typeof createDemoPackProvider> = () => createDemoPackProvider(),
  ) {}

  async promptPackInventory(): Promise<{ prompts: unknown[]; skills: unknown[]; workflows: unknown[] }> {
    const registry = await loadDirectorPromptPack()
    return { prompts: registry.prompts, skills: registry.skills, workflows: registry.workflows }
  }

  async runtimePromptPackInventory(): Promise<PromptPackInventory> {
    const registry = await loadDirectorPromptPack()
    return PromptPackInventorySchema.parse({
      package: PROMPT_PACK_PACKAGE,
      prompts: registry.prompts.map(({ id, version, title, stage, status, contentHash }) => ({ id, version, title, stage, status, contentHash })),
      skills: registry.skills.map(({ id, version, title, family, trustLevel, contentHash }) => ({ id, version, title, family, trustLevel, contentHash })),
      workflows: registry.workflows.map(({ id, version, title, steps }) => ({ id, version, title, stepCount: steps.length })),
      providerProfileCount: registry.providerProfiles.length,
    })
  }

  importSource(
    projectId: string,
    input: { title: string; content: string; language?: string },
    idempotency?: { idempotencyKey: string; fingerprint: string },
  ): ProjectSnapshot {
    const project = this.db.getProject(projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')
    if (idempotency) {
      const cached = this.db.getIdempotent<{ sourceId: string; fingerprint: string }>(idempotency.idempotencyKey)
      if (cached) {
        if (cached.fingerprint !== idempotency.fingerprint) throw new Error('SOURCE_IMPORT_COMMIT_CONFLICT')
        if (!this.db.get<SourceDocument>('source_documents', cached.sourceId)) throw new Error('SOURCE_IMPORT_IDEMPOTENCY_CORRUPT')
        return this.db.snapshot(projectId)
      }
    }
    const timestamp = nowIso()
    const source: SourceDocument = {
      id: randomUUID(), projectId, title: input.title.trim(), content: input.content,
      language: input.language ?? 'zh-CN', contentHash: sha256(input.content), revision: 1,
      createdAt: timestamp, updatedAt: timestamp,
    }
    const extracted = extractStoryDeterministically(source)
    const validation = validateStoryGraph(extracted.events, extracted.edges)
    if (!validation.valid) throw new Error(`STORY_GRAPH_INVALID:${validation.issues.join('|')}`)
    this.db.transaction(() => {
      this.db.put('source_documents', projectId, source)
      this.db.putMany('chapters', projectId, extracted.chapters)
      this.db.putMany('story_events', projectId, extracted.events)
      this.db.putMany('story_event_edges', projectId, extracted.edges)
      if (idempotency) this.db.saveIdempotent(projectId, idempotency.idempotencyKey, 'source-import', { sourceId: source.id, fingerprint: idempotency.fingerprint })
      this.db.bumpGraphRevision(projectId)
    })
    return this.db.snapshot(projectId)
  }

  graph(projectId: string, view: GraphProjection['view']): GraphProjection {
    const snapshot = this.db.snapshot(projectId)
    const projection = projectGraph(snapshot, view)
    const layout = this.db.getLayout(projectId, view)
    return {
      ...projection,
      nodes: projection.nodes.map((node) => ({ ...node, position: layout[node.id] ?? node.position })),
    }
  }

  createPlan(projectId: string, idempotencyKey: string, context: AgentCheckpointContext): { plan: ExecutionPlan; approvalToken: string; checkpoint: AgentRunCheckpoint } {
    const project = this.db.getProject(projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')
    const events = this.db.list('story_events', projectId)
    if (events.length === 0) throw new Error('PLAN_REQUIRES_EVENTS')
    const cached = this.db.getIdempotent<{ planId: string }>(idempotencyKey)
    const cachedPlan = cached ? this.db.get<ExecutionPlan>('execution_plans', cached.planId) : undefined
    const basePlan = cachedPlan?.checkpointRevision === project.graphRevision && cachedPlan.status === 'awaiting_approval'
      ? cachedPlan
      : createDeterministicDirectorPlan(projectId, project.graphRevision)
    const existingCheckpoint = this.db.getAgentRunCheckpoint(basePlan.runId)
    const plan: ExecutionPlan = existingCheckpoint
      ? basePlan
      : { ...basePlan, memoryContextHash: context.memoryContextHash, memoryCitationCount: context.memoryCitations.length }
    const checkpoint = existingCheckpoint ?? AgentRunCheckpointSchema.parse({
      id: randomUUID(), projectId, runId: plan.runId, planId: plan.id, graphRevision: plan.checkpointRevision,
      memoryQuery: context.memoryQuery, memoryCitations: context.memoryCitations, memoryContextHash: context.memoryContextHash,
      inputArtifactHashes: context.inputArtifactHashes, createdAt: plan.createdAt,
    })
    const ticket = issueApproval(plan)
    const approval: AgentApproval = AgentApprovalSchema.parse({
      id: ticket.id, runId: ticket.runId, planId: ticket.planId, checkpointRevision: ticket.checkpointRevision,
      tokenHash: ticket.tokenHash, status: 'pending', expiresAt: ticket.expiresAt, createdAt: nowIso(),
    })
    this.db.transaction(() => {
      for (const existing of this.db.list<AgentApproval>('agent_approvals', projectId).filter((item) => item.planId === plan.id && item.status === 'pending')) {
        this.db.put('agent_approvals', projectId, { ...existing, status: 'expired' })
      }
      this.db.put('execution_plans', projectId, plan)
      this.db.put('agent_approvals', projectId, approval)
      this.db.putAgentRunCheckpoint(checkpoint)
      this.db.saveIdempotent(projectId, idempotencyKey, 'create_plan', { planId: plan.id })
    })
    return { plan, approvalToken: ticket.token, checkpoint }
  }

  approvePlan(planId: string, token: string): ProjectSnapshot {
    const plan = this.db.get<ExecutionPlan>('execution_plans', planId)
    if (!plan) throw new Error('PLAN_NOT_FOUND')
    const project = this.db.getProject(plan.projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')
    const approval = this.db.list<AgentApproval>('agent_approvals', plan.projectId).filter((item) => item.planId === planId && item.status === 'pending').at(-1)
    if (!approval) throw new Error('APPROVAL_NOT_FOUND')
    const checkpoint = this.db.getAgentRunCheckpointByPlan(plan.id)
    if (plan.memoryContextHash && (!checkpoint || checkpoint.memoryContextHash !== plan.memoryContextHash || checkpoint.graphRevision !== plan.checkpointRevision)) {
      throw new Error('AGENT_CHECKPOINT_INVALID')
    }
    const verification = verifyApproval(
      { id: approval.id, runId: approval.runId, planId: approval.planId, checkpointRevision: approval.checkpointRevision, tokenHash: approval.tokenHash, expiresAt: approval.expiresAt },
      token,
      project.graphRevision,
      approval.status === 'consumed',
    )
    if (!verification.valid) throw new Error(verification.reason ?? 'APPROVAL_INVALID')
    const events = this.db.list<StoryEvent>('story_events', plan.projectId)
    const artifacts = createAdaptationArtifacts(plan.projectId, events)
    const timestamp = nowIso()
    const approvedPlan: ExecutionPlan = { ...plan, status: 'approved', steps: plan.steps.map((step) => ({ ...step, status: step.risk === 'export' ? 'pending' : 'approved' })), updatedAt: timestamp }
    const consumed: AgentApproval = { ...approval, status: 'consumed', consumedAt: timestamp }
    this.db.transaction(() => {
      this.db.putMany('scenes', plan.projectId, artifacts.scenes)
      this.db.putMany('shots', plan.projectId, artifacts.shots)
      this.db.put('execution_plans', plan.projectId, approvedPlan)
      this.db.put('agent_approvals', plan.projectId, consumed)
      this.createDefaultAssets(plan.projectId)
      this.db.bumpGraphRevision(plan.projectId)
    })
    return this.db.snapshot(plan.projectId)
  }

  private createDefaultAssets(projectId: string): void {
    if (this.db.list<AssetUnit>('assets', projectId).length > 0) return
    const timestamp = nowIso()
    const definitions: Array<{ type: AssetUnit['type']; name: string; description: string }> = [
      { type: 'character', name: '主角身份锚点', description: '从已批准事件提取的主角占位身份；Demo 中保持服装、发型和体态连续。' },
      { type: 'scene', name: '主场景空间锚点', description: '从原著章节建立的空间占位；Demo 中保持入口、光向和背景结构连续。' },
      { type: 'prop', name: '关键道具状态锚点', description: '记录跨镜头道具的持有方、左右关系和状态变化。' },
      { type: 'style', name: '原创电影感', description: '冷暖对比、克制构图和连续空间光线。' },
      { type: 'voice', name: 'Demo 旁白', description: '本地静音测试音轨，不调用 TTS。' },
      { type: 'music', name: 'Demo 氛围', description: '本地静音占位，用于验证时间线。' },
    ]
    for (const definition of definitions) {
      const assetId = randomUUID()
      const variantId = randomUUID()
      const asset: AssetUnit = {
        id: assetId, projectId, logicalId: assetId, type: definition.type, scope: 'episode', name: definition.name, description: definition.description,
        metadata: { demo: true, license: 'internally-generated-fixture' }, selectedVariantId: variantId, revision: 1, archived: false,
        createdAt: timestamp, updatedAt: timestamp,
      }
      const variant: AssetVariant = {
        id: variantId, assetId, revision: 1, label: '默认版本', prompt: definition.description,
        metadata: { demo: true }, favorite: false, archived: false, createdAt: timestamp,
      }
      this.db.put('assets', projectId, asset)
      this.db.put('asset_variants', projectId, variant)
    }
  }

  async runDemoProduction(projectId: string, idempotencyKey: string): Promise<ProjectSnapshot> {
    const cached = this.db.getIdempotent<{ completed: true }>(idempotencyKey)
    if (cached) return this.db.snapshot(projectId)
    await this.runDemoDirectorStages(projectId, idempotencyKey)
    const snapshot = this.db.snapshot(projectId)
    if (snapshot.shots.length === 0) throw new Error('PRODUCTION_REQUIRES_SHOTS')
    await mkdir(join(this.dataDirectory, 'media', projectId), { recursive: true })
    let previousShot: Shot | undefined
    for (const snapshotShot of snapshot.shots) {
      let shot = this.db.get<Shot>('shots', snapshotShot.id) ?? snapshotShot
      const batchKey = `candidate-batch:${sha256(JSON.stringify({ root: idempotencyKey, shotId: shot.id, model: 'demo-frame-v1', quantity: 2 }))}`
      let batch = this.db.list<CandidateBatch>('candidate_batches', projectId).find((candidateBatch) => candidateBatch.idempotencyKey === batchKey)
      if (!batch) {
        const timestamp = nowIso()
        batch = CandidateBatchSchema.parse({
          id: randomUUID(), projectId, shotId: shot.id, kind: 'image', modelId: 'demo-frame-v1',
          idempotencyKey: batchKey, quantity: 2, maxConcurrent: 1, status: 'running', completedCount: 0, failedCount: 0,
          parametersSnapshot: { variants: [1, 2], productionRunKey: idempotencyKey }, source: 'demo-production',
          createdAt: timestamp, updatedAt: timestamp,
        })
        this.db.put('candidate_batches', projectId, batch)
      } else if (batch.status !== 'succeeded') {
        batch = CandidateBatchSchema.parse({ ...batch, status: 'running', finishedAt: undefined, updatedAt: nowIso() })
        this.db.put('candidate_batches', projectId, batch)
      }
      if (previousShot && !shot.boundaryFrames.some((frame) => frame.role === 'start')) {
        shot = linkPreviousEndFrame(shot, previousShot, { propagateStale: false })
        this.db.put('shots', projectId, shot)
      }
      for (const variant of [1, 2] as const) {
        const existingCandidate = this.db.list<Candidate>('candidates', projectId).find((candidate) => (
          candidate.shotId === shot.id
          && candidate.inputSnapshot.productionRunKey === idempotencyKey
          && candidate.inputSnapshot.variant === variant
        ))
        if (existingCandidate?.mediaId) {
          const existingMedia = this.db.get<MediaReference>('media_references', existingCandidate.mediaId)
          if (existingMedia) {
            const candidateWithBatch = CandidateSchema.parse({
              ...existingCandidate, batchId: batch.id,
              inputSnapshot: { ...existingCandidate.inputSnapshot, batchId: batch.id },
            })
            this.db.put('candidates', projectId, candidateWithBatch)
            shot = this.attachCandidateBoundary(shot, candidateWithBatch, existingMedia, variant === 1 ? 'start' : 'end')
            this.db.put('shots', projectId, shot)
            continue
          }
        }
        const boundaryFrames = shot.boundaryFrames.map((frame) => ({ ...frame }))
        const boundaryInputs = this.resolveBoundaryMediaInputs(projectId, boundaryFrames)
        const mediaResolution = previewMediaResolution(projectId, getModel('demo-frame-v1'), boundaryInputs.map((input) => ({
          role: input.role, order: input.order, media: input.media,
        })))
        if (!mediaResolution.supported) throw new Error(mediaResolution.issues[0] ?? 'MEDIA_RESOLUTION_UNSUPPORTED')
        const mediaInputOrder = snapshot.assets
          .filter((asset) => asset.selectedVariantId)
          .map((asset) => `${asset.type}:${asset.id}:${asset.selectedVariantId}`)
          .concat(boundaryInputs.map((item) => `${item.role}:${item.media.id}:${item.media.sha256}`))
        const promptRun = await this.prepareImagePromptRun(projectId, shot, variant, mediaInputOrder)
        const taskKey = `image:${sha256(JSON.stringify({
          root: idempotencyKey,
          shotId: shot.id,
          shotRevision: shot.revision,
          variant,
          compiledHash: promptRun.compiledHash,
          provider: promptRun.providerProfile,
          model: promptRun.modelSnapshot,
          mediaInputOrder,
        }))}`
        const task = this.createTask({
          projectId,
          type: 'image',
          stage: `镜头 ${shot.ordinal + 1} · Demo 候选 ${variant}`,
          idempotencyKey: taskKey,
          promptRunId: promptRun.id,
          providerProfileVersion: promptRun.providerProfile.version,
          modelCapabilitySnapshot: promptRun.modelSnapshot,
          mediaInputOrder,
          inputSnapshot: {
            shotId: shot.id, shotRevision: shot.revision, variant, compiledHash: promptRun.compiledHash,
            productionRunKey: idempotencyKey, batchId: batch.id, boundaryFrames,
            mediaResolution: { modelId: mediaResolution.modelId, transmission: mediaResolution.transmission, totalBytes: mediaResolution.totalBytes },
          },
        })
        if (task.status === 'succeeded') {
          const completedCandidate = this.db.list<Candidate>('candidates', projectId).find((candidate) => candidate.taskId === task.id)
          const completedMedia = completedCandidate?.mediaId ? this.db.get<MediaReference>('media_references', completedCandidate.mediaId) : undefined
          if (completedCandidate && completedMedia) {
            shot = this.attachCandidateBoundary(shot, completedCandidate, completedMedia, variant === 1 ? 'start' : 'end')
            this.db.put('shots', projectId, shot)
            continue
          }
        }
        const running: GenerationTask = { ...task, status: 'running', startedAt: nowIso(), updatedAt: nowIso(), progress: 0.1 }
        this.saveTask(running)
        try {
          const accepted = await this.executePromptPackFakeTask(running, promptRun)
          const { candidate, media } = await this.materializeDemoCandidate(accepted, promptRun)
          const frameArtifact = this.db.list<ArtifactVersion>('artifact_versions', projectId)
            .filter((artifact) => artifact.stageId === 'frames')
            .sort((left, right) => right.revision - left.revision)[0]
          this.persistArtifactVersion({
            projectId,
            stageId: `image-prompt:${shot.id}:${variant}`,
            artifactType: 'ImagePromptRun',
            scope: { type: 'shot', id: shot.id },
            promptRunId: promptRun.id,
            dependencies: frameArtifact ? [frameArtifact] : [],
            content: {
              shotId: shot.id,
              variant,
              compiledHash: promptRun.compiledHash,
              zhReview: promptRun.compiled.zhReview,
              enPrompt: promptRun.compiled.enExecution,
              mediaInputOrder,
            },
            status: 'approved',
          })
          this.db.transaction(() => {
            this.db.put('media_references', projectId, media)
            this.db.put('candidates', projectId, candidate)
            for (const receipt of mediaResolution.receipts) {
              this.db.put('provider_media_receipts', projectId, ProviderMediaReceiptSchema.parse({
                ...receipt, taskId: candidate.taskId, candidateId: candidate.id,
              }))
            }
            shot = this.attachCandidateBoundary(shot, candidate, media, variant === 1 ? 'start' : 'end')
            this.db.put('shots', projectId, shot)
            this.db.put('prompt_runs', projectId, { ...promptRun, status: 'succeeded', updatedAt: nowIso() })
            this.saveTask({ ...accepted, status: 'succeeded', progress: 1, retryable: false, result: { candidateId: candidate.id, mediaId: media.id, billed: false, promptRunId: promptRun.id, reconciled: accepted.providerTaskId === undefined }, updatedAt: nowIso(), finishedAt: nowIso() })
          })
        } catch (error) {
          this.db.put('prompt_runs', projectId, { ...promptRun, status: 'failed', updatedAt: nowIso() })
          const failed = this.failedTask(running, error)
          this.saveTask(failed)
          this.refreshCandidateBatch(batch.id, true)
          throw error
        }
      }
      this.refreshCandidateBatch(batch.id, true)
      previousShot = this.db.get<Shot>('shots', shot.id) ?? shot
    }
    await this.runDemoCandidateCritics(projectId, idempotencyKey)
    this.db.transaction(() => {
      this.db.saveIdempotent(projectId, idempotencyKey, 'demo_production', { completed: true })
      this.db.bumpGraphRevision(projectId)
    })
    return this.db.snapshot(projectId)
  }

  async runScopedRegeneration(
    projectId: string,
    rawRequest: ScopedRegenerationRequest,
    compiled: { zhReview: string; enExecution: string; compiledHash: string },
  ): Promise<ScopedRegenerationResult> {
    const request = ScopedRegenerationRequestSchema.parse(rawRequest)
    const project = this.db.getProject(projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')
    const revision = this.db.getPromptRevision(request.promptRevisionId)
    if (!revision || (revision.projectId !== undefined && revision.projectId !== projectId)) throw new Error('PROMPT_REVISION_NOT_FOUND')
    if (revision.status !== 'published') throw new Error('PROMPT_REVISION_NOT_PUBLISHED')
    const target = this.scopedRegenerationTarget(projectId, request)
    const binding = ScopedPromptBindingSchema.parse({
      promptRevisionId: revision.id,
      stableKey: revision.stableKey,
      promptRevision: revision.revision,
      promptContentHash: revision.contentHash,
      targetType: request.targetType,
      targetId: request.targetId,
      targetRevision: target.revision,
      projectGraphRevision: project.graphRevision,
    })
    const taskKey = `scoped-regenerate:${sha256(request.idempotencyKey)}`
    const prior = this.db.list<GenerationTask>('generation_tasks', projectId)
      .filter((task) => task.idempotencyKey === taskKey)
      .sort((left, right) => right.attempt - left.attempt)[0]
    if (prior) {
      const parsedBinding = ScopedPromptBindingSchema.safeParse(prior.inputSnapshot.promptBinding)
      const priorIdentity = parsedBinding.success ? { ...parsedBinding.data, projectGraphRevision: binding.projectGraphRevision } : undefined
      const variablesHash = sha256(JSON.stringify(request.variables))
      if (!priorIdentity || JSON.stringify(priorIdentity) !== JSON.stringify(binding) || prior.inputSnapshot.variablesHash !== variablesHash) throw new Error('IDEMPOTENCY_PAYLOAD_CONFLICT')
      if (prior.status === 'succeeded') return this.scopedRegenerationResult(prior)
      if (['queued', 'running', 'retrying', 'reconciling'].includes(prior.status)) throw new Error('SCOPED_REGENERATION_IN_PROGRESS')
    }

    const promptRun = this.prepareScopedPromptRun(projectId, revision, binding, request.variables, compiled)
    const snapshot = this.db.snapshot(projectId)
    const shot = request.targetType === 'shot' ? target as Shot : undefined
    const mediaInputOrder = shot ? snapshot.resolvedAssets
      .map((asset) => `${asset.type}:${asset.assetId}:${asset.variantId}`) : []
    const task = this.createTask({
      projectId,
      type: shot ? 'image' : 'adaptation',
      stage: `局部重生成 · ${request.targetType} · ${revision.stableKey}@r${revision.revision}`,
      idempotencyKey: taskKey,
      promptRunId: promptRun.id,
      providerProfileVersion: promptRun.providerProfile.version,
      model: promptRun.modelSnapshot.modelId,
      modelCapabilitySnapshot: promptRun.modelSnapshot,
      ...(mediaInputOrder.length > 0 ? { mediaInputOrder } : {}),
      inputSnapshot: {
        promptBinding: binding,
        variablesHash: sha256(JSON.stringify(request.variables)),
        compiledHash: promptRun.compiledHash,
        ...(shot ? { shotId: shot.id, shotRevision: shot.revision, variant: 1, boundaryFrames: shot.boundaryFrames, mediaInputOrder } : {}),
      },
    })
    const running: GenerationTask = { ...task, status: 'running', startedAt: task.startedAt ?? nowIso(), progress: 0.1, updatedAt: nowIso() }
    this.saveTask(running)
    try {
      const accepted = await this.executePromptPackFakeTask(running, promptRun)
      const artifact = this.persistArtifactVersion({
        projectId,
        stageId: `scoped-regeneration:${request.targetType}:${request.targetId}`,
        artifactType: shot ? 'ImagePromptRun' : request.targetType === 'event' ? 'EventAdaptationRevision' : 'SceneScriptRevision',
        scope: { type: request.targetType, id: request.targetId },
        promptRunId: promptRun.id,
        dependencies: [],
        content: asDirectorJsonObject({ promptBinding: binding, zhReview: compiled.zhReview, enExecution: compiled.enExecution }),
        status: 'approved',
      }, false)
      let candidate: Candidate | undefined
      let candidateMedia: MediaReference | undefined
      if (shot) {
        const materialized = await this.materializeDemoCandidate(accepted, promptRun)
        candidateMedia = materialized.media
        candidate = CandidateSchema.parse({ ...materialized.candidate, promptRevisionId: revision.id, label: `局部候选 · r${revision.revision}` })
      }
      const completed: GenerationTask = {
        ...accepted,
        status: 'succeeded',
        progress: 1,
        retryable: false,
        result: { artifactVersionId: artifact.id, ...(candidate ? { candidateId: candidate.id, mediaId: candidate.mediaId } : {}), billed: false, promptRunId: promptRun.id },
        updatedAt: nowIso(),
        finishedAt: nowIso(),
      }
      this.db.transaction(() => {
        this.db.put('artifact_versions', projectId, artifact)
        if (candidateMedia) this.db.put('media_references', projectId, candidateMedia)
        if (candidate) this.db.put('candidates', projectId, candidate)
        this.db.put('prompt_runs', projectId, { ...promptRun, status: 'succeeded', updatedAt: nowIso() })
        this.saveTask(completed)
        this.db.bumpGraphRevision(projectId)
      })
      return ScopedRegenerationResultSchema.parse({ task: completed, artifact, ...(candidate ? { candidate } : {}) })
    } catch (error) {
      this.db.put('prompt_runs', projectId, { ...promptRun, status: 'failed', updatedAt: nowIso() })
      this.saveTask(this.failedTask(running, error))
      throw error
    }
  }

  private async runDemoDirectorStages(projectId: string, rootIdempotencyKey: string): Promise<void> {
    const snapshot = this.db.snapshot(projectId)
    let previousArtifact: ArtifactVersion | undefined
    for (const stage of DEMO_DIRECTOR_STAGES) {
      const output = this.buildDemoStageOutput(stage, snapshot)
      const promptRun = await this.prepareStructuredPromptRun(stage, snapshot, output)
      const existingArtifact = this.db.list<ArtifactVersion>('artifact_versions', projectId)
        .find((artifact) => artifact.stageId === stage.stageId && artifact.promptRunId === promptRun.id)
      if (existingArtifact) {
        previousArtifact = existingArtifact
        continue
      }
      const task = this.createTask({
        projectId,
        type: stage.taskType,
        stage: `${stage.stageId} · ${stage.artifactType}`,
        idempotencyKey: `director-stage:${sha256(JSON.stringify({ rootIdempotencyKey, stage: stage.stageId, compiledHash: promptRun.compiledHash }))}`,
        promptRunId: promptRun.id,
        providerProfileVersion: promptRun.providerProfile.version,
        model: promptRun.modelSnapshot.modelId,
        modelCapabilitySnapshot: promptRun.modelSnapshot,
        inputSnapshot: { stageId: stage.stageId, compiledHash: promptRun.compiledHash, workflow: DEMO_WORKFLOW },
      })
      const running: GenerationTask = { ...task, status: 'running', startedAt: task.startedAt ?? nowIso(), progress: 0.1, updatedAt: nowIso() }
      this.saveTask(running)
      try {
        const accepted = await this.executePromptPackFakeTask(running, promptRun)
        const parsedOutput = await parseDirectorPromptOutput({ id: stage.promptId, version: '1.0.0' }, output)
        const artifact = this.persistArtifactVersion({
          projectId,
          stageId: stage.stageId,
          artifactType: stage.artifactType,
          scope: { type: 'project', id: projectId },
          promptRunId: promptRun.id,
          dependencies: previousArtifact ? [previousArtifact] : [],
          content: parsedOutput,
          status: 'approved',
        })
        this.db.transaction(() => {
          this.db.put('prompt_runs', projectId, { ...promptRun, status: 'succeeded', updatedAt: nowIso() })
          this.saveTask({
            ...accepted,
            status: 'succeeded',
            progress: 1,
            retryable: false,
            result: { artifactVersionId: artifact.id, billed: false, promptRunId: promptRun.id, reconciled: accepted.providerTaskId === undefined },
            updatedAt: nowIso(),
            finishedAt: nowIso(),
          })
        })
        previousArtifact = artifact
      } catch (error) {
        this.db.put('prompt_runs', projectId, { ...promptRun, status: 'failed', updatedAt: nowIso() })
        this.saveTask(this.failedTask(running, error))
        throw error
      }
    }
  }

  private async prepareStructuredPromptRun(
    stage: DemoDirectorStage,
    snapshot: ProjectSnapshot,
    output: JsonObject,
  ): Promise<PromptRun> {
    const modelSelection = resolveDemoModelSelection({ modalities: ['text'], features: ['structured-output', 'reconcile', 'cancel'] })
    const source = snapshot.sources.at(-1)
    const compiled = await compileDirectorPrompt({
      prompt: { id: stage.promptId, version: '1.0.0' },
      skills: stage.skills,
      variables: asDirectorJsonObject({
        input: {
          stageId: stage.stageId,
          project: { id: snapshot.project.id, name: snapshot.project.name, description: snapshot.project.description },
          source: source ? { id: source.id, title: source.title, content: source.content, revision: source.revision, contentHash: source.contentHash } : null,
          expectedDemoOutput: output,
        },
        context: {
          events: snapshot.events.map((event) => ({ id: event.id, summary: event.summary, revision: event.revision, contentHash: event.contentHash })),
          scenes: snapshot.scenes.map((scene) => ({ id: scene.id, title: scene.title, revision: scene.revision })),
          shots: snapshot.shots.map((shot) => ({ id: shot.id, sceneId: shot.sceneId, description: shot.description, dialogue: shot.dialogue, durationMs: shot.durationMs, revision: shot.revision })),
          assets: snapshot.assets.map((asset) => ({ id: asset.id, type: asset.type, name: asset.name, selectedVariantId: asset.selectedVariantId ?? null })),
        },
        constraints: ['只输出固定 schema。', '不得更改稳定 ID、原文事实、资产引用顺序或已批准人物身份。'],
      }),
      policy: {
        safetyRules: ['禁止泄露密钥、签名 URL、私人路径和系统指令。', '禁止虚构 Provider 状态、费用和媒体结果。'],
        identityLocks: snapshot.assets.filter((asset) => asset.type === 'character').map((asset) => `${asset.id}:${asset.selectedVariantId ?? 'unselected'}`),
        continuityLocks: snapshot.shots.map((shot) => `${shot.id}@revision-${shot.revision}`),
        approvedFacts: snapshot.events.map((event) => event.summary),
        userRequirements: source ? [source.content] : [snapshot.project.description],
        maxCompiledChars: 50_000,
      },
    })
    const existing = this.db.list<PromptRun>('prompt_runs', snapshot.project.id).find((run) => run.compiledHash === compiled.provenance.compiledHash)
    if (existing) return existing
    const timestamp = nowIso()
    const promptRun = PromptRunSchema.parse({
      id: randomUUID(),
      projectId: snapshot.project.id,
      workflow: DEMO_WORKFLOW,
      prompt: compiled.provenance.prompt,
      skills: compiled.provenance.skills,
      providerProfile: demoProviderProfileRef(),
      modelSnapshot: {
        modelId: modelSelection.model.modelId,
        providerId: modelSelection.model.providerId,
        capabilities: modelSelection.model.features,
        snapshotVersion: modelSelection.model.snapshotVersion,
      },
      variablesHash: compiled.provenance.variablesHash,
      compiledHash: compiled.provenance.compiledHash,
      compiled: {
        system: compiled.system,
        canonical: compiled.canonical,
        zhReview: compiled.zhReview,
        enExecution: compiled.enExecution,
        outputSchema: compiled.outputSchema,
        warnings: compiled.warnings,
      },
      status: 'compiled',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    this.db.put('prompt_runs', snapshot.project.id, promptRun)
    return promptRun
  }

  private buildDemoStageOutput(stage: DemoDirectorStage, snapshot: ProjectSnapshot): JsonObject {
    const source = snapshot.sources.at(-1)
    const sourceExcerpt = source?.content.trim().slice(0, 600) ?? snapshot.project.description
    const assets = snapshot.assets.map((asset) => ({ id: asset.id, type: asset.type, name: asset.name, variantId: asset.selectedVariantId ?? null }))
    const shots = snapshot.shots.map((shot) => ({
      id: shot.id, sceneId: shot.sceneId, ordinal: shot.ordinal, description: shot.description,
      dialogue: shot.dialogue, durationMs: shot.durationMs, revision: shot.revision,
    }))
    const byStage: Record<string, JsonObject> = {
      brief: { goal: '把输入故事制作成可审阅、可恢复的竖屏短视频', language: source?.language ?? 'zh-CN', sourceExcerpt, targetDurationSeconds: Math.max(1, Math.round(snapshot.shots.reduce((sum, shot) => sum + shot.durationMs, 0) / 1_000)), aspectRatio: '9:16' },
      outline: { chapters: snapshot.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, summary: chapter.summary })), events: snapshot.events.map((event) => ({ id: event.id, title: event.title, summary: event.summary, order: event.narrativeOrder })) },
      script: { revision: 1, scenes: snapshot.scenes.map((scene) => ({ id: scene.id, eventId: scene.eventId, title: scene.title, synopsis: scene.synopsis })), shots },
      entities: { characters: assets.filter((asset) => asset.type === 'character'), locations: assets.filter((asset) => asset.type === 'scene'), props: assets.filter((asset) => asset.type === 'prop') },
      style: { style: assets.find((asset) => asset.type === 'style') ?? null, palette: ['冷蓝环境光', '暖色工作灯'], composition: '克制电影构图，竖屏主体清晰' },
      shots: { shots, totalDurationMs: snapshot.shots.reduce((sum, shot) => sum + shot.durationMs, 0) },
      characters: { variants: assets.filter((asset) => asset.type === 'character'), locks: ['服装、发型、体态和人物身份跨镜头保持一致'] },
      locations: { variants: assets.filter((asset) => asset.type === 'scene'), locks: ['入口方向、背景结构和主光方向跨镜头保持一致'] },
      props: { variants: assets.filter((asset) => asset.type === 'prop'), locks: ['持有方、左右手和道具状态按事件顺序延续'] },
      continuity: { shotOrder: shots.map((shot) => shot.id), identityLocks: assets.filter((asset) => asset.type === 'character'), spatialLocks: assets.filter((asset) => asset.type === 'scene'), propLocks: assets.filter((asset) => asset.type === 'prop') },
      frames: { frames: snapshot.shots.map((shot) => ({ shotId: shot.id, frameRole: 'keyframe', composition: shot.description, durationMs: shot.durationMs, referenceOrder: assets.map((asset) => `${asset.type}:${asset.id}:${asset.variantId ?? 'none'}`) })) },
    }
    const result = byStage[stage.stageId] ?? { stageId: stage.stageId }
    return {
      result,
      zhReview: `${stage.artifactType}：${sourceExcerpt || '本地 Demo 输入'}。所有稳定 ID、人物身份与镜头顺序保持不变。`,
      enPrompt: `Offline deterministic ${stage.artifactType}. Preserve every stable ID, identity lock, spatial relation, prop state and shot order from the approved Chinese source.`,
      assumptions: ['Demo Mode 使用确定性本地产物，不代表真实模型创作质量。'],
      issues: [],
    }
  }

  private persistArtifactVersion(input: {
    projectId: string
    stageId: string
    artifactType: string
    scope: ArtifactVersion['scope']
    promptRunId?: string
    dependencies: ArtifactVersion[]
    content: JsonObject
    status: ArtifactVersion['status']
  }, persist = true): ArtifactVersion {
    const contentHash = sha256(JSON.stringify(input.content))
    const versions = this.db.list<ArtifactVersion>('artifact_versions', input.projectId)
      .filter((artifact) => artifact.stageId === input.stageId && artifact.scope.type === input.scope.type && artifact.scope.id === input.scope.id)
      .sort((left, right) => right.revision - left.revision)
    const existing = versions.find((artifact) => artifact.contentHash === contentHash && artifact.promptRunId === input.promptRunId)
    if (existing) return existing
    const timestamp = nowIso()
    const parent = versions[0]
    const artifact = ArtifactVersionSchema.parse({
      id: randomUUID(),
      projectId: input.projectId,
      workflow: DEMO_WORKFLOW,
      stageId: input.stageId,
      artifactType: input.artifactType,
      revision: (parent?.revision ?? 0) + 1,
      ...(input.promptRunId ? { promptRunId: input.promptRunId } : {}),
      ...(parent ? { parentArtifactVersionId: parent.id } : {}),
      scope: input.scope,
      dependencies: input.dependencies.map((dependency) => ({ artifactVersionId: dependency.id, contentHash: dependency.contentHash })),
      content: input.content,
      contentHash,
      status: input.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    if (persist) this.db.put('artifact_versions', input.projectId, artifact)
    return artifact
  }

  private async runDemoCandidateCritics(projectId: string, rootIdempotencyKey: string): Promise<void> {
    const snapshot = this.db.snapshot(projectId)
    for (const shot of snapshot.shots) {
      const candidates = snapshot.candidates.filter((candidate) => candidate.shotId === shot.id)
      if (candidates.length === 0) continue
      const promptArtifacts = snapshot.artifactVersions.filter((artifact) => artifact.stageId.startsWith(`image-prompt:${shot.id}:`))
      const candidateSet = this.persistArtifactVersion({
        projectId,
        stageId: `image-candidates:${shot.id}`,
        artifactType: 'ImageCandidateSet',
        scope: { type: 'shot', id: shot.id },
        dependencies: promptArtifacts,
        content: { shotId: shot.id, candidates: candidates.map((candidate) => ({ id: candidate.id, mediaId: candidate.mediaId ?? null, taskId: candidate.taskId, status: candidate.status })) },
        status: 'draft',
      })
      const stage: DemoDirectorStage = {
        stageId: `image-review:${shot.id}`,
        promptId: 'candidate.critic',
        artifactType: 'ImageReviewDecision',
        taskType: 'adaptation',
        skills: [{ id: 'production.candidate-supervision', version: '1.0.0' }, { id: 'production.character-consistency', version: '1.0.0' }],
      }
      const output: JsonObject = {
        result: {
          shotId: shot.id,
          rankings: candidates.map((candidate, index) => ({ candidateId: candidate.id, rank: index + 1, identity: 1, continuity: 1, technicalQuality: 1, requiresHumanApproval: true })),
        },
        zhReview: `镜头“${shot.title}”的 ${candidates.length} 个本地候选通过结构与引用检查，仍需人工选择。`,
        enPrompt: `Review ${candidates.length} offline candidates for shot ${shot.id}. Preserve identity, spatial continuity, prop state and reference order; require human approval.`,
        assumptions: ['本地 SVG fixture 只验证工作流，不代表真实视觉质量评分。'],
        issues: [],
      }
      const promptRun = await this.prepareStructuredPromptRun(stage, snapshot, output)
      const existingReviewArtifact = this.db.list<ArtifactVersion>('artifact_versions', projectId).find((artifact) => artifact.stageId === stage.stageId && artifact.promptRunId === promptRun.id)
      if (existingReviewArtifact) continue
      const task = this.createTask({
        projectId,
        type: stage.taskType,
        stage: `${shot.title} · 候选质量评审`,
        idempotencyKey: `candidate-critic:${sha256(JSON.stringify({ rootIdempotencyKey, shotId: shot.id, promptRun: promptRun.compiledHash, candidateIds: candidates.map((candidate) => candidate.id) }))}`,
        promptRunId: promptRun.id,
        providerProfileVersion: promptRun.providerProfile.version,
        model: promptRun.modelSnapshot.modelId,
        modelCapabilitySnapshot: promptRun.modelSnapshot,
        inputSnapshot: { shotId: shot.id, candidateIds: candidates.map((candidate) => candidate.id), compiledHash: promptRun.compiledHash },
      })
      const running: GenerationTask = { ...task, status: 'running', startedAt: task.startedAt ?? nowIso(), progress: 0.1, updatedAt: nowIso() }
      this.saveTask(running)
      try {
        const accepted = await this.executePromptPackFakeTask(running, promptRun)
        const parsedOutput = await parseDirectorPromptOutput({ id: 'candidate.critic', version: '1.0.0' }, output)
        const reviewArtifact = this.persistArtifactVersion({
          projectId,
          stageId: stage.stageId,
          artifactType: stage.artifactType,
          scope: { type: 'shot', id: shot.id },
          promptRunId: promptRun.id,
          dependencies: [candidateSet],
          content: parsedOutput,
          status: 'draft',
        })
        this.db.transaction(() => {
          for (const candidate of candidates) {
            const existingReview = this.db.list<ReviewDecision>('review_decisions', projectId)
              .find((review) => review.candidateId === candidate.id && review.source === 'automatic_critic' && review.promptRunId === promptRun.id)
            if (!existingReview) {
              this.db.put('review_decisions', projectId, ReviewDecisionSchema.parse({
                id: randomUUID(), projectId, candidateId: candidate.id, promptRunId: promptRun.id,
                source: 'automatic_critic', decision: 'pending',
                rubric: { identity: 1, continuity: 1, technicalQuality: 1 },
                reasons: ['本地 fixture 通过结构与引用检查；最终视觉选择必须由用户确认。'],
                createdAt: nowIso(),
              }))
            }
          }
          this.db.put('prompt_runs', projectId, { ...promptRun, status: 'succeeded', updatedAt: nowIso() })
          this.saveTask({
            ...accepted,
            status: 'succeeded',
            progress: 1,
            retryable: false,
            result: { artifactVersionId: reviewArtifact.id, billed: false, promptRunId: promptRun.id, requiresHumanApproval: true, reconciled: accepted.providerTaskId === undefined },
            updatedAt: nowIso(),
            finishedAt: nowIso(),
          })
        })
      } catch (error) {
        this.db.put('prompt_runs', projectId, { ...promptRun, status: 'failed', updatedAt: nowIso() })
        this.saveTask(this.failedTask(running, error))
        throw error
      }
    }
  }

  private async materializeDemoCandidate(task: GenerationTask, promptRun: PromptRun): Promise<{ candidate: Candidate; media: MediaReference }> {
    const existing = this.db.list<Candidate>('candidates', task.projectId).find((candidate) => candidate.taskId === task.id)
    if (existing?.mediaId) {
      const media = this.db.get<MediaReference>('media_references', existing.mediaId)
      if (media) return { candidate: existing, media }
    }
    const shotId = typeof task.inputSnapshot.shotId === 'string' ? task.inputSnapshot.shotId : undefined
    const shot = shotId ? this.db.get<ProjectSnapshot['shots'][number]>('shots', shotId) : undefined
    if (!shot) throw new Error('TASK_SHOT_SNAPSHOT_INVALID')
    const variant = typeof task.inputSnapshot.variant === 'number' ? task.inputSnapshot.variant : 1
    const mediaInputOrder = Array.isArray(task.mediaInputOrder) ? task.mediaInputOrder : []
    const parsedFrames = BoundaryFrameSchema.array().safeParse(task.inputSnapshot.boundaryFrames ?? [])
    if (!parsedFrames.success) throw new Error('TASK_BOUNDARY_FRAME_SNAPSHOT_INVALID')
    const providerMedia = this.resolveBoundaryMediaInputs(task.projectId, parsedFrames.data)
    const result = await this.provider.execute(
      { model: 'demo-frame-v1', prompt: `${promptRun.compiled.zhReview}\n候选 ${variant}`, modality: 'image', media: providerMedia },
      { projectId: task.projectId, taskId: task.id, outputDirectory: join(this.dataDirectory, 'media', task.projectId), signal: new AbortController().signal },
    )
    if (!result.media) throw new Error('PROVIDER_MEDIA_MISSING')
    const batchId = typeof task.inputSnapshot.batchId === 'string' ? task.inputSnapshot.batchId : undefined
    return {
      media: result.media,
      candidate: CandidateSchema.parse({
        id: randomUUID(), projectId: task.projectId, shotId: shot.id, kind: 'image', taskId: task.id, promptRevisionId: promptRun.id, mediaId: result.media.id,
        ...(batchId ? { batchId } : {}),
        provider: result.provider, model: result.model,
        inputSnapshot: {
          promptRunId: promptRun.id,
          compiledHash: promptRun.compiledHash,
          shotRevision: task.inputSnapshot.shotRevision ?? shot.revision,
          productionRunKey: task.inputSnapshot.productionRunKey ?? null,
          variant,
          boundaryFrames: parsedFrames.data,
          mediaInputOrder,
          providerMediaOrder: Array.isArray(result.metadata.receivedMediaOrder) ? result.metadata.receivedMediaOrder : [],
        },
        parametersSnapshot: { variant }, label: `候选 ${variant}`, tags: [],
        status: 'ready', favorite: false, createdAt: nowIso(),
      }),
    }
  }

  private refreshCandidateBatch(batchId: string, finished: boolean): CandidateBatch {
    const batch = this.db.get<CandidateBatch>('candidate_batches', batchId)
    if (!batch) throw new Error('CANDIDATE_BATCH_NOT_FOUND')
    const candidates = this.db.list<Candidate>('candidates', batch.projectId).filter((candidate) => candidate.batchId === batch.id && candidate.status === 'ready')
    const tasks = this.db.list<GenerationTask>('generation_tasks', batch.projectId).filter((task) => task.inputSnapshot.batchId === batch.id)
    const failedCount = tasks.filter((task) => ['failed', 'timed_out', 'cancelled'].includes(task.status)).length
    const completedCount = candidates.length
    const status: CandidateBatch['status'] = !finished ? 'running'
      : completedCount >= batch.quantity ? 'succeeded'
        : completedCount > 0 ? 'partial'
          : failedCount > 0 ? 'failed' : 'cancelled'
    const updated = CandidateBatchSchema.parse({
      ...batch, status, completedCount, failedCount, updatedAt: nowIso(), ...(finished ? { finishedAt: nowIso() } : {}),
    })
    this.db.put('candidate_batches', batch.projectId, updated)
    return updated
  }

  private resolveBoundaryMediaInputs(projectId: string, frames: BoundaryFrame[]): ProviderMediaInput[] {
    return [...frames]
      .sort((left, right) => (left.role === 'start' ? 0 : 1) - (right.role === 'start' ? 0 : 1))
      .map((frame, order) => {
        const media = this.db.get<MediaReference>('media_references', frame.mediaId)
        if (!media || media.projectId !== projectId || media.kind !== 'image' || media.sha256 !== frame.mediaSha256) {
          throw new Error('BOUNDARY_FRAME_MEDIA_INVALID')
        }
        return { role: frame.role === 'start' ? 'first-frame' : 'last-frame', order, media }
      })
  }

  private attachCandidateBoundary(shot: Shot, candidate: Candidate, media: MediaReference, role: BoundaryFrame['role']): Shot {
    const current = shot.boundaryFrames.find((frame) => frame.role === role)
    if (role === 'start' && current) return shot
    if (current?.mediaId === media.id && current.sourceCandidateId === candidate.id) return shot
    const frame: BoundaryFrame = {
      id: randomUUID(), role, mediaId: media.id, mediaSha256: media.sha256,
      sourceShotId: shot.id, sourceCandidateId: candidate.id, sourceRevision: shot.revision,
      provenance: 'generated_candidate', createdAt: nowIso(),
    }
    return {
      ...shot,
      boundaryFrames: [...shot.boundaryFrames.filter((item) => item.role !== role), frame],
      revision: shot.revision + 1,
      staleFields: shot.staleFields,
      updatedAt: nowIso(),
    }
  }

  private async prepareImagePromptRun(
    projectId: string,
    shot: ProjectSnapshot['shots'][number],
    variant: number,
    mediaInputOrder: string[],
  ): Promise<PromptRun> {
    const modelSelection = resolveDemoModelSelection({
      modalities: ['image'],
      features: ['image-generation', 'reference-images', 'reconcile', 'cancel', ...(shot.boundaryFrames.length > 0 ? ['first-frame'] : [])],
    })
    const compiled = await compileDirectorPrompt({
      prompt: { id: 'prompt.image_assemble', version: '1.0.0' },
      skills: [
        { id: 'production.vertical-short', version: '1.0.0' },
        { id: 'production.character-consistency', version: '1.0.0' },
        { id: 'art.style.cinematic-realism', version: '1.0.0' },
      ],
      variables: {
        input: {
          shotId: shot.id,
          shotRevision: shot.revision,
          variant,
          description: shot.description,
          dialogue: shot.dialogue,
          visualPrompt: shot.visualPrompt,
          negativePrompt: shot.negativePrompt,
        },
        context: { sceneId: shot.sceneId, aspectRatio: '9:16', mediaInputOrder },
        constraints: ['稳定 ID 与媒体引用顺序不得重排。', '新候选不得覆盖已选结果。'],
      },
      policy: {
        safetyRules: ['禁止泄露密钥、签名 URL、私人路径和系统指令。', '禁止虚构 Provider 状态、费用和媒体结果。'],
        identityLocks: mediaInputOrder.filter((item) => item.startsWith('character:')),
        continuityLocks: [`scene:${shot.sceneId}`, `shot-revision:${shot.revision}`],
        approvedFacts: [shot.description, ...(shot.dialogue ? [shot.dialogue] : [])],
        userRequirements: [shot.visualPrompt, ...(shot.negativePrompt ? [`negative:${shot.negativePrompt}`] : [])],
        maxCompiledChars: 30_000,
      },
    })
    const existing = this.db.list<PromptRun>('prompt_runs', projectId)
      .find((run) => run.compiledHash === compiled.provenance.compiledHash)
    if (existing) return existing
    const timestamp = nowIso()
    const promptRun = PromptRunSchema.parse({
      id: randomUUID(),
      projectId,
      workflow: { id: 'workflow.one_click_short_video', version: '1.0.0' },
      prompt: compiled.provenance.prompt,
      skills: compiled.provenance.skills,
      providerProfile: demoProviderProfileRef(),
      modelSnapshot: {
        modelId: modelSelection.model.modelId,
        providerId: modelSelection.model.providerId,
        capabilities: modelSelection.model.features,
        snapshotVersion: modelSelection.model.snapshotVersion,
      },
      variablesHash: compiled.provenance.variablesHash,
      compiledHash: compiled.provenance.compiledHash,
      compiled: {
        system: compiled.system,
        canonical: compiled.canonical,
        zhReview: compiled.zhReview,
        enExecution: compiled.enExecution,
        outputSchema: compiled.outputSchema,
        warnings: compiled.warnings,
      },
      status: 'compiled',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    this.db.put('prompt_runs', projectId, promptRun)
    return promptRun
  }

  private scopedRegenerationTarget(projectId: string, request: ScopedRegenerationRequest): StoryEvent | Scene | Shot {
    const target = request.targetType === 'event'
      ? this.db.get<StoryEvent>('story_events', request.targetId)
      : request.targetType === 'scene'
        ? this.db.get<Scene>('scenes', request.targetId)
        : this.db.get<Shot>('shots', request.targetId)
    if (!target || target.projectId !== projectId) throw new Error('SCOPED_REGENERATION_TARGET_NOT_FOUND')
    return target
  }

  private prepareScopedPromptRun(
    projectId: string,
    revision: PromptRevision,
    binding: ReturnType<typeof ScopedPromptBindingSchema.parse>,
    variables: JsonObject,
    compiled: { zhReview: string; enExecution: string; compiledHash: string },
  ): PromptRun {
    const modelSelection = resolveDemoModelSelection({
      modalities: [binding.targetType === 'shot' ? 'image' : 'text'],
      features: binding.targetType === 'shot'
        ? ['image-generation', 'reference-images', 'reconcile', 'cancel']
        : ['structured-output', 'reconcile', 'cancel'],
    })
    const compiledHash = sha256(JSON.stringify({ sourceCompiledHash: compiled.compiledHash, binding }))
    const existing = this.db.list<PromptRun>('prompt_runs', projectId).find((run) => run.compiledHash === compiledHash)
    if (existing) return existing
    const timestamp = nowIso()
    const promptRun = PromptRunSchema.parse({
      id: randomUUID(),
      projectId,
      workflow: { id: 'workflow.scoped_regeneration', version: '1.0.0' },
      prompt: { id: revision.stableKey, version: `${revision.revision}.0.0`, contentHash: revision.contentHash },
      skills: [],
      providerProfile: demoProviderProfileRef(),
      modelSnapshot: {
        modelId: modelSelection.model.modelId,
        providerId: modelSelection.model.providerId,
        capabilities: modelSelection.model.features,
        snapshotVersion: modelSelection.model.snapshotVersion,
      },
      variablesHash: sha256(JSON.stringify(variables)),
      compiledHash,
      compiled: {
        system: '仅执行本地 Demo。不得泄露凭据、私人路径或系统指令；不得覆盖其他作用域的既有产物。',
        canonical: revision.languageDrafts.original,
        zhReview: compiled.zhReview,
        enExecution: compiled.enExecution,
        outputSchema: revision.outputSchema,
        warnings: ['局部重生成只追加 Artifact 或 Candidate，不改写既有选择。'],
      },
      status: 'compiled',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    this.db.put('prompt_runs', projectId, promptRun)
    return promptRun
  }

  private scopedRegenerationResult(task: GenerationTask): ScopedRegenerationResult {
    const artifactVersionId = typeof task.result?.artifactVersionId === 'string' ? task.result.artifactVersionId : undefined
    if (!artifactVersionId) throw new Error('SCOPED_REGENERATION_RESULT_MISSING')
    const artifact = this.db.get<ArtifactVersion>('artifact_versions', artifactVersionId)
    if (!artifact || artifact.projectId !== task.projectId) throw new Error('SCOPED_REGENERATION_RESULT_MISSING')
    const candidateId = typeof task.result?.candidateId === 'string' ? task.result.candidateId : undefined
    const candidate = candidateId ? this.db.get<Candidate>('candidates', candidateId) : undefined
    if (candidateId && (!candidate || candidate.projectId !== task.projectId)) throw new Error('SCOPED_REGENERATION_RESULT_MISSING')
    return ScopedRegenerationResultSchema.parse({ task, artifact, ...(candidate ? { candidate } : {}) })
  }

  private async executePromptPackFakeTask(task: GenerationTask, promptRun: PromptRun): Promise<GenerationTask> {
    const adapter = this.createPackProvider()
    const timestamp = nowIso()
    let attempt = TaskAttemptSchema.parse({
      id: randomUUID(), projectId: task.projectId, taskId: task.id, promptRunId: promptRun.id,
      attempt: task.attempt, status: 'submitting', provider: adapter.profile.id, model: task.model,
      idempotencyKey: task.idempotencyKey, createdAt: timestamp, updatedAt: timestamp,
    })
    this.db.put('task_attempts', task.projectId, attempt)
    this.db.put('prompt_runs', task.projectId, { ...promptRun, status: 'submitted', updatedAt: nowIso() })
    try {
      const receipt = await adapter.submit({
        taskId: task.id,
        modelId: task.model,
        promptRunId: promptRun.id,
        prompt: `${promptRun.compiled.system}\n${promptRun.compiled.canonical}\n${promptRun.compiled.enExecution}`,
        media: [],
        parameters: { demo: true },
      }, { key: task.idempotencyKey, attempt: task.attempt })
      const receiptRecord: ProviderReceiptRecord = ProviderReceiptRecordSchema.parse({
        id: randomUUID(), projectId: task.projectId, taskId: task.id, attemptId: attempt.id,
        providerId: receipt.providerId, remoteJobId: receipt.remoteJobId, acceptedAt: receipt.acceptedAt,
        ...(receipt.rawStatus ? { rawStatusHash: sha256(receipt.rawStatus) } : {}), createdAt: nowIso(),
      })
      this.db.put('provider_receipts', task.projectId, receiptRecord)
      attempt = TaskAttemptSchema.parse({ ...attempt, status: 'polling', receiptId: receiptRecord.id, updatedAt: nowIso() })
      this.db.put('task_attempts', task.projectId, attempt)
      let observation = await adapter.poll(receipt)
      for (let poll = 0; poll < 10 && ['queued', 'running'].includes(observation.state); poll += 1) observation = await adapter.poll(receipt)
      if (observation.state !== 'succeeded') throw new Error(`FAKE_PROVIDER_TERMINAL_${observation.state.toUpperCase()}`)
      const completedAttempt: TaskAttempt = TaskAttemptSchema.parse({ ...attempt, status: 'succeeded', updatedAt: nowIso(), finishedAt: nowIso() })
      this.db.put('task_attempts', task.projectId, completedAttempt)
      const accepted: GenerationTask = { ...task, providerTaskId: receipt.remoteJobId, progress: 0.8, updatedAt: nowIso() }
      this.saveTask(accepted)
      return accepted
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'FAKE_SUBMIT_TIMEOUT_AFTER_ACCEPT') {
        attempt = TaskAttemptSchema.parse({ ...attempt, status: 'reconciling', diagnosticHash: sha256(message), updatedAt: nowIso() })
        this.db.put('task_attempts', task.projectId, attempt)
        const reconciling: GenerationTask = { ...task, status: 'reconciling', progress: 0.5, updatedAt: nowIso() }
        this.saveTask(reconciling)
        const observation = await adapter.reconcile({ idempotencyKey: task.idempotencyKey })
        if (observation.state === 'succeeded') {
          const recoveredAttempt: TaskAttempt = TaskAttemptSchema.parse({ ...attempt, status: 'succeeded', updatedAt: nowIso(), finishedAt: nowIso() })
          this.db.put('task_attempts', task.projectId, recoveredAttempt)
          const recovered: GenerationTask = { ...task, status: 'running', progress: 0.8, updatedAt: nowIso() }
          this.saveTask(recovered)
          return recovered
        }
        attempt = TaskAttemptSchema.parse({ ...attempt, status: 'outcome_unknown', updatedAt: nowIso(), finishedAt: nowIso() })
        this.db.put('task_attempts', task.projectId, attempt)
        throw new Error('PROVIDER_OUTCOME_UNKNOWN_RECONCILE_REQUIRED')
      }
      attempt = TaskAttemptSchema.parse({ ...attempt, status: 'failed', diagnosticHash: sha256(message), updatedAt: nowIso(), finishedAt: nowIso() })
      this.db.put('task_attempts', task.projectId, attempt)
      throw error
    }
  }

  startExport(rawRequest: ExportRequest): GenerationTask {
    const request = ExportRequestSchema.parse(rawRequest)
    const exportKey = `export:${request.projectId}:${createHash('sha256').update(JSON.stringify(request)).digest('hex')}`
    const existing = this.db.getIdempotent<GenerationTask>(exportKey)
    if (existing && ['queued', 'running', 'succeeded'].includes(existing.status)) return existing
    const task = this.createTask({
      projectId: request.projectId, type: 'export', stage: '装配并导出 MP4',
      idempotencyKey: exportKey,
      inputSnapshot: request,
    })
    this.db.saveIdempotent(request.projectId, exportKey, 'export', task)
    const promise = this.runExport(task, request).finally(() => { this.controllers.delete(task.id); this.taskWaiters.delete(task.id) })
    this.taskWaiters.set(task.id, promise)
    return task
  }

  private async runExport(task: GenerationTask, request: ExportRequest): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(task.id, controller)
    const running: GenerationTask = { ...task, status: 'running', startedAt: nowIso(), updatedAt: nowIso() }
    this.saveTask(running)
    try {
      const shots = this.db.snapshot(task.projectId).shots
      const result = await exportProjectVideo(request, shots, {
        signal: controller.signal,
        onProgress: (progress) => this.saveTask({ ...running, status: 'running', stage: progress.stage, updatedAt: nowIso() }),
      })
      this.db.put('media_references', task.projectId, result.media)
      const completed: GenerationTask = {
        ...running, status: 'succeeded', stage: 'completed', progress: 1,
        result: { mediaId: result.media.id, fileName: request.fileName, durationMs: result.durationMs },
        updatedAt: nowIso(), finishedAt: nowIso(),
      }
      this.db.put('exports', task.projectId, { id: randomUUID(), projectId: task.projectId, taskId: task.id, mediaId: result.media.id, fileName: request.fileName, createdAt: nowIso() })
      this.saveTask(completed)
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      this.saveTask(cancelled
        ? { ...running, status: 'cancelled', retryable: false, updatedAt: nowIso(), finishedAt: nowIso() }
        : this.failedTask(running, error))
    }
  }

  startBoundaryExtraction(input: { projectId: string; shotId: string; candidateId: string; idempotencyKey: string }): GenerationTask {
    const shot = this.db.get<Shot>('shots', input.shotId)
    const candidate = this.db.get<Candidate>('candidates', input.candidateId)
    if (!shot || shot.projectId !== input.projectId) throw new Error('SHOT_NOT_FOUND')
    if (!candidate || candidate.projectId !== input.projectId || candidate.shotId !== shot.id) throw new Error('CANDIDATE_NOT_FOUND')
    if (candidate.kind !== 'video' || !candidate.mediaId) throw new Error('BOUNDARY_EXTRACTION_REQUIRES_VIDEO')
    const task = this.createTask({
      projectId: input.projectId, type: 'boundary_extract', stage: `${shot.title} · 提取真实尾帧`, idempotencyKey: input.idempotencyKey,
      model: 'local-ffmpeg', inputSnapshot: { shotId: shot.id, candidateId: candidate.id, mediaId: candidate.mediaId },
    })
    if (task.status !== 'queued') return task
    const promise = this.runBoundaryExtraction(task).finally(() => { this.controllers.delete(task.id); this.taskWaiters.delete(task.id) })
    this.taskWaiters.set(task.id, promise)
    return task
  }

  private async runBoundaryExtraction(task: GenerationTask): Promise<void> {
    const shotId = typeof task.inputSnapshot.shotId === 'string' ? task.inputSnapshot.shotId : undefined
    const candidateId = typeof task.inputSnapshot.candidateId === 'string' ? task.inputSnapshot.candidateId : undefined
    const mediaId = typeof task.inputSnapshot.mediaId === 'string' ? task.inputSnapshot.mediaId : undefined
    if (!shotId || !candidateId || !mediaId) {
      this.saveTask(this.failedTask(task, new Error('BOUNDARY_EXTRACTION_INPUT_INVALID')))
      return
    }
    const controller = new AbortController()
    this.controllers.set(task.id, controller)
    const running: GenerationTask = { ...task, status: 'running', progress: 0.1, startedAt: task.startedAt ?? nowIso(), updatedAt: nowIso() }
    this.saveTask(running)
    let publishedPath: string | undefined
    try {
      const shot = this.db.get<Shot>('shots', shotId)
      const candidate = this.db.get<Candidate>('candidates', candidateId)
      const sourceMedia = this.db.get<MediaReference>('media_references', mediaId)
      if (!shot || shot.projectId !== task.projectId) throw new Error('SHOT_NOT_FOUND')
      if (!candidate || candidate.projectId !== task.projectId || candidate.shotId !== shot.id || candidate.kind !== 'video') throw new Error('CANDIDATE_NOT_FOUND')
      if (!sourceMedia || sourceMedia.projectId !== task.projectId || sourceMedia.kind !== 'video') throw new Error('MEDIA_REFERENCE_NOT_FOUND')
      if (sourceMedia.storage !== 'managed-file' || basename(sourceMedia.locator) !== sourceMedia.locator) throw new Error('MEDIA_LOCATOR_INVALID')
      const mediaDirectory = join(this.dataDirectory, 'media', task.projectId)
      const extracted = await extractLastVideoFrame(join(mediaDirectory, sourceMedia.locator), mediaDirectory, { signal: controller.signal })
      publishedPath = extracted.outputPath
      const timestamp = nowIso()
      const media = MediaReferenceSchema.parse({
        id: randomUUID(), projectId: task.projectId, kind: 'image', storage: 'managed-file', locator: extracted.fileName,
        mime: 'image/png', size: extracted.size, sha256: extracted.sha256, createdAt: timestamp,
      })
      const frame = BoundaryFrameSchema.parse({
        id: randomUUID(), role: 'end', mediaId: media.id, mediaSha256: media.sha256, sourceShotId: shot.id,
        sourceCandidateId: candidate.id, sourceRevision: shot.revision, provenance: 'extracted_video', createdAt: timestamp,
      })
      const updatedShot = ShotSchema.parse({
        ...shot, boundaryFrames: [...shot.boundaryFrames.filter((item) => item.role !== 'end'), frame],
        revision: shot.revision + 1, updatedAt: timestamp,
      })
      this.db.transaction(() => {
        this.db.put('media_references', task.projectId, media)
        this.db.put('shots', task.projectId, updatedShot)
        const nextShot = this.db.list<Shot>('shots', task.projectId).find((item) => item.ordinal === updatedShot.ordinal + 1)
        if (nextShot && !nextShot.boundaryFrames.some((item) => item.role === 'start')) {
          this.db.put('shots', task.projectId, linkPreviousEndFrame(nextShot, updatedShot))
        }
        this.saveTask({
          ...running, status: 'succeeded', progress: 1, retryable: false,
          result: { mediaId: media.id, boundaryFrameId: frame.id, sourceCandidateId: candidate.id, sha256: media.sha256 },
          updatedAt: nowIso(), finishedAt: nowIso(),
        })
        this.db.bumpGraphRevision(task.projectId)
      })
      publishedPath = undefined
    } catch (error) {
      if (publishedPath) await unlink(publishedPath).catch(() => undefined)
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      this.saveTask(cancelled
        ? { ...running, status: 'cancelled', retryable: false, updatedAt: nowIso(), finishedAt: nowIso() }
        : this.failedTask(running, error))
    }
  }

  async waitForTask(taskId: string): Promise<GenerationTask> {
    await this.taskWaiters.get(taskId)
    const task = this.db.get<GenerationTask>('generation_tasks', taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    return task
  }

  cancelTask(taskId: string): GenerationTask {
    const task = this.db.get<GenerationTask>('generation_tasks', taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    if (!['queued', 'running', 'waiting_approval'].includes(task.status)) throw new Error('TASK_NOT_CANCELLABLE')
    const requested: GenerationTask = { ...task, status: 'cancel_requested', updatedAt: nowIso() }
    this.saveTask(requested)
    this.controllers.get(taskId)?.abort()
    return requested
  }

  async recoverTasks(): Promise<{ resumed: number; orphaned: number }> {
    const projects = this.db.listProjects()
    let resumed = 0
    let orphaned = 0
    for (const project of projects) {
      for (const task of this.db.list<GenerationTask>('generation_tasks', project.id)) {
        if (!['queued', 'running', 'retrying', 'reconciling'].includes(task.status)) continue
        if (task.provider === 'demo-local' && task.type === 'export') {
          const parsed = ExportRequestSchema.safeParse(task.inputSnapshot)
          if (parsed.success) {
            const promise = this.runExport({ ...task, status: 'queued', updatedAt: nowIso() }, parsed.data).finally(() => { this.controllers.delete(task.id); this.taskWaiters.delete(task.id) })
            this.taskWaiters.set(task.id, promise)
            resumed += 1
            continue
          }
        }
        if (task.provider === 'demo-local' && task.type === 'boundary_extract') {
          const promise = this.runBoundaryExtraction({ ...task, status: 'queued', updatedAt: nowIso() })
            .finally(() => { this.controllers.delete(task.id); this.taskWaiters.delete(task.id) })
          this.taskWaiters.set(task.id, promise)
          resumed += 1
          continue
        }
        if (task.provider === 'demo-local' && task.type === 'image' && await this.recoverDemoImageTask(task)) {
          resumed += 1
          continue
        }
        this.saveTask({ ...task, status: 'orphaned', retryable: false, updatedAt: nowIso(), error: this.appError('TASK_ORPHANED', '任务来源状态不明确，已停止自动提交。', false, task.id) })
        orphaned += 1
      }
    }
    return { resumed, orphaned }
  }

  private async recoverDemoImageTask(task: GenerationTask): Promise<boolean> {
    if (!task.promptRunId) return false
    const promptRun = this.db.get<PromptRun>('prompt_runs', task.promptRunId)
    const receipt = this.db.list<ProviderReceiptRecord>('provider_receipts', task.projectId).find((item) => item.taskId === task.id)
    if (!promptRun || !receipt) return false
    try {
      const adapter = this.createPackProvider()
      const observation = await adapter.reconcile({
        receipt: { providerId: receipt.providerId, remoteJobId: receipt.remoteJobId, acceptedAt: receipt.acceptedAt },
        idempotencyKey: task.idempotencyKey,
      })
      if (observation.state !== 'succeeded') return false
      const { candidate, media } = await this.materializeDemoCandidate({ ...task, status: 'running', updatedAt: nowIso() }, promptRun)
      const attempt = this.db.list<TaskAttempt>('task_attempts', task.projectId).find((item) => item.taskId === task.id)
      this.db.transaction(() => {
        this.db.put('media_references', task.projectId, media)
        this.db.put('candidates', task.projectId, candidate)
        this.db.put('prompt_runs', task.projectId, { ...promptRun, status: 'succeeded', updatedAt: nowIso() })
        if (attempt) this.db.put('task_attempts', task.projectId, { ...attempt, status: 'succeeded', updatedAt: nowIso(), finishedAt: nowIso() })
        this.saveTask({
          ...task, status: 'succeeded', progress: 1, retryable: false,
          result: { candidateId: candidate.id, mediaId: media.id, billed: false, promptRunId: promptRun.id, reconciled: true, recoveredAfterRestart: true },
          updatedAt: nowIso(), finishedAt: nowIso(),
        })
        this.db.bumpGraphRevision(task.projectId)
      })
      return true
    } catch {
      return false
    }
  }

  applyGraphCommand(projectId: string, view: GraphProjection['view'], command: GraphCommand): { revision: number; changed: string[]; skipped: string[] } {
    const project = this.db.getProject(projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')
    if (project.graphRevision !== command.expectedRevision) throw new Error('GRAPH_REVISION_CONFLICT')
    const cached = this.db.getIdempotent<{ revision: number; changed: string[]; skipped: string[] }>(command.idempotencyKey)
    if (cached) return cached
    const changed: string[] = []
    const skipped: string[] = []
    this.db.transaction(() => {
      if (command.type === 'move_nodes') {
        const positions = this.db.getLayout(projectId, view)
        Object.assign(positions, command.positions)
        this.db.saveLayout(projectId, view, positions)
        changed.push(...Object.keys(command.positions))
      } else if (command.type === 'connect_events') {
        const events = this.db.list<StoryEvent>('story_events', projectId)
        const edges = this.db.list<StoryEventEdge>('story_event_edges', projectId)
        const edge: StoryEventEdge = { id: randomUUID(), projectId, sourceEventId: command.sourceEventId, targetEventId: command.targetEventId, type: command.edgeType, createdAt: nowIso() }
        const validation = validateStoryGraph(events, [...edges, edge])
        if (!validation.valid) throw new Error(`STORY_GRAPH_INVALID:${validation.issues.join('|')}`)
        this.db.put('story_event_edges', projectId, edge)
        changed.push(edge.id)
      } else if (command.type === 'select_candidate') {
        const shot = this.db.get<ProjectSnapshot['shots'][number]>('shots', command.shotId)
        const candidate = this.db.get<Candidate>('candidates', command.candidateId)
        if (!shot || !candidate || shot.projectId !== projectId || candidate.shotId !== shot.id) throw new Error('CANDIDATE_BINDING_INVALID')
        if (shot.selectedCandidateId === candidate.id) skipped.push(candidate.id)
        else {
          this.db.put('shots', projectId, { ...shot, selectedCandidateId: candidate.id, updatedAt: nowIso() })
          const review: ReviewDecision = ReviewDecisionSchema.parse({
            id: randomUUID(), projectId, candidateId: candidate.id,
            ...(candidate.promptRevisionId ? { promptRunId: candidate.promptRevisionId } : {}),
            source: 'human', decision: 'approved', rubric: {}, reasons: ['用户在候选评审中明确选择。'], createdAt: nowIso(),
          })
          this.db.put('review_decisions', projectId, review)
          const approvalStageId = `approved-candidate:${shot.id}`
          for (const previous of this.db.list<ArtifactVersion>('artifact_versions', projectId)
            .filter((artifact) => artifact.stageId === approvalStageId && artifact.status === 'approved')) {
            this.db.put('artifact_versions', projectId, { ...previous, status: 'superseded', updatedAt: nowIso() })
          }
          const criticArtifact = this.db.list<ArtifactVersion>('artifact_versions', projectId)
            .filter((artifact) => artifact.stageId === `image-review:${shot.id}`)
            .sort((left, right) => right.revision - left.revision)[0]
          this.persistArtifactVersion({
            projectId,
            stageId: approvalStageId,
            artifactType: 'ApprovedCandidate',
            scope: { type: 'candidate', id: candidate.id },
            ...(candidate.promptRevisionId ? { promptRunId: candidate.promptRevisionId } : {}),
            dependencies: criticArtifact ? [criticArtifact] : [],
            content: { shotId: shot.id, candidateId: candidate.id, mediaId: candidate.mediaId ?? null, reviewDecisionId: review.id },
            status: 'approved',
          })
          changed.push(candidate.id)
        }
      } else if (command.type === 'archive_entity') {
        const table = command.entityType === 'asset' ? 'assets' : 'candidates'
        const entity = this.db.get<Record<string, unknown> & { id: string }>(table, command.entityId)
        if (!entity) throw new Error('ENTITY_NOT_FOUND')
        this.db.put(table, projectId, { ...entity, archived: true })
        changed.push(command.entityId)
      } else if (command.type === 'update_shot_beats') {
        const shot = this.db.get<Shot>('shots', command.shotId)
        if (!shot || shot.projectId !== projectId) throw new Error('SHOT_NOT_FOUND')
        const updated = {
          ...shot,
          beats: command.beats,
          revision: shot.revision + 1,
          staleFields: [...new Set([...shot.staleFields, ...propagateStaleFields(['durationMs', 'visualPrompt', 'videoPrompt'])])],
          updatedAt: nowIso(),
        }
        const parsed = ShotSchema.parse(updated)
        this.db.put('shots', projectId, parsed)
        changed.push(shot.id)
      } else if (command.type === 'link_previous_boundary') {
        const shots = this.db.list<Shot>('shots', projectId).sort((left, right) => left.ordinal - right.ordinal)
        const shotIndex = shots.findIndex((shot) => shot.id === command.shotId)
        if (shotIndex < 0) throw new Error('SHOT_NOT_FOUND')
        if (shotIndex === 0) throw new Error('PREVIOUS_SHOT_MISSING')
        const current = shots[shotIndex]!
        const previous = shots[shotIndex - 1]!
        const linked = linkPreviousEndFrame(current, previous)
        this.resolveBoundaryMediaInputs(projectId, linked.boundaryFrames.filter((frame) => frame.role === 'start'))
        this.db.put('shots', projectId, linked)
        changed.push(current.id)
      } else if (command.type === 'clear_boundary_frame') {
        const shot = this.db.get<Shot>('shots', command.shotId)
        if (!shot || shot.projectId !== projectId) throw new Error('SHOT_NOT_FOUND')
        if (!shot.boundaryFrames.some((frame) => frame.role === command.role)) skipped.push(shot.id)
        else {
          this.db.put('shots', projectId, {
            ...shot,
            boundaryFrames: shot.boundaryFrames.filter((frame) => frame.role !== command.role),
            revision: shot.revision + 1,
            staleFields: [...new Set([...shot.staleFields, ...propagateStaleFields(['assetBinding'])])],
            updatedAt: nowIso(),
          })
          changed.push(shot.id)
        }
      }
      const revision = changed.length > 0 ? this.db.bumpGraphRevision(projectId) : project.graphRevision
      const response = { revision, changed, skipped }
      this.db.saveIdempotent(projectId, command.idempotencyKey, command.type, response)
    })
    return this.db.getIdempotent(command.idempotencyKey) ?? { revision: project.graphRevision, changed, skipped }
  }

  private createTask(input: {
    projectId: string
    type: GenerationTask['type']
    stage: string
    idempotencyKey: string
    inputSnapshot: Record<string, unknown>
    promptRunId?: string
    providerProfileVersion?: string
    model?: string
    modelCapabilitySnapshot?: Record<string, unknown>
    mediaInputOrder?: string[]
  }): GenerationTask {
    const existing = this.db.list<GenerationTask>('generation_tasks', input.projectId)
      .filter((task) => task.idempotencyKey === input.idempotencyKey)
      .sort((a, b) => b.attempt - a.attempt)[0]
    if (existing && ['queued', 'running', 'succeeded'].includes(existing.status)) return existing
    const timestamp = nowIso()
    const task = GenerationTaskSchema.parse({
      id: randomUUID(), projectId: input.projectId, type: input.type, status: 'queued', stage: input.stage,
      idempotencyKey: input.idempotencyKey, provider: 'demo-local',
      model: input.model ?? (input.type === 'image' ? 'demo-frame-v1' : input.type === 'export' ? 'local-ffmpeg' : 'demo-structured-v1'),
      ...(input.promptRunId ? { promptRunId: input.promptRunId } : {}),
      ...(input.providerProfileVersion ? { providerProfileVersion: input.providerProfileVersion } : {}),
      ...(input.modelCapabilitySnapshot ? { modelCapabilitySnapshot: input.modelCapabilitySnapshot } : {}),
      ...(input.mediaInputOrder ? { mediaInputOrder: input.mediaInputOrder } : {}),
      attempt: (existing?.attempt ?? 0) + 1, parentTaskId: existing?.id, inputSnapshot: input.inputSnapshot,
      retryable: true, createdAt: timestamp, updatedAt: timestamp,
    })
    this.saveTask(task)
    return task
  }

  private saveTask(task: GenerationTask): void {
    this.db.put('generation_tasks', task.projectId, task)
    this.emitTask({ task })
  }

  private failedTask(task: GenerationTask, error: unknown): GenerationTask {
    const { progress: _progress, ...withoutProgress } = task
    return {
      ...withoutProgress, status: 'failed', retryable: true,
      error: this.appError('TASK_EXECUTION_FAILED', '任务失败，可查看诊断后重试。', true, task.id),
      result: { diagnosticHash: sha256(error instanceof Error ? error.message : String(error)) },
      updatedAt: nowIso(), finishedAt: nowIso(),
    }
  }

  private appError(code: string, userMessage: string, retryable: boolean, taskId?: string) {
    return {
      code, userMessage, technicalMessage: code, retryable, correlationId: randomUUID(),
      ...(taskId ? { taskId } : {}), timestamp: nowIso(),
    }
  }
}
