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

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { getHistory, retryHistory, deleteHistory, deleteHistoryBatch } from '../api/history'

const { t } = useI18n()
const router = useRouter()
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const filterType = ref('')
const filterStatus = ref('')

const TYPE_KEYS = { 'auto-produce': 'history.typeAutoProduce', image: 'history.typeImage', video: 'history.typeVideo', tts: 'history.typeTts' }
const STATUS_KEYS = { success: 'common.success', failed: 'common.failed', interrupted: 'history.statusInterrupted', running: 'common.running', pending: 'common.pending' }
const STATUS_TYPES = { success: 'success', failed: 'danger', interrupted: 'info', running: 'warning', pending: '' }

function typeLabel(tp) { return TYPE_KEYS[tp] ? t(TYPE_KEYS[tp]) : tp }
function statusLabel(s) { return STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : s }
function statusType(s) { return STATUS_TYPES[s] || '' }
function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(Number(ts))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function hasDiagnosis(row) {
  return !!(row?.diagnosis || row?.meta?.diagnosis || row?.result?.diagnosis)
}

function diagnosisOf(row) {
  return row?.diagnosis || row?.meta?.diagnosis || row?.result?.diagnosis || null
}

function showDiagnosis(row) {
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

function escapeHtml(s) {
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
  } catch (e) {
    ElMessage.error(t('history.loadFailed') + e.message)
  } finally {
    loading.value = false
  }
}

function onPage(p) { page.value = p; reload() }

function openProject(row) {
  router.push(`/projects/${row.project_id}/preview`)
}

async function retry(row) {
  try {
    await ElMessageBox.confirm(t('history.retryConfirm', { theme: row.theme }), t('common.regenerate'), { type: 'warning' })
    const data = await retryHistory(row.id)
    ElMessage.success(t('history.retryStarted'))
    router.push(`/projects/${data.project_id}/preview`)
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(t('history.retryFailed') + (e.message || e))
  }
}

async function removeOne(row) {
  try {
    await ElMessageBox.confirm(t('history.removeConfirm'), t('history.deleteConfirmTitle'), { type: 'warning' })
    await deleteHistory(row.id)
    ElMessage.success(t('history.deleted'))
    reload()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(t('history.removeFailed') + (e.message || e))
  }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm(t('history.clearConfirm'), t('history.clearConfirmTitle'), { type: 'warning' })
    await deleteHistoryBatch({ all: true })
    ElMessage.success(t('history.cleared'))
    page.value = 1
    reload()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(t('history.clearFailed') + (e.message || e))
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
