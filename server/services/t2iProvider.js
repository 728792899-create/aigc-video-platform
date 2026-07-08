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

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { resolveCredentials } = require('./providers');

const UPLOAD_DIR = path.resolve(config.get('uploadDir'), 'images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 本适配器负责的协议
const HANDLED = new Set(['openai-image', 'dashscope-image', 'zhipu-image']);
function canHandle(protocol) {
  return HANDLED.has(protocol);
}

// 比例 → 各协议可接受的尺寸串（'x' 分隔；万相用 '*'）
function sizeFor(protocol, model, ratio) {
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
function requestJson(url, { method = 'POST', headers = {}, body = null, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = lib.request(u, opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { _raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const msg = parsed?.error?.message || parsed?.message || parsed?._raw || `HTTP ${res.statusCode}`;
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
function downloadToLocal(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const filename = `t2i_${uuidv4()}.png`;
    const filePath = path.join(UPLOAD_DIR, filename);
    const lib = url.startsWith('http:') ? http : https;
    const file = fs.createWriteStream(filePath);
    const req = lib.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlink(filePath, () => {});
        return downloadToLocal(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close(); fs.unlink(filePath, () => {});
        return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve({ local_path: filePath, file_url: `/uploads/images/${filename}`, filename }); });
    });
    req.on('error', (e) => { fs.unlink(filePath, () => {}); reject(e); });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`下载超时（>${timeoutMs / 1000}s）`)));
  });
}

/** 把 base64 字符串写到本地，返回 {local_path, file_url}。 */
function saveBase64(b64) {
  const filename = `t2i_${uuidv4()}.png`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
  return { local_path: filePath, file_url: `/uploads/images/${filename}` };
}

/** 把单图结果包成统一返回结构。 */
function wrap(submitId, files) {
  return {
    submit_id: submitId,
    gen_status: 'success',
    image_urls: files.map((f) => f.remote_url || f.file_url),
    local_files: files.map((f) => ({ remote_url: f.remote_url || '', local_path: f.local_path, file_url: f.file_url })),
  };
}

/**
 * OpenAI 兼容图像接口 /v1/images/generations（DALL·E 3 / gpt-image-1）。
 * 返回可能是 url 或 b64_json，两种都处理。
 */
async function genOpenAIImage({ apiKey, baseUrl }, model, prompt, ratio) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/images/generations`;
  const body = { model, prompt, n: 1, size: sizeFor('openai-image', model, ratio) };
  // dall-e-3 不支持 response_format=b64 之外的限制，gpt-image-1 默认回 b64
  const data = await requestJson(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const item = data?.data?.[0];
  if (!item) throw new Error('OpenAI 图像返回为空');
  if (item.b64_json) {
    return wrap(`openai_${Date.now()}`, [saveBase64(item.b64_json)]);
  }
  if (item.url) {
    const f = await downloadToLocal(item.url);
    return wrap(`openai_${Date.now()}`, [{ ...f, remote_url: item.url }]);
  }
  throw new Error('OpenAI 图像未返回 url 或 b64');
}

/**
 * 智谱 CogView，OpenAI 风格同步接口 /api/paas/v4/images/generations。
 * 返回 data[].url，需下载落地。
 */
async function genZhipuImage({ apiKey, baseUrl }, model, prompt, ratio, seed = null) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/paas/v4/images/generations`;
  const body = { model, prompt, size: sizeFor('zhipu-image', model, ratio) };
  // v1.6.5：传项目级基准 seed 辅助画风稳定（CogView 接受该参数；注意非严格确定性，
  // 主力一致性来自提示词里的 visual_anchor 全局视觉设定）。
  if (seed != null && Number.isFinite(Number(seed))) body.seed = Number(seed);
  const data = await requestJson(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const item = data?.data?.[0];
  if (!item?.url) throw new Error('智谱 CogView 返回为空');
  const f = await downloadToLocal(item.url);
  return wrap(`cogview_${Date.now()}`, [{ ...f, remote_url: item.url }]);
}

/**
 * 通义万相 DashScope 异步任务：提交 → 轮询 task_id → 拿结果 url。
 * 提交头需带 X-DashScope-Async: enable。
 */
async function genDashScopeImage({ apiKey, baseUrl }, model, prompt, ratio) {
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
  const taskId = submit?.output?.task_id;
  if (!taskId) throw new Error('万相未返回 task_id');

  // 轮询（最多 ~90s）
  const queryUrl = `${root}/api/v1/tasks/${taskId}`;
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const q = await requestJson(queryUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
    const status = q?.output?.task_status;
    if (status === 'SUCCEEDED') {
      const results = q?.output?.results || [];
      const remote = results.find((r) => r.url)?.url;
      if (!remote) throw new Error('万相成功但无图片 url');
      const f = await downloadToLocal(remote);
      return wrap(taskId, [{ ...f, remote_url: remote }]);
    }
    if (status === 'FAILED' || status === 'UNKNOWN') {
      throw new Error(`万相任务失败：${q?.output?.message || status}`);
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
async function generate({ provider, model, prompt, ratio = '16:9', seed = null }) {
  const cred = resolveCredentials(provider);
  if (!cred) throw new Error(`未知 provider: ${provider}`);
  if (!cred.apiKey) throw new Error(`${provider} 未配置 API Key`);
  const protocol = cred.protocol;
  if (protocol === 'openai-image') return genOpenAIImage(cred, model, prompt, ratio);
  if (protocol === 'zhipu-image') return genZhipuImage(cred, model, prompt, ratio, seed);
  if (protocol === 'dashscope-image') return genDashScopeImage(cred, model, prompt, ratio);
  throw new Error(`t2iProvider 不支持协议: ${protocol}`);
}

module.exports = { generate, canHandle };
