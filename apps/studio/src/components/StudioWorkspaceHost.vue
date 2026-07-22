<template>
  <ProjectCenterWorkspace
    v-if="workspaceId === 'project_center'"
    @start-setup="$emit('startSetup')"
    @select-project="$emit('selectProject', $event)"
    @resume-project="$emit('resumeProject', $event)"
  />
  <ProviderConnectionsWorkspace v-else-if="workspaceId === 'provider_connections'" />
  <GenerationWorkspace v-else-if="workspaceId === 'generation'" @navigate="$emit('navigate', $event)" />
  <ReviewWorkspace v-else-if="workspaceId === 'review' && store.snapshot" @navigate="$emit('navigate', $event)" />
  <TimelineWorkspace v-else-if="workspaceId === 'timeline' && store.snapshot" @navigate="$emit('navigate', $event)" />
  <TaskCenterWorkspace v-else-if="workspaceId === 'tasks'" />
  <LocalGovernanceWorkspace v-else-if="workspaceId === 'local_governance'" />
  <ExportSettingsWorkspace v-else-if="workspaceId === 'export_settings' && store.snapshot" @navigate="$emit('navigate', $event)" />
  <section v-else-if="workspaceId === 'brief'" class="brief-workspace">
    <CreativeBriefPanel
      v-if="store.creativeBrief"
      :state="store.creativeBrief"
      :busy="store.loading"
      @save="store.saveCreativeBrief"
      @generate="store.generateCreativeBriefCandidates"
      @review="store.reviewCreativeBriefCandidate"
      @approve="approveBrief"
    />
    <div v-else class="workspace-empty-state"><p>选择项目后才能编辑创作简报。</p><button class="primary-button" type="button" @click="$emit('openProject')">创建或打开项目</button></div>
  </section>
  <ScriptWorkspace
    v-else-if="workspaceId === 'script' && store.snapshot"
    :snapshot="store.snapshot"
    :creative-brief-revision="store.creativeBrief?.artifact?.revision ?? 1"
    @navigate="$emit('navigate', $event)"
  />
  <AssetsWorkspace
    v-else-if="workspaceId === 'assets' && store.snapshot"
    :snapshot="store.snapshot"
  />
  <ShotsWorkspace
    v-else-if="workspaceId === 'shots' && store.snapshot"
    :snapshot="store.snapshot"
    @navigate="$emit('navigate', $event)"
  />
  <ContinuityWorkspace
    v-else-if="workspaceId === 'continuity' && store.snapshot"
    :snapshot="store.snapshot"
    @navigate="$emit('navigate', $event)"
    @prepare-repair="prepareContinuityRepair"
  />
  <section v-else-if="workspaceId === 'prompt_skill'" class="prompt-skill-workspace"><PromptOperationsWorkspace /></section>
  <div v-else class="studio-workspace studio-workspace--agent">
    <AgentPanel ref="agentPanelRef" />
    <section data-onboarding-target="canvas" class="graph-stage surface-cinema" :class="{ 'graph-stage--list': listMode, 'graph-stage--delivery': view === 'delivery' }">
      <DomainCanvas
        v-if="!listMode"
        :graph="graph"
        @select="$emit('select', $event)"
        @move="$emit('move', $event)"
        @connect="forwardConnect"
      >
        <template #empty-action>
          <SourceComposer v-if="hasProject"><button class="primary-button" type="button"><BookPlus :size="16" />导入原著并生成故事结构</button></SourceComposer>
          <button v-else class="primary-button" type="button" @click="$emit('openProject')"><FolderPlus :size="16" />创建或打开项目</button>
        </template>
      </DomainCanvas>
      <div v-else class="domain-list" role="list" aria-label="领域对象列表">
        <button v-for="node in graph.nodes" :key="node.id" type="button" :class="{ active: node.id === selectedNodeId }" @click="$emit('select', node.id)"><span :class="`node-dot node-dot--${node.status}`" /><span><strong>{{ node.label }}</strong><small>{{ node.type }} · {{ node.subtitle }}</small></span></button>
        <p v-if="graph.nodes.length === 0" class="muted">当前领域图还没有对象。请使用上方主操作完成前置阶段。</p>
      </div>
      <DeliveryPanel v-if="view === 'delivery' && hasProject" />
    </section>
    <div data-onboarding-target="inspector" class="inspector-host"><StudioInspector /></div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { BookPlus, FolderPlus } from 'lucide-vue-next'
import type { CreativeBrief, GraphProjection } from '@aigc-director/contracts'
import AgentPanel from './AgentPanel.vue'
import AssetsWorkspace from './AssetsWorkspace.vue'
import CreativeBriefPanel from './CreativeBriefPanel.vue'
import ContinuityWorkspace from './ContinuityWorkspace.vue'
import DeliveryPanel from './DeliveryPanel.vue'
import DomainCanvas from './DomainCanvas.vue'
import ExportSettingsWorkspace from './ExportSettingsWorkspace.vue'
import LocalGovernanceWorkspace from './LocalGovernanceWorkspace.vue'
import ProjectCenterWorkspace from './ProjectCenterWorkspace.vue'
import PromptOperationsWorkspace from './PromptOperationsWorkspace.vue'
import ScriptWorkspace from './ScriptWorkspace.vue'
import ShotsWorkspace from './ShotsWorkspace.vue'
import SourceComposer from './SourceComposer.vue'
import StudioInspector from './StudioInspector.vue'
import ProviderConnectionsWorkspace from './ProviderConnectionsWorkspace.vue'
import GenerationWorkspace from './GenerationWorkspace.vue'
import ReviewWorkspace from './ReviewWorkspace.vue'
import TimelineWorkspace from './TimelineWorkspace.vue'
import TaskCenterWorkspace from './TaskCenterWorkspace.vue'
import type { StudioWorkspaceId } from '../workspaces.js'
import { useStudioStore } from '../stores/studio.js'

defineProps<{
  graph: GraphProjection
  view: GraphProjection['view']
  listMode: boolean
  hasProject: boolean
  selectedNodeId: string | undefined
  workspaceId: StudioWorkspaceId
}>()

const emit = defineEmits<{
  select: [nodeId?: string]
  move: [positions: Record<string, { x: number; y: number }>]
  connect: [sourceNodeId: string, targetNodeId: string]
  openProject: []
  startSetup: []
  selectProject: [projectId: string]
  resumeProject: [projectId: string]
  navigate: [workspaceId: StudioWorkspaceId]
}>()

const store = useStudioStore()
const agentPanelRef = ref<{ openPanel: () => Promise<void> }>()
function forwardConnect(sourceNodeId: string, targetNodeId: string): void { emit('connect', sourceNodeId, targetNodeId) }
async function openAgent(): Promise<void> { await agentPanelRef.value?.openPanel() }
async function approveBrief(payload: { brief: CreativeBrief; candidateId?: string }): Promise<void> {
  const saved = payload.candidateId
    ? await store.reviewCreativeBriefCandidate(payload.candidateId, 'approve')
    : await store.saveCreativeBrief(payload.brief)
  if (!saved || store.error) return
  if (!store.snapshot?.scenes.length) {
    if (!store.currentPlan || store.currentPlan.status !== 'awaiting_approval' || !store.approvalToken) await store.createPlan()
    if (store.currentPlan?.status === 'awaiting_approval' && store.approvalToken) await store.approvePlan()
  }
  if (!store.error) emit('navigate', 'script')
}
function prepareContinuityRepair(request: { conflictId: string; label: string; shotId?: string }): void {
  if (request.shotId) store.selectNode(`shot:${request.shotId}`)
  store.message = request.conflictId === 'continuity-approved'
    ? '连续性检查已确认；请在生成队列确认执行范围。'
    : `已锁定“${request.label}”的局部修复范围；请在生成队列确认后创建任务。`
  emit('navigate', 'generation')
}
defineExpose({ openAgent })
</script>
