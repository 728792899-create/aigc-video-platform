<template>
  <section class="workbench-guide" :class="statusClass">
    <div class="guide-main">
      <div class="guide-kicker">{{ title }}</div>
      <div class="guide-title">{{ guide?.summary || '正在检查项目状态' }}</div>
      <div class="guide-subtitle">{{ guide?.next_action || '稍等片刻，系统会给出下一步建议' }}</div>
    </div>
    <div v-if="guide?.progress_steps?.length" class="guide-steps">
      <div
        v-for="step in guide.progress_steps"
        :key="step.key"
        class="guide-step"
        :class="{ done: step.done, active: guide.current_step === step.key }"
      >
        <span class="step-dot"></span>
        <span>{{ step.label }}</span>
      </div>
    </div>
    <div class="guide-actions">
      <el-tag class="guide-state" :type="tagType" effect="plain">{{ guide?.status_label || '检查中' }}</el-tag>
      <el-button v-if="showRepair" size="small" plain :loading="repairing" @click="$emit('repair', repairType)">
        一键修复
      </el-button>
      <el-button v-if="guide?.primary_action" size="small" type="primary" @click="$emit('primary', guide.primary_action)">
        {{ guide.primary_action.label }}
      </el-button>
      <el-button size="small" text @click="$emit('refresh')">刷新</el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface RepairItem { type: string }
interface ProgressStep { key: string; label: string; done?: boolean }
interface PrimaryAction { label: string; [key: string]: unknown }
interface WorkbenchGuide {
  status?: string
  status_label?: string
  summary?: string
  next_action?: string
  current_step?: string
  progress_steps?: ProgressStep[]
  repair_items?: RepairItem[]
  primary_action?: PrimaryAction
}

const props = withDefaults(defineProps<{
  guide?: WorkbenchGuide | null
  repairing?: boolean
  title?: string
}>(), { guide: null, repairing: false, title: '创作工作台' })

defineEmits<{
  repair: [type: string]
  primary: [action: PrimaryAction]
  refresh: []
}>()

const statusClass = computed(() => {
  if (!props.guide) return 'is-loading'
  return `is-${props.guide.status || 'ready'}`
})

const tagType = computed<'danger' | 'warning' | 'success'>(() => {
  if (props.guide?.status === 'must_fix') return 'danger'
  if (props.guide?.status === 'suggest_optimize') return 'warning'
  return 'success'
})

const repairType = computed(() => {
  const item = props.guide?.repair_items?.find((x) => x.type !== 'timeline')
  return item?.type || 'auto'
})

const showRepair = computed(() => {
  return !!props.guide?.repair_items?.some((x) => x.type !== 'timeline') && props.guide?.status !== 'ready'
})
</script>

<style scoped>
.workbench-guide {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto auto;
  align-items: center;
  gap: 18px;
  padding: 14px 16px;
  margin-bottom: 18px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(18px);
}

[data-theme="dark"] .workbench-guide {
  background: rgba(28, 28, 30, 0.78);
}

.guide-kicker {
  font-size: 12px;
  color: var(--primary);
  font-weight: 700;
  margin-bottom: 2px;
}

.guide-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.guide-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-second);
}

.guide-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  max-width: 520px;
}

.guide-step {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.step-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--separator);
}

.guide-step.done {
  color: var(--success);
}

.guide-step.done .step-dot {
  background: var(--success);
}

.guide-step.active {
  color: var(--primary);
  font-weight: 700;
}

.guide-step.active .step-dot {
  background: var(--primary);
  box-shadow: 0 0 0 4px var(--primary-soft);
}

.guide-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.guide-state {
  border-radius: var(--radius-pill);
}

.is-must_fix {
  border-color: rgba(255, 59, 48, 0.2);
}

.is-suggest_optimize {
  border-color: rgba(255, 159, 10, 0.22);
}

@media (max-width: 1100px) {
  .workbench-guide {
    grid-template-columns: 1fr;
  }
  .guide-actions {
    justify-content: flex-start;
  }
}
</style>
