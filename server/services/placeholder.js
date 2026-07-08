/**
 * 占位图生成服务
 * 当所有图片 provider 都失败时，用 FFmpeg lavfi 生成一张带提示文字的纯色占位图，
 * 保证平台流程（分镜→配图→合成）不因单点失败而中断。
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { resolveFfmpegPath } = require('../utils/ffmpeg');

const FFMPEG = resolveFfmpegPath(config.get('ffmpegPath')).path;
const UPLOAD_DIR = path.resolve(config.get('uploadDir'), 'images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const RATIO_TO_SIZE = {
  '21:9': [1680, 720], '16:9': [1280, 720], '3:2': [1200, 800],
  '4:3': [1024, 768], '1:1': [1024, 1024], '3:4': [768, 1024],
  '2:3': [800, 1200], '9:16': [720, 1280],
};

// 找一个可用的中文字体（Windows 自带），用于 drawtext 渲染中文提示。
// 找不到则返回 null → 退化为英文提示（ffmpeg 内置字体仅 ASCII）。
function resolveCjkFont() {
  const winDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = ['msyh.ttc', 'msyhbd.ttc', 'simhei.ttf', 'simsun.ttc', 'simkai.ttf'];
  for (const f of candidates) {
    const p = path.join(winDir, 'Fonts', f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 把 Windows 路径转成 ffmpeg drawtext fontfile 需要的转义形式：盘符冒号要转义 C\:/...
function ffmpegFontPath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
}

/**
 * 生成占位图。失败时不抛错（兜底里再兜底没意义），返回 null。
 * @param {string} ratio 画面比例
 * @returns {Promise<{local_path,file_url,filename}|null>}
 */
function generatePlaceholder(ratio = '16:9') {
  return new Promise((resolve) => {
    const [w, h] = RATIO_TO_SIZE[ratio] || [1280, 720];
    const filename = `placeholder_${uuidv4()}.png`;
    const filePath = path.join(UPLOAD_DIR, filename);

    const cjkFont = resolveCjkFont();
    // 有中文字体 → 中文提示；否则退化英文（ffmpeg 内置字体仅 ASCII，中文会乱码）
    const fontExpr = cjkFont ? `fontfile='${ffmpegFontPath(cjkFont)}':` : '';
    const line1 = cjkFont ? '图片暂未生成' : 'Image not generated';
    const line2 = cjkFont ? '请检查网络后重新生成' : 'check network and retry';

    const vf = `drawtext=${fontExpr}text='${line1}':` +
      `fontcolor=white:fontsize=${Math.round(w / 22)}:` +
      `x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(h / 28)},` +
      `drawtext=${fontExpr}text='${line2}':` +
      `fontcolor=0x9aa0b4:fontsize=${Math.round(w / 38)}:` +
      `x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(h / 28)}`;
    const args = [
      '-y', '-f', 'lavfi',
      '-i', `color=c=0x2b2b3d:s=${w}x${h}`,
      '-vf', vf,
      '-frames:v', '1', filePath,
    ];
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => {
      console.error('[placeholder] ffmpeg 启动失败:', e.message);
      resolve(null);
    });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        resolve({
          local_path: filePath,
          file_url: `/uploads/images/${filename}`,
          filename,
        });
      } else {
        // drawtext 可能因缺字体失败，退化为无文字纯色图
        console.warn('[placeholder] 带文字生成失败，尝试纯色兜底。code=', code);
        const proc2 = spawn(FFMPEG, [
          '-y', '-f', 'lavfi', '-i', `color=c=0x2b2b3d:s=${w}x${h}`,
          '-frames:v', '1', filePath,
        ], { windowsHide: true });
        proc2.on('error', () => resolve(null));
        proc2.on('close', (c2) => {
          if (c2 === 0 && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
            resolve({ local_path: filePath, file_url: `/uploads/images/${filename}`, filename });
          } else {
            resolve(null);
          }
        });
      }
    });
  });
}

module.exports = { generatePlaceholder };
