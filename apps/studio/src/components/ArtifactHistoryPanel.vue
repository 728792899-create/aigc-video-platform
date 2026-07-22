<template>
  <section class="artifact-history" aria-label="Artifact 版本与回滚">
    <header><div><h3>Artifact 版本</h3><p>回滚会追加新 revision，不覆盖历史。</p></div><span v-if="history">{{ history.versions.length }} 个版本</span></header>
    <p v-if="loading" class="muted">正在读取版本证据…</p>
    <p v-else-if="error" class="error-copy">{{ error }}</p>
    <div v-else-if="history" class="artifact-history__versions">
      <button
        v-for="version in history.versions"
        :key="version.id"
        type="button"
        :class="{ active: selected?.id === version.id, current: currentVersion?.id === version.id }"
        @click="compare(version)"
      >
        <strong>r{{ version.revision }}</strong><span>{{ version.status }}</span><small>{{ shortHash(version.contentHash) }}</small>
      </button>
    </div>
    <template v-if="selected && currentVersion && selected.id !== currentVersion.id">
      <div class="artifact-history__diff">
        <strong>r{{ selected.revision }} → 当前 r{{ currentVersion.revision }}</strong>
        <p v-if="diff?.changes.length === 0">结构内容没有字段差异。</p>
        <details v-for="change in diff?.changes ?? []" :key="change.field">
          <summary>{{ change.field }}</summary>
          <pre>{{ renderChange(change.before) }}</pre><span>→</span><pre>{{ renderChange(change.after) }}</pre>
        </details>
      </div>
      <button class="secondary-button artifact-history__rollback" type="button" :disabled="loading" @click="requestRollback">
        {{ pendingRollbackId === selected.id ? `再次确认：以 r${selected.revision} 创建新版本` : `以 r${selected.revision} 创建新 revision` }}
      </button>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ArtifactDiff, ArtifactHistory, ArtifactVersion } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'

const props = defineProps<{ artifact: ArtifactVersion }>()
const store = useStudioStore()
const history = ref<ArtifactHistory>()
const selected = ref<ArtifactVersion>()
const diff = ref<ArtifactDiff>()
const pendingRollbackId = ref<string>()
const loading = ref(false)
const error = ref('')
const currentVersion = computed(() => history.value?.versions.find((version) => version.id === history.value?.head?.currentVersionId) ?? history.value?.versions[0])

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    history.value = await directorApi.artifactHistory(props.artifact.projectId, props.artifact.scope, props.artifact.artifactType)
    selected.value = currentVersion.value
    diff.value = undefined
    pendingRollbackId.value = undefined
  } catch {
    error.value = '版本证据读取失败，请重试。'
  } finally {
    loading.value = false
  }
}

async function compare(version: ArtifactVersion): Promise<void> {
  selected.value = version
  pendingRollbackId.value = undefined
  diff.value = undefined
  const current = currentVersion.value
  if (!current || current.id === version.id) return
  loading.value = true
  error.value = ''
  try {
    diff.value = await directorApi.artifactDiff(version.projectId, version.scope, version.id, current.id)
  } catch {
    error.value = '版本 diff 读取失败，请刷新后重试。'
  } finally {
    loading.value = false
  }
}

async function requestRollback(): Promise<void> {
  const target = selected.value
  const expectedHeadRevision = history.value?.head?.expectedRevision ?? currentVersion.value?.revision
  if (!target || expectedHeadRevision === undefined) return
  if (pendingRollbackId.value !== target.id) { pendingRollbackId.value = target.id; return }
  loading.value = true
  const rollback = await store.rollbackArtifactVersion(target, expectedHeadRevision)
  loading.value = false
  if (rollback) await load()
}

const shortHash = (value: string): string => `${value.slice(0, 8)}…${value.slice(-4)}`
function renderChange(value: unknown): string {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (rendered ?? '∅').slice(0, 2_000)
}

watch(() => props.artifact.id, () => { void load() }, { immediate: true })
</script>

<style scoped>
.artifact-history { display: grid; gap: 9px; margin-top: 14px; padding-top: 13px; border-top: 1px solid var(--line); }
.artifact-history > header { display: flex; justify-content: space-between; gap: 8px; }
.artifact-history h3, .artifact-history p { margin: 0; }
.artifact-history > header p, .artifact-history > header span { color: var(--muted); font-size: 9px; }
.artifact-history__versions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.artifact-history__versions button { display: grid; gap: 2px; padding: 7px; border: 1px solid var(--line); border-radius: 8px; color: var(--muted-strong); background: transparent; text-align: left; }
.artifact-history__versions button.active { border-color: var(--mint); }
.artifact-history__versions button.current { background: var(--alpha-accent-07); }
.artifact-history__versions span, .artifact-history__versions small { font-size: 8px; color: var(--muted); }
.artifact-history__diff { display: grid; gap: 6px; padding: 8px; border-radius: 8px; background: var(--surface-panel); }
.artifact-history__diff strong { color: var(--mint); font-size: 10px; }
.artifact-history__diff details { min-width: 0; }
.artifact-history__diff summary { color: var(--muted-strong); font-size: 10px; cursor: pointer; }
.artifact-history__diff pre { max-height: 100px; margin: 5px 0; overflow: auto; font-size: 9px; }
.artifact-history__diff span { color: var(--muted); font-size: 9px; }
.artifact-history__rollback { width: 100%; }
</style>
