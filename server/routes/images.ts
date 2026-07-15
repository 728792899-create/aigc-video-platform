import express from 'express'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import { getDb, type SqlRow } from '../db'
import { normalizeMediaReference } from '../services/assetDomain'
import { candidateReview } from '../services/candidateReview'
import { asRecord, errorDetails, errorMessage, parseJsonRecord, type JsonRecord, type RouteErrorDetails } from './routeSupport'
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { safeUnlink } = require('../utils/fileCleanup');
const { verifyFileSignature } = require('../utils/fileSignature');
const config = require('../services/config');
const assetNaming = require('../services/assetNaming');

function cleanText(value: unknown, max = 1000): string {
  return String(value || '').trim().slice(0, max);
}

function presentCandidate(value: unknown, selectedId: unknown = null): JsonRecord | null {
  if (!value) return null;
  const row = asRecord(value);
  const inputSnapshot = parseJsonRecord(row.input_snapshot);
  const mediaReference = parseJsonRecord(row.media_reference);
  return {
    ...row,
    favorite: Number(row.favorite) === 1,
    selected: Number(selectedId) === Number(row.id),
    input_snapshot: Object.keys(inputSnapshot).length ? inputSnapshot : null,
    media_reference: Object.keys(mediaReference).length ? mediaReference : null,
  };
}

function writeCandidateMetadata(id: unknown, input: JsonRecord = {}): SqlRow | null {
  const row = getDb().prepare('SELECT * FROM images WHERE id = ?').get(id);
  if (!row) return null;
  let media = row.media_reference || null;
  const url = input.file_url || input.file_path || row.file_url || row.file_path;
  if (!media && url) {
    media = JSON.stringify(normalizeMediaReference({ kind: 'project_media', media_id: id, url }));
  }
  const snapshotInput = asRecord(input.input_snapshot);
  const snapshot = input.input_snapshot
    ? JSON.stringify({ prompt: cleanText(snapshotInput.prompt || input.prompt, 12000) })
    : (row.input_snapshot || JSON.stringify({ prompt: cleanText(input.prompt || row.prompt, 12000) }));
  getDb().prepare(`UPDATE images SET task_id=?, provider=?, model=?, input_snapshot=?, media_reference=?,
    parent_image_id=?, updated_at=? WHERE id=?`).run(
    cleanText(input.task_id || row.task_id, 160),
    cleanText(input.provider || row.provider, 80),
    cleanText(input.model || row.model, 160),
    snapshot,
    media,
    input.parent_image_id == null ? row.parent_image_id : Number(input.parent_image_id),
    Date.now(),
    id,
  );
  return getDb().prepare('SELECT * FROM images WHERE id = ?').get(id) ?? null;
}

function candidateStatus(error: RouteErrorDetails): number {
  if (['CANDIDATE_NOT_FOUND', 'STORYBOARD_NOT_FOUND'].includes(error.code || '')) return 404;
  if (error.code === 'CANDIDATE_IN_USE') return 409;
  return 400;
}

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
  const storyboard = getDb().prepare('SELECT id, selected_image_id FROM storyboards WHERE id = ?').get(req.params.storyboardId);
  if (!storyboard) return res.status(404).json({ code: 404, data: null, message: '分镜不存在' });
  const includeArchived = req.query.include_archived === 'true';
  const images = getDb().prepare(
    `SELECT * FROM images WHERE storyboard_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY created_at DESC, id DESC`
  ).all(req.params.storyboardId).map((row) => presentCandidate(row, storyboard.selected_image_id));
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
    try { assetNaming.normalizeImageRecord(result.lastInsertRowid); } catch (e) { console.warn('[assetNaming] 图片记录命名整理失败:', errorMessage(e)); }
    const image = writeCandidateMetadata(result.lastInsertRowid, asRecord(req.body));
    res.json({ code: 200, data: presentCandidate(image), message: '创建成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `创建图片记录失败: ${errorMessage(err)}` });
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
    const image = writeCandidateMetadata(req.params.id, asRecord(req.body));
    res.json({ code: 200, data: presentCandidate(image), message: '更新成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `更新图片失败: ${errorMessage(err)}` });
  }
});

// 上传图片
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err: unknown) => {
    // 捕获 multer 错误（超大小、类型不符等），返回 400 而非 500/崩溃
    if (err) {
      const details = errorDetails(err);
      const msg = details.code === 'LIMIT_FILE_SIZE'
        ? '文件过大，单个图片不能超过 10MB'
        : errorMessage(err) || '文件上传失败';
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

      try { assetNaming.normalizeImageRecord(result.lastInsertRowid); } catch (e) { console.warn('[assetNaming] 上传图片命名整理失败:', errorMessage(e)); }
      const image = writeCandidateMetadata(result.lastInsertRowid, {
        provider: 'local-upload', model: 'manual', file_url, file_path,
      });
      res.json({ code: 200, data: presentCandidate(image), message: '上传成功' });
    } catch (e) {
      res.status(500).json({ code: 500, data: null, message: errorMessage(e) });
    }
  });
});

// 显式选用 Candidate：只更改稳定 ID 引用，不删除、不覆盖其他候选。
router.post('/:id/select', (req, res) => {
  try {
    const candidate = getDb().prepare('SELECT storyboard_id FROM images WHERE id = ?').get(req.params.id);
    if (!candidate) return res.status(404).json({ code: 404, data: null, message: '候选不存在' });
    const storyboardId = req.body?.storyboard_id || candidate.storyboard_id;
    const selected = candidateReview.select({ storyboardId, candidateId: req.params.id });
    res.json({ code: 200, data: presentCandidate(selected, selected.id), message: '已选用该候选' });
  } catch (error) {
    const details = errorDetails(error);
    const status = candidateStatus(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

// 评审元数据是可逆操作；归档不删文件，并且保护正在使用的候选。
router.put('/:id/review', (req, res) => {
  try {
    const candidate = candidateReview.review(req.params.id, {
      favorite: req.body?.favorite,
      archived: req.body?.archived,
    });
    res.json({ code: 200, data: presentCandidate(candidate), message: '评审状态已保存' });
  } catch (error) {
    const details = errorDetails(error);
    const status = candidateStatus(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

// 物理删除仅用于未被任何领域对象引用的候选；普通评审请用归档。
router.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const img = getDb().prepare('SELECT * FROM images WHERE id = ?').get(id);
    if (!img) return res.status(404).json({ code: 404, data: null, message: '图片不存在' });
    const selectedBy = getDb().prepare('SELECT id FROM storyboards WHERE selected_image_id = ? LIMIT 1').get(id);
    const asset = getDb().prepare('SELECT id FROM character_assets WHERE image_id = ? LIMIT 1').get(id);
    if (selectedBy || asset) {
      return res.status(409).json({
        code: 409,
        data: { error_code: 'CANDIDATE_IN_USE', storyboard_id: selectedBy?.id, asset_variant_id: asset?.id },
        message: '该候选正被分镜或资产 Variant 引用，请先切换选择或重新绑定',
      });
    }
    getDb().prepare('DELETE FROM images WHERE id = ?').run(id);
    // 优先用绝对 file_path，回退到 file_url
    safeUnlink(img.file_path || img.file_url);
    res.json({ code: 200, data: null, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, data: null, message: `删除图片失败: ${errorMessage(e)}` });
  }
});

module.exports = router;
