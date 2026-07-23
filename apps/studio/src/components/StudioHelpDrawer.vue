<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog help-drawer" data-onboarding-target="help-drawer">
        <header class="help-drawer__header">
          <div><span class="eyebrow">HELP / {{ definition.shortTitle }}</span><DialogTitle>{{ definition.helpTopic }}</DialogTitle><DialogDescription>{{ definition.description }}</DialogDescription></div>
          <DialogClose class="icon-button" aria-label="关闭帮助并返回触发位置"><X :size="18" /></DialogClose>
        </header>
        <nav class="help-drawer__tabs" aria-label="帮助主题">
          <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">{{ tab.label }}</button>
        </nav>
        <div class="help-drawer__body">
          <section v-if="activeTab === 'stage'">
            <h3>当前阶段怎么完成</h3>
            <dl class="help-facts"><div><dt>主操作</dt><dd>{{ definition.primaryAction }}</dd></div><div><dt>完成条件</dt><dd>{{ definition.completion }}</dd></div><div><dt>实现状态</dt><dd>{{ implementationLabel }}</dd></div></dl>
            <p v-if="definition.currentAlternative" class="inline-alert"><Info :size="16" />{{ definition.currentAlternative }}</p>
          </section>
          <section v-else-if="activeTab === 'states'">
            <h3>状态说明</h3>
            <dl class="help-facts">
              <div><dt>内容已过期</dt><dd>上游版本发生变化；旧结果保留，但应在继续前检查。</dd></div>
              <div><dt>结果未知</dt><dd>禁止盲目重提；先打开任务中心，使用原请求标识进行对账。</dd></div>
              <div><dt>部分成功</dt><dd>成功项继续保留，只为失败项创建新的重试批次。</dd></div>
              <div><dt>当前可靠版本</dt><dd>发布失败时仍可使用的最后一个已验证 Prompt/Skill 版本。</dd></div>
            </dl>
          </section>
          <section v-else-if="activeTab === 'recovery'">
            <h3>失败与恢复</h3>
            <ol><li>先查看稳定错误码和最近 Attempt。</li><li>结果未知时执行对账；不要直接重复提交。</li><li>部分失败时只重试失败候选。</li><li>重启后从服务器 checkpoint 恢复，不依赖引导偏好。</li></ol>
            <button class="primary-button" type="button" @click="$emit('openTasks')">打开任务中心并诊断</button>
          </section>
          <section v-else-if="activeTab === 'privacy'">
            <h3>Demo 与隐私边界</h3>
            <ul><li>零 Key Demo 只使用本地确定性 Provider，计费为 0。</li><li>凭证不进入项目包、备份、日志或前端响应。</li><li>诊断包排除正文、Prompt、路径、凭证和 Provider payload。</li><li>开发预览记录器默认关闭，且不会上传网络。</li></ul>
          </section>
          <section v-else>
            <h3>键盘操作</h3>
            <dl class="help-facts"><div><dt>⌘/Ctrl + K</dt><dd>打开 Workspace 命令面板</dd></div><div><dt>1 / 2 / 3</dt><dd>切换 Story / Production / Delivery 领域图</dd></div><div><dt>Escape</dt><dd>关闭浮层并返回触发位置</dd></div><div><dt>Tab / Shift+Tab</dt><dd>按视觉与语义顺序移动焦点</dd></div></dl>
          </section>
        </div>
        <footer><button class="secondary-button" type="button" @click="$emit('restartGuide')"><RotateCcw :size="16" />重新开始工作台导览</button></footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Info, RotateCcw, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { StudioWorkspaceDefinition } from '../workspaces.js'

const props = defineProps<{ open: boolean; definition: StudioWorkspaceDefinition }>()
defineEmits<{ 'update:open': [open: boolean]; openTasks: []; restartGuide: [] }>()

const tabs = [
  { id: 'stage', label: '当前阶段' }, { id: 'states', label: '状态词典' }, { id: 'recovery', label: '恢复' },
  { id: 'privacy', label: '隐私' }, { id: 'shortcuts', label: '快捷键' },
] as const
const activeTab = ref<(typeof tabs)[number]['id']>('stage')
const implementationLabel = computed(() => ({ implemented: '当前已实现', partial: '部分可用，规划能力有明确标注', planned: '规划中，不提供假交互' })[props.definition.implementation])
watch(() => props.open, (open) => { if (open) activeTab.value = 'stage' })
</script>
