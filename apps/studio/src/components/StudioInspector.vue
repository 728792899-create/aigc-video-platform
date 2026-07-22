<template>
  <aside class="inspector" :class="{ 'inspector--empty': !node }" aria-label="领域对象检查器">
    <template v-if="node">
      <header class="inspector__header"><div><span class="eyebrow">INSPECTOR · {{ node.type }}</span><h2>{{ node.label }}</h2></div><button class="icon-button" type="button" aria-label="关闭检查器" @click="store.selectNode()"><X :size="17" /></button></header>
      <p class="inspector__subtitle">{{ node.subtitle }}</p>
      <dl class="inspector__facts"><div><dt>稳定 ID</dt><dd>{{ shortId(node.entityId) }}</dd></div><div><dt>状态</dt><dd><span class="status-pill">{{ node.status }}</span></dd></div><div><dt>图版本</dt><dd>{{ store.graph?.revision ?? 0 }}</dd></div></dl>

      <section v-if="series" class="inspector__section"><h3>Series 连续性</h3><p>{{ series.description || '用于跨集复用艺术方向、资产与上下文。' }}</p><dl class="inspector__facts"><div><dt>艺术方向</dt><dd>{{ series.artDirection || '未设置' }}</dd></div><div><dt>Revision</dt><dd>r{{ series.revision }}</dd></div><div><dt>当前分集</dt><dd>{{ store.snapshot?.episode ? `Episode ${store.snapshot.episode.ordinal + 1}` : '无' }}</dd></div></dl><form class="inspector-inline-form" @submit.prevent="createSeriesAsset"><label for="shared-asset-name">新增 Series 资产</label><input id="shared-asset-name" v-model="sharedAssetName" required maxlength="160" placeholder="例如：主角视觉锚点" /><select v-model="sharedAssetType" aria-label="共享资产类型"><option value="character">角色</option><option value="scene">场景</option><option value="prop">道具</option><option value="style">风格</option><option value="voice">声音</option><option value="music">音乐</option></select><button class="secondary-button" type="submit">创建 Series 资产</button></form></section>
      <section v-if="episode" class="inspector__section">
        <h3>Episode 上下文</h3>
        <dl class="inspector__facts"><div><dt>顺序</dt><dd>{{ episode.ordinal + 1 }}</dd></div><div><dt>Series</dt><dd>{{ store.snapshot?.series?.name ?? 'Standalone' }}</dd></div><div><dt>Revision</dt><dd>r{{ episode.revision }}</dd></div></dl>
        <form v-if="!episode.seriesId" class="inspector-inline-form" @submit.prevent="store.createSeriesAndAttach(seriesName)"><input v-model="seriesName" required maxlength="160" placeholder="新 Series 名称" /><button class="secondary-button" type="submit">创建并加入</button></form>
        <div v-if="store.episodeContinuity?.previous" class="continuity-summary" :class="{ 'continuity-summary--stale': store.episodeContinuity.previous.stale }">
          <strong>上一集摘要</strong>
          <p>{{ store.episodeContinuity.previous.summary?.summary ?? '尚未生成上一集摘要。' }}</p>
          <small v-if="store.episodeContinuity.previous.stale">已过期：{{ store.episodeContinuity.previous.staleReasons.join('、') }}</small>
          <small v-else>固定到 Source r{{ store.episodeContinuity.previous.summary?.source.revision }}</small>
        </div>
        <div class="continuity-summary" :class="{ 'continuity-summary--stale': store.episodeContinuity?.current.stale }">
          <strong>本集交接摘要</strong>
          <p>{{ store.episodeContinuity?.current.summary?.summary ?? '生成后可供下一集引用。' }}</p>
          <small v-if="store.episodeContinuity?.current.stale">状态：{{ store.episodeContinuity.current.staleReasons.join('、') }}</small>
          <button class="secondary-button" type="button" :disabled="!store.episodeContinuity?.current.currentSource || store.loading" @click="requestContinuitySummary">
            {{ continuityArmed ? '确认固定当前 Source revision' : store.episodeContinuity?.current.artifact ? '重新生成摘要' : '生成跨集摘要' }}
          </button>
        </div>
      </section>
      <CreativeBriefPanel
        v-if="project && store.creativeBrief"
        :state="store.creativeBrief"
        @save="store.saveCreativeBrief"
        @generate="store.generateCreativeBriefCandidates"
        @review="store.reviewCreativeBriefCandidate"
      />

      <section v-if="event" class="inspector__section"><h3>原文证据</h3><p>{{ event.summary }}</p><div class="source-range">{{ event.sourceStart }}–{{ event.sourceEnd }} · revision {{ event.revision }}</div><h3>锁定事实</h3><p v-if="event.lockedFacts.length === 0" class="muted">尚未锁定事实</p><ul v-else><li v-for="fact in event.lockedFacts" :key="fact">{{ fact }}</li></ul></section>
      <section v-if="shot" class="inspector__section"><h3>镜头描述</h3><p>{{ shot.description }}</p><h3>视觉 Prompt</h3><pre>{{ shot.visualPrompt }}</pre><dl class="inspector__facts"><div><dt>时长</dt><dd>{{ (shot.durationMs / 1000).toFixed(1) }} 秒</dd></div><div><dt>候选</dt><dd>{{ shotCandidates.length }}</dd></div><div><dt>资产绑定</dt><dd>{{ shotBindings.length }}</dd></div></dl><ShotContinuityPanel :shot="shot" :can-link-previous="shot.ordinal > 0" @save-beats="store.updateShotBeats(shot.id, $event)" @link-previous="store.linkPreviousBoundary(shot.id)" @clear-frame="store.clearBoundaryFrame(shot.id, $event)" /><h3>绑定分层资产</h3><div class="inspector-candidate-list"><button v-for="asset in availableAssets.slice(0, 8)" :key="asset.assetId" type="button" @click="store.previewShotBinding(shot.id, asset)"><span>{{ asset.name }}</span><small>{{ asset.source }} · r{{ asset.revision }}</small></button></div><h3>候选评审</h3><CandidateReviewPanel :candidates="shotCandidates" :batches="shotBatches" :selected-candidate-id="shot.selectedCandidateId" @open-candidate="store.selectNode(`candidate:${$event}`)" @select-candidate="store.selectCandidate(shot.id, $event)" @annotate="store.annotateCandidate" @retry-failed-batch="store.retryFailedCandidateBatch" /></section>
      <section v-if="resolvedAsset" class="inspector__section"><h3>资产来源与影响</h3><dl class="inspector__facts"><div><dt>作用域</dt><dd>{{ resolvedAsset.source }}</dd></div><div><dt>Revision</dt><dd>r{{ resolvedAsset.revision }}</dd></div><div><dt>Variant</dt><dd>{{ shortId(resolvedAsset.variantId) }}</dd></div><div><dt>受影响镜头</dt><dd>{{ assetBindings.length }}</dd></div></dl><p v-if="assetBindings.some((binding) => binding.drifted)" class="error-copy">共享 revision 已变化；旧候选仍保留，请预览后修复绑定。</p><div class="inspector-action-row"><button v-if="resolvedAsset.assetKind === 'shared'" class="secondary-button" type="button" @click="store.forkResolvedAsset(resolvedAsset)">Fork 到当前 Episode</button><button v-else class="secondary-button" type="button" @click="store.promoteResolvedAsset(resolvedAsset)">Promote 共享副本</button></div><div v-for="binding in assetBindings" :key="binding.id" class="binding-impact"><span>{{ binding.slot }} · {{ shortId(binding.shotId) }}</span><button v-if="binding.drifted" class="secondary-button" type="button" @click="store.previewBindingRepair(binding)">预览修复</button></div></section>
      <section v-if="candidate" class="inspector__section"><h3>候选预览</h3><MediaPreview v-if="candidateMedia" :project-id="candidate.projectId" :locator="candidateMedia.locator" /><p v-else class="muted">候选没有可用媒体引用。</p><dl class="inspector__facts"><div><dt>Provider</dt><dd>{{ candidate.provider }}</dd></div><div><dt>Model</dt><dd>{{ candidate.model }}</dd></div><div><dt>评审</dt><dd>{{ candidateApproved ? '已批准' : '待人工选择' }}</dd></div></dl><CandidateEvidence :candidate="candidate" :reviews="store.snapshot?.reviews ?? []" :artifacts="store.snapshot?.artifactVersions ?? []" /><button v-if="candidateShot && !candidateApproved" class="primary-button inspector__action" type="button" @click="store.selectCandidate(candidateShot.id, candidate.id)">批准并绑定此候选</button></section>
      <section v-if="task" class="inspector__section"><h3>任务诊断</h3><dl class="inspector__facts"><div><dt>阶段</dt><dd>{{ task.stage }}</dd></div><div><dt>Attempt</dt><dd>{{ task.attempt }}</dd></div><div><dt>可重试</dt><dd>{{ task.retryable ? '是' : '否' }}</dd></div><div><dt>Provider receipt</dt><dd>{{ taskReceipt ? shortId(taskReceipt.remoteJobId) : task.result?.reconciled ? '通过幂等键对账' : '无' }}</dd></div></dl><p v-if="task.error" class="error-copy">{{ task.error.userMessage }}<small>{{ task.error.correlationId }}</small></p></section>
      <section v-if="taskArtifact" class="inspector__section artifact-evidence"><h3>阶段产物证据</h3><dl class="inspector__facts"><div><dt>产物</dt><dd>{{ taskArtifact.artifactType }}</dd></div><div><dt>Stage</dt><dd>{{ taskArtifact.stageId }}</dd></div><div><dt>Revision</dt><dd>r{{ taskArtifact.revision }}</dd></div><div><dt>Content hash</dt><dd>{{ shortId(taskArtifact.contentHash) }}</dd></div><div><dt>上游依赖</dt><dd>{{ taskArtifact.dependencies.length }}</dd></div><div><dt>状态</dt><dd>{{ taskArtifact.status }}</dd></div></dl><ArtifactHistoryPanel :artifact="taskArtifact" /></section>
      <section v-if="activePromptRun" class="inspector__section prompt-provenance"><h3>Prompt 运行证据</h3><dl class="inspector__facts"><div><dt>Prompt</dt><dd>{{ activePromptRun.prompt.id }}@{{ activePromptRun.prompt.version }}</dd></div><div><dt>Provider Profile</dt><dd>{{ activePromptRun.providerProfile.id }}@{{ activePromptRun.providerProfile.version }}</dd></div><div><dt>Compiled hash</dt><dd>{{ shortId(activePromptRun.compiledHash) }}</dd></div><div><dt>Skill</dt><dd>{{ activePromptRun.skills.length }}</dd></div></dl><details><summary>查看中文审阅与固定 Skill</summary><p>{{ activePromptRun.compiled.zhReview }}</p><ul><li v-for="skill in activePromptRun.skills" :key="`${skill.id}@${skill.version}`">{{ skill.id }}@{{ skill.version }}</li></ul></details></section>
      <section v-if="store.pendingBatchBind" class="inspector__section approval-card"><h3>批量改绑确认</h3><p>{{ store.pendingBatchBind.changed.length }} 个镜头将更新，{{ store.pendingBatchBind.conflicts.length }} 个冲突。确认后在单个事务内应用。</p><div class="inspector-action-row"><button class="primary-button" type="button" :disabled="store.pendingBatchBind.conflicts.length > 0" @click="store.applyPendingBatchBind">确认应用</button><button class="secondary-button" type="button" @click="store.pendingBatchBind = undefined">取消</button></div></section>
      <section v-if="store.pendingReconcile" class="inspector__section approval-card"><h3>Revision drift 修复确认</h3><p>{{ store.pendingReconcile.changed.length }} 个绑定将更新；历史 Candidate 与 Provider 快照不会删除。</p><div class="inspector-action-row"><button class="primary-button" type="button" :disabled="store.pendingReconcile.conflicts.length > 0" @click="store.applyPendingReconcile">确认修复</button><button class="secondary-button" type="button" @click="store.pendingReconcile = undefined">取消</button></div></section>
      <section v-if="!event && !shot && !candidate && !task && !series && !episode && !project && !resolvedAsset" class="inspector__section"><h3>结构化数据</h3><pre>{{ prettyEntity }}</pre></section>
    </template>
    <template v-else><MousePointer2 :size="24" /><h2>选择一个节点</h2><p>Inspector 会显示来源、版本、任务和可修复问题。</p></template>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { MousePointer2, X } from 'lucide-vue-next'
import type { Candidate, Episode, GenerationTask, Project, PromptRun, ResolvedAsset, Series, SharedAsset, Shot, StoryEvent } from '@aigc-director/contracts'
import { useStudioStore } from '../stores/studio.js'
import CandidateEvidence from './CandidateEvidence.vue'
import CandidateReviewPanel from './CandidateReviewPanel.vue'
import CreativeBriefPanel from './CreativeBriefPanel.vue'
import ArtifactHistoryPanel from './ArtifactHistoryPanel.vue'
import MediaPreview from './MediaPreview.vue'
import ShotContinuityPanel from './ShotContinuityPanel.vue'

const store = useStudioStore()
const node = computed(() => store.selectedNode)
const seriesName = ref('')
const sharedAssetName = ref('')
const sharedAssetType = ref<SharedAsset['type']>('character')
const continuityArmed = ref(false)
const series = computed(() => node.value?.type === 'series' ? store.selectedEntity as Series : undefined)
const episode = computed(() => node.value?.type === 'episode' ? store.selectedEntity as Episode : undefined)
const project = computed(() => node.value?.type === 'project' ? store.selectedEntity as Project : undefined)
const event = computed(() => node.value?.type === 'event' ? store.selectedEntity as StoryEvent : undefined)
const shot = computed(() => node.value?.type === 'shot' || node.value?.type === 'track' ? store.selectedEntity as Shot : undefined)
const candidate = computed(() => node.value?.type === 'candidate' ? store.selectedEntity as Candidate : undefined)
const task = computed(() => node.value?.type === 'task' ? store.selectedEntity as GenerationTask : undefined)
const resolvedAsset = computed(() => node.value?.type === 'asset' ? store.selectedEntity as ResolvedAsset : undefined)
const availableAssets = computed(() => store.snapshot?.resolvedAssets ?? [])
const shotBindings = computed(() => store.snapshot?.assetBindings.filter((binding) => binding.shotId === shot.value?.id) ?? [])
const assetBindings = computed(() => store.snapshot?.assetBindings.filter((binding) => binding.assetId === resolvedAsset.value?.assetId) ?? [])
const shotCandidates = computed(() => store.snapshot?.candidates.filter((item) => item.shotId === shot.value?.id) ?? [])
const shotBatches = computed(() => store.snapshot?.candidateBatches.filter((item) => item.shotId === shot.value?.id) ?? [])
const candidateMedia = computed(() => store.snapshot?.media.find((item) => item.id === candidate.value?.mediaId))
const candidateShot = computed(() => store.snapshot?.shots.find((item) => item.id === candidate.value?.shotId))
const candidateApproved = computed(() => candidateShot.value?.selectedCandidateId === candidate.value?.id)
const activePromptRun = computed<PromptRun | undefined>(() => {
  const promptRunId = task.value?.promptRunId ?? candidate.value?.promptRevisionId
  return store.snapshot?.promptRuns.find((run) => run.id === promptRunId)
})
const taskReceipt = computed(() => store.snapshot?.providerReceipts.find((receipt) => receipt.taskId === task.value?.id))
const taskArtifact = computed(() => {
  const artifactVersionId = task.value?.result?.artifactVersionId
  return typeof artifactVersionId === 'string'
    ? store.snapshot?.artifactVersions.find((artifact) => artifact.id === artifactVersionId)
    : undefined
})
const prettyEntity = computed(() => JSON.stringify(store.selectedEntity, null, 2))
const shortId = (value: string): string => `${value.slice(0, 8)}…${value.slice(-4)}`
async function createSeriesAsset(): Promise<void> {
  const created = await store.createSharedAsset({ name: sharedAssetName.value, type: sharedAssetType.value, scope: 'series' })
  if (created) sharedAssetName.value = ''
}
async function requestContinuitySummary(): Promise<void> {
  if (!continuityArmed.value) {
    continuityArmed.value = true
    return
  }
  continuityArmed.value = false
  await store.createEpisodeContinuitySummary()
}
</script>
