const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { safeUnlink, safeUnlinkMany, resolveUploadPath } = require('../utils/fileCleanup');
const { probeDuration } = require('../utils/mediaProbe');
const config = require('../services/config');
const opLog = require('../services/opLog');
const continuity = require('../services/continuity');

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function syncChaptersFromStoryboards(projectId, storyboards = [], durationMeta = {}) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId);
    const groups = new Map();
    storyboards.forEach((item, index) => {
      const chapterIndex = Number(item.chapter_index || item.chapter || 1) || 1;
      if (!groups.has(chapterIndex)) {
        groups.set(chapterIndex, {
          chapter_index: chapterIndex,
          title: item.chapter_title || `第 ${chapterIndex} 章`,
          target_duration_sec: 0,
          count: 0,
        });
      }
      const group = groups.get(chapterIndex);
      group.target_duration_sec += Number(item.duration) || 5;
      group.count += 1;
      if (!group.title && item.chapter_title) group.title = item.chapter_title;
    });
    const insert = db.prepare(
      `INSERT INTO chapters (project_id, chapter_index, title, summary, target_duration_sec, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    [...groups.values()]
      .sort((a, b) => a.chapter_index - b.chapter_index)
      .forEach((chapter) => {
        insert.run(projectId, chapter.chapter_index, chapter.title || `第 ${chapter.chapter_index} 章`,
          `${chapter.count} 个分镜`, Math.round(chapter.target_duration_sec), 'draft');
    });
    const totalSec = storyboards.reduce((sum, item) => sum + (Number(item.duration) || 5), 0);
    const min = finitePositive(durationMeta.duration_min);
    const max = finitePositive(durationMeta.duration_max);
    const requestedTarget = finitePositive(durationMeta.targetDurationSec ?? durationMeta.target_duration_sec);
    const targetSec = requestedTarget || totalSec;
    const longMode = targetSec >= 600 || totalSec >= 600 || (min != null && max != null && min <= 600 && max >= 600);
    if (min != null && max != null && max >= min) {
      db.prepare('UPDATE projects SET duration_min = ?, duration_max = ?, long_video_mode = ?, target_duration_sec = ? WHERE id = ?')
        .run(Math.round(min), Math.round(max), longMode ? 1 : 0, Math.round(targetSec), projectId);
    } else {
      db.prepare('UPDATE projects SET long_video_mode = ?, target_duration_sec = ? WHERE id = ?')
        .run(longMode ? 1 : 0, Math.round(targetSec), projectId);
    }
  } catch (e) {
    console.warn('[chapters] 同步章节失败:', e.message);
  }
}

// 获取项目的所有分镜（含选中图片的 file_url，避免前端 N+1 请求）
router.get('/project/:projectId', (req, res) => {
  const storyboards = getDb().prepare(
    `SELECT s.*, i.file_url AS selected_image_url
     FROM storyboards s
     LEFT JOIN images i ON s.selected_image_id = i.id
     WHERE s.project_id = ? ORDER BY s.sort_order ASC`
  ).all(req.params.projectId);
  // v1.6.8：拼接 video_path → videoUrl，供预览页播放真实动效视频
  storyboards.forEach((sb) => {
    sb.videoUrl = sb.video_path || null;
  });
  res.json({ code: 200, data: storyboards, message: 'success' });
});

// 获取单个分镜
router.get('/:id', (req, res) => {
  const sb = getDb().prepare('SELECT * FROM storyboards WHERE id = ?').get(req.params.id);
  if (!sb) return res.status(404).json({ code: 404, data: null, message: '分镜不存在' });
  res.json({ code: 200, data: sb, message: 'success' });
});

// 批量创建/替换分镜（AI生成后使用）
router.post('/batch', (req, res) => {
  const { project_id, storyboards, visual_anchor, script_result, duration_min, duration_max, targetDurationSec, target_duration_sec } = req.body;
  if (!project_id || !storyboards) {
    return res.status(400).json({ code: 400, data: null, message: '参数不完整' });
  }
  
  // 事务外先收集旧分镜的 audio/video 文件，批量替换后清理（AI 重新生成脚本后旧文件必成孤儿）
  const oldFiles = getDb().prepare(
    'SELECT audio_url, video_path FROM storyboards WHERE project_id=?'
  ).all(project_id);
  
  // 事务包裹：删除旧分镜 + 批量插入（原子操作，失败时全部回滚）
  const insert = getDb().prepare(
    `INSERT INTO storyboards (project_id, scene_number, description, dialog, duration, sort_order, prompt, chapter_index, chapter_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batchReplace = getDb().transaction((items) => {
    getDb().prepare('DELETE FROM storyboards WHERE project_id = ?').run(project_id);
    items.forEach((item, index) => {
      insert.run(project_id, item.scene_number || index + 1, item.description || '',
        item.dialog || '', item.duration || 5, index, item.prompt || '',
        item.chapter_index || item.chapter || 1, item.chapter_title || '');
    });
  });
  batchReplace(storyboards);
  syncChaptersFromStoryboards(project_id, storyboards, { duration_min, duration_max, targetDurationSec, target_duration_sec });
  
  // 替换成功后清理旧分镜的孤儿文件（audio + video）
  try {
    safeUnlinkMany([...oldFiles.map(f => f.audio_url), ...oldFiles.map(f => f.video_path)].filter(Boolean));
  } catch (_) { /* 清理失败不阻断分镜保存 */ }
  // v1.6.5 画风一致性：保存全局视觉设定 + 确保项目有基准 seed（缺则生成一次），
  // 让手动编辑脚本后逐镜配图也能保持画风连贯。
  try {
    const proj = getDb().prepare('SELECT visual_anchor, image_seed FROM projects WHERE id = ?').get(project_id);
    const anchor = visual_anchor !== undefined ? String(visual_anchor || '').trim() : (proj?.visual_anchor || '');
    const seed = (proj?.image_seed != null) ? proj.image_seed : Math.floor(Math.random() * 2147483647);
    getDb().prepare('UPDATE projects SET visual_anchor = ?, image_seed = ? WHERE id = ?').run(anchor, seed, project_id);
    if (script_result) {
      getDb().prepare('UPDATE projects SET script_content = ?, continuity_status = ? WHERE id = ?')
        .run(JSON.stringify(script_result), 'script_saved', project_id);
    }
    continuity.ensureSeriesForProject(project_id);
    continuity.extractCharacters(project_id, { script: script_result || null });
    continuity.saveStoryboardBindings(project_id, storyboards);
  } catch { /* 非致命 */ }
  const result = getDb().prepare('SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC').all(project_id);
  opLog.log('storyboard.create', 'project', project_id, { count: result.length });
  res.json({ code: 200, data: result, message: '保存成功' });
});

// 增量对齐脚本改稿：只让描述/对白发生变化的分镜失效，未变化镜头保留已有图、音与视频。
router.post('/reconcile', (req, res) => {
  try {
    const {
      project_id, storyboards, visual_anchor, script_result,
      duration_min, duration_max, targetDurationSec, target_duration_sec,
    } = req.body || {};
    if (!project_id || !Array.isArray(storyboards)) {
      return res.status(400).json({ code: 400, data: null, message: '参数不完整' });
    }
    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(project_id);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });

    const current = db.prepare(
      'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(project_id);
    const byId = new Map(current.map((item) => [Number(item.id), item]));
    const byScene = new Map();
    for (const item of current) {
      const key = Number(item.scene_number);
      if (!byScene.has(key)) byScene.set(key, []);
      byScene.get(key).push(item);
    }
    const usedIds = new Set();
    const cleanupFiles = [];
    const changedIds = [];
    const createdIds = [];
    const preservedIds = [];
    const removedIds = [];
    const normalizeContent = (value) => String(value ?? '').trim();
    const asJson = (value, fallback = '[]') => {
      if (value === undefined) return fallback;
      return typeof value === 'string' ? value : JSON.stringify(value || []);
    };

    const reconcileRows = db.transaction((incoming) => {
      const insert = db.prepare(
        `INSERT INTO storyboards
          (project_id, scene_number, description, dialog, duration, sort_order, prompt,
           subtitle_text, transition, voice, no_voice, chapter_index, chapter_title,
           characters_in_scene, continuity_notes, scene_state_before, scene_state_after,
           sync_status, quality_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const update = db.prepare(
        `UPDATE storyboards SET
          scene_number=?, description=?, dialog=?, duration=?, sort_order=?, prompt=?,
          subtitle_text=?, subtitle_style=?, transition=?, voice=?, motion=?, no_voice=?,
          chapter_index=?, chapter_title=?, characters_in_scene=?, continuity_notes=?,
          scene_state_before=?, scene_state_after=?, selected_image_id=?, audio_url=?,
          audio_words=?, video_path=?, sync_status=?, quality_status=?
         WHERE id=?`
      );

      incoming.forEach((raw, index) => {
        const item = raw || {};
        const sceneNumber = Number(item.scene_number) || index + 1;
        let existing = null;
        if (item.id != null) {
          existing = byId.get(Number(item.id));
          if (!existing) throw new Error(`分镜 ${item.id} 不属于当前项目`);
          if (usedIds.has(Number(existing.id))) throw new Error(`分镜 ${item.id} 重复提交`);
        } else {
          existing = (byScene.get(sceneNumber) || []).find((row) => !usedIds.has(Number(row.id))) || null;
        }

        if (!existing) {
          const created = insert.run(
            project_id,
            sceneNumber,
            item.description || '',
            item.dialog || '',
            Number(item.duration) || 5,
            index,
            item.prompt || item.description || '',
            item.subtitle_text ?? item.dialog ?? '',
            item.transition || 'none',
            item.voice || null,
            item.no_voice ? 1 : 0,
            Number(item.chapter_index || item.chapter || 1) || 1,
            item.chapter_title || '',
            asJson(item.characters_in_scene),
            item.continuity_notes || '',
            item.scene_state_before || '',
            item.scene_state_after || '',
            'pending',
            'unchecked'
          );
          createdIds.push(Number(created.lastInsertRowid));
          return;
        }

        const id = Number(existing.id);
        usedIds.add(id);
        const contentChanged =
          normalizeContent(item.description ?? existing.description) !== normalizeContent(existing.description) ||
          normalizeContent(item.dialog ?? existing.dialog) !== normalizeContent(existing.dialog);

        if (contentChanged) {
          const images = db.prepare('SELECT file_path, file_url FROM images WHERE storyboard_id = ?').all(id);
          cleanupFiles.push(existing.audio_url, existing.video_path,
            ...images.map((image) => image.file_path || image.file_url));
          // selected_image_id 没有外键，必须显式清空；随后删除该镜头旧图片记录。
          db.prepare('DELETE FROM images WHERE storyboard_id = ?').run(id);
          changedIds.push(id);
        } else {
          preservedIds.push(id);
        }

        const description = item.description !== undefined ? item.description : existing.description;
        const dialog = item.dialog !== undefined ? item.dialog : existing.dialog;
        const prompt = item.prompt !== undefined
          ? item.prompt
          : (contentChanged ? (description || '') : existing.prompt);
        const subtitleText = item.subtitle_text !== undefined
          ? item.subtitle_text
          : (contentChanged ? (dialog || '') : existing.subtitle_text);
        update.run(
          sceneNumber,
          description || '',
          dialog || '',
          Number(item.duration ?? existing.duration) || 5,
          index,
          prompt || '',
          subtitleText,
          item.subtitle_style !== undefined
            ? (typeof item.subtitle_style === 'string' ? item.subtitle_style : JSON.stringify(item.subtitle_style))
            : existing.subtitle_style,
          item.transition !== undefined ? item.transition : existing.transition,
          item.voice !== undefined ? item.voice : existing.voice,
          item.motion !== undefined ? item.motion : existing.motion,
          item.no_voice !== undefined ? (item.no_voice ? 1 : 0) : existing.no_voice,
          Number(item.chapter_index ?? item.chapter ?? existing.chapter_index ?? 1) || 1,
          item.chapter_title !== undefined ? item.chapter_title : existing.chapter_title,
          asJson(item.characters_in_scene, existing.characters_in_scene || '[]'),
          item.continuity_notes !== undefined ? item.continuity_notes : existing.continuity_notes,
          item.scene_state_before !== undefined ? item.scene_state_before : existing.scene_state_before,
          item.scene_state_after !== undefined ? item.scene_state_after : existing.scene_state_after,
          contentChanged ? null : existing.selected_image_id,
          contentChanged ? null : existing.audio_url,
          contentChanged ? null : existing.audio_words,
          contentChanged ? null : existing.video_path,
          contentChanged ? 'pending' : (existing.sync_status || 'synced'),
          contentChanged ? 'unchecked' : (existing.quality_status || 'unchecked'),
          id
        );
      });

      for (const existing of current) {
        const id = Number(existing.id);
        if (usedIds.has(id)) continue;
        const images = db.prepare('SELECT file_path, file_url FROM images WHERE storyboard_id = ?').all(id);
        cleanupFiles.push(existing.audio_url, existing.video_path,
          ...images.map((image) => image.file_path || image.file_url));
        db.prepare('DELETE FROM storyboards WHERE id = ?').run(id);
        removedIds.push(id);
      }
    });
    reconcileRows(storyboards);

    // DB 事务成功并持久化后再删物理文件；事务失败时不会误删仍被引用的素材。
    const cleanedFiles = safeUnlinkMany(cleanupFiles.filter(Boolean));
    const result = db.prepare(
      'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(project_id);
    syncChaptersFromStoryboards(project_id, result, {
      duration_min, duration_max, targetDurationSec, target_duration_sec,
    });

    try {
      const anchor = visual_anchor !== undefined
        ? String(visual_anchor || '').trim()
        : (project.visual_anchor || '');
      const seed = project.image_seed != null ? project.image_seed : Math.floor(Math.random() * 2147483647);
      db.prepare('UPDATE projects SET visual_anchor = ?, image_seed = ? WHERE id = ?')
        .run(anchor, seed, project_id);
      if (script_result) {
        db.prepare('UPDATE projects SET script_content = ?, continuity_status = ? WHERE id = ?')
          .run(JSON.stringify(script_result), 'script_saved', project_id);
      }
      continuity.ensureSeriesForProject(project_id);
      continuity.extractCharacters(project_id, { script: script_result || null });
      continuity.saveStoryboardBindings(project_id, result);
    } catch (_) { /* 连续性辅助失败不影响脚本保存 */ }

    const regenerateIds = [...changedIds, ...createdIds];
    opLog.log('storyboard.reconcile', 'project', project_id, {
      changed: changedIds.length,
      created: createdIds.length,
      removed: removedIds.length,
      preserved: preservedIds.length,
    });
    res.json({
      code: 200,
      data: {
        storyboards: result,
        regenerate_ids: regenerateIds,
        changed_ids: changedIds,
        created_ids: createdIds,
        removed_ids: removedIds,
        preserved_ids: preservedIds,
        cleaned_files: cleanedFiles,
      },
      message: regenerateIds.length
        ? `保存成功，${regenerateIds.length} 个分镜需要重生成素材`
        : '保存成功，现有素材均已保留',
    });
  } catch (err) {
    const status = /不属于当前项目|重复提交/.test(err.message) ? 400 : 500;
    res.status(status).json({ code: status, data: null, message: `增量保存失败: ${err.message}` });
  }
});

// 更新单个分镜（支持部分字段更新，未提供的字段保留原值）
router.put('/:id', (req, res) => {
  const id = req.params.id;
  const cur = getDb().prepare('SELECT * FROM storyboards WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ code: 404, data: null, message: '分镜不存在' });

  const merged = {
    description: req.body.description !== undefined ? req.body.description : cur.description,
    dialog: req.body.dialog !== undefined ? req.body.dialog : cur.dialog,
    duration: req.body.duration !== undefined ? req.body.duration : cur.duration,
    sort_order: req.body.sort_order !== undefined ? req.body.sort_order : cur.sort_order,
    prompt: req.body.prompt !== undefined ? req.body.prompt : cur.prompt,
    selected_image_id: req.body.selected_image_id !== undefined ? req.body.selected_image_id : cur.selected_image_id,
    subtitle_text: req.body.subtitle_text !== undefined ? req.body.subtitle_text : cur.subtitle_text,
    subtitle_style: req.body.subtitle_style !== undefined ? req.body.subtitle_style : cur.subtitle_style,
    transition: req.body.transition !== undefined ? req.body.transition : cur.transition,
    voice: req.body.voice !== undefined ? req.body.voice : cur.voice,
    motion: req.body.motion !== undefined ? req.body.motion : cur.motion,
    no_voice: req.body.no_voice !== undefined ? (req.body.no_voice ? 1 : 0) : cur.no_voice,
    chapter_index: req.body.chapter_index !== undefined ? req.body.chapter_index : cur.chapter_index,
    chapter_title: req.body.chapter_title !== undefined ? req.body.chapter_title : cur.chapter_title,
    characters_in_scene: req.body.characters_in_scene !== undefined ? req.body.characters_in_scene : cur.characters_in_scene,
    continuity_notes: req.body.continuity_notes !== undefined ? req.body.continuity_notes : cur.continuity_notes,
    scene_state_before: req.body.scene_state_before !== undefined ? req.body.scene_state_before : cur.scene_state_before,
    scene_state_after: req.body.scene_state_after !== undefined ? req.body.scene_state_after : cur.scene_state_after,
  };

  getDb().prepare(`UPDATE storyboards SET description=?, dialog=?, duration=?, sort_order=?, 
    prompt=?, selected_image_id=?, subtitle_text=?, subtitle_style=?, transition=?, voice=?, motion=?, no_voice=?,
    chapter_index=?, chapter_title=?,
    characters_in_scene=?, continuity_notes=?, scene_state_before=?, scene_state_after=? WHERE id=?`
  ).run(
    merged.description, merged.dialog, merged.duration, merged.sort_order,
    merged.prompt, merged.selected_image_id,
    merged.subtitle_text, merged.subtitle_style, merged.transition, merged.voice, merged.motion, merged.no_voice,
    merged.chapter_index, merged.chapter_title,
    typeof merged.characters_in_scene === 'string' ? merged.characters_in_scene : JSON.stringify(merged.characters_in_scene || []),
    merged.continuity_notes, merged.scene_state_before, merged.scene_state_after,
    id
  );
  const sb = getDb().prepare('SELECT * FROM storyboards WHERE id = ?').get(id);
  res.json({ code: 200, data: sb, message: '更新成功' });
});

// 更新排序
router.put('/reorder/:projectId', (req, res) => {
  const { orders } = req.body; // [{id, sort_order}]
  const update = getDb().prepare('UPDATE storyboards SET sort_order = ? WHERE id = ?');
  const reorder = getDb().transaction((items) => {
    items.forEach(item => update.run(item.sort_order, item.id));
  });
  reorder(orders);
  res.json({ code: 200, data: null, message: '排序更新成功' });
});

// 删除分镜（级联删除关联图片记录 + 磁盘文件）
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  const sb = getDb().prepare('SELECT audio_url, video_path FROM storyboards WHERE id = ?').get(id);
  if (!sb) return res.status(404).json({ code: 404, data: null, message: '分镜不存在' });

  // 先收集关联图片的文件路径（DB 行会因 ON DELETE CASCADE 自动删除，但磁盘文件不会）
  const imgs = getDb().prepare('SELECT file_path, file_url FROM images WHERE storyboard_id = ?').all(id);

  getDb().prepare('DELETE FROM storyboards WHERE id = ?').run(id);

  // 清理磁盘：分镜音频 + AI 视频 + 所有关联图片
  safeUnlink(sb.audio_url);
  safeUnlink(sb.video_path); // v1.6.8 清理图生视频
  safeUnlinkMany(imgs.map(i => i.file_path || i.file_url));

  opLog.log('storyboard.delete', 'storyboard', id, null);
  res.json({ code: 200, data: null, message: '删除成功' });
});

// ============ 批量操作（功能③）============

// 批量套用字段到多个分镜：批量设置运镜 / 转场 / 音色 / 字幕样式
// body: { ids: [1,2,3], patch: { motion?, transition?, voice?, subtitle_style? } }
router.post('/batch-update', (req, res) => {
  try {
    const { ids, patch: fields } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '请选择分镜' });
    }
    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ code: 400, data: null, message: '缺少更新字段' });
    }
    const allowed = ['motion', 'transition', 'voice', 'subtitle_style', 'duration'];
    const cols = Object.keys(fields).filter(k => allowed.includes(k));
    if (cols.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '无可更新字段' });
    }
    const setSql = cols.map(c => `${c}=?`).join(', ');
    const stmt = getDb().prepare(`UPDATE storyboards SET ${setSql} WHERE id=?`);
    const run = getDb().transaction((idList) => {
      for (const id of idList) {
        const vals = cols.map(c => {
          const v = fields[c];
          return (c === 'subtitle_style' && typeof v === 'object') ? JSON.stringify(v) : v;
        });
        stmt.run(...vals, id);
      }
    });
    run(ids);
    res.json({ code: 200, data: { updated: ids.length, fields: cols }, message: `已批量更新 ${ids.length} 个分镜` });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `批量更新失败: ${err.message}` });
  }
});

// ============ 智能时长建议（功能④）============

// 优先用「已生成配音的真实时长」(ffprobe) 校准画面时长；无配音的分镜才回退到字数估算。
// 这样画面与音频严格对齐，彻底解决「画面比音频长、配音被截断/重复」的问题。
// 字数估算基准：中文播报约 4.5 字/秒（240 字/分），按语速倍率缩放。
// 镜头呼吸：有配音留 0.4s 尾镜，无配音留 0.8s。
router.get('/suggest-duration/:projectId', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const apply = req.query.apply === 'true';
    const baseSpeed = Number(req.query.speed) || 1.0; // 语速倍率
    const CHARS_PER_SEC = 4.5;
    // v1.6.5：尾镜留白与实际合成(video.js)共用 config.pacing，保证"建议时长"=渲染时长，
    // 不再出现建议 0.4s 但渲染 0.3s 的口径不一致。紧凑节奏默认 0.12s。
    const pacing = config.get('pacing') || {};
    const AUDIO_TAIL = pacing.tightPace === false
      ? (Number(pacing.standardTail) || 0.3)
      : (Number(pacing.tightTail) || 0.12);
    const NO_VOICE_TAIL = Number(pacing.noVoiceTail) || 0.6; // 无配音分镜尾镜留白
    const storyboards = getDb().prepare(
      'SELECT * FROM storyboards WHERE project_id=? ORDER BY sort_order ASC'
    ).all(projectId);
    const suggestions = [];
    for (const sb of storyboards) {
      let sec = null;
      let basis = 'text';
      // ① 优先：有配音且非「不读」→ 用音频真实时长 + 尾镜
      if (sb.audio_url && !sb.no_voice) {
        const abs = resolveUploadPath(sb.audio_url);
        if (abs && fs.existsSync(abs)) {
          const real = await probeDuration(abs);
          if (real && real > 0) { sec = real + AUDIO_TAIL; basis = 'audio'; }
        }
      }
      // ② 回退：按台词字数 × 语速估算
      if (sec == null) {
        const text = (sb.dialog || sb.subtitle_text || '').replace(/\s/g, '');
        const charCount = text.length;
        sec = charCount > 0 ? charCount / (CHARS_PER_SEC * baseSpeed) + NO_VOICE_TAIL : (sb.duration || 5);
      }
      sec = Math.round(Math.min(60, Math.max(2, sec)) * 10) / 10; // 2~60s，保留 1 位小数
      const text = (sb.dialog || sb.subtitle_text || '').replace(/\s/g, '');
      suggestions.push({ id: sb.id, scene_number: sb.scene_number, char_count: text.length, current: sb.duration, suggested: sec, basis });
    }
    if (apply) {
      const upd = getDb().prepare('UPDATE storyboards SET duration=? WHERE id=?');
      const run = getDb().transaction((list) => { for (const s of list) upd.run(s.suggested, s.id); });
      run(suggestions);
    }
    res.json({ code: 200, data: { suggestions, applied: apply }, message: apply ? '已套用建议时长' : 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `时长建议失败: ${err.message}` });
  }
});

module.exports = router;
