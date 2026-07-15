<template>
  <div class="workflow-rail" :class="{ compact }" role="list" aria-label="创作流程">
    <div
      v-for="stage in normalized"
      :key="stage.key"
      class="workflow-stage"
      :class="`is-${stage.status}`"
      role="listitem"
      :title="stage.error || stage.label"
    >
      <span class="stage-index">{{ stage.index + 1 }}</span>
      <span class="stage-label">{{ stage.label }}</span>
      <span v-if="!compact && stage.attempts > 1" class="stage-attempt">×{{ stage.attempts }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface WorkflowStageState { status?: string; attempts?: number; error?: string }
interface WorkflowState { stages?: Record<string, WorkflowStageState> }

const props = withDefaults(defineProps<{ workflow?: WorkflowState | null; compact?: boolean }>(), {
  workflow: null,
  compact: false,
})

const STAGES: Array<[key: string, label: string]> = [
  ['topic', '主题'], ['script', '脚本'], ['storyboard', '分镜'], ['image', '图片'],
  ['voice', '配音'], ['subtitle', '字幕'], ['timeline', '时间线'], ['export', '导出'],
]

const normalized = computed(() => STAGES.map(([key, label], index) => ({
  key,
  label,
  index,
  status: props.workflow?.stages?.[key]?.status || (index === 0 ? 'succeeded' : 'pending'),
  attempts: props.workflow?.stages?.[key]?.attempts || 0,
  error: props.workflow?.stages?.[key]?.error || '',
})))
</script>

<style scoped>
.workflow-rail { display:flex; align-items:center; gap:6px; overflow-x:auto; padding:4px 0; }
.workflow-stage { display:inline-flex; align-items:center; gap:5px; min-width:max-content; color:var(--text-muted); font-size:12px; }
.workflow-stage:not(:last-child)::after { content:'›'; margin-left:2px; color:var(--separator); }
.stage-index { width:18px; height:18px; display:grid; place-items:center; border-radius:50%; background:var(--separator); color:var(--text-second); font-size:10px; font-weight:700; }
.is-succeeded, .is-skipped { color:var(--success); }
.is-succeeded .stage-index, .is-skipped .stage-index { background:rgba(52,199,89,.16); color:var(--success); }
.is-running, .is-ready { color:var(--primary); font-weight:700; }
.is-running .stage-index, .is-ready .stage-index { background:var(--primary-soft); color:var(--primary); box-shadow:0 0 0 3px rgba(0,122,255,.08); }
.is-failed, .is-canceled { color:var(--danger); }
.is-failed .stage-index, .is-canceled .stage-index { background:rgba(255,59,48,.14); color:var(--danger); }
.is-partial { color:var(--warning); }
.is-partial .stage-index { background:rgba(255,159,10,.16); color:var(--warning); }
.stage-attempt { font-size:10px; opacity:.75; }
.compact .stage-label { display:none; }
.compact { gap:3px; }
</style>
