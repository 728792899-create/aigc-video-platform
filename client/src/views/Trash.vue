<template>
  <div class="trash-view">
    <div class="page-head">
      <h2 class="text-gradient">{{ $t('trash.title') }}</h2>
    </div>

    <el-tabs v-model="tab">
      <!-- 回收站 -->
      <el-tab-pane :label="$t('trash.tabTrash')" name="trash">
        <div class="bar">
          <span class="hint">{{ $t('trash.trashHint') }}</span>
          <span class="grow"></span>
          <el-button size="small" @click="loadTrash">{{ $t('common.refresh') }}</el-button>
          <el-button size="small" type="danger" plain :disabled="!trashList.length" @click="doEmpty">{{ $t('trash.emptyTrash') }}</el-button>
        </div>
        <div class="category-bar">
          <el-radio-group v-model="category" size="small">
            <el-radio-button v-for="c in categoryTabs" :key="c.key" :value="c.key">
              {{ c.label }}<span v-if="c.count" class="cat-count">{{ c.count }}</span>
            </el-radio-button>
          </el-radio-group>
        </div>
        <el-table :data="filteredTrashList" v-loading="loadingTrash" stripe row-key="row_key" style="width:100%">
          <el-table-column :label="$t('trash.colType')" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="categoryTagType(row.category)" effect="plain">
                {{ categoryLabel(row.category) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="$t('trash.colName')" min-width="180">
            <template #default="{ row }">
              <span>{{ row.group_label || row.name || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('trash.colSummary')" min-width="220">
            <template #default="{ row }"><span class="detail">{{ row.summary || '—' }}</span></template>
          </el-table-column>
          <el-table-column :label="$t('trash.colFileCount')" width="90" align="center">
            <template #default="{ row }">{{ row.file_count }}</template>
          </el-table-column>
          <el-table-column :label="$t('trash.colDeletedAt')" width="170">
            <template #default="{ row }">{{ fmtTime(row.deleted_at) }}</template>
          </el-table-column>
          <el-table-column :label="$t('trash.colExpiresAt')" width="170">
            <template #default="{ row }">
              <span :class="{ 'soon': row.expires_at - now < 86400000 }">{{ fmtTime(row.expires_at) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('trash.colAction')" width="230" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link @click="openDetail(row)">{{ $t('trash.viewContent') }}</el-button>
              <el-button size="small" type="primary" link @click="doRestore(row)">{{ $t('trash.restore') }}</el-button>
              <el-button size="small" type="danger" link @click="doPurge(row)">{{ $t('trash.purge') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 操作日志 -->
      <el-tab-pane :label="$t('trash.tabLogs')" name="logs">
        <div class="bar">
          <span class="hint">{{ $t('trash.logsHint') }}</span>
          <span class="grow"></span>
          <el-button size="small" @click="loadLogs">{{ $t('common.refresh') }}</el-button>
        </div>
        <el-table :data="logList" v-loading="loadingLogs" stripe style="width:100%">
          <el-table-column :label="$t('trash.colTime')" width="170">
            <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
          </el-table-column>
          <el-table-column :label="$t('trash.colAction')" width="130">
            <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.action_label }}</el-tag></template>
          </el-table-column>
          <el-table-column :label="$t('trash.colTarget')" width="140">
            <template #default="{ row }">{{ row.target_type || '—' }}{{ row.target_id ? ' #' + row.target_id : '' }}</template>
          </el-table-column>
          <el-table-column :label="$t('trash.colDetail')" min-width="220">
            <template #default="{ row }"><span class="detail">{{ fmtDetail(row.detail) }}</span></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="detailVisible" :title="$t('trash.detailTitle')" width="720px">
      <div v-if="detail">
        <div class="detail-head">
          <el-tag :type="categoryTagType(detail.category)" effect="plain">{{ categoryLabel(detail.category) }}</el-tag>
          <strong>{{ detail.name || '—' }}</strong>
          <span class="detail-summary">{{ detail.summary }}</span>
        </div>
        <el-table
          :data="detail.details || []"
          size="small"
          border
          row-key="key"
          style="width:100%;margin-top:12px"
          @selection-change="onDetailSelectionChange"
        >
          <el-table-column
            v-if="isFileDetail"
            type="selection"
            width="44"
            :selectable="row => row.restorable !== false"
          />
          <el-table-column :label="$t('trash.colType')" width="100">
            <template #default="{ row }">{{ detailTypeLabel(row.type, row.label) }}</template>
          </el-table-column>
          <el-table-column :label="$t('trash.colName')" min-width="180">
            <template #default="{ row }">{{ row.name || '—' }}</template>
          </el-table-column>
          <el-table-column :label="$t('trash.colPath')" min-width="220">
            <template #default="{ row }"><span class="detail">{{ row.path || '—' }}</span></template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">{{ $t('common.close') }}</el-button>
        <el-button v-if="isFileDetail" type="primary" plain :disabled="!selectedRestorableCount" @click="doRestoreSelected">
          {{ $t('trash.restoreSelected') }}
        </el-button>
        <el-button v-if="detail" type="primary" @click="doRestore(detail)">{{ $t('trash.restoreThis') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listTrash, getTrashDetail, restoreTrash, restoreTrashItems, purgeTrash, purgeTrashItems, emptyTrash, listLogs } from '../api/trash'

const { t } = useI18n()

const tab = ref('trash')
const now = ref(Date.now())
const category = ref('all')
const trashList = ref([])
const logList = ref([])
const loadingTrash = ref(false)
const loadingLogs = ref(false)
const detailVisible = ref(false)
const detail = ref(null)
const detailSelection = ref([])

const CATEGORY_ORDER = ['all', 'image', 'audio', 'video', 'subtitle', 'script', 'mixed']
const categoryTabs = computed(() => {
  const counts = { all: trashList.value.length }
  for (const row of trashList.value) counts[row.category || 'file'] = (counts[row.category || 'file'] || 0) + 1
  return CATEGORY_ORDER
    .filter(key => key === 'all' || counts[key])
    .map(key => ({ key, label: categoryLabel(key), count: counts[key] || 0 }))
})
const filteredTrashList = computed(() => {
  if (category.value === 'all') return trashList.value
  return trashList.value.filter(row => row.category === category.value)
})
const isFileDetail = computed(() => detail.value && detail.value.entity_type === 'files')
const selectedRestorableCount = computed(() => detailSelection.value.filter(row => row.restorable !== false).length)

function categoryLabel(key) {
  const map = {
    all: t('trash.catAll'),
    image: t('trash.catImage'),
    audio: t('trash.catAudio'),
    video: t('trash.catVideo'),
    subtitle: t('trash.catSubtitle'),
    script: t('trash.catScript'),
    mixed: t('trash.catMixed'),
  }
  return map[key] || t('trash.catMixed')
}
function categoryTagType(key) {
  const map = { image: 'success', audio: 'warning', video: 'primary', subtitle: 'info', script: '', mixed: 'warning' }
  return map[key] || 'info'
}
function detailTypeLabel(type, fallback) {
  const map = {
    project: t('trash.typeProject'),
    storyboard: t('trash.typeStoryboard'),
    image: t('trash.catImage'),
    audio: t('trash.catAudio'),
    video: t('trash.catVideo'),
    export: t('trash.catExport'),
    subtitle: t('trash.catSubtitle'),
    script: t('trash.catScript'),
    file: t('trash.typeFile'),
  }
  return map[type] || fallback || t('trash.typeFile')
}

function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false })
}
function fmtDetail(d) {
  if (d == null) return '—'
  if (typeof d === 'string') return d
  try { return JSON.stringify(d) } catch { return String(d) }
}

async function loadTrash() {
  loadingTrash.value = true
  try { trashList.value = await listTrash(); now.value = Date.now() }
  catch (e) { ElMessage.error(t('trash.loadTrashFailed')) }
  finally { loadingTrash.value = false }
}

async function openDetail(row) {
  detailVisible.value = true
  detail.value = null
  detailSelection.value = []
  try { detail.value = await getTrashDetail(row.trash_id || row.id, row.group_key || null) }
  catch (e) { ElMessage.error(t('trash.loadDetailFailed')); detailVisible.value = false }
}
function onDetailSelectionChange(rows) {
  detailSelection.value = rows || []
}
async function loadLogs() {
  loadingLogs.value = true
  try { logList.value = await listLogs(200) }
  catch (e) { ElMessage.error(t('trash.loadLogsFailed')) }
  finally { loadingLogs.value = false }
}

async function doRestore(row) {
  try {
    if (row.entity_type === 'files' && row.group_key) {
      const groupDetail = detail.value && detail.value.group_key === row.group_key
        ? detail.value
        : await getTrashDetail(row.trash_id || row.id, row.group_key)
      const keys = (groupDetail.details || []).filter(item => item.restorable !== false).map(item => item.key)
      if (!keys.length) throw new Error(t('trash.noRestorableItems'))
      await restoreTrashItems(row.trash_id || row.id, keys)
    } else {
      await restoreTrash(row.id)
    }
    ElMessage.success(t('trash.restored'))
    detailVisible.value = false
    loadTrash()
  } catch (e) { ElMessage.error(t('trash.restoreFailed')) }
}
async function doRestoreSelected() {
  if (!detail.value || !selectedRestorableCount.value) return
  const keys = detailSelection.value.map(row => row.key).filter(Boolean)
  try {
    const res = await restoreTrashItems(detail.value.id, keys)
    ElMessage.success(res.message || t('trash.restored'))
    detailSelection.value = []
    await loadTrash()
    if (res.data && res.data.trashRemoved) {
      detailVisible.value = false
      detail.value = null
    } else {
      const nextDetail = await getTrashDetail(detail.value.trash_id || detail.value.id, detail.value.group_key || null)
      if (!nextDetail.details || !nextDetail.details.length) {
        detailVisible.value = false
        detail.value = null
      } else {
        detail.value = nextDetail
      }
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('trash.restoreFailed'))
  }
}
async function doPurge(row) {
  try {
    await ElMessageBox.confirm(t('trash.purgeConfirm', { name: row.group_label || row.name }), t('trash.confirmTitle'), { type: 'warning' })
  } catch { return }
  try {
    if (row.entity_type === 'files' && row.group_key) {
      const groupDetail = detail.value && detail.value.group_key === row.group_key
        ? detail.value
        : await getTrashDetail(row.trash_id || row.id, row.group_key)
      const keys = (groupDetail.details || []).filter(item => item.restorable !== false).map(item => item.key)
      if (!keys.length) throw new Error(t('trash.noPurgeItems'))
      await purgeTrashItems(row.trash_id || row.id, keys)
    } else {
      await purgeTrash(row.id)
    }
    ElMessage.success(t('trash.purged'))
    detailVisible.value = false
    loadTrash()
  }
  catch (e) { ElMessage.error(t('trash.purgeFailed')) }
}
async function doEmpty() {
  try {
    await ElMessageBox.confirm(t('trash.emptyConfirm'), t('trash.confirmTitle'), { type: 'warning' })
  } catch { return }
  try { const r = await emptyTrash(); ElMessage.success(r.message || t('trash.emptied')); loadTrash() }
  catch (e) { ElMessage.error(t('trash.emptyFailed')) }
}

onMounted(() => { loadTrash(); loadLogs() })
</script>

<style scoped>
.trash-view { padding: 4px 2px; }
.page-head { display: flex; align-items: center; margin-bottom: 8px; }
.page-head h2 { margin: 0; font-size: 18px; }
.bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.bar .grow { flex: 1; }
.bar .hint { color: var(--text-second); font-size: 13px; }
.category-bar { margin: 0 0 12px; }
.cat-count { margin-left: 4px; opacity: .65; }
.detail-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.detail-summary { color: var(--text-second); font-size: 13px; }
.soon { color: var(--warning); font-weight: 600; }
.detail { color: var(--text-second); font-size: 12px; word-break: break-all; }
</style>
