import fs from 'node:fs'
import path from 'node:path'
import { getDb, type DbClient, type SqlRow } from '../db'
import * as config from './config'
const { resolveUploadPath, toRelative } = require('../utils/fileCleanup');
const { parseDbTimeMs } = require('../utils/time');

export type AssetFileType = 'image' | 'audio' | 'video' | 'subtitle'
interface TypeDirectory { sub: string; prefix: string }
interface AssetRecord {
  kind: string
  type: AssetFileType
  id: unknown
  current_url: string
  target_name: string
  display_name: string
  asset_role: string
  project_id?: unknown
  project_name?: string | null
  project_deleted?: boolean
  storyboard_id?: unknown
  scene_number?: unknown
  sort_order?: unknown
  created_at?: unknown
}
interface ListedFile {
  name: string
  original_name: string
  display_name: string
  url: string
  size: number
  mtime: number
  project_id: unknown
  project_name: string | null
  project_deleted: boolean
  storyboard_id: unknown
  scene_number: unknown
  asset_role: string
  group_key: string
  normalized: boolean
}
interface NormalizeAction extends AssetRecord {
  status: 'missing' | 'unchanged' | 'rename'
  from: string
  to: string | null
  message?: string
  from_name?: string
  to_name?: string
}

export const TYPE_DIR: Record<AssetFileType, TypeDirectory> = {
  image: { sub: 'images', prefix: '/uploads/images/' },
  audio: { sub: 'audio', prefix: '/uploads/audio/' },
  video: { sub: 'videos', prefix: '/uploads/videos/' },
  subtitle: { sub: 'subtitles', prefix: '/uploads/subtitles/' },
};

export function cleanPart(value: unknown, fallback = '未命名'): string {
  const raw = String(value || fallback).trim() || fallback;
  return raw
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 42) || fallback;
}

export function sceneCode(sceneNumber: unknown, sortOrder: unknown, id: unknown): string {
  const n = Number(sceneNumber || Number(sortOrder) + 1 || id || 0) || 0;
  return `S${String(Math.max(1, n)).padStart(3, '0')}`;
}

function pad2(n: unknown): string {
  return String(Math.max(1, Number(n) || 1)).padStart(2, '0');
}

function extOf(stored: unknown, fallback = ''): string {
  const ext = path.extname(String(stored || '').split('?')[0] || '').toLowerCase();
  return ext || fallback;
}

function uploadDir(type: AssetFileType): string {
  const cfg = TYPE_DIR[type];
  return path.resolve(String(config.get('uploadDir')), cfg.sub);
}

function urlFor(type: AssetFileType, filename: string): string {
  return `${TYPE_DIR[type].prefix}${filename}`;
}

export function normalizeUrl(stored: unknown): string {
  return toRelative(stored || '').replace(/\\/g, '/');
}

function uniqueName(dir: string, desiredName: string, currentAbs = '', reserved: Set<string> = new Set()): string {
  const ext = path.extname(desiredName);
  const base = path.basename(desiredName, ext);
  let candidate = desiredName;
  let i = 2;
  while (true) {
    const abs = path.join(dir, candidate);
    const sameFile = currentAbs && path.resolve(abs) === path.resolve(currentAbs);
    if (!reserved.has(candidate) && (sameFile || !fs.existsSync(abs))) {
      reserved.add(candidate);
      return candidate;
    }
    candidate = `${base}_v${i}${ext}`;
    i++;
  }
}

function fmtTimeForName(value: unknown): string {
  const ms = parseDbTimeMs(value) || Date.now();
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function projectNameMap(db: DbClient): Map<number, string> {
  const map = new Map<number, string>();
  for (const p of db.prepare('SELECT id, name FROM projects').all()) {
    map.set(Number(p.id), String(p.name || `项目${p.id}`));
  }
  return map;
}

function imageAssets(db: DbClient = getDb()): AssetRecord[] {
  const rows = db.prepare(
    `SELECT i.*, s.id AS storyboard_id, s.scene_number, s.sort_order,
            p.id AS project_id, p.name AS project_name
       FROM images i
       LEFT JOIN storyboards s ON s.id = i.storyboard_id
       LEFT JOIN projects p ON p.id = s.project_id
      ORDER BY s.project_id ASC, s.sort_order ASC, s.scene_number ASC, i.created_at ASC, i.id ASC`
  ).all();
  const perStoryboard = new Map<unknown, number>();
  return rows.map((r: SqlRow): AssetRecord => {
    const key = r.storyboard_id || 'unknown';
    const idx = (perStoryboard.get(key) || 0) + 1;
    perStoryboard.set(key, idx);
    const project = cleanPart(r.project_name || `项目${r.project_id || '未知'}`);
    const base = `${project}_${sceneCode(r.scene_number, r.sort_order, r.storyboard_id)}_图片${pad2(idx)}`;
    const currentUrl = normalizeUrl(r.file_url || r.file_path);
    const ext = extOf(currentUrl, '.jpg');
    return {
      kind: 'image',
      type: 'image',
      id: r.id,
      storyboard_id: r.storyboard_id,
      scene_number: r.scene_number,
      sort_order: r.sort_order,
      project_id: r.project_id,
      project_name: r.project_name == null ? null : String(r.project_name),
      project_deleted: !r.project_id,
      current_url: currentUrl,
      target_name: `${base}${ext}`,
      display_name: `${base}${ext}`,
      asset_role: 'image',
      created_at: r.created_at,
    };
  }).filter((asset) => Boolean(asset.current_url));
}

function audioAssets(db: DbClient = getDb()): AssetRecord[] {
  const rows = db.prepare(
    `SELECT s.id AS storyboard_id, s.scene_number, s.sort_order, s.audio_url,
            p.id AS project_id, p.name AS project_name
       FROM storyboards s
       LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.audio_url IS NOT NULL AND s.audio_url <> ''
      ORDER BY p.id ASC, s.sort_order ASC, s.scene_number ASC`
  ).all();
  return rows.map((r: SqlRow): AssetRecord => {
    const project = cleanPart(r.project_name || `项目${r.project_id || '未知'}`);
    const base = `${project}_${sceneCode(r.scene_number, r.sort_order, r.storyboard_id)}_配音`;
    const currentUrl = normalizeUrl(r.audio_url);
    const ext = extOf(currentUrl, '.mp3');
    return {
      kind: 'audio',
      type: 'audio',
      id: r.storyboard_id,
      storyboard_id: r.storyboard_id,
      scene_number: r.scene_number,
      sort_order: r.sort_order,
      project_id: r.project_id,
      project_name: r.project_name == null ? null : String(r.project_name),
      project_deleted: !r.project_id,
      current_url: currentUrl,
      target_name: `${base}${ext}`,
      display_name: `${base}${ext}`,
      asset_role: 'voice',
    };
  });
}

function videoAssets(db: DbClient = getDb()): AssetRecord[] {
  const storyVideos = db.prepare(
    `SELECT s.id AS storyboard_id, s.scene_number, s.sort_order, s.video_path,
            p.id AS project_id, p.name AS project_name
       FROM storyboards s
       LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.video_path IS NOT NULL AND s.video_path <> ''
      ORDER BY p.id ASC, s.sort_order ASC, s.scene_number ASC`
  ).all().map((r: SqlRow): AssetRecord => {
    const project = cleanPart(r.project_name || `项目${r.project_id || '未知'}`);
    const base = `${project}_${sceneCode(r.scene_number, r.sort_order, r.storyboard_id)}_动态视频`;
    const currentUrl = normalizeUrl(r.video_path);
    return {
      kind: 'storyboard_video',
      type: 'video',
      id: r.storyboard_id,
      storyboard_id: r.storyboard_id,
      scene_number: r.scene_number,
      sort_order: r.sort_order,
      project_id: r.project_id,
      project_name: r.project_name == null ? null : String(r.project_name),
      project_deleted: !r.project_id,
      current_url: currentUrl,
      target_name: `${base}${extOf(currentUrl, '.mp4')}`,
      display_name: `${base}${extOf(currentUrl, '.mp4')}`,
      asset_role: 'storyboard_video',
    };
  });

  const exports = db.prepare(
    `SELECT e.*, p.id AS project_id, p.name AS project_name
       FROM exports e
       LEFT JOIN projects p ON p.id = e.project_id
      WHERE (e.file_url IS NOT NULL AND e.file_url <> '') OR (e.file_path IS NOT NULL AND e.file_path <> '')
      ORDER BY p.id ASC, e.created_at ASC, e.id ASC`
  ).all().map((r: SqlRow): AssetRecord => {
    const project = cleanPart(r.project_name || `项目${r.project_id || '未知'}`);
    const currentUrl = normalizeUrl(r.file_url || r.file_path);
    const base = `${project}_成片_${fmtTimeForName(r.created_at)}`;
    return {
      kind: 'export',
      type: 'video',
      id: r.id,
      project_id: r.project_id,
      project_name: r.project_name == null ? null : String(r.project_name),
      project_deleted: !r.project_name,
      current_url: currentUrl,
      target_name: `${base}${extOf(currentUrl, '.mp4')}`,
      display_name: `${base}${extOf(currentUrl, '.mp4')}`,
      asset_role: 'export',
      created_at: r.created_at,
    };
  });
  return [...storyVideos, ...exports];
}

function subtitleRole(filename: unknown): { key: string; label: string; ext: string } {
  const lower = String(filename || '').toLowerCase();
  if (/karaoke/.test(lower)) return { key: 'karaoke', label: 'karaoke', ext: '.ass' };
  if (/effect/.test(lower)) return { key: 'effect', label: 'effect', ext: '.ass' };
  return { key: 'srt', label: 'srt', ext: '.srt' };
}

function inferSubtitleProject(filename: unknown, projects: Map<number, string>): { id: number | null; name: string | null | undefined; deleted: boolean } {
  let m = String(filename || '').match(/^subtitle_(?:project|karaoke|effect)_(\d+)\.(?:srt|ass)$/i);
  if (m) {
    const id = Number(m[1] || 0);
    return { id, name: projects.get(id), deleted: !projects.has(id) };
  }
  const sorted = [...projects.entries()].sort((left, right) => cleanPart(right[1]).length - cleanPart(left[1]).length);
  for (const [id, name] of sorted) {
    const prefix = `${cleanPart(name)}_字幕_`;
    if (String(filename || '').startsWith(prefix)) return { id, name, deleted: false };
  }
  m = String(filename || '').match(/project_(\d+)/i);
  if (m) {
    const id = Number(m[1] || 0);
    return { id, name: projects.get(id), deleted: !projects.has(id) };
  }
  return { id: null, name: null, deleted: false };
}

function subtitleAssets(db: DbClient = getDb()): AssetRecord[] {
  const dir = uploadDir('subtitle');
  const projects = projectNameMap(db);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name: string) => {
    try { return fs.statSync(path.join(dir, name)).isFile(); } catch { return false; }
  }).map((name: string): AssetRecord => {
    const role = subtitleRole(name);
    const owner = inferSubtitleProject(name, projects);
    const projectName = owner.name || (owner.id ? `项目#${owner.id}` : '未归属素材');
    const base = `${cleanPart(projectName)}_字幕_${role.label}`;
    const currentUrl = urlFor('subtitle', name);
    const ext = extOf(name, role.ext);
    return {
      kind: 'subtitle',
      type: 'subtitle',
      id: null,
      project_id: owner.id,
      project_name: owner.name,
      project_deleted: !!owner.deleted,
      current_url: currentUrl,
      target_name: `${base}${ext}`,
      display_name: `${base}${ext}`,
      asset_role: `subtitle_${role.key}`,
    };
  });
}

function assetsForType(type: AssetFileType, db: DbClient = getDb()): AssetRecord[] {
  if (type === 'image') return imageAssets(db);
  if (type === 'audio') return audioAssets(db);
  if (type === 'video') return videoAssets(db);
  if (type === 'subtitle') return subtitleAssets(db);
  return [];
}

export function metaMap(type: AssetFileType, db: DbClient = getDb()): Map<string, AssetRecord> {
  const map = new Map<string, AssetRecord>();
  for (const asset of assetsForType(type, db)) {
    map.set(normalizeUrl(asset.current_url), asset);
  }
  return map;
}

function guessDeletedProjectFromName(name: unknown, projects: Map<number, string>): { id: number; name: string | null; deleted: boolean } | null {
  let m = String(name || '').match(/(?:project|tts|subtitle_project)_(\d+)/i);
  if (!m) return null;
  const id = Number(m[1] || 0);
  return { id, name: projects.get(id) || null, deleted: !projects.has(id) };
}

export function listFiles(type: AssetFileType): { type: AssetFileType; dir: string; list: ListedFile[] } {
  const cfg = TYPE_DIR[type];
  if (!cfg) throw new Error('无效的文件类型');
  const db = getDb();
  const dir = uploadDir(type);
  const map = metaMap(type, db);
  const projects = projectNameMap(db);
  const list: ListedFile[] = [];
  if (!fs.existsSync(dir)) return { type, dir, list };
  for (const fname of fs.readdirSync(dir)) {
    const full = path.join(dir, fname);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    const url = urlFor(type, fname);
    const meta = map.get(url);
    const guessed = meta ? null : guessDeletedProjectFromName(fname, projects);
    const projectId = meta?.project_id ?? guessed?.id ?? null;
    const projectName = meta?.project_name ?? guessed?.name ?? null;
    const normalized = meta ? isNormalizedName(fname, meta.target_name) : false;
    list.push({
      name: fname,
      original_name: fname,
      display_name: normalized ? fname : (meta?.display_name || fname),
      url,
      size: st.size,
      mtime: st.mtimeMs,
      project_id: projectId,
      project_name: projectName,
      project_deleted: meta?.project_deleted || !!guessed?.deleted,
      storyboard_id: meta?.storyboard_id || null,
      scene_number: meta?.scene_number || null,
      asset_role: meta?.asset_role || type,
      group_key: projectId ? `${projectId}:${type}` : `orphan:${type}`,
      normalized,
    });
  }
  list.sort((a: ListedFile, b: ListedFile) => {
    const pa = a.project_name || (a.project_id ? `项目#${a.project_id}` : '未归属素材');
    const pb = b.project_name || (b.project_id ? `项目#${b.project_id}` : '未归属素材');
    if (pa !== pb) return pa.localeCompare(pb, 'zh-CN');
    if (Number(a.scene_number || 0) !== Number(b.scene_number || 0)) return Number(a.scene_number || 999999) - Number(b.scene_number || 999999);
    if ((a.asset_role || '') !== (b.asset_role || '')) return String(a.asset_role || '').localeCompare(String(b.asset_role || ''));
    return b.mtime - a.mtime;
  });
  return { type, dir, list };
}

export function isNormalizedName(filename: string, targetName: string): boolean {
  if (!filename || !targetName) return false;
  if (filename === targetName) return true;
  const ext = path.extname(targetName);
  const base = path.basename(targetName, ext);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}_v\\d+${ext.replace('.', '\\.')}$`).test(filename);
}

function updateReference(asset: AssetRecord, newUrl: string): void {
  const db = getDb();
  if (asset.kind === 'image') {
    db.prepare('UPDATE images SET file_path=?, file_url=? WHERE id=?').run(newUrl, newUrl, asset.id);
  } else if (asset.kind === 'audio') {
    db.prepare('UPDATE storyboards SET audio_url=? WHERE id=?').run(newUrl, asset.id);
  } else if (asset.kind === 'storyboard_video') {
    db.prepare('UPDATE storyboards SET video_path=? WHERE id=?').run(newUrl, asset.id);
  } else if (asset.kind === 'export') {
    db.prepare('UPDATE exports SET file_path=?, file_url=? WHERE id=?').run(newUrl, newUrl, asset.id);
  }
}

function normalizeAsset(asset: AssetRecord, reserved: Set<string>, dryRun = false): NormalizeAction {
  const currentAbs = resolveUploadPath(asset.current_url);
  if (!currentAbs || !fs.existsSync(currentAbs)) {
    return { ...asset, status: 'missing', from: asset.current_url, to: null, message: '文件不存在，已跳过' };
  }
  const dir = uploadDir(asset.type);
  const targetName = uniqueName(dir, asset.target_name, currentAbs, reserved);
  const targetAbs = path.join(dir, targetName);
  const targetUrl = urlFor(asset.type, targetName);
  const samePath = path.resolve(currentAbs) === path.resolve(targetAbs);
  const action: NormalizeAction = {
    ...asset,
    from: asset.current_url,
    to: targetUrl,
    from_name: path.basename(asset.current_url),
    to_name: targetName,
    status: samePath ? 'unchanged' : 'rename',
  };
  if (dryRun) return action;
  if (!samePath) {
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.renameSync(currentAbs, targetAbs);
  }
  if (asset.kind !== 'subtitle') updateReference(asset, targetUrl);
  return action;
}

export function normalizeNames({ types = ['image', 'audio', 'subtitle', 'video'], dryRun = false }: { types?: unknown[]; dryRun?: boolean } = {}) {
  const fallback: AssetFileType[] = ['image', 'audio', 'subtitle', 'video'];
  const wanted = Array.isArray(types) && types.length
    ? types.filter((type): type is AssetFileType => type === 'image' || type === 'audio' || type === 'subtitle' || type === 'video')
    : fallback;
  const actions: NormalizeAction[] = [];
  for (const type of wanted) {
    const reserved = new Set<string>();
    for (const asset of assetsForType(type)) {
      actions.push(normalizeAsset(asset, reserved, dryRun));
    }
  }
  return {
    dry_run: !!dryRun,
    total: actions.length,
    renamed: actions.filter((action) => action.status === 'rename').length,
    unchanged: actions.filter((action) => action.status === 'unchanged').length,
    missing: actions.filter((action) => action.status === 'missing').length,
    actions,
  };
}

function normalizeByPredicate(type: AssetFileType, predicate: (asset: AssetRecord) => boolean): string | null {
  const asset = assetsForType(type).find(predicate);
  if (!asset) return null;
  const result = normalizeAsset(asset, new Set(), false);
  return result.to || asset.current_url;
}

export function normalizeImageRecord(id: unknown): string | null {
  return normalizeByPredicate('image', (asset) => Number(asset.id) === Number(id));
}

export function normalizeStoryboardAudio(storyboardId: unknown): string | null {
  return normalizeByPredicate('audio', (asset) => Number(asset.id) === Number(storyboardId));
}

export function normalizeStoryboardVideo(storyboardId: unknown): string | null {
  return normalizeByPredicate('video', (asset) => asset.kind === 'storyboard_video' && Number(asset.id) === Number(storyboardId));
}

export function normalizeExport(id: unknown): string | null {
  return normalizeByPredicate('video', (asset) => asset.kind === 'export' && Number(asset.id) === Number(id));
}

export function subtitleFilename(projectId: string | number, role = 'srt', ext: string | null = null): string {
  const db = getDb();
  const p = db.prepare('SELECT id, name FROM projects WHERE id=?').get(projectId);
  const label = role || 'srt';
  const useExt = ext || (label === 'srt' ? '.srt' : '.ass');
  const filename = `${cleanPart(p?.name || `项目${projectId}`)}_字幕_${label}${useExt}`;
  const dir = uploadDir('subtitle');
  return uniqueName(dir, filename, '', new Set());
}
