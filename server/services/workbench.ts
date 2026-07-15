import { getDb, type SqlRow, type SqlValue } from '../db'
import * as assetHealth from './assetHealth'
import type { ProjectAssetHealth } from './assetHealth'
import * as continuity from './continuity'
import * as promptCompiler from './promptCompiler'
import { singletonTaskManager as taskManager } from './taskManager'
import * as failureAdvisor from './failureAdvisor'
import * as imageGen from './imageGen'

type JsonObject = Record<string, unknown>
interface ContinuityCheck extends JsonObject {
  status?: string
  score?: unknown
  storyboard_id?: unknown
  suggestions?: unknown[]
}
interface WorkbenchStep {
  current_step: string
  next_action: string
  primary_action: { type: string; label: string; target: string }
}
interface GenerateStoryboardImageInput {
  storyboard: JsonObject
  project: JsonObject
  reason?: string
  model?: string
  ratio?: string | null
  consistencyMode?: string
  batchSize?: number
  reuseCache?: boolean
  taskId?: string
}
interface BatchResult extends JsonObject {
  successes: JsonObject[]
  failures: JsonObject[]
  skipped: JsonObject[]
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function asRecordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '')
}

function entityId(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

function assetCount(character: JsonObject): number {
  return Array.isArray(character.assets) ? character.assets.length : 0
}

function safeJsonParse(value: unknown, fallback: unknown = null): unknown {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function cleanText(value: unknown, max = 600): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function lastContinuityChecks(projectId: unknown): ContinuityCheck[] {
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
  return rows.map((row: SqlRow): ContinuityCheck => ({
    ...row,
    issues: safeJsonParse(row.issues, []),
    suggestions: asUnknownArray(safeJsonParse(row.suggestions, [])),
  }));
}

function determineStep({ project, storyboards, characters, health, checks }: {
  project: JsonObject
  storyboards: SqlRow[]
  characters: JsonObject[]
  health: ProjectAssetHealth | null
  checks: ContinuityCheck[]
}): WorkbenchStep {
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
  const primary = characters.find((character) => character.is_primary) || characters[0];
  if (primary && (!primary.locked || assetCount(primary) === 0)) {
    return {
      current_step: 'characters',
      next_action: assetCount(primary) ? '锁定主角定妆' : '为主角绑定参考图',
      primary_action: { type: 'auto_lock', label: assetCount(primary) ? '锁定主角' : '一键定妆', target: 'images' },
    };
  }
  const missingImageIssue = (health?.issues || []).find((issue) => issue.code === 'MISSING_IMAGES');
  if (missingImageIssue) {
    return {
      current_step: 'images',
      next_action: `补齐 ${missingImageIssue.scenes?.length || 0} 个缺图分镜`,
      primary_action: { type: 'repair_missing_images', label: '只生成缺图分镜', target: 'images' },
    };
  }
  const low = checks.filter((check) => check.status === 'risk' || Number(check.score) < 60);
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

function statusFromIssues({ step: _step, health, checks }: { step: WorkbenchStep; health: ProjectAssetHealth | null; checks: ContinuityCheck[] }) {
  const requiredIssues: JsonObject[] = [];
  const suggestions: JsonObject[] = [];
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
  const lowChecks = checks.filter((check) => check.status === 'risk' || check.status === 'warn');
  for (const check of lowChecks) {
    suggestions.push({
      code: check.status === 'risk' ? 'CONTINUITY_RISK' : 'CONTINUITY_WARN',
      level: check.status === 'risk' ? 'error' : 'warn',
      storyboard_id: check.storyboard_id,
      message: `分镜 ${check.storyboard_id} 人物一致性评分 ${check.score}`,
      suggestions: check.suggestions || [],
    });
  }
  const hasMust = requiredIssues.length || suggestions.some((i) => i.level === 'error');
  const status = hasMust ? 'must_fix' : (suggestions.length ? 'suggest_optimize' : 'ready');
  const label = status === 'must_fix' ? '必须修复' : status === 'suggest_optimize' ? '建议优化' : '可继续';
  return { status, label, requiredIssues, suggestions };
}

export function getWorkbenchStatus(projectId: unknown, { persist = true }: { persist?: boolean } = {}) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  let enrichedProject: JsonObject = project;
  try { enrichedProject = continuity.ensureSeriesForProject(projectId) || project; } catch (_) {}
  const storyboards = db.prepare(
    `SELECT s.*, i.file_url AS selected_image_url, i.file_path AS selected_image_path
     FROM storyboards s
     LEFT JOIN images i ON i.id = s.selected_image_id
     WHERE s.project_id = ?
     ORDER BY s.sort_order ASC, s.scene_number ASC`
  ).all(projectId);
  let characters: JsonObject[] = [];
  try { characters = continuity.listCharacters(projectId); } catch (_) {}
  const health = assetHealth.checkProjectAssets(projectId);
  const checks = lastContinuityChecks(projectId);
  const step = determineStep({ project: enrichedProject, storyboards, characters, health, checks });
  const state = statusFromIssues({ step, health, checks });
  const storyboardCount = health?.counts.storyboards || 0;
  const allImagesReady = storyboardCount > 0 && (health?.counts.usable_image_scenes || 0) >= storyboardCount;
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
  const currentStepMap: Record<string, string> = {
    theme: 'topic', script: 'script', characters: 'storyboard', images: 'image',
    quality: 'image', preview: 'timeline', compose: 'export',
  };
  const repairItems: JsonObject[] = [];
  if (!characters.length) repairItems.push({ type: 'characters', label: '提取角色' });
  if (characters.some((character) => character.is_primary && (!character.locked || assetCount(character) === 0))) repairItems.push({ type: 'auto_lock', label: '一键定妆' });
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
      reference_images: characters.reduce((sum, character) => sum + assetCount(character), 0),
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
    } catch (error: unknown) {
      console.warn('[workbench] 保存检查记录失败:', errorMessage(error));
    }
  }
  return data;
}

function bestExistingImageForProject(projectId: unknown): SqlRow | undefined {
  return getDb().prepare(
    `SELECT i.*, s.scene_number
     FROM images i
     JOIN storyboards s ON s.id = i.storyboard_id
     WHERE s.project_id = ? AND i.file_url IS NOT NULL AND i.file_url != ''
     ORDER BY CASE WHEN s.selected_image_id = i.id THEN 0 ELSE 1 END, i.created_at ASC, i.id ASC
     LIMIT 1`
  ).get(projectId);
}

export function autoLockCharacters(projectId: unknown) {
  let characters = continuity.listCharacters(projectId);
  if (!characters.length) characters = continuity.extractCharacters(projectId, { force: false });
  const primary = characters.find((character) => character.is_primary) || characters[0];
  if (!primary) {
    throw Object.assign(new Error('还没有可锁定的角色，请先保存分镜或提取角色。'), { code: 'NO_CHARACTER' });
  }
  if (!primary.assets?.length) {
    const img = bestExistingImageForProject(projectId);
    if (!img) {
      throw Object.assign(new Error('项目里还没有可作为定妆的图片，请先生成至少一张主角画面。'), {
        code: 'NO_REFERENCE_IMAGE',
        advice: ['去图片页生成第一镜画面', '选择效果稳定的人物图后再一键定妆'],
      });
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

function repairSelectedImageRefs(projectId: unknown): number {
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

export async function generateStoryboardImage({
  storyboard,
  project,
  reason = 'repair',
  model = 'auto',
  ratio = null,
  consistencyMode = 'standard',
  batchSize = 2,
  reuseCache = true,
  taskId = '',
}: GenerateStoryboardImageInput) {
  const { toRelative } = require('../utils/fileCleanup');
  const db = getDb();
  const currentSelected = storyboard.selected_image_id
    ? db.prepare(`SELECT id FROM images WHERE id = ? AND archived_at IS NULL
        AND COALESCE(file_url, file_path, '') != ''`).get(storyboard.selected_image_id)
    : null;
  const canReplaceSelection = require('./candidateReview').shouldAutoSelectCandidate({
    currentSelectedId: currentSelected?.id,
    explicitRepair: reason === 'low_score',
  });
  let continuityContext: JsonObject = { promptAnchor: '', referenceImages: [], warnings: [] };
  try {
    continuityContext = continuity.prepareImageContext({
      projectId: entityId(project.id),
      storyboardId: entityId(storyboard.id),
      consistencyMode,
    });
  } catch (err) {
    if (consistencyMode === 'strict') throw err;
  }
  const compiled = promptCompiler.compileImagePrompt({
    project,
    storyboard,
    userPrompt: String(storyboard.prompt || storyboard.description || ''),
    style: String(project.style || ''),
    visualAnchor: String(project.visual_anchor || ''),
    continuityContext,
  });
  const cached = promptCompiler.getCachedGeneration({
    kind: 'image',
    model,
    promptHash: compiled.promptHash,
    contextHash: compiled.contextHash,
    storyboardId: entityId(storyboard.id),
  });
  const cachedResult = asRecord(cached?.result);
  const cachedImageIds = Array.isArray(cachedResult.image_ids) ? cachedResult.image_ids : [];
  if (reuseCache && cachedImageIds.length) {
    const first = cachedImageIds[0];
    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(first);
    if (row && row.gen_status !== 'placeholder') {
      if (canReplaceSelection) {
        db.prepare('UPDATE storyboards SET selected_image_id = ?, prompt = ? WHERE id = ?').run(row.id, compiled.prompt, storyboard.id);
      } else {
        db.prepare('UPDATE storyboards SET prompt = ? WHERE id = ?').run(compiled.prompt, storyboard.id);
      }
      return { reused: true, image_ids: [row.id], selected_image_id: currentSelected?.id || row.id, prompt: compiled.prompt, reason };
    }
  }
  const result = await imageGen.generate({
    description: String(storyboard.description || storyboard.dialog || ''),
    userPrompt: compiled.prompt,
    style: String(project.style || '写实'),
    ratio: String(ratio || project.ratio || '16:9'),
    model,
    batchSize: Math.max(1, Math.min(4, Number(batchSize) || 2)),
    visualAnchor: '',
    seed: project.image_seed != null ? Number(project.image_seed) : null,
    referenceImages: Array.isArray(continuityContext.referenceImages) ? continuityContext.referenceImages : [],
    consistencyMode,
  });
  const inserted: SqlValue[] = [];
  const checks: unknown[] = [];
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
  require('./candidateMetadata').annotateCandidates(inserted, {
    taskId,
    provider: result.provider,
    model: result.model,
    prompt: result.prompt,
    referenceImageIds: asRecordArray(continuityContext.referenceImages).map((item) => item.id || item.image_id),
    consistencyMode,
  });
  require('./imageStats').record({
    projectId: entityId(project.id) || null,
    storyboardId: entityId(storyboard.id) || null,
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
  const rankedCandidateId = ranked[0]?.image?.id || null;
  const actualSelectedId = require('./candidateReview').resolveSelectedCandidateId({
    currentSelectedId: currentSelected?.id,
    candidateId: rankedCandidateId,
    canReplace: canReplaceSelection,
  });
  if (ranked[0] && canReplaceSelection) {
    db.prepare('UPDATE storyboards SET selected_image_id = ?, prompt = ?, quality_status = ? WHERE id = ?')
      .run(ranked[0].image.id, compiled.prompt, ranked[0].score >= 80 ? 'stable' : 'review', storyboard.id);
  } else if (ranked[0]) {
    db.prepare('UPDATE storyboards SET prompt = ? WHERE id = ?').run(compiled.prompt, storyboard.id);
  }
  if (!result.is_placeholder) promptCompiler.saveGenerationCache({
    kind: 'image',
    model,
    provider: result.provider,
    projectId: entityId(project.id) || null,
    storyboardId: entityId(storyboard.id) || null,
    prompt: compiled.prompt,
    promptHash: compiled.promptHash,
    contextHash: compiled.contextHash,
    result: {
      image_ids: inserted,
      // 缓存保留本批次最佳候选，命中时仍会根据当时的用户选择决定是否应用。
      selected_image_id: rankedCandidateId,
      prompt: compiled.prompt,
      model: result.model,
      provider: result.provider,
      notice: result.notice,
    },
  });
  return {
    reused: false,
    image_ids: inserted,
    selected_image_id: actualSelectedId,
    suggested_candidate_id: rankedCandidateId,
    checks,
    prompt: compiled.prompt,
    notice: result.notice || '',
    reason,
  };
}

function latestFailedStoryboardIds(projectId: unknown): Set<number> {
  const ids = new Set<number>();
  const rows = getDb().prepare(
    `SELECT meta, result
     FROM tasks
     WHERE type = 'image-batch'
     ORDER BY updated_at DESC
     LIMIT 30`
  ).all();
  for (const row of rows) {
    const meta = asRecord(safeJsonParse(row.meta, null));
    if (Number(meta.project_id) !== Number(projectId)) continue;
    const result = asRecord(safeJsonParse(row.result, null));
    for (const failure of asRecordArray(result.failures)) {
      if (failure.storyboard_id) ids.add(Number(failure.storyboard_id));
    }
    if (ids.size) break;
  }
  return ids;
}

function latestLowScoreStoryboardIds(projectId: unknown): Set<number> {
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
    .filter((check) => check.status === 'risk' || Number(check.score) < 60)
    .map((check) => Number(check.storyboard_id))
    .filter(Boolean));
}

export function imageBatchTargets(projectId: unknown, payload: JsonObject = {}) {
  const db = getDb();
  const mode = cleanText(payload.mode || payload.scope || 'missing', 40);
  const storyboards = db.prepare(
    'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC, scene_number ASC, id ASC'
  ).all(projectId);
  if (!storyboards.length) return { mode, storyboards: [], targetIds: new Set(), reason: 'no_storyboards' };

  let targetIds = new Set<number>();
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
      .flatMap((issue) => issue.code === 'MISSING_IMAGES' ? (issue.scenes || []).map((scene) => Number(scene.id)) : []));
  }

  return {
    mode,
    storyboards: storyboards.filter((sb) => targetIds.has(Number(sb.id))),
    targetIds,
    reason: targetIds.size ? 'matched' : 'empty',
  };
}

export function deriveProjectLifecycleStatus(projectId: unknown) {
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

export function completeProjectCheck(projectId: unknown, { persist = true }: { persist?: boolean } = {}) {
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

export async function runProjectImageBatch(taskId: string, projectId: string | number, payload: JsonObject = {}): Promise<void> {
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
  const result: BatchResult = {
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
      result.skipped.push(...targets.slice(i).map((storyboard: SqlRow) => ({ storyboard_id: storyboard.id, scene_number: storyboard.scene_number, reason: '任务已取消' })));
      taskManager.cancel(taskId, '已取消批量生图');
      return;
    }
    const sb = targets[i];
    if (!sb) continue;
    const progress = Math.max(1, Math.round((i / targets.length) * 92));
    taskManager.progress(taskId, progress, `正在生成分镜 ${sb.scene_number || i + 1} 的图片…`);
    try {
      const generated = await generateStoryboardImage({
        storyboard: sb,
        project,
        reason: mode,
        model: String(payload.model || 'auto'),
        ratio: String(payload.ratio || project.ratio || '16:9'),
        consistencyMode: String(payload.consistencyMode || payload.consistency_mode || 'standard'),
        batchSize: Number(payload.batch_size_per_scene || payload.batchSize || 2),
        reuseCache: payload.reuse_cache !== false,
        taskId,
      });
      result.successes.push({ storyboard_id: sb.id, scene_number: sb.scene_number, ...generated });
    } catch (error: unknown) {
      const diagnosis = failureAdvisor.diagnose(error, {
        projectId,
        taskId,
        stageHint: 'image',
        currentMessage: `分镜 ${sb.scene_number || i + 1} 图片生成失败`,
      });
      result.failures.push({
        storyboard_id: sb.id,
        scene_number: sb.scene_number,
        message: errorMessage(error),
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
    const error = Object.assign(new Error(`全部图片生成失败：${result.failures[0]?.message || '未知错误'}`), {
      diagnosis: result.failures[0]?.diagnosis,
    });
    taskManager.update(taskId, { result: finalResult });
    taskManager.fail(taskId, error);
  } else {
    taskManager.succeed(taskId, finalResult, `图片生成完成：${result.successes.length}/${targets.length}`);
  }
}

export async function repairWorkbench(projectId: unknown, payload: JsonObject = {}) {
  const type = cleanText(payload.type || payload.repair_type || 'auto', 80);
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const result: { type: string; actions: JsonObject[]; generated: unknown[]; fixed: number; status?: unknown } = { type, actions: [], generated: [], fixed: 0 };
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
    const missing = new Set((health?.issues || []).flatMap((issue) => issue.code === 'MISSING_IMAGES' ? (issue.scenes || []).map((scene) => Number(scene.id)) : []));
    const targets = db.prepare('SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC, scene_number ASC').all(projectId)
      .filter((sb) => missing.has(Number(sb.id)));
    for (const sb of targets) {
      result.generated.push(await generateStoryboardImage({
        storyboard: sb,
        project,
        reason: 'missing_image',
        model: String(payload.model || 'auto'),
        ratio: typeof payload.ratio === 'string' ? payload.ratio : null,
        consistencyMode: String(payload.consistencyMode || 'standard'),
      }));
    }
    result.actions.push({ type: 'missing_images', count: targets.length, message: `已处理 ${targets.length} 个缺图分镜` });
  }
  if (type === 'low_score_images') {
    const checks = lastContinuityChecks(projectId).filter((check) => check.status === 'risk' || Number(check.score) < 60);
    const ids = new Set(checks.map((check) => Number(check.storyboard_id)).filter(Boolean));
    const targets = db.prepare('SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC, scene_number ASC').all(projectId)
      .filter((sb) => ids.has(Number(sb.id)));
    for (const sb of targets) {
      result.generated.push(await generateStoryboardImage({
        storyboard: sb,
        project,
        reason: 'low_score',
        model: String(payload.model || 'auto'),
        ratio: typeof payload.ratio === 'string' ? payload.ratio : null,
        consistencyMode: String(payload.consistencyMode || 'standard'),
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

export function getSeriesView(projectId: unknown) {
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
    episodes: rows.map((row: SqlRow) => ({
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
