<template>
  <section class="candidate-review" data-guide-target="candidate-review" aria-label="镜头候选批次评审" tabindex="0" @keydown="handleKeydown">
    <header class="candidate-review__header">
      <div><strong>{{ filtered.length }} / {{ candidates.length }} 个候选</strong><small>{{ batchSummary }}</small></div>
      <div class="candidate-review__filters" role="group" aria-label="候选筛选">
        <button type="button" :aria-pressed="filter === 'all'" @click="filter = 'all'">全部</button>
        <button type="button" :aria-pressed="filter === 'favorite'" @click="filter = 'favorite'">收藏</button>
      </div>
    </header>
    <div v-for="batch in failedBatches" :key="batch.id" class="candidate-review__retry">
      <span>{{ batch.failedCount }} 个失败项 · 原批次保留</span>
      <button type="button" @click="requestRetry(batch.id)">{{ pendingRetryBatchId === batch.id ? '确认创建新批次' : '重试失败项' }}</button>
    </div>
    <div v-if="visible.length" class="candidate-review__list" role="listbox" :aria-activedescendant="activeCandidate ? `candidate-review-${activeCandidate.id}` : undefined">
      <article
        v-for="candidate in visible"
        :id="`candidate-review-${candidate.id}`"
        :key="candidate.id"
        class="candidate-review__item"
        :class="{ active: candidate.id === activeCandidate?.id, selected: candidate.id === selectedCandidateId }"
        role="option"
        :aria-selected="candidate.id === selectedCandidateId"
        @click="activate(candidate.id)"
        @dblclick="$emit('openCandidate', candidate.id)"
      >
        <button class="candidate-review__open" type="button" @click.stop="$emit('openCandidate', candidate.id)">
          <span>{{ candidate.label || `候选 ${candidate.id.slice(0, 6)}` }}</span>
          <small>{{ candidate.model }} · {{ batchLabel(candidate.batchId) }}</small>
        </button>
        <div class="candidate-review__actions">
          <button type="button" :aria-label="candidate.favorite ? '取消收藏' : '收藏候选'" :aria-pressed="candidate.favorite" @click.stop="$emit('annotate', candidate.id, { favorite: !candidate.favorite })">{{ candidate.favorite ? '★' : '☆' }}</button>
          <button type="button" :aria-label="compareIds.has(candidate.id) ? '移出比较' : '加入比较'" :aria-pressed="compareIds.has(candidate.id)" @click.stop="toggleCompare(candidate.id)">比较</button>
          <button v-if="candidate.id !== selectedCandidateId" type="button" @click.stop="$emit('selectCandidate', candidate.id)">批准</button>
          <span v-else class="candidate-review__selected">已批准</span>
        </div>
        <ul v-if="candidate.tags.length" class="candidate-review__tags"><li v-for="tag in candidate.tags" :key="tag">{{ tag }}</li></ul>
      </article>
    </div>
    <p v-else class="muted">{{ candidates.length ? '没有符合筛选条件的候选。' : '生成后会按批次累积候选，不覆盖当前选择。' }}</p>
    <footer v-if="filtered.length > pageSize" class="candidate-review__pager">
      <button type="button" :disabled="page === 0" @click="page -= 1">上一页</button><span>{{ page + 1 }} / {{ pageCount }}</span><button type="button" :disabled="page + 1 >= pageCount" @click="page += 1">下一页</button>
    </footer>
    <p v-if="compareIds.size" class="candidate-review__compare">已选 {{ compareIds.size }} 个并排比较项；候选选择与收藏状态相互独立。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Candidate, CandidateBatch } from '@aigc-director/contracts'

const props = defineProps<{ candidates: Candidate[]; batches: CandidateBatch[]; selectedCandidateId?: string | undefined }>()
const emit = defineEmits<{
  openCandidate: [candidateId: string]
  selectCandidate: [candidateId: string]
  annotate: [candidateId: string, patch: { favorite?: boolean; label?: string; tags?: string[] }]
  retryFailedBatch: [batchId: string]
}>()
const filter = ref<'all' | 'favorite'>('all')
const page = ref(0)
const pageSize = 50
const activeId = ref<string>()
const compareIds = ref(new Set<string>())
const pendingRetryBatchId = ref<string>()
const filtered = computed(() => props.candidates.filter((candidate) => filter.value === 'all' || candidate.favorite))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visible = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const activeCandidate = computed(() => filtered.value.find((candidate) => candidate.id === activeId.value) ?? filtered.value[0])
const batchSummary = computed(() => props.batches.length
  ? `${props.batches.length} 个批次 · ${props.batches.filter((batch) => batch.status === 'succeeded').length} 已完成`
  : '旧候选 · 尚无批次 lineage')
const failedBatches = computed(() => props.batches.filter((batch) => batch.failedCount > 0 && ['partial', 'failed'].includes(batch.status)))

watch(filter, () => { page.value = 0; activeId.value = undefined })
watch(() => props.candidates.map((candidate) => candidate.id).join(','), () => {
  compareIds.value = new Set([...compareIds.value].filter((id) => props.candidates.some((candidate) => candidate.id === id)))
})

function batchLabel(batchId?: string): string {
  if (!batchId) return '旧候选'
  const batch = props.batches.find((item) => item.id === batchId)
  return batch ? `${batch.source} · ${batch.status}` : '批次已归档'
}

function activate(candidateId: string): void {
  activeId.value = candidateId
}

function toggleCompare(candidateId: string): void {
  const next = new Set(compareIds.value)
  if (next.has(candidateId)) next.delete(candidateId)
  else if (next.size < 2) next.add(candidateId)
  compareIds.value = next
}

function requestRetry(batchId: string): void {
  if (pendingRetryBatchId.value === batchId) {
    pendingRetryBatchId.value = undefined
    emit('retryFailedBatch', batchId)
    return
  }
  pendingRetryBatchId.value = batchId
}

function handleKeydown(event: KeyboardEvent): void {
  if (filtered.value.length === 0) return
  const current = Math.max(0, filtered.value.findIndex((candidate) => candidate.id === activeCandidate.value?.id))
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    activeId.value = filtered.value[Math.min(filtered.value.length - 1, current + 1)]?.id
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    activeId.value = filtered.value[Math.max(0, current - 1)]?.id
  } else if (event.key === 'Enter' && activeCandidate.value) {
    event.preventDefault()
    emit('openCandidate', activeCandidate.value.id)
  } else if (event.key === ' ' && activeCandidate.value) {
    event.preventDefault()
    emit('annotate', activeCandidate.value.id, { favorite: !activeCandidate.value.favorite })
  }
}
</script>
