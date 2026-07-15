<template>
  <section class="export-action-panel">
    <div class="export-action-copy"><h3>导出与保存</h3><p>导出会进入成片库：<code>{{ libraryPath }}</code></p><p v-if="copyPath">同时复制到：<code>{{ copyPath }}</code></p><p v-if="longProject">长视频将按章节合成并自动拼接。</p></div>
    <div class="export-action-controls"><el-button type="primary" :loading="exporting" @click="$emit('export')">导出视频</el-button><el-button plain @click="$emit('library')">打开成片库</el-button></div>
    <div v-if="taskId || result || error" class="export-status-card" :class="statusClass">
      <div class="export-status-head"><strong>{{ title }}</strong><el-tag v-if="taskId && exporting" size="small" effect="plain">Task {{ String(taskId).slice(0, 8) }}</el-tag></div>
      <el-progress v-if="exporting" :percentage="progress" :stroke-width="10" status="success" /><p>{{ statusText }}</p>
      <div v-if="result" class="export-location"><span>成片库位置</span><code>{{ displayLocalPath(result.file_url || result.file_path) }}</code><template v-if="result.external_file_path"><span>自定义导出副本</span><code>{{ displayLocalPath(result.external_file_path) }}</code></template><template v-if="result.external_copy_status === 'error'"><span>复制失败</span><code>{{ result.external_copy_error || '未知错误' }}</code></template></div>
      <div v-if="result" class="export-status-actions"><el-button size="small" type="primary" plain @click="$emit('play')">播放成片</el-button><el-button size="small" @click="$emit('library')">成片库</el-button><el-button size="small" @click="$emit('download')">下载</el-button></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { displayLocalPath } from '../utils/localPath'

interface ExportResult {
  file_url?: string | null
  file_path?: string | null
  external_file_path?: string | null
  external_copy_status?: string | null
  external_copy_error?: string | null
}

withDefaults(defineProps<{
  libraryPath?: string
  copyPath?: string
  longProject?: boolean
  exporting?: boolean
  taskId?: string
  result?: ExportResult | null
  error?: string | Record<string, unknown> | null
  statusClass?: HTMLAttributes['class']
  title?: string
  statusText?: string
  progress?: number
}>(), { progress: 0 })

defineEmits<{ export: []; library: []; play: []; download: [] }>()
</script>

<style scoped>
.export-action-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:14px 16px;border:1px solid #007aff2e;border-radius:var(--radius-md);background:var(--bg-surface);min-width:0}.export-action-copy{display:grid;gap:5px}.export-action-copy h3,.export-action-copy p{margin:0}.export-action-copy h3{font-size:15px}.export-action-copy p{color:var(--text-second);font-size:12px}.export-action-copy code{padding:1px 5px;border-radius:5px;background:#007aff14;color:var(--primary)}.export-action-controls{display:flex;gap:8px}.export-status-card{grid-column:1/-1;display:grid;gap:8px;padding:10px;border:1px solid var(--separator);border-radius:var(--radius-sm);background:var(--bg-base)}.export-status-card.is-running{border-color:#007aff3d;background:var(--primary-soft)}.export-status-card.is-success{border-color:#34c75947;background:#34c75914}.export-status-card.is-error{border-color:#ff3b3047;background:#ff3b3014}.export-status-head{display:flex;justify-content:space-between}.export-status-card p{margin:0;color:var(--text-second);font-size:12px}.export-location{display:grid;gap:4px}.export-location span{color:var(--text-muted);font-size:11px}.export-location code{padding:6px 7px;border-radius:6px;background:#0000000f;overflow-wrap:anywhere}.export-status-actions{display:flex;gap:6px}.export-status-actions>*{flex:1}
</style>
