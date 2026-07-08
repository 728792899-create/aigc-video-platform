/**
 * 即梦AI (Dreamina) 图片生成服务
 * 通过 dreamina CLI 调用即梦AI文生图
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const DREAMINA_PATH = 'C:\\Users\\Administrator\\bin\\dreamina.exe';
const UPLOAD_DIR = path.resolve(config.get('uploadDir'), 'images');

// 确保目录存在
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * 安全执行 dreamina CLI（使用 execFile 避免 shell 注入）
 */
function execDreamina(args) {
  return new Promise((resolve, reject) => {
    console.log('[dreamina] exec args:', JSON.stringify(args));
    execFile(DREAMINA_PATH, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180000,
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('[dreamina] error:', error.message);
        console.error('[dreamina] stderr:', stderr);
        console.error('[dreamina] stdout:', stdout);
        return reject(new Error(`dreamina CLI 失败: ${stderr || stdout || error.message}`));
      }
      console.log('[dreamina] stdout length:', stdout.length);
      resolve(stdout.trim());
    });
  });
}

/**
 * 下载远程图片到本地 uploads 目录
 */
function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(UPLOAD_DIR, filename);
    const file = fs.createWriteStream(filePath);
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(filePath, () => {});
        return downloadImage(res.headers.location, filename).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(filePath, () => {});
        return reject(new Error('下载失败 HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(filePath); });
    });
    request.on('error', (e) => { fs.unlink(filePath, () => {}); reject(e); });
  });
}

/**
 * 调用即梦文生图
 * @param {string} prompt 提示词
 * @param {string} ratio 画幅比例
 * @param {object} options { model_version, resolution_type, poll }
 * @returns {object} { submit_id, status, image_urls[], local_files[] }
 */
async function generateImage(prompt, ratio = '16:9', options = {}) {
  // Windows execFile 对含空格/逗号的 --key=value 参数处理有问题
  // 改用 --key value 分开传递（两个独立 args 元素）
  const args = ['text2image', '--prompt', prompt, '--ratio', ratio, '--poll', String(options.poll || 90)];
  if (options.model_version) args.push('--model_version', options.model_version);
  if (options.resolution_type) args.push('--resolution_type', options.resolution_type);

  const output = await execDreamina(args);

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { raw_output: output, gen_status: 'unknown', image_urls: [], local_files: [] };
  }

  // 提取图片 URL（即梦返回结构兼容多种字段名）
  const imageUrls = extractImageUrls(parsed);

  // 下载到本地
  const localFiles = [];
  for (const url of imageUrls) {
    try {
      const filename = `dreamina_${uuidv4()}.jpeg`;
      const filePath = await downloadImage(url, filename);
      localFiles.push({
        remote_url: url,
        local_path: filePath,
        file_url: `/uploads/images/${filename}`,
      });
    } catch (e) {
      console.error('下载失败:', e.message);
    }
  }

  return {
    submit_id: parsed.submit_id || parsed.id || '',
    gen_status: parsed.status || parsed.gen_status || 'success',
    raw: parsed,
    image_urls: imageUrls,
    local_files: localFiles,
  };
}

/**
 * 从 dreamina 返回的 JSON 中提取图片 URL（兼容多种字段命名）
 */
function extractImageUrls(obj) {
  const urls = [];
  function walk(node) {
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
      // 优先字段名
      const preferred = ['image_urls', 'images', 'urls', 'url', 'image_url'];
      for (const k of preferred) {
        if (node[k]) walk(node[k]);
      }
      // 其他键也递归（防止遗漏）
      for (const k in node) {
        if (!preferred.includes(k)) walk(node[k]);
      }
    }
  }
  walk(obj);
  return [...new Set(urls)];
}

async function queryImageResult(submitId) {
  const args = ['query_result', `--submit_id=${submitId}`];
  const output = await execDreamina(args);
  try {
    return JSON.parse(output);
  } catch {
    return { raw_output: output, gen_status: 'unknown' };
  }
}

/**
 * 检查 dreamina CLI 可用性 + 积分
 */
async function checkCredit() {
  try {
    const out = await execDreamina(['user_credit']);
    return JSON.parse(out);
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = { generateImage, queryImageResult, checkCredit, extractImageUrls };
