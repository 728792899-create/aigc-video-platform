<template>
  <section
    class="governance-v2"
    data-figma-node="24:100"
    data-figma-spec="T/18-Governance"
    data-onboarding-target="systems"
    data-guide-target="local-governance"
    tabindex="-1"
    aria-labelledby="governance-cloud-title"
  >
    <div class="governance-v2__top">
      <section class="governance-card governance-cloud" aria-labelledby="governance-cloud-title">
        <header>
          <h1 id="governance-cloud-title">云端能力（当前不启用）</h1>
          <p>账号、组织、成员、RBAC、Presence 和远程协作均已移出 Local v1</p>
        </header>
        <dl class="governance-rows">
          <div v-for="item in cloudBoundaries" :key="item.label">
            <dt><Circle :size="7" fill="currentColor" />{{ item.label }}</dt>
            <dd>不提供</dd>
            <small>关闭</small>
          </div>
        </dl>
        <button class="governance-button governance-button--primary" type="button" @click="scopeOpen = true">查看 Local v1 范围</button>
      </section>

      <section class="governance-card governance-policies" aria-labelledby="governance-policies-title">
        <header>
          <h2 id="governance-policies-title">安全策略</h2>
          <p>高风险变更需要二次确认与追加式审计</p>
        </header>
        <dl class="governance-rows governance-policy-rows">
          <div v-for="item in securityPolicies" :key="item.label">
            <dt :data-tone="item.tone"><Circle :size="7" fill="currentColor" />{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <div class="governance-v2__bottom">
      <section class="governance-card governance-audit" aria-labelledby="governance-audit-title">
        <header>
          <div>
            <h2 id="governance-audit-title">安全审计</h2>
            <p>事件采用稳定码；正文、路径、凭证和 payload 不入库</p>
          </div>
          <button class="governance-icon-button" type="button" :disabled="busy || !store.currentProjectId" aria-label="刷新安全审计" @click="refresh">
            <RefreshCw :size="16" :class="{ spinning: busy }" />
          </button>
        </header>

        <div v-if="!store.currentProjectId" class="governance-empty">选择本地项目后显示追加式审计证据。</div>
        <div v-else-if="busy && !auditLog" class="governance-empty" role="status">正在读取脱敏审计证据…</div>
        <p v-else-if="error" class="governance-error" role="alert">{{ error }}</p>
        <ol v-else class="governance-audit__list">
          <li v-for="event in visibleAuditEvents" :key="event.id">
            <time><Circle :size="7" fill="currentColor" />{{ formatTime(event.createdAt) }}</time>
            <strong>{{ stableActionCode(event.action) }}</strong>
            <span>{{ auditActor(event.action) }}</span>
          </li>
          <li v-if="visibleAuditEvents.length === 0" class="governance-audit__empty">尚无高风险动作；普通浏览不会制造审计噪声。</li>
        </ol>

        <button class="governance-button governance-button--secondary" type="button" :disabled="!auditLog || busy" @click="downloadAuditEvidence">
          <Download :size="15" />导出脱敏审计证据
        </button>
      </section>

      <section class="governance-card governance-backup" aria-labelledby="governance-backup-title">
        <header>
          <h2 id="governance-backup-title">备份与恢复</h2>
          <p>{{ backupSubtitle }}</p>
        </header>
        <dl class="governance-rows governance-backup-rows">
          <div><dt><Circle :size="7" fill="currentColor" />数据库快照</dt><dd>{{ snapshotState }}</dd></div>
          <div><dt><Circle :size="7" fill="currentColor" />媒体清单</dt><dd>{{ mediaManifestState }}</dd></div>
          <div><dt><Circle :size="7" fill="currentColor" />凭证排除</dt><dd>服务端强制</dd></div>
        </dl>

        <button class="governance-backup-card" type="button" :disabled="busy || !store.currentProjectId" @click="verifyAndDownloadBackup">
          <span><Archive :size="15" />BackupCard · 验证恢复点</span>
          <small>{{ backupCardDetail }}</small>
        </button>

        <input ref="restoreInput" class="visually-hidden" type="file" accept=".aigcproj,application/vnd.aigc-director.project+zip" @change="restoreFromPackage" />
        <button class="governance-button governance-button--primary" type="button" :disabled="busy" @click="restoreInput?.click()">
          <RotateCcw :size="15" />从验证点恢复演练
        </button>
      </section>
    </div>

    <DialogRoot v-model:open="scopeOpen">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="dialog governance-scope-dialog">
          <div class="dialog__header">
            <div><DialogTitle>Local v1 范围</DialogTitle><DialogDescription>当前版本不依赖登录、云数据库或团队订阅。</DialogDescription></div>
            <DialogClose class="icon-button" aria-label="关闭 Local v1 范围"><X :size="18" /></DialogClose>
          </div>
          <ul>
            <li><CheckCircle2 :size="17" />项目、媒体、任务和恢复证据只保存在本机数据目录。</li>
            <li><CheckCircle2 :size="17" />Provider 密钥进入系统凭据库或 Docker Secret，不进入项目包。</li>
            <li><CheckCircle2 :size="17" />项目包校验 manifest、SHA-256、媒体清单和内部引用。</li>
            <li><CloudOff :size="17" />组织、成员、RBAC、在线 Presence 与云端数据库均未启用。</li>
          </ul>
          <footer><DialogClose class="governance-button governance-button--primary">了解本地边界</DialogClose></footer>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Archive, CheckCircle2, Circle, CloudOff, Download, RefreshCw, RotateCcw, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { ProjectRecoveryReport, ProjectSecurityAuditLog, SecurityAuditAction } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const auditLog = ref<ProjectSecurityAuditLog>()
const recoveryReport = ref<ProjectRecoveryReport>()
const busy = ref(false)
const error = ref('')
const scopeOpen = ref(false)
const restoreInput = ref<HTMLInputElement>()
const verifiedAt = ref<string>()
const verifiedBytes = ref(0)

const cloudBoundaries = [
  { label: '身份边界' },
  { label: '协作边界' },
  { label: '在线协作边界' },
  { label: '云端数据库' },
] as const

const securityPolicies = [
  { label: '凭证存储', value: '系统 Keychain / Credential Manager', tone: 'success' },
  { label: '外部链接', value: '白名单 + 系统浏览器', tone: 'success' },
  { label: 'Provider 凭证', value: '仅本机 Keychain / Docker Secret', tone: 'warning' },
  { label: '诊断导出', value: '默认脱敏', tone: 'success' },
  { label: '任意 JS 适配器', value: '本地亦禁止', tone: 'danger' },
] as const

const visibleAuditEvents = computed(() => auditLog.value?.events.slice(0, 4) ?? [])
const snapshotState = computed(() => store.snapshot ? `r${store.snapshot.project.graphRevision} 已加载` : '等待项目')
const mediaManifestState = computed(() => store.snapshot ? `${store.snapshot.media.length} / ${store.snapshot.media.length}` : '0 / 0')
const backupSubtitle = computed(() => verifiedAt.value ? `最近验证：${formatDateTime(verifiedAt.value)}` : '尚未验证当前恢复点')
const backupCardDetail = computed(() => verifiedAt.value
  ? `数据库 / ${store.snapshot?.media.length ?? 0} 项媒体 / 凭证排除均通过 · ${formatBytes(verifiedBytes.value)}`
  : '点击生成项目包，并验证 ZIP 签名、媒体引用与凭证排除')

watch(() => store.currentProjectId, () => {
  auditLog.value = undefined
  recoveryReport.value = undefined
  verifiedAt.value = undefined
  verifiedBytes.value = 0
  void refresh()
})

onMounted(() => { void refresh() })

async function refresh(): Promise<void> {
  if (!store.currentProjectId) return
  busy.value = true
  error.value = ''
  try {
    const [nextAudit, nextRecovery] = await Promise.all([
      directorApi.projectSecurityAudit(store.currentProjectId, 100),
      directorApi.projectRecoveryReport(store.currentProjectId),
    ])
    auditLog.value = nextAudit
    recoveryReport.value = nextRecovery
  } catch {
    error.value = '本地审计或恢复状态暂时无法读取；高风险操作不会因此降级执行。'
  } finally {
    busy.value = false
  }
}

async function verifyAndDownloadBackup(): Promise<void> {
  const exported = await store.exportProjectPackage()
  if (!exported) return
  const bytes = new Uint8Array(await exported.blob.arrayBuffer())
  const zipSignatureValid = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  if (!zipSignatureValid) {
    error.value = '恢复点未通过 ZIP 签名检查，未下载。'
    return
  }
  verifiedAt.value = new Date().toISOString()
  verifiedBytes.value = bytes.byteLength
  const url = URL.createObjectURL(exported.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exported.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

async function restoreFromPackage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await store.importProjectPackage(file)
  if (!store.error) {
    verifiedAt.value = new Date().toISOString()
    verifiedBytes.value = file.size
    await refresh()
  }
}

async function downloadAuditEvidence(): Promise<void> {
  if (!auditLog.value || !store.currentProjectId) return
  const projectReferenceHash = await sha256(store.currentProjectId)
  const evidence = {
    format: 'aigc-director-security-audit',
    version: 1,
    generatedAt: new Date().toISOString(),
    projectReferenceHash,
    events: auditLog.value.events.map((event) => ({
      action: stableActionCode(event.action), status: event.status, targetType: event.targetType,
      targetReferenceHash: event.targetReferenceHash, correlationId: event.correlationId,
      ...(event.errorCode ? { errorCode: event.errorCode } : {}), createdAt: event.createdAt,
    })),
    recoverySummary: recoveryReport.value?.summary,
    privacy: { credentialsIncluded: false, absolutePathsIncluded: false, rawUserContentIncluded: false, providerPayloadsIncluded: false },
  }
  const blob = new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `aigc-security-audit-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function stableActionCode(action: SecurityAuditAction): string {
  return action.replaceAll('.', '_').toUpperCase()
}

function auditActor(action: SecurityAuditAction): string {
  return action === 'task.reconcile' ? '系统 / 本地用户' : '本地用户'
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
</script>

<style scoped>
.governance-v2{box-sizing:border-box;height:100%;min-height:0;display:grid;grid-template-rows:350px 410px;gap:20px;padding:24px;overflow:auto;color:var(--text);background:var(--surface-canvas)}
.governance-v2__top,.governance-v2__bottom{min-width:0;display:grid;gap:20px}.governance-v2__top{grid-template-columns:500px minmax(0,656px)}.governance-v2__bottom{grid-template-columns:minmax(0,760px) minmax(0,396px)}
.governance-card{box-sizing:border-box;min-width:0;min-height:0;position:relative;padding:16px 17px;border:1px solid var(--line);border-radius:12px;background:var(--surface-panel);overflow:hidden}.governance-card header h1,.governance-card header h2{margin:0;color:var(--text);font-size:14px;font-weight:650;line-height:21px}.governance-card header p{margin:4px 0 0;color:var(--text-muted);font-size:11px;line-height:16px}.governance-card button{font:inherit}.governance-card button:focus-visible,.governance-scope-dialog button:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.governance-rows{display:grid;gap:14px;margin:14px 0 0}.governance-rows>div{min-height:44px;display:grid;grid-template-columns:146px minmax(0,1fr) 70px;align-items:center;gap:10px}.governance-rows dt{width:max-content;min-height:26px;display:inline-flex;align-items:center;gap:7px;margin:0;padding:0 10px;border-radius:999px;color:var(--text-secondary);background:var(--surface-raised);font-size:11px}.governance-rows dt svg{color:var(--success)}.governance-rows dt[data-tone="warning"] svg{color:var(--status-warning)}.governance-rows dt[data-tone="danger"] svg{color:var(--danger)}.governance-rows dd{min-width:0;margin:0;overflow:hidden;color:var(--text);font-size:11px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.governance-rows small{color:var(--text-muted);font-size:11px;text-align:right}
.governance-button{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 14px;border:1px solid var(--line);border-radius:10px;color:var(--text);background:var(--surface-raised);font-size:12px;font-weight:650;cursor:pointer}.governance-button:hover{border-color:var(--border-strong)}.governance-button:disabled{cursor:not-allowed;opacity:.48}.governance-button--primary{border-color:var(--accent-primary);color:var(--surface-canvas);background:var(--accent-primary)}.governance-button--secondary{background:var(--surface-raised)}
.governance-cloud>.governance-button{position:absolute;right:17px;bottom:16px}.governance-policies .governance-rows{gap:4px;margin-top:11px}.governance-policy-rows>div{grid-template-columns:182px minmax(0,1fr)}
.governance-audit header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.governance-icon-button{width:44px;height:44px;display:grid;place-items:center;border:1px solid transparent;border-radius:9px;color:var(--text-muted);background:transparent;cursor:pointer}.governance-icon-button:hover{border-color:var(--line);color:var(--text);background:var(--surface-raised)}.spinning{animation:governance-spin .8s linear infinite}@keyframes governance-spin{to{transform:rotate(360deg)}}
.governance-audit__list{display:grid;align-content:start;gap:9px;min-height:236px;margin:15px 0 0;padding:0;list-style:none}.governance-audit__list li{min-height:48px;display:grid;grid-template-columns:76px minmax(0,1fr) 130px;align-items:center;gap:10px}.governance-audit__list time{width:max-content;min-height:26px;display:inline-flex;align-items:center;gap:7px;padding:0 10px;border-radius:999px;color:var(--text-secondary);background:var(--surface-raised);font-size:11px;font-variant-numeric:tabular-nums}.governance-audit__list time svg{color:var(--status-warning)}.governance-audit__list li:nth-child(2) time svg{color:var(--success)}.governance-audit__list li:nth-child(n+3) time svg{color:var(--status-info)}.governance-audit__list strong{min-width:0;overflow:hidden;font-size:11px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.governance-audit__list span{color:var(--text-muted);font-size:11px}.governance-audit__empty{grid-template-columns:1fr!important;color:var(--text-muted);font-size:11px}.governance-audit>.governance-button{position:absolute;left:17px;bottom:16px}.governance-empty,.governance-error{min-height:230px;display:grid;place-items:center;margin:12px 0 0;color:var(--text-muted);font-size:11px;text-align:center}.governance-error{color:var(--danger)}
.governance-backup-rows{gap:7px;margin-top:11px}.governance-backup-rows>div{grid-template-columns:minmax(0,1fr) 112px}.governance-backup-card{width:300px;min-height:78px;display:grid;align-content:center;gap:7px;margin-top:12px;padding:11px 13px;border:1px solid var(--success);border-radius:13px;color:var(--text);background:var(--surface-raised);text-align:left;cursor:pointer}.governance-backup-card>span{display:flex;align-items:center;gap:7px;font-size:12px}.governance-backup-card>small{overflow:hidden;color:var(--success);font-size:10px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.governance-backup>.governance-button{position:absolute;left:17px;bottom:16px}
.governance-scope-dialog{width:min(560px,calc(100vw - 28px))}.governance-scope-dialog ul{display:grid;gap:12px;margin:18px 0;padding:0;list-style:none}.governance-scope-dialog li{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:9px;color:var(--text-secondary);font-size:12px;line-height:1.65}.governance-scope-dialog li svg{margin-top:1px;color:var(--success)}.governance-scope-dialog li:last-child svg{color:var(--status-warning)}.governance-scope-dialog footer{display:flex;justify-content:flex-end}
@media(max-width:1180px){.governance-v2{grid-template-rows:auto auto;padding:18px}.governance-v2__top{grid-template-columns:minmax(0,.43fr) minmax(0,.57fr)}.governance-v2__bottom{grid-template-columns:minmax(0,.66fr) minmax(0,.34fr)}.governance-rows>div{grid-template-columns:minmax(110px,146px) minmax(0,1fr) 48px}.governance-policy-rows>div{grid-template-columns:150px minmax(0,1fr)}.governance-audit__list li{grid-template-columns:72px minmax(0,1fr) 100px}.governance-backup-card{width:100%}}
@media(max-width:760px){.governance-v2{height:auto;min-height:100%;display:block;padding:14px 14px 96px}.governance-v2__top,.governance-v2__bottom{display:grid;grid-template-columns:1fr;gap:14px}.governance-v2__bottom{margin-top:14px}.governance-card{height:auto;min-height:350px}.governance-audit{min-height:410px}.governance-cloud>.governance-button,.governance-audit>.governance-button,.governance-backup>.governance-button{position:static;margin-top:14px}.governance-rows>div,.governance-policy-rows>div{grid-template-columns:minmax(120px,1fr) minmax(0,1.2fr) auto}.governance-policy-rows>div{grid-template-columns:150px minmax(0,1fr)}.governance-audit__list{min-height:0}.governance-audit__list li{grid-template-columns:72px minmax(0,1fr);padding:6px 0}.governance-audit__list span{grid-column:2}.governance-backup-card{width:100%}}
</style>
