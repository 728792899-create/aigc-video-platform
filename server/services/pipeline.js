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
const { generateTTS } = require('./tts');
const ttsProvider = require('./ttsProvider');
const usage = require('./usage');
const imageGen = require('./imageGen');
const imageStats = require('./imageStats');
const { getDb } = require('../db');
const { toRelative, safeUnlinkMany } = require('../utils/fileCleanup');
const assetHealth = require('./assetHealth');
const assetNaming = require('./assetNaming');
const continuity = require('./continuity');
const promptCompiler = require('./promptCompiler');
const taskManager = require('./taskManager');

// 进度区间划分（总 0-100）
const STAGE = {
  SCRIPT: [2, 12],   // 脚本生成
  SAVE: [12, 15],    // 分镜落库
  ASSETS: [15, 80],  // 配图 + 配音（占大头）
  COMPOSE: [80, 99], // 合成
};

function lerp(range, ratio) {
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
async function runAutoProduce(opts, onProgress = () => {}) {
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

  // —— 1) 生成分镜脚本 ——
  onProgress(lerp(STAGE.SCRIPT, 0.1), 'AI 正在构思分镜脚本…');
  // ⑦ 创作技能：一键成片自动注入「文案阶段的必用技能」(auto_apply)，
  //    无需用户手动勾选，保障开头钩子/完播节奏等质量基线。用户也可在技能库自行增减必用技能。
  const { getEffectiveSkillPrompt } = require('../routes/skills');
  let scriptSkill = { text: '', autoCount: 0, manualCount: 0 };
  try { scriptSkill = getEffectiveSkillPrompt('script', opts.scriptSkillIds); } catch (_) {}
  const scriptOverride = {
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
  const scriptProv = scriptProvider || (require('./config').get('stageModels.script') || {}).provider || 'deepseek';
  const script = await usage.track('llm', scriptProv, () => generateScript(theme, duration, style, scriptOverrideArg));
  const storyboards = Array.isArray(script.storyboards) ? script.storyboards : [];
  if (storyboards.length === 0) throw new Error('AI 未生成有效分镜');
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

  // —— 2) 批量写入分镜 ——
  onProgress(STAGE.SAVE[0], '保存分镜到项目…');
  // 事务外先收集旧分镜的 audio/video 文件，重新生成脚本后旧文件必成孤儿，替换后清理
  const oldFiles = db.prepare('SELECT audio_url, video_path FROM storyboards WHERE project_id = ?').all(projectId);
  const insert = db.prepare(
    `INSERT INTO storyboards (project_id, scene_number, description, dialog, duration, sort_order, prompt, chapter_index, chapter_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batchReplace = db.transaction((items) => {
    db.prepare('DELETE FROM storyboards WHERE project_id = ?').run(projectId);
    items.forEach((item, index) => {
      insert.run(
        projectId, item.scene_number || index + 1, item.description || '',
        item.dialog || '', item.duration || 5, index, item.description || '',
        item.chapter_index || item.chapter || 1, item.chapter_title || ''
      );
    });
  });
  batchReplace(storyboards);
  syncChapters(projectId, storyboards);
  try { continuity.saveStoryboardBindings(projectId, storyboards); } catch (e) { console.warn('[continuity] 分镜角色绑定失败:', e.message); }
  // 替换成功后清理旧分镜的孤儿文件（audio + video）
  try {
    safeUnlinkMany([...oldFiles.map(f => f.audio_url), ...oldFiles.map(f => f.video_path)].filter(Boolean));
  } catch (_) { /* 清理失败不阻断流水线 */ }
  const savedRows = db.prepare(
    'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId);
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
  for (let i = 0; i < total; i++) {
    // 协作式取消在分镜边界生效：不截断正在写文件/落库的单个阶段，避免留下半文件；
    // 当前镜头完成后不再启动下一镜，并保留此前已生成素材。
    if (cancelRequested()) {
      canceled = true;
      break;
    }
    const sb = savedRows[i];
    const baseRatio = i / total;
    onProgress(lerp(STAGE.ASSETS, baseRatio + 0.02 / total),
      `分镜 ${i + 1}/${total}：生成画面…`);

    // 3a) 配图（失败有占位图兜底，不抛出中断整条流水线）
    const imgProv = (require('./config').get('stageModels.image') || {}).provider || 'pollinations';
    try {
      let imageHandled = false;
      // ⑦ 创作技能：一键成片自动注入「画面阶段的必用技能」(电影级运镜/画风统一等)
      let imageSkill = { text: '', autoCount: 0, manualCount: 0 };
      try { imageSkill = getEffectiveSkillPrompt('image', opts.imageSkillIds); } catch (_) {}
      let continuityContext = { promptAnchor: '', referenceImages: [], warnings: [] };
      try {
        continuityContext = continuity.prepareImageContext({
          projectId,
          storyboardId: sb.id,
          consistencyMode,
        });
      } catch (e) {
        if (consistencyMode === 'strict') throw e;
        onProgress(lerp(STAGE.ASSETS, baseRatio + 0.1 / total), `分镜 ${i + 1}/${total}：人物一致性预检提示：${e.message}`);
      }
      const compiledPrompt = promptCompiler.compileImagePrompt({
        project: { ...db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId), style, visual_anchor: visualAnchor },
        storyboard: sb,
        userPrompt: [sb.prompt || '', imageSkill.text].filter(Boolean).join(', '),
        style,
        visualAnchor,
        continuityContext,
      });
      let cached = null;
      try {
        cached = promptCompiler.getCachedGeneration({
          kind: 'image',
          model,
          promptHash: compiledPrompt.promptHash,
          contextHash: compiledPrompt.contextHash,
          storyboardId: sb.id,
        });
      } catch (_) {}
      if (cached?.result?.image_ids?.length) {
        const imageId = cached.result.selected_image_id || cached.result.image_ids[0];
        const imageRow = db.prepare('SELECT id, gen_status FROM images WHERE id = ?').get(imageId);
        if (imageRow && imageRow.gen_status !== 'placeholder') {
          db.prepare('UPDATE storyboards SET selected_image_id = ?, prompt = ? WHERE id = ?')
            .run(imageRow.id, compiledPrompt.prompt, sb.id);
          hasVisual++;
          realImageOk++;
          onProgress(lerp(STAGE.ASSETS, baseRatio + 0.3 / total), `分镜 ${i + 1}/${total}：已复用缓存画面…`);
          imageHandled = true;
        }
      }
      if (imageHandled) {
        // 只跳过配图生成，后续配音/字幕仍要继续执行。
      } else {
      const imgResult = await usage.track('t2i', imgProv, () => imageGen.generate({
        description: sb.description || sb.dialog || '',
        userPrompt: '',
        style, ratio, model, batchSize: 1,
        visualAnchor: '', seed: imageSeed,
        referenceImages: continuityContext.referenceImages || [],
        consistencyMode,
        promptOverride: compiledPrompt.prompt,
        negativePromptOverride: compiledPrompt.negativePrompt,
        onNotice: (msg) => {
          // 模型切换/失败提示透传到一键成片进度条
          onProgress(lerp(STAGE.ASSETS, baseRatio + 0.3 / total), `分镜 ${i + 1}/${total}：${msg}`);
        },
      }));
      const insertedIds = saveImageResults(sb.id, imgResult);
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
      }).filter(Boolean);
      if (insertedIds.length > 0) {
        const rows = insertedIds.map((id) => db.prepare('SELECT * FROM images WHERE id = ?').get(id)).filter(Boolean);
        const best = promptCompiler.rankImageCandidates(rows, checks)[0]?.image || rows[0];
        db.prepare('UPDATE storyboards SET selected_image_id = ?, prompt = ?, quality_status = ? WHERE id = ?')
          .run(best.id, compiledPrompt.prompt, checks.some((c) => c.status === 'risk') ? 'review' : 'stable', sb.id);
        try {
          // 占位图只保证流程可继续，不可进入生成缓存伪装成后续真实命中。
          if (!imgResult.is_placeholder) promptCompiler.saveGenerationCache({
            kind: 'image',
            model,
            provider: imgResult.provider,
            projectId,
            storyboardId: sb.id,
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
    } catch (e) {
      console.error(`[pipeline] 分镜 ${sb.id} 配图失败:`, e.message);
    }

    onProgress(lerp(STAGE.ASSETS, baseRatio + 0.6 / total),
      `分镜 ${i + 1}/${total}：合成配音…`);

    // 3b) 配音（有对白才配）。按 voiceProvider 路由（默认 Edge），云端失败自动降级 Edge。
    const dialogText = (sb.dialog || '').trim();
    if (dialogText) {
      const vProv = voiceProvider || (require('./config').get('stageModels.voice') || {}).provider || 'edge';
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
          } catch (e) {
            console.warn('[assetNaming] 一键成片配音命名整理失败:', e.message);
          }
        }
      } catch (e) {
        console.error(`[pipeline] 分镜 ${sb.id} 配音失败:`, e.message);
      }
    }
  }

  // 取消可能在最后一个镜头处理中到达；合成前再检查一次，避免继续进入高成本 FFmpeg 阶段。
  if (cancelRequested()) canceled = true;
  if (canceled) {
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
  let assetMsg = `素材就绪（${hasVisual}/${total} 个分镜有画面，其中真实生成 ${realImageOk} 个、占位兜底 ${placeholderCount} 个），开始合成…`;
  if (placeholderCount > 0) {
    assetMsg = `素材就绪（${hasVisual}/${total} 个分镜有画面，其中真实生成 ${realImageOk} 个、占位兜底 ${placeholderCount} 个；建议在「设置」配置可用生图模型），开始合成…`;
  } else if (downgradedCount > 0) {
    assetMsg = `素材就绪（真实生成 ${realImageOk}/${total} 个，其中 ${downgradedCount} 个由备用模型生成），开始合成…`;
  }
  onProgress(STAGE.ASSETS[1], assetMsg);

  const health = assetHealth.assertComposable(projectId);
  if (health.status === 'warn' && health.issues.length) {
    onProgress(STAGE.ASSETS[1], `资产预检通过（${health.issues.length} 项可优化问题），开始合成…`);
  }

  // —— 4) 合成视频（复用 video 路由的高层封装）——
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
  }, (p, msg) => {
    onProgress(lerp(STAGE.COMPOSE, (p || 0) / 100), msg || '合成中…');
  });

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

function syncChapters(projectId, storyboards = []) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId);
    const groups = new Map();
    storyboards.forEach((item) => {
      const idx = Number(item.chapter_index || item.chapter || 1) || 1;
      if (!groups.has(idx)) groups.set(idx, { title: item.chapter_title || `第 ${idx} 章`, seconds: 0, count: 0 });
      const g = groups.get(idx);
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
  } catch (e) {
    console.warn('[pipeline] 同步章节失败:', e.message);
  }
}

// 复用 ai.js 的落库逻辑（避免循环依赖，这里内联一份精简版）
function saveImageResults(storyboardId, result) {
  const db = getDb();
  const insertedIds = [];
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
    } catch (e) {
      console.warn('[assetNaming] 一键成片图片命名整理失败:', e.message);
    }
  }
  return insertedIds;
}

module.exports = { runAutoProduce, STAGE };
