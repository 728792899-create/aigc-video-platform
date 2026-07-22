<template>
  <aside class="agent-panel" data-guide-target="agent-plan" :class="{ 'agent-panel--open': open }" aria-label="AI 导演计划">
    <button class="agent-panel__toggle" type="button" :aria-expanded="open" @click="open = !open">
      <Bot :size="18" /><span>导演 Agent</span><ChevronRight :size="15" :class="{ rotate: open }" />
    </button>
    <div v-if="open" class="agent-panel__body">
      <div class="agent-intro"><span class="eyebrow">DECISION LAYER</span><h2>让计划先于执行</h2><p>分析可以自动运行；写入项目和导出会停在持久审批点。</p></div>
      <div v-if="!store.currentPlan" class="agent-empty">
        <p>{{ canPlan ? '事件图谱已就绪，可以生成结构化制作计划。' : '先导入原著并形成事件图谱。' }}</p>
        <button class="primary-button" type="button" :disabled="!canPlan || store.loading" @click="store.createPlan"><Sparkles :size="16" />生成计划</button>
      </div>
      <div v-else class="plan-card">
        <header><div><span class="status-pill">{{ store.currentPlan.status }}</span><h3>{{ store.currentPlan.title }}</h3></div><small>checkpoint {{ store.currentPlan.checkpointRevision }}</small></header>
        <section v-if="store.currentCheckpoint" class="plan-memory-evidence" aria-label="Agent 记忆证据">
          <header><strong>记忆证据</strong><span>{{ store.currentCheckpoint.memoryCitations.length }} 条引用</span></header>
          <p v-if="store.currentCheckpoint.memoryCitations.length === 0">本次计划未采用可追溯记忆。</p>
          <ul v-else>
            <li v-for="citation in store.currentCheckpoint.memoryCitations.slice(0, 5)" :key="citation.memoryId">
              <span>{{ citation.scope }} · {{ citation.sourceType }} r{{ citation.sourceRevision }}</span>
              <small>{{ citation.reasons.join('·') }}</small>
            </li>
          </ul>
          <small>context {{ store.currentCheckpoint.memoryContextHash.slice(0, 10) }}… · 仅保存 ID/hash/revision，不复制记忆正文。</small>
        </section>
        <ol class="plan-steps">
          <li v-for="step in store.currentPlan.steps" :key="step.id"><span :class="`risk risk--${step.risk}`">{{ riskLabel(step.risk) }}</span><div><strong>{{ step.title }}</strong><p>{{ step.description }}</p></div></li>
        </ol>
        <button v-if="store.approvalToken" class="primary-button primary-button--wide" type="button" :disabled="store.loading" @click="store.approvePlan"><ShieldCheck :size="16" />批准写入场景与镜头</button>
        <button v-else-if="store.currentPlan.status === 'awaiting_approval'" class="secondary-button secondary-button--wide" type="button" :disabled="store.loading" @click="store.createPlan"><RefreshCw :size="16" />重新签发本次审批</button>
        <button v-else-if="store.currentPlan.status === 'approved'" class="primary-button primary-button--wide" type="button" :disabled="store.loading" @click="store.produceDemo"><Clapperboard :size="16" />生成本地 Demo 候选</button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Bot, ChevronRight, Clapperboard, RefreshCw, ShieldCheck, Sparkles } from 'lucide-vue-next'
import type { ExecutionPlan } from '@aigc-director/contracts'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const open = ref(!(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)').matches))
const canPlan = computed(() => (store.snapshot?.events.length ?? 0) > 0)
type Risk = ExecutionPlan['steps'][number]['risk']
const riskLabel = (risk: Risk): string => ({ read_only: '只读', writes_project: '写入', paid_provider: '付费', destructive: '删除', export: '导出' })[risk]

async function openPanel(): Promise<void> {
  open.value = true
  await nextTick()
  document.querySelector<HTMLElement>('[data-guide-target="agent-plan"] .plan-card button, [data-guide-target="agent-plan"] .agent-empty button')?.focus()
}

defineExpose({ openPanel })
</script>
