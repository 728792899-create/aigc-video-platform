<template>
  <article class="graph-node" :class="[`graph-node--${data.status}`, { 'graph-node--selected': selected }]" :aria-label="`${data.label}，${data.subtitle}`">
    <div class="graph-node__icon" aria-hidden="true">
      <component :is="icon" :size="17" />
    </div>
    <div class="graph-node__copy">
      <strong>{{ data.label }}</strong>
      <span>{{ data.subtitle }}</span>
    </div>
    <i class="graph-node__status" :title="data.status" />
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BookCopy, BookOpen, Boxes, Clapperboard, FileText, Film, Flag, GitBranch, Image, Layers3, ListTodo, Music, Package, Sparkles, UserRound } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { GraphNode } from '@aigc-director/contracts'

const props = defineProps<{ data: Pick<GraphNode, 'type' | 'label' | 'subtitle' | 'status'>; selected?: boolean }>()
const icons: Readonly<Record<GraphNode['type'], Component>> = {
  series: Layers3, episode: BookCopy,
  project: Sparkles, source: BookOpen, chapter: FileText, event: GitBranch, character: UserRound,
  plan: ListTodo, scene: Clapperboard, shot: Film, manual: FileText, style: Sparkles,
  asset: Package, candidate: Image, track: Boxes, task: ListTodo, export: Flag,
}
const icon = computed(() => icons[props.data.type] ?? Music)
</script>
