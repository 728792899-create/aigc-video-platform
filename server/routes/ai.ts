import express from 'express'
import { redactDiagnostic } from '../services/appError'

const router = express.Router();
const { generateScript, expandDialog, optimizeTheme } = require('../services/deepseek');
const { generateTTS } = require('../services/tts');
const imageGen = require('../services/imageGen');
const imageStats = require('../services/imageStats');
const { getDb } = require('../db');
const taskManager = require('../services/taskManager');
const { toRelative } = require('../utils/fileCleanup');
const { getSkillPrompt, getEffectiveSkillPrompt } = require('./skills');
const idempotency = require('../services/idempotency');
const { validateBody, schemas } = require('../services/validation');
const opLog = require('../services/opLog');
const config = require('../services/config');
const autoProduceQueue = require('../services/autoProduceQueue');
const failureAdvisor = require('../services/failureAdvisor');
const assetNaming = require('../services/assetNaming');
const continuity = require('../services/continuity');
const promptCompiler = require('../services/promptCompiler');
const { createWorkflow } = require('../services/workflowStateMachine');
const credentialStore = require('../services/credentialStore');
const { shouldAutoSelectCandidate } = require('../services/candidateReview');

type EntityId = string | number
type JsonObject = Record<string, unknown>

interface AutoProduceInput extends JsonObject {
  style?: string
  duration?: string | number
  model?: string
  ratio?: string
  voice?: string
  scriptProvider?: string
  scriptModel?: string
  background?: boolean
  showProcess?: boolean
  notifyOnComplete?: boolean
  consistencyMode?: string
  consistency_mode?: string
  workflowMode?: string
  workflow_mode?: string
}

interface AutoProduceDefaults extends JsonObject {
  style: string
  duration: string
  model: string
  ratio: string
  voice: string
  scriptProvider: string
  scriptModel?: string
  background: boolean
  showProcess: boolean
  notifyOnComplete: boolean
  consistencyMode: string
  workflowMode: string
}

interface StoryboardRow extends JsonObject {
  id: EntityId
  project_id: EntityId
  description?: string
  dialog?: string
  prompt?: string
  selected_image_id?: EntityId | null
}

interface ContinuityContext extends JsonObject {
  promptAnchor?: string
  referenceImages: Array<JsonObject & { id?: EntityId; image_id?: EntityId }>
  warnings: string[]
  characters?: JsonObject[]
  mode?: string
}

interface LocalImageFile extends JsonObject {
  local_path: string
  file_url: string
  file_path?: string
}

interface ImageGenerationResult extends JsonObject {
  prompt: string
  negative_prompt?: string
  model?: string
  provider?: string
  submit_id?: string
  gen_status?: string
  local_files: LocalImageFile[]
  attempts?: Array<JsonObject & { model?: string; ok?: boolean }>
  notice?: string
  is_placeholder?: boolean
  downgraded?: boolean
}

interface ImageGenerationOptions extends JsonObject {
  compiledPrompt?: JsonObject & { prompt: string; negativePrompt: string; promptHash: string; contextHash: string }
  autoSelectBest?: boolean
  reuseCache?: boolean
}

interface ImageMetadata extends JsonObject {
  taskId?: string
  referenceImageIds?: EntityId[]
  consistencyMode?: string
}

interface CachedGeneration extends JsonObject {
  id: EntityId
  prompt?: string
  model?: string
  result: JsonObject & {
    image_ids?: EntityId[]
    selected_image_id?: EntityId
    prompt?: string
    model?: string
    notice?: string
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function asRecord(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value))
}

const safeError = (error: unknown): string => redactDiagnostic(
  credentialStore.redact(errorMessage(error || '未知错误')),
);
const isDemoMode = (): boolean => ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase());

/**
 * 一键成片失败后的项目清理。
 * - 若项目从未产出任何分镜（典型：未配 API Key，文案第一步就失败）→ 直接删除这个空壳项目，
 *   避免桌面/项目列表里堆一堆点不开的空项目。FK CASCADE 会清理可能存在的子行。
 * - 若已经生成了分镜（部分成功）→ 保留并标记 partial，便于用户手动补救，不删用户已有的劳动成果。
 */
function cleanupFailedAutoProduce(projectId: EntityId): { hasContent: boolean; projectStatus: string } {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ?').get(projectId);
    const hasContent = Boolean(row && Number(row.n) > 0);
    if (hasContent) {
      db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('partial', projectId);
      return { hasContent: true, projectStatus: 'partial' };
    } else {
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      console.log(`[auto-produce] 已清理空壳项目 #${projectId}（无任何分镜产出）`);
      return { hasContent: false, projectStatus: 'deleted' };
    }
  } catch (e: unknown) {
    console.error('[auto-produce] 清理失败项目出错:', safeError(e));
  }
  return { hasContent: false, projectStatus: 'unknown' };
}

function normalizeDuration(value: unknown): string {
  if (value != null && value !== '') return String(value);
  const configured = String(config.get('defaultDuration') || '150-210');
  return configured === '60-180' ? '150-210' : configured;
}

function autoProduceDefaults(body: AutoProduceInput): AutoProduceDefaults {
  const stageScript = config.get('stageModels.script') || {};
  return {
    style: body.style || config.get('defaultStyle') || '写实',
    duration: normalizeDuration(body.duration),
    model: body.model || config.get('defaultImageModel') || 'auto',
    ratio: body.ratio || '16:9',
    voice: body.voice || config.get('defaultVoice') || 'xiaoxiao',
    scriptProvider: body.scriptProvider || stageScript.provider || 'deepseek',
    scriptModel: body.scriptModel || stageScript.model,
    background: body.background !== false,
    showProcess: body.showProcess === true,
    notifyOnComplete: body.notifyOnComplete !== false,
    consistencyMode: body.consistencyMode || body.consistency_mode || 'standard',
    workflowMode: body.workflowMode || body.workflow_mode || 'guided',
  };
}

function finishAutoProduceFailure(taskId: string, projectId: EntityId, err: unknown): void {
  const task = taskManager.get(taskId);
  const diagnosis = failureAdvisor.diagnose(err, {
    projectId,
    taskId,
    currentMessage: task && task.message,
    stageHint: err && typeof err === 'object' && 'stageHint' in err ? err.stageHint : undefined,
    assetHealth: err && typeof err === 'object' && 'assetHealth' in err ? err.assetHealth : undefined,
  });
  const cleanup = cleanupFailedAutoProduce(projectId);
  const error = Object.assign(
    err instanceof Error ? err : new Error(String(err || '一键成片失败')),
    { diagnosis },
  );
  if (cleanup.hasContent) {
    taskManager.update(taskId, {
      status: 'partial',
      progress: Math.max(task?.progress || 0, 1),
      message: `${diagnosis.title}，已保留可编辑半成品`,
      error: diagnosis.rawError,
      diagnosis,
      result: { project_id: projectId, partial: true, diagnosis, partialResult: diagnosis.partialResult },
    });
    return;
  }
  taskManager.fail(taskId, error);
}

async function runAutoProduceTask(taskId: string, projectId: EntityId, produceParams: JsonObject): Promise<void> {
  const { runAutoProduce } = require('../services/pipeline');
  taskManager.start(taskId, '准备中...');
  try {
    const result = await runAutoProduce(
      { ...produceParams, projectId, taskId },
      (progress: number, message: string) => {
        const task = taskManager.get(taskId);
        if (progress >= 80 || /合成|视频/.test(String(message || ''))) {
          taskManager.update(taskId, {
            status: 'composing',
            progress: Math.min(99, Math.max(0, Math.round(progress || 80))),
            message: message || '正在合成视频...',
          });
        } else {
          taskManager.progress(taskId, progress, message);
        }
      }
    );
    if (result?.canceled) {
      taskManager.partial(taskId, result, '已在分镜边界停止，半成品已保留');
      return;
    }
    taskManager.succeed(taskId, result, '🎬 视频已生成');
  } catch (err: unknown) {
    console.error('[auto-produce] 失败:', safeError(err));
    try {
      const workflow = taskManager.get(taskId)?.meta?.workflow;
      const currentStage = workflow?.current_stage;
      if (currentStage && workflow?.stages?.[currentStage]?.status === 'running') {
        taskManager.transitionStage(taskId, { type: 'FAIL', stage: currentStage, error: errorMessage(err) });
      }
    } catch {}
    finishAutoProduceFailure(taskId, projectId, err);
  }
}

// AI文案生成
router.post('/generate-script', idempotency({ scope: 'ai.generate-script' }), validateBody(schemas.generateScript), async (req, res) => {
  try {
    const { theme, duration, style, scriptProvider, scriptModel, detailLevel, skill_id, skill_ids, project_id } = req.body;
    if (!theme) return res.status(400).json({ code: 400, data: null, message: '请输入创作主题' });
    const override: JsonObject = {};
    if (scriptProvider) { override.provider = scriptProvider; override.model = scriptModel; }
    if (detailLevel) override.detailLevel = detailLevel;
    if (project_id) {
      try { override.continuityContext = continuity.buildScriptContext(project_id); } catch (_) {}
    }
    // ⑦ 创作技能：必用技能(auto_apply)自动注入 + 用户手动勾选的可选技能(skill_ids/skill_id)，合并去重
    const manualIds = Array.isArray(skill_ids) ? skill_ids : (skill_id != null ? [skill_id] : []);
    const skill = getEffectiveSkillPrompt('script', manualIds);
    if (skill.text) override.skillPrompt = skill.text;
    const result = await generateScript(theme, duration, style, Object.keys(override).length ? override : null);
    if (project_id && result) {
      try {
        continuity.ensureSeriesForProject(project_id);
        continuity.updateStoryBible(project_id, {
          ...(result.story_bible || {}),
          style_anchor: result.visual_anchor || undefined,
          previous_summary: result.summary || undefined,
        });
      } catch (_) {}
    }
    res.json({ code: 200, data: { ...result, _skills: { auto: skill.autoCount, manual: skill.manualCount } }, message: '生成成功' });
  } catch (err: unknown) {
    const details = asRecord(err);
    if (details.code === 'SCRIPT_OUTPUT_INVALID') {
      return res.status(502).json({
        code: 502,
        data: {
          code: details.code,
          retryable: details.retryable === true,
          diagnostic_ref: details.diagnosticRef,
          issues: Array.isArray(details.issues) ? details.issues : [],
        },
        message: safeError(err),
      });
    }
    res.status(500).json({ code: 500, data: null, message: `文案生成失败: ${safeError(err)}` });
  }
});

// AI 扩写/改写单条台词（功能⑥：让 dialog 更丰富）
router.post('/expand-dialog', idempotency({ scope: 'ai.expand-dialog' }), async (req, res) => {
  try {
    const { dialog, storyboard_id, detailLevel, skill_id, skill_ids, scriptProvider, scriptModel } = req.body;
    let text = dialog, scene = '', style = '写实';
    if (storyboard_id) {
      const sb = getDb().prepare('SELECT * FROM storyboards WHERE id=?').get(storyboard_id);
      if (sb) {
        if (text == null) text = sb.dialog;
        scene = sb.description || '';
        const project = getDb().prepare('SELECT style FROM projects WHERE id=?').get(sb.project_id);
        style = project?.style || '写实';
      }
    }
    if (!text || !String(text).trim()) return res.status(400).json({ code: 400, data: null, message: '台词内容为空' });
    const override = scriptProvider ? { provider: scriptProvider, model: scriptModel } : null;
    // ⑦ 创作技能：必用技能自动注入 + 用户手动勾选
    const manualIds = Array.isArray(skill_ids) ? skill_ids : (skill_id != null ? [skill_id] : []);
    const skill = getEffectiveSkillPrompt('script', manualIds);
    const expanded = await expandDialog(text, {
      style, scene, detailLevel: detailLevel || 'rich',
      skillPrompt: skill.text || '', override,
    });
    res.json({ code: 200, data: { dialog: expanded }, message: '改写成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `台词改写失败: ${safeError(err)}` });
  }
});

// ✨ 主题 AI 优化（问题7）：把口语化主题润色成更具画面感的脚本起点。复用脚本阶段路由（默认内置 DeepSeek key）
router.post('/optimize-theme', idempotency({ scope: 'ai.optimize-theme' }), validateBody(schemas.optimizeTheme), async (req, res) => {
  try {
    const { theme, style, scriptProvider, scriptModel } = req.body;
    if (!theme || !String(theme).trim()) {
      return res.status(400).json({ code: 400, data: null, message: '请输入要优化的主题' });
    }
    // 主题只是一句创意起点，正常 ≤80 字。截断超长输入，避免浪费 token 或触发上游限流。
    const cleanTheme = String(theme).trim().slice(0, 500);
    const override = scriptProvider ? { provider: scriptProvider, model: scriptModel } : null;
    const optimized = await optimizeTheme(cleanTheme, { style: style || '', override });
    res.json({ code: 200, data: { theme: optimized, original: cleanTheme }, message: '优化成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `主题优化失败: ${safeError(err)}` });
  }
});

// 列出可用图片生成模型
router.get('/image-models', (req, res) => {
  res.json({ code: 200, data: imageGen.listModels(), message: 'success' });
});

// AI图片生成（异步任务模式，立即返回 task_id，通过 SSE/轮询获取进度）
router.post('/generate-image', idempotency({ scope: 'ai.generate-image' }), validateBody(schemas.generateImage), async (req, res) => {
  try {
    const {
      storyboard_id, prompt: userPrompt, ratio, model, async: asyncMode, batch_size, skill_id, skill_ids,
      character_ids, reference_image_ids, consistency_mode, consistencyMode, reference_strength,
      repair_mode, auto_select_best, reuse_cache,
    } = req.body;
    if (!storyboard_id) {
      return res.status(400).json({ code: 400, data: null, message: '缺少 storyboard_id' });
    }

    const sb = getDb().prepare('SELECT * FROM storyboards WHERE id = ?').get(storyboard_id);
    if (!sb) return res.status(404).json({ code: 404, data: null, message: '分镜不存在' });
    const project = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(sb.project_id);
    const style = project?.style || 'realistic';
    // v1.6.5 画风一致性：手动重配某张图时也带上项目级全局视觉设定 + 基准 seed，
    // 保证重配后的图与其它分镜画风一致。
    const visualAnchor = (project?.visual_anchor || '').toString().trim();
    const imageSeed = project?.image_seed != null ? Number(project.image_seed) : null;
    let continuityContext: ContinuityContext = { promptAnchor: '', referenceImages: [], warnings: [] };
    try {
      continuityContext = continuity.prepareImageContext({
        projectId: sb.project_id,
        storyboardId: storyboard_id,
        characterIds: character_ids,
        referenceImageIds: reference_image_ids,
        consistencyMode: consistencyMode || consistency_mode || 'standard',
        referenceStrength: reference_strength,
      });
    } catch (err: unknown) {
      const details = asRecord(err);
      const advice = Array.isArray(details.advice)
        ? details.advice.filter((item): item is string => typeof item === 'string')
        : [];
      return res.status(400).json({
        code: 400,
        data: { code: details.code, advice },
        message: `${safeError(err)}${advice.length ? `：${advice.join('；')}` : ''}`,
      });
    }
    // ⑦ 创作技能：把「画面阶段必用技能(auto_apply) + 用户手动勾选技能」并入用户提示词，增强画面生成
    const manualIds = Array.isArray(skill_ids) ? skill_ids : (skill_id != null ? [skill_id] : []);
    const skill = getEffectiveSkillPrompt('image', manualIds);
    let effectivePrompt = userPrompt;
    if (skill.text) {
      effectivePrompt = [userPrompt, skill.text].filter(Boolean).join(', ');
    }
    const compiledPrompt = promptCompiler.compileImagePrompt({
      project,
      storyboard: sb,
      userPrompt: effectivePrompt || sb.prompt || '',
      style,
      visualAnchor,
      continuityContext,
    });
    const shouldAutoSelectBest = auto_select_best === true || repair_mode === true || repair_mode === 'true';
    const mayAutoSelect = shouldAutoSelectCandidate({
      currentSelectedId: sb.selected_image_id,
      explicitRepair: repair_mode === true || repair_mode === 'true',
    });
    const shouldReuseCache = reuse_cache === true || reuse_cache === 'true';

    // 如果 async=true，立即返回 task_id，后台运行
    if (asyncMode) {
      const task = taskManager.create('image', { storyboard_id, model: model || 'flux', batch_size: batch_size || 1 });
      res.json({ code: 200, data: { task_id: task.id }, message: '任务已提交' });

      // 后台执行（不 await）；兜底 catch 防止极早期抛错变成 unhandledRejection
      doImageGeneration(task.id, sb, style, effectivePrompt, ratio, model, storyboard_id, batch_size, '', imageSeed, continuityContext, {
        compiledPrompt,
        autoSelectBest: shouldAutoSelectBest && mayAutoSelect,
        reuseCache: shouldReuseCache,
      })
        .catch((e) => {
          console.error('doImageGeneration 启动失败:', safeError(e));
          try { taskManager.fail(task.id, e); } catch (_) {}
        });
      return;
    }

    if (shouldReuseCache) {
      const cached = promptCompiler.getCachedGeneration({
        kind: 'image',
        model: model || 'auto',
        promptHash: compiledPrompt.promptHash,
        contextHash: compiledPrompt.contextHash,
        storyboardId: storyboard_id,
      });
      const cachedPayload = applyCachedImageResult(storyboard_id, cached, shouldAutoSelectBest && mayAutoSelect);
      if (cachedPayload) {
        return res.json({
          code: 200,
          data: {
            ...cachedPayload,
            prompt: compiledPrompt.prompt,
            negative_prompt: compiledPrompt.negativePrompt,
            continuity: {
              warnings: ['命中生成缓存，已复用上次结果。如需全新画面，请关闭复用缓存。', ...(continuityContext.warnings || [])],
              checks: [],
              characters: continuityContext.characters || [],
            },
          },
          message: '已复用上次生成结果',
        });
      }
    }

    // 同步模式（兼容旧前端）
    const result = await imageGen.generate({
      description: sb.description || sb.dialog || '',
      userPrompt: '',
      style,
      ratio: ratio || '16:9',
      model: model || 'flux',
      batchSize: batch_size || 1,
      visualAnchor: '', seed: imageSeed,
      referenceImages: continuityContext.referenceImages,
      consistencyMode: continuityContext?.mode || consistencyMode || consistency_mode || 'standard',
      promptOverride: compiledPrompt.prompt,
      negativePromptOverride: compiledPrompt.negativePrompt,
    });

    const insertedIds = saveImageResults(storyboard_id, result, {
      referenceImageIds: (continuityContext?.referenceImages || [])
        .map((item) => item.id ?? item.image_id)
        .filter((id): id is EntityId => id !== undefined),
      consistencyMode: continuityContext?.mode || consistencyMode || consistency_mode || 'standard',
    });
    recordImageResult(sb, storyboard_id, model, result);
    const checks = insertedIds.map((id) => continuity.evaluateStoryboard(sb.project_id, storyboard_id, id)).filter(Boolean);
    const selected = shouldAutoSelectBest && mayAutoSelect ? autoSelectBestImage(storyboard_id, insertedIds, checks) : null;
    // 占位图不计真实成功，也不进入缓存，避免下次被当成真实生成结果复用。
    if (!result.is_placeholder) promptCompiler.saveGenerationCache({
      kind: 'image',
      model: model || 'auto',
      provider: result.provider,
      projectId: sb.project_id,
      storyboardId: storyboard_id,
      prompt: compiledPrompt.prompt,
      promptHash: compiledPrompt.promptHash,
      contextHash: compiledPrompt.contextHash,
      result: {
        image_ids: insertedIds,
        selected_image_id: selected?.id || insertedIds[0] || null,
        prompt: compiledPrompt.prompt,
        model: result.model,
        provider: result.provider,
        notice: result.notice || '',
      },
    });

    res.json({
      code: 200,
      data: {
        prompt: result.prompt,
        negative_prompt: result.negative_prompt,
        model: result.model,
        submit_id: result.submit_id,
        gen_status: result.gen_status,
        image_count: result.local_files.length,
        image_ids: insertedIds,
        selected_image_id: selected?.id || null,
        auto_selected_best: !!selected,
        files: result.local_files,
        attempts: result.attempts || [],
        notice: result.notice || '',
        is_placeholder: !!result.is_placeholder,
        downgraded: !!result.downgraded,
        continuity: {
          warnings: continuityContext.warnings || [],
          checks,
          characters: continuityContext.characters || [],
        },
      },
      message: result.notice || (result.local_files.length > 0 ? '生成成功' : '生成完成但未获取到图片'),
    });
  } catch (err) {
    console.error('generate-image error:', safeError(err));
    res.status(500).json({ code: 500, data: null, message: `图片生成失败: ${safeError(err)}` });
  }
});

// 异步图片生成后台执行
async function doImageGeneration(
  taskId: string,
  sb: StoryboardRow,
  style: string,
  userPrompt: string | undefined,
  ratio: string | undefined,
  model: string | undefined,
  storyboardId: EntityId,
  batchSize: number | undefined,
  visualAnchor = '',
  seed: number | null = null,
  continuityContext: ContinuityContext | null = null,
  options: ImageGenerationOptions = {},
): Promise<void> {
  try {
    taskManager.start(taskId, '正在构建提示词…');
    const compiledPrompt = options.compiledPrompt || promptCompiler.compileImagePrompt({
      project: getDb().prepare('SELECT * FROM projects WHERE id = ?').get(sb.project_id),
      storyboard: sb,
      userPrompt: userPrompt || sb.prompt || '',
      style,
      visualAnchor,
      continuityContext,
    });

    if (options.reuseCache) {
      const cached = promptCompiler.getCachedGeneration({
        kind: 'image',
        model: model || 'auto',
        promptHash: compiledPrompt.promptHash,
        contextHash: compiledPrompt.contextHash,
        storyboardId,
      });
      const cachedPayload = applyCachedImageResult(storyboardId, cached, options.autoSelectBest);
      if (cachedPayload) {
        taskManager.succeed(taskId, {
          ...cachedPayload,
          prompt: compiledPrompt.prompt,
          negative_prompt: compiledPrompt.negativePrompt,
          continuity: {
            warnings: ['命中生成缓存，已复用上次结果。如需全新画面，请关闭复用缓存。', ...(continuityContext?.warnings || [])],
            checks: [],
            characters: continuityContext?.characters || [],
          },
        }, '已复用上次生成结果');
        return;
      }
    }

    taskManager.progress(taskId, 10, `正在调用 AI 生成 ${batchSize || 1} 张候选图…`);

    const result = await imageGen.generate({
      description: sb.description || sb.dialog || '',
      userPrompt: '',
      style,
      ratio: ratio || '16:9',
      model: model || 'flux',
      batchSize: batchSize || 1,
      visualAnchor: '', seed,
      referenceImages: continuityContext?.referenceImages || [],
      consistencyMode: continuityContext?.mode || 'standard',
      promptOverride: compiledPrompt.prompt,
      negativePromptOverride: compiledPrompt.negativePrompt,
      onProgress: (done: number, total: number) => {
        const pct = 10 + Math.round((70 * done) / total);
        taskManager.progress(taskId, pct, `已完成 ${done}/${total} 张候选图…`);
      },
      onNotice: (msg: string) => {
        // 把模型切换/失败提示透传到任务进度消息，前端 TaskDock 实时可见
        const cur = taskManager.get(taskId);
        taskManager.progress(taskId, cur ? cur.progress : 10, msg);
      },
    });

    taskManager.progress(taskId, 85, '正在保存图片…');
    const insertedIds = saveImageResults(storyboardId, result, {
      taskId,
      referenceImageIds: (continuityContext?.referenceImages || [])
        .map((item) => item.id ?? item.image_id)
        .filter((id): id is EntityId => id !== undefined),
      consistencyMode: continuityContext?.mode || 'standard',
    });
    recordImageResult(sb, storyboardId, model, result);
    const checks = insertedIds.map((id) => continuity.evaluateStoryboard(sb.project_id, storyboardId, id)).filter(Boolean);
    const selected = options.autoSelectBest ? autoSelectBestImage(storyboardId, insertedIds, checks) : null;
    if (!result.is_placeholder) promptCompiler.saveGenerationCache({
      kind: 'image',
      model: model || 'auto',
      provider: result.provider,
      projectId: sb.project_id,
      storyboardId,
      prompt: compiledPrompt.prompt,
      promptHash: compiledPrompt.promptHash,
      contextHash: compiledPrompt.contextHash,
      result: {
        image_ids: insertedIds,
        selected_image_id: selected?.id || insertedIds[0] || null,
        prompt: compiledPrompt.prompt,
        model: result.model,
        provider: result.provider,
        notice: result.notice || '',
      },
    });

    taskManager.succeed(taskId, {
      prompt: result.prompt,
      negative_prompt: result.negative_prompt,
      model: result.model,
      image_count: result.local_files.length,
      image_ids: insertedIds,
      selected_image_id: selected?.id || null,
      auto_selected_best: !!selected,
      files: result.local_files,
      attempts: result.attempts || [],
      notice: result.notice || '',
      is_placeholder: !!result.is_placeholder,
      downgraded: !!result.downgraded,
      continuity: {
        warnings: continuityContext?.warnings || [],
        checks,
        characters: continuityContext?.characters || [],
      },
    }, result.notice || '图片生成完成');
  } catch (err) {
    console.error('async generate-image error:', safeError(err));
    taskManager.fail(taskId, err);
  }
}

// 共用的落库逻辑
function saveImageResults(
  storyboardId: EntityId,
  result: ImageGenerationResult,
  metadata: ImageMetadata = {},
): EntityId[] {
  const insertedIds: EntityId[] = [];
  for (const lf of result.local_files) {
    const insRes = getDb().prepare(
      `INSERT INTO images (storyboard_id, prompt, file_path, file_url, submit_id, gen_status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      storyboardId,
      result.prompt,
      toRelative(lf.local_path),
      lf.file_url,
      result.submit_id || '',
      result.is_placeholder ? 'placeholder' : 'success'
    );
    insertedIds.push(insRes.lastInsertRowid);
    try {
      const normalizedUrl = assetNaming.normalizeImageRecord(insRes.lastInsertRowid);
      if (normalizedUrl) {
        lf.file_url = normalizedUrl;
        lf.file_path = normalizedUrl;
      }
    } catch (e: unknown) {
      console.warn('[assetNaming] 图片命名整理失败:', errorMessage(e));
    }
  }
  require('../services/candidateMetadata').annotateCandidates(insertedIds, {
    ...metadata,
    provider: result.provider,
    model: result.model,
    prompt: result.prompt,
  });
  // storyboard.prompt 是用户可编辑的原始输入；实际发送给 Provider 的 compiled
  // prompt 已保存在 Candidate 和任务快照中。这里不可回写，否则下一次生成会把
  // 风格、角色和连续性上下文再次嵌套，造成 Prompt 递归膨胀。
  // ③ 自动选图：若该分镜还没有选中图片，自动选中刚生成的第一张，
  // 避免用户忘记在图片页点「使用」导致导出时报「没有可用的图片」。
  if (insertedIds.length > 0) {
    const sb = getDb().prepare('SELECT selected_image_id FROM storyboards WHERE id = ?').get(storyboardId);
    if (sb && !sb.selected_image_id) {
      getDb().prepare('UPDATE storyboards SET selected_image_id = ? WHERE id = ?')
        .run(insertedIds[0], storyboardId);
    }
  }
  return insertedIds;
}

function recordImageResult(
  sb: StoryboardRow,
  storyboardId: EntityId,
  requestedModel: string | undefined,
  result: ImageGenerationResult,
): void {
  imageStats.record({
    projectId: sb.project_id,
    storyboardId,
    requestedModel: requestedModel || 'flux',
    firstModel: result.attempts?.[0]?.model || '',
    firstAttemptOk: !!result.attempts?.[0]?.ok,
    finalOk: !result.is_placeholder,
    usedPlaceholder: !!result.is_placeholder,
    downgraded: !!result.downgraded,
    attemptsCount: result.attempts?.length || 0,
    finalProvider: result.provider || '',
    source: 'manual',
  });
}

function autoSelectBestImage(storyboardId: EntityId, insertedIds: EntityId[] = [], checks: JsonObject[] = []): JsonObject | null {
  if (!insertedIds.length) return null;
  const rows = insertedIds
    .map((id: EntityId) => getDb().prepare('SELECT * FROM images WHERE id = ?').get(id))
    .filter(Boolean);
  const ranked = promptCompiler.rankImageCandidates(rows, checks);
  const best = ranked[0]?.image || rows[0];
  if (best?.id) {
    getDb().prepare('UPDATE storyboards SET selected_image_id = ?, quality_status = ? WHERE id = ?')
      .run(best.id, ranked[0]?.score >= 80 ? 'stable' : 'review', storyboardId);
  }
  return best || null;
}

function applyCachedImageResult(
  storyboardId: EntityId,
  cached: CachedGeneration | null | undefined,
  autoSelectBest = false,
): JsonObject | null {
  if (!cached) return null;
  const ids = (cached.result.image_ids || []).map(Number).filter(Boolean);
  if (!ids.length) return null;
  const rows = ids.map((id: number) => getDb().prepare('SELECT * FROM images WHERE id = ?').get(id)).filter(Boolean);
  if (!rows.length) return null;
  const selectedId = cached.result.selected_image_id || rows[0].id;
  const selected = rows.find((r: JsonObject) => Number(r.id) === Number(selectedId)) || rows[0];
  const current = getDb().prepare('SELECT selected_image_id FROM storyboards WHERE id = ?').get(storyboardId);
  const canReplace = autoSelectBest || !current?.selected_image_id;
  if (canReplace) {
    getDb().prepare('UPDATE storyboards SET selected_image_id = ? WHERE id = ?')
      .run(selected.id, storyboardId);
  }
  return {
    reused_cache: true,
    cache_id: cached.id,
    image_count: rows.length,
    image_ids: rows.map((r: JsonObject) => r.id),
    selected_image_id: require('../services/candidateReview').resolveSelectedCandidateId({
      currentSelectedId: current?.selected_image_id,
      candidateId: selected.id,
      canReplace,
    }),
    suggested_candidate_id: selected.id,
    files: rows.map((r: JsonObject) => ({ file_url: r.file_url, file_path: r.file_path })),
    model: cached.result.model || cached.model || '',
    notice: cached.result.notice || '',
  };
}

// ============ 一键成片：输入主题，自动产出整条视频 ============
// 立即创建项目 + 提交异步任务，返回 { project_id, task_id }，
// 前端用 task_id 走 SSE/轮询展示全流程进度。
router.post('/auto-produce', idempotency({ scope: 'ai.auto-produce' }), validateBody(schemas.autoProduce), async (req, res) => {
  try {
    const { theme, name, motion, bgm, bgmVolume, subtitleStyle, videoProvider, videoModel, i2v, voiceProvider, voiceModel, scriptSkillIds, imageSkillIds } = req.body;
    if (!theme || !theme.trim()) {
      return res.status(400).json({ code: 400, data: null, message: '请输入创作主题' });
    }
    const defaults = autoProduceDefaults(req.body);

    // 0) 预检：一键成片第一步就是 AI 文案，需要剧本 provider 的 API Key。
    //    未配置则【在建项目之前】直接拦下，给明确指引，避免在轻薄本等未配 Key 的机器上
    //    创建出点不开的空壳项目（API Key 按机器存本地 settings，不随安装包走）。
    try {
      const providers = require('../services/providers');
      const scriptProv = defaults.scriptProvider || 'deepseek';
      const demoMode = isDemoMode();
      if (!demoMode && !providers.hasCredentials(scriptProv)) {
        const def = providers.getProvider(scriptProv);
        const label = (def && def.label) || scriptProv;
        return res.status(400).json({
          code: 400, data: null,
          message: `「一键成片」需要先配置 ${label} 的 API Key。请到「系统设置 → 模型路由」填写后再试。`,
        });
      }
    } catch (e: unknown) {
      console.warn('[auto-produce] 预检 API Key 异常（放行继续）:', errorMessage(e));
    }

    // 1) 先建项目（用主题做默认名）
    const projName = (name && name.trim()) || theme.trim().slice(0, 30);
    const projRes = getDb().prepare(
      'INSERT INTO projects (name, theme, style, status) VALUES (?, ?, ?, ?)'
    ).run(projName, theme.trim(), defaults.style, 'generating');
    const projectId = projRes.lastInsertRowid;

    // 2) 创建任务并立即返回。meta 里完整存下成片参数，失败后可一键重试（D 功能）。
    const produceParams = {
      theme: theme.trim(),
      style: defaults.style,
      duration: defaults.duration,
      model: defaults.model,
      ratio: defaults.ratio,
      voice: defaults.voice,
      name, motion, bgm, bgmVolume, subtitleStyle,
      scriptProvider: defaults.scriptProvider,
      scriptModel: defaults.scriptModel,
      videoProvider, videoModel, i2v, voiceProvider, voiceModel,
      scriptSkillIds, imageSkillIds,
      consistencyMode: defaults.consistencyMode,
      workflowMode: defaults.workflowMode,
      // 仅 DEMO_MODE 下由流水线读取，用于可复现的恢复/重试验收。
      demoStageDelayMs: req.body.demoStageDelayMs,
      demoDelayStage: req.body.demoDelayStage,
      demoFailStageOnce: req.body.demoFailStageOnce,
    };
    const task = taskManager.create('auto-produce', {
      project_id: projectId,
      theme: theme.trim(),
      attempt: 1,
      idempotency_key: req.idempotency?.key || null,
      input_hash: req.idempotency?.requestHash || null,
      params: produceParams,
      background: defaults.background,
      showProcess: defaults.showProcess,
      notifyOnComplete: defaults.notifyOnComplete,
      workflow_mode: defaults.workflowMode,
      workflow: createWorkflow({ projectId, topic: theme.trim() }),
      recovery: { kind: 'auto-produce', mode: isDemoMode() ? 'safe-auto' : 'manual-reconcile', attempts: 0, max_attempts: 3 },
      demo_mode: isDemoMode(),
      providers: {
        script: defaults.scriptProvider,
        image: defaults.model,
        video: videoProvider || 'static',
        voice: voiceProvider || 'edge',
      },
    });
    opLog.log('auto-produce.start', 'project', projectId, { theme: theme.trim().slice(0, 80), task_id: task.id });

    const queued = autoProduceQueue.enqueue(task, () => runAutoProduceTask(task.id, projectId, produceParams));
    res.json({
      code: 200,
      data: {
        project_id: projectId,
        task_id: task.id,
        status: queued.status,
        queue_position: queued.queue_position,
        queue: autoProduceQueue.stats(),
      },
      message: queued.status === 'waiting' ? '任务已提交，正在排队' : '已开始一键成片',
    });
  } catch (err) {
    console.error('auto-produce error:', safeError(err));
    res.status(500).json({ code: 500, data: null, message: `一键成片启动失败: ${safeError(err)}` });
  }
});

// ============ 一键成片：失败重试（复用原任务存的参数，重跑同一项目）============
router.post('/auto-produce/:taskId/retry', idempotency(), async (req, res) => {
  try {
    const prev = taskManager.get(req.params.taskId);
    if (!prev) {
      return res.status(404).json({ code: 404, data: null, message: '原任务不存在或已过期' });
    }
    const params = prev.meta && prev.meta.params;
    const projectId = prev.meta && prev.meta.project_id;
    if (!params || !projectId) {
      return res.status(400).json({ code: 400, data: null, message: '原任务缺少可重试的参数' });
    }
    if (['pending', 'waiting', 'running', 'composing'].includes(prev.status)) {
      return res.status(409).json({ code: 409, data: null, message: `任务仍在运行，不能重复提交：${prev.status}` });
    }
    if (prev.status === 'orphaned' && req.body?.confirm_uncertain_outcome !== true) {
      return res.status(409).json({
        code: 409,
        data: null,
        message: '该任务的远端结果无法确认。请先核对任务和资产，再明确确认重试。',
      });
    }

    // 复用原项目，重新建一个任务（保留参数血缘 retry_of）
    const attempt = Math.max(1, Number(prev.meta?.attempt) || 1) + 1;
    const task = taskManager.create('auto-produce', {
      project_id: projectId,
      theme: params.theme,
      params,
      retry_of: prev.id,
      attempt,
      idempotency_key: req.idempotency?.key || null,
      input_hash: req.idempotency?.requestHash || null,
      workflow: createWorkflow({ projectId, topic: params.theme }),
      recovery: { kind: 'auto-produce', mode: isDemoMode() ? 'safe-auto' : 'manual-reconcile', attempts: 0, max_attempts: 3 },
      demo_mode: isDemoMode(),
      providers: prev.meta?.providers || {},
    });
    try { getDb().prepare('UPDATE projects SET status = ? WHERE id = ?').run('generating', projectId); } catch {}
    const queued = autoProduceQueue.enqueue(task, () => runAutoProduceTask(task.id, projectId, params));
    res.json({
      code: 200,
      data: { project_id: projectId, task_id: task.id, status: queued.status, queue_position: queued.queue_position },
      message: queued.status === 'waiting' ? '已加入重试队列' : '已重新开始成片',
    });
  } catch (err) {
    console.error('auto-produce retry error:', safeError(err));
    res.status(500).json({ code: 500, data: null, message: `重试启动失败: ${safeError(err)}` });
  }
});

// 查询积分余额
router.get('/dreamina-credit', async (req, res) => {
  try {
    if (isDemoMode()) {
      return res.json({
        code: 200,
        data: { available: false, demo_mode: true, credit: null },
        message: 'Demo Mode 不探测外部 CLI，也不产生付费请求',
      });
    }
    const dreamina = require('../services/dreamina');
    const result = await dreamina.checkCredit();
    res.json({ code: 200, data: result, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: safeError(err) });
  }
});

// TTS语音合成
router.post('/generate-tts', async (req, res) => {
  try {
    const { text, voice, speed, pitch, storyboard_id, voiceProvider, voiceModel, emotion, volume, dialog, voiceMap } = req.body;
    if (!text) return res.status(400).json({ code: 400, data: null, message: '请输入文本' });
    const ttsProvider = require('../services/ttsProvider');
    const tts = require('../services/tts');
    const usage = require('../services/usage');
    const vProv = voiceProvider || (require('../services/config').get('stageModels.voice') || {}).provider || 'edge';
    let result;
    if (dialog) {
      // 功能⑤：多音色对话（强制走本地 Edge 多音色合成，不计费）
      result = await tts.generateDialogTTS({
        text, voiceMap: voiceMap || {}, defaultVoice: voice || 'xiaoxiao',
        speed, pitch, storyboardId: storyboard_id,
        emotion: emotion || 'general', volume: volume == null ? 1.0 : Number(volume),
      });
    } else {
      result = await usage.track('tts', vProv, () => ttsProvider.synthesize({
        text, voice, speed, pitch, storyboardId: storyboard_id,
        provider: voiceProvider, model: voiceModel,
        emotion: emotion || 'general', volume: volume == null ? 1.0 : Number(volume),
      }));
    }
    // 写回 storyboards 表的 audio_url / voice / 词级时间戳 / 情感
    if (storyboard_id && result.file_url) {
      const wordsJson = (result.words && result.words.length) ? JSON.stringify(result.words) : null;
      getDb().prepare('UPDATE storyboards SET audio_url = ?, voice = ?, audio_words = ?, emotion = ? WHERE id = ?')
        .run(result.file_url, voice || 'xiaoxiao', wordsJson, emotion || 'general', storyboard_id);
      try {
        const normalizedUrl = assetNaming.normalizeStoryboardAudio(storyboard_id);
        if (normalizedUrl) {
          result.file_url = normalizedUrl;
          result.file_path = normalizedUrl;
        }
      } catch (e: unknown) {
        console.warn('[assetNaming] 配音命名整理失败:', errorMessage(e));
      }
    }
    res.json({ code: 200, data: result, message: '合成成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `语音合成失败: ${safeError(err)}` });
  }
});

// 列出可用音色 + 情感预设（功能④⑦）
// 火山豆包语音2.0（大模型）10 个 _moon_bigtts 音色的中文展示名
const VOLCANO_V3_LABELS: Record<string, string> = {
  zh_female_wanqudashu_moon_bigtts: '湾区大叔 · 磁性男声',
  zh_female_daimengchuanmei_moon_bigtts: '呆萌川妹 · 软糯女声',
  zh_male_guozhoudege_moon_bigtts: '广州德哥 · 粤味男声',
  zh_male_beijingxiaoye_moon_bigtts: '北京小爷 · 京腔男声',
  zh_male_shaonianzixin_moon_bigtts: '少年梓辛 · 元气男声',
  zh_female_meilinvyou_moon_bigtts: '魅力女友 · 温柔女声',
  zh_male_shenyeboke_moon_bigtts: '深夜播客 · 磁性男声',
  zh_female_sajiaonvyou_moon_bigtts: '撒娇女友 · 甜美女声',
  zh_female_yuanqinvyou_moon_bigtts: '元气女友 · 活泼女声',
  zh_male_haoyuxiaoge_moon_bigtts: '浩宇小哥 · 阳光男声',
};

router.get('/voices', (req, res) => {
  const tts = require('../services/tts');
  const edgeTtsPro = require('../services/edgeTtsPro');
  const cfg = require('../services/config');
  const registry = require('../services/providers');
  const emotions = Object.entries(edgeTtsPro.EMOTION_PRESETS).map(([key, value]) => {
    const preset = asRecord(value);
    return { key, label: typeof preset.label === 'string' ? preset.label : key };
  });

  // 当前语音阶段 provider（settings.json → stageModels.voice）
  const route = cfg.get('stageModels.voice') || {};
  const prov = route.provider || 'edge';

  // 火山 V3 大模型已启用且凭证就绪 → 暴露 10 个火山音色，否则回退 Edge 音色
  if (prov === 'volcano_tts_v3') {
    const def = (registry.PROVIDERS && registry.PROVIDERS.volcano_tts_v3) || {};
    const keys: string[] = Array.isArray(def.models) && def.models.length
      ? def.models.map(String)
      : Object.keys(VOLCANO_V3_LABELS);
    const voices = keys.map((key) => ({ key, label: VOLCANO_V3_LABELS[key] || key, provider: 'volcano_tts_v3' }));
    return res.json({ code: 200, data: { voices, emotions, provider: 'volcano_tts_v3' }, message: 'success' });
  }

  const labels: Record<string, string> = {
    xiaoxiao: '晓晓 · 温柔女声', xiaoyi: '晓伊 · 活泼女声', yunyang: '云扬 · 沉稳男声',
    yunxi: '云希 · 阳光男声', yunjian: '云健 · 浑厚男声', yunxia: '云夏 · 青年男声',
  };
  // 只暴露真实可用音色（停用别名 xiaomo/xiaohan/yunfeng 不在下拉列表里，但旧数据仍可降级播放）
  const liveKeys = ['xiaoxiao', 'xiaoyi', 'yunyang', 'yunxi', 'yunjian', 'yunxia'];
  const voices = liveKeys.filter(k => tts.VOICES[k]).map(k => ({ key: k, label: labels[k] || k, edge_voice: tts.VOICES[k], provider: 'edge' }));
  res.json({ code: 200, data: { voices, emotions, provider: 'edge' }, message: 'success' });
});

// 音色试听：用短样本文本合成一段音频返回 URL（功能④⑦）
// body: { voice, speed, pitch, emotion, volume, text? }
router.post('/voice-preview', async (req, res) => {
  try {
    const { voice = 'xiaoxiao', speed = 1.0, pitch = 0, emotion = 'general', volume = 1.0 } = req.body;
    const text = (req.body.text || '这是一段配音试听，用来确认音色、语速和语调是否合适。').slice(0, 60);
    const ttsProvider = require('../services/ttsProvider');
    // 火山大模型音色（_bigtts 结尾）→ 走当前配置的 provider（让用户听到真实效果）
    // Edge 音色 → 强制走本地 Edge（免费、快、不计费）
    const isBigTtsVoice = /_bigtts$/i.test(voice);
    const prov = isBigTtsVoice ? undefined : 'edge'; // undefined = 走 stageModels 路由
    const result = await ttsProvider.synthesize({ text, voice, speed, pitch, emotion, volume: Number(volume), provider: prov });
    res.json({ code: 200, data: result, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `试听失败: ${safeError(err)}` });
  }
});

// ============ 火山豆包语音播客大模型 ============
// 输入文本/话题/对话 → 自动生成双人播客音频（带对话稿）
// 协议：WebSocket 二进制 V3，独立于普通 TTS（resource_id=volc.service_type.10050）

// 播客可选发音人（成对使用效果最佳）
const PODCAST_SPEAKERS = [
  { key: 'zh_male_dayixiansheng_v2_saturn_bigtts', label: '大义先生 · 沉稳男声', series: '黑猫侦探社' },
  { key: 'zh_female_mizaitongxue_v2_saturn_bigtts', label: '咪仔同学 · 灵动女声', series: '黑猫侦探社' },
  { key: 'zh_male_liufei_v2_saturn_bigtts', label: '刘飞 · 磁性男声', series: '刘飞和潇磊' },
  { key: 'zh_male_xiaolei_v2_saturn_bigtts', label: '潇磊 · 清朗男声', series: '刘飞和潇磊' },
];

// 播客发音人列表（供前端下拉）
router.get('/podcast/speakers', (req, res) => {
  res.json({ code: 200, data: { speakers: PODCAST_SPEAKERS }, message: 'success' });
});

// 生成播客音频
// body: { action(0/3/4), inputText?, promptText?, nlpTexts?, speakers?[2], useHeadMusic?, sampleRate? }
router.post('/podcast/generate', async (req, res) => {
  try {
    const podcast = require('../services/podcastProvider');
    const registry = require('../services/providers');
    const path = require('path');
    const fs = require('fs');
    const { v4: uuidv4 } = require('uuid');
    const cfg = require('../services/config');

    // 复用火山 TTS 凭证（与语音合成大模型同一套 AppID+Token）
    const cred = registry.resolveCredentials('volcano_tts_v3');
    if (!cred || !cred.appId || !cred.apiKey) {
      return res.status(400).json({ code: 400, data: null, message: '播客功能需要先配置火山豆包语音凭证（AppID + Access Token）' });
    }

    const {
      action = 0,
      inputText = '',
      promptText = '',
      nlpTexts = [],
      speakers,
      useHeadMusic = false,
      sampleRate = 24000,
    } = req.body;

    // 校验输入
    if (action === 0 && !inputText.trim()) {
      return res.status(400).json({ code: 400, data: null, message: 'action=0 需要提供 inputText（待总结的播客文本）' });
    }
    if (action === 3 && (!Array.isArray(nlpTexts) || nlpTexts.length === 0)) {
      return res.status(400).json({ code: 400, data: null, message: 'action=3 需要提供 nlpTexts（对话列表 [{speaker,text}]）' });
    }
    if (action === 4 && !promptText.trim()) {
      return res.status(400).json({ code: 400, data: null, message: 'action=4 需要提供 promptText（播客话题）' });
    }

    const result = await podcast.generatePodcast({
      credentials: { appId: cred.appId, apiKey: cred.apiKey },
      action,
      inputText: inputText.slice(0, 32000),
      promptText,
      nlpTexts,
      speakers: Array.isArray(speakers) && speakers.length ? speakers : undefined,
      useHeadMusic,
      format: 'mp3',
      sampleRate,
      timeout: 180,
    });

    // 落盘到 uploads/audio
    const uploadDir = path.resolve(cfg.get('uploadDir'), 'audio');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `podcast_${uuidv4()}.mp3`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, result.audioBuffer);

    const audioUrl = `/uploads/audio/${filename}`;
    res.json({
      code: 200,
      data: {
        audio_url: audioUrl,
        rounds: result.rounds,         // 每轮对话稿 [{round_id,speaker,text,audio_duration,...}]
        total_duration: result.totalDuration,
        size: result.audioBuffer.length,
        provider: 'volcano_podcast',
      },
      message: 'success',
    });
  } catch (err: unknown) {
    console.error('[podcast] 生成失败:', safeError(err));
    res.status(500).json({ code: 500, data: null, message: `播客生成失败: ${safeError(err)}` });
  }
});

const aiRouter = Object.assign(router, { runAutoProduceTask })
export = aiRouter
