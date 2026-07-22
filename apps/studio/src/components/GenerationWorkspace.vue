<template>
  <section
    class="generation-workspace"
    data-figma-node="17:18"
    data-guide-target="generation-mode"
    tabindex="-1"
    aria-labelledby="generation-workspace-title"
  >
    <header class="generation-workspace__heading">
      <h1 id="generation-workspace-title">生成队列</h1>
      <p>按模型能力、预算和镜头依赖提交批次，部分失败只重试失败项。</p>
    </header>

    <section class="generation-workspace__policy" aria-label="当前生成策略">
      <strong>{{ policyTitle }}</strong>
      <span>{{ policyDetail }}</span>
      <em><ShieldCheck :size="14" />{{ policyTrust }}</em>
    </section>

    <div v-if="!activeBatch" class="generation-workspace__empty">
      <section>
        <span class="generation-workspace__batch-label">尚未提交生成批次</span>
        <article class="generation-workspace__empty-card">
          <Sparkles :size="26" />
          <div><strong>零 Key Demo 已就绪</strong><p>使用仓库内原创素材创建确定性候选；网络保持关闭，费用为 0。</p></div>
        </article>
        <div class="generation-workspace__action">
          <p><CheckCircle2 :size="15" />前置镜头 {{ shots.length }} 个 · 本地素材已校验</p>
          <button class="generation-workspace__retry" type="button" :disabled="store.loading || shots.length === 0" @click="runPrimary">
            <LoaderCircle v-if="store.loading" :size="16" class="generation-workspace__spinner" />
            <Sparkles v-else :size="16" />
            {{ shots.length === 0 ? '先完成分镜' : '提交零 Key Demo' }}
          </button>
        </div>
      </section>
      <figure class="generation-workspace__preview generation-workspace__preview--empty">
        <ImageOff :size="28" />
        <strong>等待首个候选</strong>
        <span>提交批次后在此查看当前任务预览。</span>
      </figure>
    </div>

    <div v-else class="generation-workspace__body">
      <section class="generation-workspace__queue">
        <div class="generation-workspace__batch-heading">
          <span class="generation-workspace__batch-label">批次 {{ activeShotLabel }} · {{ activeBatch.quantity }} 个候选</span>
          <select v-if="batches.length > 1" v-model="selectedBatchId" aria-label="切换生成批次" @change="retryArmed = false">
            <option v-for="batch in batches" :key="batch.id" :value="batch.id">{{ batchLabel(batch) }}</option>
          </select>
        </div>

        <div class="generation-workspace__tasks" role="list" aria-label="候选生成任务">
          <button
            v-for="item in items"
            :key="item.key"
            class="generation-workspace__task"
            :class="[`generation-workspace__task--${item.tone}`, { active: item.index === activeItemIndex }]"
            type="button"
            role="listitem"
            :aria-pressed="item.index === activeItemIndex"
            @click="activeItemIndex = item.index"
          >
            <span>
              <CheckCircle2 v-if="item.tone === 'success'" :size="17" />
              <LoaderCircle v-else-if="item.tone === 'running'" :size="17" class="generation-workspace__spinner" />
              <TriangleAlert v-else-if="item.tone === 'danger'" :size="17" />
              <Clock3 v-else :size="17" />
              <strong>{{ item.label }} · {{ item.statusLabel }}</strong>
            </span>
            <em>{{ item.detail }}</em>
          </button>
        </div>

        <div class="generation-workspace__action">
          <p :class="`generation-workspace__summary--${actionTone}`">
            <TriangleAlert v-if="actionTone === 'warning'" :size="15" />
            <CheckCircle2 v-else-if="actionTone === 'success'" :size="15" />
            <Clock3 v-else :size="15" />
            {{ actionSummary }}
          </p>
          <button class="generation-workspace__retry" type="button" :disabled="store.loading" @click="runPrimary">
            <LoaderCircle v-if="store.loading" :size="16" class="generation-workspace__spinner" />
            <RotateCcw v-else-if="hasFailures" :size="16" />
            <ArrowRight v-else :size="16" />
            {{ primaryLabel }}
          </button>
        </div>
      </section>

      <aside class="generation-workspace__preview-column">
        <figure class="generation-workspace__preview">
          <img v-if="demoPreview" :src="demoPreview" :alt="`${activeItem?.label ?? '当前候选'}的零 Key Demo 预览`" />
          <MediaPreview
            v-else-if="activeMedia"
            :project-id="activeMedia.projectId"
            :locator="activeMedia.locator"
            :alt="`${activeItem?.label ?? '当前候选'}的媒体预览`"
          />
          <div v-else class="generation-workspace__preview-missing"><ImageOff :size="28" /><span>当前任务尚未产生可预览媒体</span></div>
        </figure>
        <p class="generation-workspace__preview-label">ACTIVE PREVIEW · {{ activeItem?.label ?? '等待候选' }}</p>
        <p class="generation-workspace__safety"><ShieldAlert :size="14" />unknown 结果必须先对账，不能直接重试。</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowRight, CheckCircle2, Clock3, ImageOff, LoaderCircle, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, TriangleAlert,
} from 'lucide-vue-next'
import type { CandidateBatch, GenerationTask, MediaReference } from '@aigc-director/contracts'
import MediaPreview from './MediaPreview.vue'
import type { StudioWorkspaceId } from '../workspaces.js'
import { useStudioStore } from '../stores/studio.js'

type ItemTone = 'neutral' | 'running' | 'success' | 'danger'
type GenerationItem = {
  key: string
  index: number
  label: string
  statusLabel: string
  detail: string
  tone: ItemTone
  task?: GenerationTask
}

const emit = defineEmits<{ navigate: [workspaceId: StudioWorkspaceId] }>()
const store = useStudioStore()
const selectedBatchId = ref('')
const activeItemIndex = ref(-1)
const retryArmed = ref(false)

const snapshot = computed(() => store.snapshot)
const shots = computed(() => [...(snapshot.value?.shots ?? [])].sort((left, right) => left.ordinal - right.ordinal))
const batches = computed(() => [...(snapshot.value?.candidateBatches ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
const activeBatch = computed(() => batches.value.find((batch) => batch.id === selectedBatchId.value))
const activeShot = computed(() => shots.value.find((shot) => shot.id === activeBatch.value?.shotId))
const isDemo = computed(() => store.generationPolicy?.billingMode !== 'user-funded')
const isXingque = computed(() => snapshot.value?.project.name.includes('星阙回声') === true)
const batchTasks = computed(() => {
  if (!activeBatch.value) return []
  return store.tasks
    .filter((task) => task.inputSnapshot.batchId === activeBatch.value?.id)
    .sort((left, right) => taskIndex(left) - taskIndex(right) || left.createdAt.localeCompare(right.createdAt))
})
const items = computed<GenerationItem[]>(() => {
  if (!activeBatch.value) return []
  return Array.from({ length: activeBatch.value.quantity }, (_, index) => {
    const task = batchTasks.value.find((candidateTask) => taskIndex(candidateTask) === index) ?? batchTasks.value[index]
    return taskItem(index, task)
  })
})
const activeItem = computed(() => items.value.find((item) => item.index === activeItemIndex.value) ?? items.value[0])
const hasUnknown = computed(() => batchTasks.value.some((task) => task.status === 'outcome_unknown' || task.status === 'reconciling'))
const failedCount = computed(() => Math.max(activeBatch.value?.failedCount ?? 0, batchTasks.value.filter((task) => ['failed', 'timed_out', 'needs_attention'].includes(task.status)).length))
const hasFailures = computed(() => failedCount.value > 0 && !hasUnknown.value)
const isComplete = computed(() => activeBatch.value?.status === 'succeeded')
const isRunning = computed(() => batchTasks.value.some((task) => ['queued', 'running', 'retrying', 'waiting_approval', 'cancel_requested'].includes(task.status)))

const policyTitle = computed(() => isDemo.value ? '零 Key Demo · demo-local' : '用户自付 · 项目 Provider')
const policyDetail = computed(() => {
  const model = activeBatch.value?.modelId ?? (isDemo.value ? 'demo-frame-v1' : '项目路由')
  const referenceCount = activeShot.value?.boundaryFrames.length || (isXingque.value ? 4 : 0)
  return isDemo.value
    ? `本地确定性素材 · ${model} · ${referenceCount} 张参考图 · 预计 ¥0 / 上限 ¥0`
    : `${model} · 媒体输入 ${referenceCount} 项 · 成本按提交前门禁确认`
})
const policyTrust = computed(() => isDemo.value ? '网络禁用 · 付费请求 0' : '凭证隔离 · 日志已脱敏')
const activeShotLabel = computed(() => activeShot.value ? `SHOT-${String(activeShot.value.ordinal + 1).padStart(2, '0')}` : '未绑定镜头')
const actionTone = computed<'warning' | 'success' | 'neutral'>(() => hasFailures.value ? 'warning' : isComplete.value ? 'success' : 'neutral')
const actionSummary = computed(() => {
  if (hasUnknown.value) return '结果状态未知 · 未重复扣费 · 需要先对账'
  if (hasFailures.value) return `${failedCount.value} 项失败 · ${failureReason.value} · 未产生费用`
  if (isComplete.value) return `${activeBatch.value?.completedCount ?? items.value.length} 个候选已完成 · billed=false`
  return isRunning.value ? '批次正在运行 · 页面可安全离开' : '批次等待调度 · 可在任务中心查看详情'
})
const failureReason = computed(() => {
  const code = batchTasks.value.find((task) => task.error)?.error?.code ?? '可重试错误'
  return publicErrorCode(code) === 'RATE_LIMITED' ? '限流' : publicErrorCode(code)
})
const primaryLabel = computed(() => {
  if (hasUnknown.value) return '前往任务中心对账'
  if (hasFailures.value) return retryArmed.value ? `确认仅重试 ${failedCount.value} 个失败候选` : '仅重试失败候选'
  if (isComplete.value) return '前往候选审阅'
  return '打开任务中心'
})
const demoPreview = computed(() => {
  if (!isXingque.value || !isDemo.value || !activeItem.value) return ''
  const number = Math.min(activeItem.value.index + 1, 3)
  return `/demo/xingque/candidate-${String(number).padStart(2, '0')}.png`
})
const activeMedia = computed<MediaReference | undefined>(() => {
  const task = activeItem.value?.task
  if (!task) return undefined
  const candidate = snapshot.value?.candidates.find((item) => item.taskId === task.id)
  return snapshot.value?.media.find((item) => item.id === candidate?.mediaId)
})

watch(batches, (next) => {
  if (next.some((batch) => batch.id === selectedBatchId.value)) return
  selectedBatchId.value = next.find((batch) => ['partial', 'running', 'failed'].includes(batch.status))?.id ?? next[0]?.id ?? ''
}, { immediate: true })
watch(items, (next) => {
  if (next.some((item) => item.index === activeItemIndex.value)) return
  activeItemIndex.value = next.find((item) => item.tone === 'running')?.index ?? next.find((item) => item.tone === 'success')?.index ?? next[0]?.index ?? 0
}, { immediate: true })

function taskIndex(task: GenerationTask): number {
  const value = task.inputSnapshot.variant
  return typeof value === 'number' && Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER
}
function taskItem(index: number, task?: GenerationTask): GenerationItem {
  const label = `Candidate ${String.fromCharCode(65 + index)}`
  if (!task) return { key: `${activeBatch.value?.id ?? 'batch'}-${index}`, index, label, statusLabel: '等待调度', detail: 'QUEUED', tone: 'neutral' }
  if (task.status === 'succeeded') return { key: task.id, index, label, statusLabel: '已完成', detail: formatSize(taskMediaSize(task)), tone: 'success', task }
  if (['running', 'retrying', 'reconciling'].includes(task.status)) return { key: task.id, index, label, statusLabel: task.status === 'reconciling' ? '对账中' : '生成中', detail: `${Math.round((task.progress ?? 0) * 100)}%`, tone: 'running', task }
  if (['failed', 'timed_out', 'outcome_unknown', 'needs_attention'].includes(task.status)) return {
    key: task.id, index, label, statusLabel: task.status === 'outcome_unknown' ? '结果未知' : '失败',
    detail: task.status === 'outcome_unknown' ? 'RECONCILE_REQUIRED' : publicErrorCode(task.error?.code ?? task.status), tone: 'danger', task,
  }
  return { key: task.id, index, label, statusLabel: task.status === 'cancelled' ? '已取消' : '等待调度', detail: task.status.toUpperCase(), tone: 'neutral', task }
}
function publicErrorCode(code: string): string { return code.replace(/^PROVIDER_/, '').replace(/^TASK_/, '') }
function formatSize(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '完成'
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
function taskMediaSize(task: GenerationTask): unknown {
  const candidate = snapshot.value?.candidates.find((item) => item.taskId === task.id)
  return snapshot.value?.media.find((item) => item.id === candidate?.mediaId)?.size ?? task.result?.size
}
function batchLabel(batch: CandidateBatch): string {
  const shot = shots.value.find((item) => item.id === batch.shotId)
  const label = shot ? `SHOT-${String(shot.ordinal + 1).padStart(2, '0')}` : '未绑定镜头'
  return `${label} · ${batch.status} · ${batch.quantity} 项`
}
async function runPrimary(): Promise<void> {
  if (!activeBatch.value) { await store.produceDemo(); return }
  if (hasUnknown.value) { emit('navigate', 'tasks'); return }
  if (hasFailures.value) {
    if (!retryArmed.value) { retryArmed.value = true; return }
    retryArmed.value = false
    await store.retryFailedCandidateBatch(activeBatch.value.id)
    return
  }
  emit('navigate', isComplete.value ? 'review' : 'tasks')
}
</script>
