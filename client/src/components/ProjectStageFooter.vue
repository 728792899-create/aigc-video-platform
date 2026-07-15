<template>
  <div class="project-stage-footer" :class="{ 'is-ready': ready }">
    <div class="stage-copy">
      <div class="stage-label">{{ currentStage }}</div>
      <div class="stage-title">{{ title }}</div>
      <p class="stage-hint">{{ hintText }}</p>
    </div>
    <el-button
      class="stage-action"
      type="primary"
      :plain="!ready"
      :disabled="!ready"
      @click="$emit('go-next')"
    >
      {{ actionLabel }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  currentStage: string
  nextStage?: string
  ready?: boolean
  blockedReason?: string
  actionLabel?: string
  readyHint?: string
}>(), { nextStage: '', ready: false, blockedReason: '', actionLabel: '', readyHint: '' })

defineEmits<{ 'go-next': [] }>()

const title = computed(() => {
  if (props.nextStage) return `下一步：${props.nextStage}`
  return '当前阶段已进入最终预览'
})

const hintText = computed(() => {
  if (props.ready) return props.readyHint || '当前阶段已满足进入下一步的条件。'
  return props.blockedReason || '完成当前阶段的关键内容后即可继续。'
})
</script>

<style scoped>
.project-stage-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  margin-top: 18px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}

.project-stage-footer.is-ready {
  border-color: rgba(0, 122, 255, 0.22);
  background: linear-gradient(180deg, var(--bg-surface), var(--primary-soft));
}

.stage-copy {
  min-width: 0;
}

.stage-label {
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
}

.stage-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.stage-hint {
  margin: 4px 0 0;
  color: var(--text-second);
  font-size: 13px;
  line-height: 1.5;
}

.stage-action {
  flex: 0 0 auto;
}

@media (max-width: 640px) {
  .project-stage-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .stage-action {
    width: 100%;
  }
}
</style>
