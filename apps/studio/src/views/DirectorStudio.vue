<template>
  <section v-if="sessionExpired" class="local-session-expired" role="alert" aria-labelledby="local-session-expired-title">
    <div class="local-session-expired__card">
      <TriangleAlert :size="28" aria-hidden="true" />
      <p class="eyebrow">LOCAL SESSION</p>
      <h1 id="local-session-expired-title">本地会话需要重新建立</h1>
      <p>服务已重新启动，旧页面不能继续提交操作。项目、媒体和任务快照仍保存在本机，不会因此丢失。</p>
      <ol>
        <li>重新运行本地启动命令，等待浏览器自动打开工作室。</li>
        <li>如果启动器已经打开了新页面，可以直接关闭这个旧标签页。</li>
        <li>不要重复点击生成或导出；恢复后会先读取原任务状态。</li>
      </ol>
      <a :href="sessionRecoveryAction">重新建立本地会话</a>
      <small>错误代码：UNAUTHORIZED · 未调用任何付费 Provider</small>
    </div>
  </section>
  <NewProjectWorkspace v-else-if="isProjectSetup" />
  <main
    v-else
    class="studio-shell"
    :class="{ 'studio-shell--sidebar-collapsed': sidebarCollapsed }"
    :data-view="store.view"
    :data-workspace="currentWorkspace.id"
    data-desktop-smoke-ready="aigc-director-studio"
  >
    <StudioSidebar
      :current-id="currentWorkspace.id"
      :facts="workspaceFacts"
      :completed-ids="completedWorkspaceIds"
      :collapsed="sidebarCollapsed"
      @navigate="navigateWorkspace"
      @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
      @open-command="commandOpen = true"
      @open-help="helpOpen = true"
    />

    <section class="studio-main" :class="{ 'studio-main--project-hub': isProjectArea, 'studio-main--figma-screen': isFigmaV2Workspace, 'studio-main--task-screen': currentWorkspace.id === 'tasks', 'studio-main--prompt-screen': currentWorkspace.id === 'prompt_skill', 'studio-main--provider-screen': currentWorkspace.id === 'provider_connections', 'studio-main--governance-screen': currentWorkspace.id === 'local_governance' }">
      <header class="studio-topbar">
        <button class="studio-topbar__context" type="button" @click="projectSwitcherRef?.openSwitcher()">
          <template v-if="currentWorkspace.id === 'tasks'">
            <strong>任务中心与诊断</strong>
            <small>Attempt、成本、对账、取消语义和恢复证据</small>
          </template>
          <template v-else-if="currentWorkspace.id === 'prompt_skill'">
            <strong>Prompt 与 Skill Registry</strong>
            <small>不可变 revision、离线评测、发布和一键恢复</small>
          </template>
          <template v-else-if="currentWorkspace.id === 'provider_connections'">
            <strong>Provider 与模型连接</strong>
            <small>本机私有连接、中转站校验与模型能力绑定</small>
          </template>
          <template v-else-if="currentWorkspace.id === 'local_governance'">
            <strong>本地安全、凭证与备份</strong>
            <small>系统 Keychain、诊断脱敏、项目包备份与本地恢复验证</small>
          </template>
          <template v-else-if="currentWorkspace.id === 'export_settings'">
            <strong>导出与交付</strong>
            <small>预检、母版导出、项目包和可恢复备份</small>
          </template>
          <template v-else>{{ isProjectArea ? '组织 / 星阙制作组' : projectEpisodeLabel }}</template>
        </button>
        <span>{{ topbarStatus }}</span>
        <div class="studio-project-switcher-host" aria-hidden="true"><ProjectSwitcher ref="projectSwitcherRef" /></div>
      </header>

      <StudioStageNavigation v-if="!isProjectArea && !isOperationsWorkspace && workspaceFacts.hasProject" :current-id="currentWorkspace.id" :facts="workspaceFacts" :completed-ids="completedWorkspaceIds" @navigate="navigateWorkspace" />

      <section class="studio-mode" :class="{ 'studio-mode--project-hub': isProjectArea, 'studio-mode--figma-screen': isFigmaV2Workspace }">
          <div v-if="!isProjectArea" class="view-toolbar">
            <div><span class="eyebrow">{{ viewMeta.eyebrow }}</span><h2>{{ viewMeta.title }}</h2><p>{{ viewMeta.description }}</p></div>
            <div class="view-toolbar__actions">
              <SourceComposer v-if="store.currentProjectId" ref="sourceComposerRef"><button class="secondary-button" data-guide-target="source-import" type="button"><BookPlus :size="16" />导入原著</button></SourceComposer>
              <button class="icon-button" type="button" :class="{ active: listMode }" :aria-pressed="listMode" aria-label="切换列表视图" @click="listMode = !listMode"><List :size="18" /></button>
            </div>
          </div>

          <StudioWorkspaceHeader
            v-if="!isProjectArea"
            :definition="currentWorkspace"
            :availability="currentAvailability"
            :next-available="nextWorkspaceAvailable"
            :busy="store.loading"
            :return-label="currentWorkspace.id === 'tasks' && returnTo ? `返回${workspaceById(returnTo.workspace).shortTitle}` : undefined"
            @navigate="navigateWorkspace"
            @primary="runWorkspacePrimary"
            @help="helpOpen = true"
            @return-to-source="returnFromTasks"
          />

          <div v-if="!isProjectArea" data-onboarding-target="journey-guide"><StudioJourneyGuide @navigate="handleGuideNavigate" /></div>

          <StudioWorkspaceHost
            ref="workspaceHostRef"
            :graph="visibleGraph"
            :view="store.view"
            :list-mode="listMode"
            :has-project="Boolean(store.currentProjectId)"
            :selected-node-id="store.selectedNodeId"
            :workspace-id="currentWorkspace.id"
            @select="store.selectNode"
            @move="store.moveNodes"
            @connect="store.connectEvents"
            @open-project="projectSwitcherRef?.openSwitcher()"
            @start-setup="navigateWorkspace('project_setup')"
            @select-project="openProjectById"
            @resume-project="resumeProjectById"
            @navigate="navigateWorkspace"
          />
      </section>
    </section>

    <TaskTray v-if="!isProjectArea && !isFigmaV2Workspace" ref="taskTrayRef" />
    <div v-if="store.loading" class="global-progress" role="progressbar" aria-label="正在处理当前操作"><i /></div>
    <div v-if="store.error" class="toast toast--error" role="alert"><TriangleAlert :size="17" /><span><strong>{{ store.error.message }}</strong><small>{{ store.error.code }} · {{ store.error.correlationId }}</small></span><button class="icon-button" type="button" aria-label="关闭错误" @click="store.error = undefined"><X :size="15" /></button></div>
    <div v-else-if="store.message" class="toast" role="status"><CircleCheck :size="17" /><span>{{ store.message }}</span><button class="icon-button" type="button" aria-label="关闭提示" @click="store.message = ''"><X :size="15" /></button></div>

    <StudioDialogs
      v-if="commandOpen || systemsOpen"
      :command-open="commandOpen"
      :systems-open="systemsOpen"
      :views="views"
      :workspaces="workspaceDefinitions"
      :has-project="Boolean(store.currentProjectId)"
      :prompt-pack="store.promptPack"
      :evidence="executionEvidence"
      @update:command-open="commandOpen = $event"
      @update:systems-open="systemsOpen = $event"
      @select-view="setView"
      @select-workspace="navigateWorkspace"
      @create-plan="store.createPlan"
    />
    <StudioHelpDrawer v-model:open="helpOpen" :definition="currentWorkspace" @open-tasks="openTaskCenter" @restart-guide="onboardingRef?.restart()" />
    <StudioOnboarding v-if="!isProjectArea && !isFigmaV2Workspace" ref="onboardingRef" :active-workspace="currentWorkspace.id" @navigate="navigateWorkspace" @open-help="helpOpen = true" />
  </main>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookPlus, CircleCheck, Clapperboard, GitBranch, List, PackageOpen, TriangleAlert, X } from 'lucide-vue-next'
import type { GraphProjection } from '@aigc-director/contracts'
import StudioHelpDrawer from '../components/StudioHelpDrawer.vue'
import StudioJourneyGuide from '../components/StudioJourneyGuide.vue'
import StudioOnboarding from '../components/StudioOnboarding.vue'
import NewProjectWorkspace from '../components/NewProjectWorkspace.vue'
import StudioSidebar from '../components/StudioSidebar.vue'
import StudioStageNavigation from '../components/StudioStageNavigation.vue'
import StudioWorkspaceHeader from '../components/StudioWorkspaceHeader.vue'
import StudioWorkspaceHost from '../components/StudioWorkspaceHost.vue'
import TaskTray from '../components/TaskTray.vue'
import type { StudioGuideAction } from '../guidance.js'
import { browserPreviewRecorderStorage, isBrowserPreviewRecorderEnabled, recordPreviewEvent } from '../previewRecorder.js'
import { useStudioStore } from '../stores/studio.js'
import {
  STUDIO_WORKSPACES, focusGraphForWorkspace, resolveStudioWorkspace, workspaceAvailability, workspaceById, workspaceForLegacyView,
  type StudioWorkspaceFacts, type StudioWorkspaceId,
} from '../workspaces.js'

const StudioDialogs = defineAsyncComponent(() => import('../components/StudioDialogs.vue'))
const ProjectSwitcher = defineAsyncComponent(() => import('../components/ProjectSwitcher.vue'))
const SourceComposer = defineAsyncComponent(() => import('../components/SourceComposer.vue'))

const store = useStudioStore()
const route = useRoute()
const router = useRouter()
const listMode = ref(false)
const sidebarCollapsed = ref(false)
const commandOpen = ref(false)
const systemsOpen = ref(false)
const helpOpen = ref(false)
const initialized = ref(false)
const currentWorkspaceId = ref<StudioWorkspaceId>('project_center')
const returnTo = ref<{ workspace: StudioWorkspaceId; scrollTop: number }>()
const projectSwitcherRef = ref<{ openSwitcher: () => Promise<void> }>()
const sourceComposerRef = ref<{ openComposer: () => Promise<void> }>()
const workspaceHostRef = ref<{ openAgent: () => Promise<void> }>()
const taskTrayRef = ref<{ openTray: () => Promise<void> }>()
const onboardingRef = ref<{ restart: () => void }>()
const workspaceDefinitions = STUDIO_WORKSPACES

const views: ReadonlyArray<{ id: GraphProjection['view']; label: string; eyebrow: string; title: string; description: string; shortcut: string; icon: Component }> = [
  { id: 'story', label: '故事事件图', eyebrow: 'STORY GRAPH', title: '章节事件与改编', description: '追踪原文证据、人物状态、伏笔与因果。', shortcut: '1', icon: markRaw(GitBranch) },
  { id: 'production', label: '生产关系图', eyebrow: 'PRODUCTION GRAPH', title: '镜头、资产与候选', description: '把已批准场景组织成可审阅的媒体生产图。', shortcut: '2', icon: markRaw(Clapperboard) },
  { id: 'delivery', label: '交付装配图', eyebrow: 'DELIVERY GRAPH', title: '轨道、任务与导出', description: '装配已选候选，查看恢复状态并导出。', shortcut: '3', icon: markRaw(PackageOpen) },
]
const viewMeta = computed(() => views.find((item) => item.id === store.view) ?? views[0]!)
const currentWorkspace = computed(() => workspaceById(currentWorkspaceId.value))
const sessionExpired = computed(() => store.error?.code === 'UNAUTHORIZED')
const sessionRecoveryAction = computed(() => `/?return=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`)
const isProjectSetup = computed(() => currentWorkspaceId.value === 'project_setup')
const isProjectArea = computed(() => currentWorkspaceId.value === 'project_center')
const isOperationsWorkspace = computed(() => ['tasks', 'prompt_skill', 'provider_connections', 'local_governance'].includes(currentWorkspaceId.value))
const isFigmaV2Workspace = computed(() => ['brief', 'script', 'assets', 'shots', 'continuity', 'generation', 'review', 'timeline', 'prompt_skill', 'provider_connections', 'local_governance', 'tasks', 'export_settings'].includes(currentWorkspaceId.value))
const topbarStatus = computed(() => {
  if (isProjectArea.value) return '本机模式 · 零 Key Demo'
  if (currentWorkspaceId.value === 'review') return `本机自动保存 · ${store.snapshot?.reviews.length ?? 0} 条审阅证据`
  if (currentWorkspaceId.value === 'timeline') {
    const shots = store.snapshot?.shots ?? []
    const selected = shots.filter((shot) => shot.selectedCandidateId).length
    return `本机自动保存 · 装配 ${selected} / ${shots.length}`
  }
  if (currentWorkspaceId.value === 'export_settings') return store.loading ? '本机自动保存 · 正在处理' : '本机自动保存'
  if (currentWorkspaceId.value === 'tasks') return `Demo · 付费请求 ${store.taskAdmission?.dailyPaidSpentMicros ? '受预算门禁' : '0'}`
  if (currentWorkspaceId.value === 'prompt_skill') return 'Demo · 付费请求 0'
  if (currentWorkspaceId.value === 'provider_connections') return '网络已关闭 · 付费请求 0'
  if (currentWorkspaceId.value === 'local_governance') return 'Local-only'
  if (currentWorkspaceId.value !== 'generation') return store.loading ? '本机自动保存 · 正在保存' : '本机自动保存 · 已保存'
  const running = store.tasks.filter((task) => ['running', 'retrying', 'reconciling'].includes(task.status)).length
  const waiting = store.tasks.filter((task) => ['queued', 'waiting_approval', 'cancel_requested'].includes(task.status)).length
  const failed = store.tasks.filter((task) => ['failed', 'timed_out', 'outcome_unknown', 'needs_attention'].includes(task.status)).length
  return `运行 ${running} · 等待 ${waiting} · 失败 ${failed}`
})
const projectEpisodeLabel = computed(() => {
  const name = store.currentProject?.name ?? '未选择项目'
  const wrapped = name.startsWith('《') && name.endsWith('》') ? name : `《${name}》`
  return `${wrapped} · 第 01 集`
})
const placeholderProjectId = '00000000-0000-4000-8000-000000000000'
const rawGraph = computed<GraphProjection>(() => store.graph ?? { projectId: store.currentProjectId ?? placeholderProjectId, view: store.view, revision: 0, nodes: [], edges: [], generatedAt: new Date().toISOString() })
const visibleGraph = computed<GraphProjection>(() => focusGraphForWorkspace(rawGraph.value, currentWorkspaceId.value))
const workspaceFacts = computed<StudioWorkspaceFacts>(() => {
  const snapshot = store.snapshot
  const shots = snapshot?.shots ?? []
  return {
    hasProject: Boolean(store.currentProjectId && snapshot),
    hasSource: Boolean(snapshot?.sources.length),
    hasPlan: Boolean(snapshot?.plans.length),
    hasShots: shots.length > 0,
    hasCandidates: Boolean(snapshot?.candidates.length),
    hasApprovedCandidates: shots.length > 0 && shots.every((shot) => Boolean(shot.selectedCandidateId)),
  }
})
const currentAvailability = computed(() => workspaceAvailability(currentWorkspace.value, workspaceFacts.value))
const nextWorkspaceAvailable = computed(() => currentWorkspace.value.next ? workspaceAvailability(workspaceById(currentWorkspace.value.next), workspaceFacts.value).available : false)
const completedWorkspaceIds = computed<ReadonlySet<StudioWorkspaceId>>(() => {
  const facts = workspaceFacts.value
  const completed = new Set<StudioWorkspaceId>()
  if (facts.hasProject) ['project_center', 'project_setup', 'canvas'].forEach((id) => completed.add(id as StudioWorkspaceId))
  if (store.creativeBrief?.artifact) completed.add('brief')
  if (facts.hasSource) completed.add('script')
  if (store.snapshot?.resolvedAssets.length) completed.add('assets')
  if (facts.hasShots) ['shots', 'continuity'].forEach((id) => completed.add(id as StudioWorkspaceId))
  if (facts.hasCandidates) completed.add('generation')
  if (facts.hasApprovedCandidates) ['review', 'timeline'].forEach((id) => completed.add(id as StudioWorkspaceId))
  if (store.promptPack) completed.add('prompt_skill')
  if (!store.tasks.some((task) => ['outcome_unknown', 'orphaned', 'needs_attention', 'failed', 'timed_out'].includes(task.status))) completed.add('tasks')
  if (store.tasks.some((task) => task.type === 'export' && task.status === 'succeeded')) completed.add('export_settings')
  return completed
})
const executionEvidence = computed(() => store.snapshot ? ({
  promptRuns: store.snapshot.promptRuns.length,
  artifacts: store.snapshot.artifactVersions.length,
  automaticReviews: store.snapshot.reviews.filter((review) => review.source === 'automatic_critic').length,
}) : undefined)

function recordAction(action: string, startedAt: number, result: 'succeeded' | 'failed' | 'cancelled' | 'blocked', errorCode?: string): void {
  recordPreviewEvent(isBrowserPreviewRecorderEnabled(), browserPreviewRecorderStorage(), {
    workspace: currentWorkspaceId.value, action, durationMs: performance.now() - startedAt, result,
    ...(errorCode ? { errorCode } : {}),
  })
}

async function activateWorkspace(id: StudioWorkspaceId): Promise<void> {
  const definition = workspaceById(id)
  currentWorkspaceId.value = id
  if (store.view !== definition.domainView) await store.changeView(definition.domainView)
}

async function replaceWorkspaceRoute(id: StudioWorkspaceId): Promise<void> {
  const definition = workspaceById(id)
  await activateWorkspace(id)
  await router.replace({
    name: 'studio', params: { projectId: store.currentProjectId },
    query: { ...route.query, workspace: id, view: definition.domainView },
  })
}

async function navigateWorkspace(id: StudioWorkspaceId): Promise<void> {
  if (id === 'tasks' && currentWorkspaceId.value !== 'tasks') returnTo.value = { workspace: currentWorkspaceId.value, scrollTop: document.querySelector('.studio-mode')?.scrollTop ?? 0 }
  const definition = workspaceById(id)
  await activateWorkspace(id)
  if (route.query.workspace !== id || route.query.view !== definition.domainView) {
    await router.push({
      name: 'studio', params: { projectId: store.currentProjectId },
      query: { ...route.query, workspace: id, view: definition.domainView },
    })
  }
}

async function returnFromTasks(): Promise<void> {
  const destination = returnTo.value
  if (!destination) return
  returnTo.value = undefined
  await navigateWorkspace(destination.workspace)
  await nextTick()
  const mode = document.querySelector<HTMLElement>('.studio-mode')
  if (mode) mode.scrollTop = destination.scrollTop
}

async function setView(view: GraphProjection['view']): Promise<void> { await navigateWorkspace(workspaceForLegacyView(view)) }

async function openProjectById(projectId: string): Promise<void> {
  if (projectId !== store.currentProjectId) await store.loadProject(projectId)
  await router.push({ name: 'studio', params: { projectId }, query: { ...route.query, workspace: 'brief', view: 'story' } })
  await activateWorkspace('brief')
}

async function resumeProjectById(projectId: string): Promise<void> {
  if (projectId !== store.currentProjectId) await store.loadProject(projectId)
  const hasAttentionTask = store.tasks.some((task) => ['failed', 'timed_out', 'orphaned', 'outcome_unknown', 'needs_attention'].includes(task.status))
  const hasPendingReview = store.snapshot?.shots.some((shot) => !shot.selectedCandidateId) === true
  const destination: StudioWorkspaceId = hasAttentionTask ? 'tasks' : hasPendingReview ? 'review' : 'brief'
  if (destination === 'tasks') returnTo.value = { workspace: 'project_center', scrollTop: 0 }
  const definition = workspaceById(destination)
  await router.push({ name: 'studio', params: { projectId }, query: { ...route.query, workspace: destination, view: definition.domainView } })
  await activateWorkspace(destination)
}

async function focusGuideTarget(target: string): Promise<void> {
  await nextTick()
  document.querySelector<HTMLElement>(`[data-guide-target="${target}"]`)?.focus()
}

async function openTaskCenter(): Promise<void> {
  helpOpen.value = false
  await navigateWorkspace('tasks')
  await taskTrayRef.value?.openTray()
}

async function runWorkspacePrimary(): Promise<void> {
  const startedAt = performance.now()
  try {
    if (!currentAvailability.value.available) {
      recordAction('workspace_primary', startedAt, 'blocked', 'WORKSPACE_PREREQUISITE')
      if (currentAvailability.value.alternativeWorkspace) await navigateWorkspace(currentAvailability.value.alternativeWorkspace)
      return
    }
    const id = currentWorkspaceId.value
    if (id === 'project_center' || id === 'project_setup') await projectSwitcherRef.value?.openSwitcher()
    else if (id === 'brief') {
      const projectNode = store.graph?.nodes.find((node) => node.type === 'project')
      if (projectNode) store.selectNode(projectNode.id)
      await focusGuideTarget('creative-brief')
    } else if (id === 'script') await sourceComposerRef.value?.openComposer()
    else if (id === 'assets') {
      const asset = store.graph?.nodes.find((node) => node.type === 'asset')
      if (asset) store.selectNode(asset.id)
      else { helpOpen.value = true }
    } else if (id === 'shots') {
      if (!store.currentPlan) { await store.createPlan(); await workspaceHostRef.value?.openAgent() }
      else if (store.currentPlan.status === 'awaiting_approval') await workspaceHostRef.value?.openAgent()
      else {
        const shot = store.graph?.nodes.find((node) => node.type === 'shot')
        if (shot) store.selectNode(shot.id)
      }
    } else if (id === 'continuity') {
      const shot = store.graph?.nodes.find((node) => node.type === 'shot')
      if (shot) store.selectNode(shot.id)
    } else if (id === 'generation') await focusGuideTarget('generation-mode')
    else if (id === 'review') {
      const shot = store.snapshot?.shots.find((item) => !item.selectedCandidateId) ?? store.snapshot?.shots[0]
      if (shot) store.selectNode(`shot:${shot.id}`)
      await focusGuideTarget('candidate-review')
    } else if (id === 'timeline') await focusGuideTarget('delivery-export')
    else if (id === 'export_settings') await focusGuideTarget('delivery-export')
    else if (id === 'canvas') await store.loadGraph()
    else if (id === 'prompt_skill') await focusGuideTarget('prompt-ops')
    else if (id === 'tasks') await focusGuideTarget('task-center')
    else if (id === 'provider_connections') await focusGuideTarget('provider-marketplace')
    else if (id === 'local_governance') await focusGuideTarget('local-governance')
    else if (id === 'export_settings') await focusGuideTarget('delivery-export')
    recordAction('workspace_primary', startedAt, store.error ? 'failed' : 'succeeded', store.error?.code)
  } catch {
    recordAction('workspace_primary', startedAt, 'failed', 'CLIENT_ACTION_FAILED')
  }
}

async function handleGuideNavigate(action: StudioGuideAction): Promise<void> {
  if (action === 'open-project') return await navigateWorkspace('project_center').then(() => projectSwitcherRef.value?.openSwitcher())
  if (action === 'open-source') return await navigateWorkspace('script').then(() => sourceComposerRef.value?.openComposer())
  if (action === 'create-plan') { await navigateWorkspace('shots'); await store.createPlan(); await workspaceHostRef.value?.openAgent(); return }
  if (action === 'open-plan') { await navigateWorkspace('shots'); return await workspaceHostRef.value?.openAgent() }
  if (action === 'produce-demo') { await navigateWorkspace('generation'); await store.produceDemo(); return }
  if (action === 'open-tasks') return await openTaskCenter()
  if (action === 'open-review') { await navigateWorkspace('review'); await runWorkspacePrimary(); return }
  await navigateWorkspace('export_settings')
  await focusGuideTarget('delivery-export')
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandOpen.value = true }
  if (event.key === 'Escape') { commandOpen.value = false; systemsOpen.value = false; helpOpen.value = false; store.selectNode() }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && ['1', '2', '3'].includes(event.key) && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) void setView(views[Number(event.key) - 1]!.id)
}

onMounted(async () => {
  const queryView = typeof route.query.view === 'string' && ['story', 'production', 'delivery'].includes(route.query.view) ? route.query.view as GraphProjection['view'] : 'story'
  store.view = queryView
  await store.initialize(typeof route.params.projectId === 'string' ? route.params.projectId : undefined)
  const resolved = resolveStudioWorkspace(route.query.workspace, route.query.view, workspaceFacts.value)
  await replaceWorkspaceRoute(resolved)
  initialized.value = true
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
watch(() => route.params.projectId, async (id) => {
  if (typeof id === 'string' && id !== store.currentProjectId) {
    await store.loadProject(id)
    const resolved = resolveStudioWorkspace(route.query.workspace, route.query.view, workspaceFacts.value)
    await activateWorkspace(resolved)
  }
})
watch(() => route.query.workspace, async (workspace) => {
  if (!initialized.value) return
  const resolved = resolveStudioWorkspace(workspace, route.query.view, workspaceFacts.value)
  if (resolved !== currentWorkspaceId.value) await activateWorkspace(resolved)
})
</script>
