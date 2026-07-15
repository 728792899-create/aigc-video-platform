/**
 * Provider 路由（升级方案 v3 第一期）
 *
 * GET  /api/providers               列出全部 provider（按 kind 分组 + 是否已配密钥）
 * GET  /api/providers/stage-models  读当前各阶段路由
 * POST /api/providers/stage-models  保存各阶段路由（patch 语义）
 * POST /api/providers/credentials   保存某 provider 凭证（脱敏回显，过滤 **** 占位）
 * POST /api/providers/test          连通性测试：{provider, model} 实测一次最小请求
 */
import express from 'express'
import { asRecord, errorDetails, errorMessage, type JsonRecord } from './routeSupport'
const router = express.Router();
const config = require('../services/config');
const registry = require('../services/providers');
const llm = require('../services/providers/llmProvider');
const t2iProvider = require('../services/t2iProvider');
const t2vProvider = require('../services/t2vProvider');
const ttsProvider = require('../services/ttsProvider');
const usage = require('../services/usage');
const credentialStore = require('../services/credentialStore');
const modelCatalog = require('../services/modelCatalog');

const KINDS = ['llm', 't2i', 't2v', 'tts'] as const;
type ProviderKind = (typeof KINDS)[number]
interface ProviderHealthItem extends JsonRecord {
  key: string
  label: string
  kind: ProviderKind
  configured: boolean
  userConfigured: boolean
  free: boolean
  routed: boolean
  routed_stages: string[]
  status: string
  status_label: string
  message: string
  needs_setup?: boolean
  setup_message?: string
}
interface ProviderDefinition extends JsonRecord {
  key: string
  label: string
  kind: ProviderKind
  models?: string[]
  baseUrl?: string
  free?: boolean
  note?: string
  auth?: string
  protocol?: string
}

function classifyProviderError(message: unknown = ''): string {
  const text = String(message || '').toLowerCase();
  if (!text) return 'historical_failed';
  if (/401|403|unauthori[sz]ed|forbidden|invalid.*key|权限|未授权/.test(text)) return 'auth_error';
  if (/402|quota|额度|余额|积分不足|payment/.test(text)) return 'quota_error';
  if (/timeout|超时|network|enotfound|econnreset|econnrefused|网络/.test(text)) return 'connection_failed';
  return 'historical_failed';
}

function providerHealthItems(): ProviderHealthItem[] {
  const usageAll = usage.getAll();
  const stageModels = asRecord(config.get('stageModels'));
  const items: ProviderHealthItem[] = [];
  for (const kind of KINDS) {
    for (const p of registry.listByKind(kind)) {
      const configured = registry.hasCredentials(p.key);
      const userConfigured = registry.hasUserCredentials(p.key);
      const routedStages = Object.entries(stageModels)
        .filter(([, selection]) => asRecord(selection).provider === p.key)
        .map(([stage]) => stage);
      const u = usageAll[`${kind}:${p.key}`] || null;
      const lastError = credentialStore.redact(u?.last_error || '');
      let status = configured ? 'available' : 'unconfigured';
      if (configured && lastError && (!u?.last_ok_at || Number(u.last_at || 0) >= Number(u.last_ok_at || 0))) {
        status = classifyProviderError(lastError);
      }
      items.push({
        key: p.key,
        label: p.label,
        kind,
        configured,
        userConfigured,
        free: !!p.free,
        routed: routedStages.length > 0,
        routed_stages: routedStages,
        status,
        status_label: {
          available: '可用',
          unconfigured: '未配置',
          auth_error: '鉴权失败',
          quota_error: '额度异常',
          connection_failed: '连接失败',
          historical_failed: '历史失败',
        }[status] || status,
        message: status === 'available' ? '当前可用'
          : status === 'unconfigured' ? (routedStages.length ? '当前路由正在使用但未配置凭证' : '未配置，当前未使用')
          : lastError,
        last_error: lastError,
        last_error_at: u?.last_at || 0,
        usage: u,
      });
    }
  }
  items.push({
    key: 'edge',
    label: 'Edge TTS（本地·免费）',
    kind: 'tts',
    configured: true,
    userConfigured: true,
    free: true,
    routed: asRecord(stageModels.voice).provider === 'edge',
    routed_stages: asRecord(stageModels.voice).provider === 'edge' ? ['voice'] : [],
    status: 'available',
    status_label: '可用',
    message: '本地配音引擎可用',
    usage: usageAll['tts:edge'] || null,
  });
  return items;
}

// 列出全部 provider（按 kind 分组）
router.get('/', (req, res) => {
  const grouped: Record<string, unknown> = {};
  for (const kind of KINDS) {
    grouped[kind] = registry.listByKind(kind).map((p: ProviderDefinition) => ({
      key: p.key,
      label: p.label,
      models: p.models || [],
      baseUrl: p.baseUrl || '',
      runtimeBaseUrl: asRecord(registry.resolveCredentials(p.key)).baseUrl || p.baseUrl || '',
      free: !!p.free,
      note: p.note || '',
      auth: p.auth || '',  // 鉴权类型（access_secret 等），供前端渲染对应凭证输入框
      configured: registry.hasCredentials(p.key),
      userConfigured: registry.hasUserCredentials(p.key),
    }));
  }
  res.json({ code: 200, data: grouped, message: 'success' });
});

// 静态模型能力目录：与运行时健康/凭证状态分离，避免 UI 把“支持什么”与“现在是否可用”混为一谈。
router.get('/catalog', (req, res) => {
  const modality = req.query.modality ? String(req.query.modality) : undefined;
  res.json({ code: 200, data: modelCatalog.list({ modality }), message: 'success' });
});

// 只返回官方文档可确认的运行能力；未公开的账单端点不猜测、不伪造余额。
router.get('/:provider/billing-status', async (req, res) => {
  const provider = String(req.params.provider || '');
  const definition = registry.getProvider(provider);
  if (!definition) return res.status(404).json({ code: 404, data: null, message: `未知 provider：${provider}` });
  if (definition.kind !== 't2v') {
    return res.json({
      code: 200,
      data: {
        provider, capability: 'unverified', configured: registry.hasCredentials(provider),
        status: 'unknown', reason_code: 'PROVIDER_BILLING_UNVERIFIED', checked_at: Date.now(),
        currency: null, balance: null,
      },
      message: '当前 Provider 未提供已验证的账单状态接口',
    });
  }
  const data = await t2vProvider.getBillingStatus(provider);
  return res.json({
    code: 200, data,
    message: data.capability === 'supported' ? '账单状态已查询' : '未验证可用的官方账单状态接口',
  });
});

// 启动/设置页使用的 Provider 健康快照：区分当前不可用与历史失败。
router.get('/health', (req, res) => {
  const items = providerHealthItems();
  const demoMode = ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase());
  const hasLlm = items.some((item) => item.kind === 'llm' && item.configured);
  const hasImage = items.some((item) => item.kind === 't2i' && item.configured);
  const needsSetup = !demoMode && (!hasLlm || !hasImage);
  const setupMessage = '首次使用请在「设置 → 模型路由」配置至少一个文案模型和一个生图模型的 API Key。';
  if (needsSetup) {
    for (const item of items) {
      const missingKind = (item.kind === 'llm' && !hasLlm) || (item.kind === 't2i' && !hasImage);
      if (missingKind && !item.configured) {
        item.needs_setup = true;
        item.setup_message = setupMessage;
      }
    }
  }
  const routed = items.filter((x) => x.routed);
  const badRouted = routed.filter((x) => !['available'].includes(x.status));
  const overall = badRouted.length || needsSetup ? 'warn' : 'ok';
  res.json({
    code: 200,
    data: {
      overall,
      checked_at: Date.now(),
      config_file: config.SETTINGS_FILE,
      items,
      needs_setup: needsSetup,
      setup_message: needsSetup ? setupMessage : '',
      summary: needsSetup
        ? setupMessage
        : badRouted.length
        ? `${badRouted.length} 个使用中的模型需要处理`
        : '使用中的模型配置正常',
    },
    message: 'success',
  });
});

// 读各阶段路由（返回 默认值 + 用户配置 的合并视图，避免漏阶段）
router.get('/stage-models', (req, res) => {
  const defaults = (config.DEFAULTS && config.DEFAULTS.stageModels) || {};
  const userSet = asRecord(config.get('stageModels'));
  const merged: JsonRecord = { ...asRecord(defaults) };
  for (const [stage, sel] of Object.entries(userSet)) {
    // 数组（如 imageChain 备用模型链）整体替换，不做对象合并
    if (Array.isArray(sel)) merged[stage] = sel.slice();
    else if (sel && typeof sel === 'object') merged[stage] = { ...asRecord(asRecord(defaults)[stage]), ...asRecord(sel) };
    else merged[stage] = sel;
  }
  res.json({ code: 200, data: merged, message: 'success' });
});

// 保存各阶段路由（patch 语义）
router.post('/stage-models', (req, res) => {
  const patch = asRecord(req.body);
  const modalities: Record<string, string> = { script: 'text', image: 'image', video: 'video', voice: 'audio' };
  try {
    for (const [stage, sel] of Object.entries(patch)) {
      if (stage === 'imageChain') {
        if (!Array.isArray(sel)) throw new modelCatalog.ModelCatalogError('MODEL_CHAIN_INVALID', 'imageChain 必须是数组');
        for (const item of sel) {
          let provider;
          let model;
          if (typeof item === 'string') {
            if (item.includes('__')) [provider, model] = item.split(/__(.*)/s, 2);
            else if (item.startsWith('dreamina')) { provider = 'dreamina'; model = item; }
            else { provider = 'pollinations'; model = item; }
          } else {
            const selection = asRecord(item);
            provider = selection.provider;
            model = selection.model;
          }
          modelCatalog.assertSelection({ provider, model, modality: 'image' });
        }
        continue;
      }
      const modality = modalities[stage];
      const selection = asRecord(sel);
      if (!modality) throw new modelCatalog.ModelCatalogError('STAGE_UNKNOWN', `未知模型阶段：${stage}`);
      if (!selection.provider) {
        throw new modelCatalog.ModelCatalogError('MODEL_SELECTION_INVALID', `阶段 ${stage} 缺少 provider`);
      }
      modelCatalog.assertSelection({ provider: selection.provider, model: selection.model, modality });
    }
  } catch (error) {
    const details = errorDetails(error);
    const status = details.status || 400;
    return res.status(status).json({
      code: status,
      data: { error_code: details.code || 'MODEL_SELECTION_INVALID', details },
      message: errorMessage(error),
    });
  }
  config.setMany({ stageModels: patch });
  res.json({ code: 200, data: config.get('stageModels'), message: '已保存模型路由' });
});

// 保存某 provider 凭证（过滤脱敏占位，避免覆盖真实密钥）
router.post('/credentials', (req, res) => {
  const { provider, clearSecret, ...fields } = req.body || {};
  if (!provider) return res.status(400).json({ code: 400, data: null, message: '缺少 provider' });
  const def = registry.getProvider(provider);
  if (!def) {
    return res.status(400).json({ code: 400, data: null, message: `未知 provider：${provider}` });
  }
  // 只接受白名单字段，并剥离 **** 脱敏占位
  const allow = ['apiKey', 'baseUrl', 'accessKey', 'secretKey', 'appId', 'cluster'];
  const secretFields = new Set(['apiKey', 'accessKey', 'secretKey']);
  const cleaned: JsonRecord = {};
  for (const k of allow) {
    if (fields[k] === undefined) continue;
    if (typeof fields[k] === 'string' && fields[k].startsWith('****')) continue; // 脱敏占位，跳过
    if (secretFields.has(k) && typeof fields[k] === 'string' && fields[k].trim() === '') continue; // 空密钥不覆盖
    cleaned[k] = fields[k];
  }
  const existing = { ...asRecord(config.get(`credentials.${provider}`)), ...asRecord(credentialStore.get(provider)) };
  const next = { ...existing, ...cleaned };
  if (clearSecret) {
    if (def.auth === 'access_secret') {
      next.accessKey = '';
      next.secretKey = '';
    } else {
      next.apiKey = '';
    }
    // DeepSeek 兼容旧字段：显式清除时同步清除旧入口，避免 fallback 继续读到旧 Key。
    if (provider === 'deepseek') {
      credentialStore.clear('deepseek');
    }
  }
  const secretPatch: JsonRecord = {};
  const publicPatch: JsonRecord = {};
  for (const [field, value] of Object.entries(next)) {
    if (secretFields.has(field)) secretPatch[field] = value;
    else publicPatch[field] = value;
  }
  if (clearSecret) credentialStore.clear(provider);
  if (Object.values(secretPatch).some(Boolean)) credentialStore.set(provider, secretPatch);
  config.setMany({ credentials: { [provider]: publicPatch } });
  // DeepSeek 统一入口：新凭证同步到旧字段，兼容健康检查、旧 API 测试和老流程。
  if (provider === 'deepseek') {
    const deepseekPatch: JsonRecord = {};
    if (next.baseUrl !== undefined) deepseekPatch.baseUrl = next.baseUrl;
    if (Object.keys(deepseekPatch).length) config.setMany({ deepseek: deepseekPatch });
  }
  res.json({
    code: 200,
    data: {
      provider,
      configured: registry.hasCredentials(provider),
      userConfigured: registry.hasUserCredentials(provider),
    },
    message: '已保存凭证',
  });
});

// 连通性测试：实测一次最小请求
router.post('/test', async (req, res) => {
  const { provider, model } = req.body || {};
  if (!provider) return res.status(400).json({ code: 400, data: null, message: '缺少 provider' });
  const def = registry.getProvider(provider);
  if (!def) return res.status(400).json({ code: 400, data: null, message: `未知 provider：${provider}` });

  const started = Date.now();
  try {
    if (['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase())) {
      return res.status(409).json({
        code: 409,
        data: { ok: false, billing_blocked: true },
        message: 'Demo Mode 禁止发起真实 Provider 连通测试',
      });
    }
    if (def.kind === 'llm') {
      const text = await llm.chat({
        provider, model,
        messages: [{ role: 'user', content: '回复两个字：你好' }],
        temperature: 0, maxTokens: 16, timeout: 20000,
      });
      usage.recordOk(def.kind, provider, Date.now() - started);
      return res.json({
        code: 200,
        data: { ok: true, latency_ms: Date.now() - started, sample: (text || '').slice(0, 30) },
        message: '连通正常',
      });
    }
    if (def.kind === 't2i' && t2iProvider.canHandle(def.protocol)) {
      // 实测生成一张小图验证连通（用免费档/最小提示词）
      const useModel = model || (def.models && def.models[0]);
      const r = await t2iProvider.generate({
        provider, model: useModel, prompt: 'a simple red circle on white background', ratio: '1:1',
      });
      const file = r.local_files && r.local_files[0];
      if (file) usage.recordOk(def.kind, provider, Date.now() - started);
      else usage.recordFail(def.kind, provider, new Error('连通失败'), Date.now() - started);
      return res.json({
        code: 200,
        data: { ok: !!file, latency_ms: Date.now() - started, sample: file ? file.file_url : '' },
        message: file ? '连通正常' : '连通失败',
      });
    }
    if (def.kind === 't2v' && t2vProvider.canHandle(def.protocol)) {
      // 文生视频生成要几分钟，测试只提交一次任务确认鉴权+端点可用，拿到 task_id 即通过
      const useModel = model || (def.models && def.models[0]);
      const r = await t2vProvider.probe({ provider, model: useModel });
      if (r.ok) usage.recordOk(def.kind, provider, Date.now() - started);
      else usage.recordFail(def.kind, provider, new Error(r.error || '连通失败'), Date.now() - started);
      return res.json({
        code: 200,
        data: { ok: !!r.ok, latency_ms: Date.now() - started, sample: r.taskId ? `任务已提交(${r.taskId})` : '' },
        message: r.ok ? '鉴权与提交正常（视频生成需数分钟，已确认可用）' : '连通失败',
      });
    }
    if (def.kind === 'tts' && ttsProvider.canHandle(def.protocol)) {
      // 合成一小段语音验证连通（直接走指定 provider，不降级，以便如实反映该 provider 状态）
      const useModel = model || (def.models && def.models[0]);
      const r = await ttsProvider.synthesize({
        text: '连通测试', voice: 'nova', storyboardId: `test_${Date.now()}`,
        provider, model: useModel, noFallback: true,
      });
      const ok = !!(r && r.file_url && r.size >= 1024);
      if (ok) usage.recordOk(def.kind, provider, Date.now() - started);
      else usage.recordFail(def.kind, provider, new Error('合成失败'), Date.now() - started);
      return res.json({
        code: 200,
        data: { ok, latency_ms: Date.now() - started, sample: ok ? `${r.size} bytes` : '' },
        message: ok ? '连通正常' : '连通失败',
      });
    }
    return res.status(400).json({ code: 400, data: null, message: `${def.label} 暂不支持连通性测试` });
  } catch (e) {
    usage.recordFail(def.kind, provider, e, Date.now() - started);
    return res.json({
      code: 200,
      data: { ok: false, latency_ms: Date.now() - started, error: credentialStore.redact(errorMessage(e)) },
      message: '连通失败',
    });
  }
});

// 用量/失败统计（第四期）：各 provider 累计成功/失败次数、最近耗时与错误
router.get('/usage', (req, res) => {
  res.json({ code: 200, data: usage.getAll(), message: 'success' });
});

// 清空用量统计
router.post('/usage/reset', (req, res) => {
  usage.reset();
  res.json({ code: 200, data: {}, message: '已清空用量统计' });
});

module.exports = router;
