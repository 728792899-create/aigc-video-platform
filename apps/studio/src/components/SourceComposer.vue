<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger as-child><slot /></DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog dialog--source">
        <div class="dialog__header">
          <div><DialogTitle>导入原著或创意文本</DialogTitle><DialogDescription>粘贴文本或先隔离预览 TXT/Markdown；确认前不会写入项目，也不会发送网络请求。</DialogDescription></div>
          <DialogClose class="icon-button" aria-label="关闭"><X :size="18" /></DialogClose>
        </div>

        <div class="source-mode-tabs" role="tablist" aria-label="导入方式">
          <button type="button" role="tab" :aria-selected="mode === 'paste'" :class="{ active: mode === 'paste' }" @click="mode = 'paste'"><FilePenLine :size="16" />粘贴文本</button>
          <button type="button" role="tab" :aria-selected="mode === 'file'" :class="{ active: mode === 'file' }" @click="mode = 'file'"><FileUp :size="16" />TXT / Markdown</button>
        </div>

        <form v-if="mode === 'paste'" class="source-form" @submit.prevent="submitPaste">
          <label for="source-title">标题</label>
          <input id="source-title" v-model="title" maxlength="200" required placeholder="试播集标题" />
          <label for="source-content">正文</label>
          <textarea id="source-content" v-model="content" required minlength="4" maxlength="2000000" rows="16" placeholder="第一章 …" />
          <div class="source-form__footer"><span>{{ content.length.toLocaleString() }} 字符</span><button class="primary-button" type="submit" :disabled="store.loading || content.length < 4"><WandSparkles :size="16" />提取章节事件</button></div>
        </form>

        <section v-else class="source-file-flow">
          <div class="source-file-picker">
            <FileUp :size="22" />
            <span><strong>{{ preview ? '重新选择 TXT / Markdown' : '选择 TXT / Markdown' }}</strong><small>UTF-8，最多 6 MB；文件先进入隔离区，不执行 Markdown 或 HTML。</small></span>
          </div>
          <input id="source-file" class="source-file-input" type="file" aria-label="选择 TXT 或 Markdown 文件" accept=".txt,.md,.markdown,text/plain,text/markdown" :disabled="store.loading" @change="chooseFile" />

          <div v-if="preview" class="source-import-preview" aria-live="polite">
            <header>
              <ShieldCheck :size="20" />
              <div><strong>隔离预览已就绪</strong><small>{{ preview.originalFileName }} · {{ preview.format === 'markdown' ? 'Markdown' : '纯文本' }} · {{ formatBytes(preview.byteSize) }} · {{ preview.characterCount.toLocaleString() }} 字符</small></div>
            </header>
            <label for="source-file-title">项目内标题</label>
            <input id="source-file-title" v-model="title" maxlength="200" required />
            <div class="source-import-facts">
              <span><small>编码</small><strong>UTF-8</strong></span>
              <span><small>内容校验</small><strong>{{ preview.contentHash.slice(0, 12) }}…</strong></span>
              <span><small>章节</small><strong>{{ preview.chapterTitles.length || '未识别' }}</strong></span>
            </div>
            <ul v-if="preview.chapterTitles.length" class="source-chapter-list"><li v-for="chapter in preview.chapterTitles" :key="chapter">{{ chapter }}</li></ul>
            <p v-for="warning in preview.warnings" :key="warning" class="source-import-warning">{{ warning }}</p>
            <pre class="source-import-text">{{ preview.previewText }}</pre>
            <p v-if="preview.previewTruncated" class="muted">预览仅显示前 20,000 字符；确认时仍会校验并导入完整文件。</p>
            <footer>
              <button class="secondary-button" type="button" :disabled="store.loading" @click="cancelPreview">取消预览</button>
              <button class="primary-button" type="button" :disabled="store.loading || title.trim().length === 0" @click="commitFile"><WandSparkles :size="16" />确认并提取事件</button>
            </footer>
          </div>
          <div v-else class="source-file-empty"><ShieldCheck :size="24" /><p>服务端将检查扩展名、UTF-8、控制字符、大小和内容 hash。取消预览不会写入 Source、Chapter 或 Event。</p></div>
        </section>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { FilePenLine, FileUp, ShieldCheck, WandSparkles, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import type { SourceImportPreview } from '@aigc-director/contracts'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const open = ref(false)
const mode = ref<'paste' | 'file'>('paste')
const title = ref('旧剧院试播集')
const content = ref('第一章 门后\n阿澈推开停用剧院的侧门。舞台上的工作灯突然亮起。她听见黑暗中有人说：别回头。\n\n第二章 回声\n阿澈没有离开，而是举起相机。镜头里出现了十年前失踪的导演。')
const preview = ref<SourceImportPreview>()

async function openComposer(): Promise<void> {
  open.value = true
  await nextTick()
  document.getElementById('source-title')?.focus()
}

defineExpose({ openComposer })

watch(open, (next) => {
  if (!next && preview.value) {
    const importId = preview.value.id
    preview.value = undefined
    void store.cancelSourceImport(importId)
  }
})

async function submitPaste(): Promise<void> {
  await store.importSource(title.value, content.value)
  if (!store.error) open.value = false
}

async function chooseFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (preview.value) await store.cancelSourceImport(preview.value.id)
  preview.value = await store.previewSourceImport(file)
  if (preview.value) title.value = preview.value.suggestedTitle
}

async function commitFile(): Promise<void> {
  if (!preview.value) return
  const committed = await store.commitSourceImport(preview.value, title.value.trim())
  if (committed) {
    preview.value = undefined
    open.value = false
  }
}

async function cancelPreview(): Promise<void> {
  if (!preview.value) return
  const importId = preview.value.id
  preview.value = undefined
  await store.cancelSourceImport(importId)
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}
</script>
