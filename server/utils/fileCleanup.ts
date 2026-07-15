import fs from 'node:fs'
import path from 'node:path'
import * as config from '../services/config'

// 服务端根目录（server/）；uploads 根目录来自配置服务（默认 server/uploads，可被用户改到别处）
const SERVER_ROOT = path.join(__dirname, '..');
export const UPLOADS_ROOT = path.resolve(SERVER_ROOT, String(config.get('uploadDir')));

/**
 * 把数据库里存的路径（绝对 file_path 或相对 file_url，如 /uploads/images/x.png）
 * 解析成 uploads 目录内的绝对路径。返回 null 表示无效或越界（防目录穿越）。
 */
export function resolveUploadPath(stored: unknown): string | null {
  if (!stored || typeof stored !== 'string') return null;
  const s = stored.trim();
  if (!s) return null;

  const normRoot0 = path.resolve(UPLOADS_ROOT);
  let abs: string;
  if (/^[a-zA-Z]:[\\/]/.test(s)) {
    // Windows 盘符绝对路径，如 C:\...\uploads\images\x.png
    abs = path.resolve(s);
  } else {
    // 相对 URL，如 /uploads/images/x.png 或 uploads/images/x.png。
    // 关键修复：必须相对 UPLOADS_ROOT 解析，而不是 SERVER_ROOT——
    // 打包后 uploads 在 %APPDATA%/.../data/uploads（server/ 之外），
    // 若按 SERVER_ROOT 解析会指向不存在的 server/uploads，导致音频/图片
    // 一律找不到（智能时长、音画同步、导出全部失效）。
    // 先剥掉开头斜杠，再剥掉前导的 "uploads/" 段（避免拼成 .../uploads/uploads/...）。
    let rel = s.replace(/^[\\/]+/, '');
    rel = rel.replace(/^uploads[\\/]+/i, '');
    abs = path.resolve(normRoot0, rel);
  }

  // 安全：解析结果必须落在 uploads 目录内，否则拒绝（防 ../ 穿越删到别处）
  const normRoot = path.resolve(UPLOADS_ROOT);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    return null;
  }
  return abs;
}

/**
 * 安全删除单个上传文件。删不掉只记日志，不抛错（清理失败不该阻断主流程）。
 * 返回 true 表示确实删除了一个文件。
 */
export function safeUnlink(stored: unknown): boolean {
  const abs = resolveUploadPath(stored);
  if (!abs) return false;
  try {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
  } catch (error: unknown) {
    console.error('[fileCleanup] 删除文件失败:', abs, error instanceof Error ? error.message : String(error));
  }
  return false;
}

/** 批量删除，返回成功删除的数量 */
export function safeUnlinkMany(storedList: unknown[] = []): number {
  let n = 0;
  for (const s of storedList || []) {
    if (safeUnlink(s)) n++;
  }
  return n;
}

/**
 * 把任意存储路径（绝对 / 相对）归一化为可移植的相对 URL，如 /uploads/images/x.png。
 * 落库时统一用这个形式，避免项目目录迁移后绝对路径失效。
 * 解析失败（uploads 外或非法）返回原值，保证不丢数据。
 */
export function toRelative(stored: unknown): string {
  const abs = resolveUploadPath(stored);
  if (!abs) return String(stored || '');
  const normRoot = path.resolve(UPLOADS_ROOT);
  const rel = abs.slice(normRoot.length).replace(/\\/g, '/'); // Windows 反斜杠转正斜杠
  return '/uploads' + (rel.startsWith('/') ? rel : '/' + rel);
}

export const TRASH_ROOT = path.join(UPLOADS_ROOT, '.trash');

/**
 * 把上传文件移入回收站目录（uploads/.trash/<trashId>/<原相对路径>）。
 * 返回该文件在回收站内的相对标识（用于还原），移动失败返回 null。
 * 不真删，物理搬移，可还原。
 */
export function moveToTrash(stored: unknown, trashId: unknown): string | null {
  const abs = resolveUploadPath(stored);
  if (!abs || !fs.existsSync(abs)) return null;
  try {
    const normRoot = path.resolve(UPLOADS_ROOT);
    const rel = abs.slice(normRoot.length).replace(/^[\\/]+/, '');
    const dest = path.join(TRASH_ROOT, String(trashId), rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(abs, dest);
    return rel.replace(/\\/g, '/');
  } catch (error: unknown) {
    console.error('[fileCleanup] 移入回收站失败:', abs, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** 批量移入回收站，返回成功搬移的相对标识数组 */
export function moveManyToTrash(storedList: unknown[] = [], trashId: unknown): string[] {
  const moved: string[] = [];
  for (const s of storedList || []) {
    const r = moveToTrash(s, trashId);
    if (r) moved.push(r);
  }
  return moved;
}

/**
 * 从回收站还原文件回原位置（uploads/<rel>）。trashId/rel 由 moveToTrash 返回。
 * 返回 true 表示还原成功。
 */
export function restoreFromTrash(rel: unknown, trashId: unknown): boolean {
  if (!rel) return false;
  const relative = String(rel);
  try {
    const src = path.join(TRASH_ROOT, String(trashId), relative);
    if (!fs.existsSync(src)) return false;
    const dest = path.join(UPLOADS_ROOT, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return true;
  } catch (error: unknown) {
    console.error('[fileCleanup] 从回收站还原失败:', relative, error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** 彻底清空某个回收站条目的物理目录 */
export function purgeTrashDir(trashId: unknown): boolean {
  try {
    const dir = path.join(TRASH_ROOT, String(trashId));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (error: unknown) {
    console.error('[fileCleanup] 清空回收站目录失败:', trashId, error instanceof Error ? error.message : String(error));
    return false;
  }
}
