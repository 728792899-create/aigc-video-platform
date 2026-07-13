/**
 * Provider 注册表（升级方案 v3 第一期）
 *
 * 一张表声明所有可接入的 AI 能力：谁能干什么(kind)、默认连哪(baseUrl)、用什么协议(protocol)、有哪些模型。
 * 新增模型 = 往这张表加一行，业务代码无需改动。
 *
 * kind:     'llm' 文案 | 't2i' 文生图 | 't2v' 文生视频 | 'tts' 配音
 * protocol: 决定走哪个适配器分支。'openai' 协议的 LLM 全部共用 llmProvider 一份代码。
 */

const PROVIDERS = {
  // ===== LLM 文案/剧本（全部 OpenAI 兼容） =====
  deepseek: {
    kind: 'llm', label: 'DeepSeek', protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-r1'],
    free: false, note: '性价比高，deepseek-chat 适合文案、reasoner/r1 适合复杂推理',
  },
  openai: {
    kind: 'llm', label: 'OpenAI GPT', protocol: 'openai',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-5.5', 'gpt-5', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
    free: false, note: '综合能力强（中转站按分组限定可用模型）',
  },
  claude: {
    kind: 'llm', label: 'Claude', protocol: 'openai',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-4', 'claude-sonnet-4', 'claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku'],
    free: false, note: '长文创作好，建议走 OpenAI 兼容中转',
  },
  qwen: {
    kind: 'llm', label: '通义千问', protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com',
    chatPath: '/compatible-mode/v1/chat/completions',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-72b-instruct', 'qwen-long'],
    free: false, note: '国内直连',
  },
  moonshot: {
    kind: 'llm', label: 'Kimi', protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview'],
    free: false, note: '长上下文',
  },
  zhipu: {
    kind: 'llm', label: '智谱 GLM', protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn',
    chatPath: '/api/paas/v4/chat/completions',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air', 'glm-4.5', 'glm-4.5-flash'],
    free: true, note: 'glm-4-flash / glm-4.5-flash 免费档',
  },
  siliconflow: {
    kind: 'llm', label: '硅基流动', protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'],
    free: true, note: '聚合多家开源模型，Qwen2.5-7B 等小模型免费档',
  },
  doubao: {
    kind: 'llm', label: '火山豆包', protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    chatPath: '/api/v3/chat/completions',
    models: ['doubao-pro-32k', 'doubao-pro-128k', 'doubao-lite-32k'],
    free: false, note: '火山方舟（model 需填接入点 ID，OpenAI 兼容）',
  },

  // ===== 文生图 T2I（云端，复用对应平台的 Key） =====
  cogview: {
    kind: 't2i', label: '智谱 CogView', protocol: 'zhipu-image',
    baseUrl: 'https://open.bigmodel.cn', credentialFrom: 'zhipu',
    models: ['cogview-3-flash', 'cogview-3', 'cogview-4', 'cogview-4-250304'],
    free: true, note: 'cogview-3-flash 免费档，复用智谱 GLM 的 Key',
  },
  openai_img: {
    kind: 't2i', label: 'OpenAI 图像', protocol: 'openai-image',
    baseUrl: 'https://api.openai.com', credentialFrom: 'openai',
    models: ['dall-e-3', 'gpt-image-1', 'dall-e-2'],
    free: false, note: '复用 OpenAI 的 Key（中转站需支持图像接口）',
  },
  tongyi_wanx: {
    kind: 't2i', label: '通义万相', protocol: 'dashscope-image',
    baseUrl: 'https://dashscope.aliyuncs.com', credentialFrom: 'qwen',
    models: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wanx2.0-t2i-turbo', 'wanx-v1'],
    free: false, note: 'DashScope 异步任务，复用通义千问的 Key',
  },

  // ===== 文生视频 T2V（云端异步：提交→轮询→下载 mp4） =====
  cogvideo: {
    kind: 't2v', label: '智谱 CogVideoX', protocol: 'zhipu-video',
    baseUrl: 'https://open.bigmodel.cn', credentialFrom: 'zhipu',
    models: ['cogvideox-flash', 'cogvideox', 'cogvideox-2', 'cogvideox-3'],
    free: true, note: 'cogvideox-flash 免费档，复用智谱 GLM 的 Key',
  },
  kling: {
    kind: 't2v', label: '可灵 Kling', protocol: 'kling',
    baseUrl: 'https://api-beijing.klingai.com',
    models: ['kling-v1', 'kling-v1-6', 'kling-v2-master'],
    auth: 'access_secret',
    free: false, note: 'JWT 签名鉴权（Access Key + Secret Key），按量计费',
  },

  // ===== 配音 TTS（第四期：provider 维度，保留 Edge 默认） =====
  openai_tts: {
    kind: 'tts', label: 'OpenAI 语音', protocol: 'openai-tts',
    baseUrl: 'https://api.openai.com', credentialFrom: 'openai',
    models: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
    free: false, note: 'OpenAI 兼容 /v1/audio/speech，复用 OpenAI 的 Key（中转站需支持语音接口）',
  },
  volcano_tts: {
    kind: 'tts', label: '火山豆包语音（V1 传统）', protocol: 'volcano-tts',
    baseUrl: 'https://openspeech.bytedance.com', auth: 'appid_token',
    models: ['BV700_streaming', 'BV701_streaming', 'BV705_streaming', 'BV001_streaming', 'BV002_streaming'],
    free: false, note: '字节火山 V1 传统语音合成（小模型），需 AppID+Access Token+Cluster=volcano_tts（控制台「音频生成→语音合成」开通）',
  },
  volcano_tts_v3: {
    kind: 'tts', label: '火山豆包语音2.0（大模型）', protocol: 'volcano-tts-v3',
    baseUrl: 'https://openspeech.bytedance.com', auth: 'appid_token',
    credentialFrom: 'volcano_tts',
    resourceId: 'volc.service_type.10029',
    models: [
      'zh_female_wanqudashu_moon_bigtts', 'zh_female_daimengchuanmei_moon_bigtts',
      'zh_male_guozhoudege_moon_bigtts', 'zh_male_beijingxiaoye_moon_bigtts',
      'zh_male_shaonianzixin_moon_bigtts', 'zh_female_meilinvyou_moon_bigtts',
      'zh_male_shenyeboke_moon_bigtts', 'zh_female_sajiaonvyou_moon_bigtts',
      'zh_female_yuanqinvyou_moon_bigtts', 'zh_male_haoyuxiaoge_moon_bigtts',
    ],
    free: false, note: '字节火山 V3 大模型语音合成（豆包语音合成模型2.0，_moon_bigtts 音色），需 AppID+Access Token+Resource ID（控制台「音频生成大模型→语音合成大模型」开通）',
  },
};

const config = require('../config');
const credentialStore = require('../credentialStore');
let builtinCreds = null;
try { builtinCreds = require('../builtinCreds'); } catch (_) { builtinCreds = null; }

/** 取某 provider 的静态定义 */
function getProvider(name) {
  return PROVIDERS[name] || null;
}

/** 按能力类型列出 provider（不含密钥） */
function listByKind(kind) {
  return Object.entries(PROVIDERS)
    .filter(([, p]) => p.kind === kind)
    .map(([key, p]) => ({ key, ...p }));
}

/**
 * 解析某 provider 的运行时凭证（合并用户配置）。
 * 优先级：credentials.<name>.apiKey → DeepSeek 旧字段（向后兼容） → ''
 * baseUrl 同理回退到注册表默认值。
 */
function resolveCredentials(name) {
  const def = PROVIDERS[name];
  if (!def) return null;
  // credentialFrom：云端 T2I/T2V 复用对应 LLM 平台的密钥（如 CogView 用 zhipu 的 Key）。
  // baseUrl 仍以本 provider 自己的为准（图像接口域名/路径可能不同）。
  const credKey = def.credentialFrom || name;
  const cred = { ...(config.get(`credentials.${credKey}`) || {}), ...credentialStore.get(credKey) };
  // 向后兼容：deepseek 仍读旧的 deepseek.apiKey / deepseek.baseUrl
  let apiKey = cred.apiKey;
  let baseUrl = cred.baseUrl;
  if (credKey === 'deepseek') {
    apiKey = apiKey || credentialStore.get('deepseek').apiKey || config.get('deepseek.apiKey');
    baseUrl = baseUrl || config.get('deepseek.baseUrl');
    // 可选的本地/答辩环境兜底：默认关闭，且凭证只能来自运行环境变量，绝不随包硬编码。
    if ((!apiKey || !apiKey.trim()) && builtinCreds) {
      try {
        const b = builtinCreds.builtinDeepSeek();
        if (b && b.apiKey) {
          apiKey = b.apiKey;
          baseUrl = baseUrl || b.baseUrl;
        }
      } catch (_) { /* 忽略，回退到空 */ }
    }
  }
  // 可选智谱兜底同样只读运行环境变量；公开分发包默认未配置。
  if (credKey === 'zhipu' && (!apiKey || !apiKey.trim()) && builtinCreds && builtinCreds.builtinZhipu) {
    try {
      const z = builtinCreds.builtinZhipu();
      if (z && z.apiKey) {
        apiKey = z.apiKey;
        baseUrl = baseUrl || z.baseUrl;
      }
    } catch (_) { /* 忽略，回退到空 */ }
  }
  // baseUrl 优先用来源平台用户配置的（支持中转站，如 OpenAI 图像走 xiamiapi），
  // 未配置则回退到本 t2i provider 注册表默认域名。
  const ownBaseUrl = (baseUrl && baseUrl.trim()) || def.baseUrl;
  return {
    apiKey: apiKey || '',
    baseUrl: ownBaseUrl || '',
    chatPath: def.chatPath || '/v1/chat/completions',
    protocol: def.protocol,
    kind: def.kind,
    accessKey: cred.accessKey || '',
    secretKey: cred.secretKey || '',
    appId: cred.appId || '',
    cluster: cred.cluster || '',
    resourceId: cred.resourceId || def.resourceId || '',
  };
}

/** 是否已为某 provider 配置可用凭证 */
function hasCredentials(name) {
  const c = resolveCredentials(name);
  if (!c) return false;
  // 火山 TTS（V1 传统 / V3 大模型）：均需 AppID + Access Token（apiKey）双要件
  if (c.protocol === 'volcano-tts' || c.protocol === 'volcano-tts-v3') return Boolean(c.apiKey && c.appId);
  return Boolean(c.apiKey || (c.accessKey && c.secretKey));
}

/** 用户是否显式保存过该 provider 的凭证（不含内置兜底）。 */
function hasUserCredentials(name) {
  const def = PROVIDERS[name];
  if (!def) return false;
  const credKey = def.credentialFrom || name;
  const cred = { ...(config.getUser(`credentials.${credKey}`) || {}), ...credentialStore.get(credKey) };
  let apiKey = cred.apiKey;
  let accessKey = cred.accessKey;
  let secretKey = cred.secretKey;
  let appId = cred.appId;
  if (credKey === 'deepseek') apiKey = apiKey || credentialStore.get('deepseek').apiKey || config.getUser('deepseek.apiKey');
  if (def.protocol === 'volcano-tts' || def.protocol === 'volcano-tts-v3') return Boolean(apiKey && appId);
  return Boolean(apiKey || (accessKey && secretKey));
}

module.exports = {
  PROVIDERS, getProvider, listByKind,
  resolveCredentials, hasCredentials, hasUserCredentials,
};
