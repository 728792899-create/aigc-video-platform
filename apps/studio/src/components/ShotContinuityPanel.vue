<template>
  <section class="shot-continuity" aria-label="镜头节拍与边界连续性">
    <header class="shot-continuity__header">
      <div><h3>镜头节拍</h3><p>{{ draftBeats.length }} 个节拍 · {{ (totalDuration / 1_000).toFixed(1) }} 秒</p></div>
      <button type="button" class="text-button" @click="splitEvenly">平均分配</button>
    </header>
    <ol class="shot-beat-list">
      <li v-for="(beat, index) in draftBeats" :key="beat.id">
        <span class="shot-beat-index">{{ index + 1 }}</span>
        <label>动作<input v-model.trim="beat.action" maxlength="2000"></label>
        <label>运镜<input v-model.trim="beat.camera" maxlength="1000"></label>
        <label>时长（ms）<input v-model.number="beat.durationMs" type="number" min="100" :max="shot.durationMs" step="100"></label>
      </li>
    </ol>
    <p v-if="!durationValid" class="error-copy">节拍总时长必须精确等于 {{ shot.durationMs }} ms，当前为 {{ totalDuration }} ms。</p>
    <button data-action="save-beats" type="button" class="secondary-button shot-continuity__save" :disabled="!canSave" @click="saveBeats">保存节拍</button>

    <header class="shot-continuity__header shot-continuity__header--frames"><div><h3>首尾帧连续性</h3><p>固定媒体 hash 与来源 revision</p></div></header>
    <div class="boundary-frame-list">
      <article v-for="role in frameRoles" :key="role">
        <div><strong>{{ role === 'start' ? '首帧' : '尾帧' }}</strong><span v-if="frameFor(role)" class="status-pill">已绑定</span><span v-else class="status-pill status-pill--muted">未绑定</span></div>
        <template v-if="frameFor(role)">
          <code>{{ shortHash(frameFor(role)!.mediaSha256) }}</code>
          <small>{{ frameFor(role)!.provenance }} · source r{{ frameFor(role)!.sourceRevision }}</small>
          <button type="button" class="text-button" @click="$emit('clearFrame', role)">解除</button>
        </template>
      </article>
    </div>
    <button v-if="canLinkPrevious" data-action="link-previous" type="button" class="secondary-button shot-continuity__save" @click="$emit('linkPrevious')">沿用上一镜头尾帧</button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BoundaryFrame, Shot, ShotBeat } from '@aigc-director/contracts'

const props = defineProps<{ shot: Shot; canLinkPrevious: boolean }>()
const emit = defineEmits<{
  saveBeats: [beats: ShotBeat[]]
  linkPrevious: []
  clearFrame: [role: BoundaryFrame['role']]
}>()

type EditableBeat = Omit<ShotBeat, 'startMs' | 'ordinal'> & { startMs: number; ordinal: number }
const cloneBeats = (): EditableBeat[] => props.shot.beats.map((beat) => ({ ...beat, referenceIds: [...beat.referenceIds] }))
const draftBeats = ref<EditableBeat[]>(cloneBeats())
watch(() => props.shot, () => { draftBeats.value = cloneBeats() }, { deep: true })

const totalDuration = computed(() => draftBeats.value.reduce((sum, beat) => sum + (Number.isSafeInteger(beat.durationMs) ? beat.durationMs : 0), 0))
const durationValid = computed(() => totalDuration.value === props.shot.durationMs && draftBeats.value.every((beat) => beat.durationMs >= 100))
const canSave = computed(() => durationValid.value && draftBeats.value.length > 0 && draftBeats.value.every((beat) => beat.action.trim() && beat.camera.trim()))
const frameRoles: BoundaryFrame['role'][] = ['start', 'end']
const frameFor = (role: BoundaryFrame['role']): BoundaryFrame | undefined => props.shot.boundaryFrames.find((frame) => frame.role === role)
const shortHash = (hash: string): string => `${hash.slice(0, 10)}…${hash.slice(-6)}`

function normalizedDrafts(): ShotBeat[] {
  let cursor = 0
  return draftBeats.value.map((beat, ordinal) => {
    const normalized: ShotBeat = { ...beat, ordinal, startMs: cursor }
    cursor += normalized.durationMs
    return normalized
  })
}

function splitEvenly(): void {
  if (draftBeats.value.length === 0) return
  const base = Math.floor(props.shot.durationMs / draftBeats.value.length)
  draftBeats.value = draftBeats.value.map((beat, index) => ({
    ...beat,
    durationMs: index === draftBeats.value.length - 1 ? props.shot.durationMs - base * index : base,
  }))
}

function saveBeats(): void {
  if (canSave.value) emit('saveBeats', normalizedDrafts())
}
</script>
