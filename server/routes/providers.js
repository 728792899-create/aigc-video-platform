/**
 * Provider 路由（升级方案 v3 第一期）
 *
 * GET  /api/providers               列出全部 provider（按 kind 分组 + 是否已配密钥）
 * GET  /api/providers/stage-models  读当前各阶段路由
 * POST /api/providers/stage-models  保存各阶段路由（patch 语义）
 * POST /api/providers/credentials   保存某 provider 凭证（脱敏回显，过滤 **** 占位）
 * POST /api/providers/test          连通性测试：{provider, model} 实测一次最小请求
 */
const express = require('express');
const router = express.Router();
const config = require('../services/config');
const registry = require('../services/providers');
const llm = require('../services/providers/llmProvider');
const t2iProvider = require('../services/t2iProvider');
const t2vProvider = require('../services/t2vProvider');
const ttsProvider = require('../services/ttsProvider');
const usage = require('../services/usage');

const KINDS = ['llm', 't2i', 't2v', 'tts'];

function classifyProviderError(message = '') {
  const text = String(message || '').toLowerCase();
  if (!text) return 'historical_failed';
  if (/401|403|unauthori[sz]ed|forbidden|invalid.*key|权限|未授权/.test(text)) return 'auth_error';
  if (/402|quota|额度|余额|积分不足|payment/.test(text)) return 'quota_error';
  if (/timeout|超时|network|enotfound|econnreset|econnrefused|网络/.test(text)) return 'connection_failed';
  return 'historical_failed';
}

function providerHealthItems() {
  const usageAll = usage.getAll();
  const stageModels = config.get('stageModels') || {};
  const items = [];
  for (const kind of KINDS) {
    for (const p of registry.listByKind(kind)) {
      const configured = registry.hasCredentials(p.key);
      const userConfigured = registry.hasUserCredentials(p.key);
      const routedStages = Object.entries(stageModels)
        .filter(([, sel]) => sel && sel.provider === p.key)
        .map(([stage]) => stage);
      const u = usageAll[`${kind}:${p.key}`] || null;
      const lastError = u?.last_error || '';
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
    routed: stageModels.voice?.provider === 'edge',
    routed_stages: stageModels.voice?.provider === 'edge' ? ['voice'] : [],
    status: 'available',
    status_label: '可用',
    message: '本地配音引擎可用',
    usage: usageAll['tts:edge'] || null,
  });
  return items;
}

// 列出全部 provider（按 kind 分组）
router.get('/', (req, res) => {
  const grouped = {};
  for (const kind of KINDS) {
    grouped[kind] = registry.listByKind(kind).map((p) => ({
      key: p.key,
      label: p.label,
      models: p.models || [],
      baseUrl: p.baseUrl || '',
      runtimeBaseUrl: (registry.resolveCredentials(p.key) || {}).baseUrl || p.baseUrl || '',
      free: !!p.free,
      note: p.note || '',
      auth: p.auth || '',  // 鉴权类型（access_secret 等），供前端渲染对应凭证输入框
      configured: registry.hasCredentials(p.key),
      userConfigured: registry.hasUserCredentials(p.key),
    }));
  }
  res.json({ code: 200, data: grouped, message: 'success' });
});

// 启动/设置页使用的 Provider 健康快照：区分当前不可用与历史失败。
router.get('/health', (req, res) => {
  const items = providerHealthItems();
  const routed = items.filter((x) => x.routed);
  const badRouted = routed.filter((x) => !['available'].includes(x.status));
  const overall = badRouted.length ? 'warn' : 'ok';
  res.json({
    code: 200,
    data: {
      overall,
      checked_at: Date.now(),
      config_file: config.SETTINGS_FILE,
      items,
      summary: badRouted.length
        ? `${badRouted.length} 个使用中的模型需要处理`
        : '使用中的模型配置正常',
    },
    message: 'success',
  });
});

// 读各阶段路由（返回 默认值 + 用户配置 的合并视图，避免漏阶段）
router.get('/stage-models', (req, res) => {
  const defaults = (config.DEFAULTS && config.DEFAULTS.stageModels) || {};
  const userSet = config.get('stageModels') || {};
  const merged = { ...defaults };
  for (const [stage, sel] of Object.entries(userSet)) {
    // 数组（如 imageChain 备用模型链）整体替换，不做对象合并
    if (Array.isArray(sel)) merged[stage] = sel.slice();
    else if (sel && typeof sel === 'object') merged[stage] = { ...defaults[stage], ...sel };
    else merged[stage] = sel;
  }
  res.json({ code: 200, data: merged, message: 'success' });
});

// 保存各阶段路由（patch 语义）
router.post('/stage-models', (req, res) => {
  const patch = req.body || {};
  // 本地（非注册表）provider 白名单：imageGen 内置的 Pollinations / 即梦 + 视频「静图运镜」+ 配音「Edge TTS」
  const LOCAL_OK = new Set(['pollinations', 'dreamina', 'static', 'edge']);
  for (const [stage, sel] of Object.entries(patch)) {
    if (sel && sel.provider && !registry.getProvider(sel.provider) && !LOCAL_OK.has(sel.provider)) {
      return res.status(400).json({ code: 400, data: null, message: `阶段 ${stage} 指定了未知 provider：${sel.provider}` });
    }
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
  const cleaned = {};
  for (const k of allow) {
    if (fields[k] === undefined) continue;
    if (typeof fields[k] === 'string' && fields[k].startsWith('****')) continue; // 脱敏占位，跳过
    if (secretFields.has(k) && typeof fields[k] === 'string' && fields[k].trim() === '') continue; // 空密钥不覆盖
    cleaned[k] = fields[k];
  }
  const existing = config.get(`credentials.${provider}`) || {};
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
      config.setMany({ deepseek: { apiKey: '' } });
    }
  }
  config.setMany({ credentials: { [provider]: next } });
  // DeepSeek 统一入口：新凭证同步到旧字段，兼容健康检查、旧 API 测试和老流程。
  if (provider === 'deepseek') {
    const deepseekPatch = {};
    if (next.apiKey !== undefined) deepseekPatch.apiKey = next.apiKey;
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
      data: { ok: false, latency_ms: Date.now() - started, error: e.message },
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
