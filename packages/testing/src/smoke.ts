import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CandidateSchema, type ProjectSnapshot } from '@aigc-director/contracts'
import { probeMedia } from '@aigc-director/media'
import { createDirectorApp } from '../../../apps/server/src/http/app.js'

process.env.DEMO_MODE = '1'
process.env.PROVIDER_NETWORK_DISABLED = '1'

const sessionToken = 'director-smoke-session-token-with-enough-entropy'
const requiredPromptIds = [
  'intent.normalize', 'story.expand', 'script.structure', 'entity.extract', 'style.analyze', 'shot.plan',
  'asset.character_refine', 'asset.location_refine', 'asset.prop_refine', 'continuity.snapshot', 'frame.compose',
  'prompt.image_assemble', 'candidate.critic',
]

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`SMOKE_ASSERTION_FAILED:${message}`)
}

function closeRuntime(runtime: ReturnType<typeof createDirectorApp>): void {
  runtime.io.disconnectSockets(true)
  runtime.io.removeAllListeners()
  runtime.httpServer.removeAllListeners()
  runtime.db.close()
}

export async function runSmoke(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'aigc-director-v2-smoke-'))
  const databasePath = join(directory, 'director.sqlite')
  const exportDirectory = join(directory, 'exports')
  let runtime = createDirectorApp({ databasePath, dataDirectory: directory, sessionToken })

  try {
    invariant(process.env.DEMO_MODE === '1' && process.env.PROVIDER_NETWORK_DISABLED === '1', 'Demo 必须禁用 Provider 网络')
    invariant(runtime.db.schemaVersion() === 9, 'Agent 记忆 checkpoint 要求 schema v9')
    const operationsTables = runtime.db.raw.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('prompt_revisions','artifact_heads','skill_package_versions','golden_evaluations','candidate_batches','provider_media_receipts','memory_documents','memory_chunks','provider_plugin_versions','provider_publishers','agent_run_checkpoints')`).all()
    invariant(operationsTables.length === 11, 'schema v9 必须完整创建 Prompt、CandidateBatch、媒体 receipt、分层记忆、Agent checkpoint、Provider 插件与发布者表')

    const project = runtime.db.createProject({ name: '零付费闭环验收' })
    const imported = runtime.service.importSource(project.id, {
      title: '灯塔来信', content: '第一章 潮声\n林舟抵达废弃灯塔。灯室里留着一封未署名的信。海面忽然出现第二束灯光。',
    })
    invariant(imported.events.length >= 2, '确定性事件提取必须产生可审阅图谱')

    const planning = runtime.service.createPlan(project.id, `smoke-plan-${project.id}`, runtime.memory.checkpointContext(project.id))
    invariant(planning.checkpoint.memoryCitations.length > 0, 'Agent 计划必须持久脱敏记忆 provenance')
    invariant(planning.plan.status === 'awaiting_approval', '高影响操作必须停在审批点')
    const approved = runtime.service.approvePlan(planning.plan.id, planning.approvalToken)
    invariant(approved.shots.length > 0, '审批后必须产生真实镜头领域对象')

    const produced = await runtime.service.runDemoProduction(project.id, `smoke-production-${project.id}`)
    invariant(produced.candidates.length === produced.shots.length * 2, '每个镜头必须获得两个独立 Candidate')
    invariant(produced.candidateBatches.length === produced.shots.length && produced.candidateBatches.every((batch) => batch.status === 'succeeded'), '每个镜头必须保存成功的 CandidateBatch')
    invariant(produced.candidates.every((candidate) => candidate.batchId), '每个 Demo Candidate 必须保存批次 lineage')
    invariant(produced.providerMediaReceipts.length > 0, '有序边界帧输入必须生成脱敏媒体 receipt')
    invariant(requiredPromptIds.every((promptId) => produced.promptRuns.some((run) => run.prompt.id === promptId && run.prompt.version === '1.0.0')), '16 环节必须引用精确版本 Prompt')
    invariant(produced.attempts.length === produced.promptRuns.length && produced.providerReceipts.length === produced.promptRuns.length, 'Attempt 与 Provider receipt 必须覆盖每个 PromptRun')
    invariant(produced.tasks.every((task) => task.provider === 'demo-local' && task.result?.billed === false), 'Demo 任务不得计费')
    invariant(produced.reviews.filter((review) => review.source === 'automatic_critic').length === produced.candidates.length, '每个候选必须有待人工确认的 Critic 证据')
    invariant(produced.artifactVersions.some((artifact) => artifact.stageId === 'frames'), '结构化阶段必须形成 Artifact 依赖链')

    const memoryReport = runtime.memory.rebuild(project.id)
    invariant(memoryReport.created > 0 && memoryReport.skippedSensitive === 0, '批准后的事件和产物必须建立无敏感内容的分层记忆')
    const memoryResults = runtime.memory.search(project.id, '灯塔')
    invariant(memoryResults.length > 0 && memoryResults[0]?.reasons.length, '关键词检索必须返回来源和采用原因')

    let revision = produced.project.graphRevision
    for (const shot of produced.shots) {
      const candidate = produced.candidates.find((item) => item.shotId === shot.id)
      invariant(candidate, `镜头 ${shot.id} 缺少候选`)
      const selection = runtime.service.applyGraphCommand(project.id, 'production', {
        type: 'select_candidate', expectedRevision: revision,
        idempotencyKey: `smoke-select-${shot.id}-${candidate.id}`, shotId: shot.id, candidateId: candidate.id,
      })
      revision = selection.revision
    }

    const exportTask = runtime.service.startExport({ projectId: project.id, outputDirectory: exportDirectory, fileName: 'director-smoke.mp4', width: 320, height: 320, fps: 12 })
    const completed = await runtime.service.waitForTask(exportTask.id)
    invariant(completed.status === 'succeeded', `导出任务必须成功，实际为 ${completed.status}`)
    const videoPath = join(exportDirectory, 'director-smoke.mp4')
    invariant((await stat(videoPath)).size > 1_000, '导出的 MP4 不能为空')
    const probe = await probeMedia(videoPath)
    invariant(probe.durationSeconds > 0 && probe.format.includes('mp4'), 'FFprobe 必须确认有效 MP4')

    const boundarySourceTask = runtime.service.startExport({
      projectId: project.id, outputDirectory: join(directory, 'media', project.id), fileName: 'boundary-source.mp4', width: 320, height: 320, fps: 12,
    })
    const boundarySource = await runtime.service.waitForTask(boundarySourceTask.id)
    const boundarySourceMediaId = typeof boundarySource.result?.mediaId === 'string' ? boundarySource.result.mediaId : undefined
    const firstShot = produced.shots[0]
    invariant(boundarySourceMediaId && firstShot, '真实尾帧验收必须有视频媒体和镜头')
    const videoCandidate = CandidateSchema.parse({
      id: crypto.randomUUID(), projectId: project.id, shotId: firstShot.id, kind: 'video', taskId: boundarySource.id,
      mediaId: boundarySourceMediaId, provider: 'demo-local', model: 'local-ffmpeg', inputSnapshot: { smoke: true },
      status: 'ready', createdAt: new Date().toISOString(),
    })
    runtime.db.put('candidates', project.id, videoCandidate)
    const boundaryTask = runtime.service.startBoundaryExtraction({
      projectId: project.id, shotId: firstShot.id, candidateId: videoCandidate.id, idempotencyKey: `smoke-boundary-${crypto.randomUUID()}`,
    })
    const boundaryCompleted = await runtime.service.waitForTask(boundaryTask.id)
    invariant(boundaryCompleted.status === 'succeeded', '真实尾帧提取任务必须成功')
    invariant(runtime.db.snapshot(project.id).shots[0]?.boundaryFrames.some((frame) => frame.provenance === 'extracted_video'), '尾帧必须绑定到来源视频 Candidate')

    closeRuntime(runtime)
    runtime = createDirectorApp({ databasePath, dataDirectory: directory, sessionToken })
    const restored: ProjectSnapshot = runtime.db.snapshot(project.id)
    invariant(restored.candidates.length === produced.candidates.length + 1, '服务重启后图片与视频 Candidate 必须完整恢复')
    invariant(restored.candidateBatches.length === produced.candidateBatches.length, '服务重启后 CandidateBatch 必须完整恢复')
    invariant(runtime.memory.search(project.id, '灯塔').length > 0, '服务重启后分层记忆必须可检索')
    invariant(restored.promptRuns.length === produced.promptRuns.length, '服务重启后 PromptRun 必须完整恢复')
    invariant(restored.artifactVersions.length >= produced.artifactVersions.length, '服务重启后 ArtifactVersion 必须完整恢复')
    invariant(restored.shots.every((shot) => shot.selectedCandidateId), '人工候选选择必须持久恢复')
    invariant(restored.shots.every((shot) => restored.artifactVersions.some((artifact) => artifact.stageId === `approved-candidate:${shot.id}`)), '批准产物必须持久恢复')
    invariant(restored.tasks.some((task) => task.id === completed.id && task.status === 'succeeded'), '服务重启后导出任务必须可查询')

    closeRuntime(runtime)
    console.log(JSON.stringify({
      ok: true, projectId: project.id, events: restored.events.length, shots: restored.shots.length,
      candidates: restored.candidates.length, promptRuns: restored.promptRuns.length,
      artifacts: restored.artifactVersions.length, reviews: restored.reviews.length,
      exported: 'director-smoke.mp4', paidRequests: 0,
    }))
  } finally {
    if (runtime.db.raw.open) closeRuntime(runtime)
    await rm(directory, { recursive: true, force: true })
  }
}
