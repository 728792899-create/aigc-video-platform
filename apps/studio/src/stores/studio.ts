import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AgentRunCheckpoint,
  ArtifactVersion,
  AssetBatchBindPreview,
  AssetBinding,
  BoundaryFrame,
  CreativeBrief,
  CreativeBriefField,
  CreativeBriefState,
  EpisodeContinuityState,
  ExecutionPlan,
  ExportPreflight,
  ExportRequest,
  GenerationTask,
  GraphNode,
  GraphProjection,
  Project,
  ProjectGenerationPolicy,
  ProjectSnapshot,
  PromptPackInventory,
  ReconcilePreview,
  ResolvedAsset,
  Series,
  SharedAsset,
  ShotBeat,
  SourceImportPreview,
  TaskDiagnostic,
  TaskAdmission,
} from '@aigc-director/contracts'
import { connectTaskEvents, directorApi, DirectorApiError, type TaskEventStream } from '../api/client.js'

export function upsertTask(list: GenerationTask[], task: GenerationTask): GenerationTask[] {
  return [...list.filter((item) => item.id !== task.id), task].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export const useStudioStore = defineStore('studio', () => {
  const projects = ref<Project[]>([])
  const series = ref<Series[]>([])
  const currentProjectId = ref<string>()
  const snapshot = ref<ProjectSnapshot>()
  const graph = ref<GraphProjection>()
  const view = ref<GraphProjection['view']>('story')
  const selectedNodeId = ref<string>()
  const loading = ref(false)
  const message = ref('')
  const error = ref<{ message: string; code: string; retryable: boolean; correlationId: string }>()
  const currentPlan = ref<ExecutionPlan>()
  const currentCheckpoint = ref<AgentRunCheckpoint>()
  const approvalToken = ref('')
  const tasks = ref<GenerationTask[]>([])
  const taskDiagnostics = ref<Record<string, TaskDiagnostic>>({})
  const taskAdmission = ref<TaskAdmission>()
  const generationPolicy = ref<ProjectGenerationPolicy>()
  const creativeBrief = ref<CreativeBriefState>()
  const episodeContinuity = ref<EpisodeContinuityState>()
  const promptPack = ref<PromptPackInventory>()
  const pendingBatchBind = ref<AssetBatchBindPreview>()
  const pendingReconcile = ref<ReconcilePreview>()
  const pendingExportPreflight = ref<ExportPreflight>()
  let taskEvents: TaskEventStream | undefined

  const currentProject = computed(() => projects.value.find((project) => project.id === currentProjectId.value))
  const selectedNode = computed<GraphNode | undefined>(() => graph.value?.nodes.find((node) => node.id === selectedNodeId.value))
  const selectedEntity = computed(() => {
    const node = selectedNode.value
    const data = snapshot.value
    if (!node || !data) return undefined
    if (node.type === 'project') return data.project
    if (node.type === 'series') return data.series
    if (node.type === 'episode') return data.episode
    if (node.type === 'asset') return data.resolvedAssets.find((asset) => asset.assetId === node.entityId) ?? data.assets.find((asset) => asset.id === node.entityId)
    const collections: ReadonlyArray<ReadonlyArray<{ id: string }>> = [data.sources, data.chapters, data.events, data.scenes, data.shots, data.assets, data.candidates, data.tasks, data.plans]
    return collections.flat().find((entity) => entity.id === node.entityId)
  })

  function captureError(reason: unknown): void {
    if (reason instanceof DirectorApiError) error.value = { message: reason.message, code: reason.code, retryable: reason.retryable, correlationId: reason.correlationId }
    else error.value = { message: '操作未完成，请重试。', code: 'CLIENT_ERROR', retryable: true, correlationId: crypto.randomUUID() }
  }

  function selectNode(nodeId?: string): void {
    selectedNodeId.value = nodeId
  }

  function receiveTask(task: GenerationTask): void {
    if (task.projectId !== currentProjectId.value) return
    tasks.value = upsertTask(tasks.value, task)
    if (snapshot.value) snapshot.value = { ...snapshot.value, tasks: upsertTask(snapshot.value.tasks, task) }
  }

  async function ensureTaskEvents(): Promise<void> {
    taskEvents ??= await connectTaskEvents(receiveTask)
  }

  async function run<T>(operation: () => Promise<T>, successMessage?: string): Promise<T | undefined> {
    loading.value = true
    error.value = undefined
    try {
      const result = await operation()
      if (successMessage) message.value = successMessage
      return result
    } catch (reason) {
      captureError(reason)
      return undefined
    } finally {
      loading.value = false
    }
  }

  async function initialize(projectId?: string): Promise<void> {
    await run(async () => {
      await ensureTaskEvents()
      const [availableProjects, availableSeries, inventory] = await Promise.all([directorApi.listProjects(), directorApi.listSeries(), directorApi.promptPackInventory()])
      projects.value = availableProjects
      series.value = availableSeries
      promptPack.value = inventory
      currentProjectId.value = projectId && projects.value.some((project) => project.id === projectId) ? projectId : projects.value[0]?.id
      if (currentProjectId.value) await loadProject(currentProjectId.value)
    })
  }

  async function createProject(name: string, description = ''): Promise<Project | undefined> {
    return await run(async () => {
      const project = await directorApi.createProject({ name, description })
      projects.value = [project, ...projects.value]
      currentProjectId.value = project.id
      await loadProject(project.id)
      return project
    }, '项目已创建，可以导入原著。')
  }

  async function loadProject(projectId: string): Promise<void> {
    currentProjectId.value = projectId
    taskEvents?.subscribe(projectId)
    const [nextSnapshot, nextBrief, nextPolicy] = await Promise.all([
      directorApi.snapshot(projectId), directorApi.creativeBrief(projectId), directorApi.generationPolicy(projectId),
    ])
    snapshot.value = nextSnapshot
    creativeBrief.value = nextBrief
    generationPolicy.value = nextPolicy
    episodeContinuity.value = nextSnapshot.episode ? await directorApi.episodeContinuity(nextSnapshot.episode.id) : undefined
    tasks.value = snapshot.value.tasks
    taskAdmission.value = await directorApi.taskAdmission(projectId)
    currentPlan.value = [...snapshot.value.plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    currentCheckpoint.value = currentPlan.value ? await directorApi.agentCheckpoint(currentPlan.value.runId).catch(() => undefined) : undefined
    approvalToken.value = ''
    pendingBatchBind.value = undefined
    pendingReconcile.value = undefined
    pendingExportPreflight.value = undefined
    await loadGraph()
  }

  async function loadGraph(): Promise<void> {
    if (!currentProjectId.value) { graph.value = undefined; return }
    graph.value = await directorApi.graph(currentProjectId.value, view.value)
    selectedNodeId.value = selectedNodeId.value && graph.value.nodes.some((node) => node.id === selectedNodeId.value) ? selectedNodeId.value : undefined
  }

  async function saveCreativeBrief(brief: CreativeBrief): Promise<boolean> {
    if (!currentProjectId.value) return false
    const result = await run(async () => {
      creativeBrief.value = await directorApi.reviseCreativeBrief(currentProjectId.value!, {
        expectedRevision: creativeBrief.value?.artifact?.revision ?? 0, brief,
      })
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      await loadGraph()
      return true
    }, '创意简报已保存；受影响的下游节点已标记 stale，历史候选仍保留。')
    return result === true
  }

  async function generateCreativeBriefCandidates(feedback: string, lockedFields: CreativeBriefField[]): Promise<boolean> {
    if (!currentProjectId.value) return false
    const result = await run(async () => {
      await directorApi.createCreativeBriefCandidates(currentProjectId.value!, {
        count: 3,
        feedback,
        lockedFields,
        idempotencyKey: `brief-candidates-${crypto.randomUUID()}`,
      })
      creativeBrief.value = await directorApi.creativeBrief(currentProjectId.value!)
      return true
    }, '已生成 3 个本地确定性简报候选；当前批准稿尚未改变。')
    return result === true
  }

  async function reviewCreativeBriefCandidate(artifactId: string, decision: 'approve' | 'reject'): Promise<boolean> {
    if (!currentProjectId.value) return false
    const result = await run(async () => {
      creativeBrief.value = await directorApi.reviewCreativeBriefCandidate(currentProjectId.value!, artifactId, decision === 'approve'
        ? {
            decision,
            expectedApprovedRevision: creativeBrief.value?.artifact?.revision ?? 0,
            confirmation: 'APPROVE_CREATIVE_BRIEF',
            idempotencyKey: `brief-review-${crypto.randomUUID()}`,
          }
        : {
            decision,
            expectedApprovedRevision: creativeBrief.value?.artifact?.revision ?? 0,
            confirmation: 'REJECT_CREATIVE_BRIEF',
            idempotencyKey: `brief-review-${crypto.randomUUID()}`,
          })
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      await loadGraph()
      return true
    }, decision === 'approve'
      ? '候选已批准为新的简报 revision；受影响节点已精确标记 stale。'
      : '候选已拒绝，当前批准稿和下游产物保持不变。')
    return result === true
  }

  async function changeView(next: GraphProjection['view']): Promise<void> {
    view.value = next
    await run(loadGraph)
  }

  async function importSource(title: string, content: string): Promise<void> {
    if (!currentProjectId.value) return
    await run(async () => {
      snapshot.value = await directorApi.importSource(currentProjectId.value!, { title, content })
      episodeContinuity.value = snapshot.value.episode ? await directorApi.episodeContinuity(snapshot.value.episode.id) : undefined
      await loadGraph()
    }, '章节与事件图谱已生成。')
  }

  async function previewSourceImport(file: File): Promise<SourceImportPreview | undefined> {
    if (!currentProjectId.value) return undefined
    return await run(() => directorApi.previewSourceImport(currentProjectId.value!, file), '文件已进入隔离预览，确认前不会写入项目。')
  }

  async function commitSourceImport(preview: SourceImportPreview, title: string, language = 'zh-CN'): Promise<boolean> {
    if (!currentProjectId.value || preview.projectId !== currentProjectId.value) return false
    const result = await run(async () => {
      snapshot.value = await directorApi.commitSourceImport(currentProjectId.value!, preview.id, {
        title, language, expectedContentHash: preview.contentHash,
      })
      episodeContinuity.value = snapshot.value.episode ? await directorApi.episodeContinuity(snapshot.value.episode.id) : undefined
      await loadGraph()
      return true
    }, '文件已确认导入，章节与事件图谱已生成。')
    return result === true
  }

  async function cancelSourceImport(importId: string): Promise<void> {
    if (!currentProjectId.value) return
    await run(() => directorApi.cancelSourceImport(currentProjectId.value!, importId), '隔离预览已取消，内容未写入项目。')
  }

  async function createPlan(): Promise<void> {
    if (!currentProjectId.value || !snapshot.value) return
    await run(async () => {
      const result = await directorApi.createPlan(currentProjectId.value!, `plan-${currentProjectId.value}-${snapshot.value!.project.graphRevision}`)
      currentPlan.value = result.plan
      currentCheckpoint.value = result.checkpoint
      approvalToken.value = result.approvalToken
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      await loadGraph()
    }, '制作计划已生成，等待批准。')
  }

  async function createEpisodeContinuitySummary(): Promise<void> {
    const state = episodeContinuity.value
    const episode = snapshot.value?.episode
    const source = state?.current.currentSource
    if (!episode || !source) return
    await run(async () => {
      episodeContinuity.value = await directorApi.createEpisodeContinuitySummary(episode.id, {
        expectedSourceId: source.id, expectedSourceRevision: source.revision, expectedSourceHash: source.contentHash,
        idempotencyKey: `episode-continuity-${crypto.randomUUID()}`,
      })
      snapshot.value = await directorApi.snapshot(episode.projectId)
      await loadGraph()
    }, '跨集摘要已固定到当前 Source revision；后续来源变化会标记 stale。')
  }

  async function approvePlan(): Promise<void> {
    if (!currentPlan.value || !approvalToken.value) return
    await run(async () => {
      snapshot.value = await directorApi.approvePlan(currentPlan.value!.id, approvalToken.value)
      currentPlan.value = snapshot.value.plans.find((plan) => plan.id === currentPlan.value!.id)
      approvalToken.value = ''
      await changeView('production')
    }, '计划已批准，场景与镜头已创建。')
  }

  async function produceDemo(): Promise<void> {
    if (!currentProjectId.value || !snapshot.value) return
    await run(async () => {
      snapshot.value = await directorApi.runDemoProduction(currentProjectId.value!, `demo-production-${currentProjectId.value}-${snapshot.value!.project.graphRevision}`)
      tasks.value = snapshot.value.tasks
      await loadGraph()
    }, 'Demo 候选已生成，付费请求为 0。')
  }

  async function produceProviderCandidate(shotId: string, maxCostMicros: number, promptAppendix?: string): Promise<GenerationTask | undefined> {
    if (!currentProjectId.value || !generationPolicy.value) return undefined
    return await run(async () => {
      const route = await directorApi.providerRoutePolicy(currentProjectId.value!)
      const task = await directorApi.generateRoutedCandidate(shotId, {
        expectedRouteRevision: route.revision,
        expectedPolicyRevision: generationPolicy.value!.revision,
        idempotencyKey: `provider-candidate-${crypto.randomUUID()}`,
        maxCostMicros,
        ...(promptAppendix?.trim() ? { promptAppendix: promptAppendix.trim() } : {}),
        confirmation: 'GENERATE_WITH_USER_PROVIDER',
      })
      tasks.value = upsertTask(tasks.value, task)
      return task
    }, '用户自付候选已进入任务中心；未知结果只允许先对账。')
  }

  async function prepareExport(
    outputDirectory: string,
    options: Partial<Pick<ExportRequest, 'fileName' | 'width' | 'height' | 'fps'>> = {},
  ): Promise<ExportPreflight | undefined> {
    if (!currentProjectId.value) return undefined
    return await run(async () => {
      const preflight = await directorApi.prepareExport({
        projectId: currentProjectId.value!,
        outputDirectory,
        fileName: options.fileName ?? `${currentProject.value?.name ?? 'director-demo'}.mp4`,
        width: options.width ?? 1280,
        height: options.height ?? 720,
        fps: options.fps ?? 24,
      })
      pendingExportPreflight.value = preflight
      return preflight
    }, '导出预检已完成；确认前不会启动 FFmpeg。')
  }

  async function confirmExport(): Promise<GenerationTask | undefined> {
    const preflight = pendingExportPreflight.value
    if (!preflight) return undefined
    return await run(async () => {
      const task = await directorApi.startExport({
        preflightId: preflight.id,
        approvalToken: preflight.approvalToken,
        confirmation: 'START_LOCAL_EXPORT',
      })
      tasks.value = upsertTask(tasks.value, task)
      pendingExportPreflight.value = undefined
      return task
    }, '导出任务已创建；重复确认会复用同一任务。')
  }

  async function refreshTasks(): Promise<void> {
    if (!currentProjectId.value) return
    const [nextTasks, admission] = await Promise.all([directorApi.tasks(currentProjectId.value), directorApi.taskAdmission(currentProjectId.value)])
    tasks.value = nextTasks
    taskAdmission.value = admission
    if (snapshot.value) snapshot.value = { ...snapshot.value, tasks: tasks.value }
  }

  async function updateGenerationPolicy(input: Pick<ProjectGenerationPolicy, 'maxConcurrentTasks' | 'maxCandidatesPerBatch' | 'maxExportDurationMs'> & Partial<Pick<ProjectGenerationPolicy, 'billingMode' | 'dailyPaidBudgetMicros'>>): Promise<boolean> {
    if (!currentProjectId.value || !generationPolicy.value) return false
    const result = await run(async () => {
      generationPolicy.value = await directorApi.updateGenerationPolicy(currentProjectId.value!, {
        expectedRevision: generationPolicy.value!.revision,
        ...input,
        confirmation: input.billingMode === 'user-funded' || (input.dailyPaidBudgetMicros ?? 0) > 0
          ? 'ENABLE_USER_FUNDED_PROVIDERS'
          : 'UPDATE_GENERATION_POLICY',
      })
      taskAdmission.value = await directorApi.taskAdmission(currentProjectId.value!)
      return true
    }, input.billingMode === 'user-funded'
      ? '项目已启用用户自付 Provider；实际执行仍受连接状态、网络总开关和每日预算约束。'
      : '项目生成策略已更新；外部 Provider 已关闭。')
    return result === true
  }

  async function exportDiagnosticBundle(): Promise<{ blob: Blob; fileName: string } | undefined> {
    if (!currentProjectId.value) return undefined
    return await run(async () => {
      const bundle = await directorApi.projectDiagnosticBundle(currentProjectId.value!)
      return {
        blob: new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' }),
        fileName: `aigc-director-diagnostic-${bundle.projectReferenceHash.slice(0, 12)}.json`,
      }
    }, '脱敏诊断包已生成；其中不包含原文、Prompt、凭据、Provider payload 或本机路径。')
  }

  async function inspectTask(taskId: string): Promise<void> {
    await run(async () => {
      taskDiagnostics.value = { ...taskDiagnostics.value, [taskId]: await directorApi.taskDiagnostic(taskId) }
    })
  }

  async function cancelTask(taskId: string): Promise<void> {
    await run(async () => {
      const task = await directorApi.cancelTask(taskId)
      receiveTask(task)
      taskDiagnostics.value = { ...taskDiagnostics.value, [taskId]: await directorApi.taskDiagnostic(taskId) }
    }, '已请求取消任务；远端取消状态会单独显示。')
  }

  async function reconcileTask(taskId: string): Promise<void> {
    await run(async () => {
      const result = await directorApi.reconcileTask(taskId)
      receiveTask(result.task)
      taskDiagnostics.value = { ...taskDiagnostics.value, [taskId]: result.diagnostic }
      await loadGraph()
    }, '对账已完成，未执行新的 Provider 提交。')
  }

  async function retryTask(taskId: string): Promise<void> {
    await run(async () => {
      const result = await directorApi.retryTask(taskId, `task-retry-${crypto.randomUUID()}`)
      receiveTask(result.task)
      taskDiagnostics.value = { ...taskDiagnostics.value, [result.task.id]: result.diagnostic }
    }, '已创建新的重试 attempt，原失败记录仍保留。')
  }

  async function rollbackArtifactVersion(target: ArtifactVersion, expectedHeadRevision: number): Promise<ArtifactVersion | undefined> {
    return await run(async () => {
      const rollback = await directorApi.rollbackArtifact(target.projectId, target.scope, target.id, expectedHeadRevision)
      snapshot.value = await directorApi.snapshot(target.projectId)
      tasks.value = snapshot.value.tasks
      await loadGraph()
      return rollback
    }, `已以 r${target.revision} 创建新 Artifact revision，历史未覆盖。`)
  }

  async function exportProjectPackage(): Promise<{ blob: Blob; fileName: string } | undefined> {
    if (!currentProjectId.value) return undefined
    return await run(() => directorApi.exportProjectPackage(currentProjectId.value!), '项目包已生成，不包含密钥、日志和本机绝对路径。')
  }

  async function exportSeriesPackage(): Promise<{ blob: Blob; fileName: string } | undefined> {
    const seriesId = snapshot.value?.series?.id
    if (!seriesId) return undefined
    return await run(() => directorApi.exportSeriesPackage(seriesId), 'Series 包已生成，包含有序 Episodes 与共享资产快照。')
  }

  async function importProjectPackage(file: File): Promise<void> {
    await run(async () => {
      const report = await directorApi.importProjectPackage(file)
      projects.value = await directorApi.listProjects()
      series.value = await directorApi.listSeries()
      await loadProject(report.project.id)
      message.value = `项目包已导入：${report.mediaCount} 个媒体，${report.remappedEntityCount} 个内部 ID 已重映射。${report.warnings.join(' ')}`
    })
  }

  async function createSeriesAndAttach(name: string): Promise<Series | undefined> {
    if (!currentProjectId.value) return undefined
    return await run(async () => {
      const created = await directorApi.createSeries({ name })
      await directorApi.attachEpisode(created.id, { projectId: currentProjectId.value! })
      series.value = await directorApi.listSeries()
      await loadProject(currentProjectId.value!)
      return created
    }, '已创建 Series，并将当前项目作为首个 Episode。')
  }

  async function createSharedAsset(input: { type: SharedAsset['type']; name: string; scope: 'global' | 'series' }): Promise<SharedAsset | undefined> {
    const seriesId = snapshot.value?.series?.id
    if (input.scope === 'series' && !seriesId) return undefined
    return await run(async () => {
      const asset = await directorApi.createSharedAsset({ ...input, ...(seriesId ? { seriesId } : {}) })
      await directorApi.createSharedAssetVariant(asset.id, { label: '默认版本' })
      if (currentProjectId.value) await loadProject(currentProjectId.value)
      return asset
    }, '共享资产已创建，尚未覆盖任何分集资产。')
  }

  async function forkResolvedAsset(asset: ResolvedAsset): Promise<void> {
    if (!currentProjectId.value || asset.assetKind !== 'shared') return
    await run(async () => {
      await directorApi.forkAsset({ projectId: currentProjectId.value!, sharedAssetId: asset.assetId, sharedVariantId: asset.variantId })
      await loadProject(currentProjectId.value!)
    }, '已 fork 为分集本地版本，共享源保持不变。')
  }

  async function promoteResolvedAsset(asset: ResolvedAsset): Promise<void> {
    if (!currentProjectId.value || asset.assetKind !== 'local') return
    const target = snapshot.value?.series ? { scope: 'series' as const, seriesId: snapshot.value.series.id } : { scope: 'global' as const }
    await run(async () => {
      await directorApi.promoteAsset({ projectId: currentProjectId.value!, assetId: asset.assetId, variantId: asset.variantId, ...target })
      await loadProject(currentProjectId.value!)
    }, '已创建共享副本，本地资产与历史结果未被删除。')
  }

  async function previewShotBinding(shotId: string, asset: ResolvedAsset): Promise<void> {
    const episode = snapshot.value?.episode
    if (!episode || !snapshot.value) return
    const slot = asset.type === 'character' || asset.type === 'scene' || asset.type === 'prop' || asset.type === 'style' || asset.type === 'voice' || asset.type === 'music'
      ? asset.type
      : 'reference'
    const result = await run(() => directorApi.previewBatchBind({
      episodeId: episode.id, expectedProjectRevision: snapshot.value!.project.graphRevision,
      bindings: [{ shotId, slot, assetKind: asset.assetKind, assetId: asset.assetId, variantId: asset.variantId, expectedAssetRevision: asset.revision }],
    }), '批量改绑预览已生成，确认前不会写入项目。')
    pendingBatchBind.value = result
  }

  async function applyPendingBatchBind(): Promise<void> {
    const preview = pendingBatchBind.value
    if (!preview) return
    await run(async () => {
      await directorApi.applyBatchBind({ episodeId: preview.episodeId, operationId: preview.operationId, approvalToken: preview.approvalToken })
      pendingBatchBind.value = undefined
      if (currentProjectId.value) await loadProject(currentProjectId.value)
    }, '资产绑定已事务应用，受影响下游已标记 stale。')
  }

  async function previewBindingRepair(binding: AssetBinding): Promise<void> {
    const episode = snapshot.value?.episode
    const resolved = snapshot.value?.resolvedAssets.find((asset) => asset.assetId === binding.assetId)
    if (!episode || !resolved || !snapshot.value) return
    const result = await run(() => directorApi.previewReconcile(episode.id, {
      expectedProjectRevision: snapshot.value!.project.graphRevision,
      decisions: [{
        bindingId: binding.id, action: 'rebind', targetAssetId: resolved.assetId,
        targetVariantId: resolved.variantId, expectedAssetRevision: resolved.revision,
      }],
    }), 'revision drift 修复预览已生成。')
    pendingReconcile.value = result
  }

  async function applyPendingReconcile(): Promise<void> {
    const preview = pendingReconcile.value
    if (!preview) return
    await run(async () => {
      await directorApi.applyReconcile(preview.episodeId, { operationId: preview.operationId, approvalToken: preview.approvalToken })
      pendingReconcile.value = undefined
      if (currentProjectId.value) await loadProject(currentProjectId.value)
    }, '改绑已应用，旧候选和历史快照仍保留。')
  }

  async function moveNodes(positions: Record<string, { x: number; y: number }>): Promise<void> {
    if (!currentProjectId.value || !graph.value) return
    const result = await run(() => directorApi.command(currentProjectId.value!, view.value, {
      type: 'move_nodes', expectedRevision: graph.value!.revision, idempotencyKey: `move-${crypto.randomUUID()}`, positions,
    }))
    if (result && graph.value) graph.value = { ...graph.value, revision: result.revision, nodes: graph.value.nodes.map((node) => positions[node.id] ? { ...node, position: positions[node.id]! } : node) }
  }

  async function connectEvents(sourceNodeId: string, targetNodeId: string): Promise<void> {
    if (!currentProjectId.value || !graph.value || !sourceNodeId.startsWith('event:') || !targetNodeId.startsWith('event:')) return
    await run(async () => {
      await directorApi.command(currentProjectId.value!, 'story', {
        type: 'connect_events', expectedRevision: graph.value!.revision, idempotencyKey: `connect-${crypto.randomUUID()}`,
        sourceEventId: sourceNodeId.slice(6), targetEventId: targetNodeId.slice(6), edgeType: 'causes',
      })
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      await loadGraph()
    }, '事件因果关系已保存。')
  }

  async function selectCandidate(shotId: string, candidateId: string): Promise<void> {
    if (!currentProjectId.value || !snapshot.value) return
    await run(async () => {
      await directorApi.command(currentProjectId.value!, 'production', {
        type: 'select_candidate', expectedRevision: snapshot.value!.project.graphRevision,
        idempotencyKey: `select-${crypto.randomUUID()}`, shotId, candidateId,
      })
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      await loadGraph()
    }, '候选已批准并绑定到镜头。')
  }

  async function annotateCandidate(candidateId: string, patch: { favorite?: boolean; label?: string; tags?: string[] }): Promise<void> {
    if (!snapshot.value) return
    await run(async () => {
      const candidate = await directorApi.annotateCandidate(candidateId, patch)
      snapshot.value = { ...snapshot.value!, candidates: snapshot.value!.candidates.map((item) => item.id === candidate.id ? candidate : item) }
    }, '候选标注已保存。')
  }

  async function retryFailedCandidateBatch(batchId: string): Promise<void> {
    if (!currentProjectId.value) return
    await run(async () => {
      await directorApi.retryFailedCandidateBatch(batchId, `retry-candidate-batch-${crypto.randomUUID()}`)
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      tasks.value = snapshot.value.tasks
      await loadGraph()
    }, '失败候选已作为新批次重试，原批次和原候选已保留。')
  }

  async function updateShotBeats(shotId: string, beats: ShotBeat[]): Promise<void> {
    if (!currentProjectId.value || !graph.value) return
    await run(async () => {
      await directorApi.command(currentProjectId.value!, 'production', {
        type: 'update_shot_beats', expectedRevision: graph.value!.revision,
        idempotencyKey: `shot-beats-${crypto.randomUUID()}`, shotId, beats,
      })
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      await loadGraph()
    }, '镜头节拍已保存，受影响的下游结果已标记。')
  }

  async function linkPreviousBoundary(shotId: string): Promise<void> {
    if (!currentProjectId.value || !graph.value) return
    await run(async () => {
      await directorApi.command(currentProjectId.value!, 'production', {
        type: 'link_previous_boundary', expectedRevision: graph.value!.revision,
        idempotencyKey: `link-boundary-${crypto.randomUUID()}`, shotId,
      })
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      await loadGraph()
    }, '已创建上一镜头尾帧的独立首帧引用快照。')
  }

  async function clearBoundaryFrame(shotId: string, role: BoundaryFrame['role']): Promise<void> {
    if (!currentProjectId.value || !graph.value) return
    await run(async () => {
      await directorApi.command(currentProjectId.value!, 'production', {
        type: 'clear_boundary_frame', expectedRevision: graph.value!.revision,
        idempotencyKey: `clear-boundary-${crypto.randomUUID()}`, shotId, role,
      })
      snapshot.value = await directorApi.snapshot(currentProjectId.value!)
      await loadGraph()
    }, '边界帧引用已解除，历史媒体仍被保留。')
  }

  return {
    projects, series, currentProjectId, currentProject, snapshot, graph, view, selectedNodeId, selectedNode, selectedEntity,
    loading, message, error, currentPlan, currentCheckpoint, approvalToken, tasks, taskDiagnostics, taskAdmission, generationPolicy, creativeBrief, episodeContinuity, promptPack, pendingBatchBind, pendingReconcile, pendingExportPreflight,
    initialize, createProject, loadProject, loadGraph, selectNode, saveCreativeBrief, generateCreativeBriefCandidates, reviewCreativeBriefCandidate, changeView, importSource, previewSourceImport, commitSourceImport, cancelSourceImport, createPlan, approvePlan, produceDemo, produceProviderCandidate, prepareExport, confirmExport, refreshTasks, updateGenerationPolicy, exportDiagnosticBundle, inspectTask, cancelTask, reconcileTask, retryTask, rollbackArtifactVersion,
    exportProjectPackage, exportSeriesPackage, importProjectPackage, moveNodes, connectEvents, selectCandidate, annotateCandidate, retryFailedCandidateBatch,
    updateShotBeats, linkPreviousBoundary, clearBoundaryFrame, createEpisodeContinuitySummary, createSeriesAndAttach, createSharedAsset,
    forkResolvedAsset, promoteResolvedAsset, previewShotBinding, applyPendingBatchBind, previewBindingRepair, applyPendingReconcile,
  }
})
