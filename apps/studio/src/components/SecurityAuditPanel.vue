<template>
  <section class="security-audit" aria-labelledby="security-audit-title">
    <header>
      <div>
        <span class="eyebrow">SECURITY / AUDIT</span>
        <h3 id="security-audit-title">高风险动作审计</h3>
        <p>只记录固定动作、结果、关联 ID 与哈希引用；不会保存 Prompt、凭据、路径或请求正文。</p>
      </div>
      <button type="button" :disabled="busy || !store.currentProjectId" @click="refresh">刷新审计</button>
    </header>

    <div v-if="!store.currentProjectId" class="task-empty">选择项目后显示本地 append-only 审计证据。</div>
    <div v-else-if="busy && !log" class="task-empty" role="status">正在读取审计事件。</div>
    <p v-else-if="error" class="runtime-card__error" role="alert">{{ error }}</p>
    <template v-else-if="log">
      <dl class="security-audit__summary">
        <div><dt>事件</dt><dd>{{ log.events.length }}</dd></div>
        <div><dt>已完成</dt><dd>{{ succeededCount }}</dd></div>
        <div><dt>已拒绝</dt><dd>{{ rejectedCount }}</dd></div>
      </dl>
      <p v-if="log.events.length === 0" class="task-empty">尚无高风险动作；普通查看和本地编辑不会制造审计噪声。</p>
      <ol v-else class="security-audit__events">
        <li v-for="event in log.events" :key="event.id">
          <span :class="`status-pill status-pill--${event.status}`">{{ statusLabel(event.status) }}</span>
          <div>
            <strong>{{ actionLabel(event.action) }}</strong>
            <p>{{ formatTime(event.createdAt) }} · {{ event.targetType }} / {{ event.targetReferenceHash.slice(0, 12) }}</p>
          </div>
          <code :title="event.correlationId">{{ event.errorCode ?? event.correlationId.slice(0, 12) }}</code>
        </li>
      </ol>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ProjectSecurityAuditLog, SecurityAuditAction, SecurityAuditEvent } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'

const props = defineProps<{ active: boolean }>()
const store = useStudioStore()
const log = ref<ProjectSecurityAuditLog>()
const busy = ref(false)
const error = ref('')
const succeededCount = computed(() => log.value?.events.filter((event) => event.status === 'succeeded').length ?? 0)
const rejectedCount = computed(() => log.value?.events.filter((event) => event.status === 'rejected').length ?? 0)

watch(() => [props.active, store.currentProjectId] as const, ([active, projectId]) => {
  log.value = undefined
  if (active && projectId) void refresh()
}, { immediate: true })

async function refresh(): Promise<void> {
  if (!store.currentProjectId) return
  busy.value = true
  error.value = ''
  try {
    log.value = await directorApi.projectSecurityAudit(store.currentProjectId, 100)
  } catch {
    error.value = '审计记录暂时无法读取；高风险操作不会因此降级为未审计执行。'
  } finally {
    busy.value = false
  }
}

function statusLabel(status: SecurityAuditEvent['status']): string {
  return ({ started: '已发起', succeeded: '已完成', rejected: '已拒绝' })[status]
}

function actionLabel(action: SecurityAuditAction): string {
  return ({
    'creative_brief.review': '审阅创作简报',
    'scene_patch.apply': '应用场景修订',
    'source_import.commit': '提交来源导入',
    'graph.clear_boundary': '解除边界帧绑定',
    'candidate_batch.retry_failed': '重试失败候选',
    'provider_candidate.submit': '提交用户自付候选',
    'export.approve': '批准本地导出',
    'generation_policy.update': '更新生成策略',
    'task.cancel': '取消任务',
    'task.retry': '重试任务',
    'task.reconcile': '对账任务',
    'artifact.rollback': '回滚 Artifact',
    'prompt.publish': '发布 Prompt',
    'prompt.rollback': '回滚 Prompt',
    'skill.publish': '发布 Skill',
    'skill.rollback': '回滚 Skill',
  })[action]
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
}
</script>
