<template>
  <nav class="studio-stagebar" aria-label="八阶段创作流程">
    <ol>
      <li v-for="(workspace, index) in stages" :key="workspace.id" :class="{ active: workspace.id === activeStageId, completed: completedIds.has(workspace.id), locked: !availability(workspace).available }">
        <button
          type="button"
          :aria-current="workspace.id === activeStageId ? 'step' : undefined"
          :aria-label="`${index + 1}. ${workspace.shortTitle}${availability(workspace).available ? '' : `，${availability(workspace).reason}`}`"
          @click="$emit('navigate', workspace.id)"
        >
          <span class="studio-stagebar__number" aria-hidden="true">
            <Check v-if="completedIds.has(workspace.id) && workspace.id !== activeStageId" :size="13" />
            <LockKeyhole v-else-if="!availability(workspace).available" :size="12" />
            <span v-else>{{ index + 1 }}</span>
          </span>
          <span class="studio-stagebar__label">{{ workspace.shortTitle }}</span>
          <span v-if="!availability(workspace).available" class="sr-only">尚未解锁</span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check, LockKeyhole } from 'lucide-vue-next'
import {
  STUDIO_WORKSPACES, workspaceAvailability, type StudioWorkspaceFacts, type StudioWorkspaceId,
} from '../workspaces.js'

const props = defineProps<{
  currentId: StudioWorkspaceId
  facts: StudioWorkspaceFacts
  completedIds: ReadonlySet<StudioWorkspaceId>
}>()

defineEmits<{ navigate: [id: StudioWorkspaceId] }>()

const stageIds: StudioWorkspaceId[] = ['brief', 'script', 'assets', 'shots', 'generation', 'review', 'timeline', 'export_settings']
const stages = stageIds.map((id) => STUDIO_WORKSPACES.find((workspace) => workspace.id === id)!)
const activeStageId = computed<StudioWorkspaceId>(() => props.currentId === 'continuity' ? 'shots' : props.currentId)
function availability(workspace: (typeof stages)[number]) { return workspaceAvailability(workspace, props.facts) }
</script>
