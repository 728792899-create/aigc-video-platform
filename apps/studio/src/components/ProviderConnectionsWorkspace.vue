<template>
  <section class="provider-connections" data-figma-node="24:2" data-figma-spec="T/17-Provider" data-guide-target="provider-marketplace" aria-labelledby="provider-connections-title">
    <header class="provider-connections__scope">
      <div>
        <h1 id="provider-connections-title">Provider 连接</h1>
        <p>凭证从不出现在前端响应、日志、项目包或诊断导出中。</p>
      </div>
      <button class="provider-connections__primary" type="button" @click="showCreate = true">
        <Plus :size="15" aria-hidden="true" />添加本机连接
      </button>
    </header>

    <section class="provider-connections__list" aria-labelledby="provider-list-title">
      <div class="provider-connections__heading">
        <h2 id="provider-list-title">可用连接</h2>
        <p>本机连接优先；项目绑定只显示来源与能力</p>
      </div>
      <div v-if="loading" class="provider-connections__empty" role="status">
        <LoaderCircle class="provider-connections__spin" :size="20" />正在读取本机连接…
      </div>
      <div v-else class="provider-connections__cards" role="list">
        <button
          v-for="connection in connections"
          :key="connection.id"
          class="provider-connection-card"
          :class="{ active: connection.id === selectedId }"
          type="button"
          role="listitem"
          :aria-pressed="connection.id === selectedId"
          @click="selectedId = connection.id"
        >
          <span class="provider-connection-card__title">{{ connection.displayName }}</span>
          <span class="provider-connection-card__pill" :data-state="connection.state">
            <i aria-hidden="true" />{{ connectionStateLabel(connection) }}
          </span>
          <span class="provider-connection-card__meta">{{ connectionMeta(connection) }}</span>
        </button>
        <div v-if="connections.length === 0" class="provider-connections__empty">
          <Cable :size="20" />尚无连接。添加本机连接，或继续使用零 Key Demo。
        </div>
      </div>
    </section>

    <section class="provider-connections__detail" aria-labelledby="provider-detail-title">
      <template v-if="selectedConnection">
        <div class="provider-connections__heading">
          <h2 id="provider-detail-title">{{ selectedConnection.displayName }} · {{ selectedScope }}</h2>
          <p>{{ selectedConnection.protocol === 'demo-local' ? '本地确定性 Provider · 不读取外部凭证' : '本地可配置 · 凭证仅存系统钥匙串或 Docker Secret' }}</p>
        </div>
        <dl class="provider-detail-grid">
          <div><dt>可见范围</dt><dd>{{ selectedScope }}</dd></div>
          <div><dt>Base URL</dt><dd>{{ selectedConnection.endpointOrigin ?? '无外部端点' }}</dd></div>
          <div><dt>协议</dt><dd>{{ protocolLabel(selectedConnection) }}</dd></div>
          <div><dt>凭证</dt><dd>{{ credentialLabel(selectedConnection) }}</dd></div>
          <div><dt>能力</dt><dd>{{ selectedConnection.capabilities.map(modalityLabel).join(' / ') }}</dd></div>
          <div><dt>本机状态</dt><dd>{{ connectionStateLabel(selectedConnection) }}</dd></div>
        </dl>
        <div class="provider-security-checks" :data-state="selectedConnection.state">
          <strong><ShieldCheck :size="14" />{{ securitySummary }}</strong>
          <span>{{ securityDetail }}</span>
        </div>
        <div class="provider-connections__actions">
          <button
            class="provider-connections__secondary"
            type="button"
            :disabled="busyId === selectedConnection.id"
            @click="testConnection(selectedConnection)"
          >
            <LoaderCircle v-if="busyId === selectedConnection.id" class="provider-connections__spin" :size="14" />
            <Network v-else :size="14" />
            {{ busyId === selectedConnection.id ? '正在检查…' : selectedConnection.protocol === 'demo-local' ? '验证本地 Demo' : '运行脱敏连通性检查' }}
          </button>
          <button
            v-if="selectedConnection.protocol !== 'demo-local'"
            class="provider-connections__primary"
            type="button"
            @click="openCredentialDialog(selectedConnection)"
          >
            <KeyRound :size="14" />{{ selectedConnection.credentialConfigured ? '更换本机凭证' : '配置本机凭证' }}
          </button>
        </div>
      </template>
      <div v-else class="provider-connections__empty">请选择一个连接查看安全详情。</div>
    </section>

    <section class="provider-connections__bindings" aria-labelledby="provider-bindings-title">
      <div class="provider-connections__heading provider-connections__heading--row">
        <div>
          <h2 id="provider-bindings-title">项目模型绑定</h2>
          <p>能力、预算、信任等级与降级顺序</p>
        </div>
        <button v-if="routePolicy" class="provider-connections__edit-binding" type="button" @click="showBindings = true">编辑模型绑定</button>
      </div>
      <div v-if="!store.currentProjectId" class="provider-connections__empty">
        <FolderOpen :size="20" />打开项目后即可绑定模型。
      </div>
      <template v-else>
        <div class="provider-binding-list">
          <div v-for="modality in routeModalities" :key="modality" class="provider-binding-row">
            <span class="provider-binding-row__kind"><i aria-hidden="true" />{{ modalityLabel(modality) }}</span>
            <span class="provider-binding-row__connection">{{ connectionName(routeDraft[modality].connectionId) }} / {{ routeDraft[modality].model }}</span>
            <span class="provider-binding-row__scope">{{ bindingScope(routeDraft[modality].connectionId) }}</span>
          </div>
        </div>
        <p class="provider-bindings__summary">每日预算 {{ routeBudget.toLocaleString() }} µ · 成本账本 {{ totalCostMicros.toLocaleString() }} {{ routePolicy?.currency ?? 'USD' }} µ · Demo billed=false</p>
      </template>
    </section>

    <div v-if="showCreate" class="provider-dialog-backdrop" @click.self="showCreate = false">
      <form class="provider-dialog" aria-labelledby="provider-create-title" @submit.prevent="createConnection">
        <header>
          <div><span>LOCAL CONNECTION</span><h2 id="provider-create-title">添加本机 Provider</h2><p>保存元数据不会发起网络请求。</p></div>
          <button type="button" aria-label="关闭添加连接" @click="showCreate = false"><X :size="18" /></button>
        </header>
        <div class="provider-dialog__grid">
          <label>协议<select v-model="draft.protocol"><option value="openai-compatible">OpenAI-compatible</option><option value="declarative-http">声明式异步 HTTP</option></select></label>
          <label>显示名称<input v-model.trim="draft.displayName" required maxlength="120" placeholder="例如：Nebula Relay" /></label>
          <label class="provider-dialog__wide">HTTPS Origin<input v-model.trim="draft.endpointOrigin" required type="url" placeholder="https://relay.example.com/" /></label>
          <label>凭据别名<input v-model.trim="draft.credentialKey" required pattern="[A-Za-z0-9._-]{3,120}" autocomplete="off" placeholder="nebula-relay" /></label>
          <label>API Key（Docker 可留空）<input v-model="draft.credential" type="password" autocomplete="new-password" placeholder="只写入安全凭据库" /></label>
          <fieldset class="provider-dialog__wide"><legend>能力</legend><label v-for="modality in modalities" :key="modality"><input v-model="draft.capabilities" type="checkbox" :value="modality" />{{ modalityLabel(modality) }}</label></fieldset>
          <p class="provider-dialog__wide"><ShieldCheck :size="14" />只接受 HTTPS origin；不允许上传或执行第三方 JavaScript 适配器。</p>
        </div>
        <footer><button class="provider-connections__secondary" type="button" @click="showCreate = false">取消添加</button><button class="provider-connections__primary" type="submit" :disabled="busy || draft.capabilities.length === 0">{{ busy ? '正在安全保存…' : '保存本机连接' }}</button></footer>
      </form>
    </div>

    <div v-if="credentialTarget" class="provider-dialog-backdrop" @click.self="closeCredentialDialog">
      <form class="provider-dialog provider-dialog--credential" aria-labelledby="provider-credential-title" @submit.prevent="replaceCredential">
        <header><div><span>SECURE CREDENTIAL</span><h2 id="provider-credential-title">配置 {{ credentialTarget.displayName }}</h2><p>前端保存后立即清空输入，后续不可读取。</p></div><button type="button" aria-label="关闭凭证配置" @click="closeCredentialDialog"><X :size="18" /></button></header>
        <label>新凭证<input v-model="credentialDraft" required minlength="8" type="password" autocomplete="new-password" placeholder="至少 8 个字符" /></label>
        <footer><button class="provider-connections__secondary" type="button" @click="closeCredentialDialog">取消</button><button class="provider-connections__primary" type="submit" :disabled="busy">写入系统凭据库</button></footer>
      </form>
    </div>

    <div v-if="showBindings" class="provider-dialog-backdrop" @click.self="showBindings = false">
      <form class="provider-dialog" aria-labelledby="provider-bindings-dialog-title" @submit.prevent="saveRoute">
        <header><div><span>MODEL ROUTING</span><h2 id="provider-bindings-dialog-title">编辑项目模型绑定</h2><p>只允许已验证且支持对应能力的连接进入路由。</p></div><button type="button" aria-label="关闭模型绑定" @click="showBindings = false"><X :size="18" /></button></header>
        <div class="provider-dialog__routes">
          <label v-for="modality in routeModalities" :key="modality">
            <span>{{ modalityLabel(modality) }}</span>
            <select v-model="routeDraft[modality].connectionId" :aria-label="`${modalityLabel(modality)}连接`"><option value="">未绑定</option><option v-for="connection in readyConnectionsFor(modality)" :key="connection.id" :value="connection.id">{{ connection.displayName }}</option></select>
            <input v-model.trim="routeDraft[modality].model" :aria-label="`${modalityLabel(modality)}模型`" :placeholder="defaultModel(modality)" />
          </label>
          <label class="provider-dialog__budget">每日预算（微单位）<input v-model.number="routeBudget" type="number" min="0" step="1" /></label>
          <p><ShieldCheck :size="14" />未知远端结果必须先对账，不会自动切换连接并重复扣费。</p>
        </div>
        <footer><button class="provider-connections__secondary" type="button" @click="showBindings = false">取消</button><button class="provider-connections__primary" type="submit" :disabled="busy || !routePolicy"><Save :size="14" />{{ busy ? '正在保存…' : '保存模型绑定' }}</button></footer>
      </form>
    </div>

    <p v-if="notice" class="provider-connections__notice" role="status"><CircleCheck :size="15" />{{ notice }}</p>
    <p v-if="error" class="provider-connections__notice provider-connections__notice--error" role="alert"><TriangleAlert :size="15" />{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Cable, CircleCheck, FolderOpen, KeyRound, LoaderCircle, Network, Plus, Save, ShieldCheck, TriangleAlert, X } from 'lucide-vue-next'
import type { ModelModality, ProviderConnection, ProviderCostLedgerEntry, ProviderProtocol, ProviderRoutePolicy } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const modalities: ModelModality[] = ['text', 'image', 'video', 'audio']
const routeModalities: ModelModality[] = ['image', 'video', 'audio']
const connections = ref<ProviderConnection[]>([])
const routePolicy = ref<ProviderRoutePolicy>()
const costs = ref<ProviderCostLedgerEntry[]>([])
const selectedId = ref('')
const showCreate = ref(false)
const showBindings = ref(false)
const credentialTarget = ref<ProviderConnection>()
const credentialDraft = ref('')
const loading = ref(true)
const busy = ref(false)
const busyId = ref('')
const notice = ref('')
const error = ref('')
const routeBudget = ref(0)
const draft = reactive({
  protocol: 'openai-compatible' as Exclude<ProviderProtocol, 'demo-local'>,
  displayName: '', endpointOrigin: 'https://', credentialKey: '', credential: '', capabilities: ['image'] as ModelModality[],
})
const routeDraft = reactive<Record<ModelModality, { connectionId: string; model: string }>>({
  text: { connectionId: '', model: 'demo-text-v1' }, image: { connectionId: '', model: 'demo-frame-v1' },
  video: { connectionId: '', model: 'demo-motion-v1' }, audio: { connectionId: '', model: 'demo-voice-v1' },
})

const selectedConnection = computed(() => connections.value.find((item) => item.id === selectedId.value))
const selectedScope = computed(() => selectedConnection.value?.protocol === 'demo-local' ? '本机内置' : '仅此设备')
const totalCostMicros = computed(() => costs.value.reduce((sum, entry) => sum + entry.amountMicros, 0))
const securitySummary = computed(() => selectedConnection.value?.protocol === 'demo-local'
  ? '本地验证：无外连 ✓  无凭证 ✓  固定素材 ✓  billed=false ✓'
  : '安全门禁：HTTPS ✓  Origin ✓  SSRF 防护 ✓  响应脱敏 ✓')
const securityDetail = computed(() => selectedConnection.value?.protocol === 'demo-local'
  ? '生成、预览与导出只使用本地 fixture 和 FFmpeg。'
  : '连通性检查不包含项目内容、Prompt、凭证正文或用户媒体。')

const modalityLabel = (value: ModelModality): string => ({ text: '文本', image: '分镜图', video: '视频', audio: '配音' })[value]
const defaultModel = (value: ModelModality): string => ({ text: 'demo-text-v1', image: 'demo-frame-v1', video: 'demo-motion-v1', audio: 'demo-voice-v1' })[value]
const protocolLabel = (connection: ProviderConnection): string => ({ 'demo-local': '零 Key Demo · 本地 fixture', 'openai-compatible': 'OpenAI-compatible · 同步/异步', 'declarative-http': '声明式 HTTP · submit/poll/cancel' })[connection.protocol]
const credentialLabel = (connection: ProviderConnection): string => connection.protocol === 'demo-local' ? '无需凭证' : connection.credentialConfigured ? '•••••••• · 系统凭据库' : '未配置 · 可使用 Docker Secret'
const connectionStateLabel = (connection: ProviderConnection): string => connection.protocol === 'demo-local' ? '本机已验证' : ({ draft: '等待本机连通性检查', ready: '本机已验证', disabled: '已停用', error: '需要修复' })[connection.state]
const connectionMeta = (connection: ProviderConnection): string => connection.protocol === 'demo-local' ? '内置 · 付费请求 0' : `${connection.protocol === 'declarative-http' ? '声明式异步' : '官方兼容协议'} · ${connection.capabilities.map(modalityLabel).join(' / ')}`
const connectionName = (connectionId: string): string => connections.value.find((item) => item.id === connectionId)?.displayName ?? '未绑定'
const bindingScope = (connectionId: string): string => {
  const connection = connections.value.find((item) => item.id === connectionId)
  if (!connection) return '未绑定'
  return connection.protocol === 'demo-local' ? '本机内置' : '本机私有'
}
const readyConnectionsFor = (modality: ModelModality): ProviderConnection[] => connections.value.filter((connection) => connection.state === 'ready' && connection.capabilities.includes(modality))

function routeManifest() {
  return {
    version: 1 as const,
    submit: { method: 'POST' as const, path: '/v1/jobs', response: { jobId: 'data.id', status: 'data.status' } },
    poll: { method: 'GET' as const, pathTemplate: '/v1/jobs/{jobId}', response: { status: 'data.status', outputUrl: 'data.output_url' } },
    cancel: { method: 'POST' as const, pathTemplate: '/v1/jobs/{jobId}/cancel' },
    terminalStates: { succeeded: ['succeeded', 'done'], failed: ['failed', 'error'] },
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    connections.value = await directorApi.providerConnections()
    if (!connections.value.some((item) => item.id === selectedId.value)) selectedId.value = connections.value.find((item) => item.displayName.toLowerCase().includes('nebula'))?.id ?? connections.value.find((item) => item.protocol !== 'demo-local')?.id ?? connections.value[0]?.id ?? ''
    if (!store.currentProjectId) { routePolicy.value = undefined; costs.value = []; return }
    const [policy, ledger] = await Promise.all([directorApi.providerRoutePolicy(store.currentProjectId), directorApi.providerCosts(store.currentProjectId)])
    routePolicy.value = policy
    costs.value = ledger
    routeBudget.value = policy.dailyBudgetMicros
    for (const modality of modalities) {
      const route = policy.routes.find((item) => item.modality === modality)
      const fallback = readyConnectionsFor(modality)[0]
      routeDraft[modality].connectionId = route?.primaryConnectionId ?? fallback?.id ?? ''
      routeDraft[modality].model = route?.model ?? defaultModel(modality)
    }
  } catch (caught) { error.value = caught instanceof Error ? caught.message : '无法读取 Provider 连接。' }
  finally { loading.value = false }
}

async function createConnection(): Promise<void> {
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const created = await directorApi.createProviderConnection({
      displayName: draft.displayName, protocol: draft.protocol, endpointOrigin: draft.endpointOrigin,
      credentialKey: draft.credentialKey, ...(draft.credential ? { credential: draft.credential } : {}),
      capabilities: [...draft.capabilities], ...(draft.protocol === 'declarative-http' ? { manifest: routeManifest() } : {}),
      confirmation: 'CREATE_LOCAL_PROVIDER_CONNECTION',
    })
    draft.credential = ''; draft.displayName = ''; draft.credentialKey = ''; draft.endpointOrigin = 'https://'; showCreate.value = false
    selectedId.value = created.id
    notice.value = '连接元数据已保存；凭证正文未写入数据库。'
    await load()
  } catch (caught) { draft.credential = ''; error.value = caught instanceof Error ? caught.message : '无法保存本机连接。' }
  finally { busy.value = false }
}

async function testConnection(connection: ProviderConnection): Promise<void> {
  busyId.value = connection.id; error.value = ''; notice.value = ''
  try {
    const report = await directorApi.testProviderConnection(connection.id, connection.revision)
    notice.value = ({ ready: '连接已验证，可用于项目模型绑定。', network_disabled: 'Provider 网络门禁已关闭，本次检查未发起任何外部请求。', credential_missing: '安全凭据库中没有对应凭证。', timeout: '连通性检查超时，请检查端点。', rate_limited: 'Provider 返回限流，请稍后再试。', invalid_response: 'Provider 响应不符合已声明协议。', unreachable: '无法连接 Provider。' })[report.outcome]
    await load()
  } catch (caught) { error.value = caught instanceof Error ? caught.message : '连通性检查失败。' }
  finally { busyId.value = '' }
}

function openCredentialDialog(connection: ProviderConnection): void { credentialTarget.value = connection; credentialDraft.value = '' }
function closeCredentialDialog(): void { credentialTarget.value = undefined; credentialDraft.value = '' }
async function replaceCredential(): Promise<void> {
  if (!credentialTarget.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const updated = await directorApi.replaceProviderCredential(credentialTarget.value.id, { expectedRevision: credentialTarget.value.revision, credential: credentialDraft.value, confirmation: 'REPLACE_PROVIDER_CREDENTIAL' })
    selectedId.value = updated.id; closeCredentialDialog(); notice.value = '凭证已写入系统凭据库，输入内容已从前端清空。'; await load()
  } catch (caught) { credentialDraft.value = ''; error.value = caught instanceof Error ? caught.message : '无法更新凭证。' }
  finally { busy.value = false }
}

async function saveRoute(): Promise<void> {
  if (!store.currentProjectId || !routePolicy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const routes = routeModalities.flatMap((modality) => {
      const draftRoute = routeDraft[modality]
      if (!draftRoute.connectionId || !draftRoute.model) return []
      const previous = routePolicy.value?.routes.find((item) => item.modality === modality && item.primaryConnectionId === draftRoute.connectionId)
      return [{ modality, primaryConnectionId: draftRoute.connectionId, fallbackConnectionIds: previous?.fallbackConnectionIds ?? [], ...(previous?.fallbackConnectionModels ? { fallbackConnectionModels: previous.fallbackConnectionModels } : {}), model: draftRoute.model, maxAttempts: previous?.maxAttempts ?? 1, timeoutMs: previous?.timeoutMs ?? 120_000 }]
    })
    routePolicy.value = await directorApi.updateProviderRoutePolicy(store.currentProjectId, { expectedRevision: routePolicy.value.revision, routes, dailyBudgetMicros: routeBudget.value, currency: routePolicy.value.currency, confirmation: 'UPDATE_PROVIDER_ROUTE_POLICY' })
    showBindings.value = false; notice.value = '模型绑定已按 revision 原子保存。'
  } catch (caught) { error.value = caught instanceof Error ? caught.message : '模型绑定保存失败。' }
  finally { busy.value = false }
}

watch(() => store.currentProjectId, load)
onMounted(load)
</script>

<style scoped>
.provider-connections{box-sizing:border-box;position:relative;height:100%;min-height:0;display:grid;grid-template-columns:430px minmax(0,1fr);grid-template-rows:70px 430px 240px;gap:20px;padding:24px;overflow:hidden;color:var(--text);background:var(--surface-canvas)}
.provider-connections button,.provider-connections input,.provider-connections select{font:inherit}.provider-connections button:focus-visible,.provider-connections input:focus-visible,.provider-connections select:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.provider-connections__scope,.provider-connections__list,.provider-connections__detail,.provider-connections__bindings{min-width:0;min-height:0;border:1px solid var(--line);border-radius:12px;background:var(--surface-panel)}
.provider-connections__scope{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:12px 18px}.provider-connections__scope h1,.provider-connections__heading h2{margin:0;color:var(--text);font-size:14px;font-weight:650;line-height:21px}.provider-connections__scope p,.provider-connections__heading p{margin:2px 0 0;color:var(--text-muted);font-size:11px;line-height:16px}
.provider-connections__list{grid-row:2/4;padding:16px 18px;overflow:hidden}.provider-connections__cards{height:calc(100% - 60px);display:grid;align-content:start;gap:10px;margin-top:16px;overflow-y:auto;scrollbar-width:thin}.provider-connection-card{width:100%;min-height:104px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-content:center;gap:8px 14px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;color:var(--text);background:var(--surface-panel);text-align:left;cursor:pointer}.provider-connection-card:hover{background:var(--surface-hover)}.provider-connection-card.active{border-color:var(--accent-primary);background:var(--surface-raised)}.provider-connection-card__title{overflow:hidden;font-size:12px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.provider-connection-card__pill{display:inline-flex;align-items:center;gap:7px;padding:5px 10px;border-radius:999px;color:var(--text-secondary);background:var(--surface-raised);font-size:10px;font-weight:600}.provider-connection-card__pill i,.provider-binding-row__kind i{width:7px;height:7px;flex:none;border-radius:50%;background:var(--text-muted)}.provider-connection-card__pill[data-state=ready] i{background:var(--status-success)}.provider-connection-card__pill[data-state=draft] i{background:var(--status-warning)}.provider-connection-card__pill[data-state=error] i{background:var(--status-danger)}.provider-connection-card__meta{grid-column:1/-1;color:var(--text-muted);font-size:11px;line-height:16px}
.provider-connections__detail{padding:16px 18px}.provider-detail-grid{display:grid;gap:0;margin:10px 0 0}.provider-detail-grid>div{min-height:35px;display:grid;grid-template-columns:128px minmax(0,1fr);align-items:center}.provider-detail-grid dt{color:var(--text-muted);font-size:11px}.provider-detail-grid dd{min-width:0;margin:0;overflow:hidden;color:var(--text);font-size:12px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.provider-security-checks{height:60px;display:grid;align-content:center;gap:5px;margin-top:0;padding:8px 13px;border:1px solid var(--line);border-radius:9px;background:var(--surface-raised)}.provider-security-checks strong{display:flex;align-items:center;gap:7px;color:var(--status-success);font-size:11px}.provider-security-checks span{color:var(--text-secondary);font-size:10px}.provider-connections__actions{display:flex;align-items:center;gap:70px;margin-top:10px}
.provider-connections__bindings{padding:16px 18px}.provider-connections__heading--row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.provider-connections__edit-binding{min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:9px;color:var(--text-secondary);background:var(--surface-raised);font-size:10px;cursor:pointer}.provider-connections__edit-binding:hover{border-color:var(--accent-primary);color:var(--text)}.provider-binding-list{display:grid;gap:4px;margin-top:8px}.provider-binding-row{min-height:40px;display:grid;grid-template-columns:96px minmax(0,1fr) 88px;align-items:center;gap:10px}.provider-binding-row__kind{display:inline-flex;align-items:center;gap:7px;width:max-content;padding:5px 10px;border-radius:999px;color:var(--text-secondary);background:var(--surface-raised);font-size:10px;font-weight:600}.provider-binding-row__kind i{background:var(--accent-primary)}.provider-binding-row__connection{color:var(--text-secondary);font-size:11px}.provider-binding-row__scope{color:var(--text-muted);font-size:10px;text-align:right}.provider-bindings__summary{margin:3px 0 0;color:var(--text-muted);font-size:9px;line-height:14px}
.provider-connections__primary,.provider-connections__secondary{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 14px;border:1px solid var(--accent-primary);border-radius:10px;color:var(--surface-canvas);background:var(--accent-primary);font-size:11px;font-weight:650;cursor:pointer}.provider-connections__secondary{border-color:var(--line-strong);color:var(--text);background:var(--surface-raised)}.provider-connections__primary:hover:not(:disabled){background:var(--accent-primary-strong)}.provider-connections__secondary:hover:not(:disabled){border-color:var(--accent-primary);background:var(--surface-hover)}.provider-connections__primary:disabled,.provider-connections__secondary:disabled{cursor:not-allowed;opacity:.5}.provider-connections__empty{min-height:100px;display:grid;place-items:center;align-content:center;gap:8px;color:var(--text-muted);font-size:11px;text-align:center}
.provider-dialog-backdrop{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:24px;background:var(--surface-overlay)}.provider-dialog{width:min(720px,100%);max-height:calc(100vh - 48px);overflow:auto;padding:20px;border:1px solid var(--line-strong);border-radius:16px;color:var(--text);background:var(--surface-panel);box-shadow:var(--shadow)}.provider-dialog--credential{width:min(500px,100%)}.provider-dialog header,.provider-dialog footer{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.provider-dialog header>button{width:44px;height:44px;display:grid;place-items:center;border:1px solid transparent;border-radius:9px;color:var(--text-muted);background:transparent;cursor:pointer}.provider-dialog header span{color:var(--text-accent);font-size:9px;font-weight:700;letter-spacing:.14em}.provider-dialog h2{margin:4px 0;color:var(--text);font-size:18px}.provider-dialog p{display:flex;align-items:center;gap:7px;margin:0;color:var(--text-muted);font-size:11px}.provider-dialog__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}.provider-dialog label{display:grid;gap:7px;color:var(--text-secondary);font-size:11px}.provider-dialog__wide{grid-column:1/-1}.provider-dialog fieldset{display:flex;gap:18px;margin:0;padding:12px;border:1px solid var(--line);border-radius:9px}.provider-dialog fieldset label{display:flex;align-items:center;gap:7px}.provider-dialog fieldset input{width:auto;height:auto}.provider-dialog footer{justify-content:flex-end;margin-top:20px}.provider-dialog--credential>label{display:grid;gap:7px;margin-top:20px;color:var(--text-secondary);font-size:11px}.provider-dialog__routes{display:grid;gap:12px;margin-top:20px}.provider-dialog__routes>label{grid-template-columns:90px minmax(0,1fr) minmax(0,1fr);align-items:center}.provider-dialog__routes input,.provider-dialog__routes select,.provider-dialog input,.provider-dialog select{width:100%;min-width:0;height:44px;padding:0 10px;border:1px solid var(--line);border-radius:8px;color:var(--text);background:var(--surface-raised);font-size:10px}.provider-dialog__routes .provider-dialog__budget{grid-template-columns:190px 180px}.provider-dialog__routes p{padding:10px;border-radius:9px;background:var(--surface-warning-subtle)}
.provider-connections__notice{position:fixed;z-index:110;right:24px;bottom:24px;display:flex;align-items:center;gap:8px;margin:0;padding:11px 14px;border:1px solid var(--status-success);border-radius:10px;color:var(--status-success);background:var(--surface-raised);box-shadow:var(--shadow);font-size:11px}.provider-connections__notice--error{border-color:var(--status-danger);color:var(--status-danger)}.provider-connections__spin{animation:provider-connections-spin .8s linear infinite}@keyframes provider-connections-spin{to{transform:rotate(360deg)}}
@media(max-width:1180px){.provider-connections{grid-template-columns:360px minmax(0,1fr);grid-template-rows:70px minmax(430px,auto) minmax(260px,auto);overflow:auto}.provider-connections__list{grid-row:2/4}.provider-binding-row{grid-template-columns:88px minmax(120px,1fr) 72px}}
@media(max-width:768px){.provider-connections{display:block;padding:14px 14px 100px;overflow:auto}.provider-connections__scope,.provider-connections__list,.provider-connections__detail,.provider-connections__bindings{margin-bottom:12px}.provider-connections__scope{min-height:116px;align-items:flex-start}.provider-connections__scope p{max-width:260px}.provider-connections__list{height:auto;min-height:420px}.provider-connections__cards{height:auto;max-height:none}.provider-connections__detail{min-height:470px}.provider-detail-grid>div{grid-template-columns:100px minmax(0,1fr)}.provider-connections__actions{gap:8px;flex-wrap:wrap}.provider-binding-row{grid-template-columns:1fr;gap:6px;padding:10px 0;border-bottom:1px solid var(--line)}.provider-binding-row__scope{display:block;text-align:left}.provider-dialog__grid{grid-template-columns:1fr}.provider-dialog__wide{grid-column:auto}.provider-dialog__routes>label,.provider-dialog__routes .provider-dialog__budget{grid-template-columns:1fr}.provider-connections__notice{top:136px;right:14px;bottom:auto;left:14px}}
</style>
