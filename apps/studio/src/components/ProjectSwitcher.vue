<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger as-child>
      <button class="project-trigger" data-guide-target="project-switcher" type="button">
        <FolderKanban :size="16" />
        <span>{{ store.currentProject?.name ?? '选择或创建项目' }}</span>
        <ChevronDown :size="14" />
      </button>
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog dialog--project">
        <div class="dialog__header">
          <div><DialogTitle>项目切换器</DialogTitle><DialogDescription>项目不会占用主画布；选择后立即恢复上次生产状态。</DialogDescription></div>
          <DialogClose class="icon-button" aria-label="关闭"><X :size="18" /></DialogClose>
        </div>
        <div class="project-list" role="list">
          <button v-for="project in store.projects" :key="project.id" class="project-row" :class="{ active: project.id === store.currentProjectId }" type="button" @click="select(project.id)">
            <span><strong>{{ project.name }}</strong><small>{{ new Date(project.updatedAt).toLocaleString() }}</small></span>
            <Check v-if="project.id === store.currentProjectId" :size="17" />
          </button>
          <p v-if="store.projects.length === 0" class="muted">还没有项目。创建后会直接进入空白画布。</p>
        </div>
        <form class="create-project" @submit.prevent="create">
          <label for="project-name">新项目名称</label>
          <div><input id="project-name" v-model="name" maxlength="120" required placeholder="例如：旧剧院试播集" /><button class="primary-button" :disabled="store.loading" type="submit"><Plus :size="16" />创建</button></div>
        </form>
        <button class="primary-button primary-button--wide project-demo" type="button" :disabled="store.loading" @click="createDemo"><Sparkles :size="16" />打开零 Key Demo 项目</button>
        <div class="project-package-actions">
          <input ref="packageInput" class="visually-hidden" type="file" accept=".aigcproj,application/vnd.aigc-director.project+zip" @change="importPackage" />
          <button class="secondary-button" type="button" :disabled="store.loading" @click="packageInput?.click()"><Upload :size="16" />导入项目包</button>
          <button class="secondary-button" type="button" :disabled="store.loading || !store.currentProjectId" @click="exportPackage"><Archive :size="16" />备份当前项目</button>
          <button v-if="store.snapshot?.series" class="secondary-button" type="button" :disabled="store.loading" @click="exportSeriesPackage"><Archive :size="16" />备份整个 Series</button>
        </div>
        <p class="project-package-note">自包含 .aigcproj 会校验 manifest、媒体 SHA-256 和内部引用；凭据、日志和本机路径永不入包。</p>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Archive, Check, ChevronDown, FolderKanban, Plus, Sparkles, Upload, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import { useRoute, useRouter } from 'vue-router'
import { workspaceById } from '../workspaces.js'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const router = useRouter()
const route = useRoute()
const open = ref(false)
const name = ref('')
const packageInput = ref<HTMLInputElement>()

async function openSwitcher(): Promise<void> {
  open.value = true
  await nextTick()
  document.getElementById('project-name')?.focus()
}

defineExpose({ openSwitcher })

async function select(id: string): Promise<void> {
  await store.loadProject(id)
  await router.replace({ name: 'studio', params: { projectId: id }, query: { ...route.query, view: store.view } })
  open.value = false
}

async function create(): Promise<void> {
  const project = await store.createProject(name.value)
  if (!project) return
  name.value = ''
  const next = workspaceById('brief')
  await router.replace({ name: 'studio', params: { projectId: project.id }, query: { ...route.query, workspace: next.id, view: next.domainView } })
  open.value = false
}

async function createDemo(): Promise<void> {
  const project = await store.createProject('零 Key Demo · 灯塔来信', '本地确定性 Demo：不需要 API Key，不发送付费请求。')
  if (!project) return
  await store.importSource('灯塔来信', '暴风雨前夜，守塔人林岚收到一封没有署名的来信。信中写着：午夜钟响三次后，不要点亮主灯。林岚检查记录，发现十年前同一天也出现过相同警告。她决定保留主灯熄灭，并沿着旧维修梯前往地下机房。')
  await store.createPlan()
  const next = workspaceById('brief')
  await router.replace({ name: 'studio', params: { projectId: project.id }, query: { ...route.query, workspace: next.id, view: next.domainView } })
  open.value = false
}

async function importPackage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await store.importProjectPackage(file)
  if (!store.currentProjectId) return
  await router.replace({ name: 'studio', params: { projectId: store.currentProjectId }, query: { ...route.query, view: store.view } })
  open.value = false
}

async function exportPackage(): Promise<void> {
  const exported = await store.exportProjectPackage()
  if (!exported) return
  const url = URL.createObjectURL(exported.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exported.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

async function exportSeriesPackage(): Promise<void> {
  const exported = await store.exportSeriesPackage()
  if (!exported) return
  const url = URL.createObjectURL(exported.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exported.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>
