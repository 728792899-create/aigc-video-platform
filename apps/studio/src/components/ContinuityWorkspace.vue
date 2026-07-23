<template>
  <section
    class="continuity-workspace"
    data-figma-node="16:2"
    data-figma-spec="T/08-Continuity"
    aria-labelledby="continuity-workspace-title"
  >
    <header class="continuity-workspace__heading">
      <h1 id="continuity-workspace-title">连续性实验室</h1>
      <p>比较上一镜尾帧、当前首帧与关键帧，并把冲突变成可修复任务。</p>
    </header>

    <div v-if="hasContinuityContext" class="continuity-workspace__layout">
      <div class="continuity-workspace__frames" aria-label="镜头边界帧对比">
        <figure v-for="frame in frames" :key="frame.id" class="continuity-workspace__frame">
          <img v-if="frame.imageUrl" :src="frame.imageUrl" :alt="frame.alt" />
          <MediaPreview
            v-else-if="frame.mediaLocator"
            :project-id="snapshot.project.id"
            :locator="frame.mediaLocator"
            :alt="frame.alt"
          />
          <span v-else class="continuity-workspace__missing-media">
            <ImageOff :size="30" aria-hidden="true" />
            <span>{{ frame.missingLabel }}</span>
          </span>
          <figcaption>{{ frame.label }}</figcaption>
        </figure>
      </div>

      <aside class="continuity-workspace__inspector" aria-labelledby="continuity-inspector-title">
        <h2 id="continuity-inspector-title" :class="{ 'continuity-workspace__result--success': conflicts.length === 0 }">
          {{ inspectorTitle }}
        </h2>

        <div v-if="conflicts.length" class="continuity-workspace__issues" role="list" aria-label="连续性冲突">
          <button
            v-for="conflict in conflicts"
            :key="conflict.id"
            type="button"
            class="continuity-workspace__issue"
            :class="[`continuity-workspace__issue--${conflict.tone}`, { active: conflict.id === selectedConflictId }]"
            :aria-pressed="conflict.id === selectedConflictId"
            @click="selectConflict(conflict.id)"
          >
            <strong>{{ conflict.label }}</strong>
            <span>{{ conflict.detail }}</span>
          </button>
        </div>

        <p v-else class="continuity-workspace__no-conflict">
          三帧边界与镜头事实没有发现阻断项，可以继续进入生成队列。
        </p>

        <p class="continuity-workspace__identity" role="status">
          <Check :size="14" aria-hidden="true" />
          {{ identityStatus }}
        </p>

        <div class="continuity-workspace__actions">
          <p v-if="pendingConfirmation" class="continuity-workspace__confirmation" role="note">
            确认后才会进入生成队列；任务会在执行确认时创建。
          </p>
          <button class="continuity-workspace__primary" type="button" @click="handlePrimaryAction">
            {{ primaryLabel }}
          </button>
        </div>
      </aside>
    </div>

    <div v-else class="continuity-workspace__empty">
      <ImageOff :size="30" aria-hidden="true" />
      <h2>还没有可检查的相邻镜头</h2>
      <p>至少需要两个已编排镜头。返回分镜工作区补齐 Shot 与边界帧后，再进行连续性检查。</p>
      <button type="button" @click="$emit('navigate', 'shots')">返回分镜工作区</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ImageOff } from 'lucide-vue-next'
import type { BoundaryFrame, MediaReference, ProjectSnapshot, Shot } from '@aigc-director/contracts'
import MediaPreview from './MediaPreview.vue'
import type { StudioWorkspaceId } from '../workspaces.js'

type ContinuityFrame = {
  id: 'previous-end' | 'current-start' | 'current-key'
  label: string
  alt: string
  imageUrl?: string
  mediaLocator?: string
  missingLabel: string
}

type ContinuityConflict = {
  id: string
  label: string
  detail: string
  tone: 'warning' | 'neutral'
}

type RepairRequest = {
  conflictId: string
  label: string
  shotId?: string
}

const props = defineProps<{ snapshot: ProjectSnapshot }>()
const emit = defineEmits<{
  navigate: [workspaceId: StudioWorkspaceId]
  'prepare-repair': [request: RepairRequest]
}>()

const demoFrames: ContinuityFrame[] = [
  { id: 'previous-end', label: '上一镜尾帧', alt: '上一镜尾帧，角色在云桥上向右移动', imageUrl: '/demo/xingque/storyboard-02.png', missingLabel: '上一镜尾帧尚未绑定' },
  { id: 'current-start', label: '当前首帧', alt: '当前首帧，角色进入坍塌广场', imageUrl: '/demo/xingque/storyboard-03.png', missingLabel: '当前首帧尚未绑定' },
  { id: 'current-key', label: '当前关键帧', alt: '当前关键帧，角色抵达星阙档案塔', imageUrl: '/demo/xingque/storyboard-04.png', missingLabel: '当前关键帧尚未绑定' },
]

const demoConflicts: ContinuityConflict[] = [
  { id: 'eye-line', label: '视线方向', detail: '上一镜向右，当前首帧向左', tone: 'warning' },
  { id: 'prop-position', label: '星核位置', detail: '腰侧 → 手持，可解释', tone: 'neutral' },
]

const isXingqueDemo = computed(() => props.snapshot.project.name.replace(/[《》]/gu, '') === '星阙回声')
const orderedShots = computed(() => [...props.snapshot.shots].sort((left, right) => left.ordinal - right.ordinal))
const currentShot = computed(() => orderedShots.value[Math.min(1, Math.max(0, orderedShots.value.length - 1))])
const previousShot = computed(() => {
  const index = currentShot.value ? orderedShots.value.findIndex((shot) => shot.id === currentShot.value?.id) : -1
  return index > 0 ? orderedShots.value[index - 1] : undefined
})
const hasContinuityContext = computed(() => isXingqueDemo.value || orderedShots.value.length >= 2)

const frames = computed<ContinuityFrame[]>(() => {
  if (isXingqueDemo.value) return demoFrames
  const previousEnd = previousShot.value?.boundaryFrames.find((frame) => frame.role === 'end')
  const currentStart = currentShot.value?.boundaryFrames.find((frame) => frame.role === 'start')
  const currentKey = currentShot.value?.boundaryFrames.find((frame) => frame.role === 'end') ?? currentStart
  return [
    frameFromBoundary('previous-end', '上一镜尾帧', previousEnd, '上一镜尾帧尚未绑定'),
    frameFromBoundary('current-start', '当前首帧', currentStart, '当前首帧尚未绑定'),
    frameFromBoundary('current-key', '当前关键帧', currentKey, '当前关键帧尚未绑定'),
  ]
})

const conflicts = computed<ContinuityConflict[]>(() => {
  if (isXingqueDemo.value) return demoConflicts
  const result: ContinuityConflict[] = []
  const previousEnd = previousShot.value?.boundaryFrames.find((frame) => frame.role === 'end')
  const currentStart = currentShot.value?.boundaryFrames.find((frame) => frame.role === 'start')
  if (!previousEnd) result.push({ id: 'previous-end-missing', label: '上一镜尾帧', detail: '尚未绑定，无法自动核对', tone: 'warning' })
  if (!currentStart) result.push({ id: 'current-start-missing', label: '当前首帧', detail: '尚未绑定，生成前需要补齐', tone: 'warning' })
  if (currentStart?.provenance === 'linked_previous_end' && previousEnd && currentStart.mediaSha256 !== previousEnd.mediaSha256) {
    result.push({ id: 'boundary-reference-drift', label: '边界帧引用', detail: '已链接上一镜，但媒体摘要不一致', tone: 'warning' })
  }
  if (currentShot.value?.staleFields.length) {
    result.push({ id: 'revision-drift', label: '镜头版本漂移', detail: `${currentShot.value.staleFields.join('、')} 已变更，需要重新检查`, tone: 'neutral' })
  }
  return result
})

const selectedConflictId = ref('')
const pendingConfirmation = ref(false)
const selectedConflict = computed(() => conflicts.value.find((conflict) => conflict.id === selectedConflictId.value) ?? conflicts.value[0])
const inspectorTitle = computed(() => conflicts.value.length ? `发现 ${conflicts.value.length} 项冲突` : '连续性检查通过')
const identityStatus = computed(() => isXingqueDemo.value ? '身份与服装一致' : '身份、服装与资产绑定未发现变更')
const primaryLabel = computed(() => {
  if (pendingConfirmation.value) return '确认并前往生成队列'
  return conflicts.value.length ? '创建局部修复任务' : '确认连续性通过'
})

watch(conflicts, (next) => {
  if (!next.some((conflict) => conflict.id === selectedConflictId.value)) selectedConflictId.value = next[0]?.id ?? ''
  pendingConfirmation.value = false
}, { immediate: true })

function findMedia(frame: BoundaryFrame | undefined): MediaReference | undefined {
  return frame ? props.snapshot.media.find((media) => media.id === frame.mediaId) : undefined
}

function frameFromBoundary(id: ContinuityFrame['id'], label: string, frame: BoundaryFrame | undefined, missingLabel: string): ContinuityFrame {
  const media = findMedia(frame)
  return {
    id,
    label,
    alt: `${label}${currentShot.value ? `，${currentShot.value.title}` : ''}`,
    ...(media ? { mediaLocator: media.locator } : {}),
    missingLabel,
  }
}

function selectConflict(conflictId: string): void {
  selectedConflictId.value = conflictId
  pendingConfirmation.value = false
}

function handlePrimaryAction(): void {
  if (conflicts.value.length && !pendingConfirmation.value) {
    pendingConfirmation.value = true
    return
  }
  const conflict = selectedConflict.value
  const request: RepairRequest = {
    conflictId: conflict?.id ?? 'continuity-approved',
    label: conflict?.label ?? '连续性检查通过',
    ...(currentShot.value ? { shotId: currentShot.value.id } : {}),
  }
  emit('prepare-repair', request)
  pendingConfirmation.value = false
}
</script>
