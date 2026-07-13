const { getDb } = require('../db');
const assetHealth = require('./assetHealth');
const continuity = require('./continuity');
const promptCompiler = require('./promptCompiler');
const taskManager = require('./taskManager');
const failureAdvisor = require('./failureAdvisor');

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanText(value, max = 600) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function lastContinuityChecks(projectId) {
  const rows = getDb().prepare(
    `SELECT c.*
     FROM continuity_checks c
     JOIN (
       SELECT storyboard_id, MAX(created_at) AS created_at
       FROM continuity_checks
       WHERE project_id = ? AND storyboard_id IS NOT NULL
       GROUP BY storyboard_id
     ) latest ON latest.storyboard_id = c.storyboard_id AND latest.created_at = c.created_at
     WHERE c.project_id = ?
     ORDER BY c.storyboard_id ASC`
  ).all(projectId, projectId);
  return rows.map((row) => ({
    ...row,
    issues: safeJsonParse(row.issues, []),
    suggestions: safeJsonParse(row.suggestions, []),
  }));
}

function determineStep({ project, storyboards, characters, health, checks }) {
  if (!project?.theme && !project?.script_content && storyboards.length === 0) {
    return {
      current_step: 'theme',
      next_action: '填写主题后生成剧本',
      primary_action: { type: 'generate_script', label: '生成剧本', target: 'script' },
    };
  }
  if (storyboards.length === 0) {
    return {
      current_step: 'script',
      next_action: '生成并保存分镜剧本',
      primary_action: { type: 'generate_script', label: '生成剧本', target: 'script' },
    };
  }
  if (characters.length === 0) {
    return {
      current_step: 'characters',
      next_action: '确认主角设定',
      primary_action: { type: 'repair_characters', label: '提取角色', target: 'script' },
    };
  }
  const primary = characters.find((c) => c.is_primary) || characters[0];
  if (primary && (!primary.locked || !primary.assets?.length)) {
    return {
      current_step: 'characters',
      next_action: primary.assets?.length ? '锁定主角定妆' : '为主角绑定参考图',
      primary_action: { type: 'auto_lock', label: primary.assets?.length ? '锁定主角' : '一键定妆', target: 'images' },
    };
  }
  const missingImageIssue = (health?.issues || []).find((i) => i.code === 'MISSING_IMAGES');
  if (missingImageIssue) {
    return {
      current_step: 'images',
      next_action: `补齐 ${missingImageIssue.scenes?.length || 0} 个缺图分镜`,
      primary_action: { type: 'repair_missing_images', label: '只生成缺图分镜', target: 'images' },
    };
  }
  const low = checks.filter((c) => c.status === 'risk' || Number(c.score) < 60);
  if (low.length) {
    return {
      current_step: 'quality',
      next_action: `修复 ${low.length} 个一致性风险镜头`,
      primary_action: { type: 'repair_low_score_images', label: '一键修复低分画面', target: 'images' },
    };
  }
  if (!health?.can_compose) {
    return {
      current_step: 'preview',
      next_action: '先修复必须项再导出',
      primary_action: { type: 'repair_assets', label: '一键修复资产', target: 'preview' },
    };
  }
  return {
    current_step: 'compose',
    next_action: '预览无误后导出成片',
    primary_action: { type: 'export_video', label: '导出成片', target: 'preview' },
  };
}

function statusFromIssues({ step, health, checks }) {
  const requiredIssues = [];
  const suggestions = [];
  for (const issue of health?.issues || []) {
    const item = {
      code: issue.code,
      level: issue.level,
      message: issue.message,
      suggestions: issue.suggestions || [],
      scenes: issue.scenes || [],
    };
    if (issue.level === 'error') requiredIssues.push(item);
    else suggestions.push(item);
  }
  const lowChecks = checks.filter((c) => c.status === 'risk' || c.status === 'warn');
  for (const c of lowChecks) {
    suggestions.push({
      code: c.status === 'risk' ? 'CONTINUITY_RISK' : 'CONTINUITY_WARN',
      level: c.status === 'risk' ? 'error' : 'warn',
      storyboard_id: c.storyboard_id,
      message: `分镜 ${c.storyboard_id} 人物一致性评分 ${c.score}`,
      suggestions: c.suggestions || [],
    });
  }
  const hasMust = requiredIssues.length || suggestions.some((i) => i.level === 'error');
  const status = hasMust ? 'must_fix' : (suggestions.length ? 'suggest_optimize' : 'ready');
  const label = status === 'must_fix' ? '必须修复' : status === 'suggest_optimize' ? '建议优化' : '可继续';
  return { status, label, requiredIssues, suggestions };
}

function getWorkbenchStatus(projectId, { persist = true } = {}) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  let enrichedProject = project;
  try { enrichedProject = continuity.ensureSeriesForProject(projectId) || project; } catch (_) {}
  const storyboards = db.prepare(
    `SELECT s.*, i.file_url AS selected_image_url, i.file_path AS selected_image_path
     FROM storyboards s
     LEFT JOIN images i ON i.id = s.selected_image_id
     WHERE s.project_id = ?
     ORDER BY s.sort_order ASC, s.scene_number ASC`
  ).all(projectId);
  let characters = [];
  try { characters = continuity.listCharacters(projectId); } catch (_) {}
  const health = assetHealth.checkProjectAssets(projectId);
  const checks = lastContinuityChecks(projectId);
  const step = determineStep({ project: enrichedProject, storyboards, characters, health, checks });
  const state = statusFromIssues({ step, health, checks });
  const allImagesReady = health?.counts?.storyboards > 0 && health.counts.usable_image_scenes >= health.counts.storyboards;
  const dialogScenes = storyboards.filter((s) => String(s.dialog || '').trim());
  const progressSteps = [
    { key: 'topic', label: '主题', done: !!(project.theme || project.script_content || storyboards.length) },
    { key: 'script', label: '脚本', done: !!(project.script_content || storyboards.length) },
    { key: 'storyboard', label: '分镜', done: storyboards.length > 0 },
    { key: 'image', label: '图片', done: allImagesReady },
    { key: 'voice', label: '配音', done: dialogScenes.length === 0 ? storyboards.length > 0 : dialogScenes.every((s) => s.audio_url) },
    { key: 'subtitle', label: '字幕', done: dialogScenes.length === 0 ? storyboards.length > 0 : dialogScenes.every((s) => s.subtitle_text) },
    { key: 'timeline', label: '时间线', done: storyboards.length > 0 && storyboards.every((s) => Number(s.duration) > 0) },
    { key: 'export', label: '导出', done: (health?.counts?.exports || 0) > 0 },
  ];
  const currentStepMap = {
    theme: 'topic', script: 'script', characters: 'storyboard', images: 'image',
    quality: 'image', preview: 'timeline', compose: 'export',
  };
  const repairItems = [];
  if (!characters.length) repairItems.push({ type: 'characters', label: '提取角色' });
  if (characters.some((c) => c.is_primary && (!c.locked || !c.assets?.length))) repairItems.push({ type: 'auto_lock', label: '一键定妆' });
  if ((health?.issues || []).some((i) => i.code === 'MISSING_IMAGES')) repairItems.push({ type: 'missing_images', label: '生成缺图分镜' });
  if (checks.some((c) => c.status === 'risk' || Number(c.score) < 60)) repairItems.push({ type: 'low_score_images', label: '修复低分画面' });
  if ((health?.issues || []).some((i) => i.code === 'SELECTED_IMAGE_MISSING')) repairItems.push({ type: 'assets', label: '修复选图引用' });
  repairItems.push({ type: 'timeline', label: '重建时间轴' });

  const data = {
    project_id: Number(projectId),
    status: state.status,
    status_label: state.label,
    current_step: currentStepMap[step.current_step] || step.current_step,
    next_action: step.next_action,
    primary_action: step.primary_action,
    progress_steps: progressSteps,
    missing_items: state.requiredIssues,
    suggestions: state.suggestions,
    repair_items: repairItems,
    counts: {
      storyboards: storyboards.length,
      characters: characters.length,
      locked_characters: characters.filter((c) => c.locked).length,
      reference_images: characters.reduce((sum, c) => sum + (c.assets?.length || 0), 0),
      images_ready: health?.counts?.usable_image_scenes || 0,
      total_scenes: health?.counts?.storyboards || storyboards.length,
      exports: health?.counts?.exports || 0,
    },
    health,
    continuity_checks: checks,
    summary: `${state.label} · ${step.next_action}`,
    checked_at: Date.now(),
  };
  if (persist) {
    try {
      db.prepare(
        `INSERT INTO workbench_checks
         (project_id, status, current_step, next_action, missing_items, repair_items, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        projectId, data.status, data.current_step, data.next_action,
        JSON.stringify(data.missing_items), JSON.stringify(data.repair_items), data.summary, data.checked_at
      );
    } catch (e) {
      console.warn('[workbench] 保存检查记录失败:', e.message);
    }
  }
  return data;
}

function bestExistingImageForProject(projectId) {
  return getDb().prepare(
    `SELECT i.*, s.scene_number
     FROM images i
     JOIN storyboards s ON s.id = i.storyboard_id
     WHERE s.project_id = ? AND i.file_url IS NOT NULL AND i.file_url != ''
     ORDER BY CASE WHEN s.selected_image_id = i.id THEN 0 ELSE 1 END, i.created_at ASC, i.id ASC
     LIMIT 1`
  ).get(projectId);
}

function autoLockCharacters(projectId) {
  let characters = continuity.listCharacters(projectId);
  if (!characters.length) characters = continuity.extractCharacters(projectId, { force: false });
  const primary = characters.find((c) => c.is_primary) || characters[0];
  if (!primary) {
    const err = new Error('还没有可锁定的角色，请先保存分镜或提取角色。');
    err.code = 'NO_CHARACTER';
    throw err;
  }
  if (!primary.assets?.length) {
    const img = bestExistingImageForProject(projectId);
    if (!img) {
      const err = new Error('项目里还没有可作为定妆的图片，请先生成至少一张主角画面。');
      err.code = 'NO_REFERENCE_IMAGE';
      err.advice = ['去图片页生成第一镜画面', '选择效果稳定的人物图后再一键定妆'];
      throw err;
    }
    continuity.addReferenceImage(primary.id, {
      project_id: Number(projectId),
      image_id: img.id,
      file_url: img.file_url,
      file_path: img.file_path,
      label: `自动定妆 · 分镜${img.scene_number || ''}`,
    });
  }
  const locked = continuity.lockCharacter(primary.id, true);
  return { character: locked, status: getWorkbenchStatus(projectId) };
}

function repairSelectedImageRefs(projectId) {
  const db = getDb();
  const storyboards = db.prepare(
    `SELECT s.*
     FROM storyboards s
     WHERE s.project_id = ?
     ORDER BY s.sort_order ASC, s.scene_number ASC`
  ).all(projectId);
  let fixed = 0;
  for (const sb of storyboards) {
    if (!sb.selected_image_id) {
      const img = db.prepare('SELECT id FROM images WHERE storyboard_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(sb.id);
      if (img) {
        db.prepare('UPDATE storyboards SET selected_image_id = ? WHERE id = ?').run(img.id, sb.id);
        fixed++;
      }
    }
  }
  return fixed;
}

async function generateStoryboardImage({
  storyboard,
  project,
  reason = 'repair',
  model = 'auto',
  ratio = null,
  consistencyMode = 'standard',
  batchSize = 2,
  reuseCache = true,
}) {
  const imageGen = require('./imageGen');
  const { toRelative } = require('../utils/fileCleanup');
  const db = getDb();
  let continuityContext = { promptAnchor: '', referenceImages: [], warnings: [] };
  try {
    continuityContext = continuity.prepareImageContext({
      projectId: project.id,
      storyboardId: storyboard.id,
      consistencyMode,
    });
  } catch (err) {
    if (consistencyMode === 'strict') throw err;
  }
  const compiled = promptCompiler.compileImagePrompt({
    project,
    storyboard,
    userPrompt: storyboard.prompt || storyboard.description || '',
    style: project.style,
    visualAnchor: project.visual_anchor || '',
    continuityContext,
  });
  const cached = promptCompiler.getCachedGeneration({
    kind: 'image',
    model,
    promptHash: compiled.promptHash,
    contextHash: compiled.contextHash,
    storyboardId: storyboard.id,
  });
  if (reuseCache && cached?.result?.image_ids?.length) {
    const first = cached.result.image_ids[0];
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(first);
    if (row && row.gen_status !== 'placeholder') {
      db.prepare('UPDATE storyboards SET selected_image_id = ?, prompt = ? WHERE id = ?').run(row.id, compiled.prompt, storyboard.id);
      return { reused: true, image_ids: [row.id], prompt: compiled.prompt, reason };
    }
  }
  const result = await imageGen.generate({
    description: storyboard.description || storyboard.dialog || '',
    userPrompt: compiled.prompt,
    style: project.style || '写实',
    ratio: ratio || project.ratio || '16:9',
    model,
    batchSize: Math.max(1, Math.min(4, Number(batchSize) || 2)),
    visualAnchor: '',
    seed: project.image_seed != null ? Number(project.image_seed) : null,
    referenceImages: continuityContext.referenceImages || [],
    consistencyMode,
  });
  const inserted = [];
  const checks = [];
  for (const lf of result.local_files || []) {
    const ins = db.prepare(
      `INSERT INTO images (storyboard_id, prompt, file_path, file_url, submit_id, gen_status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(storyboard.id, result.prompt, toRelative(lf.local_path), lf.file_url, result.submit_id || '', result.is_placeholder ? 'placeholder' : 'success');
    inserted.push(ins.lastInsertRowid);
    try {
      const assetNaming = require('./assetNaming');
      const normalized = assetNaming.normalizeImageRecord(ins.lastInsertRowid);
      if (normalized) {
        lf.file_url = normalized;
        lf.file_path = normalized;
      }
    } catch (_) {}
    try { checks.push(continuity.evaluateStoryboard(project.id, storyboard.id, ins.lastInsertRowid)); } catch (_) {}
  }
  require('./imageStats').record({
    projectId: project.id,
    storyboardId: storyboard.id,
    requestedModel: model,
    firstModel: result.attempts?.[0]?.model || '',
    firstAttemptOk: !!result.attempts?.[0]?.ok,
    finalOk: !result.is_placeholder,
    usedPlaceholder: !!result.is_placeholder,
    downgraded: !!result.downgraded,
    attemptsCount: result.attempts?.length || 0,
    finalProvider: result.provider || '',
    source: 'manual',
  });
  const rows = inserted.map((id) => db.prepare('SELECT * FROM images WHERE id = ?').get(id)).filter(Boolean);
  const ranked = promptCompiler.rankImageCandidates(rows, checks);
  if (ranked[0]) {
    db.prepare('UPDATE storyboards SET selected_image_id = ?, prompt = ?, quality_status = ? WHERE id = ?')
      .run(ranked[0].image.id, compiled.prompt, ranked[0].score >= 80 ? 'stable' : 'review', storyboard.id);
  }
  if (!result.is_placeholder) promptCompiler.saveGenerationCache({
    kind: 'image',
    model,
    provider: result.provider,
    projectId: project.id,
    storyboardId: storyboard.id,
    prompt: compiled.prompt,
    promptHash: compiled.promptHash,
    contextHash: compiled.contextHash,
    result: {
      image_ids: inserted,
      selected_image_id: ranked[0]?.image?.id || null,
      prompt: compiled.prompt,
      model: result.model,
      provider: result.provider,
      notice: result.notice,
    },
  });
  return {
    reused: false,
    image_ids: inserted,
    selected_image_id: ranked[0]?.image?.id || null,
    checks,
    prompt: compiled.prompt,
    notice: result.notice || '',
    reason,
  };
}

function latestFailedStoryboardIds(projectId) {
  const ids = new Set();
  const rows = getDb().prepare(
    `SELECT meta, result
     FROM tasks
     WHERE type = 'image-batch'
     ORDER BY updated_at DESC
     LIMIT 30`
  ).all();
  for (const row of rows) {
    let meta = null;
    let result = null;
    try { meta = row.meta ? JSON.parse(row.meta) : null; } catch { meta = null; }
    if (Number(meta?.project_id) !== Number(projectId)) continue;
    try { result = row.result ? JSON.parse(row.result) : null; } catch { result = null; }
    for (const f of result?.failures || []) {
      if (f?.storyboard_id) ids.add(Number(f.storyboard_id));
    }
    if (ids.size) break;
  }
  return ids;
}

function latestLowScoreStoryboardIds(projectId) {
  const rows = getDb().prepare(
    `SELECT c.*
     FROM continuity_checks c
     JOIN (
       SELECT storyboard_id, MAX(created_at) AS created_at
       FROM continuity_checks
       WHERE project_id = ? AND storyboard_id IS NOT NULL
       GROUP BY storyboard_id
     ) latest ON latest.storyboard_id = c.storyboard_id AND latest.created_at = c.created_at
     WHERE c.project_id = ?`
  ).all(projectId, projectId);
  return new Set(rows
    .filter((c) => c.status === 'risk' || Number(c.score) < 60)
    .map((c) => Number(c.storyboard_id))
    .filter(Boolean));
}

function imageBatchTargets(projectId, payload = {}) {
  const db = getDb();
  const mode = cleanText(payload.mode || payload.scope || 'missing', 40);
  const storyboards = db.prepare(
    'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC, scene_number ASC, id ASC'
  ).all(projectId);
  if (!storyboards.length) return { mode, storyboards: [], targetIds: new Set(), reason: 'no_storyboards' };

  let targetIds = new Set();
  if (mode === 'all') {
    targetIds = new Set(storyboards.map((sb) => Number(sb.id)));
  } else if (mode === 'low_score') {
    targetIds = latestLowScoreStoryboardIds(projectId);
  } else if (mode === 'failed') {
    const explicit = payload.failed_storyboard_ids || payload.storyboard_ids || payload.ids || [];
    targetIds = new Set((Array.isArray(explicit) ? explicit : []).map(Number).filter(Boolean));
    if (!targetIds.size) targetIds = latestFailedStoryboardIds(projectId);
  } else {
    const health = assetHealth.checkProjectAssets(projectId);
    targetIds = new Set((health?.issues || [])
      .flatMap((i) => i.code === 'MISSING_IMAGES' ? (i.scenes || []).map((s) => Number(s.id)) : []));
  }

  return {
    mode,
    storyboards: storyboards.filter((sb) => targetIds.has(Number(sb.id))),
    targetIds,
    reason: targetIds.size ? 'matched' : 'empty',
  };
}

function deriveProjectLifecycleStatus(projectId) {
  const db = getDb();
  const health = assetHealth.checkProjectAssets(projectId);
  if (!health) return null;
  let status = 'draft';
  if ((health.counts?.exports || 0) > 0) status = 'completed';
  else if ((health.counts?.storyboards || 0) === 0) status = 'draft';
  else if (health.can_compose) status = 'ready';
  else if (health.status === 'error') status = 'partial';
  else status = 'partial';
  return { status, health };
}

function completeProjectCheck(projectId, { persist = true } = {}) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const lifecycle = deriveProjectLifecycleStatus(projectId);
  if (!lifecycle) return null;
  if (persist && lifecycle.status !== project.status) {
    db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(lifecycle.status, projectId);
  }
  return {
    project_id: Number(projectId),
    status: lifecycle.status,
    status_label: lifecycle.status === 'completed' ? '已完成'
      : lifecycle.status === 'ready' ? '可导出'
      : lifecycle.status === 'partial' ? '待修复'
      : lifecycle.status === 'generating' ? '生成中'
      : '草稿',
    health: lifecycle.health,
    workbench: getWorkbenchStatus(projectId, { persist: false }),
  };
}

async function runProjectImageBatch(taskId, projectId, payload = {}) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    const err = new Error('项目不存在，无法批量生成图片');
    taskManager.fail(taskId, err);
    return;
  }
  const selected = imageBatchTargets(projectId, payload);
  const targets = selected.storyboards || [];
  const mode = selected.mode || 'missing';
  const result = {
    project_id: Number(projectId),
    mode,
    target_count: targets.length,
    successes: [],
    failures: [],
    skipped: [],
  };

  taskManager.start(taskId, targets.length ? `准备生成 ${targets.length} 个分镜的图片…` : '没有需要生成的分镜');
  if (!targets.length) {
    const status = completeProjectCheck(projectId);
    taskManager.succeed(taskId, { ...result, status }, '没有需要生成的图片');
    return;
  }

  for (let i = 0; i < targets.length; i++) {
    const task = taskManager.get(taskId);
    if (task?.meta?.cancel_requested) {
      result.skipped.push(...targets.slice(i).map((sb) => ({ storyboard_id: sb.id, scene_number: sb.scene_number, reason: '任务已取消' })));
      taskManager.cancel(taskId, '已取消批量生图');
      return;
    }
    const sb = targets[i];
    const progress = Math.max(1, Math.round((i / targets.length) * 92));
    taskManager.progress(taskId, progress, `正在生成分镜 ${sb.scene_number || i + 1} 的图片…`);
    try {
      const generated = await generateStoryboardImage({
        storyboard: sb,
        project,
        reason: mode,
        model: payload.model || 'auto',
        ratio: payload.ratio || project.ratio || '16:9',
        consistencyMode: payload.consistencyMode || payload.consistency_mode || 'standard',
        batchSize: payload.batch_size_per_scene || payload.batchSize || 2,
        reuseCache: payload.reuse_cache !== false,
      });
      result.successes.push({ storyboard_id: sb.id, scene_number: sb.scene_number, ...generated });
    } catch (err) {
      const diagnosis = failureAdvisor.diagnose(err, {
        projectId,
        taskId,
        stageHint: 'image',
        currentMessage: `分镜 ${sb.scene_number || i + 1} 图片生成失败`,
      });
      result.failures.push({
        storyboard_id: sb.id,
        scene_number: sb.scene_number,
        message: err.message,
        diagnosis,
      });
      try { db.prepare('UPDATE storyboards SET quality_status = ? WHERE id = ?').run('failed', sb.id); } catch (_) {}
    }
  }

  const status = completeProjectCheck(projectId);
  const finalResult = { ...result, status };
  if (result.failures.length && result.successes.length) {
    taskManager.partial(taskId, finalResult, `部分完成：成功 ${result.successes.length} 个，失败 ${result.failures.length} 个`);
  } else if (result.failures.length) {
    const err = new Error(`全部图片生成失败：${result.failures[0]?.message || '未知错误'}`);
    err.diagnosis = result.failures[0]?.diagnosis;
    taskManager.update(taskId, { result: finalResult });
    taskManager.fail(taskId, err);
  } else {
    taskManager.succeed(taskId, finalResult, `图片生成完成：${result.successes.length}/${targets.length}`);
  }
}

async function repairWorkbench(projectId, payload = {}) {
  const type = cleanText(payload.type || payload.repair_type || 'auto', 80);
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const result = { type, actions: [], generated: [], fixed: 0 };
  if (type === 'auto' || type === 'characters') {
    const chars = continuity.extractCharacters(projectId, { force: false });
    result.actions.push({ type: 'characters', count: chars.length, message: '角色库已确认' });
  }
  if (type === 'auto_lock') {
    const locked = autoLockCharacters(projectId);
    result.actions.push({ type: 'auto_lock', character: locked.character, message: '主角已锁定' });
  }
  if (type === 'auto' || type === 'assets') {
    const fixed = repairSelectedImageRefs(projectId);
    result.fixed += fixed;
    result.actions.push({ type: 'assets', count: fixed, message: fixed ? '已自动选择可用图片' : '没有需要修复的选图引用' });
  }
  if (type === 'missing_images' || type === 'auto') {
    const health = assetHealth.checkProjectAssets(projectId);
    const missing = new Set((health?.issues || []).flatMap((i) => i.code === 'MISSING_IMAGES' ? (i.scenes || []).map((s) => Number(s.id)) : []));
    const targets = db.prepare('SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC, scene_number ASC').all(projectId)
      .filter((sb) => missing.has(Number(sb.id)));
    for (const sb of targets) {
      result.generated.push(await generateStoryboardImage({
        storyboard: sb,
        project,
        reason: 'missing_image',
        model: payload.model || 'auto',
        ratio: payload.ratio,
        consistencyMode: payload.consistencyMode || 'standard',
      }));
    }
    result.actions.push({ type: 'missing_images', count: targets.length, message: `已处理 ${targets.length} 个缺图分镜` });
  }
  if (type === 'low_score_images') {
    const checks = lastContinuityChecks(projectId).filter((c) => c.status === 'risk' || Number(c.score) < 60);
    const ids = new Set(checks.map((c) => Number(c.storyboard_id)).filter(Boolean));
    const targets = db.prepare('SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC, scene_number ASC').all(projectId)
      .filter((sb) => ids.has(Number(sb.id)));
    for (const sb of targets) {
      result.generated.push(await generateStoryboardImage({
        storyboard: sb,
        project,
        reason: 'low_score',
        model: payload.model || 'auto',
        ratio: payload.ratio,
        consistencyMode: payload.consistencyMode || 'standard',
      }));
      db.prepare('UPDATE continuity_checks SET repair_action = ?, resolved_at = ? WHERE project_id = ? AND storyboard_id = ? AND resolved_at IS NULL')
        .run('regenerate_with_character_anchor', Date.now(), projectId, sb.id);
    }
    result.actions.push({ type: 'low_score_images', count: targets.length, message: `已修复 ${targets.length} 个低分分镜` });
  }
  if (type === 'timeline') {
    const timeline = await require('./timeline').buildProjectTimeline(projectId, { videoSpeed: payload.videoSpeed || 1 });
    result.actions.push({ type: 'timeline', total_duration: timeline.total_duration, message: '时间轴已重建' });
  }
  result.status = getWorkbenchStatus(projectId);
  return result;
}

function getSeriesView(projectId) {
  const project = continuity.ensureSeriesForProject(projectId);
  if (!project) return null;
  const db = getDb();
  const series = db.prepare('SELECT * FROM series WHERE id = ?').get(project.series_id);
  const bible = continuity.getStoryBible(projectId);
  const rows = db.prepare(
    `SELECT p.*, COUNT(s.id) AS storyboard_count, COUNT(e.id) AS export_count
     FROM projects p
     LEFT JOIN storyboards s ON s.project_id = p.id
     LEFT JOIN exports e ON e.project_id = p.id
     WHERE p.series_id = ?
     GROUP BY p.id
     ORDER BY p.episode_index ASC, p.id ASC`
  ).all(project.series_id);
  return {
    series,
    story_bible: bible,
    episodes: rows.map((row) => ({
      id: row.id,
      name: row.name,
      episode_index: row.episode_index || 1,
      status: row.status,
      theme: row.theme,
      ending_summary: row.ending_summary,
      continuation_mode: row.continuation_mode,
      parent_project_id: row.parent_project_id,
      storyboard_count: row.storyboard_count || 0,
      export_count: row.export_count || 0,
    })),
    characters: continuity.listCharacters(projectId),
  };
}

module.exports = {
  getWorkbenchStatus,
  repairWorkbench,
  autoLockCharacters,
  getSeriesView,
  generateStoryboardImage,
  imageBatchTargets,
  runProjectImageBatch,
  completeProjectCheck,
  deriveProjectLifecycleStatus,
};
