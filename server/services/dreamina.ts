/**
 * 即梦AI (Dreamina) 图片生成服务
 * 通过 dreamina CLI 调用即梦AI文生图
 */

import { execFile, type ExecFileException } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import * as config from './config'
import { downloadRemoteMedia } from './remoteMedia'

type JsonObject = Record<string, unknown>
interface DreaminaOptions { poll?: number; model_version?: string; resolution_type?: string }
interface LocalFile { remote_url: string; local_path: string; file_url: string }

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

const DREAMINA_PATH = String(process.env.DREAMINA_CLI_PATH || 'dreamina').trim();
const UPLOAD_DIR = path.resolve(String(config.get('uploadDir')), 'images');

// 确保目录存在
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * 安全执行 dreamina CLI（使用 execFile 避免 shell 注入）
 */
function execDreamina(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    console.log('[dreamina] 执行本机 CLI，参数数量:', args.length);
    execFile(DREAMINA_PATH, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180000,
    }, (error: ExecFileException | null, stdout: string, stderr: string) => {
      if (error) {
        console.error('[dreamina] error:', error.message);
        // stdout/stderr 可能含服务端返回的凭证或签名 URL，只记录脱敏后的摘要。
        console.error('[dreamina] stderr length:', String(stderr || '').length);
        console.error('[dreamina] stdout length:', String(stdout || '').length);
        return reject(new Error(`dreamina CLI 失败（exit=${error.code ?? 'unknown'}，输出已隐藏）`));
      }
      console.log('[dreamina] stdout length:', stdout.length);
      resolve(stdout.trim());
    });
  });
}

/**
 * 下载远程图片到本地 uploads 目录
 */
async function downloadImage(url: string, filename: string): Promise<string> {
  const result = await downloadRemoteMedia(url, {
    destination: path.join(UPLOAD_DIR, filename),
    normalizeExtension: true,
    kind: 'image',
    maxBytes: 50 * 1024 * 1024,
    timeoutMs: 120000,
    idleTimeoutMs: 30000,
  });
  return result.destination;
}

/**
 * 调用即梦文生图
 * @param {string} prompt 提示词
 * @param {string} ratio 画幅比例
 * @param {object} options { model_version, resolution_type, poll }
 * @returns {object} { submit_id, status, image_urls[], local_files[] }
 */
export async function generateImage(prompt: string, ratio = '16:9', options: DreaminaOptions = {}) {
  // Windows execFile 对含空格/逗号的 --key=value 参数处理有问题
  // 改用 --key value 分开传递（两个独立 args 元素）
  const args = ['text2image', '--prompt', prompt, '--ratio', ratio, '--poll', String(options.poll || 90)];
  if (options.model_version) args.push('--model_version', options.model_version);
  if (options.resolution_type) args.push('--resolution_type', options.resolution_type);

  const output = await execDreamina(args);

  let parsed: JsonObject;
  try {
    parsed = asRecord(JSON.parse(output));
  } catch {
    return { parse_error: true, gen_status: 'unknown', image_urls: [], local_files: [] };
  }

  // 提取图片 URL（即梦返回结构兼容多种字段名）
  const imageUrls = extractImageUrls(parsed);

  // 下载到本地
  const localFiles: LocalFile[] = [];
  for (const url of imageUrls) {
    try {
      const filename = `dreamina_${uuidv4()}.media`;
      const filePath = await downloadImage(url, filename);
      localFiles.push({
        remote_url: '',
        local_path: filePath,
        file_url: `/uploads/images/${path.basename(filePath)}`,
      });
    } catch (error: unknown) {
      console.error('下载失败:', error instanceof Error ? error.message : String(error));
    }
  }

  return {
    submit_id: parsed.submit_id || parsed.id || '',
    gen_status: parsed.status || parsed.gen_status || 'success',
    image_urls: localFiles.map((file) => file.file_url),
    local_files: localFiles,
  };
}

/**
 * 从 dreamina 返回的 JSON 中提取图片 URL（兼容多种字段命名）
 */
export function extractImageUrls(obj: unknown): string[] {
  const urls: string[] = [];
  function walk(node: unknown): void {
    if (!node) return;
    if (typeof node === 'string' && /^https?:\/\/.+\.(jpe?g|png|webp)/i.test(node)) {
      urls.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      const record = asRecord(node);
      // 优先字段名
      const preferred = ['image_urls', 'images', 'urls', 'url', 'image_url'];
      for (const k of preferred) {
        if (record[k]) walk(record[k]);
      }
      // 其他键也递归（防止遗漏）
      for (const [key, value] of Object.entries(record)) {
        if (!preferred.includes(key)) walk(value);
      }
    }
  }
  walk(obj);
  return [...new Set(urls)];
}

export async function queryImageResult(submitId: string) {
  const args = ['query_result', `--submit_id=${submitId}`];
  const output = await execDreamina(args);
  try {
    const parsed = asRecord(JSON.parse(output));
    const imageCount = extractImageUrls(parsed).length;
    return {
      submit_id: parsed.submit_id || parsed.id || submitId,
      gen_status: parsed.status || parsed.gen_status || 'unknown',
      image_count: imageCount,
    };
  } catch {
    return { submit_id: submitId, gen_status: 'unknown', parse_error: true };
  }
}

/**
 * 检查 dreamina CLI 可用性 + 积分
 */
export async function checkCredit(): Promise<unknown> {
  try {
    const out = await execDreamina(['user_credit']);
    return JSON.parse(out);
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
