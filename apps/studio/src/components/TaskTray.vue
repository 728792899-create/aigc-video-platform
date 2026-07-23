<template>
  <section class="task-tray" data-guide-target="task-tray" data-onboarding-target="task-tray" :class="{ 'task-tray--open': open }" aria-label="任务中心">
    <button class="task-tray__trigger" type="button" @click="open = !open">
      <ListChecks :size="17" /><span>任务</span><strong>{{ attentionCount }}</strong><ChevronUp :size="15" :class="{ rotate: open }" />
    </button>
    <div v-if="open" ref="trayBody" class="task-tray__body" tabindex="-1">
      <header>
        <div><span class="eyebrow">DURABLE TASKS</span><h2>任务、对账与恢复</h2><small v-if="store.taskAdmission">并发 {{ activeCount }}/{{ store.taskAdmission.maxConcurrentTasks }} · 单批 {{ store.taskAdmission.maxCandidatesPerBatch }} · 导出 ≤ {{ Math.round(store.taskAdmission.maxExportDurationMs / 1000) }} 秒 · 付费预算 ¥0</small></div>
        <div class="task-tray__header-actions">
          <button class="icon-button" type="button" aria-label="下载脱敏诊断包" :disabled="!store.currentProjectId || store.loading" @click="downloadDiagnostics"><Download :size="16" /></button>
          <button class="icon-button" type="button" aria-label="刷新任务" @click="store.refreshTasks"><RefreshCw :size="16" /></button>
        </div>
      </header>
      <div v-if="store.tasks.length === 0" class="task-empty">还没有生成或导出任务。</div>
      <ol v-else class="task-list">
        <li v-for="task in recentTasks" :key="task.id" :class="`task task--${task.status}`" @click="selectTask(task.id)">
          <div class="task__summary">
            <i /><div><strong>{{ task.stage }}</strong><span>{{ statusLabel(task.status) }} · {{ task.provider }} / {{ task.model }} · attempt {{ task.attempt }}</span></div><small>{{ elapsed(task) }}</small>
          </div>
          <p v-if="task.needsAttentionReason" class="task__reason">{{ task.needsAttentionReason }}</p>
          <div class="task__actions" @click.stop>
            <button type="button" @click="store.inspectTask(task.id)"><SearchCheck :size="13" />诊断</button>
            <button v-if="canReconcile(task)" type="button" @click="store.reconcileTask(task.id)"><RefreshCw :size="13" />对账</button>
            <button v-if="canCancel(task)" type="button" @click="store.cancelTask(task.id)"><Square :size="12" />取消</button>
            <button v-if="canRetry(task) && confirmingRetryId !== task.id" type="button" @click="confirmingRetryId = task.id"><RotateCcw :size="13" />重试</button>
            <button v-else-if="canRetry(task)" class="task__confirm" type="button" @click="confirmRetry(task.id)">确认新 attempt</button>
          </div>
          <dl v-if="store.taskDiagnostics[task.id]" class="task__diagnostic">
            <div><dt>结果</dt><dd>{{ store.taskDiagnostics[task.id]?.outcomeCertainty === 'unknown' ? '未知，禁止盲目重提' : '已确定' }}</dd></div>
            <div><dt>取消</dt><dd>{{ cancelLabel(store.taskDiagnostics[task.id]?.cancelSemantics) }}</dd></div>
            <div><dt>关联 ID</dt><dd>{{ store.taskDiagnostics[task.id]?.correlationId }}</dd></div>
          </dl>
        </li>
      </ol>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ChevronUp, Download, ListChecks, RefreshCw, RotateCcw, SearchCheck, Square } from 'lucide-vue-next'
import type { GenerationTask, TaskDiagnostic } from '@aigc-director/contracts'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const open = ref(false)
const trayBody = ref<HTMLElement>()
const confirmingRetryId = ref<string>()
const attentionCount = computed(() => store.tasks.filter((task) => [
  'queued', 'running', 'retrying', 'waiting_approval', 'outcome_unknown', 'orphaned', 'reconciling', 'needs_attention',
].includes(task.status)).length)
const activeCount = computed(() => store.tasks.filter((task) => [
  'queued', 'running', 'retrying', 'waiting_approval', 'cancel_requested', 'reconciling', 'outcome_unknown',
].includes(task.status)).length)
const recentTasks = computed(() => [...store.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12))

function elapsed(task: GenerationTask): string {
  return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(Math.round((Date.parse(task.updatedAt) - Date.now()) / 60_000), 'minute')
}
function canCancel(task: GenerationTask): boolean { return ['queued', 'running', 'waiting_approval'].includes(task.status) }
function canReconcile(task: GenerationTask): boolean { return ['outcome_unknown', 'orphaned', 'reconciling', 'needs_attention'].includes(task.status) }
function canRetry(task: GenerationTask): boolean { return task.retryable && ['failed', 'timed_out', 'cancelled', 'needs_attention'].includes(task.status) }
function statusLabel(status: GenerationTask['status']): string {
  return ({
    queued: '排队中', running: '运行中', waiting_approval: '等待审批', retrying: '正在重试', succeeded: '已完成', failed: '失败',
    cancel_requested: '取消请求中', cancelled: '已取消', timed_out: '已超时', orphaned: '失联待对账', reconciling: '正在对账',
    outcome_unknown: '结果未知', needs_attention: '需要处理',
  })[status]
}
function cancelLabel(value: TaskDiagnostic['cancelSemantics'] | undefined): string {
  return ({ none: '未请求', local_only: '仅本地', provider_requested: 'Provider 已请求', provider_confirmed: 'Provider 已确认', unsupported: '不支持' })[value ?? 'none']
}
async function confirmRetry(taskId: string): Promise<void> {
  confirmingRetryId.value = undefined
  await store.retryTask(taskId)
}
async function downloadDiagnostics(): Promise<void> {
  const exported = await store.exportDiagnosticBundle()
  if (!exported) return
  const url = URL.createObjectURL(exported.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exported.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
function selectTask(taskId: string): void {
  void store.inspectTask(taskId)
  const id = `task:${taskId}`
  if (store.graph?.nodes.some((node) => node.id === id)) store.selectNode(id)
}

async function openTray(): Promise<void> {
  open.value = true
  await nextTick()
  trayBody.value?.focus()
}

defineExpose({ openTray })
</script>
