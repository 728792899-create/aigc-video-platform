const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { safeUnlinkMany } = require('../utils/fileCleanup');
const trash = require('../services/trash');
const opLog = require('../services/opLog');
const assetHealth = require('../services/assetHealth');
const { attachTimeMs } = require('../utils/time');
const timelineService = require('../services/timeline');
const continuity = require('../services/continuity');
const workbench = require('../services/workbench');
const taskManager = require('../services/taskManager');

// 计算项目封面 URL（方案 D 智能复用）：
//   1) 优先用显式设置的 cover（方案 A 渐变占位由前端兜底，方案 B AI 生成图写入此字段）
//   2) 否则回退到该项目第 1 个分镜已选中的图片（项目一旦配过图，封面=真实内容）
//   3) 都没有则返回 null，前端用名称哈希渐变色卡兜底
function resolveCoverUrl(project) {
  if (!project) return null;
  if (project.cover) return project.cover;
  try {
    const row = getDb().prepare(
      `SELECT i.file_url FROM storyboards s
       JOIN images i ON i.id = s.selected_image_id
       WHERE s.project_id = ? AND i.file_url IS NOT NULL AND i.file_url != ''
       ORDER BY s.sort_order ASC, s.scene_number ASC, s.id ASC
       LIMIT 1`
    ).get(project.id);
    if (row && row.file_url) return row.file_url;
  } catch (_) { /* 表未就绪或无图，忽略 */ }
  return null;
}

function enrichProject(project, includeHealth = true) {
  if (!project) return project;
  const enriched = attachTimeMs(project);
  enriched.raw_status = project.status;
  enriched.cover_url = resolveCoverUrl(enriched);
  try {
    continuity.ensureSeriesForProject(enriched.id);
    const fresh = getDb().prepare('SELECT series_id, episode_index, parent_project_id, continuation_mode, continuity_status FROM projects WHERE id = ?').get(enriched.id);
    Object.assign(enriched, fresh || {});
  } catch (_) { /* 非致命 */ }
  if (includeHealth) {
    try { enriched.asset_health = assetHealth.checkProjectAssets(enriched.id); }
    catch { enriched.asset_health = null; }
    if (enriched.asset_health && project.status !== 'generating') {
      if ((enriched.asset_health.counts?.exports || 0) > 0) enriched.status = 'completed';
      else if ((enriched.asset_health.counts?.storyboards || 0) === 0) enriched.status = 'draft';
      else if (enriched.asset_health.can_compose) enriched.status = 'ready';
      else if (enriched.asset_health.status === 'error') enriched.status = 'partial';
      else enriched.status = 'partial';
    }
  }
  return enriched;
}

// 获取所有项目
router.get('/', (req, res) => {
  const { keyword } = req.query;
  let projects;
  if (keyword) {
    projects = getDb().prepare('SELECT * FROM projects WHERE name LIKE ? ORDER BY updated_at DESC').all(`%${keyword}%`);
  } else {
    projects = getDb().prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  }
  res.json({ code: 200, data: projects.map(p => enrichProject(p, true)), message: 'success' });
});

// 项目资产健康检查
router.get('/:id/assets/health', (req, res) => {
  const health = assetHealth.checkProjectAssets(req.params.id);
  if (!health) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
  res.json({ code: 200, data: health, message: 'success' });
});

// 创作工作台状态：主题 → 剧本 → 角色 → 画面 → 配音字幕 → 成片
router.get('/:id/workbench-status', (req, res) => {
  try {
    const status = workbench.getWorkbenchStatus(req.params.id);
    if (!status) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    res.json({ code: 200, data: status, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取工作台状态失败: ${err.message}` });
  }
});

router.post('/:id/workbench/repair', async (req, res) => {
  try {
    const result = await workbench.repairWorkbench(req.params.id, req.body || {});
    if (!result) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    opLog.log('workbench.repair', 'project', req.params.id, { type: req.body?.type || req.body?.repair_type || 'auto' });
    res.json({ code: 200, data: result, message: '修复完成' });
  } catch (err) {
    const code = err.code === 'NO_REFERENCE_IMAGE' || err.code === 'NO_CHARACTER' ? 400 : 500;
    res.status(code).json({
      code,
      data: { advice: err.advice || [] },
      message: err.message || '修复失败',
    });
  }
});

// 项目级批量生图：缺图补齐 / 全部重生 / 失败重试 / 低分重生。
router.post('/:id/images/generate-all', (req, res) => {
  try {
    const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    const selected = workbench.imageBatchTargets(req.params.id, req.body || {});
    const task = taskManager.create('image-batch', {
      project_id: Number(req.params.id),
      mode: selected.mode,
      payload: req.body || {},
      target_storyboard_ids: selected.storyboards.map((sb) => Number(sb.id)),
      target_count: selected.storyboards.length,
      recovery: { kind: 'image-batch', attempts: 0, max_attempts: 3 },
    });
    opLog.log('image.batch.start', 'project', req.params.id, {
      task_id: task.id,
      mode: selected.mode,
      target_count: selected.storyboards.length,
    });
    res.json({
      code: 200,
      data: {
        task_id: task.id,
        project_id: Number(req.params.id),
        mode: selected.mode,
        target_count: selected.storyboards.length,
      },
      message: selected.storyboards.length ? '批量生图任务已提交' : '没有需要生成的分镜',
    });
    workbench.runProjectImageBatch(task.id, req.params.id, req.body || {})
      .catch((err) => {
        console.error('[image-batch] 启动失败:', err);
        try { taskManager.fail(task.id, err); } catch (_) {}
      });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `批量生图启动失败: ${err.message}` });
  }
});

// 手动完善项目后重新检查项目状态，并把“草稿/待修复/可导出/已完成”写回项目卡片。
router.post('/:id/complete-check', (req, res) => {
  try {
    const result = workbench.completeProjectCheck(req.params.id, { persist: true });
    if (!result) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    opLog.log('project.complete_check', 'project', req.params.id, { status: result.status });
    res.json({
      code: 200,
      data: { ...result, project: enrichProject(project, true) },
      message: result.status === 'completed' ? '项目已完成' : result.status === 'ready' ? '项目已可导出' : '项目状态已刷新',
    });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `项目状态检查失败: ${err.message}` });
  }
});

// Story Bible：系列故事设定（世界观、主线、伏笔、禁改事实、人物关系）
router.get('/:id/story-bible', (req, res) => {
  try {
    const bible = continuity.getStoryBible(req.params.id);
    if (!bible) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    res.json({ code: 200, data: bible, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取故事圣经失败: ${err.message}` });
  }
});

router.put('/:id/story-bible', (req, res) => {
  try {
    const bible = continuity.updateStoryBible(req.params.id, req.body || {});
    if (!bible) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    opLog.log('continuity.story_bible.update', 'project', req.params.id, { fields: Object.keys(req.body || {}) });
    res.json({ code: 200, data: bible, message: '故事设定已保存' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `保存故事圣经失败: ${err.message}` });
  }
});

// 角色库：从脚本/视觉锚点提取角色，并供前端编辑、锁定、绑定参考图
router.get('/:id/characters', (req, res) => {
  try {
    continuity.ensureSeriesForProject(req.params.id);
    const chars = continuity.listCharacters(req.params.id);
    res.json({ code: 200, data: chars, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取角色库失败: ${err.message}` });
  }
});

router.post('/:id/characters/extract', (req, res) => {
  try {
    const chars = continuity.extractCharacters(req.params.id, { force: req.body?.force === true });
    res.json({ code: 200, data: chars, message: '角色库已提取' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `提取角色失败: ${err.message}` });
  }
});

router.post('/:id/characters/auto-lock', (req, res) => {
  try {
    const result = workbench.autoLockCharacters(req.params.id);
    if (!result) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    opLog.log('continuity.characters.auto_lock', 'project', req.params.id, { character_id: result.character?.id });
    res.json({ code: 200, data: result, message: '角色定妆已锁定' });
  } catch (err) {
    const code = err.code === 'NO_REFERENCE_IMAGE' || err.code === 'NO_CHARACTER' ? 400 : 500;
    res.status(code).json({
      code,
      data: { advice: err.advice || [] },
      message: err.message || '一键定妆失败',
    });
  }
});

router.post('/characters/:characterId/reference-images', (req, res) => {
  try {
    const asset = continuity.addReferenceImage(req.params.characterId, req.body || {});
    if (!asset) return res.status(404).json({ code: 404, data: null, message: '角色不存在' });
    res.json({ code: 200, data: asset, message: '参考图已添加' });
  } catch (err) {
    res.status(400).json({ code: 400, data: null, message: `添加参考图失败: ${err.message}` });
  }
});

router.put('/characters/:characterId', (req, res) => {
  try {
    const character = continuity.updateCharacter(req.params.characterId, req.body || {});
    if (!character) return res.status(404).json({ code: 404, data: null, message: '角色不存在' });
    res.json({ code: 200, data: character, message: '角色已保存' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `保存角色失败: ${err.message}` });
  }
});

router.post('/characters/:characterId/lock', (req, res) => {
  try {
    const character = continuity.lockCharacter(req.params.characterId, req.body?.locked !== false);
    if (!character) return res.status(404).json({ code: 404, data: null, message: '角色不存在' });
    res.json({ code: 200, data: character, message: character.locked ? '角色已锁定' : '角色已解锁' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `锁定角色失败: ${err.message}` });
  }
});

router.post('/:id/continue', (req, res) => {
  try {
    const project = continuity.continueProject(req.params.id, req.body || {});
    if (!project) return res.status(404).json({ code: 404, data: null, message: '原项目不存在' });
    opLog.log('continuity.project.continue', 'project', project.id, { parent_project_id: req.params.id });
    res.json({ code: 200, data: enrichProject(project, true), message: '续写项目已创建' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `创建续写项目失败: ${err.message}` });
  }
});

router.post('/:id/continuity/check', (req, res) => {
  try {
    const result = continuity.evaluateStoryboard(req.params.id, req.body?.storyboard_id, req.body?.image_id);
    if (!result) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    res.json({ code: 200, data: result, message: '一致性检查完成' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `一致性检查失败: ${err.message}` });
  }
});

router.post('/:id/continuity/repair', async (req, res) => {
  try {
    const result = await workbench.repairWorkbench(req.params.id, {
      ...(req.body || {}),
      type: 'low_score_images',
    });
    if (!result) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    opLog.log('continuity.repair', 'project', req.params.id, { count: result.generated?.length || 0 });
    res.json({ code: 200, data: result, message: '一致性修复完成' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `一致性修复失败: ${err.message}` });
  }
});

router.get('/:id/series', (req, res) => {
  try {
    const series = workbench.getSeriesView(req.params.id);
    if (!series) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    res.json({ code: 200, data: series, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取系列视图失败: ${err.message}` });
  }
});

// 项目统一时间轴：配音、字幕、画面、导出共用同一时基。
router.get('/:id/timeline', async (req, res) => {
  try {
    const project = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    const timeline = await timelineService.buildProjectTimeline(req.params.id, {
      videoSpeed: req.query.videoSpeed || req.query.video_speed,
    });
    res.json({ code: 200, data: timeline, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取时间轴失败: ${err.message}` });
  }
});

// 重新探测音频/视频时长并返回统一时间轴。当前不写缓存，避免破坏旧项目数据。
router.post('/:id/timeline/rebuild', async (req, res) => {
  try {
    const project = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    const timeline = await timelineService.buildProjectTimeline(req.params.id, {
      videoSpeed: req.body?.videoSpeed || req.body?.video_speed,
    });
    res.json({ code: 200, data: timeline, message: '时间轴已重新探测' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `重建时间轴失败: ${err.message}` });
  }
});

// 获取单个项目
router.get('/:id', (req, res) => {
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
  res.json({ code: 200, data: enrichProject(project, true), message: 'success' });
});

// 创建项目
router.post('/', (req, res) => {
  const { name, theme, style, duration_min, duration_max } = req.body;
  if (name == null || String(name).trim() === '') {
    return res.status(400).json({ code: 400, data: null, message: '项目名称不能为空' });
  }
  const cleanName = String(name).trim().slice(0, 200);
  const cleanTheme = theme != null ? String(theme).slice(0, 2000) : '';
  const dMin = Number.isFinite(+duration_min) ? Math.max(1, Math.min(7200, +duration_min)) : 60;
  const dMax = Number.isFinite(+duration_max) ? Math.max(dMin, Math.min(7200, +duration_max)) : 180;
  const result = getDb().prepare(
    'INSERT INTO projects (name, theme, style, duration_min, duration_max) VALUES (?, ?, ?, ?, ?)'
  ).run(cleanName, cleanTheme, style || '写实', dMin, dMax);
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  try { continuity.ensureSeriesForProject(project.id); } catch (_) {}
  opLog.log('project.create', 'project', project.id, { name: cleanName, style: style || '写实' });
  res.json({ code: 200, data: enrichProject(project, true), message: '创建成功' });
});

// 更新项目（PATCH 语义：只更新请求中实际传入的字段）
router.put('/:id', (req, res) => {
  // 先确认项目存在，避免对不存在的 id 也返回“更新成功”
  const existing = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });

  const allowedFields = ['name', 'theme', 'style', 'duration_min', 'duration_max', 'status', 'script_content', 'cover', 'ratio', 'long_video_mode', 'target_duration_sec'];
  const updates = [];
  const values = [];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field}=?`);
      values.push(req.body[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ code: 400, data: null, message: '没有可更新的字段' });
  }

  updates.push('updated_at=CURRENT_TIMESTAMP');
  values.push(req.params.id);

  getDb().prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id=?`).run(...values);
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  // 审计只记被改的字段名，不记具体值（避免脚本/封面等长文本灌爆日志）
  opLog.log('project.update', 'project', req.params.id, { fields: updates.filter(u => u !== 'updated_at=CURRENT_TIMESTAMP').map(u => u.split('=')[0]) });
  res.json({ code: 200, data: enrichProject(project, true), message: '更新成功' });
});

// 删除项目（级联删除分镜/图片/导出记录 + 所有关联磁盘文件）
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  const existing = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
  }

  // permanent=true 走彻底删除（旧逻辑：DB CASCADE + 物理删文件，不可恢复）
  if (String(req.query.permanent) === 'true') {
    const images = getDb().prepare(
      `SELECT i.file_path, i.file_url FROM images i
       JOIN storyboards s ON i.storyboard_id = s.id WHERE s.project_id = ?`
    ).all(id);
    const audios = getDb().prepare(
      `SELECT audio_url FROM storyboards WHERE project_id = ? AND audio_url IS NOT NULL AND audio_url != ''`
    ).all(id);
    // v1.6.8：图生视频文件（storyboards.video_path）也要级联清理，否则删项目后残留孤儿视频
    const videos = getDb().prepare(
      `SELECT video_path FROM storyboards WHERE project_id = ? AND video_path IS NOT NULL AND video_path != ''`
    ).all(id);
    const exportsRows = getDb().prepare(
      `SELECT file_path, file_url FROM exports WHERE project_id = ?`
    ).all(id);

    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);

    safeUnlinkMany(images.map(i => i.file_path || i.file_url));
    safeUnlinkMany(audios.map(a => a.audio_url));
    safeUnlinkMany(videos.map(v => v.video_path));
    safeUnlinkMany(exportsRows.map(e => e.file_path || e.file_url));
    opLog.log('project.purge', 'project', id, null);
    return res.json({ code: 200, data: null, message: '已彻底删除' });
  }

  // 默认走回收站软删除（快照整棵树 + 文件搬入 .trash，可还原，7 天后自动清）
  const trashId = trash.trashProject(id);
  res.json({ code: 200, data: { trashId }, message: '已移入回收站，7 天内可还原' });
});

// 方案 B：按项目名称/主题/风格 AI 生成封面（免费 Pollinations）
// POST /api/projects/:id/cover  → 生成一张 16:9 封面图，写入 projects.cover 字段
router.post('/:id/cover', async (req, res) => {
  const id = req.params.id;
  const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });

  const imageGen = require('../services/imageGen');

  // v1.6.10：封面紧扣项目主题。buildPrompt 内部 base 取 userPrompt 优先、否则 description，
  // 所以把"主题"放进 userPrompt（一定被使用），通用修饰词作为后缀拼在主题之后，避免主题被丢弃。
  const subject = [project.name, project.theme].filter(Boolean).join('，') || project.name || '短视频';
  const description = subject; // 兜底字段
  const userPrompt = `${subject}，短视频封面主视觉，吸睛构图，电影质感，高对比，鲜明主体`;

  try {
    const result = await imageGen.generate({
      description,
      userPrompt,
      style: project.style || 'realistic',
      ratio: '16:9',
      model: 'auto', // 自动走配置的主图源（默认 CogView）+ 备用链
      batchSize: 1,
    });
    require('../services/imageStats').record({
      projectId: Number(id),
      storyboardId: null,
      requestedModel: 'auto',
      firstModel: result.attempts?.[0]?.model || '',
      firstAttemptOk: !!result.attempts?.[0]?.ok,
      finalOk: !result.is_placeholder,
      usedPlaceholder: !!result.is_placeholder,
      downgraded: !!result.downgraded,
      attemptsCount: result.attempts?.length || 0,
      finalProvider: result.provider || '',
      source: 'manual',
    });
    const fileUrl = result?.local_files?.[0]?.file_url;
    if (!fileUrl) throw new Error('封面生成未返回有效图片');

    // 删除旧的 AI 封面文件（仅当旧 cover 是 uploads 下的本地图，避免误删分镜图）
    const oldCover = project.cover;
    getDb().prepare('UPDATE projects SET cover = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(fileUrl, id);
    if (oldCover && oldCover.startsWith('/uploads/') && oldCover !== fileUrl) {
      safeUnlinkMany([oldCover]);
    }
    opLog.log('project.cover', 'project', id, { cover: fileUrl });

    const updated = enrichProject(getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id), true);
    const msg = result.is_placeholder ? '封面生成全部失败，已用占位图' : (result.downgraded ? `封面生成成功（${result.notice}）` : '封面生成成功');
    res.json({ code: 200, data: updated, message: msg });
  } catch (err) {
    console.error('[project.cover] 生成失败:', err.message);
    res.status(502).json({ code: 502, data: null, message: `封面生成失败：${err.message}` });
  }
});

module.exports = router;
