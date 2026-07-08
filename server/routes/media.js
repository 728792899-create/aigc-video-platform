/**
 * 媒体辅助资源路由（/api/media）
 * - 背景音乐 BGM：内置列表 + 用户上传 + 删除
 * - 合成元数据：画幅比例预设、字幕样式预设
 * 纯增量功能，不影响既有合成流程。
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const config = require('../services/config');
const { safeUnlink, resolveUploadPath } = require('../utils/fileCleanup');
const { verifyFileSignature } = require('../utils/fileSignature');

function bgmDir() {
  const dir = path.resolve(config.get('uploadDir'), 'bgm');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ALLOWED_AUDIO_MIMES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'];
const MAX_BGM_BYTES = 20 * 1024 * 1024; // 20MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, bgmDir()),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `bgm_${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BGM_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_AUDIO_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 MP3/WAV/M4A/AAC 音频格式'));
  },
});

// 列出 BGM（用户上传的全部文件）
router.get('/bgm', (req, res) => {
  try {
    const dir = bgmDir();
    const files = fs.readdirSync(dir)
      .filter(f => /\.(mp3|wav|m4a|aac)$/i.test(f))
      .map(f => {
        const st = fs.statSync(path.join(dir, f));
        return {
          key: f,
          url: `/uploads/bgm/${f}`,
          name: f.replace(/^bgm_[0-9a-f-]+/i, '').replace(/\.[^.]+$/, '') || f,
          size: st.size,
          uploaded_at: st.mtimeMs,
        };
      })
      .sort((a, b) => b.uploaded_at - a.uploaded_at);
    res.json({ code: 200, data: files, message: 'success' });
  } catch (e) {
    res.status(500).json({ code: 500, data: null, message: `读取 BGM 失败: ${e.message}` });
  }
});

// 上传 BGM
router.post('/bgm', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ code: 400, data: null, message: err.message });
    if (!req.file) return res.status(400).json({ code: 400, data: null, message: '未收到文件' });
    // 魔数校验：核对真实文件头，防止伪装成音频的非法文件落盘（约束文档 §6）。
    if (!verifyFileSignature(req.file.path, ALLOWED_AUDIO_MIMES)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(400).json({ code: 400, data: null, message: '文件内容与音频格式不符，已拒绝' });
    }
    res.json({
      code: 200,
      data: { key: req.file.filename, url: `/uploads/bgm/${req.file.filename}`, size: req.file.size },
      message: '上传成功',
    });
  });
});

// 删除 BGM（防穿越：只允许删 bgm 目录内的文件）
router.delete('/bgm/:key', (req, res) => {
  const safe = path.basename(req.params.key);
  const abs = path.join(bgmDir(), safe);
  if (!fs.existsSync(abs)) return res.status(404).json({ code: 404, data: null, message: '文件不存在' });
  safeUnlink(abs);
  res.json({ code: 200, data: { key: safe }, message: '已删除' });
});

// 画幅比例预设
router.get('/ratios', (req, res) => {
  res.json({
    code: 200,
    data: [
      { key: '16:9', label: '横屏 16:9（西瓜/B站）', w: 1920, h: 1080 },
      { key: '9:16', label: '竖屏 9:16（抖音/快手/视频号）', w: 1080, h: 1920 },
      { key: '1:1', label: '方形 1:1（朋友圈/INS）', w: 1080, h: 1080 },
      { key: '4:5', label: '竖图 4:5（小红书）', w: 1080, h: 1350 },
      { key: '4:3', label: '传统 4:3', w: 1440, h: 1080 },
    ],
    message: 'success',
  });
});

// 字幕样式预设
router.get('/subtitle-presets', (req, res) => {
  res.json({
    code: 200,
    data: [
      { key: 'default', label: '默认（白字黑边）', style: { fontSize: 24, fontColor: '#FFFFFF', outlineColor: '#000000', position: 'bottom', bold: 1 } },
      { key: 'highlight', label: '醒目黄字', style: { fontSize: 28, fontColor: '#FFE600', outlineColor: '#000000', position: 'bottom', bold: 1 } },
      { key: 'clean', label: '极简白字', style: { fontSize: 22, fontColor: '#FFFFFF', outlineColor: '#333333', position: 'bottom', bold: 0 } },
      { key: 'top', label: '顶部解说', style: { fontSize: 24, fontColor: '#FFFFFF', outlineColor: '#000000', position: 'top', bold: 0 } },
    ],
    message: 'success',
  });
});

// 运镜（Ken Burns）预设 — 取自 video 路由，前端一键成片下拉用
router.get('/motions', (req, res) => {
  let presets = {};
  try { presets = require('./video').MOTION_PRESETS || {}; } catch {}
  const data = Object.entries(presets).map(([key, v]) => ({
    key, label: v.label, desc: v.desc,
  }));
  res.json({ code: 200, data, message: 'success' });
});

module.exports = router;
