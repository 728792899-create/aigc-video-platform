/**
 * 一键成片失败诊断服务
 *
 * 把底层工程错误翻译成用户可理解的阶段、原因、建议和操作。
 * 调用方仍保留 rawError，方便高级用户/开发者展开排障。
 */
const { getDb } = require('../db');

function toMessage(error) {
  if (!error) return '未知错误';
  if (error instanceof Error) return error.message || String(error);
  return String(error);
}

function stageFromText(text, stageHint = '') {
  const s = String(stageHint || '').toLowerCase();
  if (s) return s;
  const m = String(text || '').toLowerCase();
  if (/文案|脚本|剧本|分镜|script|llm|deepseek|chat/.test(m)) return 'script';
  if (/图片|配图|生图|image|t2i|cogview|pollinations|dreamina|wanx|flux/.test(m)) return 'image';
  if (/配音|语音|tts|voice|edge|volcano|audio/.test(m)) return 'voice';
  if (/资产|素材|没有可用的图片|没有可用于合成的图片|缺少图片|未选择图片|文件不存在|asset|material|missing image/.test(m)) return 'asset';
  if (/合成|视频|ffmpeg|compose|render|codec|subtitle|bgm/.test(m)) return 'compose';
  if (/目录|磁盘|权限|upload|storage|eacces|enospc|enoent/.test(m)) return 'storage';
  return 'unknown';
}

function stageTitle(stage) {
  return {
    script: '文案/分镜生成失败',
    image: '图片生成失败',
    voice: '配音生成失败',
    compose: '视频合成失败',
    asset: '资产预检失败',
    storage: '存储写入失败',
    queue: '任务调度失败',
    unknown: '一键成片失败',
  }[stage] || '一键成片失败';
}

function partialResult(projectId) {
  if (!projectId) return null;
  try {
    const db = getDb();
    const sb = db.prepare('SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ?').get(projectId);
    const img = db.prepare(
      `SELECT COUNT(i.id) AS n
       FROM images i
       JOIN storyboards s ON s.id = i.storyboard_id
       WHERE s.project_id = ?`
    ).get(projectId);
    const selected = db.prepare(
      `SELECT COUNT(*) AS n
       FROM storyboards
       WHERE project_id = ? AND selected_image_id IS NOT NULL`
    ).get(projectId);
    const audio = db.prepare(
      `SELECT COUNT(*) AS n
       FROM storyboards
       WHERE project_id = ? AND audio_url IS NOT NULL AND audio_url <> ''`
    ).get(projectId);
    return {
      project_id: projectId,
      storyboard_count: sb?.n || 0,
      image_count: img?.n || 0,
      selected_image_count: selected?.n || 0,
      audio_count: audio?.n || 0,
    };
  } catch (_) {
    return { project_id: projectId };
  }
}

function classify(raw, stage) {
  const text = String(raw || '');
  const lower = text.toLowerCase();

  if (/没有可用的图片|还没有可用的图片|没有可用于合成的图片|缺少图片|缺少可用图片|未选择图片|missing image|no usable image/.test(lower)) {
    return {
      reason: '项目缺少可用于成片合成的图片。',
      advice: [
        '进入项目的「图片」页面，为每个分镜生成并选择一张图片。',
        '如果已经生成过图片，先点击对应图片的「使用」让分镜选中它。',
        '也可以重新执行一键成片，让系统补齐缺失图片后再合成。',
      ],
      actions: ['open_images', 'retry'],
      recoverable: true,
    };
  }

  if (/ffmpeg 不可用|ffmpeg.*unavailable|ffmpeg.*not found|spawn.*ffmpeg|找不到.*ffmpeg/.test(lower)) {
    return {
      reason: '本机 FFmpeg 不可用，无法执行视频合成。',
      advice: [
        '进入「系统设置 -> 健康检查」确认 FFmpeg 路径。',
        '如果使用自定义 FFmpeg，请重新选择可执行文件路径。',
        '修复后重新执行一键成片或回到预览页重新导出。',
      ],
      actions: ['open_health', 'open_settings_storage', 'retry'],
      recoverable: true,
    };
  }

  if (/视频输出目录不可写|输出目录不可写|output.*not writable/.test(lower)) {
    return {
      reason: '视频输出目录不可写，无法保存生成结果。',
      advice: [
        '到「系统设置 -> 存储」更换为有读写权限的目录。',
        '确认磁盘没有被系统权限、同步盘或只读挂载限制。',
        '保存设置后重新执行生成任务。',
      ],
      actions: ['open_settings_storage', 'retry'],
      recoverable: true,
    };
  }

  if (/图片文件不存在|素材文件不存在|文件不存在|enoent|no such file/.test(lower)) {
    return {
      reason: '项目中有素材记录指向的本地文件已经不存在。',
      advice: [
        '打开项目资产健康检查，定位缺失的图片、音频或视频文件。',
        '从回收站恢复对应素材，或重新生成缺失素材。',
        '避免在系统文件夹中手动移动或删除 uploads 目录内的素材。',
      ],
      actions: ['open_project', 'open_trash', 'retry'],
      recoverable: true,
    };
  }

  if (/未配置 api key|missing .*api key|api key/.test(lower) && /未配置|missing/.test(lower)) {
    return {
      reason: '当前阶段需要配置对应 AI 服务的 API Key。',
      advice: [
        '打开「系统设置 -> 模型路由」，为文案、配图或语音阶段配置可用模型凭证。',
        '保存后先点击测试连接，确认 Key 有效再重新生成。',
        '长期使用建议配置自己的 API Key，不依赖内置兜底凭证。',
      ],
      actions: ['open_settings_models', 'retry'],
      recoverable: true,
    };
  }

  if (/401|403|unauthori[sz]ed|forbidden|invalid.*key|权限|未授权/.test(lower)) {
    return {
      reason: 'API Key 无效、权限不足，或当前模型没有开通调用权限。',
      advice: [
        '检查 API Key 是否复制完整，确认没有多余空格。',
        '到服务商控制台确认账户余额、模型权限和接口权限。',
        '如果使用中转站，确认 Base URL 与模型名称匹配。',
      ],
      actions: ['open_settings_models', 'open_logs'],
      recoverable: true,
    };
  }

  if (/402|额度|余额|积分不足|payment|required|quota/i.test(text)) {
    return {
      reason: '当前模型额度不足、免费额度用尽，或账户余额不足。',
      advice: [
        '切换到已配置的备用模型，或为当前模型补充额度。',
        '建议在「系统设置 -> 模型路由 -> 备用生图模型」至少配置 2 个不同来源。',
        '如果正在批量生成，降低一键成片并行数后再试。',
      ],
      actions: ['open_settings_models', 'retry_failed'],
      recoverable: true,
    };
  }

  if (/429|rate limit|too many|请求过于频繁|限流/.test(lower)) {
    return {
      reason: '请求过于频繁，当前模型或网络环境触发了限流。',
      advice: [
        '等待 1-3 分钟后重试。',
        '降低一键成片并行数量，避免同时打满上游额度。',
        '为图片或文案阶段增加备用模型，让系统自动切换。',
      ],
      actions: ['retry', 'open_settings_models'],
      recoverable: true,
    };
  }

  if (/timeout|timed out|超时|abort|etimedout|esockettimedout/.test(lower)) {
    return {
      reason: '上游 AI 服务或本机网络响应超时。',
      advice: [
        '稍后重试，或切换到更稳定的模型服务。',
        '检查网络、代理或防火墙设置。',
        '如果任务较多，降低并行数量后再生成。',
      ],
      actions: ['retry', 'open_settings_models'],
      recoverable: true,
    };
  }

  if (/enotfound|econnreset|econnrefused|eai_again|network|网络/.test(lower)) {
    return {
      reason: '网络连接失败，无法稳定访问模型服务。',
      advice: [
        '检查本机网络、代理、DNS 或服务商域名是否可访问。',
        '到「系统设置 -> 健康检查」重新检测服务可用性。',
        '切换到国内可直连的模型服务后重试。',
      ],
      actions: ['open_health', 'open_settings_models'],
      recoverable: true,
    };
  }

  if (stage === 'compose' || /ffmpeg|codec|filter|subtitle|合成/.test(lower)) {
    return {
      reason: '视频合成阶段失败，可能与 FFmpeg、素材格式、字幕或音频文件有关。',
      advice: [
        '到「系统设置 -> 健康检查」确认 FFmpeg 可用。',
        '检查分镜是否都有可用图片，音频或字幕文件是否存在。',
        '先进入项目预览页，尝试重新导出视频。',
      ],
      actions: ['open_preview', 'open_health', 'open_logs'],
      recoverable: true,
    };
  }

  if (/eacces|permission|权限/.test(lower)) {
    return {
      reason: '当前存储目录没有足够的读写权限。',
      advice: [
        '到「系统设置 -> 存储」更换为可写目录。',
        '避免把存储目录放在只读磁盘、安装目录或受限系统目录。',
        '保存后重启后端，让静态资源目录重新生效。',
      ],
      actions: ['open_settings_storage', 'retry'],
      recoverable: true,
    };
  }

  if (/enospc|no space|磁盘|空间不足/.test(lower)) {
    return {
      reason: '磁盘空间不足，无法继续写入素材或成片。',
      advice: [
        '清理临时文件、旧视频和无用素材。',
        '到「系统设置 -> 存储」查看空间占用并清理 temp。',
        '更换到空间更充足的存储目录。',
      ],
      actions: ['open_settings_storage'],
      recoverable: true,
    };
  }

  return {
    reason: text.length > 120 ? `${text.slice(0, 120)}...` : (text || '生成过程中出现未知错误。'),
    advice: [
      '保留当前项目，进入项目页查看已生成的分镜、图片和配音。',
      '查看详细日志定位具体阶段。',
      '如果是偶发网络或模型错误，可以稍后重试。',
    ],
    actions: ['open_project', 'open_logs', 'retry'],
    recoverable: true,
  };
}

function diagnose(error, options = {}) {
  const rawError = toMessage(error);
  const stage = stageFromText(`${options.currentMessage || ''} ${rawError}`, options.stageHint);
  const base = classify(rawError, stage);
  return {
    stage,
    title: stageTitle(stage),
    reason: base.reason,
    advice: base.advice,
    actions: base.actions,
    recoverable: base.recoverable,
    rawError,
    partialResult: partialResult(options.projectId),
    assetHealth: options.assetHealth || (error && error.assetHealth) || null,
    projectId: options.projectId || null,
    taskId: options.taskId || null,
    createdAt: Date.now(),
  };
}

module.exports = { diagnose, stageFromText };
