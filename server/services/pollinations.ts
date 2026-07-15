/**
 * Pollinations.ai 图片生成 provider
 * 免费、无需 API key、CORS 友好，用作默认稳定降级方案
 * 文档：https://pollinations.ai/
 */

import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import * as config from './config'
import { downloadRemoteMedia } from './remoteMedia'

interface PollinationsOptions {
  model?: string
  seed?: number
  negativePrompt?: string
  retries?: number
}

const UPLOAD_DIR = path.resolve(String(config.get('uploadDir')), 'images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 比例 → (width, height) 1280 基线
const RATIO_TO_SIZE: Record<string, readonly [number, number]> = {
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
async function downloadImage(url: string, filename: string, idleMs = 30000, hardMs = 90000): Promise<string> {
  const result = await downloadRemoteMedia(url, {
    destination: path.join(UPLOAD_DIR, filename),
    normalizeExtension: true,
    kind: 'image',
    maxBytes: 50 * 1024 * 1024,
    timeoutMs: hardMs,
    idleTimeoutMs: idleMs,
    headers: {
      'User-Agent': 'AIGC-Video-Studio/1.0',
      Accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8',
    },
  });
  return result.destination;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 生成图片
 * @param {string} prompt
 * @param {string} ratio
 * @param {object} options { model, seed, negativePrompt }
 */
export async function generateImage(prompt: string, ratio = '16:9', options: PollinationsOptions = {}) {
  const [width, height] = RATIO_TO_SIZE[ratio] || [1280, 720];
  const baseSeed = options.seed || Math.floor(Math.random() * 1000000);
  const model = options.model || 'flux'; // flux / flux-realism / turbo / any-dark

  function buildUrl(seed: number): string {
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
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const seed = attempt === 1 ? baseSeed : Math.floor(Math.random() * 1000000);
    const url = buildUrl(seed);
    const filename = `pollinations_${uuidv4()}.media`;
    if (attempt === 1) console.log(`[pollinations] 开始生成：model=${model}, ratio=${ratio}, seed=${seed}`);
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
        image_urls: [`/uploads/images/${path.basename(filePath)}`],
        local_files: [{
          remote_url: '',
          local_path: filePath,
          file_url: `/uploads/images/${path.basename(filePath)}`,
        }],
      };
    } catch (error: unknown) {
      lastError = error;
      console.warn(`[pollinations] 第 ${attempt}/${maxRetries} 次失败：${error instanceof Error ? error.message : String(error)}`);
      if (attempt < maxRetries) {
        // 指数退避：base * 2^(attempt-1)，加 ±25% 抖动，限制上限
        const exponentialDelay = BASE_DELAY * Math.pow(2, attempt - 1);
        const jitter = 0.75 + Math.random() * 0.5; // [0.75, 1.25]
        const delay = Math.min(exponentialDelay * jitter, MAX_DELAY);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Pollinations 重试 ${maxRetries} 次后仍失败：${lastError instanceof Error ? lastError.message : '未知错误'}`);
}
