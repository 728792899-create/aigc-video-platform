<template>
  <section class="task-tray" :class="{ 'task-tray--open': open }" aria-label="任务中心">
    <button class="task-tray__trigger" type="button" @click="open = !open"><ListChecks :size="17" /><span>任务</span><strong>{{ activeCount }}</strong><ChevronUp :size="15" :class="{ rotate: open }" /></button>
    <div v-if="open" class="task-tray__body">
      <header><div><span class="eyebrow">DURABLE TASKS</span><h2>任务与恢复</h2></div><button class="icon-button" type="button" aria-label="刷新任务" @click="store.refreshTasks"><RefreshCw :size="16" /></button></header>
      <div v-if="store.tasks.length === 0" class="task-empty">还没有生成或导出任务。</div>
      <ol v-else class="task-list">
        <li v-for="task in recentTasks" :key="task.id" :class="`task task--${task.status}`" @click="selectTask(task.id)">
          <i /><div><strong>{{ task.stage }}</strong><span>{{ task.status }} · attempt {{ task.attempt }}</span></div><small>{{ elapsed(task) }}</small>
        </li>
      </ol>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronUp, ListChecks, RefreshCw } from 'lucide-vue-next'
import type { GenerationTask } from '@aigc-director/contracts'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const open = ref(false)
const activeCount = computed(() => store.tasks.filter((task) => ['queued', 'running', 'retrying', 'waiting_approval'].includes(task.status)).length)
const recentTasks = computed(() => [...store.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12))
function elapsed(task: GenerationTask): string { return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(Math.round((Date.parse(task.updatedAt) - Date.now()) / 60_000), 'minute') }
function selectTask(taskId: string): void {
  const id = `task:${taskId}`
  if (store.graph?.nodes.some((node) => node.id === id)) store.selectedNodeId = id
}
</script>
