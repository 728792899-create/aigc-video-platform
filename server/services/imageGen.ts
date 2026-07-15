/**
 * 图片生成统一服务
 * - 自动构建正向/负向提示词（结合分镜描述 + 项目风格）
 * - 多 Provider 支持：pollinations（默认稳定）、dreamina（即梦，可选）
 * - 多模型路由 + 失败自动降级
 */

const dreamina = require('./dreamina');
const pollinations = require('./pollinations');
const placeholder = require('./placeholder');
import * as t2iProvider from './t2iProvider'
import * as providers from './providers'
import * as config from './config'
import * as modelCatalog from './modelCatalog'

interface LocalFile { remote_url: string; local_path: string; file_path?: string; file_url: string }
interface ImageProviderResult {
  submit_id: string
  gen_status: string
  image_urls: string[]
  local_files: LocalFile[]
}
interface LocalModel {
  label: string
  provider: 'pollinations' | 'dreamina'
  supports_negative: boolean
  pollinations_model?: string
  model_version?: string
  resolution_type?: string
}
type GenerationTarget =
  | { kind: 'cloud'; provider: string; model: string }
  | { kind: 'dreamina' | 'pollinations'; localKey: string }
interface GenerationAttempt { model: string; ok: boolean; error?: string }
type ProgressCallback = (completed: number, total: number) => void
interface GenerateOptions {
  description?: string
  userPrompt?: string
  style?: string
  ratio?: string
  model?: string
  batchSize?: number
  onProgress?: ProgressCallback | null
  onNotice?: ((message: string) => void) | null
  visualAnchor?: string
  seed?: number | null
  referenceImages?: unknown[]
  consistencyMode?: string
  promptOverride?: string
  negativePromptOverride?: string
}

// 风格关键词映射（用于追加到 prompt 末尾）
export const STYLE_KEYWORDS: Record<string, string> = {
  realistic: 'photorealistic, ultra detailed, 8K, cinematic lighting, sharp focus',
  animation: 'anime style, cel shading, vibrant colors, studio ghibli inspired',
  cyberpunk: 'cyberpunk, neon lights, futuristic city, blade runner aesthetic, dystopian',
  'ink-wash': 'Chinese ink wash painting, sumi-e, traditional, monochrome, minimal',
  minimal: 'minimalist, clean composition, negative space, simple, elegant',
  retro: 'retro 80s aesthetic, vintage film, grain, pastel colors, nostalgic',
};

// 中文风格名 → 英文 key 归一化（兼容老项目 DB 里存的中文 style，如默认值 '写实'）
const STYLE_ALIAS: Record<string, string> = {
  '写实': 'realistic', '真实': 'realistic', '实拍': 'realistic',
  '动画': 'animation', '动漫': 'animation', '卡通': 'animation',
  '赛博朋克': 'cyberpunk', '赛博': 'cyberpunk', '科幻': 'cyberpunk',
  '水墨': 'ink-wash', '国风': 'ink-wash', '中国风': 'ink-wash',
  '极简': 'minimal', '简约': 'minimal',
  '复古': 'retro', '怀旧': 'retro',
};
function normalizeStyle(style: unknown): string {
  if (!style) return '';
  const key = String(style);
  if (STYLE_KEYWORDS[key]) return key; // 已是英文 key
  return STYLE_ALIAS[key] || ''; // 中文别名 → key，未知则返回空（不强加风格词）
}

// 通用画质前缀
const QUALITY_PREFIX = 'masterpiece, best quality, highly detailed';

// 通用负向提示词（用于支持负向 prompt 的模型）
export const DEFAULT_NEGATIVE = 'low quality, blurry, distorted, watermark, text, signature, ugly, bad anatomy, extra fingers, deformed';

// 模型注册表
// provider: 'pollinations' 默认稳定免费；'dreamina' 即梦（需本地 CLI 可用 + 积分）
const MODELS: Record<string, LocalModel> = {
  flux: {
    label: 'Flux（默认·免费稳定）',
    provider: 'pollinations',
    pollinations_model: 'flux',
    supports_negative: true,
  },
  'flux-realism': {
    label: 'Flux Realism（写实）',
    provider: 'pollinations',
    pollinations_model: 'flux-realism',
    supports_negative: true,
  },
  turbo: {
    label: 'Turbo（极速）',
    provider: 'pollinations',
    pollinations_model: 'turbo',
    supports_negative: true,
  },
  dreamina: {
    label: '即梦 4.0（高品质·消耗积分）',
    provider: 'dreamina',
    model_version: '4.0',
    resolution_type: '2k',
    supports_negative: false,
  },
  dreamina_5_0: {
    label: '即梦 5.0（最新·消耗积分）',
    provider: 'dreamina',
    model_version: '5.0',
    resolution_type: '2k',
    supports_negative: false,
  },
};

/**
 * 构建完整的正向提示词
 * @param {string} description 本镜画面描述
 * @param {string} userPrompt 用户自定义提示词（优先于 description）
 * @param {string} style 风格 key
 * @param {string} [visualAnchor] 项目级全局视觉设定（v1.6.5 画风一致性）：
 *   前置到每镜提示词，统一主角外貌/画风/色调，确保跨分镜连贯。
 */
export function buildPrompt(description: unknown, userPrompt: unknown, style: unknown, visualAnchor: unknown = ''): string {
  const custom = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  const base = custom || String(description || '');
  const styleSuffix = STYLE_KEYWORDS[normalizeStyle(style)] || '';
  const anchor = typeof visualAnchor === 'string' ? visualAnchor.trim() : '';
  // 顺序：质量词 → 全局视觉锚定（主角/画风/色调）→ 本镜画面 → 风格词
  return [QUALITY_PREFIX, anchor, base, styleSuffix].filter(Boolean).join(', ');
}

function buildReferenceNotice(referenceImages: unknown[] = [], consistencyMode = 'standard'): string {
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) return '';
  const count = referenceImages.length;
  return `已绑定 ${count} 张角色参考图；当前文生图通用适配器暂未直接上传参考图，将使用角色文字锚点 + 项目 seed 兜底保持一致性${consistencyMode === 'strict' ? '（严格模式已完成参考图预检）' : ''}。`;
}

export function listModels() {
  // 本地模型（Pollinations / 即梦）
  const local = Object.entries(MODELS).map(([key, m]) => ({
    key,
    label: m.label,
    provider: m.provider,
    cloud: false,
  }));
  // 云端 t2i provider（按 provider+model 展开，key = provider__model）
  const cloud: Array<{ key: string; label: string; provider: string; cloud: true; configured: boolean; free: boolean }> = [];
  for (const p of providers.listByKind('t2i')) {
    if (!t2iProvider.canHandle(p.protocol)) continue;
    const configured = providers.hasCredentials(p.key);
    for (const model of p.models || []) {
      cloud.push({
        key: `${p.key}__${model}`,
        label: `${p.label} · ${model}${p.free ? '（含免费档）' : ''}${configured ? '' : '（未配置）'}`,
        provider: p.key,
        cloud: true,
        configured,
        free: !!p.free,
      });
    }
  }
  return [...local, ...cloud];
}

/**
 * 解析 model 参数到一个统一目标。
 * model 取值：falsy/'auto' → 用 stageModels.image 路由；本地 MODELS key；'provider__model' 云端规格。
 */
function resolveTarget(modelKey: string | null | undefined): GenerationTarget {
  if (!modelKey || modelKey === 'auto') {
    const rawStage = config.get('stageModels.image');
    const stage = rawStage && typeof rawStage === 'object' && !Array.isArray(rawStage)
      ? Object.fromEntries(Object.entries(rawStage))
      : { provider: 'pollinations', model: 'flux' };
    return stageToTarget(stage);
  }
  if (modelKey.includes('__')) {
    const [provider, model] = modelKey.split(/__(.*)/s, 2);
    if (!provider || !model) throw new modelCatalog.ModelCatalogError('MODEL_NOT_FOUND', `无效图片模型：${modelKey}`, { model: modelKey });
    modelCatalog.assertSelection({ provider, model, modality: 'image' });
    return { kind: 'cloud', provider, model };
  }
  if (MODELS[modelKey]) {
    return { kind: MODELS[modelKey].provider === 'dreamina' ? 'dreamina' : 'pollinations', localKey: modelKey };
  }
  throw new modelCatalog.ModelCatalogError('MODEL_NOT_FOUND', `未知图片模型：${modelKey}`, { model: modelKey });
}

function stageToTarget(stage: Record<string, unknown>): GenerationTarget {
  const p = String(stage.provider || '');
  const definition = modelCatalog.assertSelection({ provider: p, model: stage.model, modality: 'image' });
  if (p === 'pollinations') {
    return { kind: 'pollinations', localKey: definition.model };
  }
  if (p === 'dreamina') {
    return { kind: 'dreamina', localKey: definition.model === '5.0' ? 'dreamina_5_0' : 'dreamina' };
  }
  return { kind: 'cloud', provider: p, model: definition.model };
}

// —— 模型链：目标唯一标识 + 人类可读标签 ——
function targetId(t: GenerationTarget): string {
  if (t.kind === 'cloud') return `cloud:${t.provider}:${t.model}`;
  return `${t.kind}:${t.localKey}`;
}
function targetLabel(t: GenerationTarget): string {
  if (t.kind === 'cloud') {
    const def = providers.getProvider(t.provider);
    return `${def?.label || t.provider} · ${t.model}`;
  }
  return MODELS[t.localKey]?.label || t.localKey;
}

/**
 * 构建生图模型链（按优先级依次尝试）：
 *   1) 用户本次选定的模型（modelKey）
 *   2) 用户在设置里配置的备用链 stageModels.imageChain（数组）
 *   3) 内置兜底链（Pollinations flux / turbo），保证至少有免费档可试
 * 同一模型去重，保持先后顺序。
 */
function resolveChain(modelKey: string | null | undefined): GenerationTarget[] {
  const chain: GenerationTarget[] = [];
  const seen = new Set<string>();
  const push = (target: GenerationTarget | null | undefined): void => {
    if (!target) return;
    const id = targetId(target);
    if (seen.has(id)) return;
    seen.add(id);
    chain.push(target);
  };
  // 1) 本次选定
  push(resolveTarget(modelKey));
  // 2) 用户配置的备用链
  const backup = config.get('stageModels.imageChain');
  if (Array.isArray(backup)) {
    for (const item of backup) {
      if (!item) continue;
      if (typeof item === 'string') push(resolveTarget(item));
      else if (item && typeof item === 'object' && !Array.isArray(item)) push(stageToTarget(Object.fromEntries(Object.entries(item))));
    }
  }
  // 3) 通用兜底链（按效果与可用性排序）：
  //    a. 智谱 CogView-3-Flash / CogView-3 / CogView-4 —— 配置用户自己的智谱 Key 后启用；
  //    b. Pollinations flux / turbo —— 无密钥免费图源，失败时最终落到本地占位图。
  push({ kind: 'cloud', provider: 'cogview', model: 'cogview-3-flash' });
  push({ kind: 'cloud', provider: 'cogview', model: 'cogview-3' });
  push({ kind: 'cloud', provider: 'cogview', model: 'cogview-4' });
  push({ kind: 'pollinations', localKey: 'flux' });
  push({ kind: 'pollinations', localKey: 'turbo' });
  return chain;
}

/**
 * 执行单个模型目标的生成。成功返回 {result, modelLabel}，失败抛错（带干净的原因）。
 */
async function attemptTarget(
  target: GenerationTarget,
  prompt: string,
  ratio: string,
  count: number,
  negativeDefault: string,
  onProgress: ProgressCallback | null,
  seed: number | null = null,
): Promise<{ result: ImageProviderResult; modelLabel: string; negativePrompt?: string }> {
  if (target.kind === 'cloud') {
    const def = providers.getProvider(target.provider);
    if (!providers.hasCredentials(target.provider)) {
      throw new Error(`${def?.label || target.provider} 未配置 API Key`);
    }
    const result = await t2iProvider.generate({ provider: target.provider, model: target.model, prompt, ratio, seed });
    if (!result.local_files || result.local_files.length === 0) throw new Error('云端 t2i 未返回任何图片');
    return { result, modelLabel: targetLabel(target) };
  }
  if (target.kind === 'dreamina') {
    const m = MODELS[target.localKey];
    if (!m) throw new Error(`未知本地图像模型：${target.localKey}`);
    const result = await dreamina.generateImage(prompt, ratio, {
      model_version: m.model_version, resolution_type: m.resolution_type, poll: 90,
    });
    if (!result.local_files || result.local_files.length === 0) throw new Error('即梦未返回任何图片（积分不足？）');
    return { result, modelLabel: m.label };
  }
  // pollinations
  const m = MODELS[target.localKey] || MODELS.flux;
  if (!m?.pollinations_model) throw new Error(`未知 Pollinations 模型：${target.localKey}`);
  const negativePrompt = m.supports_negative ? negativeDefault : '';
  const result = await generatePollinationsBatch(prompt, ratio, m.pollinations_model, negativePrompt, count, onProgress);
  return { result, modelLabel: m.label, negativePrompt };
}

/**
 * 生成图片（多 Provider 路由 + 自动降级 + 多候选支持）
 * @param {object} params { description, userPrompt, style, ratio, model, batchSize, onProgress, visualAnchor, seed }
 *   model: falsy/'auto' 走 stageModels.image 路由；本地 key（flux/turbo/dreamina…）；或 'provider__model' 云端规格。
 *   visualAnchor: 项目级全局视觉设定（v1.6.5 画风一致性），前置到提示词统一画风。
 *   seed: 项目级基准随机种子（v1.6.5），同项目复用以稳定主体/画风（仅支持的云端模型生效）。
 */
/**
 * 全链生图失败时构建占位图兜底通知。
 * @returns {{ notice: string, isPlaceholder: boolean, usedProvider: string }}
 */
function buildFailureNotice(attempts: GenerationAttempt[], chain: GenerationTarget[]) {
  const failList = attempts.map((a) => `「${a.model}」(${a.error})`).join('、');
  // 是否尝试过非 Pollinations 的其它来源（云端 t2i / 即梦）。
  // 若全是 Pollinations 免费档，说明用户没配不同来源的备用模型，重点提示去多配。
  const triedOtherSource = chain.some((t) => t.kind !== 'pollinations');
  const notice = !triedOtherSource
    ? `生图失败：${failList}。目前只用到了免费图源（Pollinations），它对新网络/新电脑常因免费额度限流（HTTP 402）而失败。强烈建议到「设置 → 模型路由 → 备用生图模型」再配置 1-2 个不同来源的模型（如智谱 CogView、通义万相，注册即送免费额度），任一可用即可稳定出图。已先用占位图兜底。`
    : `已依次尝试 ${chain.length} 个生图模型均失败：${failList}。已用占位图兜底，请检查网络，或在「设置」中确认所配模型的 API Key 有效、额度充足。`;
  return { notice, isPlaceholder: true, usedProvider: 'placeholder(兜底)' };
}

/** 部分模型失败但降级成功时的提示 */
function buildDowngradeNotice(attempts: GenerationAttempt[], modelLabel: string): string {
  const failed = attempts.filter((a) => !a.ok).map((a) => `「${a.model}」(${a.error})`).join('、');
  return `生图模型 ${failed} 失败，已自动改用「${modelLabel}」成功生成。`;
}

export async function generate({
  description, userPrompt, style, ratio = '16:9', model = 'auto', batchSize = 1,
  onProgress = null, onNotice = null, visualAnchor = '', seed = null,
  referenceImages = [], consistencyMode = 'standard', promptOverride = '', negativePromptOverride = '',
}: GenerateOptions = {}) {
  const prompt = promptOverride || buildPrompt(description, userPrompt, style, visualAnchor);
  const negativeDefault = negativePromptOverride || DEFAULT_NEGATIVE;
  const N = Math.max(1, Math.min(4, batchSize)); // 限制 1-4 张
  const chain = resolveChain(model);

  // DEMO_MODE 固定使用本地占位图，不访问任何真实图源或消耗额度。
  if (['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase())) {
    const demoResult = await buildPlaceholderResult(ratio, { demo: true });
    if (onProgress) onProgress(1, 1);
    return {
      prompt,
      negative_prompt: negativeDefault,
      model: 'DEMO 本地占位图',
      provider: 'demo',
      downgraded: false,
      is_placeholder: true,
      attempts: [{ model: 'DEMO 本地占位图', ok: true }],
      notice: 'Demo Mode 已在本机生成原创占位画面，未调用任何付费模型。',
      reference_mode: referenceImages?.length ? 'text-anchor-seed-fallback' : 'text-anchor',
      reference_images: referenceImages || [],
      submit_id: demoResult.submit_id,
      gen_status: demoResult.gen_status,
      image_urls: demoResult.image_urls,
      local_files: demoResult.local_files,
    };
  }

  const notify = (message: string): void => { try { onNotice?.(message); } catch {} };
  const attempts: GenerationAttempt[] = [];
  let result: ImageProviderResult | null = null;
  let modelLabel = '', usedProvider = '', negativePrompt = '', downgraded = false;
  const referenceNotice = buildReferenceNotice(referenceImages, consistencyMode);
  if (referenceNotice) notify(referenceNotice);

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i];
    if (!target) continue;
    const label = targetLabel(target);
    try {
      if (i > 0) notify(`模型「${attempts[i - 1]?.model || '未知'}」生成失败，已自动切换到「${label}」重试…`);
      const r = await attemptTarget(target, prompt, ratio, N, negativeDefault, onProgress, seed);
      result = r.result; modelLabel = r.modelLabel; negativePrompt = r.negativePrompt || '';
      usedProvider = target.kind === 'cloud' ? target.provider : target.kind;
      if (i > 0) { downgraded = true; usedProvider = `${usedProvider}(降级·前${i}个模型失败)`; }
      attempts.push({ model: label, ok: true });
      break;
    } catch (err: unknown) {
      const reason = friendlyReason(err instanceof Error ? err.message : err);
      console.error(`[imageGen] 模型「${label}」失败：${reason}`);
      attempts.push({ model: label, ok: false, error: reason });
    }
  }

  // 全链失败 → 占位图兜底
  let isPlaceholder = false, notice = '';
  if (!result) {
    const failure = buildFailureNotice(attempts, chain);
    notice = failure.notice;
    notify(notice);
    console.warn(`[imageGen] 全部模型失败，占位图兜底。${notice}`);
    result = await buildPlaceholderResult(ratio);
    usedProvider = failure.usedProvider;
    isPlaceholder = failure.isPlaceholder;
  } else if (downgraded) {
    notice = buildDowngradeNotice(attempts, modelLabel);
  }

  return {
    prompt,
    negative_prompt: negativePrompt || negativeDefault,
    model: modelLabel,
    provider: usedProvider,
    downgraded,
    is_placeholder: isPlaceholder,
    attempts,
    notice: [referenceNotice, notice].filter(Boolean).join(' '),
    reference_mode: referenceImages?.length ? 'text-anchor-seed-fallback' : 'text-anchor',
    reference_images: referenceImages || [],
    submit_id: result.submit_id,
    gen_status: result.gen_status,
    image_urls: result.image_urls,
    local_files: result.local_files,
  };
}

/** 把底层错误信息翻译成用户能懂的原因 */
function friendlyReason(msg: unknown): string {
  const m = String(msg || '');
  if (/402/.test(m)) return '免费额度已用尽(HTTP 402)，该图源对当前网络限流';
  if (/429/.test(m)) return '请求过于频繁(HTTP 429)，被限流';
  if (/401|403/.test(m)) return 'API Key 无效或未授权';
  if (/未配置 API Key/.test(m)) return '未配置 API Key';
  if (/积分不足/.test(m)) return '账户积分不足';
  if (/timeout|超时|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(m)) return '网络超时';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(m)) return '网络连接失败';
  if (/500|502|503|504/.test(m)) return '图源服务器错误';
  return m.length > 60 ? m.slice(0, 60) + '…' : m;
}

/**
 * 占位图兜底：生成一张占位图并组装成与 provider 一致的结果结构。
 * 占位图也失败时抛错（此时确实无法兜底）。
 */
async function buildPlaceholderResult(ratio: string, options: Record<string, unknown> = {}): Promise<ImageProviderResult> {
  const ph = await placeholder.generatePlaceholder(ratio, options);
  if (!ph) throw new Error('图片生成失败，且占位图兜底也失败（ffmpeg 不可用？）');
  return {
    submit_id: `placeholder_${Date.now()}`,
    gen_status: 'placeholder',
    image_urls: [ph.file_url],
    local_files: [{
      remote_url: '',
      local_path: ph.local_path,
      file_url: ph.file_url,
    }],
  };
}

/**
 * Pollinations 多候选并发生成
 */
async function generatePollinationsBatch(
  prompt: string,
  ratio: string,
  model: string,
  negativePrompt: string,
  count: number,
  onProgress: ProgressCallback | null,
): Promise<ImageProviderResult> {
  const seeds = Array.from({ length: count }, () => Math.floor(Math.random() * 1000000));
  const all = await Promise.allSettled(
    seeds.map((seed, idx) =>
      pollinations.generateImage(prompt, ratio, { model, seed, negativePrompt })
        .then((result: ImageProviderResult) => {
          if (onProgress) onProgress(idx + 1, count);
          return result;
        })
    )
  );

  const successful = all.flatMap((item): ImageProviderResult[] => item.status === 'fulfilled' ? [item.value] : []);
  if (successful.length === 0) {
    const reasons = all.flatMap((item): string[] => item.status === 'rejected'
      ? [item.reason instanceof Error ? item.reason.message : String(item.reason || '')]
      : []).join('; ');
    throw new Error(`Pollinations 全部失败：${reasons}`);
  }

  // 合并 local_files / image_urls
  const local_files: LocalFile[] = [];
  const image_urls: string[] = [];
  for (const result of successful) {
    local_files.push(...result.local_files);
    image_urls.push(...result.image_urls);
  }

  return {
    submit_id: `pollinations_batch_${Date.now()}`,
    gen_status: 'success',
    image_urls,
    local_files,
  };
}
