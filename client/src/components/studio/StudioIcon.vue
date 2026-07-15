<template>
  <svg
    class="studio-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :aria-hidden="label ? undefined : 'true'"
    :aria-label="label || undefined"
    role="img"
  >
    <path
      v-for="path in paths"
      :key="path"
      :d="path"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export type StudioIconName =
  | 'studio' | 'projects' | 'dashboard' | 'topic' | 'script' | 'assets'
  | 'storyboard' | 'visuals' | 'voice' | 'subtitle' | 'timeline' | 'export'
  | 'refresh' | 'canvas' | 'list' | 'fit' | 'layout' | 'quick' | 'plus'
  | 'warning' | 'check' | 'close' | 'chevron' | 'command' | 'advisor'

const props = withDefaults(defineProps<{
  name: StudioIconName
  size?: number
  label?: string
}>(), { size: 20, label: '' })

const ICONS: Record<StudioIconName, string[]> = {
  studio: ['M12 2.8l1.8 4.7 4.7 1.8-4.7 1.8-1.8 4.7-1.8-4.7-4.7-1.8 4.7-1.8L12 2.8Z', 'M18.2 15.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z'],
  projects: ['M3.5 6.8h6l1.8 2h9.2v9.7a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V6.8Z', 'M3.5 9h17'],
  dashboard: ['M4 4h6v6H4z', 'M14 4h6v10h-6z', 'M4 14h6v6H4z', 'M14 18h6v2h-6z'],
  topic: ['M12 3a6 6 0 0 0-3.7 10.7c.8.6 1.2 1.3 1.2 2.2h5c0-.9.4-1.6 1.2-2.2A6 6 0 0 0 12 3Z', 'M9.8 19h4.4', 'M10.5 16v.5h3V16'],
  script: ['M5 3h10l4 4v14H5z', 'M15 3v5h4', 'M8.5 12h7', 'M8.5 16h5.5'],
  assets: ['M5 5.5 12 2l7 3.5-7 3.6-7-3.6Z', 'M5 9.7l7 3.6 7-3.6', 'M5 14l7 3.5 7-3.5', 'M5 18.2l7 3.5 7-3.5'],
  storyboard: ['M3.5 5h17v14h-17z', 'M8 5v14', 'M3.5 10h4.5', 'M3.5 15h4.5', 'M11 9h6', 'M11 13h4'],
  visuals: ['M4 4.5h16v15H4z', 'M7 16l3.6-4 2.6 2.6 2.1-2.2L20 17', 'M15.8 8.2h.1'],
  voice: ['M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z', 'M5.5 11.5a6.5 6.5 0 0 0 13 0', 'M12 18v3', 'M9 21h6'],
  subtitle: ['M3 5h18v13H8l-4.5 3v-3H3z', 'M7 10h10', 'M7 14h7'],
  timeline: ['M3 6h18', 'M3 12h18', 'M3 18h18', 'M7 4v4', 'M16 10v4', 'M10 16v4'],
  export: ['M12 3v12', 'M7.5 7.5 12 3l4.5 4.5', 'M5 13v7h14v-7'],
  refresh: ['M19 8a7 7 0 1 0 .4 7', 'M19 3v5h-5'],
  canvas: ['M4 4h16v16H4z', 'M8 8h3v3H8z', 'M14 13h3v3h-3z', 'M11 9.5h3l1.5 3.5'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.1', 'M4 12h.1', 'M4 18h.1'],
  fit: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'],
  layout: ['M4 5h6v5H4z', 'M14 14h6v5h-6z', 'M10 7.5h4a3 3 0 0 1 3 3V14', 'M14 11l3 3 3-3'],
  quick: ['M13 2 5.5 13h6l-.5 9L19 10h-6z'],
  plus: ['M12 5v14', 'M5 12h14'],
  warning: ['M12 3 2.8 20h18.4L12 3Z', 'M12 9v5', 'M12 17.5h.1'],
  check: ['M4 12.5 9.5 18 20 6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  chevron: ['M9 5l7 7-7 7'],
  command: ['M8 8V6a2 2 0 1 0-2 2h12a2 2 0 1 0-2-2v12a2 2 0 1 0 2-2H6a2 2 0 1 0 2 2V6'],
  advisor: ['M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z', 'M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z'],
}

const paths = computed(() => ICONS[props.name])
</script>

<style scoped>
.studio-icon { display: inline-block; flex: 0 0 auto; }
</style>
