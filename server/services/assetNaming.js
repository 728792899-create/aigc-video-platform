const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const config = require('./config');
const { resolveUploadPath, toRelative } = require('../utils/fileCleanup');
const { parseDbTimeMs } = require('../utils/time');

const TYPE_DIR = {
  image: { sub: 'images', prefix: '/uploads/images/' },
  audio: { sub: 'audio', prefix: '/uploads/audio/' },
  video: { sub: 'videos', prefix: '/uploads/videos/' },
  subtitle: { sub: 'subtitles', prefix: '/uploads/subtitles/' },
};

function cleanPart(value, fallback = '未命名') {
  const raw = String(value || fallback).trim() || fallback;
  return raw
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 42) || fallback;
}

function sceneCode(sceneNumber, sortOrder, id) {
  const n = Number(sceneNumber || sortOrder + 1 || id || 0) || 0;
  return `S${String(Math.max(1, n)).padStart(3, '0')}`;
}

function pad2(n) {
  return String(Math.max(1, Number(n) || 1)).padStart(2, '0');
}

function extOf(stored, fallback = '') {
  const ext = path.extname(String(stored || '').split('?')[0]).toLowerCase();
  return ext || fallback;
}

function uploadDir(type) {
  const cfg = TYPE_DIR[type];
  if (!cfg) return null;
  return path.resolve(config.get('uploadDir'), cfg.sub);
}

function urlFor(type, filename) {
  return `${TYPE_DIR[type].prefix}${filename}`;
}

function normalizeUrl(stored) {
  return toRelative(stored || '').replace(/\\/g, '/');
}

function fileExists(stored) {
  const abs = resolveUploadPath(stored);
  return !!(abs && fs.existsSync(abs));
}

function uniqueName(dir, desiredName, currentAbs = '', reserved = new Set()) {
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

function fmtTimeForName(value) {
  const ms = parseDbTimeMs(value) || Date.now();
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function projectNameMap(db) {
  const map = new Map();
  for (const p of db.prepare('SELECT id, name FROM projects').all()) {
    map.set(Number(p.id), p.name || `项目${p.id}`);
  }
  return map;
}

function imageAssets(db = getDb()) {
  const rows = db.prepare(
    `SELECT i.*, s.id AS storyboard_id, s.scene_number, s.sort_order,
            p.id AS project_id, p.name AS project_name
       FROM images i
       LEFT JOIN storyboards s ON s.id = i.storyboard_id
       LEFT JOIN projects p ON p.id = s.project_id
      ORDER BY s.project_id ASC, s.sort_order ASC, s.scene_number ASC, i.created_at ASC, i.id ASC`
  ).all();
  const perStoryboard = new Map();
  return rows.map((r) => {
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
      project_name: r.project_name,
      project_deleted: !r.project_id,
      current_url: currentUrl,
      target_name: `${base}${ext}`,
      display_name: `${base}${ext}`,
      asset_role: 'image',
      created_at: r.created_at,
    };
  }).filter(a => a.current_url);
}

function audioAssets(db = getDb()) {
  const rows = db.prepare(
    `SELECT s.id AS storyboard_id, s.scene_number, s.sort_order, s.audio_url,
            p.id AS project_id, p.name AS project_name
       FROM storyboards s
       LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.audio_url IS NOT NULL AND s.audio_url <> ''
      ORDER BY p.id ASC, s.sort_order ASC, s.scene_number ASC`
  ).all();
  return rows.map((r) => {
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
      project_name: r.project_name,
      project_deleted: !r.project_id,
      current_url: currentUrl,
      target_name: `${base}${ext}`,
      display_name: `${base}${ext}`,
      asset_role: 'voice',
    };
  });
}

function videoAssets(db = getDb()) {
  const storyVideos = db.prepare(
    `SELECT s.id AS storyboard_id, s.scene_number, s.sort_order, s.video_path,
            p.id AS project_id, p.name AS project_name
       FROM storyboards s
       LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.video_path IS NOT NULL AND s.video_path <> ''
      ORDER BY p.id ASC, s.sort_order ASC, s.scene_number ASC`
  ).all().map((r) => {
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
      project_name: r.project_name,
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
  ).all().map((r) => {
    const project = cleanPart(r.project_name || `项目${r.project_id || '未知'}`);
    const currentUrl = normalizeUrl(r.file_url || r.file_path);
    const base = `${project}_成片_${fmtTimeForName(r.created_at)}`;
    return {
      kind: 'export',
      type: 'video',
      id: r.id,
      project_id: r.project_id,
      project_name: r.project_name,
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

function subtitleRole(filename) {
  const lower = String(filename || '').toLowerCase();
  if (/karaoke/.test(lower)) return { key: 'karaoke', label: 'karaoke', ext: '.ass' };
  if (/effect/.test(lower)) return { key: 'effect', label: 'effect', ext: '.ass' };
  return { key: 'srt', label: 'srt', ext: '.srt' };
}

function inferSubtitleProject(filename, projects) {
  let m = String(filename || '').match(/^subtitle_(?:project|karaoke|effect)_(\d+)\.(?:srt|ass)$/i);
  if (m) {
    const id = Number(m[1]);
    return { id, name: projects.get(id), deleted: !projects.has(id) };
  }
  const sorted = [...projects.entries()].sort((a, b) => cleanPart(b[1]).length - cleanPart(a[1]).length);
  for (const [id, name] of sorted) {
    const prefix = `${cleanPart(name)}_字幕_`;
    if (String(filename || '').startsWith(prefix)) return { id, name, deleted: false };
  }
  m = String(filename || '').match(/project_(\d+)/i);
  if (m) {
    const id = Number(m[1]);
    return { id, name: projects.get(id), deleted: !projects.has(id) };
  }
  return { id: null, name: null, deleted: false };
}

function subtitleAssets(db = getDb()) {
  const dir = uploadDir('subtitle');
  const projects = projectNameMap(db);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => {
    try { return fs.statSync(path.join(dir, name)).isFile(); } catch { return false; }
  }).map((name) => {
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

function assetsForType(type, db = getDb()) {
  if (type === 'image') return imageAssets(db);
  if (type === 'audio') return audioAssets(db);
  if (type === 'video') return videoAssets(db);
  if (type === 'subtitle') return subtitleAssets(db);
  return [];
}

function metaMap(type, db = getDb()) {
  const map = new Map();
  for (const asset of assetsForType(type, db)) {
    map.set(normalizeUrl(asset.current_url), asset);
  }
  return map;
}

function guessDeletedProjectFromName(name, projects) {
  let m = String(name || '').match(/(?:project|tts|subtitle_project)_(\d+)/i);
  if (!m) return null;
  const id = Number(m[1]);
  return { id, name: projects.get(id) || null, deleted: !projects.has(id) };
}

function listFiles(type) {
  const cfg = TYPE_DIR[type];
  if (!cfg) throw new Error('无效的文件类型');
  const db = getDb();
  const dir = uploadDir(type);
  const map = metaMap(type, db);
  const projects = projectNameMap(db);
  const list = [];
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
  list.sort((a, b) => {
    const pa = a.project_name || (a.project_id ? `项目#${a.project_id}` : '未归属素材');
    const pb = b.project_name || (b.project_id ? `项目#${b.project_id}` : '未归属素材');
    if (pa !== pb) return pa.localeCompare(pb, 'zh-CN');
    if ((a.scene_number || 0) !== (b.scene_number || 0)) return (a.scene_number || 999999) - (b.scene_number || 999999);
    if ((a.asset_role || '') !== (b.asset_role || '')) return String(a.asset_role || '').localeCompare(String(b.asset_role || ''));
    return b.mtime - a.mtime;
  });
  return { type, dir, list };
}

function isNormalizedName(filename, targetName) {
  if (!filename || !targetName) return false;
  if (filename === targetName) return true;
  const ext = path.extname(targetName);
  const base = path.basename(targetName, ext);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}_v\\d+${ext.replace('.', '\\.')}$`).test(filename);
}

function updateReference(asset, newUrl) {
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

function normalizeAsset(asset, reserved, dryRun = false) {
  const currentAbs = resolveUploadPath(asset.current_url);
  if (!currentAbs || !fs.existsSync(currentAbs)) {
    return { ...asset, status: 'missing', from: asset.current_url, to: null, message: '文件不存在，已跳过' };
  }
  const dir = uploadDir(asset.type);
  const targetName = uniqueName(dir, asset.target_name, currentAbs, reserved);
  const targetAbs = path.join(dir, targetName);
  const targetUrl = urlFor(asset.type, targetName);
  const samePath = path.resolve(currentAbs) === path.resolve(targetAbs);
  const action = {
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

function normalizeNames({ types = ['image', 'audio', 'subtitle', 'video'], dryRun = false } = {}) {
  const wanted = Array.isArray(types) && types.length ? types : ['image', 'audio', 'subtitle', 'video'];
  const actions = [];
  for (const type of wanted) {
    const reserved = new Set();
    for (const asset of assetsForType(type)) {
      actions.push(normalizeAsset(asset, reserved, dryRun));
    }
  }
  return {
    dry_run: !!dryRun,
    total: actions.length,
    renamed: actions.filter(a => a.status === 'rename').length,
    unchanged: actions.filter(a => a.status === 'unchanged').length,
    missing: actions.filter(a => a.status === 'missing').length,
    actions,
  };
}

function normalizeByPredicate(type, predicate) {
  const asset = assetsForType(type).find(predicate);
  if (!asset) return null;
  const result = normalizeAsset(asset, new Set(), false);
  return result.to || asset.current_url;
}

function normalizeImageRecord(id) {
  return normalizeByPredicate('image', (a) => Number(a.id) === Number(id));
}

function normalizeStoryboardAudio(storyboardId) {
  return normalizeByPredicate('audio', (a) => Number(a.id) === Number(storyboardId));
}

function normalizeStoryboardVideo(storyboardId) {
  return normalizeByPredicate('video', (a) => a.kind === 'storyboard_video' && Number(a.id) === Number(storyboardId));
}

function normalizeExport(id) {
  return normalizeByPredicate('video', (a) => a.kind === 'export' && Number(a.id) === Number(id));
}

function subtitleFilename(projectId, role = 'srt', ext = null) {
  const db = getDb();
  const p = db.prepare('SELECT id, name FROM projects WHERE id=?').get(projectId);
  const label = role || 'srt';
  const useExt = ext || (label === 'srt' ? '.srt' : '.ass');
  const filename = `${cleanPart(p?.name || `项目${projectId}`)}_字幕_${label}${useExt}`;
  const dir = uploadDir('subtitle');
  return uniqueName(dir, filename, '', new Set());
}

module.exports = {
  TYPE_DIR,
  cleanPart,
  listFiles,
  normalizeNames,
  normalizeImageRecord,
  normalizeStoryboardAudio,
  normalizeStoryboardVideo,
  normalizeExport,
  subtitleFilename,
  metaMap,
  normalizeUrl,
  sceneCode,
  isNormalizedName,
};
