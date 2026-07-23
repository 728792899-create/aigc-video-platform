<template>
  <section
    class="export-settings-workspace export-delivery"
    data-figma-node="22:192"
    data-figma-spec="T/14-Export"
    data-guide-target="delivery-export"
    tabindex="-1"
    aria-labelledby="export-delivery-title"
  >
    <h1 id="export-delivery-title" class="sr-only">导出与交付</h1>

    <section class="export-delivery__panel export-delivery__panel--preflight" aria-labelledby="export-preflight-heading">
      <header class="export-delivery__panel-heading">
        <span class="export-delivery__section-icon" aria-hidden="true">01</span>
        <span><strong id="export-preflight-heading">导出预检</strong><small>在写入文件前锁定装配快照</small></span>
      </header>

      <div class="export-delivery__checklist" role="list" aria-label="本地导出检查项">
        <div v-for="item in preflightItems" :key="item.label" role="listitem" :class="`is-${item.tone}`">
          <img :src="statusAsset(item.tone)" alt="" />
          <span><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span>
          <b>{{ item.value }}</b>
        </div>
      </div>

      <div v-if="blockerCount" class="export-delivery__alert export-delivery__alert--danger" role="alert">
        <TriangleAlert :size="16" />
        <span><strong>{{ blockerCount }} 项阻断导出</strong><small>先回到审阅或时间线补齐 canonical assembly。</small></span>
      </div>
      <div v-else class="export-delivery__alert export-delivery__alert--success" role="status">
        <CircleCheck :size="16" />
        <span><strong>装配预检可执行</strong><small>最终磁盘权限和媒体内容将在服务端预检时复核。</small></span>
      </div>

      <button type="button" class="export-delivery__secondary" @click="emit('navigate', blockerCount ? 'review' : 'timeline')">
        <ListChecks :size="16" />{{ blockerCount ? '修复阻断项' : '检查时间线装配' }}
      </button>
    </section>

    <section class="export-delivery__panel export-delivery__panel--preset" aria-labelledby="export-preset-heading">
      <header class="export-delivery__panel-heading">
        <span class="export-delivery__section-icon" aria-hidden="true">02</span>
        <span><strong id="export-preset-heading">输出预设</strong><small>竖屏母版 · 当前实现能力</small></span>
      </header>

      <div class="export-delivery__preset-name">
        <span><strong>漫剧竖屏母版</strong><small>H.264 优先 · 本地 FFmpeg</small></span>
        <span class="export-delivery__badge">已验证</span>
      </div>
      <dl class="export-delivery__specs">
        <div><dt>画面尺寸</dt><dd>1080 × 1920</dd></div>
        <div><dt>画面比例</dt><dd>9:16</dd></div>
        <div><dt>帧率</dt><dd>24 fps</dd></div>
        <div><dt>视频编码</dt><dd>{{ resultVideoCodec }}</dd></div>
        <div><dt>音频</dt><dd>Demo 静音</dd></div>
        <div><dt>字幕</dt><dd>未烧录 · SRT Planned</dd></div>
      </dl>
      <div class="export-delivery__file-name">
        <span>文件名</span>
        <strong>{{ exportFileName }}</strong>
      </div>
      <p class="export-delivery__cost"><ShieldCheck :size="15" />本地导出 · Provider demo-local · 付费请求 0</p>
      <button
        type="button"
        class="export-delivery__primary"
        :disabled="!canExport || exportBusy || store.loading"
        @click="handlePrimaryExport"
      >
        <LoaderCircle v-if="exportBusy" class="spin" :size="16" />
        <Film v-else :size="16" />
        {{ primaryExportLabel }}
      </button>
    </section>

    <section class="export-delivery__panel export-delivery__panel--status" aria-labelledby="export-status-heading">
      <header class="export-delivery__panel-heading">
        <span class="export-delivery__section-icon" aria-hidden="true">03</span>
        <span><strong id="export-status-heading">交付状态</strong><small>任务证据和本地成片</small></span>
      </header>

      <div class="export-delivery__task-state" :class="`is-${latestTaskTone}`" aria-live="polite">
        <img :src="statusAsset(latestTaskTone)" alt="" />
        <span><strong>{{ latestTaskLabel }}</strong><small>{{ latestTaskDetail }}</small></span>
      </div>

      <dl v-if="latestExportTask" class="export-delivery__result">
        <div><dt>任务</dt><dd>{{ latestExportTask.stage }}</dd></div>
        <div><dt>规格</dt><dd>{{ taskResolution }}</dd></div>
        <div><dt>时长</dt><dd>{{ taskDuration }}</dd></div>
        <div><dt>文件大小</dt><dd>{{ resultMedia ? formatBytes(resultMedia.size) : '完成后可见' }}</dd></div>
        <div><dt>装配哈希</dt><dd><code>{{ taskAssemblyHash }}</code></dd></div>
      </dl>
      <div v-else class="export-delivery__empty-task">
        <FileVideo2 :size="22" />
        <span><strong>尚未创建导出任务</strong><small>先运行服务端预检，再明确确认开始 FFmpeg。</small></span>
      </div>

      <div v-if="store.pendingExportPreflight" class="export-delivery__confirmation" role="note">
        <strong>预检已完成，尚未开始导出</strong>
        <span>{{ store.pendingExportPreflight.width }}×{{ store.pendingExportPreflight.height }} · {{ store.pendingExportPreflight.fps }} fps</span>
        <span>Assembly {{ shortHash(store.pendingExportPreflight.assemblyHash) }}</span>
      </div>

      <button
        v-if="latestExportTask?.status === 'succeeded' && resultMedia"
        type="button"
        class="export-delivery__primary"
        :disabled="downloadBusy"
        @click="downloadResult"
      ><Download :size="16" />{{ downloadBusy ? '正在准备成片' : '下载本地成片' }}</button>
      <button
        v-else-if="retryableFailure"
        type="button"
        class="export-delivery__primary"
        :disabled="store.loading"
        @click="retryLatestTask"
      ><RotateCcw :size="16" />仅重试本次导出</button>
      <button type="button" class="export-delivery__secondary" disabled title="当前版本尚无 DeliveryRecord 后端契约">
        <ClipboardCheck :size="16" />创建交付记录 · Planned
      </button>
    </section>

    <section class="export-delivery__packages" aria-labelledby="export-package-heading">
      <header>
        <span class="export-delivery__section-icon" aria-hidden="true">04</span>
        <span><strong id="export-package-heading">项目包与备份</strong><small>可迁移、可恢复、凭证排除</small></span>
      </header>
      <div class="export-delivery__package-grid">
        <article :class="{ active: exportPresetReady }">
          <img :src="statusAsset(exportPresetReady ? 'success' : 'neutral')" alt="" />
          <span><strong>ExportPreset · 竖屏母版</strong><small>{{ exportPresetSummary }}</small></span>
          <b>Local</b>
        </article>
        <button type="button" :disabled="packageBusy" @click="downloadProjectPackage">
          <img :src="statusAsset('active')" alt="" />
          <span><strong>导出项目包</strong><small>{{ snapshot.media.length }} 个媒体引用 · 不包含凭证与日志</small></span>
          <Download :size="16" />
        </button>
        <button type="button" :disabled="diagnosticBusy" @click="downloadDiagnostic">
          <img :src="statusAsset('info')" alt="" />
          <span><strong>脱敏诊断与审计证据</strong><small>稳定错误码 · 不包含正文、Prompt 或本机路径</small></span>
          <Download :size="16" />
        </button>
      </div>
      <p><ShieldCheck :size="14" />项目数据库是唯一事实源；媒体、任务和检查点可在服务重启后恢复。</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  CircleCheck, ClipboardCheck, Download, FileVideo2, Film, ListChecks, LoaderCircle,
  RotateCcw, ShieldCheck, TriangleAlert,
} from 'lucide-vue-next'
import type { GenerationTask, MediaReference, ProjectSnapshot } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'
import type { StudioWorkspaceId } from '../workspaces.js'

type StatusTone = 'success' | 'neutral' | 'active' | 'danger' | 'warning' | 'info'
type PreflightItem = { label: string; detail: string; value: string; tone: StatusTone }

const emit = defineEmits<{ navigate: [workspaceId: StudioWorkspaceId] }>()
const store = useStudioStore()
const snapshot = computed<ProjectSnapshot>(() => store.snapshot!)
const packageBusy = ref(false)
const diagnosticBusy = ref(false)
const downloadBusy = ref(false)
let taskPoll: ReturnType<typeof setInterval> | undefined

const orderedShots = computed(() => [...snapshot.value.shots].sort((left, right) => left.ordinal - right.ordinal))
const selectedShots = computed(() => orderedShots.value.filter((shot) => Boolean(shot.selectedCandidateId)))
const verifiedMediaCount = computed(() => selectedShots.value.filter((shot) => {
  const candidate = snapshot.value.candidates.find((item) => item.id === shot.selectedCandidateId && item.status === 'ready')
  const media = snapshot.value.media.find((item) => item.id === candidate?.mediaId)
  return Boolean(media && /^[a-f0-9]{64}$/u.test(media.sha256))
}).length)
const subtitleCount = computed(() => orderedShots.value.filter((shot) => shot.dialogue.trim()).length)
const musicAsset = computed(() => snapshot.value.assets.find((asset) => asset.type === 'music' && !asset.archived))
const blockerCount = computed(() => Number(orderedShots.value.length === 0)
  + Number(selectedShots.value.length !== orderedShots.value.length)
  + Number(verifiedMediaCount.value !== selectedShots.value.length))
const canExport = computed(() => blockerCount.value === 0)
const preflightItems = computed<PreflightItem[]>(() => [
  {
    label: '候选已批准', detail: '每个镜头唯一 active take',
    value: `${selectedShots.value.length} / ${orderedShots.value.length}`,
    tone: selectedShots.value.length === orderedShots.value.length && orderedShots.value.length ? 'success' : 'danger',
  },
  {
    label: '媒体完整性', detail: 'SHA-256 引用校验',
    value: `${verifiedMediaCount.value} / ${selectedShots.value.length}`,
    tone: verifiedMediaCount.value === selectedShots.value.length && selectedShots.value.length ? 'success' : 'danger',
  },
  {
    label: '字幕安全区', detail: subtitleCount.value ? '从对白预览推导' : 'Demo 无字幕',
    value: subtitleCount.value ? `${subtitleCount.value} 条预览` : '0 条阻断', tone: subtitleCount.value ? 'warning' : 'success',
  },
  {
    label: '音频与授权', detail: musicAsset.value ? '内部 Demo 静音资产' : '未配置音乐资产',
    value: musicAsset.value ? '可追溯' : '静音', tone: musicAsset.value ? 'success' : 'neutral',
  },
  { label: '磁盘与权限', detail: '仅在用户确认后检查', value: '预检时验证', tone: 'info' },
])

const exportFileName = computed(() => {
  const safeName = snapshot.value.project.name.replace(/[\\/:*?"<>|]/gu, '-').replace(/[《》]/gu, '') || 'director-demo'
  return `${safeName}_S01_v${String(snapshot.value.project.graphRevision).padStart(2, '0')}.mp4`
})
const exportTasks = computed(() => store.tasks.filter((task) => task.type === 'export').sort((left, right) => right.createdAt.localeCompare(left.createdAt)))
const latestExportTask = computed<GenerationTask | undefined>(() => exportTasks.value[0])
const taskIsActive = computed(() => latestExportTask.value ? ['queued', 'running', 'retrying', 'cancel_requested', 'reconciling'].includes(latestExportTask.value.status) : false)
const exportBusy = computed(() => taskIsActive.value)
const retryableFailure = computed(() => Boolean(latestExportTask.value?.retryable && ['failed', 'timed_out', 'needs_attention'].includes(latestExportTask.value.status)))
const latestTaskTone = computed<StatusTone>(() => {
  const status = latestExportTask.value?.status
  if (status === 'succeeded') return 'success'
  if (status && ['failed', 'timed_out', 'cancelled'].includes(status)) return 'danger'
  if (status && ['outcome_unknown', 'orphaned', 'needs_attention'].includes(status)) return 'warning'
  if (taskIsActive.value) return 'active'
  return 'neutral'
})
const latestTaskLabel = computed(() => {
  const status = latestExportTask.value?.status
  if (!status) return '尚未导出'
  const labels: Record<string, string> = {
    queued: '导出已排队', running: '正在生成本地母版', retrying: '正在重试导出',
    succeeded: '本地母版已完成', failed: '导出未完成', timed_out: '导出超时', cancelled: '导出已取消',
    outcome_unknown: '导出结果待对账', orphaned: '任务需要恢复', needs_attention: '导出需要处理',
    cancel_requested: '正在取消导出', reconciling: '正在对账', waiting_approval: '等待用户确认',
  }
  return labels[status] ?? '导出任务已更新'
})
const latestTaskDetail = computed(() => {
  const task = latestExportTask.value
  if (!task) return '运行预检后才会创建持久任务'
  if (task.error) return `${task.error.code} · ${task.error.userMessage}`
  if (task.status === 'succeeded') return '已写入受管媒体库，刷新或重启后仍可恢复'
  if (taskIsActive.value) return `${task.stage} · 不伪造进度百分比`
  return `${task.stage} · attempt ${task.attempt}`
})
const taskInput = computed(() => latestExportTask.value?.inputSnapshot ?? {})
const taskResolution = computed(() => {
  const width = typeof taskInput.value.width === 'number' ? taskInput.value.width : 1080
  const height = typeof taskInput.value.height === 'number' ? taskInput.value.height : 1920
  const fps = typeof taskInput.value.fps === 'number' ? taskInput.value.fps : 24
  return `${width}×${height} · ${fps} fps`
})
const resultMedia = computed<MediaReference | undefined>(() => {
  const mediaId = latestExportTask.value?.result?.mediaId
  return typeof mediaId === 'string' ? snapshot.value.media.find((media) => media.id === mediaId) : undefined
})
const taskDuration = computed(() => {
  const value = latestExportTask.value?.result?.durationMs
  return typeof value === 'number' ? formatDuration(value) : '完成后可见'
})
const taskAssemblyHash = computed(() => {
  const value = latestExportTask.value?.result?.assemblyHash ?? taskInput.value.assemblyHash
  return typeof value === 'string' ? shortHash(value) : '待预检'
})
const resultVideoCodec = computed(() => {
  const value = latestExportTask.value?.result?.videoCodec
  if (value === 'h264') return 'H.264'
  if (value === 'mpeg4') return 'MPEG-4 Part 2 · fallback'
  return 'H.264 优先'
})
const primaryExportLabel = computed(() => {
  if (exportBusy.value) return latestTaskLabel.value
  if (store.pendingExportPreflight) return '确认并开始本地导出'
  return '生成本地 MP4 母版'
})
const exportPresetReady = computed(() => Boolean(store.pendingExportPreflight || latestExportTask.value?.status === 'succeeded'))
const exportPresetSummary = computed(() => {
  if (latestExportTask.value?.status === 'succeeded') return `本地导出完成 · ${taskResolution.value.split(' · ')[0]}`
  if (store.pendingExportPreflight) return '本地预检通过 · 1080×1920'
  return '等待本地预检'
})

function statusAsset(tone: StatusTone): string { return `/figma-v2/export/status-${tone}.svg` }
function shortHash(value: string): string { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value }
function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
async function chooseExportDirectory(): Promise<string | null> {
  if (window.aigcDirector) return await window.aigcDirector.selectExportDirectory()
  return '/tmp/aigc-director-export'
}
async function handlePrimaryExport(): Promise<void> {
  if (store.pendingExportPreflight) {
    const task = await store.confirmExport()
    if (task) startTaskPolling()
    return
  }
  const directory = await chooseExportDirectory()
  if (!directory) return
  await store.prepareExport(directory, { fileName: exportFileName.value, width: 1080, height: 1920, fps: 24 })
}
function startTaskPolling(): void {
  if (taskPoll) clearInterval(taskPoll)
  taskPoll = setInterval(async () => {
    await store.refreshTasks()
    if (!taskIsActive.value && taskPoll) {
      clearInterval(taskPoll)
      taskPoll = undefined
      if (latestExportTask.value?.status === 'succeeded' && store.currentProjectId) await store.loadProject(store.currentProjectId)
    }
  }, 750)
}
async function retryLatestTask(): Promise<void> {
  if (!latestExportTask.value) return
  await store.retryTask(latestExportTask.value.id)
  startTaskPolling()
}
async function downloadResult(): Promise<void> {
  if (!resultMedia.value || !store.currentProjectId) return
  downloadBusy.value = true
  try {
    const blob = await directorApi.mediaBlob(store.currentProjectId, resultMedia.value.locator)
    const resultFileName = latestExportTask.value?.result?.fileName
    saveBlob(blob, typeof resultFileName === 'string' ? resultFileName : exportFileName.value)
  } finally { downloadBusy.value = false }
}
async function downloadProjectPackage(): Promise<void> {
  packageBusy.value = true
  try {
    const result = await store.exportProjectPackage()
    if (result) saveBlob(result.blob, result.fileName)
  } finally { packageBusy.value = false }
}
async function downloadDiagnostic(): Promise<void> {
  diagnosticBusy.value = true
  try {
    const result = await store.exportDiagnosticBundle()
    if (result) saveBlob(result.blob, result.fileName)
  } finally { diagnosticBusy.value = false }
}

onBeforeUnmount(() => { if (taskPoll) clearInterval(taskPoll) })
</script>
