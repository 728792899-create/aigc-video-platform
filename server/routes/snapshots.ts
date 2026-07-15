import express from 'express'
import { getDb, type SqlRow } from '../db'
import { asRecord, errorMessage, parseJsonRecord, sqlText } from './routeSupport'
const router = express.Router();
const { safeUnlinkMany } = require('../utils/fileCleanup');

// 草稿快照 / 版本回溯（功能⑥）
// 快照内容：项目的 script_content + 全部分镜（不含图片二进制，存 selected_image_id 引用）。
// 回滚时用快照里的分镜整体替换当前分镜（事务），脚本内容一并恢复。

// 列出某项目的快照
router.get('/project/:projectId', (req, res) => {
  try {
    const rows = getDb().prepare(
      'SELECT id, project_id, label, created_at FROM snapshots WHERE project_id=? ORDER BY created_at DESC'
    ).all(req.params.projectId);
    // 附带分镜数量（从 snapshot JSON 里数，避免存冗余列）
    const full = getDb().prepare('SELECT id, snapshot FROM snapshots WHERE project_id=?').all(req.params.projectId);
    const countMap = new Map<string, number>();
    for (const f of full) {
      const snapshot = parseJsonRecord(f.snapshot);
      const storyboards = Array.isArray(snapshot.storyboards) ? snapshot.storyboards : [];
      countMap.set(String(f.id), storyboards.length);
    }
    res.json({ code: 200, data: rows.map((row) => ({
      ...row,
      storyboard_count: countMap.get(String(row.id)) || 0,
    })), message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取快照失败: ${errorMessage(err)}` });
  }
});

// 创建快照  body: { label }
router.post('/project/:projectId', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = getDb().prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    const storyboards = getDb().prepare(
      'SELECT * FROM storyboards WHERE project_id=? ORDER BY sort_order ASC'
    ).all(projectId);
    // 同时快照每个分镜关联的图片（含 file_path/file_url），否则回滚会因 FK 级联丢图
    const imgStmt = getDb().prepare('SELECT * FROM images WHERE storyboard_id=?');
    const sbWithImages = storyboards.map((storyboard) => ({
      ...storyboard,
      _images: imgStmt.all(storyboard.id),
    }));
    const snapshot = JSON.stringify({
      script_content: project.script_content,
      style: project.style,
      storyboards: sbWithImages,
    });
    const label = (req.body.label || `快照 ${new Date().toLocaleString('zh-CN')}`).slice(0, 80);
    const r = getDb().prepare(
      'INSERT INTO snapshots (project_id, label, snapshot, created_at) VALUES (?,?,?,?)'
    ).run(projectId, label, snapshot, Date.now());
    res.json({ code: 200, data: { id: r.lastInsertRowid, label, storyboard_count: storyboards.length },
      message: '快照已保存' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `创建快照失败: ${errorMessage(err)}` });
  }
});

// 回滚到指定快照：用快照里的分镜+图片整体替换当前数据 + 恢复脚本（事务，含 id 重映射）
router.post('/:id/restore', (req, res) => {
  try {
    const snap = getDb().prepare('SELECT * FROM snapshots WHERE id=?').get(req.params.id);
    if (!snap) return res.status(404).json({ code: 404, data: null, message: '快照不存在' });
    const data = parseJsonRecord(snap.snapshot);
    if (Object.keys(data).length === 0) {
      return res.status(500).json({ code: 500, data: null, message: '快照数据损坏' });
    }
    const projectId = snap.project_id;
    const sbs = Array.isArray(data.storyboards)
      ? data.storyboards.map(asRecord)
      : [];
    const db = getDb();
    
    // 事务外先收集旧分镜的图生视频文件。注意：audio_url / 图片 file_url 在快照里会被原样还原
    // （磁盘文件共享，不能删），唯独 video_path 不在快照 INSERT 列中 → 还原后必成孤儿 → 安全清理。
    const oldVideos = db.prepare(
      `SELECT video_path FROM storyboards WHERE project_id=? AND video_path IS NOT NULL AND video_path != ''`
    ).all(projectId);
    
    const insertSb = db.prepare(
      `INSERT INTO storyboards
       (project_id, scene_number, description, dialog, duration, sort_order, prompt,
        audio_url, selected_image_id, subtitle_text, subtitle_style, transition, voice, motion)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const insertImg = db.prepare(
      `INSERT INTO images (storyboard_id, prompt, file_path, file_url, submit_id, gen_status, width, height)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    const restore = db.transaction(() => {
      // 删旧分镜会因 FK 级联删旧图片，下面用快照数据整体重建
      db.prepare('DELETE FROM storyboards WHERE project_id=?').run(projectId);
      sbs.forEach((s, idx) => {
        const r = insertSb.run(projectId, s.scene_number || idx + 1, s.description || '', s.dialog || '',
          s.duration || 5, s.sort_order != null ? s.sort_order : idx, s.prompt || '',
          s.audio_url || null, null, s.subtitle_text || null,
          s.subtitle_style || null, s.transition || 'none', s.voice || null, s.motion || null);
        const newSbId = r.lastInsertRowid;
        // 重建该分镜的图片，并把 selected 图片的新 id 回填到 selected_image_id
        let newSelectedId = null;
        const images = Array.isArray(s._images) ? s._images.map(asRecord) : [];
        for (const img of images) {
          const ir = insertImg.run(newSbId, img.prompt || null, img.file_path || null, img.file_url || null,
            img.submit_id || null, img.gen_status || 'pending', img.width || 1024, img.height || 1024);
          if (s.selected_image_id && img.id === s.selected_image_id) newSelectedId = ir.lastInsertRowid;
        }
        if (newSelectedId) db.prepare('UPDATE storyboards SET selected_image_id=? WHERE id=?').run(newSelectedId, newSbId);
      });
      db.prepare('UPDATE projects SET script_content=?, style=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(data.script_content || null, data.style || null, projectId);
    });
    restore();
    // 回滚成功后清理旧的图生视频孤儿文件（快照不含 video_path 列，还原后无行引用这些文件）
    try { safeUnlinkMany(oldVideos.map((video) => sqlText(video.video_path)).filter(Boolean)); } catch (_) { /* 清理失败不阻断回滚结果 */ }
    res.json({ code: 200, data: { project_id: projectId, restored: sbs.length }, message: '已回滚到该快照' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `回滚失败: ${errorMessage(err)}` });
  }
});

// 删除快照
router.delete('/:id', (req, res) => {
  try {
    const snap = getDb().prepare('SELECT id FROM snapshots WHERE id=?').get(req.params.id);
    if (!snap) return res.status(404).json({ code: 404, data: null, message: '快照不存在' });
    getDb().prepare('DELETE FROM snapshots WHERE id=?').run(req.params.id);
    res.json({ code: 200, data: { id: Number(req.params.id) }, message: '已删除' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `删除快照失败: ${errorMessage(err)}` });
  }
});

module.exports = router;
