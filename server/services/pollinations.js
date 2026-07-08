/**
 * Pollinations.ai 图片生成 provider
 * 免费、无需 API key、CORS 友好，用作默认稳定降级方案
 * 文档：https://pollinations.ai/
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const UPLOAD_DIR = path.resolve(config.get('uploadDir'), 'images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 比例 → (width, height) 1280 基线
const RATIO_TO_SIZE = {
  '21:9': [1680, 720],
  '16:9': [1280, 720],
  '3:2': [1200, 800],
  '4:3': [1024, 768],
  '1:1': [1024, 1024],
  '4:5': [864, 1080],
  '3:4': [768, 1024],
  '2:3': [800, 1200],
  '9:16': [720, 1280],
};

/**
 * 下载到本地。
 * 两道超时保护：
 *  - idleMs：响应数据流“静默”超时（卡住不再吐字节就中断，慢网真凶）
 *  - hardMs：整体硬超时（兜底，防止极慢但持续滴流的连接拖死流水线）
 * 带浏览器 UA + Accept 头，规避部分 CDN 节点对无 UA 请求的限流。
 */
function downloadImage(url, filename, idleMs = 30000, hardMs = 90000) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(UPLOAD_DIR, filename);
    const file = fs.createWriteStream(filePath);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*,*/*;q=0.8',
    };
    let settled = false;
    let idleTimer = null;
    const cleanup = (err, ok) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      try { file.close(); } catch {}
      if (err) { fs.unlink(filePath, () => {}); reject(err); }
      else resolve(ok);
    };
    const hardTimer = setTimeout(() => {
      req.destroy(new Error(`Pollinations 整体超时（>${hardMs / 1000}s）`));
    }, hardMs);
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        req.destroy(new Error(`Pollinations 数据流停滞（>${idleMs / 1000}s 无新数据）`));
      }, idleMs);
    };
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // 跟随重定向：关掉当前文件流与计时器，但把 resolve/reject 交给递归调用
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        settled = true;
        try { file.close(); } catch {}
        fs.unlink(filePath, () => {});
        return downloadImage(res.headers.location, filename, idleMs, hardMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return cleanup(new Error(`Pollinations 下载失败 HTTP ${res.statusCode}`));
      }
      armIdle();
      res.on('data', () => armIdle()); // 每收到一块数据就重置静默计时器
      res.pipe(file);
      file.on('finish', () => cleanup(null, filePath));
      file.on('error', (e) => cleanup(e));
    });
    req.on('error', (e) => cleanup(e));
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 生成图片
 * @param {string} prompt
 * @param {string} ratio
 * @param {object} options { model, seed, negativePrompt }
 */
async function generateImage(prompt, ratio = '16:9', options = {}) {
  const [width, height] = RATIO_TO_SIZE[ratio] || [1280, 720];
  const baseSeed = options.seed || Math.floor(Math.random() * 1000000);
  const model = options.model || 'flux'; // flux / flux-realism / turbo / any-dark

  function buildUrl(seed) {
    const params = new URLSearchParams({
      width: String(width), height: String(height),
      seed: String(seed), model, nologo: 'true',
    });
    if (options.negativePrompt) params.set('negative_prompt', options.negativePrompt);
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
  }

  // 重试：网络抖动/超时/空图最多重试 4 次，指数退避 + 抖动（1s, 2s, 4s, 上限 8s）
  // 指数退避避免在服务端过载时持续高频施压；抖动（±25%）防止多任务同时重试形成尖峰。
  // 重试时换新 seed —— 同一 prompt+seed 若被某 CDN 节点卡住，换 seed 等于换一张图/换一条路径。
  const maxRetries = options.retries != null ? options.retries : 4;
  const BASE_DELAY = 1000; // 基础退避 1s
  const MAX_DELAY = 8000;  // 退避上限 8s
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const seed = attempt === 1 ? baseSeed : Math.floor(Math.random() * 1000000);
    const url = buildUrl(seed);
    const filename = `pollinations_${uuidv4()}.jpeg`;
    if (attempt === 1) console.log('[pollinations] url:', url);
    try {
      const filePath = await downloadImage(url, filename);
      const stat = fs.statSync(filePath);
      if (stat.size < 1000) {
        fs.unlinkSync(filePath);
        throw new Error('Pollinations 返回图片为空或损坏');
      }
      if (attempt > 1) console.log(`[pollinations] 第 ${attempt} 次重试成功（换 seed=${seed}）`);
      return {
        submit_id: `pollinations_${seed}`,
        gen_status: 'success',
        raw: { provider: 'pollinations', model, seed, width, height },
        image_urls: [url],
        local_files: [{
          remote_url: url,
          local_path: filePath,
          file_url: `/uploads/images/${filename}`,
        }],
      };
    } catch (err) {
      lastErr = err;
      console.warn(`[pollinations] 第 ${attempt}/${maxRetries} 次失败：${err.message}`);
      if (attempt < maxRetries) {
        // 指数退避：base * 2^(attempt-1)，加 ±25% 抖动，限制上限
        const exponentialDelay = BASE_DELAY * Math.pow(2, attempt - 1);
        const jitter = 0.75 + Math.random() * 0.5; // [0.75, 1.25]
        const delay = Math.min(exponentialDelay * jitter, MAX_DELAY);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Pollinations 重试 ${maxRetries} 次后仍失败：${lastErr?.message || '未知错误'}`);
}

module.exports = { generateImage };
