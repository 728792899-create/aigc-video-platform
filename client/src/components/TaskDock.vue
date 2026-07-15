<template>
  <transition name="dock-fade">
    <div v-if="tasks.length" class="task-dock" :class="{ collapsed }">
      <!-- 头部：标题 + 折叠按钮 -->
      <div class="dock-header" @click="collapsed = !collapsed">
        <div class="dock-title">
          <el-icon class="spin" v-if="store.activeCount > 0"><Loading /></el-icon>
          <el-icon v-else><CircleCheck /></el-icon>
          <span>{{ $t('task.title') }}</span>
          <span v-if="store.activeCount > 0" class="badge">{{ store.activeCount }}</span>
        </div>
        <el-icon class="collapse-icon">
          <ArrowDown v-if="collapsed" />
          <ArrowUp v-else />
        </el-icon>
      </div>

      <!-- 任务列表 -->
      <div v-show="!collapsed" class="dock-body">
        <div v-for="t in tasks" :key="t.id" class="task-item" :class="t.status">
          <div class="task-row">
            <span class="task-type">{{ label(t.type) }}</span>
            <span class="task-meta">{{ metaText(t) }}</span>
            <el-icon
              v-if="isFinished(t)"
              class="task-close"
              @click="store.dismiss(t.id)"
            ><Close /></el-icon>
          </div>
          <el-progress
            :percentage="t.progress || 0"
            :status="progressStatus(t)"
            :stroke-width="6"
            :show-text="false"
          />
          <div class="task-msg">
            <span class="msg-text">{{ t.message || statusText(t) }}</span>
            <span class="msg-pct" v-if="!isFinished(t)">{{ t.progress || 0 }}%</span>
          </div>
          <WorkflowRail v-if="workflowOf(t)" :workflow="workflowOf(t) || undefined" compact class="task-workflow" />
          <div v-if="t.type === 'auto-produce'" class="provider-line">
            <span>{{ providerSummary(t) }}</span>
            <span>{{ isDemoTask(t) ? 'Demo · ¥0' : '成本由 Provider 结算' }}</span>
          </div>
          <div v-if="canRetry(t)" class="task-actions">
            <el-button v-if="hasDiagnosis(t)" size="small" plain @click="showDiagnosis(t)">
              {{ $t('task.viewReason') }}
            </el-button>
            <el-button size="small" type="primary" plain :loading="retrying[t.id]" @click="retry(t)">
              {{ $t('common.regenerate') }}
            </el-button>
            <el-button v-if="workflowOf(t)" size="small" type="warning" plain :loading="retrying[t.id]" @click="retryStage(t)">
              重试当前阶段
            </el-button>
          </div>
          <div v-else-if="hasDiagnosis(t)" class="task-actions">
            <el-button size="small" plain @click="showDiagnosis(t)">
              {{ $t('task.viewReason') }}
            </el-button>
          </div>
          <div v-if="canCancel(t)" class="task-actions">
            <el-button size="small" type="danger" plain :loading="canceling[t.id]" @click="cancelTask(t)">
              {{ $t('task.cancel') }}
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import type { ApiEnvelope, GenerationTask, TaskStatus } from '@aigc-video/contracts'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Loading, CircleCheck, ArrowUp, ArrowDown, Close,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTaskStore } from '../stores/tasks'
import api from '../api'
import WorkflowRail from './WorkflowRail.vue'

type JsonObject = Record<string, unknown>
type ProgressStatus = '' | 'success' | 'exception' | 'warning'

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function workflowOf(task: GenerationTask): JsonObject | null {
  const workflow = record(task.meta).workflow
  return workflow && typeof workflow === 'object' && !Array.isArray(workflow) ? workflow as JsonObject : null
}

function isDemoTask(task: GenerationTask): boolean {
  return record(task.meta).demo_mode === true
}

const { t } = useI18n()
const store = useTaskStore()
const collapsed = ref(false)
const retrying = ref<Record<string, boolean>>({})
const canceling = ref<Record<string, boolean>>({})

const tasks = computed(() => store.visibleTasks)

// 任务类型 → i18n 标签
const TYPE_KEY: Record<string, string> = {
  image: 'task.typeImage',
  video: 'task.typeVideo',
  'auto-produce': 'task.typeAutoProduce',
  tts: 'task.typeTts',
}
function label(type: string): string {
  return t(TYPE_KEY[type] || 'task.typeDefault')
}

// 仅一键成片失败 / 中断、且后端 meta 里存了可重跑参数时，才允许一键重试
function canRetry(task: GenerationTask): boolean {
  return task.type === 'auto-produce'
    && (task.status === 'failed' || task.status === 'interrupted' || task.status === 'orphaned' || task.status === 'partial')
    && Boolean(record(task.meta).params)
}

function canCancel(task: GenerationTask): boolean {
  return task.type === 'auto-produce' && ['waiting', 'pending', 'running', 'composing'].includes(task.status)
}

function providerSummary(task: GenerationTask): string {
  const providers = record(record(task.meta).providers)
  return [providers.script, providers.image, providers.video, providers.voice]
    .filter((value): value is string => typeof value === 'string' && Boolean(value))
    .join(' · ') || '本地工作流'
}

function diagnosisOf(task: GenerationTask): JsonObject | null {
  const taskRecord = record(task)
  const candidate = taskRecord.diagnosis || record(task.meta).diagnosis || record(task.result).diagnosis
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as JsonObject : null
}

function hasDiagnosis(task: GenerationTask): boolean {
  return Boolean(diagnosisOf(task))
}

function showDiagnosis(task: GenerationTask): void {
  const diagnosis = diagnosisOf(task)
  if (!diagnosis) return
  const partial = record(diagnosis.partialResult)
  const partialText = Object.keys(partial).length
    ? `<p><strong>${t('task.partialResult')}</strong>${t('task.partialStats', {
        sb: partial.storyboard_count || 0,
        img: partial.image_count || 0,
        sel: partial.selected_image_count || 0,
        aud: partial.audio_count || 0,
      })}</p>`
    : ''
  const adviceList = Array.isArray(diagnosis.advice) ? diagnosis.advice : []
  const advice = adviceList.length
    ? `<ol>${adviceList.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`
    : `<p>${escapeHtml(diagnosis.reason || t('task.unknownError'))}</p>`
  const assetIssuesValue = record(diagnosis.assetHealth).issues
  const assetIssues = Array.isArray(assetIssuesValue) && assetIssuesValue.length
    ? `<p><strong>${t('task.assetIssues')}</strong></p><ul>${assetIssuesValue.map((item) => `<li>${escapeHtml(record(item).message)}</li>`).join('')}</ul>`
    : ''
  const raw = diagnosis.rawError ? `<details><summary>${t('task.rawError')}</summary><pre>${escapeHtml(diagnosis.rawError)}</pre></details>` : ''
  ElMessageBox.alert(
    `<p><strong>${escapeHtml(diagnosis.reason || '')}</strong></p>${partialText}${assetIssues}<p>${t('task.advice')}</p>${advice}${raw}`,
    String(diagnosis.title || t('task.failureDiagnosis')),
    { dangerouslyUseHTMLString: true, confirmButtonText: t('common.close') }
  )
}

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function retry(task: GenerationTask): Promise<void> {
  if (task.status === 'orphaned') {
    try {
      await ElMessageBox.confirm(
        t('task.orphanedConfirm'),
        t('task.orphaned'),
        { type: 'warning', confirmButtonText: t('task.confirmRetry'), cancelButtonText: t('common.cancel') }
      )
    } catch { return }
  }
  retrying.value = { ...retrying.value, [task.id]: true }
  try {
    const res = await api.post<ApiEnvelope<JsonObject>>(`/ai/auto-produce/${task.id}/retry`, {
      confirm_uncertain_outcome: task.status === 'orphaned',
    })
    if (res.data.code === 200) {
      ElMessage.success(t('task.restarted'))
      store.dismiss(task.id)
      store.fetchOnce()
    } else {
      ElMessage.error(res.data.message || t('task.retryFailed'))
    }
  } catch (cause) {
    ElMessage.error(t('task.retryReqFailed') + (cause instanceof Error ? cause.message : t('task.unknownError')))
  } finally {
    retrying.value = { ...retrying.value, [task.id]: false }
  }
}

async function retryStage(task: GenerationTask): Promise<void> {
  const stageValue = workflowOf(task)?.current_stage
  const stage = typeof stageValue === 'string' ? stageValue : ''
  if (!stage) return retry(task)
  if (task.status === 'orphaned') {
    try {
      await ElMessageBox.confirm(
        t('task.orphanedStageConfirm', { stage }),
        t('task.orphaned'),
        { type: 'warning', confirmButtonText: t('task.confirmRetry'), cancelButtonText: t('common.cancel') }
      )
    } catch { return }
  }
  retrying.value = { ...retrying.value, [task.id]: true }
  try {
    const res = await api.post<ApiEnvelope<JsonObject>>(`/tasks/${task.id}/retry-stage`, {
      stage,
      confirm_uncertain_outcome: task.status === 'orphaned',
    })
    if (res.data.code === 200) {
      ElMessage.success(`已重试阶段：${stage}`)
      store.dismiss(task.id)
      store.fetchOnce()
    } else ElMessage.error(res.data.message || '阶段重试失败')
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '阶段重试失败')
  } finally {
    retrying.value = { ...retrying.value, [task.id]: false }
  }
}

async function cancelTask(task: GenerationTask): Promise<void> {
  canceling.value = { ...canceling.value, [task.id]: true }
  try {
    const res = await api.post<ApiEnvelope<GenerationTask>>(`/tasks/${task.id}/cancel`)
    if (res.data.code === 200) {
      ElMessage.success(res.data.message || t('task.canceled'))
      store.fetchOnce()
    } else {
      ElMessage.error(res.data.message || t('task.cancelFailed'))
    }
  } catch (cause) {
    ElMessage.error(t('task.cancelFailed') + (cause instanceof Error ? cause.message : ''))
  } finally {
    canceling.value = { ...canceling.value, [task.id]: false }
  }
}

function isFinished(task: GenerationTask): boolean {
  return ['success', 'failed', 'timed_out', 'interrupted', 'orphaned', 'partial', 'canceled'].includes(task.status)
}

function progressStatus(task: GenerationTask): ProgressStatus {
  if (task.status === 'success') return 'success'
  if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'interrupted' || task.status === 'orphaned') return 'exception'
  if (task.status === 'partial') return 'warning'
  return ''
}

function statusText(task: GenerationTask): string {
  const map: Partial<Record<TaskStatus, string>> = {
    pending: t('task.queuing'),
    waiting: t('task.waiting'),
    running: t('task.processing'),
    composing: t('task.composing'),
    success: t('task.finished'),
    partial: t('task.partial'),
    failed: t('task.failed'),
    interrupted: t('task.interrupted'),
    orphaned: t('task.orphaned'),
    canceled: t('task.canceled'),
  }
  return map[task.status] || ''
}

// 任务卡片右上角的简短上下文（项目/分镜）
function metaText(task: GenerationTask): string {
  const metadata = record(task.meta)
  if (task.type === 'auto-produce' && typeof metadata.theme === 'string') return metadata.theme.slice(0, 12)
  if (task.type === 'video' && metadata.total_segments) return t('task.segments', { n: Number(metadata.total_segments) })
  if (task.type === 'image' && metadata.storyboard_id) return t('task.storyboard', { id: Number(metadata.storyboard_id) })
  return ''
}

onMounted(() => store.startPolling())
onUnmounted(() => store.stopPolling())
</script>

<style scoped>
.task-dock {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 300px;
  background: #16213e;
  border: 1px solid var(--border, #2a3a5c);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  z-index: 3000;
  overflow: hidden;
  color: #e2e8f0;
}
.dock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(90deg, #1e3a5f, #16213e);
  border-bottom: 1px solid var(--border, #2a3a5c);
}
.dock-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}
.badge {
  background: #0ea5e9;
  color: #fff;
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  line-height: 18px;
}
.collapse-icon {
  color: #94a3b8;
}
.dock-body {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px 12px;
}
.task-item {
  padding: 8px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.07);
}
.task-item:last-child {
  border-bottom: none;
}
.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.task-type {
  font-size: 12px;
  font-weight: 600;
  color: #38bdf8;
}
.task-meta {
  font-size: 11px;
  color: #94a3b8;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-close {
  cursor: pointer;
  color: #64748b;
  font-size: 13px;
}
.task-close:hover {
  color: #f87171;
}
.task-msg {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  color: #94a3b8;
}
.msg-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}
.msg-pct {
  color: #cbd5e1;
}
.task-actions {
  margin-top: 6px;
  text-align: right;
}
.task-workflow { margin-top: 7px; }
.provider-line { display:flex; justify-content:space-between; gap:8px; margin-top:6px; color:#64748b; font-size:10px; }
.spin {
  animation: dock-spin 1s linear infinite;
}
@keyframes dock-spin {
  to { transform: rotate(360deg); }
}
.dock-fade-enter-active,
.dock-fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.dock-fade-enter-from,
.dock-fade-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
