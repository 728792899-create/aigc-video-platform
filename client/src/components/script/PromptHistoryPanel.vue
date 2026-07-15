<template>
  <section class="prompt-history" aria-labelledby="prompt-history-title">
    <header>
      <div>
        <span>VERSIONED PROMPTS</span>
        <h3 id="prompt-history-title">Prompt 版本与局部重生成</h3>
        <p>手工编辑、润色结果和实际生成输入分开留痕；恢复历史会创建新 revision。</p>
      </div>
      <button type="button" :disabled="loading" @click="loadHistory">刷新</button>
    </header>

    <div v-if="error" class="prompt-history__notice is-error" role="alert">{{ error }}</div>
    <div v-else-if="notice" class="prompt-history__notice" role="status">{{ notice }}</div>

    <div class="prompt-history__controls">
      <label>分镜
        <select v-model="storyboardId">
          <option v-for="shot in selectableStoryboards" :key="String(shot.id)" :value="String(shot.id)">
            #{{ shot.scene_number }} · {{ shot.description || shot.dialog || `Shot ${shot.scene_number}` }}
          </option>
        </select>
      </label>
      <label>Prompt 类型
        <select v-model="kind">
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="voice">Voice</option>
          <option value="negative">Negative</option>
          <option value="script">Script</option>
        </select>
      </label>
      <label>对比版本
        <select v-model="selectedRevisionId" :disabled="!history.length">
          <option v-for="revision in history" :key="revision.id" :value="revision.id">
            R{{ revision.revision }} · {{ revision.source }} · {{ formatTime(revision.created_at) }}
          </option>
        </select>
      </label>
    </div>

    <label class="prompt-history__editor">当前编辑内容
      <textarea v-model="content" rows="6" maxlength="24000" placeholder="输入当前分镜的 Prompt"></textarea>
    </label>
    <div class="prompt-history__actions">
      <button type="button" :disabled="busy || !content.trim() || !selectedShot" @click="saveRevision">保存新 revision</button>
      <button type="button" :disabled="busy || !selectedRevisionId" @click="showDiff">查看 diff</button>
      <button type="button" :disabled="busy || !selectedRevisionId" @click="restoreRevision">以此版本创建新 revision</button>
    </div>

    <div v-if="diff" class="prompt-history__diff" aria-label="Prompt diff">
      <div class="prompt-history__diff-head">
        <strong>R{{ diff.against?.revision || 0 }} → R{{ diff.current.revision }}</strong>
        <span>绿色为新增，红色为删除</span>
      </div>
      <pre><span v-for="(line, index) in diff.lines" :key="index" :class="`is-${line.type}`">{{ marker(line.type) }} {{ line.line }}
</span></pre>
    </div>

    <footer class="prompt-history__regenerate">
      <div>
        <strong>只重生成当前分镜</strong>
        <span>新结果会作为 Candidate 追加，不覆盖已选结果。Demo Mode 不会发起付费请求。</span>
      </div>
      <label v-for="stage in stageOptions" :key="stage"><input v-model="stages" type="checkbox" :value="stage" /> {{ stage }}</label>
      <button type="button" :disabled="busy || !selectedShot || !stages.length" @click="regenerate">创建局部任务</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import type { PromptKind, PromptRevision } from '@aigc-video/contracts'
import { computed, ref, watch } from 'vue'

import {
  createPromptRevision,
  diffPromptRevision,
  listPromptRevisions,
  regenerateStoryboard,
  restorePromptRevision,
  type PromptDiff as PromptDiffResult,
  type RegenerationTask,
} from '../../api/prompts'
import type { EditableStoryboard } from '../../api/script'

const props = defineProps<{ projectId: string | number; storyboards: EditableStoryboard[] }>()
const emit = defineEmits<{ taskCreated: [task: RegenerationTask] }>()

const stageOptions = ['image', 'voice', 'video'] as const
const storyboardId = ref('')
const kind = ref<PromptKind>('image')
const history = ref<PromptRevision[]>([])
const selectedRevisionId = ref('')
const content = ref('')
const diff = ref<PromptDiffResult | null>(null)
const stages = ref<Array<(typeof stageOptions)[number]>>(['image'])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')

const selectableStoryboards = computed(() => props.storyboards.filter((shot) => shot.id != null))
const selectedShot = computed(() => selectableStoryboards.value.find((shot) => String(shot.id) === storyboardId.value) ?? null)

function sourceText(shot: EditableStoryboard | null, promptKind: PromptKind): string {
  if (!shot) return ''
  if (promptKind === 'voice') return String(shot.dialog || '')
  if (promptKind === 'video') return String(shot.video_prompt || shot.prompt || shot.description || '')
  if (promptKind === 'negative') return String(shot.negative_prompt || '')
  if (promptKind === 'script') return String(shot.dialog || shot.description || '')
  return String(shot.prompt || shot.description || '')
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value)
}

function marker(type: 'same' | 'added' | 'removed'): string {
  if (type === 'added') return '+'
  if (type === 'removed') return '-'
  return ' '
}

async function loadHistory(): Promise<void> {
  if (!storyboardId.value) { history.value = []; return }
  loading.value = true; error.value = ''; diff.value = null
  try {
    history.value = await listPromptRevisions(props.projectId, storyboardId.value, kind.value)
    selectedRevisionId.value = history.value[0]?.id || ''
    content.value = history.value[0]?.content || sourceText(selectedShot.value, kind.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally { loading.value = false }
}

async function saveRevision(): Promise<void> {
  const shot = selectedShot.value
  if (!shot?.id || !content.value.trim()) return
  busy.value = true; error.value = ''
  try {
    const created = await createPromptRevision(props.projectId, {
      storyboard_id: Number(shot.id), kind: kind.value, content: content.value,
      negative_content: '', source: 'manual', prompt_version: 'ui-v1', provider: '', model: '',
      parent_revision_id: selectedRevisionId.value || null,
    })
    await loadHistory(); selectedRevisionId.value = created.id
    notice.value = `Prompt R${created.revision} 已保存`
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function showDiff(): Promise<void> {
  if (!selectedRevisionId.value) return
  busy.value = true; error.value = ''
  try { diff.value = await diffPromptRevision(selectedRevisionId.value) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function restoreRevision(): Promise<void> {
  if (!selectedRevisionId.value) return
  busy.value = true; error.value = ''
  try {
    const restored = await restorePromptRevision(selectedRevisionId.value)
    await loadHistory(); selectedRevisionId.value = restored.id; content.value = restored.content
    notice.value = `已从历史创建 R${restored.revision}`
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function regenerate(): Promise<void> {
  const shot = selectedShot.value
  if (!shot?.id || !stages.value.length) return
  busy.value = true; error.value = ''
  try {
    const task = await regenerateStoryboard(shot.id, {
      stages: [...stages.value], prompt_revision_id: selectedRevisionId.value || undefined,
      confirm_cost: false, idempotencyKey: `scene-${shot.id}-${Date.now()}`,
    })
    emit('taskCreated', task); notice.value = `已创建任务 ${task.task_id}`
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

watch(selectableStoryboards, (shots) => {
  if (!shots.some((shot) => String(shot.id) === storyboardId.value)) storyboardId.value = String(shots[0]?.id ?? '')
}, { immediate: true })
watch([storyboardId, kind], loadHistory, { immediate: true })
</script>

<style scoped>
.prompt-history { display: grid; gap: 14px; margin-top: 18px; padding: 18px; border: 1px solid var(--border-color); border-radius: 14px; background: var(--card-bg); }
.prompt-history > header, .prompt-history__actions, .prompt-history__regenerate, .prompt-history__diff-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.prompt-history header span { color: var(--el-color-primary); font: 800 10px/1 ui-monospace, monospace; letter-spacing: .12em; }.prompt-history h3 { margin: 5px 0; }.prompt-history p { margin: 0; color: var(--text-secondary); font-size: 12px; }
.prompt-history button { min-height: 34px; padding: 0 12px; border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); background: transparent; cursor: pointer; }.prompt-history button:hover:not(:disabled) { border-color: var(--el-color-primary); }.prompt-history button:disabled { opacity: .45; cursor: default; }
.prompt-history__controls { display: grid; grid-template-columns: 2fr 1fr 1.4fr; gap: 10px; }.prompt-history label { display: grid; gap: 5px; color: var(--text-secondary); font-size: 11px; }
.prompt-history select, .prompt-history textarea { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); background: var(--bg-color); font: inherit; }.prompt-history textarea { resize: vertical; }
.prompt-history__actions { justify-content: flex-start; }.prompt-history__notice { padding: 9px 11px; border-radius: 8px; color: #36a976; background: color-mix(in srgb, #36a976 10%, transparent); }.prompt-history__notice.is-error { color: var(--el-color-danger); background: color-mix(in srgb, var(--el-color-danger) 10%, transparent); }
.prompt-history__diff { overflow: hidden; border: 1px solid var(--border-color); border-radius: 10px; }.prompt-history__diff-head { padding: 9px 11px; border-bottom: 1px solid var(--border-color); font-size: 11px; }.prompt-history__diff pre { max-height: 280px; overflow: auto; margin: 0; padding: 10px 0; background: #0b1118; color: #d8e1e9; font: 11px/1.55 ui-monospace, monospace; }.prompt-history__diff pre span { display: block; padding: 0 10px; white-space: pre-wrap; }.prompt-history__diff .is-added { color: #8ce2b4; background: rgba(52, 168, 115, .13); }.prompt-history__diff .is-removed { color: #ff9ca6; background: rgba(220, 68, 85, .13); }
.prompt-history__regenerate { flex-wrap: wrap; padding-top: 13px; border-top: 1px solid var(--border-color); }.prompt-history__regenerate > div { flex: 1 1 280px; display: grid; gap: 4px; }.prompt-history__regenerate > div span { color: var(--text-secondary); font-size: 11px; }.prompt-history__regenerate label { display: flex; align-items: center; gap: 4px; }
@media (max-width: 760px) { .prompt-history__controls { grid-template-columns: 1fr; }.prompt-history > header { align-items: flex-start; }.prompt-history__actions { flex-wrap: wrap; } }
</style>
