<template>
  <div class="files-view">
    <h2 class="text-gradient">{{ $t('files.title') }}</h2>

    <!-- F6 存储空间统计 -->
    <el-card class="stat-card" shadow="never">
      <div class="stat-head">
        <span>{{ $t('files.storageUsage') }}</span>
        <div>
          <span class="stat-total">{{ $t('files.storageTotal', { size: fmtSize(storage.totalSize), count: storage.totalFiles }) }}</span>
          <el-button size="small" text @click="loadStorage">{{ $t('common.refresh') }}</el-button>
          <el-button size="small" type="warning" plain @click="doCleanTemp">{{ $t('files.cleanTemp') }}</el-button>
        </div>
      </div>
      <div class="stat-path">{{ $t('files.storageDir', { root: storage.root }) }}</div>
      <div class="bar-chart">
        <div v-for="seg in storageSegs" :key="seg.key" class="bar-seg"
             :style="{ width: seg.pct + '%', background: seg.color }"
             :title="`${seg.label} ${fmtSize(seg.size)} (${seg.count})`"></div>
      </div>
      <div class="legend">
        <span v-for="seg in storageSegs" :key="seg.key" class="legend-item">
          <i class="dot" :style="{ background: seg.color }"></i>
          {{ $t('files.legendItem', { label: seg.label, size: fmtSize(seg.size), count: seg.count }) }}
        </span>
      </div>
    </el-card>

    <!-- F4 文件浏览 -->
    <el-tabs v-model="activeType" @tab-change="onTabChange">
      <el-tab-pane :label="$t('files.tabImage')" name="image" />
      <el-tab-pane :label="$t('files.tabAudio')" name="audio" />
      <el-tab-pane :label="$t('files.tabVideo')" name="video" />
      <el-tab-pane :label="$t('files.tabSubtitle')" name="subtitle" />
      <el-tab-pane :label="$t('files.tabScript')" name="script" />
    </el-tabs>

    <div v-if="activeType !== 'script'" class="toolbar">
      <el-checkbox v-model="selectAll" @change="toggleAll">{{ $t('common.selectAll') }}</el-checkbox>
      <span class="sel-count">{{ $t('files.selectedCount', { n: selected.size }) }}</span>
      <el-button size="small" type="danger" :disabled="!selected.size" @click="deleteSelected">{{ $t('files.deleteSelected') }}</el-button>
      <span class="grow"></span>
      <el-button size="small" type="primary" plain :loading="normalizing" @click="doNormalizeNames">{{ $t('files.normalizeNames') }}</el-button>
      <span class="file-count">{{ $t('files.fileCount', { n: files.length }) }}</span>
    </div>

    <div v-if="activeType !== 'script'" v-loading="loading" class="file-grid">
      <div v-for="f in files" :key="f.url" class="file-card" :class="{ sel: selected.has(f.url) }">
        <div class="file-check">
          <el-checkbox :model-value="selected.has(f.url)" @change="() => toggleOne(f.url)" />
        </div>
        <div class="file-media" @click="toggleOne(f.url)">
          <img v-if="activeType==='image'" :src="mediaUrl(f.url)" loading="lazy" />
          <video v-else-if="activeType==='video'" :src="mediaUrl(f.url)" preload="metadata" />
          <audio v-else-if="activeType==='audio'" :src="mediaUrl(f.url)" controls @click.stop />
          <div v-else class="file-icon"><el-icon :size="40"><Document /></el-icon></div>
        </div>
        <div class="file-meta">
          <div class="file-name" :title="fileTitle(f)">{{ f.display_name || f.name }}</div>
          <div class="file-sub">
            <span>{{ fmtSize(f.size) }}</span>
            <span v-if="f.scene_number">· {{ $t('files.sceneLabel', { num: f.scene_number }) }}</span>
            <span class="proj" v-if="f.project_name">· {{ f.project_name }}</span>
            <span class="proj orphan" v-else-if="f.project_id">· {{ $t('files.projOrphan', { id: f.project_id }) }}</span>
            <span class="proj orphan" v-else>· {{ $t('files.projNone') }}</span>
            <span :class="['name-state', f.normalized ? 'ok' : 'warn']">· {{ f.normalized ? $t('files.normalized') : $t('files.needNormalize') }}</span>
          </div>
        </div>
        <div class="file-actions">
          <el-button size="small" link @click="reveal(f)">{{ $t('files.locate') }}</el-button>
          <el-button size="small" link type="danger" @click="deleteOne(f)">{{ $t('common.delete') }}</el-button>
        </div>
      </div>
      <el-empty v-if="!loading && !files.length" :description="$t('files.emptyType')" />
    </div>

    <!-- 剧本列表（虚拟文件，来自 DB） -->
    <div v-if="activeType === 'script'" v-loading="scriptLoading" class="script-list">
      <el-table :data="scripts" style="width: 100%">
        <el-table-column prop="name" :label="$t('files.colProjectName')" min-width="160" />
        <el-table-column :label="$t('files.colStatus')" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="scene_count" :label="$t('files.colScenes')" width="90" align="center" />
        <el-table-column prop="char_count" :label="$t('files.colChars')" width="90" align="center" />
        <el-table-column :label="$t('files.colUpdated')" min-width="160">
          <template #default="{ row }">{{ row.updated_at || row.created_at }}</template>
        </el-table-column>
        <el-table-column :label="$t('files.colActions')" width="240" align="right">
          <template #default="{ row }">
            <el-button size="small" link :disabled="!row.has_script" @click="viewScript(row)">{{ $t('files.view') }}</el-button>
            <el-button size="small" link :disabled="!row.has_script" @click="downloadScript(row, 'txt')">{{ $t('files.exportTxt') }}</el-button>
            <el-button size="small" link :disabled="!row.has_script" @click="downloadScript(row, 'json')">{{ $t('files.exportJson') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!scriptLoading && !scripts.length" :description="$t('files.emptyScripts')" />
    </div>

    <!-- 剧本详情弹窗 -->
    <el-dialog v-model="scriptDialog" :title="curScript ? curScript.name : $t('files.scriptTitle')" width="680px">
      <div v-if="curScript" class="script-detail">
        <p v-if="curScript.theme" class="sd-meta">{{ $t('files.scriptTheme', { theme: curScript.theme }) }}</p>
        <p v-if="curScript.summary" class="sd-summary">{{ curScript.summary }}</p>
        <div v-for="s in curScript.storyboards" :key="s.scene_number" class="sd-scene">
          <div class="sd-scene-head">{{ $t('files.scriptScene', { num: s.scene_number, dur: s.duration || 0 }) }}</div>
          <p v-if="s.description"><b>{{ $t('files.scriptVisual') }}</b>{{ s.description }}</p>
          <p v-if="s.dialog"><b>{{ $t('files.scriptDialog') }}</b>{{ s.dialog }}</p>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { Document } from '@element-plus/icons-vue'
import { mediaUrl } from '../api/config'
import { listFiles, normalizeNames, deleteFiles, revealFile, listScripts, getScript, scriptExportUrl } from '../api/files'
import { getStorageStats, cleanTemp } from '../api/settings'

const { t } = useI18n()
const activeType = ref('image')
const files = ref([])
const loading = ref(false)
const normalizing = ref(false)
const selected = reactive(new Set())
const selectAll = ref(false)
const storage = reactive({ root: '', totalSize: 0, totalFiles: 0, breakdown: {} })

// 剧本（虚拟文件）
const scripts = ref([])
const scriptLoading = ref(false)
const scriptDialog = ref(false)
const curScript = ref(null)

const STATUS_MAP = {
  draft: { key: 'files.statusDraft', type: 'info' },
  generating: { key: 'files.statusGenerating', type: 'warning' },
  completed: { key: 'files.statusCompleted', type: 'success' },
}
function statusLabel(s) { return STATUS_MAP[s] ? t(STATUS_MAP[s].key) : (s || t('files.statusDraft')) }
function statusType(s) { return (STATUS_MAP[s] || {}).type || 'info' }

const SEG_META = [
  { key: 'images', labelKey: 'files.segImages', color: '#007aff' },
  { key: 'audio', labelKey: 'files.segAudio', color: '#34c759' },
  { key: 'videos', labelKey: 'files.segVideos', color: '#ff9f0a' },
  { key: 'subtitles', labelKey: 'files.segSubtitles', color: '#af52de' },
  { key: 'temp', labelKey: 'files.segTemp', color: '#a1a1a6' },
]

const storageSegs = computed(() => {
  const total = storage.totalSize || 1
  return SEG_META.map((m) => {
    const b = storage.breakdown[m.key] || { size: 0, count: 0 }
    return { ...m, label: t(m.labelKey), size: b.size, count: b.count, pct: (b.size / total) * 100 }
  }).filter((s) => s.size > 0 || s.count > 0)
})

function fmtSize(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`
}

function fileTitle(f) {
  const lines = [
    f.display_name || f.name,
    f.original_name && f.original_name !== (f.display_name || f.name) ? `${t('files.originalName')}: ${f.original_name}` : '',
    f.url,
  ].filter(Boolean)
  return lines.join('\n')
}

async function loadStorage() {
  try {
    const d = await getStorageStats()
    Object.assign(storage, d)
  } catch (e) { ElMessage.error(t('files.loadStorageFailed') + e.message) }
}

async function loadFiles() {
  loading.value = true
  selected.clear()
  selectAll.value = false
  try {
    const d = await listFiles(activeType.value)
    files.value = d.list || []
  } catch (e) {
    ElMessage.error(t('files.loadFilesFailed') + e.message)
  } finally {
    loading.value = false
  }
}

function toggleOne(url) {
  if (selected.has(url)) selected.delete(url)
  else selected.add(url)
  selectAll.value = selected.size === files.value.length && files.value.length > 0
}

function toggleAll(val) {
  selected.clear()
  if (val) files.value.forEach((f) => selected.add(f.url))
}

async function doDelete(urls) {
  const res = await deleteFiles(urls)
  ElMessage.success(res.message || t('files.deleted'))
  await Promise.all([loadFiles(), loadStorage()])
}

async function deleteOne(f) {
  try {
    await ElMessageBox.confirm(t('files.deleteOneConfirm', { name: f.name }), t('files.deleteConfirmTitle'), { type: 'warning' })
    await doDelete([f.url])
  } catch (e) { if (e !== 'cancel') ElMessage.error(t('files.deleteFailed') + (e.message || e)) }
}

async function deleteSelected() {
  try {
    await ElMessageBox.confirm(t('files.deleteSelectedConfirm', { n: selected.size }), t('common.batchDelete'), { type: 'warning' })
    await doDelete([...selected])
  } catch (e) { if (e !== 'cancel') ElMessage.error(t('files.deleteFailed') + (e.message || e)) }
}

async function reveal(f) {
  try {
    await revealFile(f.url)
    ElMessage.success(t('files.revealSuccess'))
  } catch (e) { ElMessage.error(t('files.revealFailed') + (e.message || e)) }
}

async function doCleanTemp() {
  try {
    await ElMessageBox.confirm(t('files.cleanTempConfirm'), t('files.cleanTemp'), { type: 'warning' })
    const res = await cleanTemp()
    ElMessage.success(res.message || t('files.cleaned'))
    loadStorage()
    if (activeType.value === 'image') loadFiles()
  } catch (e) { if (e !== 'cancel') ElMessage.error(t('files.cleanFailed') + (e.message || e)) }
}

async function doNormalizeNames() {
  if (activeType.value === 'script') return
  normalizing.value = true
  try {
    const preview = await normalizeNames({ types: [activeType.value], dry_run: true })
    const data = preview.data || {}
    const count = data.renamed || 0
    if (!count) {
      ElMessage.success(t('files.normalizeNoop'))
      return
    }
    await ElMessageBox.confirm(
      t('files.normalizeConfirm', { count }),
      t('files.normalizeNames'),
      { type: 'warning' }
    )
    const res = await normalizeNames({ types: [activeType.value], dry_run: false })
    ElMessage.success(res.message || t('files.normalizeDone', { count: (res.data && res.data.renamed) || count }))
    await Promise.all([loadFiles(), loadStorage()])
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(t('files.normalizeFailed') + (e?.response?.data?.message || e.message || e))
  } finally {
    normalizing.value = false
  }
}

function onTabChange() {
  if (activeType.value === 'script') loadScripts()
  else loadFiles()
}

async function loadScripts() {
  scriptLoading.value = true
  try {
    const d = await listScripts()
    scripts.value = d.list || []
  } catch (e) {
    ElMessage.error(t('files.loadScriptsFailed') + (e.message || e))
  } finally {
    scriptLoading.value = false
  }
}

async function viewScript(row) {
  try {
    curScript.value = await getScript(row.project_id)
    scriptDialog.value = true
  } catch (e) {
    ElMessage.error(t('files.loadScriptDetailFailed') + (e.message || e))
  }
}

function downloadScript(row, format) {
  window.open(scriptExportUrl(row.project_id, format), '_blank')
}

onMounted(() => { loadStorage(); loadFiles() })
</script>

<style scoped>
.files-view { max-width: 1200px; }
.files-view h2 { margin: 0 0 18px; }
.stat-card { margin-bottom: 20px; }
.stat-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.stat-total { color: var(--el-text-color-secondary); margin-right: 12px; font-size: 13px; }
.stat-path { color: var(--el-text-color-secondary); font-size: 12px; margin-bottom: 12px; word-break: break-all; }
.bar-chart { display: flex; height: 18px; border-radius: 9px; overflow: hidden; background: var(--separator); }
.bar-seg { height: 100%; transition: width .3s; min-width: 2px; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; font-size: 12px; color: var(--el-text-color-secondary); }
.legend-item { display: flex; align-items: center; gap: 6px; }
.dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.toolbar { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.sel-count { font-size: 13px; color: var(--el-text-color-secondary); }
.grow { flex: 1; }
.file-count { font-size: 13px; color: var(--el-text-color-secondary); }
.file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.file-card { position: relative; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-surface); box-shadow: var(--shadow-sm); transition: border-color .2s, box-shadow .2s; }
.file-card.sel { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
.file-check { position: absolute; top: 6px; left: 6px; z-index: 2; background: rgba(0,0,0,.5); border-radius: 4px; padding: 0 4px; }
.file-media { height: 130px; display: flex; align-items: center; justify-content: center; background: var(--bg-base); cursor: pointer; overflow: hidden; }
.file-media img, .file-media video { width: 100%; height: 100%; object-fit: cover; }
.file-media audio { width: 90%; }
.file-icon { color: var(--el-text-color-secondary); }
.file-meta { padding: 8px 10px 4px; }
.file-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-sub { font-size: 11px; color: var(--el-text-color-secondary); margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
.proj.orphan { color: var(--warning); }
.name-state.ok { color: var(--success); }
.name-state.warn { color: var(--warning); }
.file-actions { display: flex; justify-content: flex-end; padding: 2px 6px 6px; gap: 4px; }
.script-list { margin-top: 4px; }
.script-detail { max-height: 60vh; overflow-y: auto; }
.sd-meta { color: var(--el-text-color-secondary); font-size: 13px; margin: 0 0 8px; }
.sd-summary { color: var(--el-text-color-regular); line-height: 1.6; margin: 0 0 14px; white-space: pre-wrap; }
.sd-scene { border-top: 1px solid var(--separator); padding: 10px 0; }
.sd-scene-head { font-weight: 600; margin-bottom: 6px; color: var(--primary); }
.sd-scene p { margin: 4px 0; line-height: 1.6; }
</style>
