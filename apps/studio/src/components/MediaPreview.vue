<template>
  <div class="media-preview surface-cinema">
    <img v-if="url" :src="url" :alt="alt ?? '本地 Demo 候选画面'" />
    <div v-else-if="loading" class="media-preview__placeholder">正在读取本地媒体…</div>
    <div v-else class="media-preview__placeholder media-preview__placeholder--error">媒体加载失败</div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { directorApi } from '../api/client.js'

const props = defineProps<{ projectId: string; locator: string; alt?: string }>()
const url = ref('')
const loading = ref(false)

async function load(): Promise<void> {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
  loading.value = true
  try {
    url.value = URL.createObjectURL(await directorApi.mediaBlob(props.projectId, props.locator))
  } catch {
    // Media failures are represented by the visible retry-safe placeholder;
    // the watcher must not leak an unhandled rejection into the app shell.
    url.value = ''
  } finally {
    loading.value = false
  }
}

watch(() => [props.projectId, props.locator], load, { immediate: true })
onBeforeUnmount(() => { if (url.value) URL.revokeObjectURL(url.value) })
</script>
