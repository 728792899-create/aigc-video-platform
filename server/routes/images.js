const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { safeUnlink } = require('../utils/fileCleanup');
const { verifyFileSignature } = require('../utils/fileSignature');
const config = require('../services/config');
const assetNaming = require('../services/assetNaming');

// Ensure uploads/images directory exists（用可写数据目录，桌面应用下指向 %APPDATA%，与图片服务/静态托管一致）
const uploadDir = path.resolve(config.get('uploadDir'), 'images');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const filename = uuidv4() + ext;
    cb(null, filename);
  }
});

// 允许的图片类型白名单
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: function (req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 JPEG/PNG/WebP/GIF 图片格式'));
    }
  }
});

// 获取分镜的所有图片
router.get('/storyboard/:storyboardId', (req, res) => {
  const images = getDb().prepare(
    'SELECT * FROM images WHERE storyboard_id = ? ORDER BY created_at DESC'
  ).all(req.params.storyboardId);
  res.json({ code: 200, data: images, message: 'success' });
});

// 创建图片记录
router.post('/', (req, res) => {
  try {
    const { storyboard_id, prompt, file_path, file_url, submit_id, gen_status } = req.body;
    if (storyboard_id == null || !/^\d+$/.test(String(storyboard_id))) {
      return res.status(400).json({ code: 400, data: null, message: '缺少或非法的 storyboard_id' });
    }
    const result = getDb().prepare(
      `INSERT INTO images (storyboard_id, prompt, file_path, file_url, submit_id, gen_status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(storyboard_id, prompt || '', file_path || '', file_url || '', submit_id || '', gen_status || 'pending');
    try { assetNaming.normalizeImageRecord(result.lastInsertRowid); } catch (e) { console.warn('[assetNaming] 图片记录命名整理失败:', e.message); }
    const image = getDb().prepare('SELECT * FROM images WHERE id = ?').get(result.lastInsertRowid);
    res.json({ code: 200, data: image, message: '创建成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `创建图片记录失败: ${err.message}` });
  }
});

// 更新图片状态（PATCH 语义：只更新传入的字段，未传字段保持原值，避免被 undefined 覆盖成 NULL）
router.put('/:id', (req, res) => {
  try {
    const exist = getDb().prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
    if (!exist) return res.status(404).json({ code: 404, data: null, message: '图片不存在' });
    const { file_path, file_url, gen_status } = req.body;
    getDb().prepare('UPDATE images SET file_path=?, file_url=?, gen_status=? WHERE id=?')
      .run(
        file_path !== undefined ? file_path : exist.file_path,
        file_url !== undefined ? file_url : exist.file_url,
        gen_status !== undefined ? gen_status : exist.gen_status,
        req.params.id
      );
    const image = getDb().prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
    res.json({ code: 200, data: image, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `更新图片失败: ${err.message}` });
  }
});

// 上传图片
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    // 捕获 multer 错误（超大小、类型不符等），返回 400 而非 500/崩溃
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '文件过大，单个图片不能超过 10MB'
        : err.message || '文件上传失败';
      return res.status(400).json({ code: 400, data: null, message: msg });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ code: 400, data: null, message: '未上传文件' });
      }
      // 魔数校验：仅信任客户端 mimetype 不够（可伪造），读文件头核对真实类型，
      // 不符则删除已落盘文件并拒绝（约束文档 §6：上传必须校验魔数）。
      if (!verifyFileSignature(req.file.path, ALLOWED_IMAGE_MIMES)) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        return res.status(400).json({ code: 400, data: null, message: '文件内容与图片格式不符，已拒绝' });
      }
      const { storyboard_id } = req.body;
      if (storyboard_id == null || !/^\d+$/.test(String(storyboard_id))) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        return res.status(400).json({ code: 400, data: null, message: '缺少或非法的 storyboard_id' });
      }
      const storyboard = getDb().prepare('SELECT id FROM storyboards WHERE id = ?').get(storyboard_id);
      if (!storyboard) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        return res.status(404).json({ code: 404, data: null, message: '分镜不存在' });
      }
      // 存相对路径（可移植），避免项目目录迁移后失效
      const file_url = `/uploads/images/${req.file.filename}`;
      const file_path = file_url;

      const result = getDb().prepare(
        `INSERT INTO images (storyboard_id, file_path, file_url, gen_status)
         VALUES (?, ?, ?, ?)`
      ).run(storyboard_id, file_path, file_url, 'success');

      try { assetNaming.normalizeImageRecord(result.lastInsertRowid); } catch (e) { console.warn('[assetNaming] 上传图片命名整理失败:', e.message); }
      const image = getDb().prepare('SELECT * FROM images WHERE id = ?').get(result.lastInsertRowid);
      res.json({ code: 200, data: image, message: '上传成功' });
    } catch (e) {
      res.status(500).json({ code: 500, data: null, message: e.message });
    }
  });
});

// 删除图片（级联删除磁盘文件 + 清理引用，避免悬空 selected_image_id）
router.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const img = getDb().prepare('SELECT file_path, file_url FROM images WHERE id = ?').get(id);
    if (!img) return res.status(404).json({ code: 404, data: null, message: '图片不存在' });
    getDb().prepare('DELETE FROM images WHERE id = ?').run(id);
    // 清理悬空引用：selected_image_id 无 FK，删图后必须手动把指向它的分镜置空，
    // 否则分镜仍“声称”选中一张已不存在的图（缩略图裂、合成被迫兜底、已选态错误）。
    getDb().prepare('UPDATE storyboards SET selected_image_id = NULL WHERE selected_image_id = ?').run(id);
    // 优先用绝对 file_path，回退到 file_url
    safeUnlink(img.file_path || img.file_url);
    res.json({ code: 200, data: null, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, data: null, message: `删除图片失败: ${e.message}` });
  }
});

module.exports = router;
