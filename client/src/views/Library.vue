<template>
  <div class="library-view">
    <div class="lib-head">
      <h2 class="text-gradient">{{ $t('library.title') }}</h2>
      <div class="lib-actions">
        <span class="lib-total">{{ $t('library.summary', { count: items.length, size: fmtSize(totalSize) }) }}</span>
        <el-select v-model="filterProject" :placeholder="$t('library.filterProject')" clearable size="small" style="width: 200px">
          <el-option v-for="p in projectOptions" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-button size="small" @click="load">{{ $t('common.refresh') }}</el-button>
      </div>
    </div>

    <el-empty v-if="!loading && !filtered.length" :description="$t('library.empty')" />

    <div v-loading="loading" class="lib-grid">
      <div v-for="it in filtered" :key="it.id" class="lib-card" :class="{ playing: currentPlayingId === it.id }">
        <div class="lib-media">
          <video :ref="(el) => setVideoRef(it.id, el)"
                 :src="mediaUrl(it.file_url)"
                 preload="metadata"
                 controls
                 :class="{ broken: it.file_exists === false }"
                 @play="handlePlay(it.id)"
                 @pause="handlePause(it.id)"
                 @ended="handleEnded(it.id)"
                 @loadedmetadata="handleLoadedMetadata(it.id)">
            <track v-if="showSoftTrack(it)"
                   kind="subtitles"
                   srclang="zh"
                   label="中文字幕"
                   :src="mediaUrl(it.vtt_url)"
                   default>
          </video>
          <el-tag v-if="it.file_exists === false" type="danger" size="small" class="lib-missing">{{ $t('library.fileMissing') }}</el-tag>
        </div>
        <div class="lib-meta">
          <div class="lib-name" :title="it.project_name">{{ it.project_name || $t('library.unnamedProject') }}</div>
          <div class="lib-sub">
            <span>{{ fmtDuration(it.duration) }}</span>
            <span>·</span>
            <span>{{ fmtSize(it.file_size) }}</span>
          </div>
          <div v-if="it.long_video_mode" class="lib-long">
            长视频 · {{ it.chapter_count || 1 }} 章
          </div>
          <div class="subtitle-row">
            <el-tooltip :content="subtitleInfo(it).detail" placement="top">
              <el-tag :type="subtitleInfo(it).type" size="small" effect="plain" class="subtitle-chip">
                {{ subtitleInfo(it).label }}
              </el-tag>
            </el-tooltip>
          </div>
          <div v-if="it.external_file_path" class="lib-external" :class="{ missing: !it.external_file_exists }">
            <span>{{ it.external_file_exists ? '本机副本' : '副本缺失' }}</span>
            <code>{{ displayLocalPath(it.external_file_path) }}</code>
          </div>
          <div class="lib-time">{{ fmtTime(it.created_at) }}</div>
        </div>
        <div class="lib-btns">
          <el-button size="small" type="primary" plain :disabled="it.file_exists === false"
                     @click="download(it)">{{ $t('common.download') }}</el-button>
          <el-button size="small" @click="goProject(it.project_id)">{{ $t('library.viewProject') }}</el-button>
          <el-button size="small" type="danger" plain @click="remove(it)">{{ $t('common.delete') }}</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { mediaUrl } from '../api/config'
import { listLibrary, deleteExport } from '../api/features'
import { displayLocalPath } from '../utils/localPath'

const { t } = useI18n()
const router = useRouter()
const items = ref([])
const loading = ref(false)
const filterProject = ref('')
const currentPlayingId = ref(null)
const videoRefs = new Map()

const totalSize = computed(() => items.value.reduce((s, i) => s + (i.file_size || 0), 0))
const filtered = computed(() =>
  filterProject.value ? items.value.filter((i) => i.project_id === filterProject.value) : items.value
)
const projectOptions = computed(() => {
  const seen = new Map()
  items.value.forEach((i) => { if (!seen.has(i.project_id)) seen.set(i.project_id, i.project_name || t('library.unnamedProject')) })
  return [...seen].map(([id, name]) => ({ id, name }))
})

function fmtSize(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`
}
function fmtDuration(s) {
  if (!s) return '—'
  const m = Math.floor(s / 60); const sec = Math.round(s % 60)
  return m ? t('library.durationMin', { m, s: sec }) : t('library.durationSec', { s: sec })
}
function fmtTime(t) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

function setVideoRef(id, el) {
  if (el) videoRefs.set(id, el)
  else videoRefs.delete(id)
}

function pauseAll(exceptId = null) {
  for (const [id, el] of videoRefs.entries()) {
    if (!el || id === exceptId) continue
    try {
      if (!el.paused) el.pause()
      if (el.currentTime) el.currentTime = 0
    } catch {}
  }
}

function cleanupVideoRefs(validRows = items.value) {
  const validIds = new Set(validRows.map((i) => i.id))
  for (const id of videoRefs.keys()) {
    if (!validIds.has(id)) videoRefs.delete(id)
  }
  if (currentPlayingId.value && !validIds.has(currentPlayingId.value)) currentPlayingId.value = null
}

function handlePlay(id) {
  pauseAll(id)
  currentPlayingId.value = id
}

function handlePause(id) {
  if (currentPlayingId.value === id) currentPlayingId.value = null
}

function handleEnded(id) {
  if (currentPlayingId.value === id) currentPlayingId.value = null
}

function handleLoadedMetadata(id) {
  const el = videoRefs.get(id)
  if (!el?.textTracks?.length) return
  try { el.textTracks[0].mode = 'showing' } catch {}
}

function showSoftTrack(it) {
  return !!it.vtt_url && Number(it.burn_subtitle) !== 1 && ['soft', 'soft_missing_vtt'].includes(String(it.subtitle_status || ''))
}

function subtitleInfo(it) {
  const status = String(it.subtitle_status || 'legacy')
  if (status === 'burned') {
    return { label: '已内嵌字幕', type: 'success', detail: '字幕已烧入 MP4，下载后任意播放器都应可见。' }
  }
  if (status === 'soft') {
    return { label: '外挂字幕', type: 'warning', detail: 'MP4 本体未内嵌字幕，成片库会通过 WebVTT track 显示字幕。' }
  }
  if (status === 'soft_missing_vtt') {
    return { label: '外挂字幕缺 VTT', type: 'warning', detail: '该成片只有 SRT 记录，浏览器可能无法自动显示字幕，建议重新导出。' }
  }
  if (status === 'error') {
    return { label: '字幕失败', type: 'danger', detail: it.subtitle_error || '字幕生成或烧录失败，建议回到项目重新导出。' }
  }
  if (status === 'no_text') {
    return { label: '无字幕文本', type: 'info', detail: '导出时没有可用对白或字幕文本。' }
  }
  return { label: '旧成片，建议重导字幕版', type: 'info', detail: '这是旧版本导出的成片，无法确认是否内嵌字幕。' }
}

async function load() {
  pauseAll()
  currentPlayingId.value = null
  loading.value = true
  try {
    items.value = await listLibrary()
    await nextTick()
    cleanupVideoRefs()
  } catch (e) {
    ElMessage.error(t('library.loadFailed') + (e.message || e))
  } finally {
    loading.value = false
  }
}

function download(it) {
  const a = document.createElement('a')
  a.href = mediaUrl(it.file_url)
  a.download = `${it.project_name || 'video'}.mp4`
  document.body.appendChild(a); a.click(); a.remove()
}

function goProject(id) {
  router.push(`/projects/${id}/preview`)
}

async function remove(it) {
  try {
    await ElMessageBox.confirm(t('library.deleteConfirm'), t('library.deleteTitle'), { type: 'warning' })
    if (currentPlayingId.value === it.id) currentPlayingId.value = null
    await deleteExport(it.id)
    ElMessage.success(t('library.deleted'))
    await load()
  } catch (e) { if (e !== 'cancel') ElMessage.error(t('library.deleteFailed') + (e.message || e)) }
}

watch(filterProject, () => {
  pauseAll()
  currentPlayingId.value = null
})

onMounted(load)
</script>

<style scoped>
.library-view { max-width: 1200px; }
.lib-head {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 12px; margin-bottom: 16px;
}
.lib-head h2 { margin: 0; }
.lib-actions { display: flex; align-items: center; gap: 10px; }
.lib-total { color: var(--text-second); font-size: 13px; }
.lib-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px; min-height: 120px;
}
.lib-card {
  background: var(--bg-surface); border: 1px solid var(--separator);
  border-radius: 14px; overflow: hidden;
  transition: transform 0.2s var(--ease-apple), box-shadow 0.2s var(--ease-apple);
}
.lib-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); }
.lib-card.playing { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary-soft), var(--shadow-md); }
.lib-media { position: relative; aspect-ratio: 16 / 9; background: #000; }
.lib-media video { width: 100%; height: 100%; object-fit: contain; display: block; }
.lib-media video.broken { opacity: 0.3; }
.lib-missing { position: absolute; top: 8px; right: 8px; }
.lib-meta { padding: 10px 12px 4px; }
.lib-name { font-weight: 600; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-sub { display: flex; gap: 6px; color: var(--text-second); font-size: 12px; margin-top: 4px; }
.lib-long {
  display: inline-flex;
  margin-top: 6px;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
}
.subtitle-row {
  margin-top: 7px;
  display: flex;
  align-items: center;
}
.subtitle-chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lib-external {
  display: grid;
  gap: 3px;
  margin-top: 7px;
  padding: 6px 7px;
  border-radius: 7px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
}
.lib-external.missing {
  background: rgba(230, 162, 60, 0.1);
  color: var(--el-color-warning);
}
.lib-external code {
  color: inherit;
  white-space: normal;
  overflow-wrap: anywhere;
}
.lib-time { color: var(--text-tertiary, #999); font-size: 11px; margin-top: 2px; }
.lib-btns { display: flex; gap: 6px; padding: 10px 12px 14px; }
.lib-btns .el-button { flex: 1; margin: 0; }
</style>
