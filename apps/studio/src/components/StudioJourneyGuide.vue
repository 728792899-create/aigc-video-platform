<template>
  <section class="studio-guide" :class="{ 'studio-guide--attention': guide.interruption, 'studio-guide--complete': guide.isComplete }" aria-label="创作任务导航" aria-live="polite">
    <div class="studio-guide__summary">
      <div class="studio-guide__heading">
        <component :is="statusIcon" :size="18" aria-hidden="true" />
        <span>{{ guide.interruption ? '需要先处理' : `第 ${activeStepNumber} / 7 步` }}</span>
        <strong>{{ guide.title }}</strong>
      </div>
      <p><b>为什么现在做：</b>{{ guide.description }}</p>
      <div class="studio-guide__facts"><span>{{ guide.metric }}</span><span>{{ guide.completion }}</span></div>
    </div>

    <ol class="studio-guide__steps" aria-label="创作进度">
      <li v-for="(stage, index) in guide.stages" :key="stage.id" :class="{ completed: stage.completed, current: stage.current }" :aria-current="stage.current ? 'step' : undefined">
        <span class="studio-guide__step-marker"><CircleCheck v-if="stage.completed" :size="13" /><span v-else>{{ index + 1 }}</span></span>
        <span>{{ stage.label }}<span v-if="stage.current" class="visually-hidden">：{{ guide.actionLabel }}</span></span>
      </li>
    </ol>

    <button class="primary-button studio-guide__primary" type="button" :disabled="store.loading" @click="emit('navigate', guide.action)">
      {{ guide.actionLabel }}<ArrowRight :size="16" />
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, CircleAlert, CircleCheck, Compass } from 'lucide-vue-next'
import { useStudioStore } from '../stores/studio.js'
import { deriveStudioGuide, type StudioGuideAction } from '../guidance.js'

const emit = defineEmits<{ navigate: [action: StudioGuideAction] }>()
const store = useStudioStore()
const guide = computed(() => deriveStudioGuide({
  hasProject: Boolean(store.currentProjectId),
  sourceCount: store.snapshot?.sources.length ?? 0,
  eventCount: store.snapshot?.events.length ?? 0,
  shotCount: store.snapshot?.shots.length ?? 0,
  selectedShotCount: store.snapshot?.shots.filter((shot) => shot.selectedCandidateId).length ?? 0,
  candidateCount: store.snapshot?.candidates.filter((candidate) => candidate.status !== 'failed').length ?? 0,
  planStatus: store.currentPlan?.status,
  tasks: store.tasks,
}))
const activeStepNumber = computed(() => guide.value.stages.findIndex((stage) => stage.current) + 1)
const statusIcon = computed(() => guide.value.interruption ? CircleAlert : guide.value.isComplete ? CircleCheck : Compass)
</script>
