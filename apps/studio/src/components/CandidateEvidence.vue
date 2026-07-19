<template>
  <section class="candidate-evidence" aria-label="候选质量与版本证据">
    <h3>质量与版本证据</h3>
    <dl class="inspector__facts">
      <div><dt>自动 Critic</dt><dd>{{ critic ? decisionLabel(critic.decision) : '未运行' }}</dd></div>
      <div><dt>人工决策</dt><dd>{{ human ? decisionLabel(human.decision) : '待人工选择' }}</dd></div>
      <div><dt>评审 Artifact</dt><dd>{{ reviewArtifact ? `r${reviewArtifact.revision} · ${shortId(reviewArtifact.contentHash)}` : '无' }}</dd></div>
      <div><dt>批准 Artifact</dt><dd>{{ approvalArtifact ? `r${approvalArtifact.revision} · ${shortId(approvalArtifact.contentHash)}` : '未创建' }}</dd></div>
      <div><dt>Provider 媒体输入</dt><dd>{{ providerMediaOrder.length }} 个有序快照</dd></div>
    </dl>
    <details v-if="providerMediaOrder.length" class="candidate-media-order"><summary>查看实际引用顺序</summary><ol><li v-for="item in providerMediaOrder" :key="item"><code>{{ item }}</code></li></ol></details>
    <div v-if="rubric.length" class="candidate-rubric" aria-label="自动评审量表">
      <span v-for="entry in rubric" :key="entry.key"><strong>{{ rubricLabel(entry.key) }}</strong>{{ Math.round(entry.score * 100) }}</span>
    </div>
    <ul v-if="critic?.reasons.length" class="candidate-reasons"><li v-for="reason in critic.reasons" :key="reason">{{ reason }}</li></ul>
    <p v-else class="muted">自动评审不会代替人工批准。</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ArtifactVersion, Candidate, ReviewDecision } from '@aigc-director/contracts'

const props = defineProps<{
  candidate: Candidate
  reviews: ReviewDecision[]
  artifacts: ArtifactVersion[]
}>()

const critic = computed(() => props.reviews.find((review) => review.candidateId === props.candidate.id && review.source === 'automatic_critic'))
const human = computed(() => props.reviews.find((review) => review.candidateId === props.candidate.id && review.source === 'human'))
const reviewArtifact = computed(() => props.artifacts.find((artifact) => artifact.stageId === `image-review:${props.candidate.shotId}`))
const approvalArtifact = computed(() => props.artifacts.find((artifact) => artifact.stageId === `approved-candidate:${props.candidate.shotId}` && artifact.content.candidateId === props.candidate.id))
const rubric = computed(() => Object.entries(critic.value?.rubric ?? {}).map(([key, score]) => ({ key, score })))
const providerMediaOrder = computed(() => Array.isArray(props.candidate.inputSnapshot.providerMediaOrder)
  ? props.candidate.inputSnapshot.providerMediaOrder.filter((item): item is string => typeof item === 'string')
  : [])
const decisionLabel = (decision: ReviewDecision['decision']): string => ({ pending: '待人工确认', approved: '已批准', rejected: '已驳回' })[decision]
const rubricLabel = (key: string): string => ({ identity: '身份', continuity: '连续性', technicalQuality: '技术' })[key] ?? key
const shortId = (value: string): string => `${value.slice(0, 8)}…`
</script>
