<template>
  <DialogRoot :open="commandOpen" @update:open="$emit('update:commandOpen', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog command-dialog">
        <DialogTitle>命令面板</DialogTitle>
        <DialogDescription>快速切换领域图或创建需要审阅的导演计划。</DialogDescription>
        <div class="command-list">
          <button v-for="item in views" :key="item.id" type="button" @click="$emit('selectView', item.id); $emit('update:commandOpen', false)">
            <component :is="item.icon" :size="17" /><span>{{ item.label }}</span><small>{{ item.shortcut }}</small>
          </button>
          <button type="button" :disabled="!hasProject" @click="$emit('createPlan'); $emit('update:commandOpen', false)">
            <Bot :size="17" /><span>生成导演计划</span><small>Enter</small>
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot :open="systemsOpen" @update:open="$emit('update:systemsOpen', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog systems-dialog">
        <div class="dialog__header">
          <div><DialogTitle>系统与 Provider</DialogTitle><DialogDescription>当前运行边界来自真实 2.0 配置。</DialogDescription></div>
          <DialogClose class="icon-button" aria-label="关闭系统面板"><X :size="18" /></DialogClose>
        </div>
        <div class="systems-grid">
          <article><ShieldCheck :size="20" /><h3>本地会话</h3><p>127.0.0.1、随机会话令牌、严格 Origin。</p></article>
          <article><Bot :size="20" /><h3>Demo Provider</h3><p>本地确定性执行，付费请求 0；支持 receipt 与 reconcile。</p></article>
          <article><Database :size="20" /><h3>Schema v9</h3><p>Series/Episode、Prompt/Skill、CandidateBatch、媒体 receipt、Agent 记忆 checkpoint、插件与发布者信任均可恢复。</p></article>
          <article><FileCode2 :size="20" /><h3>统一 Prompt Pack</h3><p v-if="promptPack">{{ promptPack.prompts.length }} Prompt · {{ promptPack.skills.length }} Skill · {{ promptPack.workflows.length }} Workflow · {{ workflowSteps }} 阶段</p><p v-else>正在读取固定版本 Registry。</p></article>
          <article><Waypoints :size="20" /><h3>当前项目证据</h3><p v-if="evidence">{{ evidence.promptRuns }} PromptRun · {{ evidence.artifacts }} Artifact · {{ evidence.automaticReviews }} Critic</p><p v-else>创建项目后显示真实执行证据。</p></article>
          <article><Film :size="20" /><h3>系统 FFmpeg</h3><p>发行包不携带 nonfree 二进制。</p></article>
          <article><Network :size="20" /><h3>出口 Broker</h3><p v-if="egressStatus">{{ egressStatus.networkDisabled ? '网络门禁关闭' : '网络门禁已开启' }} · {{ egressStatus.policies.length }} 通道 · {{ allowedEgressHosts }} 个授权主机。</p><p v-else>正在读取安全出口状态。</p></article>
          <article class="runtime-card">
            <Download :size="20" />
            <h3>隔离插件运行时</h3>
            <template v-if="denoRuntime">
              <p>Deno {{ denoRuntime.version }} · {{ runtimeStateLabel }}<template v-if="denoRuntime.downloadBytes"> · {{ formatBytes(denoRuntime.downloadBytes) }}</template></p>
              <p class="runtime-card__note">安装包不携带运行时；下载前固定校验官方资产大小、SHA-256 和精确版本。</p>
              <div v-if="denoRuntime.state === 'installing'" class="runtime-progress" role="status" aria-live="polite">
                <span>{{ runtimePhaseLabel }} · {{ runtimeProgressPercent }}%</span>
                <progress :value="runtimeProgressPercent" max="100" aria-label="Deno 运行时安装进度" />
              </div>
              <button
                v-if="denoRuntime.state === 'not-installed' || denoRuntime.state === 'installing'"
                type="button"
                :disabled="!denoRuntime.installAllowed && !runtimeBusy"
                @click="runtimeBusy ? cancelRuntimeInstall() : installRuntime()"
              >
                {{ runtimeBusy ? '取消安装' : denoRuntime.networkDisabled ? '网络门禁关闭' : runtimeConfirm ? '再次点击确认下载' : '准备安装运行时' }}
              </button>
            </template>
            <p v-else>正在检查本地运行时。</p>
            <p v-if="runtimeError" class="runtime-card__error" role="alert">{{ runtimeError }}</p>
          </article>
          <article class="plugin-card">
            <Puzzle :size="20" />
            <h3>Provider 插件</h3>
            <p v-if="providerPlugins.length === 0">未安装受信签名插件；发布者信任列表默认为空。</p>
            <ul v-else class="plugin-list">
              <li v-for="plugin in providerPlugins" :key="plugin.id">
                <span><strong>{{ plugin.manifest.displayName }}</strong><small>{{ plugin.version }} · {{ pluginStateLabel(plugin.state) }}</small></span>
                <button
                  v-if="plugin.state === 'installed'"
                  type="button"
                  :disabled="pluginBusy === plugin.id || denoRuntime?.state !== 'ready'"
                  @click="runPluginAction(plugin, 'test')"
                >{{ pluginActionLabel(plugin, 'test') }}</button>
                <button
                  v-else-if="plugin.state === 'tested'"
                  type="button"
                  :disabled="pluginBusy === plugin.id"
                  @click="runPluginAction(plugin, 'enable')"
                >{{ pluginActionLabel(plugin, 'enable') }}</button>
                <button v-else-if="plugin.state === 'enabled'" type="button" :disabled="pluginBusy === plugin.id" @click="runPluginAction(plugin, 'disable')">停用</button>
              </li>
            </ul>
            <p class="runtime-card__note">签名验证 → 沙箱测试 → 手动启用；任何失败都会进入隔离态。</p>
            <p v-if="pluginError" class="runtime-card__error" role="alert">{{ pluginError }}</p>
          </article>
          <ProviderPublisherTrust :active="systemsOpen" />
        </div>
        <PromptOperationsWorkspace />
        <MemoryWorkspace />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { Bot, Database, Download, FileCode2, Film, Network, Puzzle, ShieldCheck, Waypoints, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { DenoRuntimeStatus, EgressBrokerStatus, GraphProjection, PromptPackInventory, ProviderPluginRecord } from '@aigc-director/contracts'
import { DirectorApiError, directorApi } from '../api/client.js'
import PromptOperationsWorkspace from './PromptOperationsWorkspace.vue'
import MemoryWorkspace from './MemoryWorkspace.vue'
import ProviderPublisherTrust from './ProviderPublisherTrust.vue'

const props = defineProps<{
  commandOpen: boolean
  systemsOpen: boolean
  hasProject: boolean
  promptPack: PromptPackInventory | undefined
  evidence: { promptRuns: number; artifacts: number; automaticReviews: number } | undefined
  views: ReadonlyArray<{ id: GraphProjection['view']; label: string; shortcut: string; icon: Component }>
}>()
const workflowSteps = computed(() => props.promptPack?.workflows.reduce((total, workflow) => total + workflow.stepCount, 0) ?? 0)
const egressStatus = ref<EgressBrokerStatus>()
const denoRuntime = ref<DenoRuntimeStatus>()
const runtimeBusy = ref(false)
const runtimeConfirm = ref(false)
const runtimeError = ref('')
let runtimePollGeneration = 0
const providerPlugins = ref<ProviderPluginRecord[]>([])
const pluginBusy = ref('')
const pluginConfirm = ref<{ id: string; action: 'test' | 'enable' }>()
const pluginError = ref('')
const allowedEgressHosts = computed(() => new Set(egressStatus.value?.policies.flatMap((policy) => policy.allowedHosts) ?? []).size)
const runtimeStateLabel = computed(() => ({
  'not-installed': '未安装', ready: '已验证', invalid: '安装异常', unsupported: '当前平台不支持', installing: '安装中',
})[denoRuntime.value?.state ?? 'not-installed'])
const runtimePhaseLabel = computed(() => ({
  downloading: '正在下载', verifying: '正在校验', extracting: '正在解压', probing: '正在验证版本', publishing: '正在原子发布',
})[denoRuntime.value?.progress?.phase ?? 'downloading'])
const runtimeProgressPercent = computed(() => {
  const progress = denoRuntime.value?.progress
  if (!progress) return 0
  return Math.min(100, Math.round(progress.receivedBytes / progress.totalBytes * 100))
})
const formatBytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const pluginStateLabel = (state: ProviderPluginRecord['state']): string => ({ installed: '已安装未测试', tested: '已通过沙箱测试', enabled: '已启用', quarantined: '已隔离' })[state]
const pluginActionLabel = (plugin: ProviderPluginRecord, action: 'test' | 'enable'): string => {
  if (pluginBusy.value === plugin.id) return action === 'test' ? '正在沙箱测试…' : '正在启用…'
  if (pluginConfirm.value?.id === plugin.id && pluginConfirm.value.action === action) return action === 'test' ? '再次点击执行沙箱测试' : '再次点击启用'
  return action === 'test' ? '准备沙箱测试' : '准备启用'
}
function replacePlugin(plugin: ProviderPluginRecord): void {
  providerPlugins.value = providerPlugins.value.map((current) => current.id === plugin.id ? plugin : current)
}
async function pollRuntimeInstall(generation: number): Promise<void> {
  while (runtimeBusy.value && generation === runtimePollGeneration) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (!runtimeBusy.value || generation !== runtimePollGeneration) return
    const status = await directorApi.denoRuntimeStatus().catch(() => undefined)
    if (status?.state === 'installing') denoRuntime.value = status
  }
}
async function runPluginAction(plugin: ProviderPluginRecord, action: 'test' | 'enable' | 'disable'): Promise<void> {
  if (action !== 'disable' && (pluginConfirm.value?.id !== plugin.id || pluginConfirm.value.action !== action)) {
    pluginConfirm.value = { id: plugin.id, action }
    pluginError.value = ''
    return
  }
  pluginBusy.value = plugin.id
  pluginError.value = ''
  try {
    if (action === 'test') replacePlugin((await directorApi.testProviderPlugin(plugin.id, plugin.revision)).plugin)
    else if (action === 'enable') replacePlugin(await directorApi.enableProviderPlugin(plugin.id, plugin.revision))
    else replacePlugin(await directorApi.disableProviderPlugin(plugin.id, plugin.revision))
    pluginConfirm.value = undefined
  } catch (error) {
    pluginError.value = error instanceof Error ? error.message : 'Provider 插件操作失败。'
    providerPlugins.value = await directorApi.listProviderPlugins().catch(() => providerPlugins.value)
  } finally { pluginBusy.value = '' }
}
async function installRuntime(): Promise<void> {
  if (!runtimeConfirm.value) { runtimeConfirm.value = true; runtimeError.value = ''; return }
  runtimeBusy.value = true
  runtimeError.value = ''
  const generation = ++runtimePollGeneration
  if (denoRuntime.value?.downloadBytes) {
    denoRuntime.value = {
      ...denoRuntime.value, state: 'installing', installAllowed: false,
      progress: { phase: 'downloading', receivedBytes: 0, totalBytes: denoRuntime.value.downloadBytes },
    }
  }
  void pollRuntimeInstall(generation)
  try {
    denoRuntime.value = await directorApi.installDenoRuntime()
    runtimeConfirm.value = false
  } catch (error) {
    if (!(error instanceof DirectorApiError && error.code === 'DENO_RUNTIME_ABORTED')) {
      runtimeError.value = error instanceof Error ? error.message : '运行时安装失败，请稍后重试。'
    }
  } finally { runtimeBusy.value = false; runtimePollGeneration += 1 }
}
async function cancelRuntimeInstall(): Promise<void> {
  runtimeError.value = ''
  try {
    const report = await directorApi.cancelDenoRuntimeInstall()
    denoRuntime.value = report.runtime
    runtimeConfirm.value = false
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : '运行时安装取消失败。'
  } finally { runtimeBusy.value = false; runtimePollGeneration += 1 }
}
watch(() => props.systemsOpen, async (open) => {
  if (!open) return
  runtimeConfirm.value = false
  runtimeError.value = ''
  pluginConfirm.value = undefined
  pluginError.value = ''
  const [egress, runtime, plugins] = await Promise.allSettled([directorApi.egressStatus(), directorApi.denoRuntimeStatus(), directorApi.listProviderPlugins()])
  egressStatus.value = egress.status === 'fulfilled' ? egress.value : undefined
  denoRuntime.value = runtime.status === 'fulfilled' ? runtime.value : undefined
  providerPlugins.value = plugins.status === 'fulfilled' ? plugins.value : []
}, { immediate: true })
defineEmits<{
  'update:commandOpen': [open: boolean]
  'update:systemsOpen': [open: boolean]
  selectView: [view: GraphProjection['view']]
  createPlan: []
}>()
</script>
