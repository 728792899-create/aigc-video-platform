/**
 * 一键成片流水线（Auto Produce Pipeline）
 *
 * 把"输入一个主题 → 自动产出一条短视频"串成一条龙：
 *   1) DeepSeek 生成分镜脚本
 *   2) 批量写入 storyboards
 *   3) 逐个分镜：AI 配图（选第一张）+ Edge TTS 配音
 *   4) 调用视频合成
 *
 * 全程通过 taskManager 上报进度（0-100），前端用现成的 SSE / 轮询展示。
 * 任一分镜配图/配音失败不会中断整条流水线（имеет占位图兜底），
 * 只要至少有一个分镜成功配图即可合成。
 */
const { generateScript } = require('./deepseek');
const ttsProvider = require('./ttsProvider');
const usage = require('./usage');
import * as imageGen from './imageGen'
const imageStats = require('./imageStats');
import { getDb, type SqlRow } from '../db'
const { toRelative, safeUnlinkMany } = require('../utils/fileCleanup');
import * as assetHealth from './assetHealth'
import * as assetNaming from './assetNaming'
import * as continuity from './continuity'
import * as promptCompiler from './promptCompiler'
import { singletonTaskManager as taskManager } from './taskManager'
import * as stageArtifacts from './stageArtifacts'
import type { ArtifactStage, StageArtifactRow } from './stageArtifacts'

type JsonObject = Record<string, unknown>
type ProgressCallback = (progress: number, message: string) => void
interface AutoProduceOptions extends JsonObject {
  theme: string
  style?: string
  duration?: string
  model?: string
  ratio?: string
  voice?: string
  projectId: string | number
  scriptProvider?: string
  scriptModel?: string
  voiceProvider?: string
  voiceModel?: string
  consistencyMode?: string
  taskId?: string
  demoStageDelayMs?: number
  demoDelayStage?: string
  demoFailStageOnce?: string
  scriptSkillIds?: unknown[]
  imageSkillIds?: unknown[]
}
interface ArtifactMeta {
  schemaVersion?: string
  promptVersion?: string
  provider?: string
  model?: string
  inputHash?: string
}
interface LocalImageFile { local_path: string; file_path?: string; file_url: string }
interface ImageResult extends JsonObject {
  local_files: LocalImageFile[]
  attempts: Array<{ model?: string; ok?: boolean }>
  is_placeholder: boolean
  downgraded: boolean
  provider: string
  model: string
  prompt: string
  submit_id: string
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function asRecordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '')
}

function configuredProvider(stage: string, fallback: string): string {
  const value = asRecord(require('./config').get(`stageModels.${stage}`))
  return typeof value.provider === 'string' && value.provider ? value.provider : fallback
}

function normalizeImageResult(value: unknown): ImageResult {
  const raw = asRecord(value)
  return {
    ...raw,
    local_files: Array.isArray(raw.local_files) ? raw.local_files.flatMap((item): LocalImageFile[] => {
      const file = asRecord(item)
      if (typeof file.local_path !== 'string' || typeof file.file_url !== 'string') return []
      return [{ local_path: file.local_path, file_path: typeof file.file_path === 'string' ? file.file_path : undefined, file_url: file.file_url }]
    }) : [],
    attempts: Array.isArray(raw.attempts) ? raw.attempts.map((item) => {
      const attempt = asRecord(item)
      return { model: typeof attempt.model === 'string' ? attempt.model : undefined, ok: attempt.ok === true }
    }) : [],
    is_placeholder: raw.is_placeholder === true,
    downgraded: raw.downgraded === true,
    provider: String(raw.provider || ''),
    model: String(raw.model || ''),
    prompt: String(raw.prompt || ''),
    submit_id: String(raw.submit_id || ''),
  }
}

// 进度区间划分（总 0-100）
export const STAGE: Record<'SCRIPT' | 'SAVE' | 'ASSETS' | 'COMPOSE', readonly [number, number]> = {
  SCRIPT: [2, 12],   // 脚本生成
  SAVE: [12, 15],    // 分镜落库
  ASSETS: [15, 80],  // 配图 + 配音（占大头）
  COMPOSE: [80, 99], // 合成
};

function lerp(range: readonly [number, number], ratio: number): number {
  return Math.round(range[0] + (range[1] - range[0]) * Math.max(0, Math.min(1, ratio)));
}

/**
 * 执行一键成片流水线。
 * @param {object} opts
 * @param {string} opts.theme   创作主题（必填）
 * @param {string} [opts.style] 画面风格，默认 写实
 * @param {string} [opts.duration] 目标时长区间，如 '60-120'
 * @param {string} [opts.model] 图片模型，默认 flux
 * @param {string} [opts.ratio] 画幅，默认 16:9
 * @param {string} [opts.voice] 配音音色，默认 xiaoxiao
 * @param {number} opts.projectId 已建好的项目 id（路由层先建项目）
 * @param {function} onProgress (progress:0-100, message:string) => void
 * @returns {Promise<object>} 合成结果
 */
export async function runAutoProduce(opts: AutoProduceOptions, onProgress: ProgressCallback = () => {}) {
  const {
    theme, style = '写实', duration = '60-120',
    model = 'auto', ratio = '16:9', voice = 'xiaoxiao', projectId,
    scriptProvider, scriptModel,
    voiceProvider, voiceModel,
    consistencyMode = 'standard',
  } = opts;

  if (!theme) throw new Error('缺少创作主题 theme');
  if (!projectId) throw new Error('缺少 projectId');

  const db = getDb();
  const artifactByStage = new Map<ArtifactStage, StageArtifactRow>();
  const publishArtifact = (stage: ArtifactStage, payload: unknown, meta: ArtifactMeta = {}, dependencyStage: ArtifactStage | null = null): StageArtifactRow => {
    const dependency = dependencyStage ? artifactByStage.get(dependencyStage) : null;
    const dependencyKey = dependencyStage || stage;
    const artifact = stageArtifacts.publish({
      projectId,
      taskId: opts.taskId,
      stage,
      schemaVersion: meta.schemaVersion,
      promptVersion: meta.promptVersion,
      provider: meta.provider,
      model: meta.model,
      inputHash: meta.inputHash,
      dependencySnapshot: dependency ? {
        [dependencyKey]: {
          artifact_id: dependency.id,
          revision: dependency.revision,
          input_hash: dependency.input_hash,
        },
      } : {},
      payload,
    });
    artifactByStage.set(stage, artifact);
    return artifact;
  };
  if (opts.taskId) taskManager.ensureWorkflow(opts.taskId, { projectId, topic: theme });
  const workflowStage = (stage: string): JsonObject => {
    const task = opts.taskId ? taskManager.get(opts.taskId) : null;
    const workflow = asRecord(task?.meta?.workflow);
    return asRecord(asRecord(workflow.stages)[stage]);
  };
  const stageDone = (stage: string): boolean => ['succeeded', 'skipped'].includes(String(workflowStage(stage).status || ''));
  const stageEvent = (type: string, stage: string, extra: JsonObject = {}) => {
    if (!opts.taskId) return null;
    return taskManager.transitionStage(opts.taskId, { type, stage, ...extra });
  };
  const demoMode = ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase());
  const demoGate = async (stage: string): Promise<void> => {
    if (!demoMode || !opts.taskId) return;
    const delayMs = Math.max(0, Math.min(15_000, Number(opts.demoStageDelayMs) || 0));
    if (delayMs > 0 && (!opts.demoDelayStage || opts.demoDelayStage === stage)) {
      onProgress(taskManager.get(opts.taskId)?.progress || 1, `Demo 恢复检查点：${stage}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (opts.demoFailStageOnce !== stage) return;
    const task = taskManager.get(opts.taskId);
    const failures = asRecord(task?.meta?.demo_failures);
    if (failures[stage]) return;
    failures[stage] = { injected_at: Date.now(), count: 1 };
    taskManager.update(opts.taskId, { meta: { ...(task?.meta || {}), demo_failures: failures } });
    throw Object.assign(new Error(`DEMO_INJECTED_FAILURE:${stage}`), { stageHint: stage });
  };

  // —— 1) 生成分镜脚本 ——
  const restoredOutput = asRecord(workflowStage('script').output);
  let script: JsonObject | null = restoredOutput.script ? asRecord(restoredOutput.script) : null;
  if (!script) {
    stageEvent('START', 'script');
    onProgress(lerp(STAGE.SCRIPT, 0.1), 'AI 正在构思分镜脚本…');
  } else {
    onProgress(STAGE.SCRIPT[1], '已从任务检查点恢复分镜脚本');
  }
  // ⑦ 创作技能：一键成片自动注入「文案阶段的必用技能」(auto_apply)，
  //    无需用户手动勾选，保障开头钩子/完播节奏等质量基线。用户也可在技能库自行增减必用技能。
  const { getEffectiveSkillPrompt } = require('../routes/skills');
  let scriptSkill = { text: '', autoCount: 0, manualCount: 0 };
  try { scriptSkill = getEffectiveSkillPrompt('script', opts.scriptSkillIds); } catch (_) {}
  const scriptOverride: JsonObject = {
    ...(scriptProvider ? { provider: scriptProvider, model: scriptModel } : {}),
    ...(scriptSkill.text ? { skillPrompt: scriptSkill.text } : {}),
  };
  try {
    const continuityContext = continuity.buildScriptContext(projectId);
    if (continuityContext) scriptOverride.continuityContext = continuityContext;
  } catch (_) {}
  const scriptOverrideArg = Object.keys(scriptOverride).length ? scriptOverride : null;
  if (scriptSkill.autoCount > 0) {
    onProgress(lerp(STAGE.SCRIPT, 0.15), `已自动应用 ${scriptSkill.autoCount} 个必用文案技能…`);
  }
  const scriptProv = scriptProvider || configuredProvider('script', 'deepseek');
  if (!script) {
    script = asRecord(await usage.track('llm', scriptProv, () => generateScript(theme, duration, style, scriptOverrideArg)));
  }
  if (!script) throw new Error('AI 未生成有效脚本');
  const storyboards = asRecordArray(script.storyboards);
  if (storyboards.length === 0) throw new Error('AI 未生成有效分镜');
  if (!stageDone('script')) {
    stageEvent('SUCCEED', 'script', { output: { script, provider: scriptProv, storyboard_count: storyboards.length } });
  }
  onProgress(STAGE.SCRIPT[1], `已生成 ${storyboards.length} 个分镜：《${script.title || theme}》`);

  // 把标题/简介写回项目，方便前端展示
  // v1.6.5 画风一致性：保存全局视觉设定 visual_anchor + 生成项目级基准 seed，
  // 供本项目所有分镜配图复用，确保主角外貌/画风/色调跨分镜连贯。
  const visualAnchor = (script.visual_anchor || '').toString().trim();
  const imageSeed = Math.floor(Math.random() * 2147483647);
  try {
    db.prepare('UPDATE projects SET name = COALESCE(NULLIF(name, ?), name), script_content = ?, status = ?, visual_anchor = ?, image_seed = ? WHERE id = ?')
      .run('', JSON.stringify(script), 'generating', visualAnchor, imageSeed, projectId);
    continuity.ensureSeriesForProject(projectId);
    continuity.updateStoryBible(projectId, {
      ...(script.story_bible || {}),
      style_anchor: visualAnchor || undefined,
      previous_summary: script.summary || undefined,
    });
    continuity.extractCharacters(projectId, { script });
  } catch { /* 非致命 */ }
  publishArtifact('script', script, {
    schemaVersion: typeof script.schema_version === 'string' ? script.schema_version : undefined,
    promptVersion: typeof script.prompt_version === 'string' ? script.prompt_version : undefined,
    provider: String(asRecord(script.generation).provider || scriptProv),
    model: String(asRecord(script.generation).model || scriptModel || ''),
    inputHash: typeof script.input_hash === 'string' ? script.input_hash : undefined,
  });

  // —— 2) 批量写入分镜 ——
  onProgress(STAGE.SAVE[0], '保存分镜到项目…');
  let savedRows = db.prepare(
    'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId);
  if (!stageDone('storyboard') || savedRows.length === 0) {
    stageEvent('START', 'storyboard');
    // 只在分镜阶段没有成功检查点时替换，避免重启恢复误删已经生成的资产。
    const oldFiles = db.prepare('SELECT audio_url, video_path FROM storyboards WHERE project_id = ?').all(projectId);
    const insert = db.prepare(
      `INSERT INTO storyboards (project_id, scene_number, description, dialog, duration, sort_order, prompt, chapter_index, chapter_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const batchReplace = db.transaction((items: JsonObject[]) => {
      db.prepare('DELETE FROM storyboards WHERE project_id = ?').run(projectId);
      items.forEach((item: JsonObject, index: number) => {
        insert.run(
          projectId, item.scene_number || index + 1, item.description || '',
          item.dialog || '', item.duration || 5, index, item.description || '',
          item.chapter_index || item.chapter || 1, item.chapter_title || ''
        );
      });
    });
    batchReplace(storyboards);
    syncChapters(projectId, storyboards);
    try { continuity.saveStoryboardBindings(projectId, storyboards); } catch (error: unknown) { console.warn('[continuity] 分镜角色绑定失败:', errorMessage(error)); }
    try {
      safeUnlinkMany([...oldFiles.map((file) => file.audio_url), ...oldFiles.map((file) => file.video_path)].filter(Boolean));
    } catch (_) { /* 清理失败不阻断流水线 */ }
    savedRows = db.prepare(
      'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(projectId);
    stageEvent('SUCCEED', 'storyboard', {
      output: { storyboard_ids: savedRows.map((item: SqlRow) => item.id), count: savedRows.length },
    });
  }
  publishArtifact('storyboard', {
    storyboard_ids: savedRows.map((item: SqlRow) => Number(item.id)),
    count: savedRows.length,
  }, {
    schemaVersion: typeof script.schema_version === 'string' ? script.schema_version : undefined,
    inputHash: stageArtifacts.hashArtifactInput(savedRows.map((item: SqlRow) => ({
      id: item.id,
      description: item.description,
      dialog: item.dialog,
      duration: item.duration,
    }))),
  }, 'script');
  onProgress(STAGE.SAVE[1], `已保存 ${savedRows.length} 个分镜`);

  // —— 3) 逐分镜配图 + 配音 ——
  const total = savedRows.length;
  const cancelRequested = () => {
    if (!opts.taskId) return false;
    return !!taskManager.get(opts.taskId)?.meta?.cancel_requested;
  };
  let canceled = false;
  let hasVisual = 0;      // 有画面（含占位图）——决定能否进入合成
  let realImageOk = 0;    // 真实生成成功（不含占位图）——用于对外成功口径
  let placeholderCount = 0; // 占位图兜底数（生图全失败）
  let downgradedCount = 0;  // 自动降级到备用模型才成功的数
  if (!stageDone('image')) stageEvent('START', 'image');
  await demoGate('image');
  for (let i = 0; i < total; i++) {
    // 协作式取消在分镜边界生效：不截断正在写文件/落库的单个阶段，避免留下半文件；
    // 当前镜头完成后不再启动下一镜，并保留此前已生成素材。
    if (cancelRequested()) {
      canceled = true;
      break;
    }
    const sb = savedRows[i];
    if (!sb) continue;
    const baseRatio = i / total;
    onProgress(lerp(STAGE.ASSETS, baseRatio + 0.02 / total),
      `分镜 ${i + 1}/${total}：生成画面…`);

    // 3a) 配图（失败有占位图兜底，不抛出中断整条流水线）
    const imgProv = configuredProvider('image', 'pollinations');
    const existingSelected = sb.selected_image_id
      ? db.prepare('SELECT id, gen_status, file_url FROM images WHERE id = ?').get(sb.selected_image_id)
      : null;
    if (existingSelected?.file_url) {
      hasVisual++;
      if (existingSelected.gen_status === 'placeholder') placeholderCount++;
      else realImageOk++;
      onProgress(lerp(STAGE.ASSETS, baseRatio + 0.3 / total), `分镜 ${i + 1}/${total}：已恢复已有画面…`);
    } else try {
      let imageHandled = false;
      // ⑦ 创作技能：一键成片自动注入「画面阶段的必用技能」(电影级运镜/画风统一等)
      let imageSkill = { text: '', autoCount: 0, manualCount: 0 };
      try { imageSkill = getEffectiveSkillPrompt('image', opts.imageSkillIds); } catch (_) {}
      let continuityContext: JsonObject = { promptAnchor: '', referenceImages: [], warnings: [] };
      try {
        continuityContext = continuity.prepareImageContext({
          projectId,
          storyboardId: Number(sb.id) || String(sb.id || ''),
          consistencyMode,
        });
      } catch (error: unknown) {
        if (consistencyMode === 'strict') throw error;
        onProgress(lerp(STAGE.ASSETS, baseRatio + 0.1 / total), `分镜 ${i + 1}/${total}：人物一致性预检提示：${errorMessage(error)}`);
      }
      const compiledPrompt = promptCompiler.compileImagePrompt({
        project: { ...db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId), style, visual_anchor: visualAnchor },
        storyboard: sb,
        userPrompt: [sb.prompt || '', imageSkill.text].filter(Boolean).join(', '),
        style,
        visualAnchor,
        continuityContext,
      });
      let cached: JsonObject | null = null;
      try {
        cached = promptCompiler.getCachedGeneration({
          kind: 'image',
          model,
          promptHash: compiledPrompt.promptHash,
          contextHash: compiledPrompt.contextHash,
          storyboardId: Number(sb.id) || String(sb.id || ''),
        });
      } catch (_) {}
      const cachedResult = asRecord(cached?.result);
      const cachedImageIds = Array.isArray(cachedResult.image_ids) ? cachedResult.image_ids : [];
      if (cachedImageIds.length) {
        const imageId = cachedResult.selected_image_id || cachedImageIds[0];
        const imageRow = db.prepare('SELECT id, gen_status FROM images WHERE id = ?').get(imageId);
        if (imageRow && imageRow.gen_status !== 'placeholder') {
          db.prepare('UPDATE storyboards SET selected_image_id = ? WHERE id = ?')
            .run(imageRow.id, sb.id);
          hasVisual++;
          realImageOk++;
          onProgress(lerp(STAGE.ASSETS, baseRatio + 0.3 / total), `分镜 ${i + 1}/${total}：已复用缓存画面…`);
          imageHandled = true;
        }
      }
      if (imageHandled) {
        // 只跳过配图生成，后续配音/字幕仍要继续执行。
      } else {
      const imgResult = normalizeImageResult(await usage.track('t2i', imgProv, () => imageGen.generate({
        description: String(sb.description || sb.dialog || ''),
        userPrompt: '',
        style, ratio, model, batchSize: 1,
        visualAnchor: '', seed: imageSeed,
        referenceImages: Array.isArray(continuityContext.referenceImages) ? continuityContext.referenceImages : [],
        consistencyMode,
        promptOverride: compiledPrompt.prompt,
        negativePromptOverride: compiledPrompt.negativePrompt,
        onNotice: (msg) => {
          // 模型切换/失败提示透传到一键成片进度条
          onProgress(lerp(STAGE.ASSETS, baseRatio + 0.3 / total), `分镜 ${i + 1}/${total}：${msg}`);
        },
      })));
      const insertedIds = saveImageResults(sb.id, imgResult, {
        taskId: opts.taskId,
        referenceImageIds: asRecordArray(continuityContext.referenceImages).map((item) => item.id || item.image_id),
        consistencyMode,
      });
      imageStats.record({
        projectId,
        storyboardId: sb.id,
        requestedModel: model,
        firstModel: imgResult.attempts?.[0]?.model || '',
        firstAttemptOk: !!imgResult.attempts?.[0]?.ok,
        finalOk: !imgResult.is_placeholder,
        usedPlaceholder: !!imgResult.is_placeholder,
        downgraded: !!imgResult.downgraded,
        attemptsCount: imgResult.attempts?.length || 0,
        finalProvider: imgResult.provider || '',
        source: 'pipeline',
      });
      const checks = insertedIds.map((id) => {
        try { return continuity.evaluateStoryboard(projectId, sb.id, id); } catch (_) { return null; }
      }).filter((check) => check !== null);
      if (insertedIds.length > 0) {
        const rows = insertedIds.map((id) => db.prepare('SELECT * FROM images WHERE id = ?').get(id)).filter(Boolean);
        const best = promptCompiler.rankImageCandidates(rows, checks)[0]?.image || rows[0];
        if (!best) throw new Error('图片已落库但无法选择候选结果');
        db.prepare('UPDATE storyboards SET selected_image_id = ?, quality_status = ? WHERE id = ?')
          .run(best.id, checks.some((c) => c.status === 'risk') ? 'review' : 'stable', sb.id);
        try {
          // 占位图只保证流程可继续，不可进入生成缓存伪装成后续真实命中。
          if (!imgResult.is_placeholder) promptCompiler.saveGenerationCache({
            kind: 'image',
            model,
            provider: imgResult.provider,
            projectId,
            storyboardId: Number(sb.id) || String(sb.id || ''),
            prompt: compiledPrompt.prompt,
            promptHash: compiledPrompt.promptHash,
            contextHash: compiledPrompt.contextHash,
            result: {
              image_ids: insertedIds,
              selected_image_id: best.id,
              prompt: compiledPrompt.prompt,
              model: imgResult.model,
              provider: imgResult.provider,
              notice: imgResult.notice || '',
            },
          });
        } catch (_) {}
        hasVisual++;
        if (imgResult.is_placeholder) {
          placeholderCount++;
        } else {
          realImageOk++;
          if (imgResult.downgraded) downgradedCount++;
        }
      }
      }
    } catch (error: unknown) {
      console.error(`[pipeline] 分镜 ${sb.id} 配图失败:`, errorMessage(error));
    }

    onProgress(lerp(STAGE.ASSETS, baseRatio + 0.6 / total),
      `分镜 ${i + 1}/${total}：合成配音…`);

    // 3b) 配音（有对白才配）。按 voiceProvider 路由（默认 Edge），云端失败自动降级 Edge。
    const dialogText = String(sb.dialog || '').trim();
    if (dialogText && !sb.audio_url) {
      const vProv = voiceProvider || configuredProvider('voice', 'edge');
      try {
        const ttsResult = await usage.track('tts', vProv, () => ttsProvider.synthesize({
          text: dialogText, voice, speed: 1.0, pitch: 0, storyboardId: sb.id,
          provider: voiceProvider, model: voiceModel,
        }));
        if (ttsResult?.file_url) {
          db.prepare('UPDATE storyboards SET audio_url = ?, voice = ?, subtitle_text = ? WHERE id = ?')
            .run(ttsResult.file_url, voice, dialogText, sb.id);
          try {
            const normalizedUrl = assetNaming.normalizeStoryboardAudio(sb.id);
            if (normalizedUrl) ttsResult.file_url = normalizedUrl;
          } catch (error: unknown) {
            console.warn('[assetNaming] 一键成片配音命名整理失败:', errorMessage(error));
          }
        }
      } catch (error: unknown) {
        console.error(`[pipeline] 分镜 ${sb.id} 配音失败:`, errorMessage(error));
      }
    }
  }

  // 取消可能在最后一个镜头处理中到达；合成前再检查一次，避免继续进入高成本 FFmpeg 阶段。
  if (cancelRequested()) canceled = true;
  if (canceled) {
    if (!stageDone('image')) stageEvent('CANCEL', 'image');
    try { db.prepare('UPDATE projects SET status = ?, continuity_status = ? WHERE id = ?').run('partial', 'partial', projectId); } catch {}
    const imageCount = Number(db.prepare(
      `SELECT COUNT(*) AS n FROM images i
       JOIN storyboards s ON s.id = i.storyboard_id WHERE s.project_id = ?`
    ).get(projectId)?.n) || 0;
    const selectedCount = Number(db.prepare(
      'SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ? AND selected_image_id IS NOT NULL'
    ).get(projectId)?.n) || 0;
    const audioCount = Number(db.prepare(
      "SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ? AND COALESCE(audio_url, '') <> ''"
    ).get(projectId)?.n) || 0;
    const partialResult = {
      storyboard_count: total,
      image_count: imageCount,
      selected_image_count: selectedCount,
      audio_count: audioCount,
    };
    onProgress(Math.min(STAGE.ASSETS[1], 79), '已在分镜边界停止，已生成素材均已保留');
    return {
      project_id: projectId,
      title: script.title || theme,
      storyboard_count: total,
      has_visual: hasVisual,
      real_image_ok: realImageOk,
      image_ok: realImageOk,
      placeholder_count: placeholderCount,
      downgraded_count: downgradedCount,
      partial: true,
      canceled: true,
      partialResult,
    };
  }

  if (hasVisual === 0) throw new Error('所有分镜配图均失败，无法合成视频');
  if (!stageDone('image')) {
    stageEvent(hasVisual === total ? 'SUCCEED' : 'PARTIAL', 'image', {
      output: { total, completed: hasVisual, real: realImageOk, placeholders: placeholderCount },
      ...(hasVisual === total ? {} : { error: `${total - hasVisual} 个分镜缺少画面` }),
    });
  }
  const selectedImageRows = db.prepare(
    'SELECT id, selected_image_id FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId);
  publishArtifact('image', {
    total,
    completed: hasVisual,
    real: realImageOk,
    placeholders: placeholderCount,
    selected: selectedImageRows.map((row) => ({ storyboard_id: row.id, image_id: row.selected_image_id || null })),
  }, {}, 'storyboard');

  const dialogCount = Number(db.prepare(
    "SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ? AND TRIM(COALESCE(dialog, '')) <> ''"
  ).get(projectId)?.n) || 0;
  const audioCount = Number(db.prepare(
    "SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ? AND TRIM(COALESCE(audio_url, '')) <> ''"
  ).get(projectId)?.n) || 0;
  if (!stageDone('voice')) {
    if (dialogCount === 0) stageEvent('SKIP', 'voice', { output: { reason: '没有对白' } });
    else {
      stageEvent('START', 'voice');
      stageEvent(audioCount >= dialogCount ? 'SUCCEED' : 'PARTIAL', 'voice', {
        output: { total: dialogCount, completed: audioCount },
        ...(audioCount >= dialogCount ? {} : { error: `${dialogCount - audioCount} 个分镜配音失败` }),
      });
    }
  }
  publishArtifact('voice', { total: dialogCount, completed: audioCount }, {}, 'image');

  if (!stageDone('subtitle')) {
    if (dialogCount === 0) stageEvent('SKIP', 'subtitle', { output: { reason: '没有对白' } });
    else {
      stageEvent('START', 'subtitle');
      const subtitleCount = Number(db.prepare(
        "SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ? AND TRIM(COALESCE(subtitle_text, '')) <> ''"
      ).get(projectId)?.n) || 0;
      stageEvent(subtitleCount >= dialogCount ? 'SUCCEED' : 'PARTIAL', 'subtitle', {
        output: { total: dialogCount, completed: subtitleCount },
        ...(subtitleCount >= dialogCount ? {} : { error: `${dialogCount - subtitleCount} 个分镜缺少字幕` }),
      });
    }
  }
  const subtitleCount = Number(db.prepare(
    "SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ? AND TRIM(COALESCE(subtitle_text, '')) <> ''"
  ).get(projectId)?.n) || 0;
  publishArtifact('subtitle', { total: dialogCount, completed: subtitleCount }, {}, 'voice');
  let assetMsg = `素材就绪（${hasVisual}/${total} 个分镜有画面，其中真实生成 ${realImageOk} 个、占位兜底 ${placeholderCount} 个），开始合成…`;
  if (placeholderCount > 0) {
    assetMsg = `素材就绪（${hasVisual}/${total} 个分镜有画面，其中真实生成 ${realImageOk} 个、占位兜底 ${placeholderCount} 个；建议在「设置」配置可用生图模型），开始合成…`;
  } else if (downgradedCount > 0) {
    assetMsg = `素材就绪（真实生成 ${realImageOk}/${total} 个，其中 ${downgradedCount} 个由备用模型生成），开始合成…`;
  }
  onProgress(STAGE.ASSETS[1], assetMsg);

  if (!stageDone('timeline')) stageEvent('START', 'timeline');
  const health = assetHealth.assertComposable(projectId);
  if (!stageDone('timeline')) stageEvent('SUCCEED', 'timeline', { output: { health } });
  publishArtifact('timeline', { health }, {}, 'subtitle');
  if (health.status === 'warn' && health.issues.length) {
    onProgress(STAGE.ASSETS[1], `资产预检通过（${health.issues.length} 项可优化问题），开始合成…`);
  }

  // —— 4) 合成视频（复用 video 路由的高层封装）——
  if (!stageDone('export')) stageEvent('START', 'export');
  await demoGate('export');
  const videoRouter = require('../routes/video');
  const result = await videoRouter.composeProjectVideo(projectId, {
    fps: 24,
    ratio,
    longMode: String(duration).split('-').some((x) => Number(x) >= 600),
    motion: opts.motion,
    bgm: opts.bgm,
    bgmVolume: opts.bgmVolume,
    subtitleStyle: opts.subtitleStyle,
    videoProvider: opts.videoProvider,
    videoModel: opts.videoModel,
    i2v: opts.i2v,
    taskId: opts.taskId,
  }, (progress: number, message: string) => {
    onProgress(lerp(STAGE.COMPOSE, (progress || 0) / 100), message || '合成中…');
  });
  if (!stageDone('export')) stageEvent('SUCCEED', 'export', { output: result });
  publishArtifact('export', result, {}, 'timeline');

  // 标记项目完成
  try { db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('completed', projectId); } catch {}
  try {
    db.prepare('UPDATE projects SET ending_summary = ?, continuity_status = ? WHERE id = ?')
      .run(script.summary || theme, 'completed', projectId);
  } catch {}

  return {
    project_id: projectId,
    title: script.title || theme,
    storyboard_count: total,
    has_visual: hasVisual,
    real_image_ok: realImageOk,
    image_ok: realImageOk, // 兼容旧客户端；语义已收敛为“真实生成成功数”
    placeholder_count: placeholderCount,
    downgraded_count: downgradedCount,
    ...result,
  };
}

function syncChapters(projectId: string | number, storyboards: JsonObject[] = []): void {
  try {
    const db = getDb();
    db.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId);
    const groups = new Map<number, { title: string; seconds: number; count: number }>();
    storyboards.forEach((item: JsonObject) => {
      const idx = Number(item.chapter_index || item.chapter || 1) || 1;
      if (!groups.has(idx)) groups.set(idx, { title: String(item.chapter_title || `第 ${idx} 章`), seconds: 0, count: 0 });
      const g = groups.get(idx);
      if (!g) return;
      g.seconds += Number(item.duration) || 5;
      g.count += 1;
    });
    const insert = db.prepare('INSERT INTO chapters (project_id, chapter_index, title, summary, target_duration_sec, status) VALUES (?, ?, ?, ?, ?, ?)');
    [...groups.entries()].sort((a, b) => a[0] - b[0]).forEach(([idx, g]) => {
      insert.run(projectId, idx, g.title, `${g.count} 个分镜`, Math.round(g.seconds), 'draft');
    });
    const total = storyboards.reduce((sum, item) => sum + (Number(item.duration) || 5), 0);
    db.prepare('UPDATE projects SET long_video_mode = ?, target_duration_sec = ? WHERE id = ?')
      .run(total >= 600 ? 1 : 0, Math.round(total), projectId);
  } catch (error: unknown) {
    console.warn('[pipeline] 同步章节失败:', errorMessage(error));
  }
}

// 复用 ai.js 的落库逻辑（避免循环依赖，这里内联一份精简版）
function saveImageResults(storyboardId: unknown, result: ImageResult, metadata: JsonObject = {}): SqlRow['id'][] {
  const db = getDb();
  const insertedIds: SqlRow['id'][] = [];
  for (const lf of result.local_files || []) {
    const insRes = db.prepare(
      `INSERT INTO images (storyboard_id, prompt, file_path, file_url, submit_id, gen_status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      storyboardId, result.prompt || '', toRelative(lf.local_path), lf.file_url,
      result.submit_id || '', result.is_placeholder ? 'placeholder' : 'success'
    );
    insertedIds.push(insRes.lastInsertRowid);
    try {
      const normalizedUrl = assetNaming.normalizeImageRecord(insRes.lastInsertRowid);
      if (normalizedUrl) {
        lf.file_url = normalizedUrl;
        lf.file_path = normalizedUrl;
      }
    } catch (error: unknown) {
      console.warn('[assetNaming] 一键成片图片命名整理失败:', errorMessage(error));
    }
  }
  require('./candidateMetadata').annotateCandidates(insertedIds, {
    ...metadata,
    provider: result.provider,
    model: result.model,
    prompt: result.prompt,
  });
  return insertedIds;
}
