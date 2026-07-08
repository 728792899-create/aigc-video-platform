const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const subtitle = require('../services/subtitle');
const timelineService = require('../services/timeline');

/**
 * 直接下载项目 SRT 字幕文件（attachment）
 * GET /api/subtitle/project/:projectId/download
 */
router.get('/project/:projectId/download', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const project = getDb().prepare('SELECT name FROM projects WHERE id=?').get(projectId);
    const storyboards = getDb().prepare(
      'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(projectId);
    if (!storyboards || storyboards.length === 0) {
      return res.status(404).json({ code: 404, data: null, message: '项目无分镜' });
    }
    const timeline = await timelineService.buildProjectTimeline(projectId);
    const result = subtitle.generateSrt(storyboards, projectId, { timeline });
    const safeName = (project?.name || `project_${projectId}`).replace(/[\\/:*?"<>|]/g, '_');
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="subtitle_${projectId}.srt"; filename*=UTF-8''${encodeURIComponent(safeName)}.srt`);
    res.send(result.content || '');
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `下载 SRT 失败: ${err.message}` });
  }
});

/**
 * 为整个项目生成 SRT 文件
 * GET /api/subtitle/project/:projectId/srt
 */
router.get('/project/:projectId/srt', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const storyboards = getDb().prepare(
      'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(projectId);
    if (!storyboards || storyboards.length === 0) {
      return res.status(404).json({ code: 404, data: null, message: '项目无分镜' });
    }
    const timeline = await timelineService.buildProjectTimeline(projectId, {
      videoSpeed: req.query.videoSpeed || req.query.video_speed,
    });
    const result = subtitle.generateSrt(storyboards, projectId, { timeline });
    res.json({ code: 200, data: result, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `生成 SRT 失败: ${err.message}` });
  }
});

/**
 * 更新分镜的字幕文本
 * PUT /api/subtitle/storyboard/:id
 * body: { subtitle_text, subtitle_style }
 */
router.put('/storyboard/:id', (req, res) => {
  try {
    const { subtitle_text, subtitle_style } = req.body;
    const styleStr = typeof subtitle_style === 'object' ? JSON.stringify(subtitle_style) : subtitle_style;
    getDb().prepare('UPDATE storyboards SET subtitle_text=?, subtitle_style=? WHERE id=?')
      .run(subtitle_text || null, styleStr || null, req.params.id);
    const sb = getDb().prepare('SELECT * FROM storyboards WHERE id=?').get(req.params.id);
    res.json({ code: 200, data: sb, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

/**
 * 批量自动填充字幕（从 dialog 复制到 subtitle_text）
 * POST /api/subtitle/auto-fill/:projectId
 */
router.post('/auto-fill/:projectId', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const storyboards = getDb().prepare(
      'SELECT * FROM storyboards WHERE project_id=? ORDER BY sort_order ASC'
    ).all(projectId);

    let updatedCount = 0;
    for (const sb of storyboards) {
      if (sb.dialog && !sb.subtitle_text) {
        getDb().prepare('UPDATE storyboards SET subtitle_text=? WHERE id=?')
          .run(sb.dialog, sb.id);
        updatedCount++;
      }
    }

    res.json({ code: 200, data: { updated_count: updatedCount, total: storyboards.length }, message: '自动填充成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

/**
 * 获取项目字幕预览（不写文件，仅返回内容）
 * GET /api/subtitle/project/:projectId/preview
 */
router.get('/project/:projectId/preview', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const storyboards = getDb().prepare(
      'SELECT * FROM storyboards WHERE project_id=? ORDER BY sort_order ASC'
    ).all(projectId);

    const timeline = await timelineService.buildProjectTimeline(projectId, {
      videoSpeed: req.query.videoSpeed || req.query.video_speed,
    });
    const sceneMap = timelineService.sceneMap(timeline);
    let index = 1;
    const lines = [];
    for (const sb of storyboards) {
      const text = sb.subtitle_text || sb.dialog || '';
      const scene = sceneMap.get(Number(sb.id));
      const currentTime = scene ? scene.start_ms / 1000 : 0;
      const duration = scene ? scene.duration_ms / 1000 : (sb.duration || 5);
      if (text.trim()) {
        lines.push({
          index: index++,
          start: currentTime,
          end: currentTime + duration,
          start_text: subtitle.secondsToSrt(currentTime),
          end_text: subtitle.secondsToSrt(currentTime + duration),
          text: text.trim(),
          storyboard_id: sb.id,
        });
      }
    }

    res.json({ code: 200, data: { entries: lines, total_duration: timeline.total_duration }, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

module.exports = router;
