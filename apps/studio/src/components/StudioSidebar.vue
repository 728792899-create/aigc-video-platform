<template>
  <aside class="studio-sidebar" aria-label="工作室主导航">
    <header class="studio-sidebar__brand">
      <span class="studio-sidebar__brand-mark"><Sparkles :size="17" aria-hidden="true" /></span>
      <span><strong>AIGC 导演工作室</strong><small>此设备 · 本地工作区</small></span>
    </header>

    <nav data-onboarding-target="stage-navigation" aria-label="产品工作区">
      <button
        v-for="item in navigationItems"
        :key="item.id"
        type="button"
        :class="{ active: item.workspaceIds.includes(currentId) }"
        :aria-current="item.workspaceIds.includes(currentId) ? 'page' : undefined"
        :title="item.description"
        @click="$emit('navigate', destinationFor(item.id))"
      >
        <component :is="item.icon" :size="17" aria-hidden="true" />
        <span class="studio-sidebar__item-copy">
          <strong>{{ navigationLabel(item) }}</strong>
          <small>{{ item.description }}</small>
        </span>
      </button>
    </nav>

    <footer class="studio-sidebar__footer">
      <button type="button" @click="$emit('openCommand')"><span aria-hidden="true">⌘ K</span>命令面板</button>
      <button type="button" @click="$emit('openHelp')"><span aria-hidden="true">?</span>帮助、隐私与恢复</button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { Blocks, ClipboardCheck, FolderKanban, ListTodo, PlugZap, ScrollText, ShieldCheck, Sparkles } from 'lucide-vue-next'
import type { StudioWorkspaceFacts, StudioWorkspaceId } from '../workspaces.js'

const props = defineProps<{
  currentId: StudioWorkspaceId
  facts: StudioWorkspaceFacts
  completedIds: ReadonlySet<StudioWorkspaceId>
}>()

defineEmits<{ navigate: [id: StudioWorkspaceId]; openCommand: []; openHelp: [] }>()

type PrimaryNavigationId = 'projects' | 'creation' | 'review' | 'tasks' | 'prompt' | 'provider' | 'governance'
type PrimaryNavigationItem = {
  id: PrimaryNavigationId
  label: string
  description: string
  workspaceIds: StudioWorkspaceId[]
  icon: Component
}

const navigationItems: PrimaryNavigationItem[] = [
  { id: 'projects', label: '项目', description: '项目中心', workspaceIds: ['project_center', 'project_setup'], icon: FolderKanban },
  { id: 'creation', label: '创作', description: '剧本到生成', workspaceIds: ['brief', 'script', 'assets', 'shots', 'continuity', 'generation', 'canvas'], icon: Blocks },
  { id: 'review', label: '审阅', description: '候选与交付', workspaceIds: ['review', 'timeline', 'export_settings'], icon: ClipboardCheck },
  { id: 'tasks', label: '任务', description: '诊断与恢复', workspaceIds: ['tasks'], icon: ListTodo },
  { id: 'prompt', label: 'Prompt / Skill', description: '模板与版本', workspaceIds: ['prompt_skill'], icon: ScrollText },
  { id: 'provider', label: 'Provider', description: '连接与路由', workspaceIds: ['provider_connections'], icon: PlugZap },
  { id: 'governance', label: '治理', description: '安全与备份', workspaceIds: ['local_governance'], icon: ShieldCheck },
]

function destinationFor(id: PrimaryNavigationId): StudioWorkspaceId {
  if (id === 'projects') return 'project_center'
  if (id === 'creation') {
    const current = navigationItems.find((item) => item.id === 'creation')!
    if (current.workspaceIds.includes(props.currentId)) return props.currentId
    if (!props.facts.hasProject) return 'project_setup'
    if (!props.facts.hasSource) return 'brief'
    if (!props.facts.hasShots) return 'shots'
    return 'generation'
  }
  if (id === 'review') return props.facts.hasApprovedCandidates ? 'timeline' : 'review'
  if (id === 'tasks') return 'tasks'
  if (id === 'prompt') return 'prompt_skill'
  if (id === 'provider') return 'provider_connections'
  return 'local_governance'
}

function navigationLabel(item: PrimaryNavigationItem): string {
  return item.id === 'governance' && props.currentId === 'local_governance' ? '设置' : item.label
}
</script>
