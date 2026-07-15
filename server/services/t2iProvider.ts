/**
 * 文生图统一适配器（升级方案 v3 第二期）
 *
 * 把云端主流文生图能力收敛到一个 generate() 入口，按 protocol 分支：
 *   - openai-image   : OpenAI 兼容 /v1/images/generations（DALL·E 3 / gpt-image-1）
 *   - dashscope-image: 通义万相 DashScope 异步任务（提交→轮询）
 *   - zhipu-image    : 智谱 CogView，OpenAI 风格同步接口
 *
 * 统一返回结构与 pollinations 一致：
 *   { submit_id, gen_status, image_urls, local_files:[{remote_url, local_path, file_url}] }
 * 这样 imageGen / saveImageResults 无需为新 provider 改任何落库逻辑。
 */

import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { assertSelection } from './modelCatalog'
import { resolveCredentials, type ProviderCredentials } from './providers'
import { downloadRemoteMedia } from './remoteMedia'
const config = require('./config');

type JsonObject = Record<string, unknown>
interface LocalImageFile {
  local_path: string
  file_url: string
  filename?: string
  remote_url?: string
}
export interface T2IResult {
  submit_id: string
  gen_status: 'success'
  image_urls: string[]
  local_files: Array<{ remote_url: string; local_path: string; file_url: string }>
}
interface RequestJsonOptions {
  method?: string
  headers?: http.OutgoingHttpHeaders
  body?: unknown
  timeoutMs?: number
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

const UPLOAD_DIR = path.resolve(String(config.get('uploadDir')), 'images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// 本适配器负责的协议
const HANDLED = new Set(['openai-image', 'dashscope-image', 'zhipu-image']);
export function canHandle(protocol: unknown): boolean {
  if (typeof protocol !== 'string') return false;
  return HANDLED.has(protocol);
}

// 比例 → 各协议可接受的尺寸串（'x' 分隔；万相用 '*'）
function sizeFor(protocol: string, model: string, ratio: string): string {
  const isWide = ratio === '16:9' || ratio === '21:9';
  const isTall = ratio === '9:16' || ratio === '2:3' || ratio === '3:4';
  if (protocol === 'openai-image') {
    if ((model || '').startsWith('dall-e-3')) {
      return isWide ? '1792x1024' : isTall ? '1024x1792' : '1024x1024';
    }
    return isWide ? '1536x1024' : isTall ? '1024x1536' : '1024x1024';
  }
  if (protocol === 'zhipu-image') {
    return isWide ? '1440x720' : isTall ? '720x1440' : '1024x1024';
  }
  // dashscope（万相）用 '*' 分隔
  return isWide ? '1280*720' : isTall ? '720*1280' : '1024*1024';
}

/** 通用 JSON 请求（POST/GET），返回解析后的对象。非 2xx 抛错（带响应体便于诊断）。 */
function requestJson(url: string, { method = 'POST', headers = {}, body = null, timeoutMs = 120000 }: RequestJsonOptions = {}): Promise<JsonObject> {
  return new Promise<JsonObject>((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body ? JSON.stringify(body) : null;
    const requestHeaders: http.OutgoingHttpHeaders = { 'Content-Type': 'application/json', ...headers };
    if (payload) requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    const opts: http.RequestOptions = {
      method,
      headers: requestHeaders,
    };
    const req = lib.request(u, opts, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        let parsed: JsonObject;
        try { parsed = data ? asRecord(JSON.parse(data)) : {}; } catch { parsed = { _raw: data }; }
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) return resolve(parsed);
        const msg = asRecord(parsed.error).message || parsed.message || parsed._raw || `HTTP ${status}`;
        reject(new Error(`${res.statusCode}: ${msg}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（>${timeoutMs / 1000}s）`)));
    if (payload) req.write(payload);
    req.end();
  });
}

/** 下载远程图片到本地，返回 {local_path, file_url, filename}。 */
async function downloadToLocal(url: string, timeoutMs = 30000): Promise<LocalImageFile> {
  const requested = path.join(UPLOAD_DIR, `t2i_${uuidv4()}.media`);
  const result = await downloadRemoteMedia(url, {
    destination: requested,
    normalizeExtension: true,
    kind: 'image',
    maxBytes: 50 * 1024 * 1024,
    timeoutMs,
    idleTimeoutMs: Math.min(timeoutMs, 30000),
    headers: { Accept: 'image/png,image/jpeg,image/webp,image/avif,image/*;q=0.8' },
  });
  const filename = path.basename(result.destination);
  return { local_path: result.destination, file_url: `/uploads/images/${filename}`, filename };
}

/** 把 base64 字符串写到本地，返回 {local_path, file_url}。 */
function saveBase64(b64: string): LocalImageFile {
  const filename = `t2i_${uuidv4()}.png`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
  return { local_path: filePath, file_url: `/uploads/images/${filename}` };
}

/** 把单图结果包成统一返回结构。 */
function wrap(submitId: string, files: LocalImageFile[]): T2IResult {
  return {
    submit_id: submitId,
    gen_status: 'success',
    image_urls: files.map((f) => f.file_url),
    local_files: files.map((f) => ({ remote_url: '', local_path: f.local_path, file_url: f.file_url })),
  };
}

/**
 * OpenAI 兼容图像接口 /v1/images/generations（DALL·E 3 / gpt-image-1）。
 * 返回可能是 url 或 b64_json，两种都处理。
 */
async function genOpenAIImage({ apiKey, baseUrl }: ProviderCredentials, model: string, prompt: string, ratio: string): Promise<T2IResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/images/generations`;
  const body = { model, prompt, n: 1, size: sizeFor('openai-image', model, ratio) };
  // dall-e-3 不支持 response_format=b64 之外的限制，gpt-image-1 默认回 b64
  const data = await requestJson(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const items = Array.isArray(data.data) ? data.data : [];
  const item = asRecord(items[0]);
  if (typeof item.b64_json === 'string') {
    return wrap(`openai_${Date.now()}`, [saveBase64(item.b64_json)]);
  }
  if (typeof item.url === 'string') {
    const f = await downloadToLocal(item.url);
    return wrap(`openai_${Date.now()}`, [{ ...f, remote_url: item.url }]);
  }
  throw new Error('OpenAI 图像未返回 url 或 b64');
}

/**
 * 智谱 CogView，OpenAI 风格同步接口 /api/paas/v4/images/generations。
 * 返回 data[].url，需下载落地。
 */
async function genZhipuImage({ apiKey, baseUrl }: ProviderCredentials, model: string, prompt: string, ratio: string, seed: unknown = null): Promise<T2IResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/paas/v4/images/generations`;
  const body: JsonObject = { model, prompt, size: sizeFor('zhipu-image', model, ratio) };
  // v1.6.5：传项目级基准 seed 辅助画风稳定（CogView 接受该参数；注意非严格确定性，
  // 主力一致性来自提示词里的 visual_anchor 全局视觉设定）。
  if (seed != null && Number.isFinite(Number(seed))) body.seed = Number(seed);
  const data = await requestJson(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const items = Array.isArray(data.data) ? data.data : [];
  const item = asRecord(items[0]);
  if (typeof item.url !== 'string') throw new Error('智谱 CogView 返回为空');
  const f = await downloadToLocal(item.url);
  return wrap(`cogview_${Date.now()}`, [{ ...f, remote_url: item.url }]);
}

/**
 * 通义万相 DashScope 异步任务：提交 → 轮询 task_id → 拿结果 url。
 * 提交头需带 X-DashScope-Async: enable。
 */
async function genDashScopeImage({ apiKey, baseUrl }: ProviderCredentials, model: string, prompt: string, ratio: string): Promise<T2IResult> {
  const root = baseUrl.replace(/\/$/, '');
  const submitUrl = `${root}/api/v1/services/aigc/text2image/image-synthesis`;
  const submit = await requestJson(submitUrl, {
    headers: { Authorization: `Bearer ${apiKey}`, 'X-DashScope-Async': 'enable' },
    body: {
      model,
      input: { prompt },
      parameters: { size: sizeFor('dashscope-image', model, ratio), n: 1 },
    },
  });
  const taskIdValue = asRecord(submit.output).task_id;
  if (typeof taskIdValue !== 'string') throw new Error('万相未返回 task_id');
  const taskId = taskIdValue;

  // 轮询（最多 ~90s）
  const queryUrl = `${root}/api/v1/tasks/${taskId}`;
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const q = await requestJson(queryUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
    const output = asRecord(q.output);
    const status = output.task_status;
    if (status === 'SUCCEEDED') {
      const results = Array.isArray(output.results) ? output.results.map(asRecord) : [];
      const remoteValue = results.find((result) => typeof result.url === 'string')?.url;
      if (typeof remoteValue !== 'string') throw new Error('万相成功但无图片 url');
      const remote = remoteValue;
      const f = await downloadToLocal(remote);
      return wrap(taskId, [{ ...f, remote_url: remote }]);
    }
    if (status === 'FAILED' || status === 'UNKNOWN') {
      throw new Error(`万相任务失败：${output.message || status}`);
    }
  }
  throw new Error('万相任务轮询超时（>90s）');
}

/**
 * 统一文生图入口。
 * @param {object} args { provider, model, prompt, ratio }
 *   provider 必须是已在注册表登记且 protocol 属于本适配器的 t2i provider。
 * @returns 统一结构 { submit_id, gen_status, image_urls, local_files }
 */
export async function generate({ provider, model, prompt, ratio = '16:9', seed = null }: {
  provider: string
  model?: string
  prompt: string
  ratio?: string
  seed?: unknown
}): Promise<T2IResult> {
  const selection = assertSelection({ provider, model, modality: 'image' });
  model = selection.model;
  const cred = resolveCredentials(provider);
  if (!cred) throw new Error(`未知 provider: ${provider}`);
  if (!cred.apiKey) throw new Error(`${provider} 未配置 API Key`);
  const protocol = cred.protocol;
  if (protocol === 'openai-image') return genOpenAIImage(cred, model, prompt, ratio);
  if (protocol === 'zhipu-image') return genZhipuImage(cred, model, prompt, ratio, seed);
  if (protocol === 'dashscope-image') return genDashScopeImage(cred, model, prompt, ratio);
  throw new Error(`t2iProvider 不支持协议: ${protocol}`);
}
