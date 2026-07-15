import fs from 'node:fs'
import { getDb, type SqlRow } from '../db'
import * as config from './config'
import { resolveUploadPath } from '../utils/fileCleanup'
const { probeDuration } = require('../utils/mediaProbe');

type JsonObject = Record<string, unknown>
export interface TimelineScene extends JsonObject {
  storyboard_id: unknown
  start_ms: number
  end_ms: number
  duration_ms: number
  original_duration_ms: number
}
export interface ProjectTimeline {
  project_id: number
  video_speed: number
  scene_count: number
  total_duration_ms: number
  original_total_duration_ms: number
  total_duration: number
  original_total_duration: number
  subtitles: JsonObject[]
  scenes: TimelineScene[]
}
interface TimelineOptions {
  videoSpeed?: number
  storyboards?: SqlRow[]
}

export const DEFAULT_DURATION_SEC = 5;

export function normalizeVideoSpeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(Math.min(2, Math.max(0.5, n)) * 100) / 100;
}

function pacingTail() {
  const raw = config.get('pacing');
  const pacing = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw)) : {};
  return pacing.tightPace === false
    ? (Number(pacing.standardTail) || 0.3)
    : (Number(pacing.tightTail) || 0.12);
}

function resolveExistingUpload(stored: unknown): string | null {
  const abs = resolveUploadPath(stored);
  return abs && fs.existsSync(abs) ? abs : null;
}

async function durationOf(stored: unknown): Promise<{ seconds: number | null; path: unknown; exists: boolean }> {
  const abs = resolveExistingUpload(stored);
  if (!abs) return { seconds: null, path: stored || '', exists: false };
  const seconds = await probeDuration(abs);
  return {
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    path: stored || '',
    exists: true,
  };
}

function sortStoryboards(rows: SqlRow[] = []): SqlRow[] {
  return [...(rows || [])].sort((a, b) => {
    const so = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    if (so) return so;
    const sn = Number(a.scene_number || 0) - Number(b.scene_number || 0);
    if (sn) return sn;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function syncStatus(sb: SqlRow, audioExists: boolean): string {
  const hasDialog = !!String(sb.dialog || '').trim();
  const hasSubtitle = !!String(sb.subtitle_text || '').trim();
  if (sb.no_voice) return hasSubtitle || hasDialog ? 'ok' : 'empty';
  if (hasDialog && !audioExists) return 'voice_missing';
  if (hasDialog && audioExists && !hasSubtitle) return 'subtitle_from_dialog';
  if (hasDialog && audioExists && hasSubtitle) return 'ok';
  return audioExists ? 'ok' : 'empty';
}

function subtitleTextOf(sb: SqlRow): string {
  const text = String(sb.subtitle_text || sb.dialog || '').trim();
  if (!text) return '';
  return text
    .replace(/(^|[\n。！？；.!?;])\s*[（(【[][^）)】\]\n]{1,12}[）)】\]][:：]?\s*/g, '$1')
    .replace(/^[^：:\n]{1,8}\s*[：:]\s*/gm, '')
    .trim();
}

export async function buildProjectTimeline(projectId: unknown, options: TimelineOptions = {}): Promise<ProjectTimeline> {
  const videoSpeed = normalizeVideoSpeed(options.videoSpeed);
  const db = getDb();
  const storyboards = sortStoryboards(
    options.storyboards || db.prepare('SELECT * FROM storyboards WHERE project_id=? ORDER BY sort_order ASC, scene_number ASC, id ASC').all(projectId)
  );
  const tail = pacingTail();

  let originalCursorMs = 0;
  let scaledCursorMs = 0;
  const scenes: TimelineScene[] = [];
  const subtitles: JsonObject[] = [];

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

export function sceneMap(timeline: unknown): Map<number, TimelineScene> {
  const map = new Map<number, TimelineScene>();
  const raw = timeline && typeof timeline === 'object' && !Array.isArray(timeline) ? Object.fromEntries(Object.entries(timeline)) : {};
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  for (const value of scenes) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const scene = Object.fromEntries(Object.entries(value));
    const start = Number(scene.start_ms);
    const end = Number(scene.end_ms);
    const duration = Number(scene.duration_ms);
    const originalDuration = Number(scene.original_duration_ms);
    if (![start, end, duration, originalDuration].every(Number.isFinite)) continue;
    map.set(Number(scene.storyboard_id), {
      ...scene,
      storyboard_id: scene.storyboard_id,
      start_ms: start,
      end_ms: end,
      duration_ms: duration,
      original_duration_ms: originalDuration,
    });
  }
  return map;
}
