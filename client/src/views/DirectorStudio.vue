<template>
  <div ref="root" class="director-studio" tabindex="-1">
    <aside class="studio-rail" aria-label="Studio navigation">
      <button class="studio-brand" type="button" :aria-label="$t('studio.title')" @click="router.push('/studio')">
        <StudioIcon name="studio" :size="24" />
      </button>
      <nav>
        <button class="is-active" type="button" :title="$t('studio.title')" aria-current="page">
          <StudioIcon name="canvas" :size="21" />
          <span>{{ $t('studio.title') }}</span>
        </button>
        <button type="button" :title="$t('nav.dashboard')" @click="router.push('/dashboard')">
          <StudioIcon name="dashboard" :size="21" />
          <span>{{ $t('nav.dashboard') }}</span>
        </button>
        <button type="button" :title="$t('nav.projects')" @click="router.push('/projects')">
          <StudioIcon name="projects" :size="21" />
          <span>{{ $t('nav.projects') }}</span>
        </button>
      </nav>
      <div class="studio-rail__foot">
        <span class="studio-local-dot"></span>
        <small>{{ $t('studio.localFirst') }}</small>
      </div>
    </aside>

    <main class="studio-main">
      <header class="studio-topbar">
        <div class="studio-title-block">
          <div class="studio-title-line">
            <span class="studio-kicker">Director / Graph</span>
            <span class="studio-local-pill"><span></span>{{ $t('studio.localFirst') }}</span>
          </div>
          <h1>{{ $t('studio.title') }}</h1>
          <p>{{ $t('studio.subtitle') }}</p>
        </div>

        <label class="studio-project-select">
          <span>{{ $t('studio.switchProject') }}</span>
          <select :value="activeProjectId" :disabled="loading || !projects.length" @change="switchProject">
            <option v-for="project in projects" :key="project.id" :value="String(project.id)">{{ project.name }}</option>
          </select>
        </label>

        <div class="studio-topbar__actions">
          <StudioButton icon="advisor" variant="secondary" :pressed="advisorOpen" :disabled="!activeProjectId" @click="toggleAdvisor">
            {{ $t('studio.advisor.button') }}
          </StudioButton>
          <StudioButton icon="quick" variant="secondary" :disabled="!activeProjectId" @click="openQuickMode">
            {{ $t('studio.quickMode') }}
          </StudioButton>
          <StudioButton icon="refresh" variant="ghost" icon-only :loading="refreshing" :title="$t('studio.refresh')" @click="refreshWorkspace" />
        </div>
      </header>

      <section v-if="loading && !workspace" class="studio-state studio-state--loading" aria-live="polite">
        <span class="studio-loader"><StudioIcon name="studio" :size="28" /></span>
        <h2>{{ $t('studio.loading') }}</h2>
        <p>{{ $t('studio.shortcuts') }}</p>
      </section>

      <section v-else-if="loadError && !workspace" class="studio-state" role="alert">
        <span class="studio-state__icon"><StudioIcon name="warning" :size="34" /></span>
        <h2>{{ $t('studio.loadFailed') }}</h2>
        <p>{{ loadError }}</p>
        <StudioButton icon="refresh" variant="primary" @click="retryInitialize">{{ $t('studio.retryConnection') }}</StudioButton>
      </section>

      <section v-else-if="!activeProjectId || !workspace" class="studio-state">
        <span class="studio-state__icon"><StudioIcon name="projects" :size="34" /></span>
        <h2>{{ $t('studio.noProject') }}</h2>
        <p>{{ $t('studio.noProjectHint') }}</p>
        <StudioButton icon="plus" variant="primary" @click="router.push('/projects')">{{ $t('studio.createProject') }}</StudioButton>
      </section>

      <section v-else class="studio-stage">
        <div class="studio-canvas-shell">
          <div v-if="workspace.warnings.length" class="studio-warning" role="status">
            <StudioIcon name="warning" :size="16" />
            <span>{{ $t('studio.partialWarning') }}</span>
            <button type="button" @click="warningsOpen = !warningsOpen">{{ warningsOpen ? $t('common.close') : $t('common.open') }}</button>
            <ul v-if="warningsOpen"><li v-for="warning in workspace.warnings" :key="warning">{{ warning }}</li></ul>
          </div>

          <div class="studio-canvas-toolbar" aria-label="Canvas controls">
            <div class="studio-view-toggle">
              <StudioButton icon="canvas" variant="ghost" :pressed="viewMode === 'canvas'" @click="viewMode = 'canvas'">{{ $t('studio.canvasView') }}</StudioButton>
              <StudioButton icon="list" variant="ghost" :pressed="viewMode === 'list'" @click="viewMode = 'list'">{{ $t('studio.listView') }}</StudioButton>
            </div>
            <div v-if="viewMode === 'canvas'" class="studio-canvas-actions">
              <button type="button" title="Zoom out" aria-label="Zoom out" @click="zoomOut({ duration: 120 })">−</button>
              <button type="button" title="Zoom in" aria-label="Zoom in" @click="zoomIn({ duration: 120 })">+</button>
              <StudioButton icon="fit" variant="ghost" icon-only :title="$t('studio.fitView')" @click="fitCanvas" />
              <StudioButton icon="layout" variant="ghost" icon-only :title="$t('studio.resetLayout')" @click="resetLayout" />
            </div>
          </div>

          <VueFlow
            v-if="viewMode === 'canvas'"
            id="director-studio-canvas"
            v-model:nodes="canvasNodes"
            v-model:edges="canvasEdges"
            class="studio-flow"
            :min-zoom="0.28"
            :max-zoom="1.8"
            :default-viewport="{ x: 42, y: 42, zoom: 0.82 }"
            :nodes-connectable="false"
            :edges-updatable="false"
            :delete-key-code="null"
            :multi-selection-key-code="null"
            :select-nodes-on-drag="false"
            fit-view-on-init
            @node-click="selectCanvasNode"
            @node-drag-stop="saveNodePositions"
          >
            <template #node-studio-stage="slotProps">
              <StudioNode
                :data="slotProps.data"
                :selected="slotProps.selected"
                @select="selectStage"
                @open="openRoute"
              />
            </template>
            <Background :gap="28" :size="1" pattern-color="var(--studio-grid)" />
          </VueFlow>

          <ol v-else class="studio-list" aria-label="Production stages">
            <li
              v-for="stageNode in graph?.nodes || []"
              :key="stageNode.id"
              :class="[`status-${stageNode.status}`, { 'is-selected': selectedStageId === stageNode.id }]"
            >
              <button type="button" @click="selectStage(stageNode.id)" @dblclick="openRoute(stageNode.route)">
                <span class="studio-list__index">{{ String((graph?.nodes.indexOf(stageNode) ?? 0) + 1).padStart(2, '0') }}</span>
                <span class="studio-list__icon"><StudioIcon :name="stageNode.kind" :size="21" /></span>
                <span class="studio-list__copy">
                  <strong>{{ $t(`studio.node.${stageNode.kind}.title`) }}</strong>
                  <small>{{ $t(`studio.node.${stageNode.kind}.description`) }}</small>
                </span>
                <span class="studio-list__progress">{{ stageNode.completed }}/{{ stageNode.total }}</span>
                <span class="studio-list__status">{{ $t(`studio.status.${stageNode.status}`) }}</span>
                <StudioIcon name="chevron" :size="17" />
              </button>
            </li>
          </ol>

          <div class="studio-command-hint">
            <StudioIcon name="command" :size="14" />
            <span>{{ $t('studio.shortcuts') }}</span>
          </div>
          <div v-if="layoutSaveState !== 'idle'" class="studio-layout-state" role="status">
            <span :class="`state-${layoutSaveState}`"></span>
            {{ $t(`studio.layout.${layoutSaveState}`) }}
          </div>
        </div>

        <StudioAdvisor
          v-if="advisorOpen"
          :plan="advisorPlan"
          :loading="advisorLoading"
          :error="advisorError"
          @close="advisorOpen = false"
          @refresh="refreshAdvisor()"
          @open="openRoute"
        />
        <StudioInspector
          v-else
          :stage="selectedStage"
          @close="selectedStageId = ''"
          @open="openRoute"
          @diagnose="diagnoseStage"
        />
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DirectorAdvicePlan } from '@aigc-video/contracts'
import { useTaskStore } from '../stores/tasks'
import { useRoute, useRouter } from 'vue-router'
import { Background } from '@vue-flow/background'
import { VueFlow, useVueFlow, type NodeMouseEvent, type NodeDragEvent } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

import { AigcClientError } from '../api'
import {
  loadStudioWorkspace,
  mergeStudioTaskSummaries,
  toStudioTaskSummary,
  type StudioWorkspaceData,
} from '../api/studio'
import { getDirectorAdvice, listProjects, saveStudioLayout } from '../api/projects'
import StudioAdvisor from '../components/studio/StudioAdvisor.vue'
import StudioButton from '../components/studio/StudioButton.vue'
import StudioIcon from '../components/studio/StudioIcon.vue'
import StudioInspector from '../components/studio/StudioInspector.vue'
import StudioNode from '../components/studio/StudioNode.vue'
import { buildStudioGraph, findNextStudioNode, type StudioGraph, type StudioGraphNode } from '../domain/studioGraph'
import {
  collectStudioPositions,
  layoutStudioGraph,
  type StudioCanvasEdge,
  type StudioCanvasNode,
  type StudioPositionMap,
} from '../domain/studioLayout'
import type { ProjectView } from '../domain/projects'

type ViewMode = 'canvas' | 'list'
type LayoutSaveState = 'idle' | 'saving' | 'saved' | 'local' | 'conflict'

const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const root = ref<HTMLElement | null>(null)
const projects = ref<ProjectView[]>([])
const workspace = ref<StudioWorkspaceData | null>(null)
const graph = ref<StudioGraph | null>(null)
const canvasNodes = ref<StudioCanvasNode[]>([])
const canvasEdges = ref<StudioCanvasEdge[]>([])
const selectedStageId = ref('')
const loading = ref(true)
const refreshing = ref(false)
const warningsOpen = ref(false)
const loadError = ref('')
const viewMode = ref<ViewMode>(readViewMode())
const layoutRevision = ref(0)
const layoutSaveState = ref<LayoutSaveState>('idle')
const advisorOpen = ref(false)
const advisorPlan = ref<DirectorAdvicePlan | null>(null)
const advisorLoading = ref(false)
const advisorError = ref('')
let layoutSaveChain: Promise<void> = Promise.resolve()
let layoutSavedTimer: ReturnType<typeof setTimeout> | null = null
let initializeRetryTimer: ReturnType<typeof setTimeout> | null = null
let initializeRetryAttempt = 0
let advisorRefreshTimer: ReturnType<typeof setTimeout> | null = null
let projectLoadSequence = 0
let advisorRequestSequence = 0
let disposed = false

const { fitView, viewportRef, zoomIn, zoomOut } = useVueFlow('director-studio-canvas')

const activeProjectId = computed(() => {
  const value = route.params.id
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '')
})
const selectedStage = computed(() => graph.value?.nodes.find((node) => node.id === selectedStageId.value) ?? null)

function readViewMode(): ViewMode {
  try { return localStorage.getItem('aigc-studio:view') === 'list' ? 'list' : 'canvas' } catch { return 'canvas' }
}

function positionsKey(projectId: string): string {
  return `aigc-studio:positions:${projectId}`
}

function readPositions(projectId: string): StudioPositionMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(positionsKey(projectId)) || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const point = value as Record<string, unknown>
      return Number.isFinite(point.x) && Number.isFinite(point.y)
    })) as StudioPositionMap
  } catch { return {} }
}

function persistPositions(projectId: string, positions: StudioPositionMap): void {
  try { localStorage.setItem(positionsKey(projectId), JSON.stringify(positions)) } catch { /* storage can be unavailable */ }
}

async function initialize(): Promise<void> {
  loading.value = true
  try {
    projects.value = await listProjects()
    loadError.value = ''
    initializeRetryAttempt = 0
    if (!projects.value.length) {
      workspace.value = null
      graph.value = null
      return
    }
    if (!activeProjectId.value || !projects.value.some((project) => String(project.id) === activeProjectId.value)) {
      let remembered = ''
      try { remembered = localStorage.getItem('aigc-studio:last-project') || '' } catch { /* ignore */ }
      const fallback = projects.value.find((project) => String(project.id) === remembered) ?? projects.value[0]
      if (fallback) await router.replace(`/studio/${fallback.id}`)
      return
    }
    await loadProject(activeProjectId.value)
  } catch (cause) {
    workspace.value = null
    graph.value = null
    loadError.value = cause instanceof Error ? cause.message : String(cause)
    console.warn('[studio] initialize unavailable; retry scheduled')
    scheduleInitializeRetry()
  } finally {
    loading.value = false
  }
}

function scheduleInitializeRetry(): void {
  if (disposed || initializeRetryTimer) return
  const delay = Math.min(10_000, 1_000 * (2 ** initializeRetryAttempt))
  initializeRetryAttempt += 1
  initializeRetryTimer = setTimeout(() => {
    initializeRetryTimer = null
    void initialize()
  }, delay)
}

function retryInitialize(): void {
  if (initializeRetryTimer) clearTimeout(initializeRetryTimer)
  initializeRetryTimer = null
  initializeRetryAttempt = 0
  void initialize()
}

async function loadProject(projectId: string): Promise<void> {
  const requestSequence = ++projectLoadSequence
  const data = await loadStudioWorkspace(projectId)
  if (disposed || requestSequence !== projectLoadSequence || activeProjectId.value !== projectId) return
  workspace.value = data
  projects.value = data.projects
  graph.value = buildStudioGraph(data.snapshot)
  layoutRevision.value = data.layout?.revision ?? 0
  const serverPositions = data.layout?.positions ?? {}
  const positions = Object.keys(serverPositions).length ? serverPositions : readPositions(projectId)
  const elements = layoutStudioGraph(graph.value, positions)
  canvasNodes.value = elements.nodes
  canvasEdges.value = elements.edges
  persistPositions(projectId, collectStudioPositions(elements.nodes))
  const existing = graph.value.nodes.some((node) => node.id === selectedStageId.value)
  if (!existing) selectedStageId.value = findNextStudioNode(graph.value)?.id ?? graph.value.nodes[0]?.id ?? ''
  try { localStorage.setItem('aigc-studio:last-project', projectId) } catch { /* ignore */ }
  await nextTick()
  if (viewMode.value === 'canvas') await fitCanvas()
  void refreshAdvisor(projectId)
}

async function refreshAdvisor(projectId = activeProjectId.value): Promise<void> {
  if (!projectId) return
  const requestSequence = ++advisorRequestSequence
  advisorLoading.value = true
  advisorError.value = ''
  try {
    const plan = await getDirectorAdvice(projectId)
    if (requestSequence === advisorRequestSequence && activeProjectId.value === String(plan.project_id)) {
      advisorPlan.value = plan
    }
  } catch (cause) {
    if (requestSequence === advisorRequestSequence && activeProjectId.value === projectId) {
      advisorError.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    if (requestSequence === advisorRequestSequence) advisorLoading.value = false
  }
}

async function refreshWorkspace(): Promise<void> {
  if (!activeProjectId.value || refreshing.value) return
  refreshing.value = true
  try { await loadProject(activeProjectId.value) }
  catch (cause) { console.error('[studio] refresh failed', cause) }
  finally { refreshing.value = false }
}

function switchProject(event: Event): void {
  const target = event.target as HTMLSelectElement
  if (target.value) router.push(`/studio/${encodeURIComponent(target.value)}`)
}

function openQuickMode(): void {
  if (activeProjectId.value) router.push(`/projects/${encodeURIComponent(activeProjectId.value)}/script`)
}

function toggleAdvisor(): void {
  advisorOpen.value = !advisorOpen.value
  if (advisorOpen.value) void refreshAdvisor()
}

function selectCanvasNode(event: NodeMouseEvent): void {
  selectedStageId.value = event.node.id
}

function selectStage(id: string): void {
  selectedStageId.value = id
}

function refreshRealtimeProjection(): void {
  if (!workspace.value || !graph.value || !activeProjectId.value) return
  const realtimeTasks = Object.values(taskStore.tasks).filter((task) => {
    const projectId = task.meta?.project_id
    return projectId != null && String(projectId) === activeProjectId.value
  }).map(toStudioTaskSummary)
  if (!realtimeTasks.length && !workspace.value.snapshot.tasks.length) return
  const mergedTasks = mergeStudioTaskSummaries(workspace.value.snapshot.tasks, realtimeTasks)
  const nextSnapshot = { ...workspace.value.snapshot, tasks: mergedTasks }
  const nextGraph = buildStudioGraph(nextSnapshot)
  const positions = collectStudioPositions(canvasNodes.value)
  const elements = layoutStudioGraph(nextGraph, positions)
  workspace.value = { ...workspace.value, snapshot: nextSnapshot }
  graph.value = nextGraph
  canvasNodes.value = elements.nodes
  canvasEdges.value = elements.edges
  if (advisorRefreshTimer) clearTimeout(advisorRefreshTimer)
  advisorRefreshTimer = setTimeout(() => {
    advisorRefreshTimer = null
    void refreshAdvisor()
  }, 650)
}

function openRoute(path: string): void {
  router.push(path)
}

function diagnoseStage(stage: StudioGraphNode): void {
  router.push(stage.taskId ? '/history' : stage.route)
}

function queueLayoutSave(projectId: string, positions: StudioPositionMap): void {
  persistPositions(projectId, positions)
  layoutSaveState.value = 'saving'
  if (layoutSavedTimer) clearTimeout(layoutSavedTimer)
  layoutSaveChain = layoutSaveChain.catch(() => undefined).then(async () => {
    if (activeProjectId.value !== projectId) return
    const saved = await saveStudioLayout(projectId, {
      schema_version: 1,
      positions,
      base_revision: layoutRevision.value,
    })
    if (activeProjectId.value !== projectId) return
    layoutRevision.value = saved.revision
    layoutSaveState.value = 'saved'
    layoutSavedTimer = setTimeout(() => {
      if (layoutSaveState.value === 'saved') layoutSaveState.value = 'idle'
    }, 1600)
  }).catch((cause: unknown) => {
    layoutSaveState.value = cause instanceof AigcClientError && cause.code === 'STUDIO_LAYOUT_CONFLICT'
      ? 'conflict'
      : 'local'
    console.warn('[studio] layout kept locally:', cause instanceof Error ? cause.message : 'save failed')
  })
}

function saveNodePositions(_event: NodeDragEvent): void {
  if (!activeProjectId.value) return
  queueLayoutSave(activeProjectId.value, collectStudioPositions(canvasNodes.value))
}

async function fitCanvas(): Promise<void> {
  await nextTick()
  // 初次挂载由 fit-view-on-init 处理；避免在 Vue Flow viewport 建立前调用并产生竞态警告。
  if (!viewportRef.value) return
  await fitView({ padding: 0.16, duration: 260, maxZoom: 1 })
}

async function resetLayout(): Promise<void> {
  if (!graph.value || !activeProjectId.value) return
  try { localStorage.removeItem(positionsKey(activeProjectId.value)) } catch { /* ignore */ }
  const elements = layoutStudioGraph(graph.value)
  canvasNodes.value = elements.nodes
  canvasEdges.value = elements.edges
  queueLayoutSave(activeProjectId.value, collectStudioPositions(elements.nodes))
  await fitCanvas()
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return
  if (event.key === '1') { event.preventDefault(); void fitCanvas() }
  if (event.key.toLowerCase() === 'l') { event.preventDefault(); viewMode.value = viewMode.value === 'canvas' ? 'list' : 'canvas' }
  if (event.key === 'Escape') selectedStageId.value = ''
  if (event.key === 'Enter' && selectedStage.value) { event.preventDefault(); openRoute(selectedStage.value.route) }
}

watch(viewMode, (value) => {
  try { localStorage.setItem('aigc-studio:view', value) } catch { /* ignore */ }
  if (value === 'canvas') void fitCanvas()
})

watch(activeProjectId, (next, previous) => {
  if (!next || next === previous) return
  loading.value = true
  loadProject(next).catch((cause) => {
    loadError.value = cause instanceof Error ? cause.message : String(cause)
    console.warn('[studio] project unavailable; retry scheduled')
    workspace.value = null
    graph.value = null
    scheduleInitializeRetry()
  }).finally(() => { loading.value = false })
})

watch(() => taskStore.tasks, refreshRealtimeProjection, { deep: true })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void initialize().then(() => root.value?.focus({ preventScroll: true }))
})
onBeforeUnmount(() => {
  disposed = true
  projectLoadSequence += 1
  advisorRequestSequence += 1
  window.removeEventListener('keydown', onKeydown)
  if (layoutSavedTimer) clearTimeout(layoutSavedTimer)
  if (initializeRetryTimer) clearTimeout(initializeRetryTimer)
  if (advisorRefreshTimer) clearTimeout(advisorRefreshTimer)
})
</script>

<style scoped>
.director-studio {
  --studio-canvas: #070b12;
  --studio-surface: #0d131d;
  --studio-surface-strong: #121a26;
  --studio-surface-hover: #1a2533;
  --studio-border: rgba(178, 203, 226, .13);
  --studio-border-strong: rgba(178, 203, 226, .28);
  --studio-grid: rgba(172, 208, 233, .10);
  --studio-text: #eff6fb;
  --studio-text-soft: #a7b6c6;
  --studio-text-muted: #718295;
  --studio-accent: #77e6cf;
  --studio-accent-strong: #96f5df;
  --studio-focus: #82d9ff;
  --studio-success: #66d99b;
  --studio-info: #78b8ff;
  --studio-warning: #ffbd66;
  --studio-danger: #ff7a86;
  width: 100%;
  height: 100vh;
  display: flex;
  overflow: hidden;
  color: var(--studio-text);
  background: var(--studio-canvas);
  outline: none;
}
:global([data-theme="light"]) .director-studio {
  --studio-canvas: #eef3f5;
  --studio-surface: #f7fafb;
  --studio-surface-strong: #ffffff;
  --studio-surface-hover: #e8f0f2;
  --studio-border: rgba(25, 54, 67, .13);
  --studio-border-strong: rgba(25, 54, 67, .27);
  --studio-grid: rgba(30, 73, 86, .12);
  --studio-text: #12222b;
  --studio-text-soft: #526874;
  --studio-text-muted: #7a8d96;
  --studio-accent: #26c4a2;
  --studio-accent-strong: #20d6b0;
  --studio-focus: #188fb9;
}
.studio-rail { width: 76px; flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; padding: 16px 10px; border-right: 1px solid var(--studio-border); background: color-mix(in srgb, var(--studio-surface) 96%, transparent); }
.studio-brand { width: 46px; height: 46px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--studio-accent) 28%, transparent); border-radius: 15px; color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 9%, transparent); cursor: pointer; }
.studio-rail nav { flex: 1; display: grid; align-content: start; gap: 8px; margin-top: 34px; }
.studio-rail nav button { width: 48px; min-height: 48px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 13px; color: var(--studio-text-muted); background: transparent; cursor: pointer; }
.studio-rail nav button:hover, .studio-rail nav button.is-active { color: var(--studio-text); background: var(--studio-surface-hover); }
.studio-rail nav button.is-active { color: var(--studio-accent); box-shadow: inset 3px 0 0 var(--studio-accent); }
.studio-rail nav span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.studio-rail__foot { display: grid; justify-items: center; gap: 7px; color: var(--studio-text-muted); }
.studio-rail__foot small { writing-mode: vertical-rl; font-size: 9px; letter-spacing: .12em; }
.studio-local-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--studio-success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--studio-success) 13%, transparent); }
.studio-main { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.studio-topbar { min-height: 108px; display: grid; grid-template-columns: minmax(280px, 1fr) minmax(220px, 320px) auto; align-items: center; gap: 24px; padding: 18px 24px; border-bottom: 1px solid var(--studio-border); background: color-mix(in srgb, var(--studio-surface) 87%, transparent); backdrop-filter: blur(22px); }
.studio-title-block h1 { margin: 4px 0 3px; font-size: clamp(20px, 2vw, 27px); letter-spacing: -.035em; }
.studio-title-block > p { margin: 0; color: var(--studio-text-soft); font-size: 12px; }
.studio-title-line { display: flex; align-items: center; gap: 10px; }
.studio-kicker { color: var(--studio-accent); font-size: 9px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
.studio-local-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border: 1px solid var(--studio-border); border-radius: 999px; color: var(--studio-text-muted); font-size: 9px; }
.studio-local-pill span { width: 5px; height: 5px; border-radius: 50%; background: var(--studio-success); }
.studio-project-select { display: grid; gap: 6px; color: var(--studio-text-muted); font-size: 9px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.studio-project-select select { width: 100%; height: 40px; padding: 0 35px 0 12px; border: 1px solid var(--studio-border); border-radius: 11px; color: var(--studio-text); background: var(--studio-surface-strong); font: inherit; font-size: 13px; font-weight: 600; text-transform: none; appearance: auto; }
.studio-project-select select:focus { outline: 2px solid var(--studio-focus); outline-offset: 2px; }
.studio-topbar__actions { display: flex; align-items: center; gap: 7px; }
.studio-stage { min-height: 0; flex: 1; position: relative; display: flex; }
.studio-canvas-shell { min-width: 0; flex: 1; position: relative; overflow: hidden; background: radial-gradient(circle at 38% 30%, color-mix(in srgb, var(--studio-accent) 5%, transparent), transparent 32%), var(--studio-canvas); }
.studio-flow { width: 100%; height: 100%; }
.studio-canvas-toolbar { position: absolute; top: 14px; left: 14px; right: 14px; z-index: 12; display: flex; justify-content: space-between; align-items: center; pointer-events: none; }
.studio-view-toggle, .studio-canvas-actions { display: flex; align-items: center; gap: 3px; padding: 4px; border: 1px solid var(--studio-border); border-radius: 13px; background: color-mix(in srgb, var(--studio-surface) 90%, transparent); backdrop-filter: blur(16px); pointer-events: auto; }
.studio-canvas-actions > button { width: 36px; height: 36px; border: 0; border-radius: 9px; color: var(--studio-text-soft); background: transparent; font-size: 20px; cursor: pointer; }
.studio-canvas-actions > button:hover { color: var(--studio-text); background: var(--studio-surface-hover); }
.studio-warning { position: absolute; top: 70px; left: 14px; z-index: 13; max-width: min(520px, calc(100% - 28px)); display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--studio-warning) 35%, transparent); border-radius: 12px; color: var(--studio-warning); background: color-mix(in srgb, var(--studio-surface) 92%, transparent); backdrop-filter: blur(16px); font-size: 11px; }
.studio-warning button { border: 0; color: var(--studio-warning); background: transparent; cursor: pointer; }
.studio-warning ul { grid-column: 1 / -1; margin: 5px 0 0; padding-left: 20px; color: var(--studio-text-soft); }
.studio-command-hint { position: absolute; left: 50%; bottom: 14px; z-index: 12; max-width: calc(100% - 28px); display: flex; align-items: center; gap: 7px; padding: 7px 11px; border: 1px solid var(--studio-border); border-radius: 10px; color: var(--studio-text-muted); background: color-mix(in srgb, var(--studio-surface) 88%, transparent); backdrop-filter: blur(14px); font-size: 9px; transform: translateX(-50%); white-space: nowrap; }
.studio-layout-state { position: absolute; right: 14px; bottom: 14px; z-index: 12; display: flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--studio-border); border-radius: 10px; color: var(--studio-text-muted); background: color-mix(in srgb, var(--studio-surface) 90%, transparent); font-size: 9px; }
.studio-layout-state > span { width: 6px; height: 6px; border-radius: 50%; background: var(--studio-text-muted); }
.studio-layout-state > .state-saving { background: var(--studio-info); animation: studio-pulse 1s infinite; }
.studio-layout-state > .state-saved { background: var(--studio-success); }
.studio-layout-state > .state-local, .studio-layout-state > .state-conflict { background: var(--studio-warning); }
.studio-state { flex: 1; display: grid; place-items: center; align-content: center; gap: 12px; padding: 30px; text-align: center; background: radial-gradient(circle at center, color-mix(in srgb, var(--studio-accent) 7%, transparent), transparent 34%); }
.studio-state__icon, .studio-loader { width: 70px; height: 70px; display: grid; place-items: center; border: 1px solid var(--studio-border); border-radius: 22px; color: var(--studio-accent); background: var(--studio-surface); }
.studio-state h2 { margin: 0; font-size: 21px; }
.studio-state p { max-width: 520px; margin: 0 0 8px; color: var(--studio-text-soft); font-size: 13px; }
.studio-loader { animation: studio-breathe 1.8s ease-in-out infinite; }
@keyframes studio-breathe { 50% { transform: scale(.93); opacity: .62; } }
.studio-list { position: absolute; inset: 70px 14px 50px; display: grid; align-content: start; gap: 8px; margin: 0; padding: 0 4px 20px 0; overflow: auto; list-style: none; }
.studio-list li { border: 1px solid var(--studio-border); border-radius: 14px; background: var(--studio-surface); }
.studio-list li.is-selected { border-color: var(--studio-accent); }
.studio-list li > button { width: 100%; display: grid; grid-template-columns: 34px 42px minmax(0,1fr) 64px 90px 24px; align-items: center; gap: 11px; padding: 13px; border: 0; color: var(--studio-text); background: transparent; text-align: left; cursor: pointer; }
.studio-list__index { color: var(--studio-text-muted); font: 700 10px/1 ui-monospace, monospace; }
.studio-list__icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 11px; color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 10%, transparent); }
.studio-list__copy { min-width: 0; display: grid; gap: 3px; }
.studio-list__copy strong { font-size: 13px; }
.studio-list__copy small { overflow: hidden; color: var(--studio-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.studio-list__progress, .studio-list__status { color: var(--studio-text-muted); font-size: 10px; font-weight: 700; }
:deep(.studio-edge path) { stroke: var(--studio-border-strong); }
:deep(.studio-edge--active path) { stroke: color-mix(in srgb, var(--studio-accent) 55%, var(--studio-border)); }
:deep(.studio-edge--stale path) { stroke: var(--studio-warning); stroke-dasharray: 6 6; }
:deep(.vue-flow__edge.animated path) { animation-duration: 1.2s; }
:deep(.vue-flow__pane) { cursor: grab; }
:deep(.vue-flow__pane.dragging) { cursor: grabbing; }
@media (max-width: 980px) {
  .studio-topbar { grid-template-columns: 1fr auto; }
  .studio-project-select { grid-row: 2; grid-column: 1 / -1; }
  :deep(.studio-inspector), :deep(.studio-advisor) { position: absolute; right: 0; z-index: 20; box-shadow: -20px 0 44px rgba(0,0,0,.26); }
}
@media (max-width: 680px) {
  .studio-rail { width: 58px; padding-inline: 5px; }
  .studio-brand, .studio-rail nav button { width: 42px; height: 42px; min-height: 42px; }
  .studio-rail__foot small { display: none; }
  .studio-topbar { min-height: 132px; padding: 13px; gap: 10px; }
  .studio-title-block > p { display: none; }
  .studio-topbar__actions .studio-button:not(.is-icon) { width: 38px; padding: 0; }
  .studio-topbar__actions .studio-button:not(.is-icon) :deep(.studio-button__label) { display: none; }
  .studio-command-hint { display: none; }
  .studio-list li > button { grid-template-columns: 27px 38px minmax(0,1fr) 70px 20px; }
  .studio-list__progress { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .director-studio *, .director-studio *::before, .director-studio *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
</style>
