/**
 * 配置服务 - 运行时可改配置
 *
 * 三级回退：用户配置(settings.json) → 环境变量(env) → 内置默认值
 * 保证不破坏现有行为：用户没改过的项，行为与改造前完全一致。
 *
 * 用法：
 *   const config = require('./config');
 *   config.get('uploadDir');            // 取值（带回退）
 *   config.get('deepseek.apiKey');      // 支持点号路径
 *   config.set('deepseek.baseUrl', x);  // 写入并落盘
 *   config.getAll();                    // 合并后的全部配置
 *   config.getAllMasked();              // 密钥脱敏版（给前端）
 */
import fs from 'node:fs'
import path from 'node:path'

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// settings.json 路径：优先环境变量 SETTINGS_FILE（Electron 打包时指向用户数据目录，
// 因为安装目录通常只读且含明文密钥不应放安装目录），否则用开发默认 server/db/settings.json。
export const SETTINGS_FILE = process.env.SETTINGS_FILE
  ? path.resolve(process.env.SETTINGS_FILE)
  : path.join(__dirname, '..', 'db', 'settings.json');

// 内置默认值（最低优先级）
export const DEFAULTS: JsonObject = {
  uploadDir: './uploads',
  ffmpegPath: 'ffmpeg',
  defaultImageModel: 'flux',
  defaultStyle: '写实',
  defaultVoice: 'xiaoxiao',
  defaultDuration: '150-210',
  autoProduce: {
    maxParallel: 2,
    defaultBackground: true,
    autoRetry: 0,
    keepPartialResult: true,
  },
  export: {
    fps: 30,
    resolution: '1080p',
    format: 'mp4',
    quality: 'high',
    defaultDirectory: '',
  },
  // v1.6.5 节奏控制：分镜配音之间的尾部留白（秒）。值越小衔接越紧凑。
  // 旧版本固定 0.3-0.4s，多段累积会让用户感觉"每句话之间都明显停顿"。
  // tightPace=true 时用更小留白（默认 0.12s），让旁白连贯紧凑；false 用 standardTail。
  pacing: {
    tightPace: true,      // 紧凑节奏（推荐，消除句间明显停顿）
    tightTail: 0.12,      // 紧凑模式尾镜留白
    standardTail: 0.3,    // 标准模式尾镜留白（旧行为）
    noVoiceTail: 0.6,     // 无配音分镜的尾镜留白（画面需要呼吸）
  },
  deepseek: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  pollinations: {
    timeout: 20000,
    retries: 3,
  },
  // 按阶段模型路由（升级方案 v3）。未配则各服务回退到自身默认。
  stageModels: {
    script: { provider: 'deepseek', model: 'deepseek-chat' },
    image: { provider: 'cogview', model: 'cogview-3-flash' },
    video: { provider: 'static', model: '' },
    voice: { provider: 'edge', model: '' },
    // 生图备用模型链（v1.6.4，v1.6.5 调整）：主模型失败时按顺序自动切换。
    // 数组元素可为本地模型 key（'flux'/'turbo'/'dreamina'…）或 'provider__model' 云端规格。
    // 默认主图源为智谱 CogView-3-Flash；首次使用需在设置页配置自己的智谱 Key。
    // 默认置空 = 完全走 imageGen 内置兜底链（cogview-3-flash → cogview-3/4 次选 → flux/turbo 最后保底）。
    // 用户可在「设置 → 模型路由」追加自己的智谱/通义万相等 Key 提升稳定性。
    imageChain: [],
  },
  // 各 provider 的凭证（动态 key）。credentials.<provider>.{apiKey,baseUrl,...}
  credentials: {},
};

// 点号路径 → 环境变量名（用户没配时回退到 env，保证旧行为）
const ENV_MAP: Record<string, string> = {
  uploadDir: 'UPLOAD_DIR',
  ffmpegPath: 'FFMPEG_PATH',
  'deepseek.apiKey': 'DEEPSEEK_API_KEY',
  'deepseek.baseUrl': 'DEEPSEEK_BASE_URL',
};

// 敏感字段（getAllMasked 时脱敏），点号路径
export const SECRET_KEYS = ['deepseek.apiKey'] as const;

// ---- 内部：用户配置的内存缓存 ----
let userConfig: JsonObject = {};

export function load(): void {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      userConfig = asObject(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')));
      const credentialStore = require('./credentialStore');
      const migrated = credentialStore.extractFromConfig(userConfig);
      if (migrated.extracted.length) {
        userConfig = asObject(migrated.clean);
        persist();
        console.warn(`[config] 已将 ${migrated.extracted.length} 组旧版明文凭证迁移出 settings.json`);
      }
    }
  } catch (e) {
    console.error('[config] 读取 settings.json 失败，使用默认值:', errorMessage(e));
    userConfig = {};
  }
}
load();

// v1.6.5 一次性迁移：老用户 settings.json 里残留的旧默认主图源（Pollinations flux/turbo）
// 会盖掉新默认的智谱 CogView-3-Flash。仅当用户从未显式改过、且仍是旧默认值时，
// 自动迁移到 cogview-3-flash（实测效果更好且内置免费）。用 _migrations 标记避免重复执行，
// 也避免覆盖用户后续的主动选择。
function runMigrations() {
  try {
    const migrations = asObject(userConfig._migrations);
    userConfig._migrations = migrations;
    if (!migrations.imageDefaultCogview165) {
      const stageModels = asObject(userConfig.stageModels);
      const img = asObject(stageModels.image);
      const isLegacyDefault = img && img.provider === 'pollinations'
        && (img.model === 'flux' || img.model === 'turbo' || !img.model);
      if (isLegacyDefault) {
        stageModels.image = { provider: 'cogview', model: 'cogview-3-flash' };
        userConfig.stageModels = stageModels;
      }
      migrations.imageDefaultCogview165 = true;
      persist();
    }
  } catch (e) {
    console.error('[config] v1.6.5 迁移失败（非致命）:', errorMessage(e));
  }
}

function persist(): void {
  try {
    // 最后一道防线：任何调用方即使误把密钥传给 config，也先迁移到运行时凭证库，
    // settings.json 永远只落非敏感设置。
    const credentialStore = require('./credentialStore');
    const extracted = credentialStore.extractFromConfig(userConfig);
    userConfig = asObject(extracted.clean);
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // 原子写：先写临时文件再 rename
    const tmp = SETTINGS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(userConfig, null, 2), 'utf-8');
    fs.renameSync(tmp, SETTINGS_FILE);
  } catch (e) {
    console.error('[config] 写入 settings.json 失败:', errorMessage(e));
  }
}

// persist 定义后再执行迁移（迁移内部会调用 persist）
runMigrations();

// 点号路径取值
function getByPath(obj: unknown, keyPath: string): unknown {
  let current: unknown = obj;
  for (const key of keyPath.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = asObject(current)[key];
  }
  return current;
}

// 点号路径赋值（自动建中间对象）
function setByPath(obj: JsonObject, keyPath: string, value: unknown): void {
  const keys = keyPath.split('.');
  let cur: JsonObject = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
    const next = asObject(cur[key]);
    cur[key] = next;
    cur = next;
  }
  const last = keys.at(-1);
  if (last) cur[last] = value;
}

/**
 * 取配置：用户配置 → env → 默认值
 */
export function get(keyPath: string): unknown {
  const u = getByPath(userConfig, keyPath);
  if (u !== undefined && u !== null && u !== '') return u;
  const envName = ENV_MAP[keyPath];
  if (envName && process.env[envName] !== undefined && process.env[envName] !== '') {
    return process.env[envName];
  }
  return getByPath(DEFAULTS, keyPath);
}

/**
 * 只读取用户配置文件中的显式保存值，不回退环境变量或内置默认。
 * 用于区分“用户已配置”和“运行时可用”（后者可能来自 env / 内置兜底）。
 */
export function getUser(keyPath: string): unknown {
  return getByPath(userConfig, keyPath);
}

/**
 * 写配置并落盘
 */
export function set(keyPath: string, value: unknown): unknown {
  setByPath(userConfig, keyPath, value);
  persist();
  return get(keyPath);
}

/**
 * 批量写（patch 语义，只覆盖传入的键），支持嵌套对象
 */
export function setMany(patch: unknown): void {
  const walk = (obj: JsonObject, prefix: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      const kp = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(asObject(v), kp);
      } else {
        setByPath(userConfig, kp, v);
      }
    }
  };
  walk(asObject(patch), '');
  persist();
}

// 深合并：默认值打底，env 覆盖映射项，用户配置最高
export function getAll(): JsonObject {
  const merged = structuredClone(DEFAULTS);
  // env 覆盖
  for (const [kp, envName] of Object.entries(ENV_MAP)) {
    if (process.env[envName]) setByPath(merged, kp, process.env[envName]);
  }
  // 用户配置覆盖（深合并）
  const deepMerge = (target: JsonObject, src: JsonObject): void => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const nested = asObject(target[k]);
        target[k] = nested;
        deepMerge(nested, asObject(v));
      } else {
        target[k] = v;
      }
    }
  };
  deepMerge(merged, userConfig);
  return merged;
}

// 脱敏版（给前端）：密钥只回显后 4 位
export function getAllMasked(): JsonObject {
  const all = getAll();
  const maskVal = (val: unknown): unknown => {
    if (val && typeof val === 'string' && val.length > 0) {
      const tail = val.length > 4 ? val.slice(-4) : val;
      return `****${tail}`;
    }
    return val;
  };
  // 静态敏感字段
  for (const sk of SECRET_KEYS) {
    const val = getByPath(all, sk);
    const masked = maskVal(val);
    if (masked !== val) setByPath(all, sk, masked);
  }
  // 动态：credentials.<provider>.{apiKey,secretKey,accessKey} 全部脱敏
  const credentials = asObject(all.credentials);
  if (Object.keys(credentials).length) {
    for (const [prov, credValue] of Object.entries(credentials)) {
      const cred = asObject(credValue);
      if (cred && typeof cred === 'object') {
        for (const f of ['apiKey', 'secretKey', 'accessKey']) {
          if (cred[f]) cred[f] = maskVal(cred[f]);
        }
        credentials[prov] = cred;
      }
    }
    all.credentials = credentials;
  }
  return all;
}

export const reload = load

/**
 * 通用脱敏占位剥离：递归删除任何值以 '****' 开头的 apiKey/secretKey/accessKey 字段，
 * 以及静态 SECRET_KEYS 路径。避免把前端回显的脱敏串写回覆盖真实密钥。
 */
export function stripMasked(obj: unknown): JsonObject {
  const clone = structuredClone(asObject(obj));
  // 静态路径
  for (const sk of SECRET_KEYS) {
    const keys = sk.split('.');
    let cur: JsonObject | undefined = clone;
    for (let i = 0; i < keys.length - 1 && cur; i++) cur = asObject(cur[keys[i] || '']);
    const last = keys.at(-1);
    const value = last && cur ? cur[last] : undefined;
    if (last && cur && typeof value === 'string' && value.startsWith('****')) delete cur[last];
  }
  // 递归动态字段
  const SECRET_FIELDS = new Set(['apiKey', 'secretKey', 'accessKey']);
  const walk = (o: JsonObject): void => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (SECRET_FIELDS.has(k) && typeof v === 'string' && v.startsWith('****')) {
        delete o[k];
      } else if (v && typeof v === 'object') {
        walk(asObject(v));
      }
    }
  };
  walk(clone);
  return clone;
}
