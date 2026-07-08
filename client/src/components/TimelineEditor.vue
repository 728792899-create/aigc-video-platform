<template>
  <div class="tl-editor">
    <!-- 刻度尺 -->
    <div class="tl-ruler" ref="rulerRef" @click="onRulerClick">
      <div v-for="tick in ticks" :key="tick.t" class="tl-tick" :style="{ left: tick.pct + '%' }">
        <span class="tl-tick-label">{{ tick.label }}</span>
      </div>
      <!-- 播放头 -->
      <div class="tl-playhead" :style="{ left: playheadPct + '%' }"></div>
    </div>
    <!-- 比例色块轨道 -->
    <div class="tl-track" ref="trackRef">
      <div
        v-for="(seg, i) in segments"
        :key="seg.id"
        class="tl-clip"
        :class="{ active: i === activeIndex, locked: seg.locked }"
        :style="{ width: seg.pct + '%' }"
        @click="seekToClip(seg)"
        :title="seg.locked ? `${$t('task.scene')} ${i + 1} · ${seg.duration.toFixed(1)}s · ${$t('preview.durationLockedByAudio')}` : `${$t('task.scene')} ${i + 1} · ${seg.duration.toFixed(1)}s`"
      >
        <img v-if="seg.thumb" :src="seg.thumb" class="tl-thumb" />
        <div class="tl-clip-info">
          <span class="tl-clip-num">{{ i + 1 }}</span>
          <span class="tl-clip-dur">{{ seg.locked ? '🔊' : '' }}{{ seg.duration.toFixed(1) }}s</span>
        </div>
        <!-- 右缘拖拽手柄：调整时长（有配音时锁定，时长由音频决定） -->
        <div v-if="!seg.locked" class="tl-handle" @mousedown.stop="startResize($event, seg)"></div>
      </div>
      <div class="tl-playhead tl-playhead-track" :style="{ left: playheadPct + '%' }"></div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  storyboards: { type: Array, default: () => [] },
  // ④ 有效时长（父级 effectiveDuration：有配音=真实音频+留白，无配音=设定 duration）。
  //   缺省回退到 storyboards 自身 duration，保证独立使用时不报错。
  durations: { type: Array, default: () => [] },
  currentTime: { type: Number, default: 0 },
  totalDuration: { type: Number, default: 0 },
})
const emit = defineEmits(['seek', 'update-duration'])

const rulerRef = ref(null)
const trackRef = ref(null)

// 取第 i 个分镜的有效时长：优先父级传入的 durations，回退自身 duration
function durAt(i) {
  const d = props.durations[i]
  if (typeof d === 'number' && d > 0) return d
  return (props.storyboards[i] && props.storyboards[i].duration) || 3
}
// 该分镜是否锁定时长（有配音=时长由音频决定，禁止手动拖拽，所见即所得）
function isLocked(i) {
  const sb = props.storyboards[i]
  return !!(sb && sb.audio_url && !sb.no_voice)
}

const total = computed(() => props.totalDuration || props.storyboards.reduce((s, _x, i) => s + durAt(i), 0) || 1)

const segments = computed(() => {
  let acc = 0
  return props.storyboards.map((sb, i) => {
    const dur = durAt(i)
    const seg = { id: sb.id, index: i, duration: dur, locked: isLocked(i), start: acc, pct: (dur / total.value) * 100, thumb: sb.thumbnailUrl }
    acc += dur
    return seg
  })
})

const activeIndex = computed(() => {
  let acc = 0
  for (let i = 0; i < props.storyboards.length; i++) {
    const dur = durAt(i)
    if (props.currentTime < acc + dur) return i
    acc += dur
  }
  return props.storyboards.length - 1
})

const playheadPct = computed(() => Math.min(100, (props.currentTime / total.value) * 100))

// 刻度：每 ~1/6 总时长一个，至少 1s 取整
const ticks = computed(() => {
  const out = []
  const step = Math.max(1, Math.round(total.value / 6))
  for (let t = 0; t <= total.value; t += step) {
    out.push({ t, pct: (t / total.value) * 100, label: `${t}s` })
  }
  return out
})

function onRulerClick(e) {
  const rect = rulerRef.value.getBoundingClientRect()
  const pct = (e.clientX - rect.left) / rect.width
  emit('seek', Math.max(0, pct * total.value))
}

function seekToClip(seg) {
  emit('seek', seg.start + 0.01)
}

// 拖拽右缘改时长（仅无配音分镜；有配音时长由音频决定，已隐藏手柄）
let resizing = null
function startResize(e, seg) {
  if (seg.locked) return
  resizing = { seg, startX: e.clientX, startDur: seg.duration, trackWidth: trackRef.value.offsetWidth }
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', endResize)
}
function onResize(e) {
  if (!resizing) return
  const dx = e.clientX - resizing.startX
  const secPerPx = total.value / resizing.trackWidth
  let newDur = resizing.startDur + dx * secPerPx
  newDur = Math.round(Math.min(60, Math.max(1, newDur)) * 10) / 10
  emit('update-duration', { id: resizing.seg.id, duration: newDur, preview: true })
}
function endResize() {
  if (resizing) emit('update-duration', { id: resizing.seg.id, duration: undefined, commit: true })
  resizing = null
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', endResize)
}
</script>

<style scoped>
.tl-editor { background: var(--bg-base); border: 1px solid var(--separator); border-radius: var(--radius-md); padding: 12px; user-select: none; }
.tl-ruler { position: relative; height: 22px; margin-bottom: 6px; cursor: pointer; border-bottom: 1px solid var(--separator); }
.tl-tick { position: absolute; top: 0; height: 100%; border-left: 1px solid var(--separator); }
.tl-tick-label { position: absolute; left: 3px; top: 1px; font-size: 10px; color: var(--text-muted, #999); white-space: nowrap; }
.tl-track { position: relative; display: flex; gap: 2px; height: 64px; }
.tl-clip {
  position: relative; min-width: 24px; height: 100%; border-radius: 6px; overflow: hidden;
  background: var(--bg-surface); border: 2px solid var(--separator); cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s; flex-shrink: 0;
}
.tl-clip.active { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-soft); }
.tl-clip:hover { border-color: var(--primary); }
.tl-clip.locked { cursor: default; }
.tl-clip.locked .tl-clip-dur { background: rgba(0,122,255,0.55); }
.tl-thumb { width: 100%; height: 100%; object-fit: cover; opacity: 0.75; }
.tl-clip-info { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; padding: 3px 5px; pointer-events: none; }
.tl-clip-num { font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.tl-clip-dur { align-self: flex-end; font-size: 10px; color: #fff; background: rgba(0,0,0,0.5); border-radius: 4px; padding: 0 4px; }
.tl-handle { position: absolute; top: 0; right: 0; width: 8px; height: 100%; cursor: ew-resize; background: linear-gradient(90deg, transparent, rgba(0,122,255,0.35)); }
.tl-handle:hover { background: var(--primary); }
.tl-playhead { position: absolute; top: 0; width: 2px; height: 100%; background: #ff3b30; pointer-events: none; z-index: 5; }
.tl-playhead::before { content: ''; position: absolute; top: -4px; left: -4px; border: 5px solid transparent; border-top-color: #ff3b30; }
.tl-playhead-track::before { display: none; }
</style>

