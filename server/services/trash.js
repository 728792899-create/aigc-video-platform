const { getDb } = require('../db');
const fs = require('fs');
const path = require('path');
const { moveManyToTrash, restoreFromTrash, purgeTrashDir, TRASH_ROOT } = require('../utils/fileCleanup');
const opLog = require('./opLog');
const assetNaming = require('./assetNaming');

// 回收站服务 — 软删除项目：先把整棵项目树（项目+分镜+图片+导出行）快照进 trash 表，
// 关联文件物理搬到 uploads/.trash/<trashId>/，DB 行删除（FK CASCADE 自动清子表）。
// 还原时按原 ID 重建所有行并把文件搬回，保留全部外键关系。

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 默认保留 7 天

const CATEGORY_LABELS = {
  all: '全部',
  image: '图片',
  audio: '音频',
  video: '视频',
  subtitle: '字幕',
  script: '剧本',
  mixed: '混合',
  project: '项目',
  storyboard: '分镜',
  export: '成片视频',
  file: '文件',
};

function parseJsonSafe(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function extOf(p) {
  const m = String(p || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
  return m ? m[1] : '';
}

function normalizeStoredPath(p) {
  return String(p || '').replace(/^[\\/]+/, '').replace(/^uploads[\\/]+/i, '').replace(/\\/g, '/');
}

function sameStoredPath(a, b) {
  return normalizeStoredPath(a) === normalizeStoredPath(b);
}

function detailKeyForFile(file) {
  return `file:${normalizeStoredPath(file)}`;
}

function sceneCode(value) {
  const n = Math.max(1, Number(value) || 1);
  return `S${String(n).padStart(3, '0')}`;
}

function countUnit(category, count) {
  if (category === 'image') return `${count} 张`;
  if (category === 'audio') return `${count} 段`;
  if (category === 'subtitle') return `${count} 个`;
  if (category === 'script') return `${count} 份`;
  return `${count} 个`;
}

function projectMap(db = getDb()) {
  const map = new Map();
  try {
    for (const p of db.prepare('SELECT id, name FROM projects').all()) {
      map.set(Number(p.id), p.name || `项目#${p.id}`);
    }
  } catch {}
  return map;
}

function refStoredPaths(ref) {
  const row = ref?.row || {};
  return [
    ref?.file,
    row.file_url,
    row.file_path,
    row.audio_url,
    row.video_path,
  ].filter(Boolean);
}

function refMatchesFile(ref, file) {
  return refStoredPaths(ref).some(p => sameStoredPath(p, file));
}

function findRefForFile(file, refs = []) {
  return refs.find(ref => refMatchesFile(ref, file));
}

function projectInfoForRef(ref, projects) {
  const meta = ref?.meta || {};
  if (meta.project_id != null) {
    const projectId = Number(meta.project_id);
    return {
      project_id: projectId,
      project_name: meta.project_name || projects.get(projectId) || `项目#${projectId}（已删除）`,
      project_deleted: !!meta.project_deleted || !projects.has(projectId),
    };
  }
  const row = ref?.row || {};
  let projectId = null;
  if (row.project_id != null) projectId = Number(row.project_id);
  else if (ref?.table === 'storyboards' && row.id != null) {
    try {
      const sb = getDb().prepare('SELECT project_id FROM storyboards WHERE id = ?').get(row.id);
      if (sb?.project_id != null) projectId = Number(sb.project_id);
    } catch {}
  } else if (ref?.table === 'images' && row.storyboard_id != null) {
    try {
      const sb = getDb().prepare('SELECT project_id FROM storyboards WHERE id = ?').get(row.storyboard_id);
      if (sb?.project_id != null) projectId = Number(sb.project_id);
    } catch {}
  }
  return {
    project_id: projectId,
    project_name: projectId != null ? (projects.get(projectId) || `项目#${projectId}（已删除）`) : null,
    project_deleted: projectId != null && !projects.has(projectId),
  };
}

function sceneForRef(ref) {
  const meta = ref?.meta || {};
  if (meta.scene_number != null) return Number(meta.scene_number);
  if (meta.sort_order != null) return Number(meta.sort_order) + 1;
  const row = ref?.row || {};
  if (row.scene_number != null) return Number(row.scene_number);
  if (row.sort_order != null) return Number(row.sort_order) + 1;
  if (ref?.table === 'storyboards' && row.id != null) {
    try {
      const sb = getDb().prepare('SELECT scene_number, sort_order FROM storyboards WHERE id = ?').get(row.id);
      if (sb?.scene_number != null) return Number(sb.scene_number);
      if (sb?.sort_order != null) return Number(sb.sort_order) + 1;
    } catch {}
  }
  if (ref?.table === 'images' && row.storyboard_id != null) {
    try {
      const sb = getDb().prepare('SELECT scene_number, sort_order FROM storyboards WHERE id = ?').get(row.storyboard_id);
      if (sb?.scene_number != null) return Number(sb.scene_number);
      if (sb?.sort_order != null) return Number(sb.sort_order) + 1;
    } catch {}
  }
  return null;
}

function inferFileProjectFromName(file, projects) {
  const name = String(file || '').split('/').pop() || '';
  let m = name.match(/(?:project|tts|subtitle_project|项目#?)(\d+)/i);
  if (!m) m = String(file || '').match(/(?:project|tts|subtitle_project)_(\d+)/i);
  if (!m) {
    const sorted = [...projects.entries()].sort((a, b) => assetNaming.cleanPart(b[1]).length - assetNaming.cleanPart(a[1]).length);
    for (const [id, projectName] of sorted) {
      if (name.startsWith(`${assetNaming.cleanPart(projectName)}_`)) {
        return { project_id: id, project_name: projectName, project_deleted: false };
      }
    }
    return { project_id: null, project_name: '未归属素材', project_deleted: false };
  }
  const id = Number(m[1]);
  return {
    project_id: id,
    project_name: projects.get(id) || `项目#${id}（已删除）`,
    project_deleted: !projects.has(id),
  };
}

function buildFileDetail(row, snap, file, index, projects = projectMap()) {
  const refs = Array.isArray(snap.refs) ? snap.refs : [];
  const type = inferFileType(file, refs);
  const ref = findRefForFile(file, refs);
  const label = ref?.table === 'exports' ? CATEGORY_LABELS.export : (CATEGORY_LABELS[type] || CATEGORY_LABELS.mixed);
  const fromRef = projectInfoForRef(ref, projects);
  const fallback = fromRef.project_id != null ? fromRef : inferFileProjectFromName(file, projects);
  const sceneNumber = sceneForRef(ref);
  const projectLabel = fallback.project_name || '未归属素材';
  const groupKey = `${row.id}:${fallback.project_id != null ? `project-${fallback.project_id}` : 'orphan'}:${type}`;
  const fileName = file.split('/').pop() || `文件 ${index + 1}`;
  const sceneLabel = sceneNumber ? `${sceneCode(sceneNumber)} · ` : '';
  return {
    key: detailKeyForFile(file),
    type,
    label,
    name: `${sceneLabel}${ref?.row?.prompt || ref?.row?.file_url || ref?.row?.file_path || ref?.row?.audio_url || ref?.row?.video_path || fileName}`,
    path: file,
    restorable: true,
    project_id: fallback.project_id,
    project_name: fallback.project_name,
    project_deleted: fallback.project_deleted,
    scene_number: sceneNumber,
    group_key: groupKey,
    group_label: `${projectLabel} / ${CATEGORY_LABELS[type] || CATEGORY_LABELS.mixed}`,
  };
}

function inferFileType(file, refs = []) {
  const rel = String(file || '');
  const ref = findRefForFile(file, refs);
  if (ref?.table === 'images') return 'image';
  if (ref?.table === 'exports') return 'video';
  if (ref?.table === 'storyboards' && ref.kind === 'audio') return 'audio';
  if (ref?.table === 'storyboards' && ref.kind === 'video') return 'video';
  const lower = rel.toLowerCase();
  const ext = extOf(lower);
  if (/^images\//.test(lower) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  if (/^audio\//.test(lower) || /^bgm\//.test(lower) || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (/^videos\//.test(lower) || ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video';
  if (/^subtitles\//.test(lower) || ['srt', 'ass', 'vtt'].includes(ext)) return 'subtitle';
  if (/^scripts\//.test(lower) || ['txt', 'md', 'json'].includes(ext)) return 'script';
  return 'mixed';
}

function normalizeRestoredFiles(files = [], refs = []) {
  const allowed = new Set(['image', 'audio', 'video', 'subtitle']);
  const types = Array.from(new Set((files || []).map(file => inferFileType(file, refs)).filter(type => allowed.has(type))));
  if (!types.length) return;
  try {
    assetNaming.normalizeNames({ types, dryRun: false });
  } catch (e) {
    console.warn('[trash] 还原后素材命名整理失败:', e.message);
  }
}

function projectHasScriptContent(project, storyboards = []) {
  if (String(project?.script_content || '').trim()) return true;
  return storyboards.some((s) => String(s.description || s.dialog || s.prompt || '').trim());
}

function summarizeProjectSnapshot(snap, files) {
  const storyboards = snap.storyboards || [];
  const images = snap.images || [];
  const exportsRows = snap.exports || [];
  const audioCount = storyboards.filter(s => s.audio_url).length;
  const videoCount = storyboards.filter(s => s.video_path).length;
  const hasScript = projectHasScriptContent(snap.project, storyboards);
  const mediaCount = images.length + audioCount + videoCount + exportsRows.length + files.length;
  const stats = {
    project_count: snap.project ? 1 : 0,
    script_count: hasScript ? 1 : 0,
    storyboard_count: storyboards.length,
    image_count: images.length,
    audio_count: audioCount,
    video_count: videoCount,
    export_count: exportsRows.length,
    subtitle_count: storyboards.filter(s => s.subtitle_text).length,
    file_count: files.length,
  };
  const parts = [];
  if (stats.script_count) parts.push('1 份剧本');
  if (stats.storyboard_count) parts.push(`${stats.storyboard_count} 个分镜`);
  if (stats.image_count) parts.push(`${stats.image_count} 张图片`);
  if (stats.audio_count) parts.push(`${stats.audio_count} 段配音`);
  if (stats.video_count) parts.push(`${stats.video_count} 个动态视频`);
  if (stats.export_count) parts.push(`${stats.export_count} 个成片`);
  return { category: mediaCount ? 'mixed' : 'script', stats, summary: parts.join(' · ') || '项目快照' };
}

function summarizeFileSnapshot(snap, files) {
  const refs = Array.isArray(snap.refs) ? snap.refs : [];
  const stats = {
    project_count: 0,
    script_count: 0,
    storyboard_count: 0,
    image_count: 0,
    audio_count: 0,
    video_count: 0,
    export_count: 0,
    subtitle_count: 0,
    file_count: files.length,
  };
  const types = [];
  for (const f of files) {
    const type = inferFileType(f, refs);
    types.push(type);
    if (type === 'image') stats.image_count++;
    else if (type === 'audio') stats.audio_count++;
    else if (type === 'video') stats.video_count++;
    else if (type === 'subtitle') stats.subtitle_count++;
    else if (type === 'script') stats.script_count++;
  }
  const unique = Array.from(new Set(types));
  const category = unique.length === 1 && unique[0] !== 'mixed' ? unique[0] : 'mixed';
  const parts = [];
  if (stats.image_count) parts.push(`${stats.image_count} 张图片`);
  if (stats.audio_count) parts.push(`${stats.audio_count} 段音频`);
  if (stats.video_count) parts.push(`${stats.video_count} 个视频`);
  if (stats.subtitle_count) parts.push(`${stats.subtitle_count} 个字幕`);
  if (stats.script_count) parts.push(`${stats.script_count} 个剧本`);
  const other = stats.file_count - stats.image_count - stats.audio_count - stats.video_count - stats.subtitle_count - stats.script_count;
  if (other > 0) parts.push(`${other} 个文件`);
  return { category, stats, summary: parts.join(' · ') || `${files.length} 个文件` };
}

function buildDetails(row, snap, files, groupKey = null) {
  if (row.entity_type === 'project') {
    const storyboards = snap.storyboards || [];
    const projectScript = String(snap.project?.script_content || '').trim();
    return [
      ...(snap.project ? [{
        key: `project:${snap.project.id}`,
        type: 'project',
        label: CATEGORY_LABELS.project,
        name: snap.project.name,
        path: '',
        restorable: false,
      }] : []),
      ...(projectScript ? [{
        key: `script:${snap.project.id}`,
        type: 'script',
        label: CATEGORY_LABELS.script,
        name: `${snap.project.name || '项目'} · 主剧本`,
        path: projectScript,
        restorable: false,
      }] : []),
      ...storyboards.map(s => ({
        key: `storyboard:${s.id}`,
        type: 'script',
        label: CATEGORY_LABELS.script,
        name: `分镜 ${s.scene_number || s.sort_order + 1 || s.id} · 剧本`,
        path: [s.description, s.dialog, s.prompt].filter(Boolean).join('\n'),
        restorable: false,
      })),
      ...(snap.images || []).map(i => ({
        key: `image:${i.id}`,
        type: 'image',
        label: CATEGORY_LABELS.image,
        name: i.prompt || i.file_url || i.file_path || `图片 #${i.id}`,
        path: i.file_url || i.file_path || '',
        restorable: false,
      })),
      ...storyboards.filter(s => s.audio_url).map(s => ({
        key: `audio:${s.id}`,
        type: 'audio',
        label: CATEGORY_LABELS.audio,
        name: `分镜 ${s.scene_number || s.id} 配音`,
        path: s.audio_url,
        restorable: false,
      })),
      ...storyboards.filter(s => s.video_path).map(s => ({
        key: `video:${s.id}`,
        type: 'video',
        label: CATEGORY_LABELS.video,
        name: `分镜 ${s.scene_number || s.id} 动态视频`,
        path: s.video_path,
        restorable: false,
      })),
      ...(snap.exports || []).map(e => ({
        key: `export:${e.id}`,
        type: 'video',
        label: CATEGORY_LABELS.export,
        name: e.file_url || e.file_path || `成片 #${e.id}`,
        path: e.file_url || e.file_path || '',
        restorable: false,
      })),
    ];
  }
  const projects = projectMap();
  return files
    .map((f, index) => buildFileDetail(row, snap, f, index, projects))
    .filter(item => !groupKey || item.group_key === groupKey)
    .sort((a, b) => {
      const pa = a.project_name || '未归属素材';
      const pb = b.project_name || '未归属素材';
      if (pa !== pb) return pa.localeCompare(pb, 'zh-CN');
      if ((a.scene_number || 0) !== (b.scene_number || 0)) return (a.scene_number || 999999) - (b.scene_number || 999999);
      if ((a.type || '') !== (b.type || '')) return String(a.type || '').localeCompare(String(b.type || ''));
      return String(a.path || '').localeCompare(String(b.path || ''));
    });
}

function enrichTrashRow(row, includeDetails = false, options = {}) {
  const files = parseJsonSafe(row.files, []) || [];
  const snap = parseJsonSafe(row.snapshot, {}) || {};
  const info = row.entity_type === 'project'
    ? summarizeProjectSnapshot(snap, files)
    : summarizeFileSnapshot(snap, files);
  const enriched = {
    id: row.id,
    row_key: `trash:${row.id}`,
    trash_id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    name: row.name,
    category: info.category,
    category_label: CATEGORY_LABELS[info.category] || CATEGORY_LABELS.file,
    summary: info.summary,
    stats: info.stats,
    file_count: files.length,
    deleted_at: row.deleted_at,
    expires_at: row.deleted_at + RETENTION_MS,
  };
  if (includeDetails) {
    enriched.group_key = options.groupKey || null;
    enriched.details = buildDetails(row, snap, files, options.groupKey || null);
    if (options.groupKey && enriched.details.length) {
      const first = enriched.details[0];
      enriched.row_key = first.group_key;
      enriched.trash_id = row.id;
      enriched.group_label = first.group_label;
      enriched.project_name = first.project_name;
      enriched.project_id = first.project_id;
      enriched.category = first.type;
      enriched.category_label = CATEGORY_LABELS[first.type] || CATEGORY_LABELS.mixed;
      enriched.file_count = enriched.details.length;
      enriched.name = first.project_name || '未归属素材';
      enriched.summary = `${CATEGORY_LABELS[first.type] || CATEGORY_LABELS.mixed} / ${countUnit(first.type, enriched.details.length)}`;
    }
  }
  return enriched;
}

function expandFileTrashRows(row) {
  const files = parseJsonSafe(row.files, []) || [];
  const snap = parseJsonSafe(row.snapshot, {}) || {};
  const details = buildDetails(row, snap, files);
  if (!details.length) return [enrichTrashRow(row, false)];
  const groups = new Map();
  for (const item of details) {
    const key = item.group_key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Array.from(groups.entries()).map(([groupKey, items]) => {
    const first = items[0];
    const stats = {
      project_count: 0,
      script_count: first.type === 'script' ? items.length : 0,
      storyboard_count: 0,
      image_count: first.type === 'image' ? items.length : 0,
      audio_count: first.type === 'audio' ? items.length : 0,
      video_count: first.type === 'video' ? items.length : 0,
      export_count: 0,
      subtitle_count: first.type === 'subtitle' ? items.length : 0,
      file_count: items.length,
    };
    const projectName = first.project_name || '未归属素材';
    const category = first.type || 'mixed';
    return {
      id: row.id,
      row_key: groupKey,
      trash_id: row.id,
      group_key: groupKey,
      group_label: `${projectName} / ${CATEGORY_LABELS[category] || CATEGORY_LABELS.mixed} / ${countUnit(category, items.length)}`,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      name: projectName,
      project_id: first.project_id,
      project_name: first.project_name,
      project_deleted: first.project_deleted,
      category,
      category_label: CATEGORY_LABELS[category] || CATEGORY_LABELS.mixed,
      summary: `${CATEGORY_LABELS[category] || CATEGORY_LABELS.mixed} / ${countUnit(category, items.length)}`,
      stats,
      file_count: items.length,
      deleted_at: row.deleted_at,
      expires_at: row.deleted_at + RETENTION_MS,
      is_group: true,
    };
  }).sort((a, b) => {
    const pa = a.project_name || a.name || '未归属素材';
    const pb = b.project_name || b.name || '未归属素材';
    if (pa !== pb) return pa.localeCompare(pb, 'zh-CN');
    return String(a.category || '').localeCompare(String(b.category || ''));
  });
}

/** 动态把一行对象拼成 INSERT，列名来自对象 key，保留原 id */
function insertRow(table, row) {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  getDb().prepare(sql).run(...cols.map(c => row[c]));
}

function restoreFileRefs(db, refs = [], restoredFiles = []) {
  const selected = restoredFiles && restoredFiles.length ? restoredFiles : null;
  const shouldRestore = (ref) => !selected || selected.some(file => refMatchesFile(ref, file));
  const restoredImageIds = new Set();

  for (const ref of refs || []) {
    if (!ref?.table || !ref.row || !shouldRestore(ref)) continue;
    try {
      if (ref.table === 'images') {
        insertRow('images', ref.row);
        if (ref.row.id != null) restoredImageIds.add(ref.row.id);
      } else if (ref.table === 'exports') {
        insertRow('exports', ref.row);
      } else if (ref.table === 'storyboards' && ref.kind === 'audio') {
        db.prepare(
          `UPDATE storyboards
           SET audio_url = ?,
               voice = COALESCE(?, voice),
               audio_words = COALESCE(?, audio_words),
               emotion = COALESCE(?, emotion)
           WHERE id = ?`
        ).run(ref.row.audio_url || ref.file || null, ref.row.voice || null, ref.row.audio_words || null, ref.row.emotion || null, ref.row.id);
      } else if (ref.table === 'storyboards' && ref.kind === 'video') {
        db.prepare('UPDATE storyboards SET video_path = ? WHERE id = ?').run(ref.row.video_path || ref.file || null, ref.row.id);
      }
    } catch {}
  }

  for (const ref of refs || []) {
    if (ref?.table !== 'storyboards' || ref.kind !== 'selected_image' || !ref.row) continue;
    if (selected && !selected.some(file => refMatchesFile(ref, file))) continue;
    if (ref.row.selected_image_id != null && (restoredImageIds.size === 0 || restoredImageIds.has(ref.row.selected_image_id))) {
      try {
        db.prepare('UPDATE storyboards SET selected_image_id = ? WHERE id = ?')
          .run(ref.row.selected_image_id, ref.row.id);
      } catch {}
    }
  }
}

function collectFileRefs(db, list) {
  const refs = [];
  const seen = new Set();
  const imageRefs = [];

  function storyboardMeta(storyboardId) {
    if (storyboardId == null) return {};
    try {
      const row = db.prepare(
        `SELECT s.project_id, s.scene_number, s.sort_order, p.name AS project_name
           FROM storyboards s
           LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.id = ?`
      ).get(storyboardId);
      if (!row) return {};
      return {
        project_id: row.project_id,
        project_name: row.project_name,
        project_deleted: row.project_id != null && !row.project_name,
        scene_number: row.scene_number,
        sort_order: row.sort_order,
      };
    } catch {
      return {};
    }
  }

  function projectMeta(projectId) {
    if (projectId == null) return {};
    try {
      const row = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId);
      return {
        project_id: projectId,
        project_name: row?.name || null,
        project_deleted: !row,
      };
    } catch {
      return { project_id: projectId };
    }
  }

  function push(ref) {
    const key = `${ref.table}:${ref.kind || ''}:${ref.row?.id || ''}:${normalizeStoredPath(ref.file || '')}`;
    if (seen.has(key)) return;
    if (!ref.meta) {
      if (ref.table === 'images') ref.meta = storyboardMeta(ref.row?.storyboard_id);
      else if (ref.table === 'storyboards') ref.meta = { ...projectMeta(ref.row?.project_id), scene_number: ref.row?.scene_number, sort_order: ref.row?.sort_order };
      else if (ref.table === 'exports') ref.meta = projectMeta(ref.row?.project_id);
    }
    seen.add(key);
    refs.push(ref);
    if (ref.table === 'images') imageRefs.push(ref);
  }

  for (const url of list) {
    const imageRows = db.prepare('SELECT * FROM images WHERE file_url = ? OR file_path = ?').all(url, url);
    for (const row of imageRows) push({ table: 'images', kind: 'image', file: row.file_url || row.file_path || url, row });

    const exportRows = db.prepare('SELECT * FROM exports WHERE file_url = ? OR file_path = ?').all(url, url);
    for (const row of exportRows) push({ table: 'exports', kind: 'export', file: row.file_url || row.file_path || url, row });

    const audioRows = db.prepare('SELECT * FROM storyboards WHERE audio_url = ?').all(url);
    for (const row of audioRows) push({ table: 'storyboards', kind: 'audio', file: row.audio_url || url, row });

    const videoRows = db.prepare('SELECT * FROM storyboards WHERE video_path = ?').all(url);
    for (const row of videoRows) push({ table: 'storyboards', kind: 'video', file: row.video_path || url, row });
  }

  for (const ref of imageRefs) {
    const imageId = ref.row?.id;
    if (imageId == null) continue;
    const rows = db.prepare('SELECT * FROM storyboards WHERE selected_image_id = ?').all(imageId);
    for (const row of rows) {
      push({
        table: 'storyboards',
        kind: 'selected_image',
        file: ref.file,
        row: { id: row.id, selected_image_id: row.selected_image_id },
      });
    }
  }

  return refs;
}

function remainingRefsAfterPartialRestore(refs = [], restoredFiles = []) {
  const restoredImageIds = new Set();
  for (const ref of refs || []) {
    if (ref?.table === 'images' && ref.row?.id != null && restoredFiles.some(file => refMatchesFile(ref, file))) {
      restoredImageIds.add(ref.row.id);
    }
  }
  return (refs || []).filter((ref) => {
    if (restoredFiles.some(file => refMatchesFile(ref, file))) return false;
    if (ref?.table === 'storyboards' && ref.kind === 'selected_image' && restoredImageIds.has(ref.row?.selected_image_id)) {
      return false;
    }
    return true;
  });
}

/** 软删除一个项目，返回 trashId */
function trashProject(projectId) {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;

  const storyboards = db.prepare('SELECT * FROM storyboards WHERE project_id = ?').all(projectId);
  const sbIds = storyboards.map(s => s.id);
  const images = sbIds.length
    ? db.prepare(`SELECT * FROM images WHERE storyboard_id IN (${sbIds.map(() => '?').join(',')})`).all(...sbIds)
    : [];
  const exportsRows = db.prepare('SELECT * FROM exports WHERE project_id = ?').all(projectId);

  // 收集所有关联文件（相对 URL）
  const fileUrls = [
    ...images.map(i => i.file_url || i.file_path),
    ...storyboards.map(s => s.audio_url),
    ...storyboards.map(s => s.video_path), // v1.6.8 图生视频文件也搬入回收站，保证可还原
    ...exportsRows.map(e => e.file_url || e.file_path),
  ].filter(Boolean);

  // 先占一个 trash 行拿到 trashId（文件要按 id 建目录）
  const ins = db.prepare(
    `INSERT INTO trash (entity_type, entity_id, name, snapshot, files, deleted_at)
     VALUES ('project', ?, ?, ?, ?, ?)`
  ).run(String(projectId), project.name, '', '', Date.now());
  const trashId = ins.lastInsertRowid;

  // 物理搬移文件到回收站
  const movedFiles = moveManyToTrash(fileUrls, trashId);

  // 回填快照
  const snapshot = JSON.stringify({ project, storyboards, images, exports: exportsRows });
  db.prepare('UPDATE trash SET snapshot = ?, files = ? WHERE id = ?')
    .run(snapshot, JSON.stringify(movedFiles), trashId);

  // 删 DB 行（FK CASCADE 清子表）
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

  opLog.log('project.delete', 'project', projectId, { name: project.name, trashId });
  return trashId;
}

/** 列出回收站条目（不含庞大 snapshot，只回元信息） */
function listTrash(category = 'all') {
  const rows = getDb().prepare('SELECT * FROM trash ORDER BY deleted_at DESC').all();
  return rows
    .flatMap(r => r.entity_type === 'files' ? expandFileTrashRows(r) : [enrichTrashRow(r, false)])
    .filter(r => !category || category === 'all' || r.category === category);
}

/** 读取单条回收站详情（包含分类后的内部内容列表） */
function getTrashDetail(trashId, groupKey = null) {
  const row = getDb().prepare('SELECT * FROM trash WHERE id = ?').get(trashId);
  if (!row) return null;
  return enrichTrashRow(row, true, { groupKey });
}

/** 还原一个回收站条目（按原 ID 重建所有行 + 文件搬回）。返回 true/false */
function restoreTrash(trashId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trash WHERE id = ?').get(trashId);
  if (!row) return false;
  let snap, files;
  try { snap = JSON.parse(row.snapshot); } catch { return false; }
  try { files = JSON.parse(row.files) || []; } catch { files = []; }

  if (row.entity_type === 'project' && snap.project) {
    // 项目名冲突不阻断；id 已删可安全复用
    insertRow('projects', snap.project);
    for (const sb of snap.storyboards || []) insertRow('storyboards', sb);
    for (const img of snap.images || []) insertRow('images', img);
    for (const ex of snap.exports || []) insertRow('exports', ex);
  } else if (row.entity_type === 'files' && Array.isArray(snap.refs)) {
    const restoredFiles = [];
    for (const rel of files) {
      if (restoreFromTrash(rel, trashId)) restoredFiles.push(rel);
    }
    // 文件型回收站：重建被联动清掉的 DB 引用行，并恢复音频/视频/已选图片指针
    restoreFileRefs(db, snap.refs, restoredFiles);
    normalizeRestoredFiles(restoredFiles, snap.refs || []);
    db.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
    opLog.log('project.restore', row.entity_type, row.entity_id, { name: row.name, trashId });
    return true;
  }

  // 文件搬回原位
  for (const rel of files) restoreFromTrash(rel, trashId);
  normalizeRestoredFiles(files, snap.refs || []);

  db.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
  opLog.log('project.restore', row.entity_type, row.entity_id, { name: row.name, trashId });
  return true;
}

/** 还原文件型回收站条目中的部分内容。项目型条目仍以整项目还原为最小闭环。 */
function restoreTrashItems(trashId, keys) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trash WHERE id = ?').get(trashId);
  if (!row) return { ok: false, status: 404, message: '回收站条目不存在' };
  if (row.entity_type !== 'files') return { ok: false, status: 400, message: '项目回收条目需要整项还原' };

  const snap = parseJsonSafe(row.snapshot, {}) || {};
  const files = parseJsonSafe(row.files, []) || [];
  const keySet = new Set(Array.isArray(keys) ? keys.filter(Boolean) : []);
  const selectedFiles = files.filter(file => keySet.has(detailKeyForFile(file)));
  if (!selectedFiles.length) return { ok: false, status: 400, message: '请选择要还原的内容' };

  const restoredFiles = [];
  for (const rel of selectedFiles) {
    if (restoreFromTrash(rel, trashId)) restoredFiles.push(rel);
  }
  if (!restoredFiles.length) return { ok: false, status: 409, message: '选中的文件未能从回收站目录还原' };

  const refs = Array.isArray(snap.refs) ? snap.refs : [];
  restoreFileRefs(db, refs, restoredFiles);
  normalizeRestoredFiles(restoredFiles, refs);

  const remainingFiles = files.filter(file => !restoredFiles.some(restored => sameStoredPath(restored, file)));
  if (!remainingFiles.length) {
    purgeTrashDir(trashId);
    db.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
  } else {
    const remainingRefs = remainingRefsAfterPartialRestore(refs, restoredFiles);
    db.prepare('UPDATE trash SET snapshot = ?, files = ? WHERE id = ?')
      .run(JSON.stringify({ ...snap, refs: remainingRefs }), JSON.stringify(remainingFiles), trashId);
  }

  opLog.log('file.restore.partial', row.entity_type, row.entity_id, {
    name: row.name,
    trashId,
    restored: restoredFiles.length,
    remaining: remainingFiles.length,
  });
  return {
    ok: true,
    restoredCount: restoredFiles.length,
    remainingCount: remainingFiles.length,
    trashRemoved: remainingFiles.length === 0,
  };
}

function purgeTrashItems(trashId, keys) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trash WHERE id = ?').get(trashId);
  if (!row) return { ok: false, status: 404, message: '回收站条目不存在' };
  if (row.entity_type !== 'files') return { ok: false, status: 400, message: '项目回收条目需要整项彻底删除' };

  const snap = parseJsonSafe(row.snapshot, {}) || {};
  const files = parseJsonSafe(row.files, []) || [];
  const keySet = new Set(Array.isArray(keys) ? keys.filter(Boolean) : []);
  const selectedFiles = files.filter(file => keySet.has(detailKeyForFile(file)));
  if (!selectedFiles.length) return { ok: false, status: 400, message: '请选择要彻底删除的内容' };

  for (const rel of selectedFiles) {
    try {
      const abs = path.join(TRASH_ROOT, String(trashId), rel);
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
      }
    } catch (e) {
      console.error('[trash] 局部彻底删除文件失败:', rel, e.message);
    }
  }
  const purgedCount = selectedFiles.length;

  const refs = Array.isArray(snap.refs) ? snap.refs : [];
  const remainingFiles = files.filter(file => !selectedFiles.some(selected => sameStoredPath(selected, file)));
  if (!remainingFiles.length) {
    purgeTrashDir(trashId);
    db.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
  } else {
    const remainingRefs = remainingRefsAfterPartialRestore(refs, selectedFiles);
    db.prepare('UPDATE trash SET snapshot = ?, files = ? WHERE id = ?')
      .run(JSON.stringify({ ...snap, refs: remainingRefs }), JSON.stringify(remainingFiles), trashId);
  }

  opLog.log('file.purge.partial', row.entity_type, row.entity_id, {
    name: row.name,
    trashId,
    purged: purgedCount,
    remaining: remainingFiles.length,
  });
  return {
    ok: true,
    purgedCount,
    remainingCount: remainingFiles.length,
    trashRemoved: remainingFiles.length === 0,
  };
}

/** 彻底删除一个回收站条目（物理清文件 + 删 trash 行） */
function purgeTrash(trashId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trash WHERE id = ?').get(trashId);
  if (!row) return false;
  purgeTrashDir(trashId);
  db.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
  opLog.log('project.purge', row.entity_type, row.entity_id, { name: row.name, trashId });
  return true;
}

/** 清空整个回收站 */
function emptyTrash() {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM trash').all();
  for (const r of rows) purgeTrashDir(r.id);
  db.prepare('DELETE FROM trash').run();
  opLog.log('trash.empty', null, null, { count: rows.length });
  return rows.length;
}

/** 自动清理超过保留期的条目，返回清理数量 */
function autoClean() {
  const db = getDb();
  const cutoff = Date.now() - RETENTION_MS;
  const expired = db.prepare('SELECT id FROM trash WHERE deleted_at < ?').all(cutoff);
  for (const r of expired) { purgeTrashDir(r.id); }
  if (expired.length) {
    db.prepare('DELETE FROM trash WHERE deleted_at < ?').run(cutoff);
  }
  return expired.length;
}

/**
 * 软删除一批文件（文件管理器用）。把文件搬入回收站，并快照将被联动清掉的 DB 引用行，
 * 以便还原时重建。urls 为相对 URL 数组。illegal 是已被防穿越守卫拒绝的路径（不处理）。
 * 返回 { trashId, movedCount }。
 */
function trashFiles(urls) {
  const db = getDb();
  const seen = new Set();
  const list = (urls || []).filter(Boolean).filter((url) => {
    const key = normalizeStoredPath(url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!list.length) return { trashId: null, movedCount: 0 };

  // 占位拿 trashId
  const ins = db.prepare(
    `INSERT INTO trash (entity_type, entity_id, name, snapshot, files, deleted_at)
     VALUES ('files', NULL, ?, '', '', ?)`
  ).run(`${list.length} 个文件`, Date.now());
  const trashId = ins.lastInsertRowid;

  // 快照将被联动清理的 DB 引用行（还原时重建）。除图片/成片行外，
  // 还要保留分镜上的 audio_url / video_path / selected_image_id，否则恢复后业务仍断链。
  const refs = collectFileRefs(db, list);

  // 物理搬移
  const moved = moveManyToTrash(list, trashId);

  // 清 DB 引用（与 files.js 原逻辑一致，但行已快照可还原）。事务化避免中途失败导致部分清理
  const cleanupRefs = db.transaction((urls) => {
    const delImg = db.prepare('DELETE FROM images WHERE file_url = ? OR file_path = ?');
    const delExp = db.prepare('DELETE FROM exports WHERE file_url = ? OR file_path = ?');
    const nullAudio = db.prepare('UPDATE storyboards SET audio_url = NULL WHERE audio_url = ?');
    const nullVideo = db.prepare('UPDATE storyboards SET video_path = NULL WHERE video_path = ?');
    for (const url of urls) {
      delImg.run(url, url);
      delExp.run(url, url);
      nullAudio.run(url);
      nullVideo.run(url);
    }
    db.prepare(`UPDATE storyboards SET selected_image_id = NULL
                WHERE selected_image_id IS NOT NULL
                  AND selected_image_id NOT IN (SELECT id FROM images)`).run();
  });
  cleanupRefs(list);

  db.prepare('UPDATE trash SET snapshot = ?, files = ? WHERE id = ?')
    .run(JSON.stringify({ refs }), JSON.stringify(moved), trashId);

  opLog.log('file.delete', 'files', null, { count: list.length, trashId });
  return { trashId, movedCount: moved.length };
}

module.exports = { trashProject, trashFiles, RETENTION_MS, insertRow, restoreFromTrash, purgeTrashDir,
  listTrash, getTrashDetail, restoreTrash, restoreTrashItems, purgeTrashItems, purgeTrash, emptyTrash, autoClean };
