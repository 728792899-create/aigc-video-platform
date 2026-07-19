<template>
  <section class="delivery-panel" aria-label="导出与恢复">
    <div><span class="eyebrow">DELIVERY</span><h2>把已选候选装配成 MP4</h2><p>导出由持久任务执行。刷新或重启后仍可查看真实状态，不伪造百分比。</p></div>
    <div class="delivery-panel__summary"><span><strong>{{ store.snapshot?.shots.length ?? 0 }}</strong> 镜头</span><span><strong>{{ totalSeconds.toFixed(1) }}</strong> 秒</span><span><strong>{{ selectedCount }}</strong> 已选候选</span><span><strong>0</strong> Demo 付费请求</span></div>
    <div class="delivery-panel__actions">
      <label v-if="!isDesktop" class="export-directory"><span>开发导出目录</span><input v-model="exportDirectory" aria-label="开发导出目录" /></label>
      <button class="primary-button" type="button" :disabled="!canExport || store.loading" @click="chooseAndExport"><FolderOutput :size="17" />选择目录并导出</button>
      <button class="secondary-button" type="button" @click="store.refreshTasks"><RefreshCw :size="16" />刷新任务</button>
    </div>
    <p v-if="!canExport" class="inline-warning"><TriangleAlert :size="16" />每个镜头至少需要一个已选候选。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderOutput, RefreshCw, TriangleAlert } from 'lucide-vue-next'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const isDesktop = Boolean(window.aigcDirector)
const exportDirectory = ref('/tmp/aigc-director-export')
const totalSeconds = computed(() => (store.snapshot?.shots ?? []).reduce((total, shot) => total + shot.durationMs, 0) / 1_000)
const selectedCount = computed(() => (store.snapshot?.shots ?? []).filter((shot) => shot.selectedCandidateId).length)
const canExport = computed(() => (store.snapshot?.shots.length ?? 0) > 0 && selectedCount.value === store.snapshot?.shots.length)

async function chooseAndExport(): Promise<void> {
  let directory: string | null = null
  if (window.aigcDirector) directory = await window.aigcDirector.selectExportDirectory()
  else directory = exportDirectory.value.trim() || null
  if (directory) await store.startExport(directory)
}
</script>
