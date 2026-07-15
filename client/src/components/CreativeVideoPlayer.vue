<template>
  <section
    ref="rootRef"
    class="creative-player"
    tabindex="0"
    @keydown="onKeydown"
  >
    <div class="player-topbar">
      <div class="mode-group">
        <button
          class="mode-pill"
          :class="{ active: mode === 'real-video' }"
          :disabled="!videoUrl"
          @click="$emit('mode-change', 'real-video')"
        >
          真实成片
        </button>
        <button
          class="mode-pill"
          :class="{ active: mode === 'draft-canvas' }"
          @click="$emit('mode-change', 'draft-canvas')"
        >
          草稿预览
        </button>
      </div>
      <div class="player-meta">
        <span>{{ ratio }}</span>
        <span>{{ speedLabel }}</span>
        <span v-if="syncSummary">{{ syncSummary }}</span>
        <span v-if="currentSceneLabel">{{ currentSceneLabel }}</span>
      </div>
    </div>

    <div class="stage-shell" :style="{ aspectRatio: aspectRatioCss }">
      <slot name="stage"></slot>
      <div v-if="loading" class="stage-state">
        <span class="state-dot"></span>
        {{ loadingText || '正在准备预览…' }}
      </div>
      <div v-else-if="error" class="stage-state error">
        {{ error }}
      </div>
      <button v-else class="big-play" @click="$emit('toggle-play')">
        <el-icon><VideoPause v-if="isPlaying" /><VideoPlay v-else /></el-icon>
      </button>
    </div>

    <div class="control-bar">
      <el-button text circle class="icon-button" @click="$emit('toggle-play')">
        <el-icon><VideoPause v-if="isPlaying" /><VideoPlay v-else /></el-icon>
      </el-button>
      <span class="time-code">{{ formatTime(currentTime) }} / {{ formatTime(totalDuration) }}</span>
      <div ref="progressRef" class="scrub-bar" @click="seekFromEvent">
        <div class="scrub-fill" :style="{ width: progressPercent + '%' }"></div>
        <div class="scrub-thumb" :style="{ left: progressPercent + '%' }"></div>
      </div>
      <el-select class="speed-select" :model-value="videoSpeed" size="small" @change="$emit('speed-change', Number($event))">
        <el-option v-for="s in speedOptions" :key="s" :label="`${s}x`" :value="s" />
      </el-select>
      <el-button text circle class="icon-button" @click="$emit('mute-change', !muted)">
        <el-icon><Mute /></el-icon>
      </el-button>
      <el-slider
        class="volume-slider"
        :model-value="volume"
        :min="0"
        :max="1"
        :step="0.05"
        :show-tooltip="false"
        @change="$emit('volume-change', Number($event))"
      />
      <el-button text class="text-button" :type="subtitleEnabled ? 'primary' : 'default'" @click="$emit('toggle-subtitle')">
        字幕
      </el-button>
      <el-button text circle class="icon-button" @click="$emit('snapshot')">
        <el-icon><Camera /></el-icon>
      </el-button>
      <el-button text circle class="icon-button" @click="toggleFullscreen">
        <el-icon><FullScreen /></el-icon>
      </el-button>
    </div>

    <div class="scene-strip">
      <button
        v-for="scene in scenes"
        :key="scene.id"
        class="scene-chip"
        :class="{ active: scene.index === currentSceneIndex, warning: scene.status !== 'ok' }"
        @click="$emit('scene-seek', scene.start)"
      >
        <span class="scene-thumb">
          <img v-if="scene.thumb" :src="scene.thumb" alt="" />
          <el-icon v-else><Picture /></el-icon>
        </span>
        <span class="scene-copy">
          <strong>S{{ String(scene.index + 1).padStart(2, '0') }}</strong>
          <small>{{ scene.duration.toFixed(1) }}s · {{ scene.statusLabel }}</small>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Camera, FullScreen, Mute, Picture, VideoPause, VideoPlay } from '@element-plus/icons-vue'

interface PlayerStoryboard {
  id: string | number
  duration?: number
  thumbnailUrl?: string | null
  selected_image_url?: string | null
  sync_status?: string | null
  quality_status?: string | null
}

const props = withDefaults(defineProps<{
  mode?: string
  videoUrl?: string
  storyboards?: PlayerStoryboard[]
  durations?: number[]
  currentTime?: number
  currentSceneIndex?: number
  totalDuration?: number
  ratio?: string
  videoSpeed?: number
  subtitleEnabled?: boolean
  isPlaying?: boolean
  muted?: boolean
  volume?: number
  syncSummary?: string
  loading?: boolean
  loadingText?: string
  error?: string
}>(), {
  mode: 'draft-canvas', videoUrl: '', storyboards: () => [], durations: () => [], currentTime: 0,
  currentSceneIndex: 0, totalDuration: 0, ratio: '16:9', videoSpeed: 1, subtitleEnabled: true,
  isPlaying: false, muted: false, volume: 1, syncSummary: '', loading: false, loadingText: '', error: '',
})

const emit = defineEmits<{
  'toggle-play': []
  seek: [seconds: number]
  'speed-change': [speed: number]
  'toggle-subtitle': []
  'mute-change': [muted: boolean]
  'volume-change': [volume: number]
  snapshot: []
  'mode-change': [mode: string]
  'scene-seek': [seconds: number]
  fullscreen: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const progressRef = ref<HTMLElement | null>(null)
const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2]
const ratioSize: Record<string, string> = {
  '16:9': '16 / 9',
  '9:16': '9 / 16',
  '1:1': '1 / 1',
  '4:5': '4 / 5',
  '4:3': '4 / 3',
  '3:4': '3 / 4',
}

const aspectRatioCss = computed(() => ratioSize[props.ratio] || ratioSize['16:9'])
const speedLabel = computed(() => `${Number(props.videoSpeed || 1).toFixed(props.videoSpeed % 1 ? 2 : 1)}x`)
const progressPercent = computed(() => {
  if (!props.totalDuration) return 0
  return Math.max(0, Math.min(100, (props.currentTime / props.totalDuration) * 100))
})
const scenes = computed(() => {
  let cursor = 0
  return props.storyboards.map((sb, index) => {
    const duration = Number(props.durations[index] || sb.duration || 5)
    const status = !sb.thumbnailUrl && !sb.selected_image_url ? 'missing-image'
      : sb.sync_status && sb.sync_status !== 'synced' ? 'sync'
        : sb.quality_status === 'failed' ? 'failed'
          : 'ok'
    const labels: Record<string, string> = {
      ok: '正常',
      sync: '待同步',
      failed: '失败',
      'missing-image': '缺图',
    }
    const item = {
      id: sb.id,
      index,
      start: cursor,
      duration,
      thumb: sb.thumbnailUrl || sb.selected_image_url || '',
      status,
      statusLabel: labels[status] || '正常',
    }
    cursor += duration
    return item
  })
})
const currentSceneLabel = computed(() => {
  if (!props.storyboards.length) return ''
  const index = Number(props.currentSceneIndex)
  if (!Number.isFinite(index) || index < 0) return ''
  return `S${String(index + 1).padStart(2, '0')}`
})

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number(seconds) || 0)
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function seekFromEvent(event: MouseEvent) {
  const rect = progressRef.value?.getBoundingClientRect()
  if (!rect || !props.totalDuration) return
  const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  emit('seek', pct * props.totalDuration)
}

function onKeydown(event: KeyboardEvent) {
  const key = String(event.key || '').toLowerCase()
  const handled = [' ', 'arrowleft', 'arrowright', 'm', 'f', ',', '.'].includes(key)
  if (!handled) return
  event.preventDefault()
  event.stopPropagation()
  if (key === ' ') emit('toggle-play')
  else if (key === 'arrowleft') emit('seek', Math.max(0, props.currentTime - 5))
  else if (key === 'arrowright') emit('seek', Math.min(props.totalDuration, props.currentTime + 5))
  else if (key === 'm') emit('mute-change', !props.muted)
  else if (key === 'f') toggleFullscreen()
  else if (key === ',') emit('seek', Math.max(0, props.currentTime - 1 / 30))
  else if (key === '.') emit('seek', Math.min(props.totalDuration, props.currentTime + 1 / 30))
}

function toggleFullscreen() {
  const el = rootRef.value
  if (!el) return
  if (document.fullscreenElement) document.exitFullscreen?.()
  else el.requestFullscreen?.()
  emit('fullscreen')
}
</script>

<style scoped>
.creative-player {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-rows: auto auto auto auto;
  gap: 10px;
  outline: none;
}

.creative-player:focus-visible {
  box-shadow: 0 0 0 3px var(--primary-soft);
  border-radius: var(--radius-lg);
}

.player-topbar,
.control-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.player-topbar {
  justify-content: space-between;
}

.mode-group {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-pill);
  background: var(--bg-surface);
}

.mode-pill {
  border: 0;
  background: transparent;
  color: var(--text-second);
  border-radius: var(--radius-pill);
  padding: 5px 11px;
  font-size: 12px;
  cursor: pointer;
}

.mode-pill.active {
  color: #fff;
  background: var(--primary);
}

.mode-pill:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.player-meta {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.player-meta span {
  padding: 4px 8px;
  border-radius: var(--radius-pill);
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
  line-height: 1;
}

.stage-shell {
  position: relative;
  width: 100%;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #05070d;
  border: 1px solid var(--separator);
  border-radius: var(--radius-lg);
}

.stage-shell :deep(video),
.stage-shell :deep(canvas) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.big-play {
  position: absolute;
  inset: auto;
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 50%;
  color: #fff;
  background: rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(10px);
  opacity: 0;
  transform: scale(0.96);
  transition: opacity 0.18s var(--ease-apple), transform 0.18s var(--ease-apple);
  cursor: pointer;
}

.stage-shell:hover .big-play {
  opacity: 1;
  transform: scale(1);
}

.stage-state {
  position: absolute;
  inset: auto 16px 16px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-pill);
  color: #fff;
  background: rgba(0, 0, 0, 0.56);
  backdrop-filter: blur(10px);
  font-size: 13px;
}

.stage-state.error {
  background: rgba(255, 59, 48, 0.82);
}

.state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary);
  animation: pulse 1s ease-in-out infinite alternate;
}

@keyframes pulse {
  to { transform: scale(1.7); opacity: 0.45; }
}

.control-bar {
  padding: 8px 10px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}

.icon-button {
  flex: 0 0 auto;
}

.text-button {
  flex: 0 0 auto;
  font-size: 12px;
}

.time-code {
  flex: 0 0 auto;
  min-width: 98px;
  color: var(--text-second);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.scrub-bar {
  position: relative;
  flex: 1;
  height: 8px;
  min-width: 120px;
  border-radius: 999px;
  background: var(--separator);
  cursor: pointer;
}

.scrub-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
}

.scrub-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.22);
  transform: translate(-50%, -50%);
}

.speed-select {
  width: 92px;
}

.volume-slider {
  width: 86px;
}

.scene-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0 6px;
}

.scene-chip {
  flex: 0 0 150px;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 7px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  color: var(--text);
  background: var(--bg-surface);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s var(--ease-apple), background 0.18s var(--ease-apple);
}

.scene-chip.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.scene-chip.warning {
  border-color: rgba(255, 159, 10, 0.42);
}

.scene-thumb {
  width: 52px;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: var(--bg-base);
  color: var(--text-muted);
}

.scene-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scene-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.scene-copy strong {
  color: var(--text);
  font-size: 12px;
  line-height: 1;
}

.scene-copy small {
  overflow: hidden;
  color: var(--text-second);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .player-topbar,
  .control-bar {
    flex-wrap: wrap;
  }
  .volume-slider {
    display: none;
  }
}
</style>
