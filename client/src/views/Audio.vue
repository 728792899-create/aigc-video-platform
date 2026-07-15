<template>
  <div class="audio-page">
    <h2 class="page-title text-gradient">{{ $t('audio.title') }}</h2>

    <!-- Global Settings -->
    <div class="settings-card">
      <h3>{{ $t('audio.globalSettings') }}</h3>
      <div class="settings-row">
        <div class="setting-item">
          <label>{{ $t('audio.voiceRole') }}</label>
          <div style="display:flex; gap:8px">
            <el-select v-model="voice" :placeholder="$t('audio.selectVoice')" style="flex:1">
              <el-option v-for="v in voiceOptions" :key="v.value" :label="v.label" :value="v.value" />
            </el-select>
            <el-button :loading="previewLoading" @click="previewVoice">{{ $t('audio.audition') }}</el-button>
          </div>
          <audio v-if="previewUrl" :src="previewUrl" controls autoplay class="preview-audio" />
        </div>
        <div class="setting-item">
          <label>{{ $t('audio.speed', { val: speed.toFixed(1) }) }}</label>
          <el-slider v-model="speed" :min="0.5" :max="2.0" :step="0.1" />
        </div>
        <div class="setting-item">
          <label>{{ $t('audio.pitch', { val: (pitch > 0 ? '+' : '') + pitch }) }}</label>
          <el-slider v-model="pitch" :min="-20" :max="20" :step="1" />
        </div>
        <div class="setting-item">
          <label>{{ $t('audio.emotionStyle') }}</label>
          <el-select v-model="emotion" :placeholder="$t('audio.selectEmotion')" style="width:100%">
            <el-option v-for="e in emotionOptions" :key="e.key" :label="e.label" :value="e.key" />
          </el-select>
        </div>
        <div class="setting-item">
          <label>{{ $t('audio.volume', { val: volume.toFixed(1) }) }}</label>
          <el-slider v-model="volume" :min="0.5" :max="1.5" :step="0.1" />
        </div>
      </div>
      <div class="settings-row" style="margin-top:8px">
        <div class="setting-item">
          <el-checkbox v-model="dialogMode">{{ $t('audio.dialogMode') }}</el-checkbox>
        </div>
        <div class="setting-item" style="font-size:12px;color:#86868b;line-height:1.6">
          {{ $t('audio.emotionHint') }}
        </div>
      </div>
    </div>

    <!-- Batch Button -->
    <div class="batch-section">
      <el-select v-if="chapterOptions.length > 1" v-model="selectedChapter" class="chapter-filter" size="small">
        <el-option v-for="chapter in chapterOptions" :key="chapter.value" :label="chapter.label" :value="chapter.value" />
      </el-select>
      <el-button @click="downloadSrt">{{ $t('audio.exportSrt') }}</el-button>
      <el-button @click="autoFillSubtitles">
        {{ $t('audio.autoFill') }}
      </el-button>
      <el-button type="primary" :loading="batchLoading" @click="batchGenerate">
        {{ $t('audio.batchGenerateAll') }}
      </el-button>
      <el-button
        v-if="dirtyCount > 0"
        type="warning"
        :loading="batchLoading"
        @click="applyAllDirty"
      >
        {{ $t('audio.applyAllChanges', { n: dirtyCount }) }}
      </el-button>
      <el-button :loading="batchLoading" @click="applyGlobalVoice">
        {{ $t('audio.applyGlobalVoice') }}
      </el-button>
    </div>

    <!-- Subtitle Style Settings -->
    <div class="settings-card subtitle-settings">
      <h3>{{ $t('audio.subtitleStyleSettings') }}</h3>
      <div class="settings-row">
        <div class="setting-item">
          <label>{{ $t('audio.font') }}</label>
          <el-select v-model="subtitleStyle.fontFamily">
            <el-option :label="$t('audio.fontYahei')" value="Microsoft YaHei" />
            <el-option :label="$t('audio.fontHei')" value="SimHei" />
            <el-option :label="$t('audio.fontSong')" value="SimSun" />
            <el-option :label="$t('audio.fontKai')" value="KaiTi" />
            <el-option label="Arial" value="Arial" />
          </el-select>
        </div>
        <div class="setting-item">
          <label>{{ $t('audio.fontSize', { val: subtitleStyle.fontSize }) }}</label>
          <el-slider v-model="subtitleStyle.fontSize" :min="14" :max="48" :step="2" />
        </div>
        <div class="setting-item">
          <label>{{ $t('audio.fontColor') }}</label>
          <el-color-picker v-model="subtitleStyle.fontColor" />
        </div>
        <div class="setting-item">
          <label>{{ $t('audio.outlineColor') }}</label>
          <el-color-picker v-model="subtitleStyle.outlineColor" />
        </div>
        <div class="setting-item">
          <label>{{ $t('audio.position') }}</label>
          <el-select v-model="subtitleStyle.position">
            <el-option :label="$t('audio.posBottom')" value="bottom" />
            <el-option :label="$t('audio.posTop')" value="top" />
            <el-option :label="$t('audio.posMiddle')" value="middle" />
          </el-select>
        </div>
      </div>
      <div class="subtitle-preview">
        <span :style="subtitlePreviewStyle">{{ $t('audio.subtitlePreview') }}</span>
      </div>
    </div>

    <!-- Storyboard List -->
    <div class="storyboard-list">
      <div v-for="(item, index) in visibleStoryboards" :key="item.id" class="storyboard-card">
        <div class="scene-header">
          <span class="scene-number">{{ $t('audio.scene') }} {{ index + 1 }}</span>
          <div class="scene-header-right">
            <el-tag v-if="item.dirty && !item.no_voice" type="warning" size="small" effect="light">
              {{ $t('audio.pendingUpdate') }}
            </el-tag>
            <el-tag v-else-if="item.audio_url && !item.no_voice" type="success" size="small" effect="light">
              {{ $t('audio.voicedBadge') }}
            </el-tag>
            <el-checkbox
              v-model="item.no_voice"
              size="small"
              class="no-voice-switch"
              @change="updateNoVoice(item)"
            >{{ $t('audio.noVoice') }}</el-checkbox>
            <span :class="['status-badge', item.status]">
              {{ statusText(item.status) }}
            </span>
          </div>
        </div>

        <div class="scene-body">
          <el-input
            v-model="item.dialog"
            type="textarea"
            :rows="3"
            :placeholder="item.no_voice ? $t('audio.narrationPlaceholder') : $t('audio.dialogPlaceholder')"
            @input="markDirty(item)"
          />
          <p v-if="item.no_voice" class="no-voice-hint">{{ $t('audio.noVoiceHint') }}</p>
          <div class="scene-actions">
            <el-select
              v-model="item.voice"
              :placeholder="$t('audio.voiceColumn')"
              size="small"
              :disabled="item.no_voice"
              style="width: 130px; margin-right: 8px"
              @change="updateStoryboardVoice(item, $event)"
            >
              <el-option v-for="v in voiceOptions" :key="v.value" :label="v.label" :value="v.value" />
            </el-select>
            <el-button
              :type="item.dirty && item.audio_url ? 'warning' : 'success'"
              size="small"
              :loading="item.loading"
              :disabled="item.no_voice"
              @click="generateTTS(item)"
            >
              {{ (item.dirty && item.audio_url) ? $t('audio.applyChange') : $t('audio.generateVoice') }}
            </el-button>
            <audio
              v-if="item.audio_url && !item.no_voice"
              :key="audioKey(item)"
              :src="audioSrc(item)"
              controls
              class="audio-player"
            ></audio>
          </div>
        </div>
      </div>
      <el-empty v-if="storyboards.length === 0" :description="$t('audio.emptyStoryboards')" />
    </div>

    <ProjectStageFooter
      current-stage="配音字幕"
      next-stage="视频预览"
      :ready="audioStageReady"
      :blocked-reason="audioStageBlockedReason"
      action-label="进入视频预览"
      ready-hint="配音状态已满足预览条件，可以进入成片预览。"
      @go-next="goNextStage"
    />
  </div>
</template>

<script setup lang="ts">
import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import api, { unwrap } from '../api'
import { mediaUrl } from '../api/config'
import { voicePreview, srtDownloadUrl } from '../api/features'
import ProjectStageFooter from '../components/ProjectStageFooter.vue'

type EntityId = string | number
interface VoiceOption { value: string; label: string }
interface EmotionOption { key: string; label: string }
interface AudioStoryboard {
  id: EntityId
  dialog: string
  audio_url: string
  audio_version: number
  status: 'pending' | 'generating' | 'done' | 'error'
  voice: string
  _lastSavedVoice: string
  no_voice: boolean
  dirty: boolean
  loading: boolean
  chapter_index?: number
  chapter_title?: string
}

const StoryboardSourceSchema = z.object({
  id: z.union([z.string(), z.number()]),
  dialog: z.string().optional(),
  text: z.string().optional(),
  audio_url: z.string().nullish(),
  voice: z.string().optional(),
  no_voice: z.union([z.boolean(), z.number()]).optional(),
  chapter_index: z.number().optional(),
  chapter_title: z.string().optional(),
}).passthrough()

const VoicesResponseSchema = z.object({
  emotions: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
  voices: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
}).passthrough()

const TtsResponseSchema = z.object({ file_url: z.string() }).passthrough()
const AutoFillResponseSchema = z.object({ updated_count: z.number().default(0) }).passthrough()

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const projectId = Array.isArray(route.params.id) ? route.params.id[0] ?? '' : route.params.id ?? ''

const voice = ref('xiaoxiao')
const speed = ref(1.0)
const pitch = ref(0)
const emotion = ref('general')
const volume = ref(1.0)
const dialogMode = ref(false)
const emotionOptions = ref<EmotionOption[]>([{ key: 'general', label: t('audio.emotionDefault') }])
const batchLoading = ref(false)
const storyboards = ref<AudioStoryboard[]>([])
const selectedChapter = ref('all')
const previewLoading = ref(false)
const previewUrl = ref('')

// 字幕样式
const subtitleStyle = reactive({
  fontFamily: 'Microsoft YaHei',
  fontSize: 24,
  fontColor: '#FFFFFF',
  outlineColor: '#000000',
  position: 'bottom',
  bold: false,
})

const subtitlePreviewStyle = computed(() => ({
  fontFamily: subtitleStyle.fontFamily,
  fontSize: subtitleStyle.fontSize + 'px',
  color: subtitleStyle.fontColor,
  textShadow: `1px 1px 2px ${subtitleStyle.outlineColor}, -1px -1px 2px ${subtitleStyle.outlineColor}`,
  fontWeight: subtitleStyle.bold ? 'bold' : 'normal',
}))

const voiceOptions = ref<VoiceOption[]>([
  { value: 'xiaoxiao', label: t('audio.voiceXiaoxiao') },
  { value: 'xiaoyi', label: t('audio.voiceXiaoyi') },
  { value: 'yunyang', label: t('audio.voiceYunyang') },
  { value: 'yunxi', label: t('audio.voiceYunxi') },
  { value: 'yunjian', label: t('audio.voiceYunjian') },
  { value: 'yunxia', label: t('audio.voiceYunxia') }
])

const statusText = (status: AudioStoryboard['status']): string => {
  const map: Record<AudioStoryboard['status'], string> = { pending: t('audio.statusPending'), generating: t('audio.statusGenerating'), done: t('audio.statusDone'), error: t('audio.statusError') }
  return map[status] || t('audio.statusPending')
}

// ② 待更新（设置已改、音频未跟上）的分镜数量
const dirtyCount = computed(() => storyboards.value.filter(s => s.dirty && !s.no_voice).length)
const voiceRequiredStoryboards = computed(() => storyboards.value.filter((s) => !s.no_voice && String(s.dialog || '').trim()))
const batchScopeStoryboards = computed(() => selectedChapter.value === 'all'
  ? storyboards.value
  : storyboards.value.filter((s) => String(s.chapter_index || 1) === selectedChapter.value))
const visibleStoryboards = computed(() => batchScopeStoryboards.value)
const chapterOptions = computed(() => {
  const map = new Map<number, { value: string; label: string; count: number }>()
  storyboards.value.forEach((sb) => {
    const idx = Number(sb.chapter_index || 0)
    if (!idx) return
    const entry = map.get(idx) ?? { value: String(idx), label: sb.chapter_title || `第 ${idx} 章`, count: 0 }
    entry.count += 1
    map.set(idx, entry)
  })
  const list = [...map.values()]
    .sort((a, b) => Number(a.value) - Number(b.value))
    .map((item) => ({ ...item, label: `${item.label}（${item.count} 镜）` }))
  return list.length ? [{ value: 'all', label: `全部章节（${storyboards.value.length} 镜）` }, ...list] : []
})
const audioStageReady = computed(() => {
  if (!storyboards.value.length) return false
  if (dirtyCount.value > 0 || batchLoading.value) return false
  return voiceRequiredStoryboards.value.every((s) => !!s.audio_url)
})
const audioStageBlockedReason = computed(() => {
  if (!storyboards.value.length) return '请先在文案创作中生成并保存分镜。'
  if (batchLoading.value) return '正在生成或应用配音，请等待任务完成。'
  if (dirtyCount.value > 0) return `还有 ${dirtyCount.value} 个分镜的配音待更新。`
  const missing = voiceRequiredStoryboards.value.filter((s) => !s.audio_url).length
  if (missing > 0) return `还有 ${missing} 个有台词的分镜未生成配音，或可勾选“此镜不读”。`
  return '当前配音状态可以进入预览。'
})

function goNextStage() {
  router.push(`/projects/${projectId}/preview`)
}

// 当前全局音色的展示名（用于「应用全局音色」确认弹窗）
const voiceLabel = computed(() => {
  const found = voiceOptions.value.find(o => o.value === voice.value)
  return found ? found.label : voice.value
})

const voiceName = (value: string): string => {
  const found = voiceOptions.value.find(o => o.value === value)
  return found ? found.label : value
}

const audioSrc = (item: AudioStoryboard): string => {
  if (!item.audio_url) return ''
  const sep = item.audio_url.includes('?') ? '&' : '?'
  return `${item.audio_url}${sep}v=${item.audio_version || 0}`
}

const audioKey = (item: AudioStoryboard): string => `${item.id}-${item.audio_url || ''}-${item.audio_version || 0}`

const fetchStoryboards = async () => {
  try {
    const response = await api.get<ApiEnvelope<unknown>>(`/storyboards/project/${projectId}`)
    const list = StoryboardSourceSchema.array().parse(unwrap(response))
    storyboards.value = list.map((item): AudioStoryboard => ({
      ...item,
      dialog: item.dialog || item.text || '',
      audio_url: item.audio_url ? mediaUrl(item.audio_url) : '',
      audio_version: Date.now(),
      status: item.audio_url ? 'done' : 'pending',
      voice: item.voice || 'xiaoxiao',
      _lastSavedVoice: item.voice || 'xiaoxiao',
      no_voice: !!item.no_voice,
      dirty: false,
      loading: false
    }))
  } catch (e) {
    ElMessage.error(t('audio.fetchStoryboardsFailed'))
  }
}

const generateTTS = async (item: AudioStoryboard): Promise<boolean> => {
  if (!item.dialog.trim()) {
    ElMessage.warning(t('audio.dialogRequired'))
    return false
  }
  item.loading = true
  item.status = 'generating'
  try {
    const res = await api.post<ApiEnvelope<unknown>>('/ai/generate-tts', {
      text: item.dialog,
      voice: item.voice || voice.value,
      speed: speed.value,
      pitch: pitch.value,
      emotion: emotion.value,
      volume: volume.value,
      dialog: dialogMode.value,
      storyboard_id: item.id
    })
    const data = TtsResponseSchema.parse(unwrap(res))
    item.audio_url = mediaUrl(data.file_url)
    item.audio_version = Date.now()
    item.status = 'done'
    item.dirty = false
    item._lastSavedVoice = item.voice || voice.value
    ElMessage.success(`${t('audio.ttsSuccess')}：${voiceName(item._lastSavedVoice)}`)
    return true
  } catch (e) {
    item.status = 'error'
    item.dirty = !!(item.audio_url && !item.no_voice)
    ElMessage.error(t('audio.ttsFailed'))
    return false
  } finally {
    item.loading = false
  }
}

const updateStoryboardVoice = async (item: AudioStoryboard, selectedVoice: unknown = item.voice) => {
  const previousVoice = item._lastSavedVoice || item.voice || 'xiaoxiao'
  item.voice = typeof selectedVoice === 'string' && selectedVoice ? selectedVoice : previousVoice
  if (item.audio_url && !item.no_voice && item.dialog.trim()) item.dirty = true
  try {
    await api.put(`/storyboards/${item.id}`, { voice: item.voice })
    item._lastSavedVoice = item.voice
  } catch (e) {
    item.voice = previousVoice
    item.dirty = false
    ElMessage.error(t('audio.ttsFailed'))
    console.warn('保存音色失败')
    return
  }
  // ② 即时应用：改了音色后，若该镜已有配音，立刻按新音色重新生成
  if (item.audio_url && !item.no_voice && item.dialog.trim()) {
    const ok = await generateTTS(item)
    if (!ok) item.dirty = true
  } else {
    item.dirty = false
  }
}

// ② 台词/设置变化但音频还没跟上时，标记为「待更新」
const markDirty = (item: AudioStoryboard) => {
  if (item.audio_url && !item.no_voice) item.dirty = true
}

// ② 一键应用全部待更新分镜（重新生成配音，使修改即时生效）
const applyAllDirty = async () => {
  const targets = batchScopeStoryboards.value.filter(s => s.dirty && !s.no_voice && s.dialog.trim())
  if (targets.length === 0) {
    ElMessage.info(t('audio.nothingToApply'))
    return
  }
  batchLoading.value = true
  for (const item of targets) {
    await generateTTS(item)
  }
  batchLoading.value = false
  ElMessage.success(t('audio.appliedAll', { n: targets.length }))
}

// ① 切换「此镜不读/旁白」：写回后端 no_voice，并清理朗读状态
const updateNoVoice = async (item: AudioStoryboard) => {
  try {
    await api.put(`/storyboards/${item.id}`, { no_voice: item.no_voice ? 1 : 0 })
    if (item.no_voice) {
      ElMessage.info(t('audio.noVoiceOn'))
    }
  } catch (e) {
    item.no_voice = !item.no_voice // 回滚
    ElMessage.error(t('audio.noVoiceSaveFailed'))
  }
}

const batchGenerate = async () => {
  batchLoading.value = true
  let skipped = 0
  for (const item of batchScopeStoryboards.value) {
    if (item.no_voice) { skipped++; continue }  // ① 跳过旁白/不读分镜
    if (item.dialog.trim()) {
      await generateTTS(item)
    }
  }
  batchLoading.value = false
  if (skipped > 0) ElMessage.info(t('audio.batchSkipped', { n: skipped }))
}

// 应用全局音色到所有分镜：把上方「全局设置」选的音色覆盖到每个分镜，并重新生成配音。
// 修复问题一：原来批量生成时 generateTTS 优先用 item.voice（分镜自带音色，首次加载默认 xiaoxiao），
// 全局下拉只是兜底，导致改了全局音色批量生成不生效。此按钮显式把全局音色写到所有分镜。
const applyGlobalVoice = async () => {
  const targets = batchScopeStoryboards.value.filter(s => !s.no_voice && s.dialog.trim())
  if (targets.length === 0) {
    ElMessage.info(t('audio.nothingToApply'))
    return
  }
  try {
    await ElMessageBox.confirm(
      t('audio.applyGlobalVoiceConfirm', { voice: voiceLabel.value, n: targets.length }),
      t('audio.applyGlobalVoiceTitle'),
      { confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel'), type: 'warning' }
    )
  } catch (_) {
    return // 用户取消
  }
  batchLoading.value = true
  for (const item of targets) {
    item.voice = voice.value           // 覆盖分镜音色为全局音色
    try {
      await api.put(`/storyboards/${item.id}`, { voice: item.voice })
    } catch (e) { /* 静默 */ }
    await generateTTS(item)            // 按新音色重新生成
  }
  batchLoading.value = false
  ElMessage.success(t('audio.appliedAll', { n: targets.length }))
}

const autoFillSubtitles = async () => {
  try {
    const res = await api.post<ApiEnvelope<unknown>>(`/subtitle/auto-fill/${projectId}`)
    const data = AutoFillResponseSchema.parse(unwrap(res))
    ElMessage.success(t('audio.autoFillSuccess', { n: (data?.updated_count || 0) }))
    // 同时把字幕样式写入每个分镜
    for (const item of storyboards.value) {
      if (item.dialog && item.dialog.trim()) {
        await api.put(`/subtitle/storyboard/${item.id}`, {
          subtitle_text: item.dialog,
          subtitle_style: JSON.stringify(subtitleStyle),
        })
      }
    }
  } catch (e) {
    ElMessage.error(t('audio.autoFillFailed'))
  }
}

const previewVoice = async () => {
  previewLoading.value = true
  previewUrl.value = ''
  try {
    const data = await voicePreview({ voice: voice.value, speed: speed.value, pitch: pitch.value, emotion: emotion.value, volume: volume.value })
    previewUrl.value = mediaUrl(data.file_url)
  } catch (cause) {
    ElMessage.error(t('audio.previewFailed', { msg: errorMessage(cause) }))
  } finally {
    previewLoading.value = false
  }
}

const loadVoicesAndEmotions = async () => {
  try {
    const res = await api.get<ApiEnvelope<unknown>>('/ai/voices')
    const d = VoicesResponseSchema.parse(unwrap(res))
    if (d && Array.isArray(d.emotions)) emotionOptions.value = d.emotions
    if (d && Array.isArray(d.voices) && d.voices.length > 0) {
      voiceOptions.value = d.voices.map(v => ({ value: v.key, label: v.label }))
      // 自动选第一个音色（火山/Edge 列表都用第一个作为默认）
      if (!voiceOptions.value.find(o => o.value === voice.value)) {
        voice.value = voiceOptions.value[0]?.value ?? voice.value
      }
    }
  } catch (e) { /* 静默：保留默认情感选项 + Edge 默认音色列表 */ }
}

const downloadSrt = () => {
  const a = document.createElement('a')
  a.href = srtDownloadUrl(projectId)
  document.body.appendChild(a); a.click(); a.remove()
}

onMounted(() => { void fetchStoryboards(); void loadVoicesAndEmotions() })
</script>

<style scoped>
.audio-page {
  padding: 24px;
  min-height: 100vh;
  background: var(--bg-base);
  color: var(--text);
}

.page-title {
  font-size: 24px;
  margin-bottom: 24px;
  color: var(--text);
  font-family: var(--font-display);
}

.settings-card {
  background: var(--bg-surface);
  border: 1px solid var(--separator);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 24px;
  margin-bottom: 20px;
}

.settings-card h3 {
  margin: 0 0 16px 0;
  color: var(--text);
}

.settings-row {
  display: flex;
  gap: 32px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.setting-item {
  flex: 1;
  min-width: 200px;
}

.setting-item label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--text-second);
}

.batch-section {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  text-align: right;
}

.chapter-filter {
  width: 260px;
}
.preview-audio {
  width: 100%;
  height: 34px;
  margin-top: 8px;
}

.storyboard-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.storyboard-card {
  background: var(--bg-surface);
  border: 1px solid var(--separator);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 20px;
}

.scene-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.scene-number {
  font-weight: 600;
  font-size: 16px;
  color: var(--primary);
}

.scene-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.no-voice-switch {
  margin: 0;
}

.no-voice-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-second);
}

.status-badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
}

.status-badge.pending {
  background: var(--separator);
  color: var(--text-second);
}

.status-badge.generating {
  background: rgba(255, 159, 10, 0.14);
  color: #b25000;
}

.status-badge.done {
  background: rgba(52, 199, 89, 0.14);
  color: #248a3d;
}

.status-badge.error {
  background: rgba(255, 59, 48, 0.14);
  color: #d70015;
}

.scene-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scene-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.audio-player {
  height: 36px;
  flex: 1;
  min-width: 200px;
}

:deep(.el-select) {
  width: 100%;
}

.subtitle-settings {
  border: 1px solid rgba(0, 122, 255, 0.18);
}

.subtitle-preview {
  margin-top: 16px;
  padding: 20px;
  background: #000;
  border-radius: var(--radius-md);
  text-align: center;
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
