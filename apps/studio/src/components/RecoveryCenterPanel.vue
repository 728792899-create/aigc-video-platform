<template>
  <section class="recovery-center" aria-labelledby="recovery-center-title">
    <header>
      <div>
        <span class="eyebrow">ADVISOR / RECOVERY</span>
        <h3 id="recovery-center-title">恢复与完整性中心</h3>
        <p>只执行可验证的对账与引用修复；不会自动重新提交可能计费的 Provider 任务。</p>
      </div>
      <button type="button" :disabled="busy || !store.currentProjectId" @click="refresh">重新扫描</button>
    </header>

    <div v-if="!store.currentProjectId" class="task-empty">选择项目后可运行恢复扫描。</div>
    <div v-else-if="busy && !report" class="task-empty" role="status">正在扫描任务与媒体引用。</div>
    <p v-else-if="error" class="runtime-card__error" role="alert">{{ error }}</p>
    <template v-else-if="report">
      <dl class="recovery-center__summary">
        <div><dt>错误</dt><dd>{{ report.summary.errors }}</dd></div>
        <div><dt>警告</dt><dd>{{ report.summary.warnings }}</dd></div>
        <div><dt>可恢复任务</dt><dd>{{ report.summary.recoverableTasks }}</dd></div>
      </dl>

      <div class="recovery-center__actions">
        <button type="button" :disabled="busy || reconcileTasks.length === 0" @click="reconcileAll">
          对账全部未知任务（{{ reconcileTasks.length }}）
        </button>
        <button type="button" :disabled="busy" @click="downloadDiagnostics">下载脱敏诊断包</button>
      </div>

      <div class="recovery-center__columns">
        <section aria-labelledby="recovery-integrity-title">
          <h4 id="recovery-integrity-title">引用完整性</h4>
          <p v-if="report.issues.length === 0" class="task-empty">没有发现断裂的候选、媒体或边界帧引用。</p>
          <ul v-else class="recovery-center__list">
            <li v-for="issue in report.issues" :key="`${issue.code}:${issue.entityId}:${issue.relatedEntityId ?? ''}`">
              <span :class="`status-pill status-pill--${issue.severity}`">{{ issue.severity === 'error' ? '错误' : '警告' }}</span>
              <div><strong>{{ issueLabel(issue.code) }}</strong><p>{{ issue.message }}</p></div>
              <button v-if="issue.action === 'clear_boundary'" type="button" @click="clearBoundary(issue)">
                {{ pendingClear === issueKey(issue) ? '再次确认解除' : '解除失效绑定' }}
              </button>
              <button v-else type="button" @click="openIssue(issue)">定位</button>
            </li>
          </ul>
        </section>

        <section aria-labelledby="recovery-task-title">
          <h4 id="recovery-task-title">任务恢复</h4>
          <p v-if="report.tasks.length === 0" class="task-empty">没有需要人工处理的任务。</p>
          <ul v-else class="recovery-center__list">
            <li v-for="task in report.tasks" :key="task.taskId">
              <span class="status-pill">{{ taskStatusLabel(task.status) }}</span>
              <div><strong>{{ task.stage }}</strong><p>{{ task.type }} · {{ task.actions.join(' / ') }}</p></div>
              <button v-if="task.actions.includes('reconcile')" type="button" :disabled="busy" @click="reconcileTask(task.taskId)">对账</button>
              <button v-else type="button" @click="inspectTask(task.taskId)">诊断</button>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GenerationTask, ProjectRecoveryIssue, ProjectRecoveryReport } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useStudioStore()
const report = ref<ProjectRecoveryReport>()
const busy = ref(false)
const error = ref('')
const pendingClear = ref('')
const reconcileTasks = computed(() => report.value?.tasks.filter((task) => task.actions.includes('reconcile')) ?? [])

watch(() => [props.active, store.currentProjectId] as const, ([active, projectId]) => {
  report.value = undefined
  pendingClear.value = ''
  if (active && projectId) void refresh()
}, { immediate: true })

async function refresh(): Promise<void> {
  if (!store.currentProjectId) return
  busy.value = true
  error.value = ''
  try {
    report.value = await directorApi.projectRecoveryReport(store.currentProjectId)
  } catch {
    error.value = '恢复扫描未完成，请使用关联 ID 或脱敏诊断包继续排查。'
  } finally {
    busy.value = false
  }
}

async function reconcileTask(taskId: string): Promise<void> {
  busy.value = true
  await store.reconcileTask(taskId)
  busy.value = false
  await refresh()
}

async function reconcileAll(): Promise<void> {
  busy.value = true
  for (const task of reconcileTasks.value) await store.reconcileTask(task.taskId)
  busy.value = false
  await refresh()
}

async function inspectTask(taskId: string): Promise<void> {
  await store.inspectTask(taskId)
  emit('close')
}

async function openIssue(issue: ProjectRecoveryIssue): Promise<void> {
  await store.changeView('production')
  store.selectNode(`${issue.entityType}:${issue.entityId}`)
  emit('close')
}

function issueKey(issue: ProjectRecoveryIssue): string {
  return `${issue.entityId}:${issue.boundaryRole ?? ''}`
}

async function clearBoundary(issue: ProjectRecoveryIssue): Promise<void> {
  if (!issue.boundaryRole) return
  const key = issueKey(issue)
  if (pendingClear.value !== key) { pendingClear.value = key; return }
  pendingClear.value = ''
  await store.changeView('production')
  await store.clearBoundaryFrame(issue.entityId, issue.boundaryRole)
  store.selectNode(`shot:${issue.entityId}`)
  await refresh()
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

function issueLabel(code: ProjectRecoveryIssue['code']): string {
  return ({
    SHOT_SELECTED_CANDIDATE_MISSING: '已选候选不存在',
    SELECTED_CANDIDATE_MEDIA_MISSING: '已选候选媒体缺失',
    CANDIDATE_MEDIA_MISSING: '候选媒体缺失',
    CANDIDATE_TASK_MISSING: '候选任务证据缺失',
    BOUNDARY_MEDIA_MISSING: '边界帧媒体缺失',
  })[code]
}

function taskStatusLabel(status: GenerationTask['status']): string {
  return ({
    queued: '排队', running: '运行', waiting_approval: '待审批', retrying: '重试中', succeeded: '成功', failed: '失败',
    cancel_requested: '取消中', cancelled: '已取消', timed_out: '超时', orphaned: '失联', reconciling: '对账中',
    outcome_unknown: '结果未知', needs_attention: '需处理',
  })[status]
}
</script>
