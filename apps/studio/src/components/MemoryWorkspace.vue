<template>
  <section class="memory-workspace" aria-label="Agent 分层记忆">
    <header>
      <div><span class="eyebrow">MEMORY / RETRIEVAL</span><h3>可追溯创作记忆</h3><p>只索引已批准的事件、产物、反馈和候选摘要；密钥、签名 URL、Provider 原始响应与二进制媒体不会进入记忆。</p></div>
      <button class="secondary-button" type="button" :disabled="!store.currentProjectId || busy" @click="rebuild">重建当前项目</button>
    </header>
    <div class="memory-status">
      <span>检索模式：{{ modelStatus?.mode === 'hybrid' ? 'Hybrid' : '关键词降级' }}</span>
      <span>ONNX：{{ modelStatus?.onnx.status ?? '读取中' }}</span>
      <span v-if="report">新增 {{ report.created }} · 复用 {{ report.reused }} · stale {{ report.markedStale }} · 敏感跳过 {{ report.skippedSensitive }}</span>
    </div>
    <form class="memory-search" @submit.prevent="search">
      <label for="memory-query">搜索事件、人物状态或已批准设定</label>
      <div><input id="memory-query" v-model="query" maxlength="500" placeholder="例如：灯塔 来信" /><button class="primary-button" type="submit" :disabled="!store.currentProjectId || !query.trim() || busy">检索</button></div>
    </form>
    <p v-if="error" class="error-copy">{{ error }}</p>
    <div v-if="results.length" class="memory-results">
      <article v-for="result in results" :key="result.record.id">
        <header><div><strong>{{ result.record.title }}</strong><small>{{ result.record.scope }} · r{{ result.record.sourceRevision }}</small></div><span>{{ result.score.toFixed(0) }}</span></header>
        <p>{{ result.record.summary }}</p>
        <ul><li v-for="reason in result.reasons" :key="reason">{{ reason }}</li></ul>
        <div class="memory-actions"><button type="button" @click="toggle(result.record)">{{ result.record.disabled ? '启用' : '禁用召回' }}</button><button type="button" @click="requestDelete(result.record.id)">{{ pendingDeleteId === result.record.id ? '再次确认删除' : '删除' }}</button></div>
      </article>
    </div>
    <div v-else-if="records.length" class="memory-record-summary">当前作用域已有 {{ records.length }} 条记录；输入关键词查看采用原因。禁用记录不会参与 Agent 召回。</div>
    <p v-else class="muted">当前还没有记忆。重建只读取本地 canonical database，不调用 Provider。</p>
    <p class="memory-onnx-note">ONNX 多语言模型仅在用户主动启用、确认约 470 MB 下载和许可证后安装；当前不会自动联网或下载。</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { MemoryModelStatus, MemoryRebuildReport, MemoryRecord, MemorySearchResult } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const query = ref('')
const records = ref<MemoryRecord[]>([])
const results = ref<MemorySearchResult[]>([])
const modelStatus = ref<MemoryModelStatus>()
const report = ref<MemoryRebuildReport>()
const busy = ref(false)
const error = ref('')
const pendingDeleteId = ref<string>()

async function load(): Promise<void> {
  error.value = ''
  try {
    const [status, current] = await Promise.all([
      directorApi.memoryModelStatus(),
      store.currentProjectId ? directorApi.listMemory(store.currentProjectId) : Promise.resolve([]),
    ])
    modelStatus.value = status
    records.value = current
  } catch {
    error.value = '记忆状态读取失败，请稍后重试。'
  }
}

async function rebuild(): Promise<void> {
  if (!store.currentProjectId) return
  busy.value = true
  error.value = ''
  try {
    report.value = await directorApi.rebuildMemory(store.currentProjectId)
    records.value = await directorApi.listMemory(store.currentProjectId)
    if (query.value.trim()) await search()
  } catch { error.value = '记忆重建失败，原有记录未被删除。' } finally { busy.value = false }
}

async function search(): Promise<void> {
  if (!store.currentProjectId || !query.value.trim()) return
  busy.value = true
  error.value = ''
  try { results.value = await directorApi.searchMemory(store.currentProjectId, query.value.trim()) }
  catch { error.value = '记忆检索失败，请重试。' }
  finally { busy.value = false }
}

async function toggle(record: MemoryRecord): Promise<void> {
  try {
    const updated = await directorApi.toggleMemory(record.id, !record.disabled)
    records.value = records.value.map((item) => item.id === updated.id ? updated : item)
    results.value = results.value.map((item) => item.record.id === updated.id ? { ...item, record: updated } : item)
  } catch { error.value = '记忆状态未保存。' }
}

async function requestDelete(memoryId: string): Promise<void> {
  if (pendingDeleteId.value !== memoryId) { pendingDeleteId.value = memoryId; return }
  try {
    await directorApi.deleteMemory(memoryId)
    records.value = records.value.filter((item) => item.id !== memoryId)
    results.value = results.value.filter((item) => item.record.id !== memoryId)
    pendingDeleteId.value = undefined
  } catch { error.value = '记忆删除失败，原记录仍保留。' }
}

watch(() => store.currentProjectId, () => { results.value = []; report.value = undefined; void load() })
onMounted(load)
</script>

<style scoped>
.memory-workspace { display: grid; gap: 14px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
.memory-workspace > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.memory-workspace h3 { margin: 4px 0; font-size: 16px; }
.memory-workspace p { margin: 0; color: var(--muted-strong); font-size: 11px; line-height: 1.6; }
.memory-status { display: flex; flex-wrap: wrap; gap: 6px; }
.memory-status span { padding: 5px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 9px; }
.memory-search { display: grid; gap: 6px; }
.memory-search label { color: var(--muted); font-size: 10px; }
.memory-search > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.memory-search input { min-width: 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--text); background: var(--surface-panel); }
.memory-results { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.memory-results article { padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-panel); }
.memory-results article > header { display: flex; justify-content: space-between; gap: 8px; }
.memory-results article header div { display: grid; gap: 3px; }
.memory-results strong { font-size: 11px; }
.memory-results small, .memory-results article > header > span { color: var(--mint); font-size: 9px; }
.memory-results ul { margin: 7px 0; padding-left: 15px; color: var(--muted); font-size: 9px; }
.memory-actions { display: flex; gap: 6px; }
.memory-actions button { padding: 5px 7px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted-strong); background: transparent; font-size: 9px; }
.memory-record-summary, .memory-onnx-note { padding: 9px; border-radius: 8px; color: var(--muted); background: var(--alpha-accent-05); font-size: 10px; line-height: 1.5; }
@media (max-width: 720px) { .memory-workspace > header { display: grid; } .memory-results { grid-template-columns: 1fr; } }
</style>
