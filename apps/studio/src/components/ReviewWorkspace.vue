<template>
  <section
    class="review-workspace"
    data-figma-node="19:2"
    data-figma-spec="T/11-CandidateReview"
    data-guide-target="candidate-review"
    tabindex="-1"
    aria-labelledby="review-workspace-title"
  >
    <header class="review-workspace__heading">
      <div>
        <h1 id="review-workspace-title">候选审阅</h1>
        <p>比较生成结果、收藏与标记问题，选择唯一 active take。</p>
      </div>
      <label v-if="shotsWithCandidates.length > 1" class="review-workspace__shot-picker">
        <span>当前镜头</span>
        <select v-model="currentShotId" @change="resetInteractionState">
          <option v-for="shot in shotsWithCandidates" :key="shot.id" :value="shot.id">
            SHOT-{{ String(shot.ordinal + 1).padStart(2, '0') }} · {{ shot.title }}
          </option>
        </select>
      </label>
    </header>

    <div v-if="failedBatches.length" class="review-workspace__failure" role="status">
      <TriangleAlert :size="16" aria-hidden="true" />
      <span>{{ failedCount }} 个候选失败；已完成项和当前 active take 不会被覆盖。</span>
      <button type="button" :disabled="store.loading" @click="retryFailed">
        {{ retryArmed ? `确认仅重试 ${failedCount} 个失败候选` : '仅重试失败候选' }}
      </button>
    </div>

    <div v-if="currentCandidates.length && currentShot" class="review-workspace__layout">
      <div class="review-workspace__gallery" role="listbox" aria-label="当前镜头候选">
        <article
          v-for="(candidate, index) in currentCandidates"
          :key="candidate.id"
          class="review-workspace__candidate"
          :class="{
            'review-workspace__candidate--active': candidate.id === currentShot.selectedCandidateId,
            'review-workspace__candidate--preview': candidate.id === activeCandidate?.id,
            'review-workspace__candidate--failed': candidate.status === 'failed',
          }"
          role="option"
          :aria-selected="candidate.id === activeCandidate?.id"
        >
          <button
            type="button"
            class="review-workspace__candidate-image"
            :aria-label="`查看 ${candidateLabel(candidate, index)}`"
            :aria-pressed="candidate.id === activeCandidate?.id"
            @click="selectPreview(candidate.id)"
          >
            <img v-if="demoImage(index)" :src="demoImage(index)" :alt="`${candidateLabel(candidate, index)}，星阙回声原创候选画面`" />
            <MediaPreview
              v-else-if="mediaFor(candidate)"
              :project-id="snapshot.project.id"
              :locator="mediaFor(candidate)!.locator"
              :alt="`${candidateLabel(candidate, index)} 的媒体预览`"
            />
            <span v-else class="review-workspace__missing-media">
              <ImageOff :size="28" aria-hidden="true" />
              <span>{{ candidate.status === 'failed' ? '生成失败 · 可单项重试' : '媒体引用不可用' }}</span>
            </span>
            <span v-if="compareIds.has(candidate.id)" class="review-workspace__compare-badge"><Columns2 :size="13" />比较中</span>
          </button>
          <strong>{{ candidateLabel(candidate, index) }}</strong>
          <span v-if="candidate.id === currentShot.selectedCandidateId" class="review-workspace__active-take">
            <CircleCheck :size="13" />ACTIVE TAKE
          </span>
          <span v-else class="review-workspace__score"><Circle :size="12" />{{ scoreLabel(candidate) }}</span>
        </article>
      </div>

      <aside class="review-workspace__inspector" aria-labelledby="review-inspector-title">
        <h2 id="review-inspector-title">{{ activeCandidateLabel }}</h2>
        <dl v-if="activeCandidate" class="review-workspace__facts">
          <div><dt>状态：</dt><dd>{{ activeCandidate.favorite ? '已收藏' : '未收藏' }}</dd></div>
          <div><dt>连续性：</dt><dd>{{ continuityLabel }}</dd></div>
          <div><dt>构图：</dt><dd>{{ compositionLabel }}</dd></div>
          <div><dt>Provider：</dt><dd>{{ activeCandidate.provider }}</dd></div>
          <div><dt>费用：</dt><dd>{{ costLabel }}</dd></div>
        </dl>

        <section v-if="activeCandidate" class="review-workspace__notes" aria-label="审阅证据">
          <strong>审阅证据 {{ activeReviews.length }}</strong>
          <p v-for="(reason, index) in reviewReasons" :key="`${index}-${reason}`">备注 {{ index + 1 }}：{{ reason }}</p>
          <p v-if="reviewReasons.length === 0">尚无评审备注；批准前请检查人物、构图和连续性。</p>
        </section>

        <div v-if="activeCandidate" class="review-workspace__inspector-actions">
          <div class="review-workspace__secondary-actions">
            <button
              type="button"
              class="review-workspace__favorite"
              :aria-pressed="activeCandidate.favorite"
              :disabled="store.loading"
              @click="toggleFavorite"
            >
              <Star :size="15" :fill="activeCandidate.favorite ? 'currentColor' : 'none'" />
              {{ activeCandidate.favorite ? '取消收藏' : '收藏候选' }}
            </button>
            <button
              type="button"
              class="review-workspace__compare"
              :aria-pressed="compareIds.has(activeCandidate.id)"
              @click="toggleCompare(activeCandidate.id)"
            >
              <Columns2 :size="15" />{{ compareIds.has(activeCandidate.id) ? '移出比较' : '加入比较' }}
            </button>
          </div>
          <p v-if="approveArmedId === activeCandidate.id" class="review-workspace__confirmation" role="note">
            将替换该镜头的 active take；历史候选仍会保留。
          </p>
          <button
            class="review-workspace__primary"
            type="button"
            :disabled="store.loading || activeCandidate.status !== 'ready'"
            @click="handlePrimary"
          >
            <ArrowRight :size="16" />{{ primaryLabel }}
          </button>
        </div>
      </aside>
    </div>

    <div v-else class="review-workspace__empty">
      <ImageOff :size="30" aria-hidden="true" />
      <h2>还没有可审阅候选</h2>
      <p>先在生成队列提交零 Key Demo 或已确认的 Provider 批次。失败任务会保留诊断和单项重试入口。</p>
      <button type="button" @click="$emit('navigate', 'generation')">返回生成队列</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Circle, CircleCheck, Columns2, ImageOff, Star, TriangleAlert } from 'lucide-vue-next'
import type { Candidate, MediaReference, ProjectSnapshot, ReviewDecision } from '@aigc-director/contracts'
import MediaPreview from './MediaPreview.vue'
import type { StudioWorkspaceId } from '../workspaces.js'
import { useStudioStore } from '../stores/studio.js'

const emit = defineEmits<{ navigate: [workspaceId: StudioWorkspaceId] }>()
const store = useStudioStore()
const snapshot = computed<ProjectSnapshot>(() => store.snapshot!)
const orderedShots = computed(() => [...(snapshot.value?.shots ?? [])].sort((left, right) => left.ordinal - right.ordinal))
const shotsWithCandidates = computed(() => orderedShots.value.filter((shot) => snapshot.value.candidates.some((candidate) => candidate.shotId === shot.id)))
const currentShotId = ref('')
const activeCandidateId = ref('')
const compareIds = ref(new Set<string>())
const approveArmedId = ref('')
const retryArmed = ref(false)

const currentShot = computed(() => shotsWithCandidates.value.find((shot) => shot.id === currentShotId.value) ?? shotsWithCandidates.value[0])
const currentCandidates = computed(() => snapshot.value.candidates
  .filter((candidate) => candidate.shotId === currentShot.value?.id && candidate.status !== 'archived')
  .sort((left, right) => candidateOrdinal(left) - candidateOrdinal(right) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)))
const activeCandidate = computed(() => currentCandidates.value.find((candidate) => candidate.id === activeCandidateId.value)
  ?? currentCandidates.value.find((candidate) => candidate.id === currentShot.value?.selectedCandidateId)
  ?? currentCandidates.value.find((candidate) => candidate.status === 'ready')
  ?? currentCandidates.value[0])
const activeIndex = computed(() => Math.max(0, currentCandidates.value.findIndex((candidate) => candidate.id === activeCandidate.value?.id)))
const activeCandidateLabel = computed(() => activeCandidate.value ? candidateLabel(activeCandidate.value, activeIndex.value) : '未选择候选')
const activeReviews = computed<ReviewDecision[]>(() => snapshot.value.reviews.filter((review) => review.candidateId === activeCandidate.value?.id))
const reviewReasons = computed(() => {
  const reasons = activeReviews.value.flatMap((review) => review.reasons).filter(Boolean)
  if (reasons.length) return [...new Set(reasons)].slice(0, 2)
  return (activeCandidate.value?.tags ?? []).slice(0, 2)
})
const continuityLabel = computed(() => {
  if (activeReviews.value.some((review) => review.decision === 'rejected')) return '需修复'
  if (activeReviews.value.some((review) => review.decision === 'approved')) return '通过'
  return '待人工确认'
})
const compositionLabel = computed(() => activeCandidate.value?.tags[0] ?? '待人工确认')
const costLabel = computed(() => activeCandidate.value?.provider === 'demo-local' ? '¥0 · billed=false' : '提交前门禁确认')
const failedBatches = computed(() => snapshot.value.candidateBatches.filter((batch) => batch.shotId === currentShot.value?.id && batch.failedCount > 0 && ['partial', 'failed'].includes(batch.status)))
const failedCount = computed(() => failedBatches.value.reduce((total, batch) => total + batch.failedCount, 0))
const allOtherShotsSelected = computed(() => orderedShots.value.every((shot) => shot.id === currentShot.value?.id || Boolean(shot.selectedCandidateId)))
const nextUnapprovedShot = computed(() => orderedShots.value.find((shot) => shot.id !== currentShot.value?.id && !shot.selectedCandidateId && shotsWithCandidates.value.some((item) => item.id === shot.id)))
const primaryLabel = computed(() => {
  if (!activeCandidate.value) return '选择候选'
  if (activeCandidate.value.id === currentShot.value?.selectedCandidateId) return nextUnapprovedShot.value ? '审阅下一镜头' : '进入时间线'
  if (approveArmedId.value === activeCandidate.value.id) return `确认批准 ${activeCandidateLabel.value}`
  return allOtherShotsSelected.value ? '批准并进入时间线' : '批准为 active take'
})
const isXingque = computed(() => snapshot.value.project.name.replace(/[《》]/gu, '') === '星阙回声')

watch(shotsWithCandidates, (shots) => {
  if (shots.some((shot) => shot.id === currentShotId.value)) return
  currentShotId.value = shots.find((shot) => !shot.selectedCandidateId)?.id ?? shots[0]?.id ?? ''
}, { immediate: true })
watch(currentCandidates, (candidates) => {
  if (candidates.some((candidate) => candidate.id === activeCandidateId.value)) return
  activeCandidateId.value = candidates.find((candidate) => candidate.id === currentShot.value?.selectedCandidateId)?.id
    ?? candidates.find((candidate) => candidate.status === 'ready')?.id
    ?? candidates[0]?.id
    ?? ''
  approveArmedId.value = ''
}, { immediate: true })

function candidateLabel(candidate: Candidate, index: number): string {
  const label = candidate.label.trim()
  if (!label || /^候选\s*\d+$/u.test(label)) return `Candidate ${String.fromCharCode(65 + index)}`
  return label
}
function candidateOrdinal(candidate: Candidate): number {
  const variant = candidate.inputSnapshot.variant
  return typeof variant === 'number' && Number.isInteger(variant) ? variant : Number.MAX_SAFE_INTEGER
}
function mediaFor(candidate: Candidate): MediaReference | undefined {
  return snapshot.value.media.find((media) => media.id === candidate.mediaId)
}
function demoImage(index: number): string {
  if (!isXingque.value || index > 2) return ''
  return `/demo/xingque/candidate-${String(index + 1).padStart(2, '0')}.png`
}
function scoreLabel(candidate: Candidate): string {
  const rubricValues = snapshot.value.reviews
    .filter((review) => review.candidateId === candidate.id)
    .flatMap((review) => Object.values(review.rubric))
  if (!rubricValues.length) return '待评分'
  const score = rubricValues.reduce((sum, value) => sum + value, 0) / rubricValues.length * 5
  return `评分 ${score.toFixed(1)}`
}
function selectPreview(candidateId: string): void {
  activeCandidateId.value = candidateId
  approveArmedId.value = ''
}
function resetInteractionState(): void {
  activeCandidateId.value = ''
  compareIds.value = new Set()
  approveArmedId.value = ''
  retryArmed.value = false
}
function toggleCompare(candidateId: string): void {
  const next = new Set(compareIds.value)
  if (next.has(candidateId)) next.delete(candidateId)
  else if (next.size < 2) next.add(candidateId)
  compareIds.value = next
}
async function toggleFavorite(): Promise<void> {
  if (!activeCandidate.value) return
  await store.annotateCandidate(activeCandidate.value.id, { favorite: !activeCandidate.value.favorite })
}
async function retryFailed(): Promise<void> {
  if (!retryArmed.value) { retryArmed.value = true; return }
  retryArmed.value = false
  for (const batch of failedBatches.value) await store.retryFailedCandidateBatch(batch.id)
}
async function handlePrimary(): Promise<void> {
  if (!activeCandidate.value || !currentShot.value) return
  if (activeCandidate.value.id === currentShot.value.selectedCandidateId) {
    if (nextUnapprovedShot.value) currentShotId.value = nextUnapprovedShot.value.id
    else emit('navigate', 'timeline')
    return
  }
  if (approveArmedId.value !== activeCandidate.value.id) {
    approveArmedId.value = activeCandidate.value.id
    return
  }
  approveArmedId.value = ''
  await store.selectCandidate(currentShot.value.id, activeCandidate.value.id)
}
</script>
