<template>
  <article
    class="studio-node"
    :class="[`status-${stage.status}`, { 'is-selected': selected, 'is-stale': stage.stale }]"
    role="button"
    tabindex="0"
    :aria-label="`${title}，${statusLabel}`"
    :aria-pressed="selected"
    @click.stop="$emit('select', stage.id)"
    @dblclick.stop="$emit('open', stage.route)"
    @keydown.enter.prevent="$emit('open', stage.route)"
    @keydown.space.prevent="$emit('select', stage.id)"
  >
    <Handle type="target" :position="Position.Left" class="studio-handle" />
    <header class="studio-node__header">
      <span class="studio-node__icon"><StudioIcon :name="stage.kind" :size="21" /></span>
      <div>
        <div class="studio-node__eyebrow">
          <span class="studio-status-dot"></span>
          {{ statusLabel }}
          <span v-if="stage.optional" class="studio-node__optional">{{ $t('studio.optional') }}</span>
        </div>
        <h3>{{ title }}</h3>
      </div>
      <span class="studio-node__open" aria-hidden="true">
        <StudioIcon name="chevron" :size="17" />
      </span>
    </header>
    <p>{{ description }}</p>
    <footer class="studio-node__footer">
      <span>{{ $t('studio.progress', { done: stage.completed, total: stage.total }) }}</span>
      <span v-if="stage.stale" class="studio-node__flag"><StudioIcon name="warning" :size="13" />{{ $t('studio.stale') }}</span>
      <span v-else-if="stage.status === 'running'" class="studio-node__flag"><StudioIcon name="quick" :size="13" />{{ $t('studio.taskRunning') }}</span>
    </footer>
    <Handle type="source" :position="Position.Right" class="studio-handle" />
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

import type { StudioCanvasNodeData } from '../../domain/studioLayout'
import StudioIcon from './StudioIcon.vue'

const props = withDefaults(defineProps<{
  data: StudioCanvasNodeData
  selected?: boolean
}>(), { selected: false })

defineEmits<{
  select: [id: string]
  open: [route: string]
}>()

const { t } = useI18n()
const stage = computed(() => props.data.stage)
const title = computed(() => String(t(`studio.node.${stage.value.kind}.title`)))
const description = computed(() => String(t(`studio.node.${stage.value.kind}.description`)))
const statusLabel = computed(() => String(t(`studio.status.${stage.value.status}`)))
</script>

<style scoped>
.studio-node {
  width: 264px;
  min-height: 156px;
  padding: 16px;
  border: 1px solid var(--studio-border);
  border-radius: 17px;
  color: var(--studio-text);
  background: linear-gradient(145deg, color-mix(in srgb, var(--studio-surface-strong) 96%, white 4%), var(--studio-surface));
  box-shadow: 0 16px 42px rgba(0, 0, 0, .19);
  cursor: default;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}
.studio-node:hover { border-color: var(--studio-border-strong); transform: translateY(-2px); }
.studio-node:focus-visible, .studio-node.is-selected { outline: none; border-color: var(--studio-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--studio-accent) 18%, transparent), 0 20px 54px rgba(0,0,0,.24); }
.studio-node.status-failed { border-color: color-mix(in srgb, var(--studio-danger) 60%, var(--studio-border)); }
.studio-node.status-attention, .studio-node.is-stale { border-color: color-mix(in srgb, var(--studio-warning) 55%, var(--studio-border)); }
.studio-node__header { display: grid; grid-template-columns: 38px minmax(0, 1fr) 26px; align-items: center; gap: 10px; }
.studio-node__icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 12%, transparent); }
.studio-node__eyebrow { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; color: var(--studio-text-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.studio-node h3 { margin: 0; overflow: hidden; color: var(--studio-text); font-size: 15px; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
.studio-node p { min-height: 36px; margin: 13px 0 12px; color: var(--studio-text-soft); font-size: 12px; line-height: 1.5; }
.studio-node__footer { min-height: 19px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--studio-text-muted); font-size: 10px; }
.studio-node__flag { display: inline-flex; align-items: center; gap: 4px; color: var(--studio-warning); }
.studio-node__open { width: 26px; height: 26px; display: grid; place-items: center; color: var(--studio-text-muted); }
.studio-node__optional { padding: 2px 5px; border: 1px solid var(--studio-border); border-radius: 999px; letter-spacing: 0; text-transform: none; }
.studio-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--studio-text-muted); box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 10%, transparent); }
.status-complete .studio-status-dot { background: var(--studio-success); }
.status-running .studio-status-dot { background: var(--studio-accent); animation: studio-pulse 1.5s ease-in-out infinite; }
.status-ready .studio-status-dot { background: var(--studio-info); }
.status-attention .studio-status-dot { background: var(--studio-warning); }
.status-failed .studio-status-dot { background: var(--studio-danger); }
@keyframes studio-pulse { 50% { opacity: .38; transform: scale(.7); } }
:deep(.studio-handle) { width: 9px; height: 9px; border: 2px solid var(--studio-canvas); background: var(--studio-border-strong); }
</style>
