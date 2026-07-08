<template>
  <div class="preview-page preview-grid">
      <WorkbenchGuide
        class="preview-guide"
        :guide="workbenchStatus"
        :repairing="repairingWorkbench"
        title="成片工作台"
        @refresh="loadWorkbenchStatus"
        @repair="handleWorkbenchRepair"
        @primary="handleGuidePrimary"
      />
      <div class="export-action-panel">
        <div class="export-action-copy">
          <h3>导出与保存</h3>
          <p>导出后会保存到成片库，默认目录为 <code>{{ exportLibraryDisplayPath }}</code>，播放地址规则为 <code>/uploads/videos/...</code>。</p>
          <p v-if="exportDefaultCopyPath">当前默认还会复制一份到 <code>{{ exportDefaultCopyPath }}</code>。</p>
          <p v-if="isLongProject">当前是长视频项目，系统会按章节分段合成，完成后自动拼接成一个成片。</p>
        </div>
        <div class="export-action-controls">
          <el-button type="primary" class="export-btn" @click="handleExport" :loading="exporting">
            {{ $t('preview.exportVideo') }}
          </el-button>
          <el-button plain @click="goLibrary">打开成片库</el-button>
        </div>
        <div v-if="exportTaskId || exportResult || exportError" class="export-status-card" :class="exportStatusClass">
          <div class="export-status-head">
            <strong>{{ exportStatusTitle }}</strong>
            <el-tag v-if="exportTaskId && exporting" size="small" effect="plain">Task {{ shortTaskId }}</el-tag>
          </div>
          <el-progress
            v-if="exporting"
            :percentage="exportProgress"
            :stroke-width="10"
            status="success"
          />
          <p>{{ exportStatusText }}</p>
          <div v-if="exportResult" class="export-location">
            <span>成片库位置</span>
            <code>{{ exportResult.file_url || exportResult.file_path }}</code>
            <span v-if="exportResult.library_file_path">本机成片库文件</span>
            <code v-if="exportResult.library_file_path">{{ exportResult.library_file_path }}</code>
            <span v-if="exportResult.external_file_path">自定义导出副本</span>
            <code v-if="exportResult.external_file_path">{{ exportResult.external_file_path }}</code>
            <span v-if="exportResult.external_copy_status === 'error'">自定义目录复制失败</span>
            <code v-if="exportResult.external_copy_status === 'error'">{{ exportResult.external_copy_error || '未知错误' }}</code>
          </div>
          <div v-if="exportResult" class="export-status-actions">
            <el-button size="small" type="primary" plain @click="playExportedVideo">播放成片</el-button>
            <el-button size="small" @click="goLibrary">成片库</el-button>
            <el-button size="small" @click="downloadExportedVideo">下载</el-button>
          </div>
        </div>
      </div>
      <div class="player-section">
        <CreativeVideoPlayer
          :mode="playerMode"
          :video-url="projectVideoUrl"
          :storyboards="storyboards"
          :durations="timelineDurations"
          :current-time="playerCurrentTime"
          :current-scene-index="playerCurrentSceneIndex"
          :total-duration="playerTotalDuration"
          :ratio="ratio"
          :video-speed="videoSpeed"
          :subtitle-enabled="burnSubtitle"
          :is-playing="playerPlaying"
          :muted="playerMuted"
          :volume="playerVolume"
          :sync-summary="syncSummary"
          :loading="exporting || previewing || syncingAssets"
          :loading-text="exportMessage"
          @mode-change="handlePlayerModeChange"
          @toggle-play="handlePlayerToggle"
          @seek="handlePlayerSeek"
          @scene-seek="handlePlayerSceneSeek"
          @speed-change="handlePlayerSpeedChange"
          @toggle-subtitle="handlePlayerSubtitleToggle"
          @mute-change="handlePlayerMuteChange"
          @volume-change="handlePlayerVolumeChange"
          @snapshot="handlePlayerSnapshot"
        >
          <template #stage>
            <video
              v-show="playMode === 'video'"
              ref="videoRef"
              class="preview-video"
              :src="projectVideoUrl"
              playsinline
              @loadedmetadata="onVideoLoadedMetadata"
              @timeupdate="onVideoTimeUpdate"
              @seeked="onVideoTimeUpdate"
              @play="isRealVideoPlaying = true"
              @pause="isRealVideoPlaying = false"
              @ended="isRealVideoPlaying = false"
            ></video>
            <canvas v-show="playMode === 'canvas'" ref="canvasRef" class="preview-canvas"></canvas>
          </template>
        </CreativeVideoPlayer>
        <div v-if="staleExport" class="stale-export-alert">
          <div class="stale-export-copy">
            <strong>当前成片已过期</strong>
            <p>{{ exportFreshnessReason }}</p>
          </div>
          <div class="stale-export-actions">
            <el-button size="small" plain @click="playStaleExport">播放旧成片</el-button>
            <el-button size="small" type="primary" @click="handleExport">重新导出</el-button>
            <el-button size="small" text @click="goLibrary">成片库</el-button>
          </div>
        </div>
      </div>
      <div class="side-panel">
        <h3>{{ $t('preview.projectInfo') }}</h3>
        <div class="info-item">
          <span>{{ $t('preview.totalDuration') }}</span>
          <span class="info-value">{{ formatTime(totalDuration) }}</span>
        </div>
        <div class="info-item">
          <span>{{ $t('preview.sceneCount') }}</span>
          <span class="info-value">{{ storyboards.length }}</span>
        </div>
        <div class="info-item">
          <span>{{ $t('preview.originalDuration') }}</span>
          <span class="info-value">{{ formatTime(originalTotalDuration) }}</span>
        </div>
        <div v-if="isLongProject" class="long-video-panel">
          <strong>长视频模式</strong>
          <p>{{ chapterSummary.length || 1 }} 个章节 · 导出时自动分段合成再拼接。</p>
          <p>长视频默认使用软字幕文件，避免整片烧录字幕导致超时。</p>
          <p v-if="targetDurationWarning" class="duration-warning">{{ targetDurationWarning }}</p>
        </div>

        <el-divider class="sp-divider" />
        <h3>{{ $t('preview.exportSettings') }}</h3>
        <div class="setting-block">
          <label>{{ $t('preview.videoSpeed') }}</label>
          <el-select v-model="videoSpeed" size="small" @change="onVideoSpeedChange">
            <el-option v-for="s in videoSpeedOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
          <p class="setting-hint">{{ $t('preview.videoSpeedHint') }}</p>
        </div>
        <div class="setting-block">
          <label>{{ $t('preview.aspectRatio') }}</label>
          <el-select v-model="ratio" size="small" @change="applyRatio">
            <el-option v-for="r in ratioOptions" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
          <p class="setting-hint">{{ $t('preview.aspectRatioHint') }}</p>
        </div>
        <div class="setting-block">
          <label>{{ $t('preview.videoSource') }}</label>
          <el-select v-model="videoMode" size="small">
            <el-option :label="$t('preview.videoModeStatic')" value="static" />
            <el-option v-for="v in t2vOptions" :key="v.key" :label="v.label" :value="v.key" />
          </el-select>
          <p v-if="videoMode !== 'static'" class="setting-hint">{{ $t('preview.t2vHint') }}</p>
        </div>
        <div class="setting-block">
          <label>{{ $t('preview.preset') }}</label>
          <el-select v-model="selectedPreset" :placeholder="$t('preview.presetPlaceholder')" size="small" clearable @change="applyPreset">
            <el-option v-for="p in presets" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </div>
        <div class="setting-block switch-row">
          <span>{{ $t('preview.hardSubtitle') }}</span>
          <el-switch v-model="burnSubtitle" />
        </div>
        <p class="setting-hint">{{ burnSubtitle ? $t('preview.subtitleOnHint') : $t('preview.subtitleOffHint') }}</p>

        <div v-if="burnSubtitle" class="setting-block switch-row">
          <span>{{ $t('preview.karaoke') }}</span>
          <el-switch v-model="karaoke" />
        </div>
        <p v-if="burnSubtitle" class="setting-hint">{{ karaoke ? $t('preview.karaokeOnHint') : $t('preview.karaokeOffHint') }}</p>

        <div v-if="burnSubtitle && !karaoke" class="setting-block">
          <label>{{ $t('preview.subtitleEffect') }}</label>
          <el-select v-model="subtitleEffect" size="small">
            <el-option v-for="fx in subtitleEffectOptions" :key="fx.value" :label="fx.label" :value="fx.value" />
          </el-select>
          <p class="setting-hint">{{ $t('preview.subtitleEffectHint') }}</p>
        </div>

        <el-divider class="sp-divider" />
        <div class="snapshot-head">
          <h3>{{ $t('preview.snapshot') }}</h3>
          <el-button size="small" text type="primary" @click="saveSnapshot">{{ $t('preview.saveCurrent') }}</el-button>
        </div>
        <div v-if="!snapshots.length" class="snap-empty">{{ $t('preview.noSnapshot') }}</div>
        <div v-for="s in snapshots" :key="s.id" class="snap-item">
          <div class="snap-info">
            <span class="snap-label">{{ s.label }}</span>
            <span class="snap-meta">{{ $t('preview.snapSceneCount', { n: s.storyboard_count }) }} · {{ fmtSnapTime(s.created_at) }}</span>
          </div>
          <div class="snap-btns">
            <el-button size="small" text @click="doRestore(s)">{{ $t('preview.restore') }}</el-button>
            <el-button size="small" text type="danger" @click="doDeleteSnap(s)">{{ $t('preview.del') }}</el-button>
          </div>
        </div>

        <el-button class="apply-voice-btn" @click="applyVoice" :loading="applyingVoice" plain>
          🔊 {{ $t('preview.applyVoice') }}
        </el-button>
        <p class="setting-hint">{{ $t('preview.applyVoiceHint') }}</p>

        <el-button class="preview-btn" @click="doQuickPreview" :loading="previewing" plain>
          ⚡ {{ $t('preview.quickPreview') }}
        </el-button>
        <p class="setting-hint">{{ $t('preview.quickPreviewHint') }}</p>
      </div>
    <ProjectStageFooter
      class="preview-stage-footer"
      current-stage="视频预览"
      :ready="previewStageReady"
      :blocked-reason="previewStageBlockedReason"
      action-label="查看成片库"
      ready-hint="可以在右侧预览或导出成片，导出完成后进入成片库查看结果。"
      @go-next="goLibrary"
    />
    <div v-if="exporting || previewing || syncingAssets" class="export-progress">
      <el-progress :percentage="exportProgress" :stroke-width="14" :text-inside="true" status="success" />
      <div class="export-message">{{ exportMessage }}</div>
    </div>
    <div class="timeline-section">
      <div class="timeline-toolbar">
        <h4 class="timeline-title">{{ $t('preview.timeline') }}</h4>
        <div class="batch-bar">
          <span v-if="syncSummary" class="sync-summary">{{ syncSummary }}</span>
          <el-button size="small" :loading="syncingAssets" @click="syncTimelineAssets">{{ $t('preview.syncAssets') }}</el-button>
          <el-button size="small" @click="doSuggestDuration">{{ $t('preview.suggestDuration') }}</el-button>
          <el-popover placement="bottom" :width="280" trigger="click">
            <template #reference>
              <el-button size="small" type="primary" plain>{{ $t('preview.batchSet') }}</el-button>
            </template>
            <div class="batch-pop">
              <div class="batch-field">
                <span>{{ $t('preview.motion') }}</span>
                <el-select v-model="batchForm.motion" :placeholder="$t('preview.unchanged')" clearable size="small">
                  <el-option v-for="m in motionOptions" :key="m.key" :label="m.label" :value="m.key" />
                </el-select>
              </div>
              <div class="batch-field">
                <span>{{ $t('preview.transition') }}</span>
                <el-select v-model="batchForm.transition" :placeholder="$t('preview.unchanged')" clearable size="small">
                  <el-option v-for="t in transitionOptions" :key="t.key" :label="t.label" :value="t.key" />
                </el-select>
              </div>
              <div class="batch-field">
                <span>{{ $t('preview.voice') }}</span>
                <el-select v-model="batchForm.voice" :placeholder="$t('preview.unchanged')" clearable size="small">
                  <el-option v-for="v in voiceOptions" :key="v.value" :label="v.label" :value="v.value" />
                </el-select>
              </div>
              <el-button size="small" type="primary" style="width:100%; margin-top:8px" @click="applyBatch">{{ $t('preview.applyToAll') }}</el-button>
            </div>
          </el-popover>
        </div>
      </div>
      <TimelineEditor
        :storyboards="storyboards"
        :durations="timelineDurations"
        :current-time="currentTime"
        :total-duration="totalDuration"
        @seek="onTimelineSeek"
        @update-duration="onTimelineDuration"
      />
      <draggable
        v-model="storyboards"
        item-key="id"
        class="timeline-track"
        @end="onDragEnd"
      >
        <template #item="{ element, index }">
          <div class="timeline-item-wrapper">
            <!-- 转场选择器（第 2 个分镜开始显示） -->
            <div v-if="index > 0" class="transition-selector">
              <el-select
                v-model="element.transition"
                size="small"
                :placeholder="$t('preview.transition')"
                @change="updateTransition(element)"
              >
                <el-option v-for="t in transitionOptions" :key="t.key" :label="t.label" :value="t.key" />
              </el-select>
            </div>
            <div class="timeline-card" :class="{ active: currentSceneIndex === index }">
              <div class="card-thumbnail" @click="openImagePicker(element, index)" :title="$t('preview.clickToPickImage')">
                <img v-if="element.thumbnailUrl" :src="element.thumbnailUrl" alt="scene" />
                <div v-else class="placeholder-thumb">
                  <el-icon><Picture /></el-icon>
                  <span class="pick-hint">{{ $t('preview.pickImage') }}</span>
                </div>
                <div class="pick-overlay"><el-icon><Picture /></el-icon> {{ $t('preview.pickImage') }}</div>
              </div>
              <div class="card-info">
                <span class="scene-num">Scene {{ index + 1 }}</span>
                <span class="duration-label">{{ effectiveDuration(element).toFixed(1) }}s</span>
              </div>
            </div>
          </div>
        </template>
      </draggable>
    </div>

    <!-- ① 时间轴卡片选图弹窗 -->
    <el-dialog v-model="imgPicker.visible" :title="$t('preview.pickImageTitle', { n: imgPicker.sceneNo })" width="640px" append-to-body>
      <div v-loading="imgPicker.loading" class="img-picker-grid">
        <div v-if="!imgPicker.loading && imgPicker.images.length === 0" class="img-picker-empty">
          {{ $t('preview.noGeneratedImage') }}
        </div>
        <div
          v-for="img in imgPicker.images"
          :key="img.id"
          class="img-picker-cell"
          :class="{ chosen: imgPicker.selectedId === img.id }"
          @click="pickImage(img)"
        >
          <img :src="img.url" :alt="'img-' + img.id" />
          <div v-if="imgPicker.selectedId === img.id" class="img-picker-badge">✓</div>
        </div>
      </div>
    </el-dialog>

    <!-- v1.7 导出设置弹窗：分辨率/格式/帧率/画质/平台预设，全功能解锁无水印 -->
    <ExportDialog
      v-model="exportDialogVisible"
      :initial-ratio="ratio"
      :initial-fps="presetFps"
      :export-location="exportLocation"
      @confirm="onExportConfirm"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Picture } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
import TimelineEditor from '../components/TimelineEditor.vue'
import ExportDialog from '../components/ExportDialog.vue'
import WorkbenchGuide from '../components/WorkbenchGuide.vue'
import CreativeVideoPlayer from '../components/CreativeVideoPlayer.vue'
import ProjectStageFooter from '../components/ProjectStageFooter.vue'
import api from '../api'
import { trackTask } from '../api/tasks'
import { mediaUrl } from '../api/config'
import { listPresets, listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot, batchUpdateStoryboards, suggestDuration, projectExports, getProjectTimeline, getExportLocation } from '../api/features'
import { getProviders } from '../api/providers'
import { getWorkbenchStatus, repairWorkbench } from '../api/projects'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const projectId = route.params.id

// 任务进度跟踪的停止函数（路由切走/组件卸载时调用，关闭 SSE 连接，防泄漏）
let stopTracking = null

const canvasRef = ref(null)
const videoRef = ref(null)
const progressRef = ref(null)
// 预览播放模式：'video' = 播真实合成成片（mp4，与成片库一致，动态）；'canvas' = 草稿模拟（还没成片时）
const playMode = ref('canvas')
const projectVideoUrl = ref('')   // 当前项目最新成片的可播放 URL（绝对）
const projectVideoBakedSpeed = ref(null) // 已知该成片文件自身烘焙的倍速；未知时用播放器模拟当前倍速
const freshExport = ref(null)
const staleExport = ref(null)
const activeVideoSource = ref('none') // none | fresh | stale | preview
const exportFreshnessReason = ref('')
const realVideoDuration = ref(0)
const realVideoCurrentTime = ref(0)
const isRealVideoPlaying = ref(false)
const playerMuted = ref(false)
const playerVolume = ref(1)
const project = ref(null)
const storyboards = ref([])
const isPlaying = ref(false)
const currentTime = ref(0)
const currentSceneIndex = ref(0)
const exporting = ref(false)
const exportProgress = ref(0)
const exportMessage = ref('')
const exportDialogVisible = ref(false) // v1.7 导出设置弹窗
const exportTaskId = ref('')
const exportResult = ref(null)
const exportError = ref('')
const exportLocation = ref({
  library_directory: '',
  library_url_rule: '/uploads/videos/...',
  default_directory: '',
  has_custom_default: false,
})
// 当前预设里的帧率（用于初始化导出弹窗的帧率默认值）
const presetFps = computed(() => {
  const p = presets.value.find((x) => x.id === selectedPreset.value)
  if (!p) return 30
  try {
    const cfg = typeof p.config === 'string' ? JSON.parse(p.config) : p.config
    return cfg?.fps || 30
  } catch { return 30 }
})
// ② 应用当前配音：一键检测并重生成「音色变了/有台词没配音」的分镜，让预览/导出音频立即生效
const applyingVoice = ref(false)
// ⑤ 预设 / ② 字幕开关 / ⑥ 快照
const presets = ref([])
const selectedPreset = ref('')
const burnSubtitle = ref(true)
const karaoke = ref(false)
const subtitleEffect = ref('none')
const videoSpeed = ref(1)
const timeline = ref(null)
const videoSpeedOptions = [
  { value: 0.5, label: '0.5x' },
  { value: 0.75, label: '0.75x' },
  { value: 1, label: '1.0x' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2.0x' },
]
const subtitleEffectOptions = [
  { value: 'none', label: '无特效（静态）' },
  { value: 'fade', label: '淡入淡出' },
  { value: 'floatup', label: '上浮淡入' },
  { value: 'slidein', label: '左滑进入' },
  { value: 'popzoom', label: '放大弹出' },
  { value: 'typewriter', label: '轻快淡现' },
]
const snapshots = ref([])
const previewing = ref(false) // 快速真合成预览进行中
const syncingAssets = ref(false)
const workbenchStatus = ref(null)
const repairingWorkbench = ref(false)
// ⑨ 真实文生视频画面来源（static = 静图运镜；其余为 t2v provider key，可含 __model）
const videoMode = ref('static')
const t2vOptions = ref([])
// ③ 画幅比例：从项目读取，预览 canvas 与导出共用同一比例
const RATIO_MAP = {
  '16:9': { w: 1280, h: 720 },
  '9:16': { w: 720, h: 1280 },
  '1:1': { w: 1000, h: 1000 },
  '4:5': { w: 864, h: 1080 },
  '4:3': { w: 1024, h: 768 },
}
const ratio = ref('16:9')
const ratioOptions = [
  { value: '16:9', label: '16:9 (横屏)' },
  { value: '9:16', label: '9:16 (竖屏)' },
  { value: '1:1', label: '1:1 (方形)' },
  { value: '4:5', label: '4:5 (竖图)' },
  { value: '4:3', label: '4:3' },
]
// ② 即时应用语音修改：记录哪些分镜的配音设置已改但音频还没跟上
// （仅在 Audio 页实现，此处不需要）
// ① 时间轴卡片选图弹窗
const imgPicker = ref({ visible: false, sbId: null, sceneNo: 0, images: [], loading: false, selectedId: null })
const aspectRatioCss = computed(() => {
  const m = RATIO_MAP[ratio.value] || RATIO_MAP['16:9']
  return `${m.w} / ${m.h}`
})
let animationFrame = null
let lastTimestamp = null
const imageCache = {}
// v1.6.8：分镜 AI 视频缓存（videoUrl → HTMLVideoElement）。预览时优先用真实视频帧绘制，
// 取代静态缩略图，让预览画面与导出成片的动效一致。
const videoCache = {}
// ④ 预览音频同步：单个 Audio 元素，按当前分镜切换 src 并对齐播放进度
let previewAudio = null
let audioSceneIdx = -1

// ④ 音画同步基准（与后端 video.js:imageAudioToSegment 严格对齐）：
//   有配音的分镜，有效时长 = 真实音频时长 + 尾镜留白；无配音才用设定 duration。
//   预览页所有时序计算（总时长/分镜起点/字幕进度/运镜进度/音频对齐）只认这一个来源，
//   消除「画面按估算 duration、音频按真实时长」导致的音字逐段漂移。
const PREVIEW_TAIL = 0.12 // 对齐后端 pacing.tightTail 默认值
const DEFAULT_DUR = 5     // 对齐后端无配音回退（Number(duration) || 5）

function effectiveDuration(scene) {
  if (!scene) return DEFAULT_DUR
  const fromTimeline = timelineScene(scene)
  if (fromTimeline) return fromTimeline.duration_ms / 1000
  if (scene.audioUrl && scene._audioDur > 0) {
    return Math.round(((scene._audioDur + PREVIEW_TAIL) / videoSpeed.value) * 100) / 100
  }
  return (scene.duration || DEFAULT_DUR) / videoSpeed.value
}

function originalEffectiveDuration(scene) {
  if (!scene) return DEFAULT_DUR
  const fromTimeline = timelineScene(scene)
  if (fromTimeline) return fromTimeline.original_duration_ms / 1000
  if (scene.audioUrl && scene._audioDur > 0) return Math.round((scene._audioDur + PREVIEW_TAIL) * 100) / 100
  return scene.duration || DEFAULT_DUR
}

function timelineScene(scene) {
  if (!scene || !timeline.value?.scenes) return null
  return timeline.value.scenes.find((s) => Number(s.storyboard_id) === Number(scene.id)) || null
}

// 前端无 ffprobe，用浏览器解码配音 metadata 取真实时长，写回 scene._audioDur 触发时长重算。
// 失败（CORS/404）静默回退到设定 duration，不阻塞预览。
function measureAudioDuration(scene) {
  if (!scene || !scene.audioUrl) return
  const a = new Audio()
  a.preload = 'metadata'
  a.onloadedmetadata = () => {
    if (isFinite(a.duration) && a.duration > 0) {
      scene._audioDur = a.duration
      drawFrame()
    }
  }
  a.onerror = () => {}
  a.src = scene.audioUrl
}

function sceneStartTime(idx) {
  let t = 0
  for (let i = 0; i < idx; i++) t += effectiveDuration(storyboards.value[i])
  return t
}

// 根据当前播放时间，让配音音频跟随当前分镜
function syncAudio() {
  if (!isPlaying.value) return
  const idx = getSceneAtTime(currentTime.value)
  const scene = storyboards.value[idx]
  if (!previewAudio) previewAudio = new Audio()
  if (!scene || !scene.audioUrl) {
    if (audioSceneIdx !== idx) { previewAudio.pause(); audioSceneIdx = idx }
    return
  }
  const localOffset = currentTime.value - sceneStartTime(idx)
  const sourceOffset = localOffset * videoSpeed.value
  if (audioSceneIdx !== idx) {
    // 切换到新分镜：换源 + 从分镜内偏移处播放
    audioSceneIdx = idx
    previewAudio.src = scene.audioUrl
    previewAudio.playbackRate = videoSpeed.value
    previewAudio.volume = playerVolume.value
    previewAudio.muted = playerMuted.value
    previewAudio.currentTime = Math.max(0, sourceOffset)
    previewAudio.play().catch(() => {})
  } else if (previewAudio.paused && !previewAudio.ended) {
    // 仅在「暂停但未播完」时续播；音频已播完(画面比音频长)时保持静音，不从头重播
    previewAudio.play().catch(() => {})
  }
}

function stopAudio() {
  if (previewAudio) { previewAudio.pause(); }
  audioSceneIdx = -1
}

// 转场选项（与后端 /api/video/transitions 对齐）
const transitionOptions = computed(() => [
  { key: 'none', label: t('preview.transNone') },
  { key: 'fade', label: t('preview.transFade') },
  { key: 'slide', label: t('preview.transSlide') },
  { key: 'zoom', label: t('preview.transZoom') },
  { key: 'wipe', label: t('preview.transWipe') },
  { key: 'dissolve', label: t('preview.transDissolve') },
])

// ③ 批量操作的运镜/音色选项
const motionOptions = computed(() => [
  { key: 'none', label: t('preview.motionNone') },
  { key: 'kenburns_in', label: t('preview.motionKbIn') },
  { key: 'kenburns_out', label: t('preview.motionKbOut') },
  { key: 'zoom_in', label: t('preview.motionZoomIn') },
  { key: 'pan_left', label: t('preview.motionPanLeft') },
  { key: 'pan_right', label: t('preview.motionPanRight') },
])
const voiceOptions = computed(() => [
  { value: 'xiaoxiao', label: t('preview.voiceXiaoxiao') },
  { value: 'yunyang', label: t('preview.voiceYunyang') },
  { value: 'yunxi', label: t('preview.voiceYunxi') },
  { value: 'xiaomo', label: t('preview.voiceXiaomo') },
  { value: 'xiaohan', label: t('preview.voiceXiaohan') },
  { value: 'yunfeng', label: t('preview.voiceYunfeng') },
])
const batchForm = ref({ motion: '', transition: '', voice: '' })

async function updateTransition(element) {
  try {
    await api.put(`/storyboards/${element.id}`, {
      ...element,
      transition: element.transition,
    })
    ElMessage.success(t('preview.transitionSaved'))
  } catch (e) {
    ElMessage.error(t('preview.transitionSaveFailed'))
  }
}

const totalDuration = computed(() => {
  return storyboards.value.reduce((sum, s) => sum + effectiveDuration(s), 0)
})
const originalTotalDuration = computed(() => {
  if (timeline.value?.original_total_duration) return timeline.value.original_total_duration
  return storyboards.value.reduce((sum, s) => sum + originalEffectiveDuration(s), 0)
})
const syncSummary = computed(() => {
  const scenes = timeline.value?.scenes || []
  if (!scenes.length) return ''
  const voiceMissing = scenes.filter((s) => s.sync_status === 'voice_missing').length
  const subtitleFromDialog = scenes.filter((s) => s.sync_status === 'subtitle_from_dialog').length
  if (voiceMissing) return t('preview.syncVoiceMissing', { n: voiceMissing })
  if (subtitleFromDialog) return t('preview.syncSubtitleFromDialog', { n: subtitleFromDialog })
  return t('preview.syncOk')
})

const progressPercent = computed(() => {
  if (totalDuration.value === 0) return 0
  return (currentTime.value / totalDuration.value) * 100
})

// ④ 传给时间轴的有效时长（有配音=真实音频时长+留白，所见即所得）。
//   依赖 _audioDur，音频 metadata 加载后自动重算，时间轴宽度/数字同步刷新。
const timelineDurations = computed(() => storyboards.value.map(effectiveDuration))
const playerMode = computed(() => playMode.value === 'video' ? 'real-video' : 'draft-canvas')
const playerPlaying = computed(() => playMode.value === 'video' ? isRealVideoPlaying.value : isPlaying.value)
const canMapRealVideoToTimeline = computed(() => playMode.value === 'video' && activeVideoSource.value === 'fresh')
const playerCurrentTime = computed(() => playMode.value === 'video' ? realVideoCurrentTime.value : currentTime.value)
const playerTotalDuration = computed(() => {
  if (playMode.value !== 'video') return totalDuration.value
  return realVideoDuration.value || Number(freshExport.value?.duration || staleExport.value?.duration || 0)
})
const playerCurrentSceneIndex = computed(() => {
  if (playMode.value !== 'video') return currentSceneIndex.value
  return canMapRealVideoToTimeline.value ? currentSceneIndex.value : -1
})
const previewStageReady = computed(() => storyboards.value.length > 0)
const isLongProject = computed(() => originalTotalDuration.value >= 600 || storyboards.value.length >= 80)
const targetDurationWarning = computed(() => {
  const min = Number(project.value?.duration_min)
  if (!Number.isFinite(min) || min < 600) return ''
  if (originalTotalDuration.value >= min * 0.85) return ''
  return `当前真实时间轴约 ${formatTime(originalTotalDuration.value)}，低于项目目标下限 ${formatTime(min)}。建议回到脚本页扩写对白或重新生成后再导出。`
})
const chapterSummary = computed(() => {
  const map = new Map()
  storyboards.value.forEach((sb) => {
    const idx = Number(sb.chapter_index || 0)
    if (!idx) return
    if (!map.has(idx)) map.set(idx, { index: idx, title: sb.chapter_title || `第 ${idx} 章`, count: 0, duration: 0 })
    const item = map.get(idx)
    item.count += 1
    item.duration += originalEffectiveDuration(sb)
  })
  return [...map.values()].sort((a, b) => a.index - b.index)
})
const previewStageBlockedReason = computed(() => {
  if (!storyboards.value.length) return '请先完成文案分镜后再进入预览。'
  return '当前项目可以预览或导出。'
})
const shortTaskId = computed(() => exportTaskId.value ? exportTaskId.value.slice(0, 8) : '')
const exportStatusClass = computed(() => ({
  'is-running': exporting.value,
  'is-success': !!exportResult.value && !exporting.value,
  'is-error': !!exportError.value && !exporting.value,
}))
const exportStatusTitle = computed(() => {
  if (exporting.value) return '正在导出视频'
  if (exportResult.value) return '导出完成'
  if (exportError.value) return '导出失败'
  return '导出状态'
})
const exportStatusText = computed(() => {
  if (exporting.value) return exportMessage.value || '导出任务已提交，正在后台合成。'
  if (exportResult.value) {
    const duration = exportResult.value.duration ? `，时长 ${formatTime(exportResult.value.duration)}` : ''
    const chapters = exportResult.value.chapter_count ? `，${exportResult.value.chapter_count} 个章节` : ''
    const external = exportResult.value.external_copy_status === 'success' ? '，并已复制到自定义目录' : ''
    const externalError = exportResult.value.external_copy_status === 'error' ? '，但复制到自定义目录失败' : ''
    return `视频已保存到成片库${duration}${chapters}${external}${externalError}。`
  }
  if (exportError.value) return exportError.value
  return ''
})
const exportLibraryDisplayPath = computed(() => exportLocation.value?.library_directory || 'uploads/videos')
const exportDefaultCopyPath = computed(() => exportLocation.value?.default_directory || '')

function goLibrary() {
  router.push('/library')
}

function playExportedVideo() {
  if (!exportResult.value?.file_url) return
  freshExport.value = exportResult.value
  staleExport.value = null
  exportFreshnessReason.value = ''
  activateVideoExport(exportResult.value, {
    source: 'fresh',
    autoPlay: true,
    bakedSpeed: exportResult.value.video_speed || videoSpeed.value,
  })
}

function downloadExportedVideo() {
  if (!exportResult.value?.file_url) return
  const a = document.createElement('a')
  a.href = mediaUrl(exportResult.value.file_url)
  a.download = `project-${projectId}-export.mp4`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getSceneAtTime(time) {
  let elapsed = 0
  for (let i = 0; i < storyboards.value.length; i++) {
    const dur = effectiveDuration(storyboards.value[i])
    if (time < elapsed + dur) return i
    elapsed += dur
  }
  return storyboards.value.length - 1
}

function loadImage(url) {
  if (imageCache[url]) return Promise.resolve(imageCache[url])
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { imageCache[url] = img; resolve(img) }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// v1.6.8：加载分镜 AI 视频为隐藏 <video> 元素，作为 canvas 绘制帧源。
// muted + playsInline 保证可被 drawImage 取帧；不自动播放，由 drawFrame/seek 控制 currentTime。
function loadVideo(url) {
  if (videoCache[url]) return Promise.resolve(videoCache[url])
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.onloadeddata = () => { videoCache[url] = v; resolve(v) }
    v.onerror = () => resolve(null)
    v.src = url
  })
}

// 剥离字幕中的说话人标记（与后端 tts.stripSpeakerTags 对齐）：
// （旁白）/(小精灵)/【画外音】/[OS]/「说话人：」/行首独立词
function stripSpeakerTags(text) {
  let t = String(text || '')
  t = t.replace(/(^|[\n。！？；.!?;])\s*[（(【[][^）)】\]\n]{1,12}[）)】\]][:：]?\s*/g, '$1')
  t = t.replace(/^[^：:\n]{1,8}\s*[：:]\s*/gm, '')
  t = t.replace(/^\s*(旁白|画外音|独白|内心独白|内心|OS|V\.?O\.?)\s+/gim, '')
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

const SUBTITLE_MAX_CHARS = 15

function subtitleCharLength(text) {
  return [...String(text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')].length || [...String(text || '')].length
}

function cleanSubtitleSegment(text) {
  return String(text || '').trim().replace(/[，。；、,;]\s*$/, '').trim()
}

function splitSubtitleSegments(text, maxLen = SUBTITLE_MAX_CHARS) {
  const normalized = stripSpeakerTags(text).replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const segments = []
  let buffer = ''
  for (const ch of [...normalized]) {
    buffer += ch
    const hitPunctuation = /[，。！？；、,.!?;\n]/.test(ch)
    if (hitPunctuation || subtitleCharLength(buffer) >= maxLen) {
      const clean = cleanSubtitleSegment(buffer)
      if (clean) segments.push(clean)
      buffer = ''
    }
  }
  const tail = cleanSubtitleSegment(buffer)
  if (tail) segments.push(tail)
  return segments
}

function parseAudioWords(scene) {
  if (!scene?.audio_words) return null
  try {
    const words = typeof scene.audio_words === 'string' ? JSON.parse(scene.audio_words) : scene.audio_words
    return Array.isArray(words) && words.length ? words : null
  } catch {
    return null
  }
}

function subtitleSegmentsWithTiming(scene, sceneDuration) {
  const text = scene?.subtitle_text || scene?.dialog || ''
  const segments = splitSubtitleSegments(text)
  if (!segments.length) return []
  const fromTimeline = timelineScene(scene)
  const timingScale = fromTimeline?.original_duration_ms
    ? fromTimeline.duration_ms / fromTimeline.original_duration_ms
    : 1
  const words = parseAudioWords(scene)
  if (words?.length) {
    const result = []
    let wi = 0
    for (const segment of segments) {
      const targetChars = subtitleCharLength(segment)
      let consumed = 0
      const startWi = wi
      while (wi < words.length && consumed < targetChars) {
        consumed += subtitleCharLength(words[wi].part || words[wi].word || '')
        wi++
      }
      const slice = words.slice(startWi, Math.max(wi, startWi + 1))
      if (slice.length) {
        const first = slice[0]
        const last = slice[slice.length - 1]
        const start = Math.max(0, ((Number(first.start) || 0) / 1000) * timingScale)
        const end = ((Number(last.end) || Number(first.end) || 0) / 1000) * timingScale
        result.push({
          text: segment,
          start,
          end: Math.max(start + 0.1, end),
        })
      }
    }
    if (result.length) return result
  }

  const totalChars = segments.reduce((sum, item) => sum + subtitleCharLength(item), 0) || 1
  let cursor = 0
  return segments.map((segment) => {
    const duration = Math.max(0.8, (subtitleCharLength(segment) / totalChars) * sceneDuration)
    const item = { text: segment, start: cursor, end: Math.min(sceneDuration, cursor + duration) }
    cursor = item.end
    return item
  })
}

function currentSubtitleCue(scene, localOffset, sceneDuration) {
  const cues = subtitleSegmentsWithTiming(scene, sceneDuration)
  if (!cues.length) return null
  return cues.find((cue) => localOffset >= cue.start && localOffset < cue.end) || null
}

function drawFrame() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0a0a1a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const idx = getSceneAtTime(currentTime.value)
  currentSceneIndex.value = idx
  const scene = storyboards.value[idx]
  // v1.6.8：优先用 AI 视频帧绘制（与导出成片动效一致），无视频才回退静态缩略图 + 模拟运镜。
  let drawnVideo = false
  if (scene && scene.videoUrl && videoCache[scene.videoUrl]) {
    const vid = videoCache[scene.videoUrl]
    // 把全局播放进度映射到分镜内偏移，并对齐到视频时长（视频可能比分镜设定时长短/长）
    const localOffset = currentTime.value - sceneStartTime(idx)
    const sourceOffset = localOffset * videoSpeed.value
    const vd = vid.duration || (scene.duration || 5)
    const target = Math.max(0, Math.min(vd - 0.05, sourceOffset))
    vid.playbackRate = videoSpeed.value
    // 播放中让视频自走（流畅），暂停/seek 时按帧定位（精确）
    if (isPlaying.value) {
      if (vid.paused) { try { vid.currentTime = target; vid.play().catch(() => {}) } catch {} }
      // 偏差过大时纠偏（切镜/跳转后），小偏差交给视频自身播放避免抖动
      else if (Math.abs(vid.currentTime - target) > 0.35) { try { vid.currentTime = target } catch {} }
    } else {
      if (!vid.paused) { try { vid.pause() } catch {} }
      try { vid.currentTime = target } catch {}
    }
    if (vid.readyState >= 2 && vid.videoWidth) {
      const scale = Math.min(canvas.width / vid.videoWidth, canvas.height / vid.videoHeight)
      const w = vid.videoWidth * scale
      const h = vid.videoHeight * scale
      ctx.drawImage(vid, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
      drawnVideo = true
    }
  }
  if (!drawnVideo && scene && scene.thumbnailUrl) {
    const img = imageCache[scene.thumbnailUrl]
    if (img) {
      // v1.6.8：模拟后端 Ken Burns 运镜（与成片 zoompan 动效一致），告别预览"死图"
      // v1.6.12：分镜 motion 为空时回退到 preset 的全局 motion（与合成时对齐），
      //          再无 preset 则用 'none' 静止。让预览所见即所得。
      const cfg = presetConfig()
      const fallbackMotion = (cfg && cfg.motion) || 'none'
      const motion = (scene.motion || fallbackMotion).toLowerCase().replace(/[_\s]/g, '-')
      const hasMotion = motion === 'zoom-in' || motion === 'zoom-out' || motion === 'pan-right' || motion === 'pan-left'
      // 后端：运镜用 cover(scale=increase+crop) 铺满画布；静止用 contain(scale=decrease+pad)
      const fit = hasMotion
        ? Math.max(canvas.width / img.width, canvas.height / img.height)
        : Math.min(canvas.width / img.width, canvas.height / img.height)
      const dur = effectiveDuration(scene)
      const elapsed = Math.max(0, Math.min(dur, currentTime.value - sceneStartTime(idx)))
      const p = dur > 0 ? elapsed / dur : 0 // 分镜内进度 0-1

      let zoomFactor = 1, panX = 0, panY = 0
      if (motion === 'zoom-in') {
        zoomFactor = 1 + 0.18 * p // 由远及近推入
      } else if (motion === 'zoom-out') {
        zoomFactor = 1.18 - 0.18 * p // 由近及远拉出
      } else if (motion === 'pan-right' || motion === 'pan-left') {
        zoomFactor = 1.1 // 放大 1.1 倍留出平移余量
      }

      const w = img.width * fit * zoomFactor
      const h = img.height * fit * zoomFactor
      // 平移：在 cover 溢出范围内移动（最多移动溢出量的一半，避免露边）
      if (motion === 'pan-right') {
        panX = -((w - canvas.width) / 2) * p
      } else if (motion === 'pan-left') {
        panX = ((w - canvas.width) / 2) * p
      }
      const x = (canvas.width - w) / 2 + panX
      const y = (canvas.height - h) / 2 + panY
      ctx.drawImage(img, x, y, w, h)
    }
  }
  // ④ 叠加字幕（与导出的硬字幕保持一致：开了硬字幕才画，并剥离说话人标记）
  if (scene && burnSubtitle.value) {
    const dur = effectiveDuration(scene)
    const elapsed = Math.max(0, Math.min(dur, currentTime.value - sceneStartTime(idx)))
    const cue = currentSubtitleCue(scene, elapsed, dur)
    if (cue?.text) {
      // 计算字幕特效进度（预览模拟 fade/floatup/slidein/popzoom 的出入场）
      let fx = null
      if (!karaoke.value && subtitleEffect.value && subtitleEffect.value !== 'none') {
        const cueDuration = Math.max(0.1, cue.end - cue.start)
        const cueElapsed = Math.max(0, Math.min(cueDuration, elapsed - cue.start))
        fx = { effect: subtitleEffect.value, p: cueElapsed / cueDuration, durMs: cueDuration * 1000, elapsedMs: cueElapsed * 1000 }
      }
      drawSubtitle(ctx, canvas, cue.text, fx)
    }
  }
}

// ④ 在 canvas 上绘制字幕文字（自动换行 + 描边 + 半透明底）
// fx: { effect, p(0-1场景进度), durMs, elapsedMs } 为 null 时静态显示
function drawSubtitle(ctx, canvas, text, fx) {
  const fontSize = Math.round(Math.max(22, Math.min(34, canvas.width / 46)))
  ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  // 按画布宽度换行
  const maxWidth = canvas.width * 0.76
  const chars = [...text]
  const lines = []
  let line = ''
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ch }
    else line += ch
  }
  if (line) lines.push(line)
  const displayLines = lines.slice(0, 2)

  // 特效模拟：算 alpha / 位移 / 缩放（与后端 ASS \fad/\move/\t 对应）
  let alpha = 1, dx = 0, dy = 0, scale = 1
  if (fx) {
    const inMs = 350, outMs = 350
    const e = fx.elapsedMs, d = fx.durMs
    const fadeIn = Math.min(1, e / inMs)
    const fadeOut = Math.min(1, Math.max(0, (d - e)) / outMs)
    const ease = Math.min(1, e / Math.min(500, d * 0.4)) // 入场动画进度
    if (fx.effect === 'fade' || fx.effect === 'typewriter') {
      alpha = Math.min(fadeIn, fadeOut)
    } else if (fx.effect === 'floatup') {
      alpha = Math.min(fadeIn, fadeOut)
      dy = (1 - ease) * 40
    } else if (fx.effect === 'slidein') {
      alpha = Math.min(fadeIn, fadeOut)
      dx = (1 - ease) * -220 * (canvas.width / 1280)
    } else if (fx.effect === 'popzoom') {
      alpha = Math.min(fadeIn, fadeOut)
      scale = 0.6 + 0.4 * ease
    }
  }
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))

  const lineH = fontSize * 1.24
  let y = canvas.height - Math.max(46, Math.round(canvas.height * 0.07)) + dy
  const cx = canvas.width / 2 + dx
  if (scale !== 1) { ctx.translate(cx, y); ctx.scale(scale, scale); ctx.translate(-cx, -y) }
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = Math.max(2, fontSize / 8)
  ctx.shadowOffsetY = Math.max(1, fontSize / 14)
  for (let i = displayLines.length - 1; i >= 0; i--) {
    const ly = y - (displayLines.length - 1 - i) * lineH
    ctx.lineWidth = Math.max(2, fontSize / 13)
    ctx.strokeStyle = 'rgba(0,0,0,0.78)'
    ctx.strokeText(displayLines[i], cx, ly)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(displayLines[i], cx, ly)
  }
  ctx.restore()
}

function animate(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp
  const delta = (timestamp - lastTimestamp) / 1000
  lastTimestamp = timestamp
  currentTime.value += delta
  if (currentTime.value >= totalDuration.value) {
    currentTime.value = 0
    isPlaying.value = false
    lastTimestamp = null
    stopAudio()
    drawFrame()
    return
  }
  drawFrame()
  syncAudio()
  if (isPlaying.value) animationFrame = requestAnimationFrame(animate)
}

function togglePlay() {
  if (storyboards.value.length === 0) return
  isPlaying.value = !isPlaying.value
  if (isPlaying.value) {
    if (currentTime.value >= totalDuration.value) currentTime.value = 0
    lastTimestamp = null
    audioSceneIdx = -1  // 强制重新对齐音频
    if (previewAudio) previewAudio.playbackRate = videoSpeed.value
    animationFrame = requestAnimationFrame(animate)
  } else {
    cancelAnimationFrame(animationFrame)
    stopAudio()
  }
}

function seekTo(e) {
  const rect = progressRef.value.getBoundingClientRect()
  const pct = (e.clientX - rect.left) / rect.width
  currentTime.value = pct * totalDuration.value
  audioSceneIdx = -1  // 跳转后重新对齐音频
  drawFrame()
  syncAudio()
}

function handlePlayerModeChange(mode) {
  const next = mode === 'real-video' ? 'video' : 'canvas'
  if (next === 'video' && !projectVideoUrl.value) return
  playMode.value = next
  onPlayModeChange(next)
}

function handlePlayerToggle() {
  if (playMode.value === 'video') {
    const v = videoRef.value
    if (!v || !projectVideoUrl.value) return
    setRealVideoPlaybackRate()
    v.muted = playerMuted.value
    v.volume = playerVolume.value
    if (v.paused) v.play().catch(() => {})
    else v.pause()
    return
  }
  togglePlay()
}

function handlePlayerSeek(time) {
  if (playMode.value === 'video') {
    seekRealVideo(time)
    return
  }
  onTimelineSeek(time)
}

function handlePlayerSceneSeek(time) {
  if (playMode.value === 'video') {
    if (!canMapRealVideoToTimeline.value) {
      handlePlayerModeChange('draft-canvas')
      nextTick(() => onTimelineSeek(time))
      return
    }
    const videoDuration = realVideoDuration.value || videoRef.value?.duration || 0
    const mappedTime = totalDuration.value > 0 && videoDuration > 0
      ? (time / totalDuration.value) * videoDuration
      : time
    seekRealVideo(mappedTime)
    return
  }
  onTimelineSeek(time)
}

function seekRealVideo(time) {
  const v = videoRef.value
  const duration = realVideoDuration.value || v?.duration || Number(freshExport.value?.duration || staleExport.value?.duration || 0) || 0
  const safe = duration > 0 ? Math.max(0, Math.min(duration, Number(time) || 0)) : Math.max(0, Number(time) || 0)
  realVideoCurrentTime.value = safe
  if (v) {
    try { v.currentTime = safe } catch (e) { /* 忽略 */ }
  }
  if (canMapRealVideoToTimeline.value && duration > 0 && totalDuration.value > 0) {
    currentTime.value = (safe / duration) * totalDuration.value
    currentSceneIndex.value = getSceneAtTime(currentTime.value)
  }
}

async function handlePlayerSpeedChange(value) {
  videoSpeed.value = Number(value) || 1
  await onVideoSpeedChange()
}

function handlePlayerSubtitleToggle() {
  burnSubtitle.value = !burnSubtitle.value
  drawFrame()
}

function handlePlayerMuteChange(value) {
  playerMuted.value = !!value
  if (videoRef.value) videoRef.value.muted = playerMuted.value
  if (previewAudio) previewAudio.muted = playerMuted.value
}

function handlePlayerVolumeChange(value) {
  playerVolume.value = Math.max(0, Math.min(1, Number(value)))
  if (videoRef.value) videoRef.value.volume = playerVolume.value
  if (previewAudio) previewAudio.volume = playerVolume.value
}

function handlePlayerSnapshot() {
  saveSnapshot()
}

// ⑧ 时间轴编辑器：点击跳转
function onTimelineSeek(time) {
  currentTime.value = Math.min(time, totalDuration.value)
  audioSceneIdx = -1  // 跳转后重新对齐音频
  // 真实视频模式下：点时间轴跳转要同步驱动 video 元素
  if (playMode.value === 'video' && videoRef.value && totalDuration.value > 0) {
    const vd = videoRef.value.duration || totalDuration.value
    try { videoRef.value.currentTime = (currentTime.value / totalDuration.value) * vd } catch (e) { /* 忽略 */ }
  }
  drawFrame()
  syncAudio()
}

async function loadTimeline() {
  try {
    timeline.value = await getProjectTimeline(projectId, { videoSpeed: videoSpeed.value })
  } catch (e) {
    timeline.value = null
  }
}

async function onVideoSpeedChange() {
  await loadTimeline()
  setRealVideoPlaybackRate()
  if (previewAudio) previewAudio.playbackRate = videoSpeed.value
  for (const v of Object.values(videoCache)) {
    try { v.playbackRate = videoSpeed.value } catch {}
  }
  currentTime.value = Math.min(currentTime.value, totalDuration.value)
  audioSceneIdx = -1
  drawFrame()
}

// 真实成片播放时，把原生 <video> 的播放进度同步回 currentTime，
// 驱动下方时间轴播放头。成片实际时长可能与分镜累加时长略有出入，
// 故按比例归一化到时间轴总时长，保证播放头走到头与视频播完对齐。
function onVideoTimeUpdate() {
  const v = videoRef.value
  if (!v || playMode.value !== 'video') return
  const vd = v.duration
  realVideoCurrentTime.value = v.currentTime || 0
  if (vd && isFinite(vd) && vd > 0) realVideoDuration.value = vd
  if (!canMapRealVideoToTimeline.value) return
  if (!vd || !isFinite(vd) || totalDuration.value <= 0) {
    currentTime.value = realVideoCurrentTime.value
    return
  }
  currentTime.value = (v.currentTime / vd) * totalDuration.value
  currentSceneIndex.value = getSceneAtTime(currentTime.value)
}

// ⑧ 时间轴编辑器：拖拽改时长（preview 实时更新本地，commit 时写回后端）
let durationDirty = null
async function onTimelineDuration({ id, duration, preview, commit }) {
  if (preview && typeof duration === 'number') {
    const sb = storyboards.value.find((s) => s.id === id)
    if (sb) { sb.duration = duration; durationDirty = sb }
    return
  }
  if (commit && durationDirty) {
    const sb = durationDirty
    durationDirty = null
    try {
      await api.put(`/storyboards/${sb.id}`, { ...sb, duration: sb.duration })
      await loadTimeline()
      ElMessage.success(t('preview.durationUpdated', { n: sb.duration }))
    } catch (e) { ElMessage.error(t('preview.durationSaveFailed')) }
  }
}

async function fetchStoryboards() {
  try {
    const res = await api.get(`/storyboards/project/${projectId}`)
    const boards = res.data.data || res.data || []
    for (const board of boards) {
      board.transition = board.transition || 'none'
      // selected_image_url 已由后端 JOIN 返回，无需逐个分镜再请求
      board.thumbnailUrl = board.selected_image_url ? mediaUrl(board.selected_image_url) : null
      // v1.6.8：拼接 videoUrl（图生视频 i2v 结果），预览页优先播放真实视频帧
      board.videoUrl = board.videoUrl ? mediaUrl(board.videoUrl) : null
      // ④ 预览音字同步：携带配音地址与字幕文本
      board.audioUrl = (board.audio_url && !board.no_voice) ? mediaUrl(board.audio_url) : null
      board._audioDur = 0 // 真实配音时长，由 measureAudioDuration 异步填充
    }
    storyboards.value = boards
    await loadTimeline()
    await nextTick()
    preloadImages()
    preloadVideos() // v1.6.8 预加载视频（静默失败，不阻塞预览）
    storyboards.value.forEach(measureAudioDuration) // ④ 异步测量真实配音时长，对齐音画时间轴
    drawFrame()
    loadWorkbenchStatus()
    await loadProjectVideo()
  } catch (e) {
    ElMessage.error(t('preview.loadFailed'))
  }
}

async function loadWorkbenchStatus() {
  try {
    workbenchStatus.value = await getWorkbenchStatus(projectId)
  } catch {
    workbenchStatus.value = null
  }
}

async function handleWorkbenchRepair(type = 'auto') {
  repairingWorkbench.value = true
  try {
    await repairWorkbench(projectId, { type, videoSpeed: videoSpeed.value, ratio: ratio.value })
    await fetchStoryboards()
    await loadWorkbenchStatus()
    ElMessage.success('工作台已完成修复')
  } catch (e) {
    ElMessage.error(e.message || '修复失败')
  } finally {
    repairingWorkbench.value = false
  }
}

async function handleGuidePrimary(action) {
  if (!action) return
  if (action.type === 'repair_assets') return handleWorkbenchRepair('assets')
  if (action.type === 'repair_missing_images') return handleWorkbenchRepair('missing_images')
  if (action.type === 'export_video') return handleExport()
}

function preloadImages() {
  storyboards.value.forEach(s => { if (s.thumbnailUrl) loadImage(s.thumbnailUrl) })
}

// v1.6.8：预加载分镜 AI 视频。加载完成后重绘当前帧，让静止画面立即被视频首帧替换。
function preloadVideos() {
  storyboards.value.forEach(s => {
    if (s.videoUrl) loadVideo(s.videoUrl).then(v => { if (v) drawFrame() })
  })
}

// ① 打开时间轴卡片的「选图」弹窗：拉取该分镜已生成的所有图片
async function openImagePicker(element, index) {
  imgPicker.value = { visible: true, sbId: element.id, sceneNo: index + 1, images: [], loading: true, selectedId: element.selected_image_id || null }
  try {
    const res = await api.get(`/images/storyboard/${element.id}`)
    const list = res.data.data || res.data || []
    imgPicker.value.images = list.map(img => ({ ...img, url: mediaUrl(img.file_url) }))
  } catch (e) {
    ElMessage.error(t('preview.loadImagesFailed'))
  } finally {
    imgPicker.value.loading = false
  }
}

// ① 在弹窗里点选某张图 → 写回该分镜 selected_image_id，并刷新缩略图与预览
async function pickImage(img) {
  const sbId = imgPicker.value.sbId
  try {
    await api.put(`/storyboards/${sbId}`, { selected_image_id: img.id })
    const board = storyboards.value.find(s => s.id === sbId)
    if (board) {
      board.selected_image_id = img.id
      board.thumbnailUrl = img.url
      await loadImage(img.url)
    }
    imgPicker.value.selectedId = img.id
    imgPicker.value.visible = false
    drawFrame()
    ElMessage.success(t('preview.imagePicked'))
  } catch (e) {
    ElMessage.error(t('preview.pickImageFailed'))
  }
}

async function onDragEnd() {
  const orders = storyboards.value.map((s, i) => ({ id: s.id, sort_order: i }))
  try {
    await api.put(`/storyboards/reorder/${projectId}`, { orders })
    await loadTimeline()
  } catch (e) {
    ElMessage.error(t('preview.saveOrderFailed'))
  }
}

// ② 应用当前配音：扫描所有分镜，对「有台词、未标记不读、但还没有配音音频」的分镜调用 TTS 重新生成，
//    生成后立即刷新预览音频，无需跳到配音页。让用户在预览页就能一键让配音生效。
async function applyVoice() {
  // 修复：原来过滤 !s.audio_url 导致「已有配音的分镜被跳过」，用户改了音色点应用没反应。
  // 改为对所有有台词的分镜重新生成配音（这正是「应用当前配音」的预期）。
  const targets = storyboards.value.filter(
    (s) => !s.no_voice && s.dialog && s.dialog.trim()
  )
  if (targets.length === 0) {
    ElMessage.info(t('preview.voiceAllApplied'))
    return
  }
  applyingVoice.value = true
  let ok = 0
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i]
    exportMessage.value = t('preview.applyingVoiceFor', { n: s.scene_number })
    try {
      // 修复：原来传了 dialog: s.dialog（台词文本，非空字符串）会被后端当 true，
      // 强制走 Edge 多音色对话合成，把用户选的（火山）音色覆盖掉。单镜配音不该传 dialog。
      await api.post('/ai/generate-tts', {
        storyboard_id: s.id,
        text: s.dialog,
        voice: s.voice || undefined,
      })
      ok++
    } catch (e) { /* 单镜失败继续 */ }
  }
  exportMessage.value = ''
  applyingVoice.value = false
  await fetchStoryboards() // 重新拉取，audioUrl 立即生效
  await loadWorkbenchStatus()
  ElMessage.success(t('preview.voiceApplied', { ok, total: targets.length }))
}

// 一键同步：用当前台词刷新字幕文本、重新生成配音，并重建统一时间轴。
async function syncTimelineAssets() {
  if (syncingAssets.value || exporting.value || previewing.value) return
  const targets = storyboards.value.filter((s) => s.dialog && s.dialog.trim())
  if (targets.length === 0) {
    ElMessage.info(t('preview.syncNothing'))
    return
  }
  syncingAssets.value = true
  exportProgress.value = 0
  let voiceOk = 0
  let subtitleOk = 0
  try {
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i]
      exportProgress.value = Math.round((i / targets.length) * 100)
      exportMessage.value = t('preview.syncingScene', { n: s.scene_number || i + 1 })
      try {
        await api.put(`/storyboards/${s.id}`, { subtitle_text: s.dialog })
        subtitleOk++
      } catch (e) { /* 单镜字幕失败继续同步后续分镜 */ }
      if (!s.no_voice) {
        try {
          await api.post('/ai/generate-tts', {
            storyboard_id: s.id,
            text: s.dialog,
            voice: s.voice || undefined,
          })
          voiceOk++
        } catch (e) { /* 单镜配音失败继续，最终数量会提示 */ }
      }
    }
    exportProgress.value = 100
    await fetchStoryboards()
    await loadWorkbenchStatus()
    ElMessage.success(t('preview.syncComplete', { voice: voiceOk, subtitle: subtitleOk }))
  } catch (e) {
    ElMessage.error(t('preview.syncFailed', { msg: e.message || '' }))
  } finally {
    syncingAssets.value = false
    exportProgress.value = 0
    exportMessage.value = ''
  }
}

// v1.7：点「导出视频」先弹导出设置弹窗，用户确认设置后再走缺图检查 + 合成
function handleExport() {
  if (exporting.value) return
  exportDialogVisible.value = true
}

// 导出弹窗确认回调：带着用户选择的导出设置（分辨率/格式/帧率/画质/比例）进入合成流程
async function onExportConfirm(exportSettings) {
  // 用户在弹窗里选的比例同步回主界面（保持预览 canvas 与导出一致）
  if (exportSettings.ratio) ratio.value = exportSettings.ratio
  await runExportFlow(exportSettings)
}

async function runExportFlow(exportSettings) {
  // ② 防连点：导出进行中直接忽略后续点击，避免重复提交导致连弹多条失败提示
  if (exporting.value) return
  // ① 真实检测「完全没有图片」的分镜：后端导出会对「生成过图但没选」的分镜自动兜底选最新一张，
  //    所以这里只拦截那些一张图都没生成过的分镜，避免误把「有图没选」当成无法导出。
  exporting.value = true
  exportMessage.value = t('preview.checkingImages')
  let scenesNoImage = []
  try {
    const checks = await Promise.all(
      storyboards.value.map(async (s) => {
        if (s.thumbnailUrl) return { s, count: 1 } // 已选图，必有图
        try {
          const r = await api.get(`/images/storyboard/${s.id}`)
          const list = r.data.data || r.data || []
          return { s, count: list.length }
        } catch { return { s, count: 0 } }
      })
    )
    scenesNoImage = checks.filter((c) => c.count === 0).map((c) => c.s)
  } catch (e) { /* 探测失败则交给后端兜底 */ }
  exportMessage.value = ''

  // 全部分镜都没图 → 引导生成
  if (scenesNoImage.length === storyboards.value.length && storyboards.value.length > 0) {
    try {
      await ElMessageBox.confirm(
        t('preview.allMissingImage'), t('preview.cannotExport'),
        { confirmButtonText: t('preview.oneClickGenAll'), cancelButtonText: t('preview.gotoImages'), type: 'warning' }
      )
      await batchGenMissing(scenesNoImage)
    } catch (act) {
      if (act === 'cancel') router.push(`/projects/${projectId}/images`)
      exporting.value = false
      return
    }
    exporting.value = false
    return // 生成后让用户确认结果再手动导出
  }
  // 部分分镜缺图 → 询问：一键补图 / 跳过缺图继续导出 / 取消
  if (scenesNoImage.length > 0) {
    let action
    try {
      action = await ElMessageBox({
        title: t('preview.confirmExport'),
        message: t('preview.someMissingImage', { n: scenesNoImage.length, scenes: scenesNoImage.map((s) => s.scene_number).join('、') }),
        showCancelButton: true, distinguishCancelAndClose: true,
        confirmButtonText: t('preview.oneClickGenMissing'),
        cancelButtonText: t('preview.exportAnyway'),
        type: 'warning',
      })
    } catch (act) {
      if (act === 'cancel') { /* 跳过缺图继续导出 */ }
      else { exporting.value = false; return } // 关闭/取消
    }
    if (action === 'confirm') { await batchGenMissing(scenesNoImage); exporting.value = false; return }
  }
  // doCompose 自行管理 exporting 状态（会先置 true 再 finally 置 false）
  await doCompose(exportSettings)
}

// 一键为缺图分镜批量生成图片（用项目当前比例），完成后提示用户再导出
async function batchGenMissing(scenes) {
  exporting.value = true
  let ok = 0
  for (let i = 0; i < scenes.length; i++) {
    exportProgress.value = Math.round((i / scenes.length) * 100)
    exportMessage.value = t('preview.genImageFor', { n: scenes[i].scene_number })
    try {
      await api.post('/ai/generate-image', { storyboard_id: scenes[i].id, ratio: ratio.value, batch_size: 1 })
      ok++
    } catch (e) { /* 单镜失败继续 */ }
  }
  exporting.value = false
  exportProgress.value = 0
  exportMessage.value = ''
  await fetchStoryboards()
  await loadWorkbenchStatus()
  ElMessage.success(t('preview.genMissingDone', { ok, total: scenes.length }))
}

async function doCompose(exportSettings = {}) {
  exporting.value = true
  exportProgress.value = 0
  exportMessage.value = t('preview.submittingCompose')
  exportTaskId.value = ''
  exportResult.value = null
  exportError.value = ''
  try {
    // 比例优先用导出弹窗里选的，回退到主界面 ratio
    const useRatio = exportSettings.ratio || ratio.value
    const opts = { burnSubtitle: burnSubtitle.value, ratio: useRatio, videoSpeed: videoSpeed.value }
    if (isLongProject.value) {
      opts.longMode = true
      opts.chapterDurationSec = 300
      opts.aiVideoMode = videoMode.value && videoMode.value !== 'static' ? 'keyframes' : 'off'
    }
    // v1.7 导出设置：分辨率档位 / 格式 / 画质 / 帧率（全解锁无水印）
    if (exportSettings.resolution) opts.resolution = exportSettings.resolution
    if (exportSettings.format) opts.format = exportSettings.format
    if (exportSettings.quality) opts.quality = exportSettings.quality
    if (exportSettings.fps) opts.fps = exportSettings.fps
    if (exportSettings.skipExternalExportCopy) opts.skipExternalExportCopy = true
    if (exportSettings.exportDirectory) opts.exportDirectory = exportSettings.exportDirectory
    if (exportSettings.setAsDefaultExportDirectory) opts.setAsDefaultExportDirectory = true
    if (burnSubtitle.value && karaoke.value) opts.karaoke = true
    else if (burnSubtitle.value && subtitleEffect.value && subtitleEffect.value !== 'none') opts.subtitleEffect = subtitleEffect.value
    if (videoMode.value && videoMode.value !== 'static') opts.videoProvider = videoMode.value
    const cfg = presetConfig()
    if (cfg) {
      // 预设里的 fps 仅在导出设置未显式指定时兜底（导出弹窗优先级更高）
      if (cfg.fps && !opts.fps) opts.fps = cfg.fps
      if (cfg.transition) opts.transitionDuration = cfg.transitionDuration
      if (cfg.motion) opts.motion = cfg.motion
      if (typeof cfg.bgmVolume === 'number') opts.bgmVolume = cfg.bgmVolume
      if (cfg.subtitleStyle) opts.subtitleStyle = cfg.subtitleStyle
    }
    const res = await api.post('/video/compose', { project_id: projectId, async: true, options: opts })
    const taskId = res.data?.data?.task_id
    if (!taskId) throw new Error(res.data?.message || t('preview.submitFailed'))
    exportTaskId.value = taskId
    exportMessage.value = isLongProject.value
      ? '长视频任务已提交：将按章节分段合成，完成后自动进入成片库。'
      : '导出任务已提交，完成后会保存到成片库。'

    await new Promise((resolve, reject) => {
      stopTracking = trackTask(taskId, {
        onProgress: (task) => {
          exportProgress.value = task.progress
          exportMessage.value = task.message
        },
        onSuccess: (task) => {
          const data = task.result
          exportResult.value = data || null
          exportError.value = ''
          exportProgress.value = 100
          exportMessage.value = data?.file_url
            ? `导出完成：${data.file_url}`
            : '导出完成，已保存到成片库。'
          ElMessage.success(t('preview.composeSuccess'))
          // 导出成功后刷新预览区成片列表，自动切换到播放真实视频
          loadProjectVideo(data.video_speed || videoSpeed.value)
          loadExportLocation()
          loadWorkbenchStatus()
          resolve()
        },
        onError: (err) => {
          exportError.value = err.message || t('preview.composeFailed', { msg: '' })
          ElMessage.error(t('preview.composeFailed', { msg: err.message || '' }))
          reject(err)
        },
      })
    })
  } catch (e) {
    exportError.value = e.message || String(e || '')
    ElMessage.error(t('preview.exportFailed', { msg: e.message || '' }))
  } finally {
    exporting.value = false
    if (!exportResult.value) exportProgress.value = 0
    if (!exportResult.value && !exportError.value) exportMessage.value = ''
  }
}

// ⚡ 快速预览：调后端 /preview-compose，取前 3 镜用 ultrafast 真合成（真实转场/字幕/运镜/配音），
//    所见即所得。同步返回（前 3 镜通常十几秒），不落成片库。
async function doQuickPreview() {
  if (previewing.value || exporting.value) return
  previewing.value = true
  exportProgress.value = 30
  exportMessage.value = t('preview.quickPreviewRunning')
  try {
    const opts = { burnSubtitle: burnSubtitle.value, ratio: ratio.value, videoSpeed: videoSpeed.value }
    if (burnSubtitle.value && karaoke.value) opts.karaoke = true
    else if (burnSubtitle.value && subtitleEffect.value && subtitleEffect.value !== 'none') opts.subtitleEffect = subtitleEffect.value
    const cfg = presetConfig()
    if (cfg) {
      if (cfg.fps) opts.fps = cfg.fps
      if (cfg.transition) opts.transitionDuration = cfg.transitionDuration
      if (cfg.motion) opts.motion = cfg.motion
      if (cfg.subtitleStyle) opts.subtitleStyle = cfg.subtitleStyle
    }
    const res = await api.post('/video/preview-compose', { project_id: projectId, options: opts, limit: 3 })
    const data = res.data?.data
    if (!data || !data.file_url) throw new Error(res.data?.message || t('preview.submitFailed'))
    exportProgress.value = 100
    ElMessage.success(t('preview.quickPreviewDone', { n: data.preview_scenes, total: data.total_scenes }))
    projectVideoUrl.value = mediaUrl(data.file_url)
    projectVideoBakedSpeed.value = data.video_speed || videoSpeed.value
    activeVideoSource.value = 'preview'
    resetRealVideoClock(data.duration)
    playMode.value = 'video'
    stopCanvasPlayback()
    nextTick(() => {
      setRealVideoPlaybackRate()
      if (videoRef.value) {
        videoRef.value.muted = playerMuted.value
        videoRef.value.volume = playerVolume.value
        videoRef.value.play().catch(() => {})
      }
    })
  } catch (e) {
    const msg = e.response?.data?.message || e.message || ''
    ElMessage.error(t('preview.quickPreviewFailed', { msg }))
  } finally {
    previewing.value = false
    exportProgress.value = 0
    exportMessage.value = ''
  }
}

async function loadPresets() {
  try { presets.value = await listPresets() } catch (e) { /* 静默 */ }
}

async function loadT2v() {
  try {
    const groups = await getProviders()
    const t2vList = (groups && groups.t2v) || []
    t2vOptions.value = t2vList
      .filter((p) => p.configured)
      .flatMap((p) => (p.models || []).map((m) => ({
        key: `${p.key}__${m}`,
        label: `${t('preview.t2vPrefix')} · ${p.label} · ${m}${p.free ? t('preview.t2vFree') : t('preview.t2vPaid')}`,
      })))
  } catch (e) { /* 静默，保持仅静图运镜 */ }
}

async function loadSnapshots() {
  try { snapshots.value = await listSnapshots(projectId) } catch (e) { /* 静默 */ }
}

function presetConfig() {
  const p = presets.value.find((x) => x.id === selectedPreset.value)
  if (!p) return null
  try { return typeof p.config === 'string' ? JSON.parse(p.config) : p.config } catch { return null }
}

function applyPreset() {
  const cfg = presetConfig()
  if (!cfg) return
  if (typeof cfg.burnSubtitle === 'boolean') burnSubtitle.value = cfg.burnSubtitle
  ElMessage.success(t('preview.presetApplied'))
}

function fmtSnapTime(t) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

async function saveSnapshot() {
  try {
    const { value } = await ElMessageBox.prompt(t('preview.snapPromptMsg'), t('preview.snapPromptTitle'), {
      inputValue: t('preview.snapDefaultName', { time: fmtSnapTime(Date.now()) }),
      confirmButtonText: t('common.save'), cancelButtonText: t('common.cancel'),
    })
    await createSnapshot(projectId, value)
    ElMessage.success(t('preview.snapSaved'))
    await loadSnapshots()
  } catch (e) { if (e !== 'cancel') ElMessage.error(t('preview.snapSaveFailed', { msg: (e.message || e) })) }
}

async function doRestore(s) {
  try {
    await ElMessageBox.confirm(t('preview.restoreConfirm', { label: s.label }), t('preview.restoreTitle'), { type: 'warning' })
    await restoreSnapshot(s.id)
    ElMessage.success(t('preview.restored'))
    await fetchStoryboards()
  } catch (e) { if (e !== 'cancel') ElMessage.error(t('preview.restoreFailed', { msg: (e.message || e) })) }
}

async function doDeleteSnap(s) {
  try {
    await deleteSnapshot(s.id)
    await loadSnapshots()
  } catch (e) { ElMessage.error(t('preview.snapDeleteFailed', { msg: (e.message || e) })) }
}

async function applyBatch() {
  const patch = {}
  if (batchForm.value.motion) patch.motion = batchForm.value.motion
  if (batchForm.value.transition) patch.transition = batchForm.value.transition
  if (batchForm.value.voice) patch.voice = batchForm.value.voice
  if (!Object.keys(patch).length) { ElMessage.warning(t('preview.batchSelectFirst')); return }
  const ids = storyboards.value.map((s) => s.id)
  try {
    const res = await batchUpdateStoryboards(ids, patch)
    ElMessage.success(t('preview.batchUpdated', { n: res.data?.updated ?? ids.length }))
    batchForm.value = { motion: '', transition: '', voice: '' }
    await fetchStoryboards()
  } catch (e) { ElMessage.error(t('preview.batchFailed', { msg: (e.message || e) })) }
}

async function doSuggestDuration() {
  try {
    const data = await suggestDuration(projectId, { apply: false })
    const list = data.suggestions || []
    if (!list.length) { ElMessage.warning(t('preview.noScenesToSuggest')); return }
    const changed = list.filter((x) => Math.abs((x.suggested || 0) - (x.current || 0)) > 0.3).length
    const total = Math.round(list.reduce((s, x) => s + (x.suggested || 0), 0) * 10) / 10
    await ElMessageBox.confirm(
      t('preview.suggestConfirm', { changed, total }),
      t('preview.suggestTitle'), { confirmButtonText: t('preview.apply'), cancelButtonText: t('common.cancel'), type: 'info' }
    )
    await suggestDuration(projectId, { apply: true })
    ElMessage.success(t('preview.suggestApplied'))
    await fetchStoryboards()
  } catch (e) { if (e !== 'cancel') ElMessage.error(t('preview.suggestFailed', { msg: (e.message || e) })) }
}

function initCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const m = RATIO_MAP[ratio.value] || RATIO_MAP['16:9']
  canvas.width = m.w
  canvas.height = m.h
  drawFrame()
}

// ③ 读取项目画幅比例，作为预览与导出的统一比例
async function fetchProject() {
  try {
    const res = await api.get(`/projects/${projectId}`)
    const p = res.data.data || res.data
    project.value = p || null
    if (p && p.ratio && RATIO_MAP[p.ratio]) ratio.value = p.ratio
  } catch (e) { /* 静默，保持默认 16:9 */ }
}

async function loadExportLocation() {
  try {
    const data = await getExportLocation()
    exportLocation.value = { ...exportLocation.value, ...(data || {}) }
  } catch (e) {
    // 导出位置只是提示信息，读取失败不影响预览与导出主流程
  }
}

function resetRealVideoClock(duration = 0) {
  realVideoCurrentTime.value = 0
  realVideoDuration.value = Number(duration) > 0 ? Number(duration) : 0
}

function exportIsLong(row) {
  return Number(row?.long_video_mode) === 1 || Number(row?.chapter_count) > 1 || Number(row?.duration) >= 600
}

function currentTimelineIsLong() {
  return originalTotalDuration.value >= 600 || storyboards.value.length >= 80 || Number(project.value?.long_video_mode) === 1
}

function exportFreshness(row) {
  const exportDuration = Number(row?.duration)
  const expectedDuration = Number(totalDuration.value || 0)
  if (!row?.file_url) return { fresh: false, reason: '成片文件地址缺失，无法作为当前预览。' }
  if (!Number.isFinite(exportDuration) || exportDuration <= 0) {
    return { fresh: false, reason: '现有成片缺少有效时长信息，需要重新导出后才能和当前分镜对齐。' }
  }
  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) {
    return { fresh: false, reason: '当前分镜时间轴尚未准备完成，暂不自动播放历史成片。' }
  }
  const tolerance = Math.max(3, expectedDuration * 0.03)
  if (Math.abs(exportDuration - expectedDuration) > tolerance) {
    return {
      fresh: false,
      reason: `当前分镜时间轴约 ${formatTime(expectedDuration)}，现有成片约 ${formatTime(exportDuration)}，两者不匹配。请重新导出当前版本。`,
    }
  }
  const expectedLong = currentTimelineIsLong()
  if (expectedLong !== exportIsLong(row)) {
    return {
      fresh: false,
      reason: expectedLong
        ? '当前项目已是长视频版本，但现有成片仍是短视频导出，需要重新导出。'
        : '当前项目不是长视频版本，但现有成片标记为长视频导出，需要重新导出。',
    }
  }
  return { fresh: true, reason: '' }
}

function activateVideoExport(row, { source = 'fresh', autoPlay = false, bakedSpeed = null } = {}) {
  if (!row?.file_url) return
  projectVideoUrl.value = mediaUrl(row.file_url)
  projectVideoBakedSpeed.value = Number(row.video_speed || bakedSpeed) || null
  activeVideoSource.value = source
  resetRealVideoClock(row.duration)
  if (source === 'fresh') freshExport.value = row
  if (source === 'stale') staleExport.value = row
  playMode.value = autoPlay ? 'video' : 'canvas'
  if (autoPlay) {
    stopCanvasPlayback()
    nextTick(() => setRealVideoPlaybackRate())
  } else {
    try { videoRef.value && videoRef.value.pause() } catch (e) { /* 忽略 */ }
    isRealVideoPlaying.value = false
    nextTick(() => initCanvas())
  }
}

function clearProjectVideo() {
  projectVideoUrl.value = ''
  projectVideoBakedSpeed.value = null
  freshExport.value = null
  staleExport.value = null
  activeVideoSource.value = 'none'
  exportFreshnessReason.value = ''
  resetRealVideoClock()
  playMode.value = 'canvas'
}

// 加载该项目成片（exports）。只有与当前分镜时间轴匹配的成片才默认播放；
// 旧成片保留为可手动查看，避免旧 mp4 冒充当前草稿预览。
async function loadProjectVideo(knownBakedSpeed = null) {
  try {
    const list = await projectExports(projectId)
    const ok = (Array.isArray(list) ? list : []).filter((e) => e && e.status === 'success' && e.file_url)
    if (ok.length) {
      // 取最新一条（后端按 created_at DESC 返回，取第一条即可，保险起见再排一次）
      ok.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      const fresh = ok.find((item) => exportFreshness(item).fresh)
      const stale = fresh ? null : ok[0]
      freshExport.value = fresh || null
      staleExport.value = stale || null
      exportFreshnessReason.value = stale ? exportFreshness(stale).reason : ''
      if (fresh) {
        activateVideoExport(fresh, { source: 'fresh', autoPlay: true, bakedSpeed: knownBakedSpeed })
      } else if (stale) {
        activateVideoExport(stale, { source: 'stale', autoPlay: false, bakedSpeed: knownBakedSpeed })
      }
    } else {
      clearProjectVideo()
    }
  } catch (e) {
    // 查不到成片时静默回退草稿模拟
    clearProjectVideo()
  }
}

function playStaleExport() {
  if (!staleExport.value) return
  activateVideoExport(staleExport.value, {
    source: 'stale',
    autoPlay: true,
    bakedSpeed: staleExport.value.video_speed,
  })
}

// 停掉 canvas 模拟播放与配音（切换到真实视频或卸载时调用）
function stopCanvasPlayback() {
  isPlaying.value = false
  if (animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = null }
  try { stopAudio() } catch (e) { /* 忽略 */ }
}

// 用户手动切换播放模式：切到草稿时暂停真实视频；切到真实视频时停掉 canvas 模拟
function onPlayModeChange(mode) {
  if (mode === 'video') {
    stopCanvasPlayback()
    nextTick(() => {
      try {
        if (videoRef.value) {
          videoRef.value.load()
          videoRef.value.muted = playerMuted.value
          videoRef.value.volume = playerVolume.value
          setRealVideoPlaybackRate()
        }
      } catch (e) { /* 忽略 */ }
    })
  } else {
    try { videoRef.value && videoRef.value.pause() } catch (e) { /* 忽略 */ }
    isRealVideoPlaying.value = false
    nextTick(() => { initCanvas() })
  }
}

function setRealVideoPlaybackRate() {
  try {
    if (videoRef.value) {
      const baked = Number(projectVideoBakedSpeed.value)
      const rate = baked && baked > 0 ? (videoSpeed.value / baked) : videoSpeed.value
      videoRef.value.playbackRate = Math.max(0.25, Math.min(4, rate))
    }
  } catch (e) { /* 忽略 */ }
}

function onVideoLoadedMetadata() {
  setRealVideoPlaybackRate()
  if (videoRef.value) {
    videoRef.value.muted = playerMuted.value
    videoRef.value.volume = playerVolume.value
    if (Number.isFinite(videoRef.value.duration) && videoRef.value.duration > 0) {
      realVideoDuration.value = videoRef.value.duration
    }
  }
  onVideoTimeUpdate()
}

// ③ 切换比例：写回项目 + 重设 canvas + 重绘
async function applyRatio() {
  initCanvas()
  try { await api.put(`/projects/${projectId}`, { ratio: ratio.value }) } catch (e) { /* 静默 */ }
}

onMounted(() => {
  fetchProject().finally(() => { initCanvas() })
  fetchStoryboards()
  loadPresets()
  loadSnapshots()
  loadT2v()
  loadWorkbenchStatus()
  loadExportLocation()
})

onUnmounted(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  stopAudio()
  previewAudio = null
  // 关闭可能仍在运行的任务进度 SSE 连接，避免泄漏与卸载后回调
  if (stopTracking) { stopTracking(); stopTracking = null }
  // 停止真实视频播放
  try { videoRef.value && videoRef.value.pause() } catch (e) { /* 忽略 */ }
})
</script>

<style scoped>
.preview-page {
  min-height: 100%;
  box-sizing: border-box;
  background: var(--bg-base);
  color: var(--text);
  padding: 16px;
  overflow: visible;
}
/* ③ 留白根因修复：原来「视频(矮) + 设置面板(高)」并排成一行，时间轴在整行下方，
   于是视频下方空出 = 设置面板高度 − 视频高度 的一大片灰。改为 CSS Grid：
   左列上=播放器、左列下=时间轴，右列=设置面板纵跨两行。时间轴直接贴在视频下面，
   不再有空白；右侧高面板自然占满右列。 */
.preview-grid {
  display: grid;
  min-height: 100%;
  grid-template-columns: minmax(0, 1fr) 220px;
  grid-template-rows: auto auto auto auto auto;
  grid-template-areas:
    "guide guide"
    "export side"
    "player side"
    "timeline side"
    "footer side";
  align-items: start;
  gap: 16px;
}
.preview-grid > .player-section { grid-area: player; }
.preview-grid > .side-panel { grid-area: side; }
.preview-grid > .timeline-section { grid-area: timeline; }
.preview-grid > .preview-guide { grid-area: guide; margin-bottom: 0; }
.preview-grid > .export-action-panel { grid-area: export; }
.preview-grid > .preview-stage-footer { grid-area: footer; margin-top: 0; }
.preview-grid > .export-progress { grid-column: 1 / -1; }
.preview-main {
  display: flex;
  gap: 20px;
  flex: 0 0 auto;
  align-items: flex-start;
}
.player-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  min-width: 0;
  min-height: 320px;
  overflow: visible;
}
.canvas-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  /* 真因修复（v1.5.0 实测）：flex:1 1 auto + min-height:0 让画面区弹性占据
     播放器行扣掉控制条后的剩余高度，窗口变小时跟着收缩；画面用 object-fit
     在内部等比缩放。不再用 max-height:60vh（视口单位会脱离父容器导致溢出）。 */
  flex: 1 1 auto;
  min-height: 0;
  /* 真因修复（v1.6.0 浏览器实测）：min-width:0 是横向不溢出的关键。canvas 元素带
     intrinsic 宽度属性(1280)，会把 grid 第一列的 auto 最小宽度撑到 1280px，导致播放器
     和画面横向捅出白色容器右边（用户反复看到的"内容在容器外面"）。min-width:0 +
     列改 minmax(0,1fr) 后，列可收缩到任意窄，画面在内部按 object-fit 等比缩放。 */
  min-width: 0;
  max-width: 100%;
  margin: 0 auto;
  background: #0a0a1a;
  border-radius: var(--radius-md);
  overflow: hidden;
}
.preview-canvas {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
/* 真实成片播放器：与成片库一致的 video，等比缩放贴合画面区 */
.preview-video {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #000;
}

.stale-export-alert {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(230, 162, 60, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(230, 162, 60, 0.1);
}

.stale-export-copy {
  min-width: 0;
}

.stale-export-copy strong {
  display: block;
  margin-bottom: 3px;
  color: var(--el-color-warning);
  font-size: 13px;
}

.stale-export-copy p {
  margin: 0;
  color: var(--text-second);
  font-size: 12px;
  line-height: 1.5;
}

.stale-export-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  flex: 0 0 auto;
}

.stale-export-actions .el-button {
  margin: 0;
}

/* 播放模式切换条 */
.play-mode-bar {
  width: 100%;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}
.play-mode-hint {
  font-size: 12px;
  color: var(--text-muted, #888);
}
.player-controls {
  width: 100%;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
}
.time-display {
  font-size: 13px;
  color: var(--text-second);
  min-width: 90px;
}
.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--separator);
  border-radius: 3px;
  cursor: pointer;
  position: relative;
}
.progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.1s linear;
}
.side-panel {
  width: 220px;
  max-height: calc(100dvh - 80px);
  background: var(--bg-surface);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  overflow-y: auto;
}
.side-panel h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text);
}
.info-item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.info-value {
  color: var(--primary);
  font-weight: 600;
}

.long-video-panel {
  padding: 10px;
  border: 1px solid rgba(0, 122, 255, 0.18);
  border-radius: var(--radius-sm);
  background: var(--primary-soft);
  color: var(--text);
}

.long-video-panel strong {
  display: block;
  margin-bottom: 6px;
  color: var(--primary);
  font-size: 13px;
}

.long-video-panel p {
  margin: 4px 0 0;
  color: var(--text-second);
  font-size: 11px;
  line-height: 1.5;
}

.long-video-panel .duration-warning {
  padding: 6px 8px;
  margin-top: 8px;
  border: 1px solid rgba(230, 162, 60, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(230, 162, 60, 0.1);
  color: var(--el-color-warning);
}

.export-action-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(0, 122, 255, 0.18);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  min-width: 0;
}

.export-action-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.export-action-copy h3 {
  margin: 0;
  color: var(--text);
  font-size: 15px;
}

.export-action-copy p {
  margin: 0;
  color: var(--text-second);
  font-size: 12px;
  line-height: 1.5;
}

.export-action-copy code {
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(0, 122, 255, 0.08);
  color: var(--primary);
  font-size: 11px;
}

.export-action-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.export-action-controls .el-button {
  margin: 0;
}

.export-action-panel .export-status-card {
  grid-column: 1 / -1;
}

.export-btn {
  margin-top: auto;
}

.export-action-panel .export-btn {
  margin-top: 0;
}

.export-status-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
}

.export-status-card.is-running {
  border-color: rgba(0, 122, 255, 0.24);
  background: var(--primary-soft);
}

.export-status-card.is-success {
  border-color: rgba(52, 199, 89, 0.28);
  background: rgba(52, 199, 89, 0.08);
}

.export-status-card.is-error {
  border-color: rgba(255, 59, 48, 0.28);
  background: rgba(255, 59, 48, 0.08);
}

.export-status-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.export-status-head strong {
  color: var(--text);
  font-size: 13px;
}

.export-status-card p {
  margin: 0;
  color: var(--text-second);
  font-size: 12px;
  line-height: 1.5;
}

.export-location {
  display: grid;
  gap: 4px;
}

.export-location span {
  color: var(--text-muted, #999);
  font-size: 11px;
}

.export-location code {
  display: block;
  padding: 6px 7px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.06);
  color: var(--text);
  font-size: 11px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.export-status-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.export-status-actions .el-button {
  flex: 1 1 auto;
  margin: 0;
}

.apply-voice-btn {
  margin-top: 8px;
  width: 100%;
}
.sp-divider { margin: 8px 0; }
.setting-block { display: flex; flex-direction: column; gap: 6px; }
.setting-block label { font-size: 13px; color: var(--text-second); }
.switch-row { flex-direction: row; align-items: center; justify-content: space-between; }
.switch-row span { font-size: 13px; color: var(--text-second); }
.setting-hint { margin: 4px 0 0; font-size: 11px; color: var(--text-muted, #999); line-height: 1.4; }
.snapshot-head { display: flex; align-items: center; justify-content: space-between; }
.snapshot-head h3 { margin: 0; }
.snap-empty { font-size: 12px; color: var(--text-muted, #999); }
.snap-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--separator); }
.snap-info { display: flex; flex-direction: column; min-width: 0; }
.snap-label { font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snap-meta { font-size: 11px; color: var(--text-muted, #999); }
.snap-btns { flex-shrink: 0; }
.export-progress {
  margin: 0 16px 16px;
  padding: 12px 16px;
  background: var(--primary-soft);
  border-radius: var(--radius-md);
  border: 1px solid rgba(0, 122, 255, 0.15);
}
.export-message {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-second);
}
.timeline-section {
  background: var(--bg-surface);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  padding: 16px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.timeline-title {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: var(--text);
}
.timeline-toolbar {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.timeline-toolbar .timeline-title { margin: 0; }
.batch-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.sync-summary {
  max-width: 240px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--primary-soft);
  border: 1px solid rgba(0, 122, 255, 0.18);
  color: var(--primary);
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.batch-pop { display: flex; flex-direction: column; gap: 10px; }
.batch-field { display: flex; align-items: center; gap: 8px; }
.batch-field span { width: 36px; font-size: 13px; color: var(--text-second); flex-shrink: 0; }
.batch-field :deep(.el-select) { flex: 1; }
.timeline-track {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 8px 0;
  align-items: stretch;
}
.timeline-item-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}
.transition-selector {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 110px;
  padding: 4px;
  background: var(--primary-soft);
  border: 1px dashed rgba(0, 122, 255, 0.3);
  border-radius: 6px;
}
.transition-selector :deep(.el-input__wrapper) {
  background: transparent;
  font-size: 12px;
}
.timeline-card {
  min-width: 140px;
  background: var(--bg-base);
  border-radius: 6px;
  overflow: hidden;
  cursor: grab;
  border: 2px solid var(--separator);
  transition: border-color 0.2s;
}
.timeline-card.active {
  border-color: var(--primary);
}
.timeline-card:hover {
  border-color: var(--primary);
}
.card-thumbnail {
  position: relative;
  width: 100%;
  height: 80px;
  overflow: hidden;
  background: #0a0a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.card-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.placeholder-thumb {
  font-size: 28px;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.placeholder-thumb .pick-hint {
  font-size: 11px;
}
.pick-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 0.15s;
}
.card-thumbnail:hover .pick-overlay {
  opacity: 1;
}
.card-info {
  padding: 6px 8px;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.scene-num {
  color: var(--text-second);
}
.duration-label {
  color: var(--primary);
}
/* ① 选图弹窗 */
.img-picker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  min-height: 120px;
}
.img-picker-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--text-muted);
  padding: 32px 0;
}
.img-picker-cell {
  position: relative;
  aspect-ratio: v-bind(aspectRatioCss);
  border: 2px solid transparent;
  border-radius: var(--radius-sm);
  overflow: hidden;
  cursor: pointer;
  background: #0a0a1a;
}
.img-picker-cell img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.img-picker-cell:hover {
  border-color: var(--primary);
}
.img-picker-cell.chosen {
  border-color: var(--primary);
}
.img-picker-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
/* 窗口变窄/浏览器放大时：右侧 220px 设置面板与视频并排会把视频挤没，
   改为单列堆叠——播放器在上、设置面板、时间轴在下。三段竖向叠加通常高过窗口，
   此时回退为「整页可滚动」（解除 height:100%/overflow:hidden 的锁定），不裁切。 */
@media (max-width: 1100px) {
  .preview-page {
    min-height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .preview-grid {
    height: auto;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto auto auto;
    grid-template-areas:
      "guide"
      "export"
      "player"
      "side"
      "timeline"
      "footer";
  }
  .preview-grid > .player-section { min-height: 240px; }
  .export-action-panel {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
  .export-action-controls {
    justify-content: flex-start;
  }
  .preview-grid > .side-panel {
    width: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    overflow-y: visible;
  }
}

</style>
