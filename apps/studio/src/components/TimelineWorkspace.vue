<template>
  <section
    class="timeline-workspace"
    data-figma-node="19:55"
    data-figma-spec="T/12-Timeline"
    data-guide-target="delivery-export"
    tabindex="-1"
    aria-labelledby="timeline-workspace-title"
  >
    <header class="timeline-workspace__heading">
      <h1 id="timeline-workspace-title">音频字幕时间线</h1>
      <p>以 canonical assembly 装配已批准候选；对白、音乐和字幕在当前版本只做可追溯预览。</p>
    </header>

    <div v-if="assemblyReady" class="timeline-workspace__layout">
      <figure class="timeline-workspace__preview">
        <img v-if="demoPreview" :src="demoPreview" alt="星阙回声原创分镜，苏绫与玄戈在档案塔前查看司南星核" />
        <MediaPreview
          v-else-if="activeMedia"
          :project-id="snapshot.project.id"
          :locator="activeMedia.locator"
          :alt="`${activeShot?.title ?? '当前镜头'}的已批准候选预览`"
        />
        <span v-else class="timeline-workspace__missing-preview"><ImageOff :size="28" />已批准候选的媒体引用不可用</span>
      </figure>

      <aside class="timeline-workspace__inspector" aria-labelledby="timeline-preflight-title">
        <h2 id="timeline-preflight-title">导出预检</h2>
        <dl>
          <div><dt>视频装配：</dt><dd>{{ selectedShots.length }} / {{ orderedShots.length }}</dd></div>
          <div><dt>对白脚本：</dt><dd>{{ dialogueShots.length }} / {{ orderedShots.length }}</dd></div>
          <div><dt>语音媒体：</dt><dd>{{ audioMediaCount }} / {{ orderedShots.length }} · {{ audioMediaCount ? '已引用' : 'Demo 静音' }}</dd></div>
          <div><dt>音乐资产：</dt><dd>{{ musicAssets.length }} · {{ musicMediaCount ? '有媒体' : '静音占位' }}</dd></div>
          <div><dt>字幕预览：</dt><dd>{{ subtitleCues.length }} 条 · 未持久化</dd></div>
          <div><dt>缺失视频：</dt><dd>{{ missingVideoCount }}</dd></div>
          <div><dt>字幕安全区：</dt><dd>{{ subtitleOverflowCount }} 项需检查</dd></div>
          <div><dt>付费请求：</dt><dd>0</dd></div>
        </dl>
        <div class="timeline-workspace__planned" role="note">
          <strong>自由剪辑能力：Planned</strong>
          <span>当前以 canonical assembly 为准；不提供无法保存的拖拽编辑。</span>
        </div>
        <p v-if="subtitleOverflowCount" class="timeline-workspace__warning"><TriangleAlert :size="14" />{{ firstOverflowLabel }} 字幕可能超出安全区</p>
        <p v-else class="timeline-workspace__success"><CircleCheck :size="14" />装配边界检查通过</p>
        <button type="button" class="timeline-workspace__primary" @click="handleInspectorAction">
          <ScanSearch v-if="subtitleOverflowCount" :size="16" />
          <ArrowRight v-else :size="16" />
          {{ subtitleOverflowCount ? '定位并检查字幕' : '前往导出预检' }}
        </button>
      </aside>

      <section class="timeline-workspace__tracks" aria-label="规范化装配轨道">
        <div class="timeline-workspace__ruler" aria-hidden="true">
          <span v-for="tick in rulerTicks" :key="tick">{{ formatTime(tick) }}</span>
        </div>
        <div class="timeline-workspace__track">
          <header><Film :size="15" /><span><strong>视频</strong><small>canonical · r{{ snapshot.project.graphRevision }}</small></span></header>
          <div class="timeline-workspace__track-content">
            <button
              v-for="(shot, index) in selectedShots"
              :key="shot.id"
              type="button"
              class="timeline-workspace__clip timeline-workspace__clip--video"
              :class="{ active: shot.id === activeShotId }"
              :style="clipStyle(shot.durationMs)"
              :aria-pressed="shot.id === activeShotId"
              @click="activeShotId = shot.id"
            >
              <strong>视频 {{ index + 1 }}</strong><small>{{ (shot.durationMs / 1000).toFixed(1) }}s · r{{ shot.revision }}</small>
            </button>
          </div>
        </div>
        <div class="timeline-workspace__track">
          <header><AudioLines :size="15" /><span><strong>对白</strong><small>镜头脚本 · 静音 Demo</small></span></header>
          <div class="timeline-workspace__track-content">
            <button
              v-for="(shot, index) in dialogueShots"
              :key="shot.id"
              type="button"
              class="timeline-workspace__clip timeline-workspace__clip--dialogue"
              :class="{ active: shot.id === activeShotId }"
              :style="clipStyle(shot.durationMs)"
              :title="shot.dialogue"
              @click="activeShotId = shot.id"
            ><strong>对白 {{ index + 1 }}</strong><small>{{ shortDialogue(shot.dialogue) }}</small></button>
            <span v-if="dialogueShots.length === 0" class="timeline-workspace__track-empty">未配置对白脚本</span>
          </div>
        </div>
        <div class="timeline-workspace__track">
          <header><Music2 :size="15" /><span><strong>音乐</strong><small>资产引用 · 不写入导出</small></span></header>
          <div class="timeline-workspace__track-content">
            <span v-for="asset in musicAssets" :key="asset.id" class="timeline-workspace__clip timeline-workspace__clip--music">
              <strong>{{ asset.name }}</strong><small>{{ musicMediaCount ? '媒体已引用' : '静音占位' }}</small>
            </span>
            <span v-if="musicAssets.length === 0" class="timeline-workspace__track-empty">未配置音乐资产</span>
          </div>
        </div>
        <div class="timeline-workspace__track">
          <header><Captions :size="15" /><span><strong>字幕</strong><small>从对白推导 · 预览</small></span></header>
          <div class="timeline-workspace__track-content">
            <button
              v-for="(cue, index) in subtitleCues"
              :key="cue.shotId"
              type="button"
              class="timeline-workspace__clip timeline-workspace__clip--subtitle"
              :class="{ active: cue.shotId === activeShotId, warning: cue.overflow }"
              :style="clipStyle(cue.durationMs)"
              @click="activeShotId = cue.shotId"
            ><strong>字幕 {{ index + 1 }}</strong><small>{{ shortDialogue(cue.text) }}</small></button>
            <span v-if="subtitleCues.length === 0" class="timeline-workspace__track-empty">没有可预览字幕</span>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="timeline-workspace__empty">
      <Clapperboard :size="30" />
      <h2>装配尚未就绪</h2>
      <p>每个镜头都需要唯一 active take。已完成的候选选择会保留，不会覆盖生成结果。</p>
      <button type="button" @click="emit('navigate', 'review')">返回候选审阅</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, AudioLines, Captions, CircleCheck, Clapperboard, Film, ImageOff, Music2, ScanSearch, TriangleAlert } from 'lucide-vue-next'
import type { AssetUnit, MediaReference, ProjectSnapshot, Shot } from '@aigc-director/contracts'
import MediaPreview from './MediaPreview.vue'
import type { StudioWorkspaceId } from '../workspaces.js'
import { useStudioStore } from '../stores/studio.js'

type SubtitlePreviewCue = { shotId: string; text: string; durationMs: number; overflow: boolean }

const emit = defineEmits<{ navigate: [workspaceId: StudioWorkspaceId] }>()
const store = useStudioStore()
const snapshot = computed<ProjectSnapshot>(() => store.snapshot!)
const activeShotId = ref('')

const orderedShots = computed(() => [...snapshot.value.shots].sort((left, right) => left.ordinal - right.ordinal))
const selectedShots = computed(() => orderedShots.value.filter((shot) => Boolean(shot.selectedCandidateId)))
const assemblyReady = computed(() => orderedShots.value.length > 0 && selectedShots.value.length === orderedShots.value.length)
const dialogueShots = computed(() => orderedShots.value.filter((shot) => shot.dialogue.trim()))
const subtitleCues = computed<SubtitlePreviewCue[]>(() => dialogueShots.value.map((shot) => ({
  shotId: shot.id, text: shot.dialogue.trim(), durationMs: shot.durationMs, overflow: shot.dialogue.trim().length > 28,
})))
const subtitleOverflowCount = computed(() => subtitleCues.value.filter((cue) => cue.overflow).length)
const firstOverflowCue = computed(() => subtitleCues.value.find((cue) => cue.overflow))
const firstOverflowLabel = computed(() => {
  const index = orderedShots.value.findIndex((shot) => shot.id === firstOverflowCue.value?.shotId)
  return index >= 0 ? `镜头 ${String(index + 1).padStart(2, '0')}` : '当前'
})
const activeShot = computed(() => orderedShots.value.find((shot) => shot.id === activeShotId.value) ?? selectedShots.value[0])
const activeCandidate = computed(() => snapshot.value.candidates.find((candidate) => candidate.id === activeShot.value?.selectedCandidateId))
const activeMedia = computed<MediaReference | undefined>(() => snapshot.value.media.find((media) => media.id === activeCandidate.value?.mediaId))
const audioMediaCount = computed(() => snapshot.value.media.filter((media) => media.kind === 'audio').length)
const missingVideoCount = computed(() => selectedShots.value.filter((shot) => {
  const candidate = snapshot.value.candidates.find((item) => item.id === shot.selectedCandidateId)
  return !candidate || candidate.status !== 'ready'
}).length)
const musicAssets = computed<AssetUnit[]>(() => snapshot.value.assets.filter((asset) => asset.type === 'music' && !asset.archived))
const musicMediaCount = computed(() => snapshot.value.media.filter((media) => media.kind === 'audio').length)
const totalDurationMs = computed(() => orderedShots.value.reduce((sum, shot) => sum + shot.durationMs, 0))
const rulerTicks = computed(() => {
  const duration = totalDurationMs.value
  if (!duration) return [0]
  return Array.from({ length: 5 }, (_, index) => Math.round(duration * index / 4))
})
const isXingque = computed(() => snapshot.value.project.name.replace(/[《》]/gu, '') === '星阙回声')
const demoPreview = computed(() => isXingque.value ? '/demo/xingque/storyboard-05.png' : '')

watch(selectedShots, (shots) => {
  if (shots.some((shot) => shot.id === activeShotId.value)) return
  activeShotId.value = shots[0]?.id ?? ''
}, { immediate: true })

function clipStyle(durationMs: number): Record<string, string> {
  const percentage = totalDurationMs.value ? Math.max(12, durationMs / totalDurationMs.value * 100) : 24
  return { flexBasis: `${percentage}%` }
}
function shortDialogue(value: string): string {
  const text = value.trim()
  return text.length > 18 ? `${text.slice(0, 18)}…` : text
}
function formatTime(value: number): string {
  const seconds = Math.max(0, Math.round(value / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
function handleInspectorAction(): void {
  if (firstOverflowCue.value) { activeShotId.value = firstOverflowCue.value.shotId; return }
  emit('navigate', 'export_settings')
}
</script>
