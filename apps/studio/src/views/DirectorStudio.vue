<template>
  <main class="studio-shell">
    <aside class="studio-rail" aria-label="工作室导航">
      <div class="studio-mark" aria-label="AIGC 导演工作室"><Sparkles :size="23" /></div>
      <nav>
        <button v-for="item in views" :key="item.id" type="button" :class="{ active: store.view === item.id }" :aria-label="item.label" :title="item.label" @click="setView(item.id)"><component :is="item.icon" :size="20" /></button>
      </nav>
      <button type="button" aria-label="系统与 Provider" title="系统与 Provider" @click="systemsOpen = true"><Settings2 :size="20" /></button>
      <span class="local-indicator"><i />本地</span>
    </aside>

    <section class="studio-main">
      <header class="studio-header">
        <div class="studio-title"><span class="eyebrow">DIRECTOR / DOMAIN GRAPH</span><h1>AIGC 导演工作室</h1><p>在一张可恢复的领域图上完成改编、生产与交付。</p></div>
        <div class="studio-header__actions">
          <ProjectSwitcher />
          <button class="secondary-button" type="button" :disabled="!store.currentProjectId" @click="store.createPlan"><Bot :size="16" />导演建议</button>
          <button class="icon-button" type="button" aria-label="打开命令面板" title="命令面板 ⌘K" @click="commandOpen = true"><Command :size="18" /></button>
          <button class="icon-button" type="button" aria-label="刷新当前图" @click="store.loadGraph"><RefreshCw :size="18" /></button>
        </div>
      </header>

      <div class="view-toolbar">
        <div><span class="eyebrow">{{ viewMeta.eyebrow }}</span><h2>{{ viewMeta.title }}</h2><p>{{ viewMeta.description }}</p></div>
        <div class="view-toolbar__actions">
          <SourceComposer v-if="store.currentProjectId"><button class="secondary-button" type="button"><BookPlus :size="16" />导入原著</button></SourceComposer>
          <button class="icon-button" type="button" :class="{ active: listMode }" :aria-pressed="listMode" aria-label="切换列表视图" @click="listMode = !listMode"><List :size="18" /></button>
        </div>
      </div>

      <div class="studio-workspace" :class="{ 'studio-workspace--agent': true }">
        <AgentPanel />
        <section class="graph-stage" :class="{ 'graph-stage--list': listMode, 'graph-stage--delivery': store.view === 'delivery' }">
          <DomainCanvas
            v-if="!listMode"
            :graph="visibleGraph"
            @select="store.selectedNodeId = $event"
            @move="store.moveNodes"
            @connect="store.connectEvents"
          >
            <template #empty-action>
              <SourceComposer v-if="store.currentProjectId"><button class="primary-button" type="button"><BookPlus :size="16" />导入原著</button></SourceComposer>
              <p v-else class="muted">使用顶部项目切换器创建第一个项目。</p>
            </template>
          </DomainCanvas>
          <div v-else class="domain-list" role="list" aria-label="领域对象列表">
            <button v-for="node in visibleGraph.nodes" :key="node.id" type="button" :class="{ active: node.id === store.selectedNodeId }" @click="store.selectedNodeId = node.id"><span :class="`node-dot node-dot--${node.status}`" /><span><strong>{{ node.label }}</strong><small>{{ node.type }} · {{ node.subtitle }}</small></span></button>
            <p v-if="visibleGraph.nodes.length === 0" class="muted">当前视图还没有领域对象。</p>
          </div>
          <DeliveryPanel v-if="store.view === 'delivery' && store.currentProjectId" />
        </section>
        <StudioInspector />
      </div>
    </section>

    <TaskTray />
    <div v-if="store.loading" class="global-progress" role="progressbar"><i /></div>
    <div v-if="store.error" class="toast toast--error" role="alert"><TriangleAlert :size="17" /><span><strong>{{ store.error.message }}</strong><small>{{ store.error.code }} · {{ store.error.correlationId }}</small></span><button class="icon-button" type="button" aria-label="关闭错误" @click="store.error = undefined"><X :size="15" /></button></div>
    <div v-else-if="store.message" class="toast" role="status"><CircleCheck :size="17" /><span>{{ store.message }}</span><button class="icon-button" type="button" aria-label="关闭提示" @click="store.message = ''"><X :size="15" /></button></div>

    <StudioDialogs
      v-if="commandOpen || systemsOpen"
      :command-open="commandOpen"
      :systems-open="systemsOpen"
      :views="views"
      :has-project="Boolean(store.currentProjectId)"
      :prompt-pack="store.promptPack"
      :evidence="executionEvidence"
      @update:command-open="commandOpen = $event"
      @update:systems-open="systemsOpen = $event"
      @select-view="setView"
      @create-plan="store.createPlan"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, markRaw, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookPlus, Bot, CircleCheck, Clapperboard, Command, GitBranch, List, PackageOpen, RefreshCw, Settings2, Sparkles, TriangleAlert, X } from 'lucide-vue-next'
import type { GraphProjection } from '@aigc-director/contracts'
import AgentPanel from '../components/AgentPanel.vue'
import DeliveryPanel from '../components/DeliveryPanel.vue'
import StudioInspector from '../components/StudioInspector.vue'
import TaskTray from '../components/TaskTray.vue'
import { useStudioStore } from '../stores/studio.js'

const StudioDialogs = defineAsyncComponent(() => import('../components/StudioDialogs.vue'))
const DomainCanvas = defineAsyncComponent(() => import('../components/DomainCanvas.vue'))
const ProjectSwitcher = defineAsyncComponent(() => import('../components/ProjectSwitcher.vue'))
const SourceComposer = defineAsyncComponent(() => import('../components/SourceComposer.vue'))

const store = useStudioStore()
const route = useRoute()
const router = useRouter()
const listMode = ref(false)
const commandOpen = ref(false)
const systemsOpen = ref(false)
const views: ReadonlyArray<{ id: GraphProjection['view']; label: string; eyebrow: string; title: string; description: string; shortcut: string; icon: Component }> = [
  { id: 'story', label: '故事事件图', eyebrow: 'STORY GRAPH', title: '章节事件与改编', description: '追踪原文证据、人物状态、伏笔与因果。', shortcut: '1', icon: markRaw(GitBranch) },
  { id: 'production', label: '生产关系图', eyebrow: 'PRODUCTION GRAPH', title: '镜头、资产与候选', description: '把已批准场景组织成可审阅的媒体生产图。', shortcut: '2', icon: markRaw(Clapperboard) },
  { id: 'delivery', label: '交付装配图', eyebrow: 'DELIVERY GRAPH', title: '轨道、任务与导出', description: '装配已选候选，查看恢复状态并导出。', shortcut: '3', icon: markRaw(PackageOpen) },
]
const viewMeta = computed(() => views.find((item) => item.id === store.view) ?? views[0]!)
const placeholderProjectId = '00000000-0000-4000-8000-000000000000'
const visibleGraph = computed<GraphProjection>(() => store.graph ?? { projectId: store.currentProjectId ?? placeholderProjectId, view: store.view, revision: 0, nodes: [], edges: [], generatedAt: new Date().toISOString() })
const executionEvidence = computed(() => store.snapshot ? ({
  promptRuns: store.snapshot.promptRuns.length,
  artifacts: store.snapshot.artifactVersions.length,
  automaticReviews: store.snapshot.reviews.filter((review) => review.source === 'automatic_critic').length,
}) : undefined)

async function setView(view: GraphProjection['view']): Promise<void> {
  await store.changeView(view)
  await router.replace({ name: 'studio', params: { projectId: store.currentProjectId }, query: { view } })
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandOpen.value = true }
  if (event.key === 'Escape') { commandOpen.value = false; systemsOpen.value = false; store.selectedNodeId = undefined }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && ['1', '2', '3'].includes(event.key) && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) void setView(views[Number(event.key) - 1]!.id)
}

onMounted(async () => {
  const queryView = typeof route.query.view === 'string' && ['story', 'production', 'delivery'].includes(route.query.view) ? route.query.view as GraphProjection['view'] : 'story'
  store.view = queryView
  await store.initialize(typeof route.params.projectId === 'string' ? route.params.projectId : undefined)
  if (store.currentProjectId && route.params.projectId !== store.currentProjectId) await router.replace({ name: 'studio', params: { projectId: store.currentProjectId }, query: { view: store.view } })
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
watch(() => route.params.projectId, async (id) => { if (typeof id === 'string' && id !== store.currentProjectId) await store.loadProject(id) })
</script>
