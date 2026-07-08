const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const config = require('./config');
const { resolveUploadPath } = require('../utils/fileCleanup');
const { resolveFfmpegPath } = require('../utils/ffmpeg');

function ffmpegState() {
  const info = resolveFfmpegPath(config.get('ffmpegPath'));
  const configured = String(config.get('ffmpegPath') || '').trim();
  const needsFileCheck = info.source !== '系统 PATH' || (configured && configured !== 'ffmpeg');
  return {
    ...info,
    ok: needsFileCheck ? fs.existsSync(info.path) : true,
  };
}

function fileState(stored) {
  const abs = resolveUploadPath(stored);
  return {
    path: stored || '',
    exists: !!(abs && fs.existsSync(abs)),
  };
}

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function checkProjectAssets(projectId) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;

  const storyboards = db.prepare(
    `SELECT s.*, i.file_url AS selected_image_url, i.file_path AS selected_image_path
     FROM storyboards s
     LEFT JOIN images i ON i.id = s.selected_image_id
     WHERE s.project_id = ?
     ORDER BY s.sort_order ASC, s.scene_number ASC`
  ).all(projectId);
  const images = db.prepare(
    `SELECT i.*
     FROM images i
     JOIN storyboards s ON s.id = i.storyboard_id
     WHERE s.project_id = ?`
  ).all(projectId);
  const exportsRows = db.prepare('SELECT * FROM exports WHERE project_id = ?').all(projectId);

  const imagesByStoryboard = new Map();
  for (const img of images) {
    if (!imagesByStoryboard.has(img.storyboard_id)) imagesByStoryboard.set(img.storyboard_id, []);
    imagesByStoryboard.get(img.storyboard_id).push(img);
  }

  const scenes = [];
  let usableImageSceneCount = 0;
  let selectedImageSceneCount = 0;
  let selectedImageMissingCount = 0;
  let audioMissingCount = 0;
  let videoMissingCount = 0;
  let subtitleCount = 0;

  for (const sb of storyboards) {
    const selectedPath = sb.selected_image_url || sb.selected_image_path;
    const selected = fileState(selectedPath);
    const imgs = imagesByStoryboard.get(sb.id) || [];
    const usableImages = imgs.filter((img) => fileState(img.file_url || img.file_path).exists);
    const hasUsableImage = selected.exists || usableImages.length > 0;
    if (hasUsableImage) usableImageSceneCount++;
    if (sb.selected_image_id) selectedImageSceneCount++;
    if (sb.selected_image_id && !selected.exists) selectedImageMissingCount++;

    const audio = fileState(sb.audio_url);
    if (sb.audio_url && !audio.exists) audioMissingCount++;
    const video = fileState(sb.video_path);
    if (sb.video_path && !video.exists) videoMissingCount++;
    if ((sb.subtitle_text || sb.dialog || '').trim()) subtitleCount++;

    scenes.push({
      id: sb.id,
      scene_number: sb.scene_number,
      has_selected_image: !!sb.selected_image_id,
      selected_image_exists: selected.exists,
      usable_image_count: usableImages.length,
      has_usable_image: hasUsableImage,
      audio_exists: !sb.audio_url || audio.exists,
      video_exists: !sb.video_path || video.exists,
    });
  }

  const missingImageScenes = scenes.filter((s) => !s.has_usable_image)
    .map((s) => ({ id: s.id, scene_number: s.scene_number }));
  const exportMissingCount = exportsRows.filter((row) => !fileState(row.file_url || row.file_path).exists).length;
  const ffmpeg = ffmpegState();
  const outputDir = path.resolve(config.get('uploadDir'), 'videos');
  const outputWritable = isWritableDir(outputDir);

  const issues = [];
  if (!storyboards.length) {
    issues.push({ level: 'warn', code: 'NO_STORYBOARDS', message: '项目还没有分镜剧本。' });
  }
  if (missingImageScenes.length) {
    issues.push({
      level: 'error',
      code: 'MISSING_IMAGES',
      message: `${missingImageScenes.length} 个分镜没有可用于合成的图片。`,
      scenes: missingImageScenes,
      suggestions: ['进入图片页为缺图分镜生成图片。', '或重新执行一键成片补齐图片。', '如果已有图片，先为分镜选择一张图片。'],
    });
  }
  if (selectedImageMissingCount) {
    issues.push({ level: 'warn', code: 'SELECTED_IMAGE_MISSING', message: `${selectedImageMissingCount} 个分镜选中的图片文件不存在，可自动改用该分镜最新可用图片。` });
  }
  if (audioMissingCount) {
    issues.push({ level: 'warn', code: 'AUDIO_FILE_MISSING', message: `${audioMissingCount} 个配音文件不存在，合成时会跳过对应配音。` });
  }
  if (videoMissingCount) {
    issues.push({ level: 'warn', code: 'VIDEO_FILE_MISSING', message: `${videoMissingCount} 个分镜动态视频文件不存在，将降级为静图运镜。` });
  }
  if (exportMissingCount) {
    issues.push({ level: 'warn', code: 'EXPORT_FILE_MISSING', message: `${exportMissingCount} 个成片记录指向的文件不存在。` });
  }
  if (!ffmpeg.ok) {
    issues.push({ level: 'error', code: 'FFMPEG_UNAVAILABLE', message: 'FFmpeg 不可用，无法合成视频。' });
  }
  if (!outputWritable) {
    issues.push({ level: 'error', code: 'OUTPUT_NOT_WRITABLE', message: '视频输出目录不可写。' });
  }

  const hasError = issues.some((i) => i.level === 'error');
  const hasWarn = issues.some((i) => i.level === 'warn');
  return {
    project_id: Number(projectId),
    status: hasError ? 'error' : (hasWarn ? 'warn' : 'ok'),
    can_compose: !hasError && storyboards.length > 0,
    summary: hasError ? '资产缺失' : (hasWarn ? '可修复' : '正常'),
    counts: {
      storyboards: storyboards.length,
      images: images.length,
      usable_image_scenes: usableImageSceneCount,
      selected_image_scenes: selectedImageSceneCount,
      subtitles: subtitleCount,
      exports: exportsRows.length,
    },
    issues,
    scenes,
    ffmpeg: { ok: ffmpeg.ok, source: ffmpeg.source, path: ffmpeg.path },
    output: { dir: outputDir, writable: outputWritable },
  };
}

function assertComposable(projectId) {
  const health = checkProjectAssets(projectId);
  if (!health) {
    const err = new Error('项目不存在，无法进行资产预检');
    err.assetHealth = null;
    throw err;
  }
  if (!health.can_compose) {
    const primary = health.issues.find((i) => i.level === 'error') || health.issues[0];
    const err = new Error(primary ? primary.message : '项目资产未通过预检，无法合成视频');
    err.assetHealth = health;
    err.stageHint = primary?.code === 'FFMPEG_UNAVAILABLE' ? 'compose' : 'asset';
    throw err;
  }
  return health;
}

module.exports = { checkProjectAssets, assertComposable };
