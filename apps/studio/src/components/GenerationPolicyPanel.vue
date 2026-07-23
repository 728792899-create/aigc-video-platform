<template>
  <section class="generation-policy" aria-labelledby="generation-policy-title">
    <header>
      <div>
        <span class="eyebrow">SAFETY &amp; BUDGET</span>
        <h3 id="generation-policy-title">项目生成策略</h3>
        <p>并发、候选、导出时长和用户自付 Provider 预算均在任务创建前强制校验。</p>
      </div>
      <span v-if="policy" class="status-pill">r{{ policy.revision }}</span>
    </header>

    <div v-if="!store.currentProjectId" class="task-empty">选择项目后可查看并调整项目级安全边界。</div>
    <form v-else-if="policy" class="generation-policy__form" @submit.prevent="save">
      <div class="generation-policy__limits">
        <label>
          Provider 模式
          <select v-model="draft.billingMode">
            <option value="demo-only">零 Key Demo（不联网）</option>
            <option value="user-funded">用户自付 Provider</option>
          </select>
        </label>
        <label>
          每日成本上限（USD）
          <input v-model.number="draft.dailyBudgetUsd" type="number" min="0" max="9007199254" step="0.01" :disabled="draft.billingMode === 'demo-only'" required />
        </label>
        <label>
          最大并发任务
          <input v-model.number="draft.maxConcurrentTasks" type="number" min="1" max="32" required />
        </label>
        <label>
          单批最大候选
          <input v-model.number="draft.maxCandidatesPerBatch" type="number" min="1" max="8" required />
        </label>
        <label>
          单次导出最长（秒）
          <input v-model.number="draft.maxExportDurationSeconds" type="number" min="5" max="3600" required />
        </label>
      </div>
      <dl class="generation-policy__facts">
        <div><dt>Provider</dt><dd>{{ draft.billingMode === 'demo-only' ? '外部 Provider 关闭' : '用户自付 · 本地预算门禁' }}</dd></div>
        <div><dt>今日账本</dt><dd>{{ formatUsd(store.taskAdmission?.dailyPaidSpentMicros ?? 0) }} / {{ formatUsd(policy.dailyPaidBudgetMicros) }}</dd></div>
        <div><dt>当前并发</dt><dd>{{ store.taskAdmission?.activeTasks ?? 0 }} / {{ policy.maxConcurrentTasks }}</dd></div>
      </dl>
      <p v-if="draft.billingMode === 'user-funded'" class="generation-policy__danger">
        外部服务由你直接付费。本产品不会代扣，但提交成功后可能已经产生费用；未知结果必须先对账，不能直接重试。
      </p>
      <p class="generation-policy__warning">降低边界不会取消已存在任务；新的生成、重试和导出会立即使用新 revision。</p>
      <button class="primary-button" type="submit" :disabled="store.loading || !valid">
        {{ armed ? (draft.billingMode === 'user-funded' ? '确认启用用户自付 Provider' : '再次确认保存策略') : '保存安全策略' }}
      </button>
    </form>
    <div v-else class="task-empty">正在读取项目生成策略。</div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const policy = computed(() => store.generationPolicy)
const armed = ref(false)
const draft = reactive({ billingMode: 'demo-only' as 'demo-only' | 'user-funded', dailyBudgetUsd: 0, maxConcurrentTasks: 4, maxCandidatesPerBatch: 4, maxExportDurationSeconds: 3600 })

watch(policy, (next) => {
  if (!next) return
  draft.billingMode = next.billingMode
  draft.dailyBudgetUsd = next.dailyPaidBudgetMicros / 1_000_000
  draft.maxConcurrentTasks = next.maxConcurrentTasks
  draft.maxCandidatesPerBatch = next.maxCandidatesPerBatch
  draft.maxExportDurationSeconds = Math.round(next.maxExportDurationMs / 1000)
  armed.value = false
}, { immediate: true })

const valid = computed(() => (
  Number.isFinite(draft.dailyBudgetUsd) && draft.dailyBudgetUsd >= 0
  && (draft.billingMode === 'demo-only' || draft.dailyBudgetUsd > 0)
  && Number.isInteger(draft.maxConcurrentTasks) && draft.maxConcurrentTasks >= 1 && draft.maxConcurrentTasks <= 32
  && Number.isInteger(draft.maxCandidatesPerBatch) && draft.maxCandidatesPerBatch >= 1 && draft.maxCandidatesPerBatch <= 8
  && Number.isInteger(draft.maxExportDurationSeconds) && draft.maxExportDurationSeconds >= 5 && draft.maxExportDurationSeconds <= 3600
))

function formatUsd(micros: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(micros / 1_000_000)
}

async function save(): Promise<void> {
  if (!valid.value) return
  if (!armed.value) { armed.value = true; return }
  armed.value = false
  await store.updateGenerationPolicy({
    billingMode: draft.billingMode,
    dailyPaidBudgetMicros: draft.billingMode === 'user-funded' ? Math.round(draft.dailyBudgetUsd * 1_000_000) : 0,
    maxConcurrentTasks: draft.maxConcurrentTasks,
    maxCandidatesPerBatch: draft.maxCandidatesPerBatch,
    maxExportDurationMs: draft.maxExportDurationSeconds * 1000,
  })
}
</script>
