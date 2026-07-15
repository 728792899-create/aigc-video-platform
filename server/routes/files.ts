/**
 * 文件管理器 - 浏览 / 删除 / 在资源管理器中定位 uploads 素材
 *
 * GET    /api/files?type=image|audio|video|subtitle  - 列出某类文件（名/大小/时间/关联项目）
 * DELETE /api/files  { urls: [] }                     - 批量删除（物理文件 + DB 引用联动清理）
 * POST   /api/files/reveal { url }                    - Windows 资源管理器中定位文件
 *
 * 安全：所有路径经 resolveUploadPath 校验落在 uploadDir 内（防 ../ 穿越），删除走二次确认（前端）。
 */
import express from 'express'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getDb, type DbClient, type SqlRow, type SqlValue } from '../db'
import { asRecord, errorMessage, queryText, sqlText, type JsonRecord } from './routeSupport'
const router = express.Router();
const config = require('../services/config');
const { resolveUploadPath, safeUnlink } = require('../utils/fileCleanup');
const trash = require('../services/trash');
const assetNaming = require('../services/assetNaming');

// 类型 → uploads 子目录 + URL 前缀
const TYPE_DIR = {
  image: { sub: 'images', prefix: '/uploads/images/' },
  audio: { sub: 'audio', prefix: '/uploads/audio/' },
  video: { sub: 'videos', prefix: '/uploads/videos/' },
  subtitle: { sub: 'subtitles', prefix: '/uploads/subtitles/' },
};
type FileType = keyof typeof TYPE_DIR

function isFileType(value: string): value is FileType {
  return Object.hasOwn(TYPE_DIR, value);
}

module.exports = router;

// 构建 "文件URL → {项目id, 项目名}" 映射，用于给文件标注归属
function buildOwnerMap(db: DbClient, type: FileType) {
  const map: Record<string, { pid: SqlValue; name: SqlValue | null }> = {};
  const projRows = db.prepare('SELECT id, name FROM projects').all();
  const projectNames = new Map<string, SqlValue>();
  for (const project of projRows) projectNames.set(String(project.id), project.name ?? null);

  try {
    if (type === 'image') {
      // images.file_url → storyboards.project_id
      const rows = db.prepare(
        `SELECT i.file_url AS url, s.project_id AS pid
         FROM images i LEFT JOIN storyboards s ON i.storyboard_id = s.id`
      ).all();
      for (const row of rows) if (typeof row.url === 'string') map[row.url] = { pid: row.pid ?? null, name: projectNames.get(String(row.pid)) || null };
    } else if (type === 'video') {
      const rows = db.prepare('SELECT file_url AS url, project_id AS pid FROM exports').all();
      for (const row of rows) if (typeof row.url === 'string') map[row.url] = { pid: row.pid ?? null, name: projectNames.get(String(row.pid)) || null };
      const storyboardRows = db.prepare('SELECT video_path AS url, project_id AS pid FROM storyboards WHERE video_path IS NOT NULL').all();
      for (const row of storyboardRows) if (typeof row.url === 'string') map[row.url] = { pid: row.pid ?? null, name: projectNames.get(String(row.pid)) || null };
    } else if (type === 'audio') {
      const rows = db.prepare('SELECT audio_url AS url, project_id AS pid FROM storyboards WHERE audio_url IS NOT NULL').all();
      for (const row of rows) if (typeof row.url === 'string') map[row.url] = { pid: row.pid ?? null, name: projectNames.get(String(row.pid)) || null };
    }
    // subtitle 无 DB 引用，靠文件名 subtitle_project_N 兜底解析
  } catch (e) {
    console.error('[files] 构建归属映射失败:', errorMessage(e));
  }
  return { map, projectNames };
}

// 文件名兜底解析项目号：project_N / tts_N_ / subtitle_project_N
function guessProjectFromName(name: string): number | null {
  let m = name.match(/project_(\d+)/);
  if (m?.[1]) return parseInt(m[1], 10);
  m = name.match(/^tts_(\d+)_/);
  if (m?.[1]) return parseInt(m[1], 10);
  return null;
}

// 列出某类文件
router.get('/', (req, res) => {
  try {
    const type = queryText(req.query.type);
    if (!isFileType(type)) return res.status(400).json({ code: 400, message: '无效的文件类型' });
    res.json({ code: 200, data: assetNaming.listFiles(type) });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});

// 统一整理素材命名：支持 dry_run 预览，真实执行会重命名 uploads 中的活跃文件并同步 DB 引用
router.post('/normalize-names', (req, res) => {
  try {
    const allowed = new Set(['image', 'audio', 'subtitle', 'video']);
    const body = req.body || {};
    const queryTypes = typeof req.query.types === 'string' ? req.query.types.split(',') : null;
    const rawTypes = Array.isArray(body.types) ? body.types : queryTypes;
    const types = (rawTypes && rawTypes.length ? rawTypes : ['image', 'audio', 'subtitle', 'video'])
      .map((type: unknown) => String(type).trim())
      .filter(Boolean);
    const invalid = types.filter((type: string) => !allowed.has(type));
    if (invalid.length) {
      return res.status(400).json({ code: 400, data: null, message: `无效的文件类型：${invalid.join(', ')}` });
    }
    const dryRun = body.dry_run === true || body.dryRun === true || String(req.query.dry_run || req.query.dryRun) === 'true';
    const result = assetNaming.normalizeNames({ types, dryRun });
    res.json({
      code: 200,
      data: result,
      message: dryRun
        ? `预计可整理 ${result.renamed} 个素材文件`
        : `已整理 ${result.renamed} 个素材文件，${result.unchanged} 个已符合命名规则`,
    });
  } catch (e) {
    res.status(500).json({ code: 500, data: null, message: `整理素材命名失败: ${errorMessage(e)}` });
  }
});

// 批量删除：物理删文件 + 清理 DB 引用（避免界面残留指向已删文件的记录）
router.delete('/', (req, res) => {
  try {
    const { urls } = req.body || {};
    if (!Array.isArray(urls) || !urls.length) {
      return res.status(400).json({ code: 400, message: '请提供 urls 数组' });
    }
    const db = getDb();
    const permanent = String(req.query.permanent) === 'true';

    // 先过防穿越守卫，分出合法/非法路径
    const legal: string[] = [];
    const rejected: unknown[] = [];
    for (const url of urls) {
      if (typeof url !== 'string') { rejected.push(url); continue; }
      if (resolveUploadPath(url)) legal.push(url); else rejected.push(url);
    }

    if (permanent) {
      // 彻底删除（旧逻辑：物理删 + 联动清 DB，不可恢复）
      let deletedFiles = 0;
      // 先物理删除文件（文件系统操作不可事务化）
      for (const url of legal) {
        if (safeUnlink(url)) deletedFiles++;
      }
      // DB 清理批量事务化（避免中途失败导致 DB 部分清理）
      try {
        const cleanupDb = db.transaction((items: string[]) => {
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
          // 最后统一清理孤儿 selected_image_id（避免 N 次重复扫全表）
          db.prepare('UPDATE storyboards SET selected_image_id = NULL WHERE selected_image_id NOT IN (SELECT id FROM images)').run();
        });
        cleanupDb(legal);
      } catch (e) {
        console.error('[files] 清理 DB 引用失败（已回滚）:', errorMessage(e));
      }
      return res.json({
        code: 200,
        data: { deletedFiles, rejected },
        message: rejected.length
          ? `已彻底删除 ${deletedFiles} 个文件，${rejected.length} 个路径非法被拒绝`
          : `已彻底删除 ${deletedFiles} 个文件`,
      });
    }

    // 默认软删除：搬入回收站（快照 DB 引用，可还原）
    const { movedCount } = trash.trashFiles(legal);
    res.json({
      code: 200,
      data: { deletedFiles: movedCount, rejected },
      message: rejected.length
        ? `已移入回收站 ${movedCount} 个文件，${rejected.length} 个路径非法被拒绝`
        : `已移入回收站 ${movedCount} 个文件，7 天内可还原`,
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});

// 在 Windows 资源管理器中定位文件（仅本机场景）
router.post('/reveal', (req, res) => {
  try {
    const { url } = req.body || {};
    const abs = resolveUploadPath(url);
    if (!abs) return res.status(400).json({ code: 400, message: '非法路径' });
    if (!fs.existsSync(abs)) return res.status(404).json({ code: 404, message: '文件不存在' });
    if (process.platform === 'win32') {
      // 用 explorer /select 高亮文件；abs 已是 uploadDir 内的安全绝对路径。
      // 用 execFile + 参数数组（非 shell 拼接），避免路径中的特殊字符被解释成命令注入。
      // explorer 要求 /select,<path> 作为同一个参数，路径分隔符用反斜杠。
      const winPath = abs.replace(/\//g, '\\');
      execFile('explorer', [`/select,${winPath}`], () => {});
      return res.json({ code: 200, message: '已在资源管理器中打开' });
    }
    res.status(400).json({ code: 400, message: '当前系统不支持该操作' });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});

// ============ 剧本（虚拟文件：存于 DB 的 projects.script_content + storyboards）============

// 列出所有项目的剧本概览
router.get('/scripts', (req, res) => {
  try {
    const db = getDb();
    const projects = db.prepare(
      `SELECT id, name, theme, style, status, script_content, created_at, updated_at
       FROM projects ORDER BY updated_at DESC, id DESC`
    ).all();
    const list = projects.map((project) => {
      const sbs = db.prepare(
        'SELECT description, dialog FROM storyboards WHERE project_id = ?'
      ).all(project.id);
      let charCount = sqlText(project.script_content).length;
      for (const storyboard of sbs) charCount += sqlText(storyboard.description).length + sqlText(storyboard.dialog).length;
      return {
        project_id: project.id,
        name: project.name,
        theme: project.theme,
        style: project.style,
        status: project.status,
        scene_count: sbs.length,
        char_count: charCount,
        has_script: !!(project.script_content || sbs.length),
        created_at: project.created_at,
        updated_at: project.updated_at,
      };
    });
    res.json({ code: 200, data: { list } });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});

// 取单项目剧本详情（含全部分镜）
interface ScriptData extends JsonRecord {
  id: SqlValue
  name: SqlValue
  theme: SqlValue
  style: SqlValue
  status: SqlValue
  summary: string
  storyboards: SqlRow[]
}

function loadScript(db: DbClient, projectId: unknown): ScriptData | null {
  const p = db.prepare(
    'SELECT id, name, theme, style, status, script_content, created_at, updated_at FROM projects WHERE id = ?'
  ).get(projectId);
  if (!p) return null;
  const storyboards = db.prepare(
    `SELECT scene_number, description, dialog, duration, prompt
     FROM storyboards WHERE project_id = ?
     ORDER BY sort_order ASC, scene_number ASC`
  ).all(projectId);
  // script_content 可能是 AI 返回的 JSON 字符串，解析出可读 summary；解析失败则原样保留
  let summary = '';
  const raw = sqlText(p.script_content);
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = asRecord(JSON.parse(raw));
      summary = sqlText(parsed.summary || parsed.title);
    } catch { summary = ''; }
  } else {
    summary = raw;
  }
  return {
    ...p,
    id: p.id ?? null,
    name: p.name ?? '',
    theme: p.theme ?? '',
    style: p.style ?? '',
    status: p.status ?? '',
    summary,
    storyboards,
  };
}

router.get('/scripts/:projectId', (req, res) => {
  try {
    const db = getDb();
    const data = loadScript(db, req.params.projectId);
    if (!data) return res.status(404).json({ code: 404, message: '项目不存在' });
    res.json({ code: 200, data });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});

// 导出剧本：?format=txt|json，触发浏览器下载
router.get('/scripts/:projectId/export', (req, res) => {
  try {
    const db = getDb();
    const data = loadScript(db, req.params.projectId);
    if (!data) return res.status(404).json({ code: 404, message: '项目不存在' });
    const format = req.query.format === 'json' ? 'json' : 'txt';
    const safeName = String(data.name || `project_${data.id}`).replace(/[\\/:*?"<>|]/g, '_');

    if (format === 'json') {
      const payload = {
        project: { id: data.id, name: data.name, theme: data.theme, style: data.style, status: data.status },
        summary: data.summary || '',
        storyboards: data.storyboards,
      };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.json"`);
      return res.send(JSON.stringify(payload, null, 2));
    }

    const lines: string[] = [];
    lines.push(`剧本：${data.name}`);
    if (data.theme) lines.push(`主题：${data.theme}`);
    if (data.style) lines.push(`风格：${data.style}`);
    lines.push(`分镜数：${data.storyboards.length}`);
    lines.push('='.repeat(40));
    if (data.summary) { lines.push('', data.summary, ''); }
    for (const s of data.storyboards) {
      lines.push('', `【场景 ${String(s.scene_number ?? '')}】（${String(s.duration || 0)}s）`);
      if (s.description) lines.push(`画面：${sqlText(s.description)}`);
      if (s.dialog) lines.push(`对白：${sqlText(s.dialog)}`);
      if (s.prompt) lines.push(`提示词：${sqlText(s.prompt)}`);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.txt"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});
