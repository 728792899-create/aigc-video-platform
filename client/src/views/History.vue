<template>
  <div class="history-view">
    <div class="page-head">
      <h2 class="text-gradient">{{ $t('history.title') }}</h2>
      <div class="head-actions">
        <el-select v-model="filterType" :placeholder="$t('history.filterTypeAll')" clearable size="small" style="width: 140px" @change="reload">
          <el-option :label="$t('history.typeAutoProduce')" value="auto-produce" />
          <el-option :label="$t('history.typeImage')" value="image" />
          <el-option :label="$t('history.typeVideo')" value="video" />
          <el-option :label="$t('history.typeTts')" value="tts" />
        </el-select>
        <el-select v-model="filterStatus" :placeholder="$t('history.filterStatusAll')" clearable size="small" style="width: 120px" @change="reload">
          <el-option :label="$t('common.success')" value="success" />
          <el-option :label="$t('common.failed')" value="failed" />
          <el-option :label="$t('history.statusInterrupted')" value="interrupted" />
          <el-option :label="$t('task.orphaned')" value="orphaned" />
        </el-select>
        <el-button size="small" @click="reload">{{ $t('common.refresh') }}</el-button>
        <el-button size="small" type="danger" plain :disabled="!total" @click="clearAll">{{ $t('history.clearHistory') }}</el-button>
      </div>
    </div>

    <el-table :data="list" v-loading="loading" stripe style="width: 100%">
      <el-table-column :label="$t('history.colType')" width="110">
        <template #default="{ row }"><el-tag size="small" effect="plain">{{ typeLabel(row.type) }}</el-tag></template>
      </el-table-column>
      <el-table-column :label="$t('history.colTitle')" min-width="200">
        <template #default="{ row }">
          <span>{{ row.theme || '—' }}</span>
          <el-tag v-if="row.project_id && !row.project_exists" size="small" type="info" effect="plain" style="margin-left:6px">{{ $t('history.projectDeleted') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('history.colStatus')" width="100">
        <template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
      </el-table-column>
      <el-table-column :label="$t('history.colTime')" width="170">
        <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="$t('history.colActions')" width="300" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.project_exists" size="small" link type="primary" @click="openProject(row)">{{ $t('history.openProject') }}</el-button>
          <el-button v-if="hasDiagnosis(row)" size="small" link @click="showDiagnosis(row)">{{ $t('history.viewDiagnosis') }}</el-button>
          <el-button v-if="row.type==='auto-produce'" size="small" link type="success" @click="retry(row)">{{ $t('common.regenerate') }}</el-button>
          <el-button size="small" link type="danger" @click="removeOne(row)">{{ $t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager" v-if="total > pageSize">
      <el-pagination layout="prev, pager, next, total" :total="total" :page-size="pageSize" :current-page="page" @current-change="onPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { z } from 'zod'
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { getHistory, retryHistory, deleteHistory, deleteHistoryBatch, type HistoryRecord } from '../api/history'

const { t } = useI18n()
const router = useRouter()
const list = ref<HistoryRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const filterType = ref('')
const filterStatus = ref('')

const TYPE_KEYS: Record<string, string> = { 'auto-produce': 'history.typeAutoProduce', image: 'history.typeImage', video: 'history.typeVideo', tts: 'history.typeTts' }
const STATUS_KEYS: Record<string, string> = { success: 'common.success', failed: 'common.failed', interrupted: 'history.statusInterrupted', orphaned: 'task.orphaned', running: 'common.running', pending: 'common.pending' }
const STATUS_TYPES: Record<string, '' | 'success' | 'warning' | 'info' | 'danger'> = { success: 'success', failed: 'danger', interrupted: 'info', orphaned: 'warning', running: 'warning', pending: '' }

const DiagnosisSchema = z.object({
  title: z.string().optional(),
  reason: z.string().optional(),
  rawError: z.string().optional(),
  advice: z.array(z.string()).optional(),
  partialResult: z.object({
    storyboard_count: z.number().optional(),
    image_count: z.number().optional(),
    selected_image_count: z.number().optional(),
    audio_count: z.number().optional(),
  }).optional(),
  assetHealth: z.object({ issues: z.array(z.object({ message: z.string() })).optional() }).optional(),
}).passthrough()
type Diagnosis = z.infer<typeof DiagnosisSchema>

function typeLabel(type: string): string { return TYPE_KEYS[type] ? t(TYPE_KEYS[type]) : type }
function statusLabel(status: string): string { return STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status }
function statusType(status: string): '' | 'success' | 'warning' | 'info' | 'danger' { return STATUS_TYPES[status] || '' }
function fmtTime(timestamp: string | number | null | undefined): string {
  if (!timestamp) return '—'
  const d = new Date(Number(timestamp))
  const p = (number: number) => String(number).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function diagnosisOf(row: HistoryRecord): Diagnosis | null {
  for (const value of [row.diagnosis, row.meta?.diagnosis, row.result?.diagnosis]) {
    const parsed = DiagnosisSchema.safeParse(value)
    if (parsed.success) return parsed.data
  }
  return null
}

function hasDiagnosis(row: HistoryRecord): boolean {
  return diagnosisOf(row) !== null
}

function showDiagnosis(row: HistoryRecord) {
  const d = diagnosisOf(row)
  if (!d) return
  const partial = d.partialResult
  const partialText = partial
    ? `<p><strong>${t('task.partialResult')}</strong>${t('task.partialStats', {
        sb: partial.storyboard_count || 0,
        img: partial.image_count || 0,
        sel: partial.selected_image_count || 0,
        aud: partial.audio_count || 0,
      })}</p>`
    : ''
  const assetIssues = Array.isArray(d.assetHealth?.issues) && d.assetHealth.issues.length
    ? `<p><strong>${t('history.assetIssues')}</strong></p><ul>${d.assetHealth.issues.map((x) => `<li>${escapeHtml(x.message)}</li>`).join('')}</ul>`
    : ''
  const advice = Array.isArray(d.advice) && d.advice.length
    ? `<ol>${d.advice.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`
    : `<p>${escapeHtml(d.reason || t('task.unknownError'))}</p>`
  const raw = d.rawError ? `<details><summary>${t('task.rawError')}</summary><pre>${escapeHtml(d.rawError)}</pre></details>` : ''
  ElMessageBox.alert(
    `<p><strong>${escapeHtml(d.reason || '')}</strong></p>${partialText}${assetIssues}<p>${t('task.advice')}</p>${advice}${raw}`,
    d.title || t('task.failureDiagnosis'),
    { dangerouslyUseHTMLString: true, confirmButtonText: t('common.close') }
  )
}

function escapeHtml(s: unknown): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function reload() {
  loading.value = true
  try {
    const data = await getHistory({ type: filterType.value || undefined, status: filterStatus.value || undefined, page: page.value, pageSize: pageSize.value })
    list.value = data.list || []
    total.value = data.total || 0
  } catch (cause) {
    ElMessage.error(t('history.loadFailed') + (cause instanceof Error ? cause.message : String(cause)))
  } finally {
    loading.value = false
  }
}

function onPage(nextPage: number) { page.value = nextPage; void reload() }

function openProject(row: HistoryRecord) {
  router.push(`/projects/${row.project_id}/preview`)
}

async function retry(row: HistoryRecord) {
  try {
    const message = row.status === 'orphaned'
      ? t('task.orphanedConfirm')
      : t('history.retryConfirm', { theme: row.theme })
    await ElMessageBox.confirm(message, t('common.regenerate'), { type: 'warning' })
    const data = await retryHistory(row.id, {
      confirm_uncertain_outcome: row.status === 'orphaned',
    })
    ElMessage.success(t('history.retryStarted'))
    const projectId = data.project_id
    if (typeof projectId === 'string' || typeof projectId === 'number') router.push(`/projects/${projectId}/preview`)
  } catch (cause) {
    if (cause !== 'cancel') ElMessage.error(t('history.retryFailed') + (cause instanceof Error ? cause.message : String(cause)))
  }
}

async function removeOne(row: HistoryRecord) {
  try {
    await ElMessageBox.confirm(t('history.removeConfirm'), t('history.deleteConfirmTitle'), { type: 'warning' })
    await deleteHistory(row.id)
    ElMessage.success(t('history.deleted'))
    reload()
  } catch (cause) {
    if (cause !== 'cancel') ElMessage.error(t('history.removeFailed') + (cause instanceof Error ? cause.message : String(cause)))
  }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm(t('history.clearConfirm'), t('history.clearConfirmTitle'), { type: 'warning' })
    await deleteHistoryBatch({ all: true })
    ElMessage.success(t('history.cleared'))
    page.value = 1
    reload()
  } catch (cause) {
    if (cause !== 'cancel') ElMessage.error(t('history.clearFailed') + (cause instanceof Error ? cause.message : String(cause)))
  }
}

onMounted(reload)
</script>

<style scoped>
.history-view { max-width: 1100px; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 12px; }
.page-head h2 { margin: 0; }
.head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pager { margin-top: 16px; display: flex; justify-content: flex-end; }
</style>
