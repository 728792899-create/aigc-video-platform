<template>
  <section class="workspace-header" :class="{ 'workspace-header--locked': !availability.available }" aria-labelledby="workspace-title">
    <div class="workspace-header__summary">
      <span class="eyebrow">{{ definition.domainView.toUpperCase() }} / {{ statusLabel }}</span>
      <h2 id="workspace-title">{{ definition.title }}</h2>
      <p>{{ definition.description }}</p>
      <dl>
        <div><dt>当前任务</dt><dd>{{ availability.available ? definition.primaryAction : availability.reason }}</dd></div>
        <div><dt>完成条件</dt><dd>{{ definition.completion }}</dd></div>
      </dl>
      <p v-if="definition.currentAlternative" class="workspace-header__notice"><Info :size="15" />{{ definition.currentAlternative }}</p>
    </div>
    <div class="workspace-header__actions">
      <button v-if="definition.previous" class="secondary-button" type="button" @click="$emit('navigate', definition.previous)">
        <ArrowLeft :size="16" />返回{{ previousTitle }}
      </button>
      <button class="secondary-button" type="button" @click="$emit('help')"><CircleHelp :size="16" />查看说明</button>
      <button v-if="returnLabel" class="secondary-button workspace-header__return" type="button" @click="$emit('returnToSource')"><CornerUpLeft :size="16" />{{ returnLabel }}</button>
      <button
        v-if="availability.available"
        class="primary-button workspace-header__primary"
        type="button"
        :disabled="busy"
        @click="$emit('primary')"
      >
        <LoaderCircle v-if="busy" class="spin" :size="16" />
        <Play v-else :size="16" />{{ definition.primaryAction }}
      </button>
      <button v-else class="primary-button workspace-header__primary" type="button" @click="$emit('navigate', availability.alternativeWorkspace ?? 'project_center')">
        <LockKeyhole :size="16" />{{ alternativeLabel }}
      </button>
      <button v-if="definition.next && nextAvailable" class="workspace-header__next" type="button" @click="$emit('navigate', definition.next)">
        下一阶段：{{ nextTitle }}<ArrowRight :size="15" />
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, ArrowRight, CircleHelp, CornerUpLeft, Info, LoaderCircle, LockKeyhole, Play } from 'lucide-vue-next'
import { workspaceById, type StudioWorkspaceAvailability, type StudioWorkspaceDefinition, type StudioWorkspaceId } from '../workspaces.js'

const props = defineProps<{
  definition: StudioWorkspaceDefinition
  availability: StudioWorkspaceAvailability
  nextAvailable: boolean
  busy?: boolean
  returnLabel: string | undefined
}>()

defineEmits<{
  navigate: [id: StudioWorkspaceId]
  primary: []
  help: []
  returnToSource: []
}>()

const statusLabel = computed(() => ({ implemented: '已实现', partial: '部分可用', planned: '规划中' })[props.definition.implementation])
const previousTitle = computed(() => props.definition.previous ? workspaceById(props.definition.previous).shortTitle : '')
const nextTitle = computed(() => props.definition.next ? workspaceById(props.definition.next).shortTitle : '')
const alternativeLabel = computed(() => props.availability.alternativeWorkspace ? `先前往${workspaceById(props.availability.alternativeWorkspace).shortTitle}` : '查看可用路径')
</script>
