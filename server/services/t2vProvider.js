/**
 * 文生视频统一适配器（升级方案 v3 第三期）
 *
 * 把云端主流文生视频能力收敛到一个 generate() 入口，按 protocol 分支：
 *   - zhipu-video : 智谱 CogVideoX，OpenAI 风格异步（提交→轮询 async-result）
 *   - kling       : 可灵 Kling，JWT 签名鉴权 + 异步任务（提交→轮询）
 *
 * 所有 T2V 都是「提交任务 → 轮询 → 下载 mp4」的异步模式。
 * 统一返回结构：
 *   { submit_id, gen_status, video_url, local_path, file_url, duration }
 * 由 pipeline 的「AI 视频」轨拿到本地 mp4 后，规整分辨率+挂音频再交给现有 FFmpeg 串联。
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { resolveCredentials } = require('./providers');

const UPLOAD_DIR = path.resolve(config.get('uploadDir'), 'videos', 't2v');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 本适配器负责的协议
const HANDLED = new Set(['zhipu-video', 'kling']);
function canHandle(protocol) {
  return HANDLED.has(protocol);
}

// 比例 → 各协议接受的写法
function aspectFor(ratio) {
  if (ratio === '9:16' || ratio === '2:3' || ratio === '3:4') return '9:16';
  if (ratio === '1:1') return '1:1';
  return '16:9';
}

/** 通用 JSON 请求（POST/GET）。非 2xx 抛错（带响应体便于诊断）。 */
function requestJson(url, { method = 'POST', headers = {}, body = null, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body ? JSON.stringify(body) : null;
    const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
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

/**
 * 判断错误是否「瞬时可重试」：429 限流 / 5xx 网关 / 网络超时 / 连接重置。
 * 这些是云端高峰期的临时故障（如 CogVideoX 偶发「访问量过大」），退避重试通常第 2 次就成功；
 * 而 4xx（除 429）属配置/鉴权错误，重试无意义，直接放行抛出。
 */
function isTransient(err) {
  const m = String(err && err.message || '');
  if (/^429:/.test(m) || /访问量过大|too many requests|rate limit/i.test(m)) return true;
  if (/^(500|502|503|504):/.test(m)) return true;
  if (/超时|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(m)) return true;
  return false;
}

/**
 * requestJson 的退避重试包装：仅对瞬时错误重试，指数退避 + 抖动。
 * 默认最多 4 次尝试（首次 + 3 次重试），间隔约 4s/8s/16s。非瞬时错误立即抛出。
 */
async function requestJsonRetry(url, options = {}, { attempts = 4, baseDelay = 4000, label = '请求' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await requestJson(url, options);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransient(err)) throw err;
      const delay = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 1000);
      console.warn(`[t2v] ${label} 瞬时失败（${err.message}），${Math.round(delay / 1000)}s 后第 ${i + 2}/${attempts} 次重试…`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** 下载远程 mp4 到本地，返回 {local_path, file_url, filename}。 */
function downloadToLocal(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const filename = `t2v_${uuidv4()}.mp4`;
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
      file.on('finish', () => { file.close(); resolve({ local_path: filePath, file_url: `/uploads/videos/t2v/${filename}`, filename }); });
    });
    req.on('error', (e) => { fs.unlink(filePath, () => {}); reject(e); });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`下载超时（>${timeoutMs / 1000}s）`)));
  });
}

/** 可灵 Kling JWT（HS256）签名：accessKey 作 issuer，secretKey 作密钥，30 分钟有效。 */
function signKlingJwt(accessKey, secretKey) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5 };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac('sha256', secretKey).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

/** 统一返回结构 */
function wrap(submitId, file, duration) {
  return {
    submit_id: submitId,
    gen_status: 'success',
    video_url: file.remote_url || file.file_url,
    local_path: file.local_path,
    file_url: file.file_url,
    duration: duration || null,
  };
}

/**
 * 智谱 CogVideoX，OpenAI 风格异步：
 *   提交 POST /api/paas/v4/videos/generations → 拿 id → 轮询 GET /async-result/{id}。
 * cogvideox-flash 为免费档。
 */
async function genCogVideoX({ apiKey, baseUrl }, model, prompt, ratio, opts = {}) {
  const root = baseUrl.replace(/\/$/, '');
  const submitUrl = `${root}/api/paas/v4/videos/generations`;
  const body = {
    model,
    prompt,
    quality: 'speed',          // flash 档优先速度
    with_audio: false,
  };
  if (opts.imageUrl) {
    // 图生视频：输出尺寸由输入图决定，不再传 size（传了反而可能与图比例冲突报错）。
    body.image_url = opts.imageUrl;
  } else {
    // 纯文生视频：按目标比例指定输出尺寸。
    body.size = ratio === '9:16' ? '1080x1920' : ratio === '1:1' ? '1024x1024' : '1920x1080';
  }
  const submit = await requestJsonRetry(submitUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  }, { label: 'CogVideoX 提交' });
  const taskId = submit?.id || submit?.request_id;
  if (!taskId) throw new Error('CogVideoX 未返回任务 id');

  // 轮询（视频生成较慢，最多 ~5 分钟）
  const queryUrl = `${root}/api/paas/v4/async-result/${taskId}`;
  let pollErrs = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    let q;
    try {
      q = await requestJson(queryUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
    } catch (err) {
      // 轮询期间的瞬时错误（429/网关/超时）不应中断整个任务——任务在云端仍在跑，下次再查。
      // 连续 5 次都失败才放弃（避免端点持续异常时无限空转）。
      if (isTransient(err) && ++pollErrs <= 5) {
        console.warn(`[t2v] CogVideoX 轮询瞬时失败（${err.message}），继续等待…`);
        continue;
      }
      throw err;
    }
    pollErrs = 0;
    const status = q?.task_status;
    if (status === 'SUCCESS') {
      const remote = (q.video_result || [])[0]?.url;
      if (!remote) throw new Error('CogVideoX 成功但无视频 url');
      const f = await downloadToLocal(remote);
      return wrap(taskId, { ...f, remote_url: remote });
    }
    if (status === 'FAIL') throw new Error(`CogVideoX 任务失败：${q?.message || 'FAIL'}`);
  }
  throw new Error('CogVideoX 任务轮询超时（>5min）');
}

/**
 * 可灵 Kling，JWT 鉴权 + 异步：
 *   提交 POST /v1/videos/text2video（或 image2video）→ 拿 task_id → 轮询 GET /v1/videos/.../{task_id}。
 * 付费 provider。
 */
async function genKling({ accessKey, secretKey, baseUrl }, model, prompt, ratio, opts = {}) {
  if (!accessKey || !secretKey) throw new Error('可灵 Kling 需配置 Access Key + Secret Key');
  const root = baseUrl.replace(/\/$/, '');
  const token = signKlingJwt(accessKey, secretKey);
  const isImg = Boolean(opts.imageUrl);
  const submitUrl = `${root}/v1/videos/${isImg ? 'image2video' : 'text2video'}`;
  const body = {
    model_name: model || 'kling-v1',
    prompt,
    aspect_ratio: aspectFor(ratio),
    duration: String(opts.seconds || 5),
    mode: 'std',
  };
  if (isImg) body.image = opts.imageUrl;
  const submit = await requestJsonRetry(submitUrl, {
    headers: { Authorization: `Bearer ${token}` },
    body,
  }, { label: '可灵提交' });
  const taskId = submit?.data?.task_id;
  if (!taskId) throw new Error(`可灵未返回 task_id：${submit?.message || ''}`);

  const queryUrl = `${root}/v1/videos/${isImg ? 'image2video' : 'text2video'}/${taskId}`;
  let pollErrs = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const tk = signKlingJwt(accessKey, secretKey); // 轮询期间 token 可能过期，每次重签
    let q;
    try {
      q = await requestJson(queryUrl, { method: 'GET', headers: { Authorization: `Bearer ${tk}` } });
    } catch (err) {
      if (isTransient(err) && ++pollErrs <= 5) {
        console.warn(`[t2v] 可灵轮询瞬时失败（${err.message}），继续等待…`);
        continue;
      }
      throw err;
    }
    pollErrs = 0;
    const status = q?.data?.task_status;
    if (status === 'succeed') {
      const remote = q?.data?.task_result?.videos?.[0]?.url;
      if (!remote) throw new Error('可灵成功但无视频 url');
      const f = await downloadToLocal(remote);
      return wrap(taskId, { ...f, remote_url: remote });
    }
    if (status === 'failed') throw new Error(`可灵任务失败：${q?.data?.task_status_msg || 'failed'}`);
  }
  throw new Error('可灵任务轮询超时（>5min）');
}

/**
 * 统一文生视频入口。
 * @param {object} args { provider, model, prompt, ratio, imageUrl?, seconds? }
 *   imageUrl 可选——传入则走图生视频（用分镜首图引导，画面更可控）。
 * @returns 统一结构 { submit_id, gen_status, video_url, local_path, file_url, duration }
 */
async function generate({ provider, model, prompt, ratio = '16:9', imageUrl, seconds }) {
  const cred = resolveCredentials(provider);
  if (!cred) throw new Error(`未知 provider: ${provider}`);
  const protocol = cred.protocol;
  const opts = { imageUrl, seconds };
  if (protocol === 'zhipu-video') {
    if (!cred.apiKey) throw new Error(`${provider} 未配置 API Key`);
    return genCogVideoX(cred, model, prompt, ratio, opts);
  }
  if (protocol === 'kling') {
    return genKling(cred, model, prompt, ratio, opts);
  }
  throw new Error(`t2vProvider 不支持协议: ${protocol}`);
}

/**
 * 轻量连通性探针：只提交一次任务确认鉴权 + 端点可用，拿到 task_id 即算通过，
 * 不等待整个生成轮询（文生视频要几分钟，HTTP 测试不能阻塞那么久）。
 * @returns {Promise<{ok:boolean, taskId?:string}>}
 */
async function probe({ provider, model, ratio = '16:9' }) {
  const cred = resolveCredentials(provider);
  if (!cred) throw new Error(`未知 provider: ${provider}`);
  const prompt = '一只猫在草地上奔跑，电影感';
  if (cred.protocol === 'zhipu-video') {
    if (!cred.apiKey) throw new Error(`${provider} 未配置 API Key`);
    const root = cred.baseUrl.replace(/\/$/, '');
    const submit = await requestJson(`${root}/api/paas/v4/videos/generations`, {
      headers: { Authorization: `Bearer ${cred.apiKey}` },
      body: { model: model || 'cogvideox-flash', prompt, with_audio: false },
      timeoutMs: 30000,
    });
    const taskId = submit?.id || submit?.request_id;
    if (!taskId) throw new Error('CogVideoX 未返回任务 id');
    return { ok: true, taskId };
  }
  if (cred.protocol === 'kling') {
    if (!cred.accessKey || !cred.secretKey) throw new Error('可灵需配置 Access Key + Secret Key');
    const root = cred.baseUrl.replace(/\/$/, '');
    const token = signKlingJwt(cred.accessKey, cred.secretKey);
    const submit = await requestJson(`${root}/v1/videos/text2video`, {
      headers: { Authorization: `Bearer ${token}` },
      body: { model_name: model || 'kling-v1', prompt, aspect_ratio: aspectFor(ratio), duration: '5', mode: 'std' },
      timeoutMs: 30000,
    });
    const taskId = submit?.data?.task_id;
    if (!taskId) throw new Error(`可灵未返回 task_id：${submit?.message || ''}`);
    return { ok: true, taskId };
  }
  throw new Error(`t2vProvider 不支持协议: ${cred.protocol}`);
}

module.exports = { generate, canHandle, probe };
