<template>
  <aside v-if="stage" class="studio-inspector" aria-live="polite">
    <header class="studio-inspector__header">
      <span class="studio-inspector__icon"><StudioIcon :name="stage.kind" :size="23" /></span>
      <div>
        <p>{{ $t('studio.currentProject') }}</p>
        <h2>{{ $t(`studio.node.${stage.kind}.title`) }}</h2>
      </div>
      <button type="button" :aria-label="$t('common.close')" @click="$emit('close')"><StudioIcon name="close" :size="17" /></button>
    </header>

    <div class="studio-inspector__status" :class="`status-${stage.status}`">
      <span></span>
      {{ $t(`studio.status.${stage.status}`) }}
    </div>
    <p class="studio-inspector__description">{{ $t(`studio.node.${stage.kind}.description`) }}</p>

    <dl class="studio-inspector__facts">
      <div><dt>{{ $t('studio.progress', { done: stage.completed, total: stage.total }) }}</dt><dd>{{ Math.round(progress) }}%</dd></div>
      <div v-if="stage.taskId"><dt>Task ID</dt><dd :title="stage.taskId">{{ shortTaskId }}</dd></div>
      <div v-if="stage.stale"><dt>{{ $t('studio.stale') }}</dt><dd>stale</dd></div>
    </dl>

    <div v-if="stage.diagnosis" class="studio-inspector__diagnosis">
      <StudioIcon name="warning" :size="17" />
      <p>{{ stage.diagnosis }}</p>
    </div>

    <div class="studio-inspector__actions">
      <StudioButton variant="primary" icon="chevron" @click="$emit('open', stage.route)">{{ $t('studio.openStage') }}</StudioButton>
      <StudioButton v-if="stage.diagnosis" variant="secondary" icon="warning" @click="$emit('diagnose', stage)">{{ $t('studio.diagnose') }}</StudioButton>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { StudioGraphNode } from '../../domain/studioGraph'
import StudioButton from './StudioButton.vue'
import StudioIcon from './StudioIcon.vue'

const props = defineProps<{ stage: StudioGraphNode | null }>()

defineEmits<{
  close: []
  open: [route: string]
  diagnose: [stage: StudioGraphNode]
}>()

const progress = computed(() => props.stage ? (props.stage.completed / Math.max(props.stage.total, 1)) * 100 : 0)
const shortTaskId = computed(() => props.stage?.taskId ? `${props.stage.taskId.slice(0, 8)}…` : '')
</script>

<style scoped>
.studio-inspector { width: 318px; height: 100%; flex: 0 0 auto; padding: 22px; border-left: 1px solid var(--studio-border); color: var(--studio-text); background: color-mix(in srgb, var(--studio-surface) 94%, transparent); backdrop-filter: blur(24px); overflow-y: auto; }
.studio-inspector__header { display: grid; grid-template-columns: 42px minmax(0, 1fr) 30px; align-items: center; gap: 11px; }
.studio-inspector__icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 14px; color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 12%, transparent); }
.studio-inspector__header p { margin: 0 0 3px; color: var(--studio-text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.studio-inspector__header h2 { margin: 0; font-size: 17px; }
.studio-inspector__header button { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 9px; color: var(--studio-text-muted); background: transparent; cursor: pointer; }
.studio-inspector__header button:hover { color: var(--studio-text); background: var(--studio-surface-hover); }
.studio-inspector__status { display: inline-flex; align-items: center; gap: 7px; margin-top: 24px; padding: 6px 10px; border: 1px solid var(--studio-border); border-radius: 999px; color: var(--studio-text-soft); font-size: 11px; font-weight: 700; }
.studio-inspector__status span { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.studio-inspector__status.status-complete { color: var(--studio-success); }
.studio-inspector__status.status-running { color: var(--studio-accent); }
.studio-inspector__status.status-attention { color: var(--studio-warning); }
.studio-inspector__status.status-failed { color: var(--studio-danger); }
.studio-inspector__description { margin: 16px 0 20px; color: var(--studio-text-soft); font-size: 13px; line-height: 1.65; }
.studio-inspector__facts { display: grid; gap: 8px; margin: 0; }
.studio-inspector__facts div { display: flex; justify-content: space-between; gap: 12px; padding: 11px 12px; border: 1px solid var(--studio-border); border-radius: 11px; background: var(--studio-surface-strong); }
.studio-inspector__facts dt { color: var(--studio-text-muted); font-size: 11px; }
.studio-inspector__facts dd { max-width: 140px; margin: 0; overflow: hidden; color: var(--studio-text); font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.studio-inspector__diagnosis { display: flex; gap: 9px; margin-top: 14px; padding: 12px; border: 1px solid color-mix(in srgb, var(--studio-warning) 35%, transparent); border-radius: 12px; color: var(--studio-warning); background: color-mix(in srgb, var(--studio-warning) 8%, transparent); }
.studio-inspector__diagnosis p { margin: 0; color: var(--studio-text-soft); font-size: 12px; line-height: 1.55; }
.studio-inspector__actions { display: grid; gap: 9px; margin-top: 22px; }
</style>
