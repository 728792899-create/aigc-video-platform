<template>
  <section
    class="task-center-workspace task-diagnostics"
    data-figma-node="23:2"
    data-onboarding-target="task-center"
    data-guide-target="task-center"
    tabindex="-1"
    aria-labelledby="task-center-list-title"
  >
    <nav class="task-diagnostics__filters" aria-label="任务状态筛选">
      <button v-for="item in filters" :key="item.id" type="button" :aria-pressed="filter === item.id" @click="filter = item.id">
        <i :class="`task-diagnostics__dot task-diagnostics__dot--${item.tone}`" aria-hidden="true" />{{ item.label }} {{ item.count }}
      </button>
    </nav>

    <div class="task-diagnostics__layout">
      <section class="task-diagnostics__list-panel" aria-labelledby="task-center-list-title">
        <header>
          <div><h1 id="task-center-list-title">任务列表</h1><p>默认按需关注程度、更新时间排序</p></div>
          <button class="task-diagnostics__icon-button" type="button" :disabled="store.loading || !store.currentProjectId" aria-label="刷新任务" @click="store.refreshTasks"><RefreshCw :size="15" :class="{ 'task-diagnostics__spin': store.loading }" /></button>
        </header>
        <div v-if="visibleItems.length" class="task-diagnostics__list" role="list" aria-label="任务和部分成功批次">
          <button v-for="item in visibleItems" :key="item.key" class="task-diagnostics__card" :class="[`task-diagnostics__card--${item.tone}`, { active: item.key === selectedKey }]" type="button" role="listitem" :aria-pressed="item.key === selectedKey" @click="selectItem(item)">
            <strong>{{ item.title }}</strong>
            <span><i :class="`task-diagnostics__dot task-diagnostics__dot--${item.tone}`" aria-hidden="true" />{{ item.status }}</span>
            <small>{{ item.detail }}</small>
          </button>
        </div>
        <div v-else class="task-diagnostics__empty"><CircleCheck :size="26" /><strong>{{ store.currentProjectId ? '当前筛选没有任务' : '先选择一个项目' }}</strong><span>{{ store.currentProjectId ? '切换筛选，或从生成工作区提交新的可恢复任务。' : '任务、Attempt 与诊断只显示当前项目的 canonical 状态。' }}</span></div>
      </section>

      <section class="task-diagnostics__detail" aria-live="polite">
        <template v-if="selectedTask">
          <header><h2>{{ selectedTaskHeading }}</h2><p>{{ selectedTaskReason }}</p></header>
          <dl>
            <div><dt>稳定错误码</dt><dd>{{ selectedDiagnostic?.errorCode ?? publicStatusCode(selectedTask.status) }}</dd></div>
            <div><dt>Provider</dt><dd>{{ selectedTask.provider }} / {{ selectedTask.model }}</dd></div>
            <div><dt>幂等键</dt><dd>{{ maskIdempotencyKey(selectedTask.idempotencyKey) }}</dd></div>
            <div><dt>提交时间</dt><dd>{{ formatClock(selectedTask.createdAt) }}</dd></div>
            <div><dt>最后更新</dt><dd>{{ formatClock(selectedTask.updatedAt) }}</dd></div>
            <div><dt>扣费状态</dt><dd>{{ billingLabel(selectedTask) }}</dd></div>
          </dl>
          <div class="task-diagnostics__rule" :class="{ 'task-diagnostics__rule--unknown': isUnknown(selectedTask.status) }"><strong>保护规则</strong><span>{{ protectionRule(selectedTask) }}</span></div>
          <div class="task-diagnostics__actions">
            <button v-if="canReconcile(selectedTask.status)" class="task-diagnostics__primary" type="button" :disabled="store.loading" @click="store.reconcileTask(selectedTask.id)"><SearchCheck :size="15" />查询远端并对账</button>
            <button v-if="canCancel(selectedTask.status)" type="button" :disabled="store.loading" @click="store.cancelTask(selectedTask.id)"><Square :size="13" />请求安全取消</button>
            <button v-if="canRetry(selectedTask)" type="button" :disabled="store.loading" @click="retryTask(selectedTask.id)"><RotateCcw :size="14" />{{ retryConfirmId === selectedTask.id ? '确认创建新 Attempt' : '重试失败阶段' }}</button>
            <button type="button" :disabled="store.loading" @click="downloadDiagnostics"><Download :size="14" />导出脱敏诊断</button>
          </div>
        </template>
        <template v-else-if="selectedBatch">
          <header><h2>部分成功 · {{ batchTitle(selectedBatch) }}</h2><p>已成功的候选保持不变，只为失败项创建新的任务与 Attempt。</p></header>
          <dl>
            <div><dt>批次状态</dt><dd>{{ selectedBatch.completedCount }} / {{ selectedBatch.quantity }} 已完成</dd></div>
            <div><dt>模型</dt><dd>{{ selectedBatch.modelId }}</dd></div>
            <div><dt>失败项</dt><dd>{{ selectedBatch.failedCount }} 项</dd></div>
            <div><dt>来源</dt><dd>{{ selectedBatch.source }}</dd></div>
            <div><dt>最后更新</dt><dd>{{ formatClock(selectedBatch.updatedAt) }}</dd></div>
            <div><dt>扣费状态</dt><dd>{{ isDemo ? 'Demo · 付费请求 0' : '按项目策略门禁' }}</dd></div>
          </dl>
          <div class="task-diagnostics__rule"><strong>保护规则</strong><span>仅失败候选进入新批次；成功媒体、选择状态和审阅证据不会被覆盖。</span></div>
          <div class="task-diagnostics__actions">
            <button class="task-diagnostics__primary" type="button" :disabled="store.loading || selectedBatch.failedCount === 0" @click="retryBatch(selectedBatch.id)"><RotateCcw :size="14" />{{ retryConfirmId === selectedBatch.id ? `确认仅重试 ${selectedBatch.failedCount} 个失败候选` : '仅重试失败候选' }}</button>
            <button type="button" :disabled="store.loading" @click="downloadDiagnostics"><Download :size="14" />导出脱敏诊断</button>
          </div>
        </template>
        <div v-else class="task-diagnostics__empty task-diagnostics__empty--detail"><SearchCheck :size="28" /><strong>选择任务查看诊断</strong><span>这里会显示错误码、对账约束、取消语义和安全恢复入口。</span></div>
      </section>

      <section class="task-diagnostics__attempts" aria-labelledby="attempt-timeline-title">
        <header><h2 id="attempt-timeline-title">Attempt 时间线</h2><p>追加式证据 · 不覆盖历史失败</p></header>
        <ol v-if="timelineEvents.length"><li v-for="event in timelineEvents" :key="event.key"><time :datetime="event.at"><i :class="`task-diagnostics__dot task-diagnostics__dot--${event.tone}`" aria-hidden="true" />{{ formatClock(event.at) }}</time><span>{{ event.label }}</span></li></ol>
        <div v-else class="task-diagnostics__empty task-diagnostics__empty--timeline"><span>选择任务后显示提交、receipt、轮询、对账和终态证据。</span></div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CircleCheck, Download, RefreshCw, RotateCcw, SearchCheck, Square } from 'lucide-vue-next'
import type { CandidateBatch, GenerationTask } from '@aigc-director/contracts'
import { useStudioStore } from '../stores/studio.js'

type FilterId = 'all' | 'active' | 'partial' | 'unknown' | 'failed'
type ItemTone = 'neutral' | 'running' | 'success' | 'warning' | 'unknown' | 'danger'
type TaskItem = { kind: 'task'; key: string; tone: ItemTone; title: string; status: string; detail: string; task: GenerationTask; priority: number; updatedAt: string }
type BatchItem = { kind: 'batch'; key: string; tone: ItemTone; title: string; status: string; detail: string; batch: CandidateBatch; priority: number; updatedAt: string }
type ListItem = TaskItem | BatchItem
type TimelineEvent = { key: string; at: string; label: string; tone: ItemTone }

const store = useStudioStore()
const filter = ref<FilterId>('all')
const selectedKey = ref('')
const retryConfirmId = ref('')
const activeStatuses = new Set<GenerationTask['status']>(['queued', 'running', 'retrying', 'waiting_approval', 'cancel_requested', 'reconciling'])
const unknownStatuses = new Set<GenerationTask['status']>(['outcome_unknown', 'orphaned'])
const failedStatuses = new Set<GenerationTask['status']>(['failed', 'timed_out', 'needs_attention', 'cancelled'])

const isDemo = computed(() => store.generationPolicy?.billingMode !== 'user-funded')
const partialBatches = computed(() => (store.snapshot?.candidateBatches ?? []).filter((batch) => batch.status === 'partial'))
const listItems = computed<ListItem[]>(() => {
  const taskItems: TaskItem[] = store.tasks.map((task) => ({ kind: 'task', key: `task:${task.id}`, task, updatedAt: task.updatedAt, priority: taskPriority(task), tone: taskTone(task), title: taskTitle(task), status: statusLabel(task.status), detail: taskDetail(task) }))
  const batchItems: BatchItem[] = partialBatches.value.map((batch) => ({ kind: 'batch', key: `batch:${batch.id}`, batch, updatedAt: batch.updatedAt, priority: 2, tone: 'warning', title: batchTitle(batch), status: `部分成功 ${batch.completedCount} / ${batch.quantity}`, detail: `仅 ${batch.failedCount} 个失败候选可重试` }))
  return [...taskItems, ...batchItems].sort((left, right) => left.priority - right.priority || right.updatedAt.localeCompare(left.updatedAt))
})
const visibleItems = computed(() => listItems.value.filter((item) => {
  if (filter.value === 'all') return true
  if (filter.value === 'partial') return item.kind === 'batch'
  if (item.kind !== 'task') return false
  if (filter.value === 'active') return activeStatuses.has(item.task.status)
  if (filter.value === 'unknown') return unknownStatuses.has(item.task.status)
  return failedStatuses.has(item.task.status)
}))
const filters = computed(() => [
  { id: 'all' as const, label: '全部', tone: 'neutral' as const, count: listItems.value.length },
  { id: 'active' as const, label: '运行中', tone: 'running' as const, count: store.tasks.filter((task) => activeStatuses.has(task.status)).length },
  { id: 'partial' as const, label: '部分成功', tone: 'warning' as const, count: partialBatches.value.length },
  { id: 'unknown' as const, label: '未知', tone: 'unknown' as const, count: store.tasks.filter((task) => unknownStatuses.has(task.status)).length },
  { id: 'failed' as const, label: '失败', tone: 'danger' as const, count: store.tasks.filter((task) => failedStatuses.has(task.status)).length },
])
const selectedItem = computed(() => listItems.value.find((item) => item.key === selectedKey.value))
const selectedTask = computed(() => selectedItem.value?.kind === 'task' ? selectedItem.value.task : undefined)
const selectedBatch = computed(() => selectedItem.value?.kind === 'batch' ? selectedItem.value.batch : undefined)
const selectedDiagnostic = computed(() => selectedTask.value ? store.taskDiagnostics[selectedTask.value.id] : undefined)
const selectedTaskHeading = computed(() => selectedTask.value ? `${statusLabel(selectedTask.value.status)} · ${taskTitle(selectedTask.value)}` : '')
const selectedTaskReason = computed(() => selectedTask.value?.needsAttentionReason ?? selectedTask.value?.error?.userMessage ?? taskSummary(selectedTask.value))
const selectedAttempts = computed(() => selectedTask.value ? (store.snapshot?.attempts ?? []).filter((attempt) => attempt.taskId === selectedTask.value?.id).sort((left, right) => left.createdAt.localeCompare(right.createdAt)) : [])
const selectedReceipt = computed(() => selectedTask.value ? store.snapshot?.providerReceipts.find((receipt) => receipt.taskId === selectedTask.value?.id) : undefined)
const timelineEvents = computed<TimelineEvent[]>(() => {
  if (selectedBatch.value) return store.tasks.filter((task) => task.inputSnapshot.batchId === selectedBatch.value?.id).map((task) => ({ key: task.id, at: task.updatedAt, label: `${task.stage} · ${statusLabel(task.status)}`, tone: taskTone(task) })).sort((left, right) => left.at.localeCompare(right.at))
  if (!selectedTask.value) return []
  const events: TimelineEvent[] = selectedAttempts.value.flatMap((attempt) => [
    { key: `${attempt.id}:created`, at: attempt.createdAt, label: `Attempt ${attempt.attempt} · 已创建 · ${attempt.provider}/${attempt.model}`, tone: 'neutral' as const },
    ...(attempt.updatedAt !== attempt.createdAt ? [{ key: `${attempt.id}:updated`, at: attempt.updatedAt, label: `Attempt ${attempt.attempt} · ${attemptStatusLabel(attempt.status)}`, tone: attempt.status === 'failed' ? 'danger' as const : attempt.status === 'outcome_unknown' ? 'unknown' as const : attempt.status === 'succeeded' ? 'success' as const : 'running' as const }] : []),
  ])
  if (selectedReceipt.value) events.push({ key: selectedReceipt.value.id, at: selectedReceipt.value.acceptedAt, label: `Provider 已接受 · receipt ${maskReference(selectedReceipt.value.id)}`, tone: 'success' })
  if (events.length === 0) events.push({ key: `${selectedTask.value.id}:task`, at: selectedTask.value.createdAt, label: `Attempt ${selectedTask.value.attempt} · ${statusLabel(selectedTask.value.status)}`, tone: taskTone(selectedTask.value) })
  return events.sort((left, right) => left.at.localeCompare(right.at))
})

watch(listItems, (items) => { if (!items.some((item) => item.key === selectedKey.value)) selectedKey.value = items[0]?.key ?? '' }, { immediate: true })
watch(selectedTask, (task) => { if (task) void store.inspectTask(task.id) }, { immediate: true })

function selectItem(item: ListItem): void { selectedKey.value = item.key; retryConfirmId.value = ''; if (item.kind === 'task') void store.inspectTask(item.task.id) }
function taskPriority(task: GenerationTask): number { return unknownStatuses.has(task.status) ? 0 : failedStatuses.has(task.status) ? 1 : activeStatuses.has(task.status) ? 3 : 4 }
function taskTone(task: GenerationTask): ItemTone { return unknownStatuses.has(task.status) ? 'unknown' : failedStatuses.has(task.status) ? 'danger' : activeStatuses.has(task.status) ? 'running' : task.status === 'succeeded' ? 'success' : 'neutral' }
function taskTitle(task: GenerationTask): string { return `${taskTypeLabel(task.type)}.${shortReference(task.id)}` }
function batchTitle(batch: CandidateBatch): string { return `${batch.kind}.batch.${shortReference(batch.id)}` }
function taskDetail(task: GenerationTask): string { if (isUnknown(task.status)) return '必须先对账，禁止直接重试'; if (task.status === 'succeeded') return task.type === 'export' ? 'MP4 与哈希已记录' : `${task.stage} · 证据已保存`; if (canCancel(task.status)) return '页面可安全离开 · 支持取消'; return task.needsAttentionReason ?? task.error?.userMessage ?? `${task.provider} / ${task.model}` }
function taskSummary(task?: GenerationTask): string { if (!task) return ''; if (task.status === 'succeeded') return '任务结果、Attempt 和可恢复证据均已保存。'; if (activeStatuses.has(task.status)) return '任务仍在执行，页面可以安全离开。'; return '查看保护规则后选择对账、重试或导出诊断。' }
function taskTypeLabel(type: GenerationTask['type']): string { return ({ event_extract: 'event.extract', adaptation: 'adaptation', asset: 'asset', image: 'image', video: 'video.batch', voice: 'voice', subtitle: 'subtitle.align', boundary_extract: 'boundary.extract', export: 'export.local' })[type] }
function statusLabel(status: GenerationTask['status']): string { return ({ queued: '排队中', running: '运行中', waiting_approval: '等待批准', retrying: '正在重试', succeeded: '已成功', failed: '失败', cancel_requested: '取消确认中', cancelled: '已取消', timed_out: '已超时', orphaned: '重启后失联', reconciling: '正在对账', outcome_unknown: '未知结果', needs_attention: '需要处理' })[status] }
function attemptStatusLabel(status: string): string { return ({ created: '已创建', submitting: '正在提交', accepted: '已接受', polling: '正在轮询', reconciling: '正在对账', succeeded: '已成功', failed: '失败', cancelled: '已取消', outcome_unknown: '结果未知' } as Record<string, string>)[status] ?? status }
function canReconcile(status: GenerationTask['status']): boolean { return ['outcome_unknown', 'orphaned', 'reconciling', 'needs_attention'].includes(status) }
function canCancel(status: GenerationTask['status']): boolean { return ['queued', 'running', 'waiting_approval'].includes(status) }
function canRetry(task: GenerationTask): boolean { return task.retryable && ['failed', 'timed_out', 'cancelled', 'needs_attention'].includes(task.status) }
function isUnknown(status: GenerationTask['status']): boolean { return unknownStatuses.has(status) || status === 'reconciling' }
function protectionRule(task: GenerationTask): string { if (isUnknown(task.status)) return '未知结果只能先查询远端状态并对账，避免重复扣费与重复资产。'; if (canRetry(task)) return '重试会创建新的 Attempt；原失败记录、错误码和诊断证据保持不变。'; if (canCancel(task.status)) return '取消请求与 Provider 确认分开记录；在远端确认前不把任务标记为已取消。'; return '终态任务只读保存；结果、哈希与恢复证据不会被后续操作覆盖。' }
function billingLabel(task: GenerationTask): string {
  if (isUnknown(task.status) && task.provider !== 'demo-local') return '未确认 · 不可重复提交'
  if (task.provider === 'demo-local' || task.result?.billed === false || isDemo.value) return '已确认 · 付费请求 0'
  return '受项目预算门禁保护'
}
function publicStatusCode(status: GenerationTask['status']): string { return ({ outcome_unknown: 'TASK_RESULT_UNKNOWN', orphaned: 'TASK_RESTART_RECONCILE_REQUIRED', reconciling: 'TASK_RECONCILING', failed: 'TASK_FAILED', timed_out: 'TASK_TIMED_OUT', needs_attention: 'TASK_NEEDS_ATTENTION', cancelled: 'TASK_CANCELLED', succeeded: 'TASK_SUCCEEDED', queued: 'TASK_QUEUED', running: 'TASK_RUNNING', waiting_approval: 'TASK_WAITING_APPROVAL', retrying: 'TASK_RETRYING', cancel_requested: 'TASK_CANCEL_REQUESTED' })[status] }
function shortReference(value: string): string { return value.replaceAll('-', '').slice(-6) }
function maskReference(value: string): string { return `••••${value.replaceAll('-', '').slice(-4)}` }
function maskIdempotencyKey(value: string): string { const head = value.split('-').slice(0, 2).join('_').slice(0, 12) || 'idem'; return `${head}_••••_${value.slice(-4)}` }
function formatClock(value: string): string { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) }
async function retryTask(taskId: string): Promise<void> { if (retryConfirmId.value !== taskId) { retryConfirmId.value = taskId; return }; retryConfirmId.value = ''; await store.retryTask(taskId) }
async function retryBatch(batchId: string): Promise<void> { if (retryConfirmId.value !== batchId) { retryConfirmId.value = batchId; return }; retryConfirmId.value = ''; await store.retryFailedCandidateBatch(batchId) }
async function downloadDiagnostics(): Promise<void> { const exported = await store.exportDiagnosticBundle(); if (!exported) return; const url = URL.createObjectURL(exported.blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = exported.fileName; anchor.click(); URL.revokeObjectURL(url) }
</script>
