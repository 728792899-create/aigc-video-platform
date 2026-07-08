const fs = require('fs');
const { getDb } = require('../db');
const config = require('./config');
const { resolveUploadPath } = require('../utils/fileCleanup');
const { probeDuration } = require('../utils/mediaProbe');

const DEFAULT_DURATION_SEC = 5;

function normalizeVideoSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(Math.min(2, Math.max(0.5, n)) * 100) / 100;
}

function pacingTail() {
  const pacing = config.get('pacing') || {};
  return pacing.tightPace === false
    ? (Number(pacing.standardTail) || 0.3)
    : (Number(pacing.tightTail) || 0.12);
}

function resolveExistingUpload(stored) {
  const abs = resolveUploadPath(stored);
  return abs && fs.existsSync(abs) ? abs : null;
}

async function durationOf(stored) {
  const abs = resolveExistingUpload(stored);
  if (!abs) return { seconds: null, path: stored || '', exists: false };
  const seconds = await probeDuration(abs);
  return {
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    path: stored || '',
    exists: true,
  };
}

function sortStoryboards(rows) {
  return [...(rows || [])].sort((a, b) => {
    const so = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    if (so) return so;
    const sn = Number(a.scene_number || 0) - Number(b.scene_number || 0);
    if (sn) return sn;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function syncStatus(sb, audioExists) {
  const hasDialog = !!String(sb.dialog || '').trim();
  const hasSubtitle = !!String(sb.subtitle_text || '').trim();
  if (sb.no_voice) return hasSubtitle || hasDialog ? 'ok' : 'empty';
  if (hasDialog && !audioExists) return 'voice_missing';
  if (hasDialog && audioExists && !hasSubtitle) return 'subtitle_from_dialog';
  if (hasDialog && audioExists && hasSubtitle) return 'ok';
  return audioExists ? 'ok' : 'empty';
}

function subtitleTextOf(sb) {
  const text = String(sb.subtitle_text || sb.dialog || '').trim();
  if (!text) return '';
  return text
    .replace(/(^|[\n。！？；.!?;])\s*[（(【[][^）)】\]\n]{1,12}[）)】\]][:：]?\s*/g, '$1')
    .replace(/^[^：:\n]{1,8}\s*[：:]\s*/gm, '')
    .trim();
}

async function buildProjectTimeline(projectId, options = {}) {
  const videoSpeed = normalizeVideoSpeed(options.videoSpeed);
  const db = getDb();
  const storyboards = sortStoryboards(
    options.storyboards || db.prepare('SELECT * FROM storyboards WHERE project_id=? ORDER BY sort_order ASC, scene_number ASC, id ASC').all(projectId)
  );
  const tail = pacingTail();

  let originalCursorMs = 0;
  let scaledCursorMs = 0;
  const scenes = [];
  const subtitles = [];

  for (const sb of storyboards) {
    const audio = (!sb.no_voice && sb.audio_url) ? await durationOf(sb.audio_url) : { seconds: null, exists: false, path: sb.audio_url || '' };
    const video = sb.video_path ? await durationOf(sb.video_path) : { seconds: null, exists: false, path: sb.video_path || '' };

    let basis = 'duration';
    let seconds = Number(sb.duration) || DEFAULT_DURATION_SEC;
    if (audio.seconds) {
      basis = 'audio';
      seconds = audio.seconds + tail;
    } else if (video.seconds) {
      basis = 'video';
      seconds = video.seconds;
    } else if (!Number(sb.duration)) {
      basis = 'default';
      seconds = DEFAULT_DURATION_SEC;
    }

    const originalDurationMs = Math.max(1, Math.round(seconds * 1000));
    const scaledDurationMs = Math.max(1, Math.round(originalDurationMs / videoSpeed));

    const subtitleText = subtitleTextOf(sb);
    const scene = {
      id: sb.id,
      storyboard_id: sb.id,
      scene_number: sb.scene_number,
      sort_order: sb.sort_order,
      basis,
      start_ms: scaledCursorMs,
      end_ms: scaledCursorMs + scaledDurationMs,
      duration_ms: scaledDurationMs,
      scaled_duration_ms: scaledDurationMs,
      original_start_ms: originalCursorMs,
      original_end_ms: originalCursorMs + originalDurationMs,
      original_duration_ms: originalDurationMs,
      effective_duration_ms: originalDurationMs,
      audio_duration_ms: audio.seconds ? Math.round(audio.seconds * 1000) : null,
      video_duration_ms: video.seconds ? Math.round(video.seconds * 1000) : null,
      audio_exists: !!audio.exists,
      video_exists: !!video.exists,
      has_dialog: !!String(sb.dialog || '').trim(),
      has_subtitle: !!String(sb.subtitle_text || '').trim(),
      subtitle_text: subtitleText,
      subtitle_source: String(sb.subtitle_text || '').trim() ? 'subtitle_text' : (subtitleText ? 'dialog' : 'empty'),
      no_voice: !!sb.no_voice,
      sync_status: syncStatus(sb, audio.exists),
    };
    scenes.push(scene);
    if (subtitleText) {
      subtitles.push({
        storyboard_id: sb.id,
        scene_number: sb.scene_number,
        start_ms: scene.start_ms,
        end_ms: scene.end_ms,
        duration_ms: scene.duration_ms,
        text: subtitleText,
        source: scene.subtitle_source,
      });
    }

    originalCursorMs += originalDurationMs;
    scaledCursorMs += scaledDurationMs;
  }

  return {
    project_id: Number(projectId),
    video_speed: videoSpeed,
    scene_count: scenes.length,
    total_duration_ms: scaledCursorMs,
    original_total_duration_ms: originalCursorMs,
    total_duration: Math.round((scaledCursorMs / 1000) * 100) / 100,
    original_total_duration: Math.round((originalCursorMs / 1000) * 100) / 100,
    subtitles,
    scenes,
  };
}

function sceneMap(timeline) {
  const map = new Map();
  for (const scene of timeline?.scenes || []) map.set(Number(scene.storyboard_id), scene);
  return map;
}

module.exports = {
  DEFAULT_DURATION_SEC,
  normalizeVideoSpeed,
  buildProjectTimeline,
  sceneMap,
};
