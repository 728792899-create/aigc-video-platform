<template>
  <DialogRoot :open="commandOpen" @update:open="$emit('update:commandOpen', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog command-dialog">
        <DialogTitle>命令面板</DialogTitle>
        <DialogDescription>快速切换 Workspace，或创建需要审阅的导演计划。</DialogDescription>
        <div class="command-list">
          <button v-for="item in workspaces" :key="item.id" type="button" @click="$emit('selectWorkspace', item.id); $emit('update:commandOpen', false)">
            <PanelsTopLeft :size="17" /><span>{{ item.title }}</span><small>{{ item.domainView }}</small>
          </button>
          <button v-if="workspaces.length === 0" v-for="item in views" :key="item.id" type="button" @click="$emit('selectView', item.id); $emit('update:commandOpen', false)">
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
          <article><Database :size="20" /><h3>Schema v12</h3><p>Provider 连接、路由、成本账本、任务检查点与 append-only 安全审计均可恢复。</p></article>
          <article><FileCode2 :size="20" /><h3>统一 Prompt Pack</h3><p v-if="promptPack">{{ promptPack.prompts.length }} Prompt · {{ promptPack.skills.length }} Skill · {{ promptPack.workflows.length }} Workflow · {{ workflowSteps }} 阶段</p><p v-else>正在读取固定版本 Registry。</p></article>
          <article><Waypoints :size="20" /><h3>当前项目证据</h3><p v-if="evidence">{{ evidence.promptRuns }} PromptRun · {{ evidence.artifacts }} Artifact · {{ evidence.automaticReviews }} Critic</p><p v-else>创建项目后显示真实执行证据。</p></article>
          <article><Film :size="20" /><h3>系统 FFmpeg</h3><p>发行包不携带 nonfree 二进制。</p></article>
          <article><Network :size="20" /><h3>出口 Broker</h3><p v-if="egressStatus">{{ egressStatus.networkDisabled ? '网络门禁关闭' : '网络门禁已开启' }} · {{ egressStatus.policies.length }} 通道 · {{ allowedEgressHosts }} 个授权主机。</p><p v-else>正在读取安全出口状态。</p></article>
          <article><KeyRound :size="20" /><h3>安全凭据库</h3><p>原生服务使用系统 Keychain/Credential Manager；Docker 使用只读 Secret。</p></article>
          <article><ShieldOff :size="20" /><h3>可执行插件已关闭</h3><p>产品只支持内置适配器与声明式 HTTP Manifest，不上传或执行第三方 JavaScript/Python。</p></article>
        </div>
        <GenerationPolicyPanel />
        <RecoveryCenterPanel :active="systemsOpen" @close="$emit('update:systemsOpen', false)" />
        <SecurityAuditPanel :active="systemsOpen" />
        <PromptOperationsWorkspace />
        <MemoryWorkspace />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { Bot, Database, FileCode2, Film, KeyRound, Network, PanelsTopLeft, ShieldCheck, ShieldOff, Waypoints, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { EgressBrokerStatus, GraphProjection, PromptPackInventory } from '@aigc-director/contracts'
import type { StudioWorkspaceDefinition, StudioWorkspaceId } from '../workspaces.js'
import { directorApi } from '../api/client.js'
import PromptOperationsWorkspace from './PromptOperationsWorkspace.vue'
import MemoryWorkspace from './MemoryWorkspace.vue'
import GenerationPolicyPanel from './GenerationPolicyPanel.vue'
import RecoveryCenterPanel from './RecoveryCenterPanel.vue'
import SecurityAuditPanel from './SecurityAuditPanel.vue'

const props = defineProps<{
  commandOpen: boolean
  systemsOpen: boolean
  hasProject: boolean
  promptPack: PromptPackInventory | undefined
  evidence: { promptRuns: number; artifacts: number; automaticReviews: number } | undefined
  views: ReadonlyArray<{ id: GraphProjection['view']; label: string; shortcut: string; icon: Component }>
  workspaces?: ReadonlyArray<StudioWorkspaceDefinition>
}>()
const workspaces = computed(() => props.workspaces ?? [])
const workflowSteps = computed(() => props.promptPack?.workflows.reduce((total, workflow) => total + workflow.stepCount, 0) ?? 0)
const egressStatus = ref<EgressBrokerStatus>()
const allowedEgressHosts = computed(() => new Set(egressStatus.value?.policies.flatMap((policy) => policy.allowedHosts) ?? []).size)
watch(() => props.systemsOpen, async (open) => {
  if (!open) return
  egressStatus.value = await directorApi.egressStatus().catch(() => undefined)
}, { immediate: true })
defineEmits<{
  'update:commandOpen': [open: boolean]
  'update:systemsOpen': [open: boolean]
  selectView: [view: GraphProjection['view']]
  selectWorkspace: [workspace: StudioWorkspaceId]
  createPlan: []
}>()
</script>
