/**
 * 数据库层 - 通过统一同步 API 运行 better-sqlite3 或 sql.js。
 * 发布包默认 better-sqlite3，sql.js 保留为显式兼容驱动。
 *
 * 改进：
 *  1. 节流写盘 — 高频写入合并为一次磁盘 IO，主线程不再被反复阻塞
 *  2. 临时文件 + rename — 防止写到一半 crash 损坏数据库
 *  3. 嵌套事务计数器 — 替代单一布尔标志，支持事务回调内再开事务
 *  4. 进程退出钩子 — 进程意外退出时兜底 flush 一次
 */

import initSqlJs = require('sql.js')
import fs from 'node:fs'
import path from 'node:path'
import {
  createBetterSqliteRuntime,
  createSqlJsRuntime,
  type RuntimeDatabase,
  type RuntimeSqlRow,
  type RuntimeSqlValue,
} from './runtimeDriver'

export type SqlValue = RuntimeSqlValue
export type SqlRow = RuntimeSqlRow

export interface DbRunResult {
  lastInsertRowid: SqlValue
  changes: SqlValue
}

export interface DbStatement {
  all(...params: unknown[]): SqlRow[]
  get(...params: unknown[]): SqlRow | undefined
  run(...params: unknown[]): DbRunResult
}

export interface DbClient {
  prepare(sql: string): DbStatement
  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult
}

// DB 路径：优先用环境变量 DB_PATH（Electron 打包时指向用户数据目录的可写位置），
// 否则用开发默认 server/db/database.sqlite。库不存在时 initDb 会自动新建。
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, 'database.sqlite');
const SCHEMA_VERSION = 9;

let db: RuntimeDatabase
let SQL: initSqlJs.SqlJsStatic | null = null

// ============ 写盘节流 + 互斥 ============
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function toSqlValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Uint8Array) return value
  throw new TypeError(`Unsupported SQLite parameter type: ${typeof value}`)
}

function bindValues(params: unknown[]): SqlValue[] {
  return params.map(toSqlValue)
}

function userVersion(database: RuntimeDatabase): number {
  try { return Number(database.exec('PRAGMA user_version')[0]?.values?.[0]?.[0]) || 0; } catch { return 0; }
}

function createMigrationBackup(fromVersion: number): string {
  if (!fs.existsSync(DB_PATH)) return '';
  const backupDir = path.join(path.dirname(DB_PATH), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `database-v${fromVersion}-${Date.now()}.sqlite`);
  fs.copyFileSync(DB_PATH, target, fs.constants.COPYFILE_EXCL);
  const backups = fs.readdirSync(backupDir)
    .filter((name) => /^database-v\d+-\d+\.sqlite$/.test(name))
    .map((name) => ({ name, mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of backups.slice(5)) {
    try { fs.unlinkSync(path.join(backupDir, old.name)); } catch {}
  }
  return target;
}

/**
 * 真正执行写盘（同步，带互斥标志防重入）
 */
function flushDb(): void {
  if (!db || saving) return;
  saving = true;
  try {
    if (db.driver === 'better-sqlite3') {
      db.checkpoint();
      return;
    }
    const data = db.export();
    const buffer = Buffer.from(data);
    // 先写临时文件再 rename，原子性切换，防止写到一半崩溃损坏原文件
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, DB_PATH);
    // ⚠️ sql.js 的 db.export() 会把当前连接的 PRAGMA foreign_keys 重置为 OFF，
    // 导致此后所有 DELETE 不再触发 ON DELETE CASCADE，留下孤儿子行。
    // 每次导出后必须重新开启，否则级联删除会静默失效。
    db.run('PRAGMA foreign_keys = ON');
  } catch (err: unknown) {
    console.error('[DB] flushDb error:', errorMessage(err));
  } finally {
    saving = false;
  }
}

/**
 * 标记需要写盘，500ms 后统一执行（节流）
 * 高频写入时只触发一次磁盘 IO，避免主线程反复同步阻塞
 */
function scheduleSave(): void {
  if (db?.driver === 'better-sqlite3') return;
  if (saveTimer) return; // 已有定时器在等
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushDb();
  }, 500);
}

/**
 * 立即同步写盘（事务结束/进程退出/外部强制时使用）
 */
export function saveDb(): void {
  // 取消待执行的节流任务，立刻 flush
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushDb();
}

// 进程退出兜底：确保未 flush 的数据落盘
function setupExitHook(): void {
  const handler = (signal: NodeJS.Signals | 'exit'): void => {
    if (saveTimer) {
      console.log(`[DB] ${signal} received, flushing pending writes...`);
      saveDb();
    }
  };
  // exit 是同步阶段，能保证 flush 完成（最终兜底）
  process.on('exit', () => handler('exit'));
  // 信号处理：仅 flush，不在此处 process.exit。
  // 退出由 app.js 的 shutdown() 统一负责（先 server.close 优雅关闭再退出），
  // 避免两处都注册信号导致 DB 抢先 exit、架空 HTTP 优雅关闭。
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

// 初始化数据库
export async function initDb(): Promise<RuntimeDatabase> {
  SQL = await initSqlJs();
  // 确保 DB 所在目录存在（Electron 打包后 DB_PATH 指向用户数据目录，首次启动可能不存在）
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const configuredDriver = String(process.env.DB_DRIVER || 'better-sqlite3').trim().toLowerCase();
  if (!['better-sqlite3', 'sqljs', 'auto'].includes(configuredDriver)) {
    throw new Error(`Unsupported DB_DRIVER: ${configuredDriver}`);
  }
  const wantsBetterSqlite = configuredDriver !== 'sqljs';
  if (wantsBetterSqlite) {
    try {
      db = createBetterSqliteRuntime(DB_PATH);
    } catch (error: unknown) {
      if (configuredDriver === 'better-sqlite3' && process.env.DB_DRIVER) throw error;
      console.warn('[DB] better-sqlite3 当前运行时不可用，已安全降级到 sql.js');
      const fileBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : undefined;
      db = createSqlJsRuntime(new SQL.Database(fileBuffer));
    }
  } else {
    const fileBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : undefined;
    db = createSqlJsRuntime(new SQL.Database(fileBuffer));
  }

  // 用计数器替代布尔标志，支持事务嵌套场景下的 saveDb 决策
  db._txDepth = 0;

  // 启用外键
  db.run('PRAGMA foreign_keys = ON');
  const previousSchemaVersion = userVersion(db);
  if (previousSchemaVersion < SCHEMA_VERSION && fs.existsSync(DB_PATH)) {
    const backupPath = createMigrationBackup(previousSchemaVersion);
    console.log(`[DB] 迁移前备份已创建: ${backupPath}`);
  } else if (previousSchemaVersion > SCHEMA_VERSION) {
    const error = Object.assign(
      new Error(`数据库 schema v${previousSchemaVersion} 高于当前程序 v${SCHEMA_VERSION}，已拒绝用旧程序打开`),
      { code: 'DB_SCHEMA_TOO_NEW' },
    );
    try { db.close(); } catch {}
    throw error;
  }
  db.configurePersistentMode();
  console.log(`[DB] driver=${db.driver}`);

  // 创建表
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      theme TEXT,
      style TEXT DEFAULT '写实',
      duration_min INTEGER DEFAULT 60,
      duration_max INTEGER DEFAULT 180,
      status TEXT DEFAULT 'draft',
      script_content TEXT,
      cover TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      scene_number INTEGER NOT NULL,
      description TEXT,
      dialog TEXT,
      duration REAL DEFAULT 5.0,
      sort_order INTEGER DEFAULT 0,
      prompt TEXT,
      audio_url TEXT,
      selected_image_id INTEGER,
      subtitle_text TEXT,
      subtitle_style TEXT DEFAULT '{"fontSize":24,"fontColor":"#FFFFFF","bgColor":"#00000080","position":"bottom","fontFamily":"Microsoft YaHei"}',
      transition TEXT DEFAULT 'none',
      voice TEXT,
      audio_words TEXT,
      emotion TEXT,
      no_voice INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // 数据库迁移 — 给已存在的表添加新列（sql.js 不支持 IF NOT EXISTS 列）
  const migrateCols = [
    ['storyboards', 'subtitle_text', 'TEXT'],
    ['storyboards', 'subtitle_style', "TEXT"],
    ['storyboards', 'transition', "TEXT DEFAULT 'none'"],
    ['storyboards', 'voice', 'TEXT'],
    ['storyboards', 'motion', 'TEXT'],
    ['storyboards', 'audio_words', 'TEXT'],
    ['storyboards', 'emotion', 'TEXT'],
    ['storyboards', 'no_voice', 'INTEGER DEFAULT 0'],
    // v1.6.8 图生视频持久化：video_path 存该分镜 AI 生成的视频文件（相对 uploadDir 的路径），
    // 让预览页能播放真实动效视频而非静态缩略图；为空表示静图轨（无 i2v 结果）。
    ['storyboards', 'video_path', 'TEXT'],
    ['projects', 'cover', 'TEXT'],
    ['projects', 'ratio', "TEXT DEFAULT '16:9'"],
    // v1.6.5 画风一致性：visual_anchor 存全局视觉设定（主角外貌/画风/色调/镜头），
    // image_seed 存项目级基准随机种子，同项目所有分镜复用以稳定画风。
    ['projects', 'visual_anchor', 'TEXT'],
    ['projects', 'image_seed', 'INTEGER'],
    // 人物一致性与系列续写（v1.7）：每个项目归属一个系列，系列内共享 Story Bible 与角色库。
    ['projects', 'series_id', 'INTEGER'],
    ['projects', 'episode_index', 'INTEGER DEFAULT 1'],
    ['projects', 'parent_project_id', 'INTEGER'],
    ['projects', 'continuation_mode', 'TEXT'],
    ['projects', 'ending_summary', 'TEXT'],
    ['projects', 'continuity_status', "TEXT DEFAULT 'uninitialized'"],
    ['storyboards', 'characters_in_scene', 'TEXT'],
    ['storyboards', 'continuity_notes', 'TEXT'],
    ['storyboards', 'scene_state_before', 'TEXT'],
    ['storyboards', 'scene_state_after', 'TEXT'],
    // 创作工作台 2.0：轻量状态检查与增量修复。
    ['storyboards', 'sync_status', "TEXT DEFAULT 'synced'"],
    ['storyboards', 'quality_status', "TEXT DEFAULT 'unchecked'"],
    // v5：上游脚本改稿只把已生成素材标记 stale，不再静默删除用户候选。
    ['storyboards', 'assets_stale', 'INTEGER DEFAULT 0'],
    ['storyboards', 'stale_reason', 'TEXT'],
    // 长视频流水线：分镜可归属章节，导出时按章节分段合成再无损拼接。
    ['storyboards', 'chapter_id', 'INTEGER'],
    ['storyboards', 'chapter_index', 'INTEGER DEFAULT 1'],
    ['storyboards', 'chapter_title', 'TEXT'],
    ['projects', 'long_video_mode', 'INTEGER DEFAULT 0'],
    ['projects', 'target_duration_sec', 'INTEGER'],
    ['exports', 'chapter_count', 'INTEGER DEFAULT 1'],
    ['exports', 'long_video_mode', 'INTEGER DEFAULT 0'],
    ['exports', 'external_file_path', 'TEXT'],
    ['exports', 'external_directory', 'TEXT'],
    ['exports', 'external_copy_status', 'TEXT'],
    ['exports', 'has_subtitle', 'INTEGER DEFAULT 0'],
    ['exports', 'burn_subtitle', 'INTEGER DEFAULT 0'],
    ['exports', 'srt_url', 'TEXT'],
    ['exports', 'vtt_url', 'TEXT'],
    ['exports', 'subtitle_status', 'TEXT'],
    ['exports', 'subtitle_error', 'TEXT'],
    ['exports', 'video_speed', 'REAL DEFAULT 1'],
    // 创作技能库增强（v1.6.15）：
    //   auto_apply=1 表示「必用技能」——AI 生成（文案/图片/配音/一键成片）时自动注入，
    //     无需用户每次手动勾选，用于平台想强制保障的创作质量基线（如黄金3秒钩子、画风电影感）。
    //   source 标记技能来源：'builtin'(平台内置) / 'skillhub'(技能市场导入) / 'custom'(用户自建)，
    //     便于在技能库页按来源区分展示与统计。
    ['skills', 'auto_apply', 'INTEGER DEFAULT 0'],
    ['skills', 'source', "TEXT DEFAULT 'custom'"],
    ['skills', 'deleted_at', 'INTEGER DEFAULT 0'],
    ['continuity_checks', 'repair_action', 'TEXT'],
    ['continuity_checks', 'resolved_at', 'INTEGER'],
    ['continuity_checks', 'selected_as_reference', 'INTEGER DEFAULT 0'],
  ];
  for (const [table, col, typedef] of migrateCols) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`); } catch {}
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      prompt TEXT,
      file_path TEXT,
      file_url TEXT,
      submit_id TEXT,
      gen_status TEXT DEFAULT 'pending',
      width INTEGER DEFAULT 1024,
      height INTEGER DEFAULT 1024,
      stale INTEGER DEFAULT 0,
      stale_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (storyboard_id) REFERENCES storyboards(id) ON DELETE CASCADE
    )
  `);

  for (const [table, col, typedef] of [
    ['images', 'stale', 'INTEGER DEFAULT 0'],
    ['images', 'stale_reason', 'TEXT'],
    // v6：生成结果作为可评审 Candidate 保留生成来源与稳定引用。
    ['images', 'task_id', 'TEXT'],
    ['images', 'provider', 'TEXT'],
    ['images', 'model', 'TEXT'],
    ['images', 'input_snapshot', 'TEXT'],
    ['images', 'media_reference', 'TEXT'],
    ['images', 'parent_image_id', 'INTEGER'],
    ['images', 'favorite', 'INTEGER DEFAULT 0'],
    ['images', 'archived_at', 'INTEGER'],
    ['images', 'selected_at', 'INTEGER'],
    ['images', 'updated_at', 'INTEGER'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`); } catch {}
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      file_path TEXT,
      file_url TEXT,
      status TEXT DEFAULT 'pending',
      duration REAL,
      chapter_count INTEGER DEFAULT 1,
      long_video_mode INTEGER DEFAULT 0,
      external_file_path TEXT,
      external_directory TEXT,
      external_copy_status TEXT,
      has_subtitle INTEGER DEFAULT 0,
      burn_subtitle INTEGER DEFAULT 0,
      srt_url TEXT,
      vtt_url TEXT,
      subtitle_status TEXT,
      subtitle_error TEXT,
      video_speed REAL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // 长视频章节表 — 章节是长视频的生产/合成边界，避免 60 分钟视频一次性走复杂滤镜。
  db.run(`
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      chapter_index INTEGER DEFAULT 1,
      title TEXT,
      summary TEXT,
      target_duration_sec INTEGER,
      status TEXT DEFAULT 'draft',
      video_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  for (const [table, col, typedef] of [
    ['exports', 'chapter_count', 'INTEGER DEFAULT 1'],
    ['exports', 'long_video_mode', 'INTEGER DEFAULT 0'],
    ['exports', 'external_file_path', 'TEXT'],
    ['exports', 'external_directory', 'TEXT'],
    ['exports', 'external_copy_status', 'TEXT'],
    ['exports', 'has_subtitle', 'INTEGER DEFAULT 0'],
    ['exports', 'burn_subtitle', 'INTEGER DEFAULT 0'],
    ['exports', 'srt_url', 'TEXT'],
    ['exports', 'vtt_url', 'TEXT'],
    ['exports', 'subtitle_status', 'TEXT'],
    ['exports', 'subtitle_error', 'TEXT'],
    ['exports', 'video_speed', 'REAL DEFAULT 1'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`); } catch {}
  }

  // 任务持久化表 — 进程重启后可恢复任务状态，避免前端轮询 404 死等
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      message TEXT,
      meta TEXT,
      result TEXT,
      error TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // v7：把 Provider 对账、attempt lineage 与取消语义提升为任务一等字段。
  // meta 中的旧字段继续保留，路由和旧客户端因此保持兼容。
  for (const [table, col, typedef] of [
    ['tasks', 'provider', 'TEXT'],
    ['tasks', 'model', 'TEXT'],
    ['tasks', 'provider_task_id', 'TEXT'],
    ['tasks', 'attempt', 'INTEGER DEFAULT 1'],
    ['tasks', 'parent_task_id', 'TEXT'],
    ['tasks', 'idempotency_key', 'TEXT'],
    ['tasks', 'started_at', 'INTEGER'],
    ['tasks', 'finished_at', 'INTEGER'],
    ['tasks', 'timeout_at', 'INTEGER'],
    ['tasks', 'retryable', 'INTEGER DEFAULT 0'],
    ['tasks', 'cancel_state', "TEXT DEFAULT 'none'"],
    ['tasks', 'input_snapshot', 'TEXT'],
    ['tasks', 'media_snapshot', 'TEXT'],
    ['tasks', 'correlation_id', 'TEXT'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`); } catch {}
  }

  // v4：持久化幂等凭据。先把 pending 意图同步落盘，再允许进入可能计费的
  // Provider 调用；即使进程在远端已受理后崩溃，重启也不会静默重复提交。
  db.run(`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      response_code INTEGER,
      response_body TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (scope, key)
    )
  `);

  // v5：阶段产物是项目事实的版本历史。新 revision 不覆盖旧 payload；
  // 上游变化仅将下游 current revision 标为 stale，供用户决定局部重生成。
  db.run(`
    CREATE TABLE IF NOT EXISTS stage_artifacts (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL,
      task_id TEXT,
      stage TEXT NOT NULL,
      revision INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'current',
      schema_version TEXT,
      prompt_version TEXT,
      provider TEXT,
      model TEXT,
      input_hash TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      dependency_snapshot TEXT,
      payload TEXT,
      stale_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, stage, revision),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // 回收站表 — 软删除兜底：删除项目/文件先快照进此表，可还原 / 彻底删 / 自动清理
  db.run(`
    CREATE TABLE IF NOT EXISTS trash (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      name TEXT,
      snapshot TEXT,
      files TEXT,
      deleted_at INTEGER
    )
  `);

  // 操作日志表 — 记录关键操作（创建/删除/还原/生成/配置变更）供设置页审计
  db.run(`
    CREATE TABLE IF NOT EXISTS op_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      created_at INTEGER
    )
  `);

  // 成片模板/预设表（功能⑤）— 保存「画风+画幅+音色+BGM+字幕样式」组合，一键套用
  db.run(`
    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      config TEXT,
      is_builtin INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // 创作技能库表（功能⑦）— 用户/第三方可创建提示词增强技能，AI 生成阶段可选用
  //   stage: 'script'(文案) | 'image'(图片) | 'voice'(配音) | 'all'(通用)
  //   prompt: 拼接进对应阶段 system prompt 的增强指引
  //   auto_apply: 1=必用技能（生成时自动注入），0=可选技能（用户手动勾选）
  //   source: 'builtin'|'skillhub'|'custom' 技能来源
  db.run(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      stage TEXT DEFAULT 'all',
      prompt TEXT NOT NULL,
      icon TEXT DEFAULT '✨',
      is_builtin INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      auto_apply INTEGER DEFAULT 0,
      source TEXT DEFAULT 'custom',
      deleted_at INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // 技能版本表 — 每次迭代修改前保存旧版本，支持查看与回滚
  db.run(`
    CREATE TABLE IF NOT EXISTS skill_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER
    )
  `);

  // 系列故事表 — 001/002/003 等连续项目共享一个 series，便于续写时继承世界观与角色资产。
  db.run(`
    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      style TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // Story Bible — 系列级设定库：世界观、主线、时间线、伏笔、禁改事实、关系与场景规则。
  db.run(`
    CREATE TABLE IF NOT EXISTS story_bibles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL,
      project_id INTEGER,
      worldview TEXT,
      mainline TEXT,
      timeline TEXT,
      previous_summary TEXT,
      open_threads TEXT,
      locked_facts TEXT,
      relationships TEXT,
      scene_rules TEXT,
      style_anchor TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // 角色库 — 结构化保存角色固定设定，后续所有分镜只引用角色 ID 与当前动作。
  db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL,
      project_id INTEGER,
      name TEXT NOT NULL,
      alias TEXT,
      role TEXT,
      age TEXT,
      gender TEXT,
      face TEXT,
      hair TEXT,
      clothing TEXT,
      signature_props TEXT,
      personality TEXT,
      voice TEXT,
      negative_constraints TEXT,
      prompt_anchor TEXT,
      locked INTEGER DEFAULT 0,
      is_primary INTEGER DEFAULT 0,
      deleted_at INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // 角色参考资产 — 当前先记录已生成/上传的参考图，支持后续接入 cref/i2i/LoRA。
  db.run(`
    CREATE TABLE IF NOT EXISTS character_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      project_id INTEGER,
      image_id INTEGER,
      file_url TEXT,
      file_path TEXT,
      kind TEXT DEFAULT 'reference',
      label TEXT,
      created_at INTEGER
    )
  `);

  // v6：保留原 character_assets API，将每条记录增强为不可变的 Variant revision。
  // 不直接覆盖旧参考图；selected 只是当前默认版本，镜头绑定另存快照。
  for (const [table, col, typedef] of [
    ['character_assets', 'variant_key', 'TEXT'],
    ['character_assets', 'revision', 'INTEGER DEFAULT 1'],
    ['character_assets', 'status', "TEXT DEFAULT 'active'"],
    ['character_assets', 'selected', 'INTEGER DEFAULT 0'],
    ['character_assets', 'favorite', 'INTEGER DEFAULT 0'],
    ['character_assets', 'archived_at', 'INTEGER'],
    ['character_assets', 'provider', 'TEXT'],
    ['character_assets', 'model', 'TEXT'],
    ['character_assets', 'prompt', 'TEXT'],
    ['character_assets', 'parent_variant_id', 'INTEGER'],
    ['character_assets', 'media_reference', 'TEXT'],
    ['character_assets', 'content_hash', 'TEXT'],
    ['character_assets', 'updated_at', 'INTEGER'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`); } catch {}
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS storyboard_asset_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      project_id INTEGER,
      asset_type TEXT NOT NULL,
      asset_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      source_scope TEXT NOT NULL DEFAULT 'project',
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(storyboard_id, asset_type, asset_id),
      FOREIGN KEY (storyboard_id) REFERENCES storyboards(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // v7 通用资产层使用稳定字符串 ID；旧的 numeric character/variant 外键继续保留，
  // 新字段让 Scene/Prop/Style 与 Character 共享同一套 Variant/Binding 契约。
  for (const [table, col, typedef] of [
    ['storyboard_asset_bindings', 'asset_unit_id', 'TEXT'],
    ['storyboard_asset_bindings', 'variant_key', 'TEXT'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`); } catch {}
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS asset_units (
      id TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,
      legacy_entity_id INTEGER,
      name TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'episode',
      scope_id INTEGER,
      project_id INTEGER,
      series_id INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      selected_variant_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(asset_type, legacy_entity_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS asset_variants (
      id TEXT PRIMARY KEY,
      asset_unit_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      selected INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      parent_variant_id TEXT,
      provider TEXT,
      model TEXT,
      prompt TEXT,
      media_reference TEXT NOT NULL,
      content_hash TEXT,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(asset_unit_id, revision),
      FOREIGN KEY (asset_unit_id) REFERENCES asset_units(id) ON DELETE CASCADE
    )
  `);

  // 分镜角色绑定 — 明确每个镜头出现哪些角色，以及当前动作、情绪、服装变化和状态。
  db.run(`
    CREATE TABLE IF NOT EXISTS storyboard_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storyboard_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      scene_role TEXT,
      action TEXT,
      emotion TEXT,
      wardrobe TEXT,
      location TEXT,
      state_note TEXT,
      created_at INTEGER
    )
  `);

  // v6 旧数据回填。使用 JS 序列化媒体引用，避免依赖 SQLite JSON 扩展；
  // 回填条件是空值才写，所以重复初始化是幂等的。
  if (previousSchemaVersion < 6) {
    const variants = getDb().prepare(`SELECT * FROM character_assets ORDER BY character_id, created_at, id`).all();
    const revisions = new Map<number, number>();
    for (const row of variants) {
      const revision = (revisions.get(Number(row.character_id)) || 0) + 1;
      revisions.set(Number(row.character_id), revision);
      const url = String(row.file_url || row.file_path || '').split(/[?#]/, 1)[0] ?? '';
      const media = JSON.stringify({
        kind: /^https?:\/\//i.test(url) ? 'public_url' : 'project_media',
        media_id: row.image_id == null ? null : Number(row.image_id),
        object_key: '',
        url,
        mime: '',
        content_hash: '',
      });
      getDb().prepare(`UPDATE character_assets
        SET variant_key = COALESCE(NULLIF(variant_key, ''), ?),
            revision = ?, status = COALESCE(NULLIF(status, ''), 'active'),
            media_reference = COALESCE(NULLIF(media_reference, ''), ?),
            updated_at = COALESCE(updated_at, created_at, ?)
        WHERE id = ?`).run(`legacy-character-${row.character_id}-asset-${row.id}`, revision, media, Date.now(), row.id);
    }
    for (const characterId of revisions.keys()) {
      const selected = getDb().prepare('SELECT id FROM character_assets WHERE character_id = ? AND selected = 1 LIMIT 1').get(characterId);
      if (!selected) {
        const latest = getDb().prepare(`SELECT id FROM character_assets
          WHERE character_id = ? AND status != 'archived' ORDER BY revision DESC, id DESC LIMIT 1`).get(characterId);
        if (latest) getDb().prepare('UPDATE character_assets SET selected = 1 WHERE id = ?').run(latest.id);
      }
    }

    const candidates = getDb().prepare('SELECT * FROM images ORDER BY id').all();
    for (const row of candidates) {
      const url = String(row.file_url || row.file_path || '').split(/[?#]/, 1)[0] ?? '';
      const media = JSON.stringify({
        kind: /^https?:\/\//i.test(url) ? 'public_url' : 'project_media',
        media_id: Number(row.id), object_key: '', url, mime: '', content_hash: '',
      });
      getDb().prepare(`UPDATE images
        SET media_reference = COALESCE(NULLIF(media_reference, ''), ?),
            updated_at = COALESCE(updated_at, ?),
            selected_at = CASE WHEN id IN (SELECT selected_image_id FROM storyboards) THEN COALESCE(selected_at, ?) ELSE selected_at END
        WHERE id = ?`).run(media, Date.now(), Date.now(), row.id);
    }
  }

  // v7：将现有 Character/character_assets 幂等投影到通用资产表。
  // Character 专属字段仍以 characters 为事实来源，避免破坏旧接口。
  if (previousSchemaVersion < 7) {
    const characterRows = getDb().prepare(`SELECT * FROM characters
      WHERE COALESCE(deleted_at, 0) = 0 ORDER BY id`).all();
    for (const character of characterRows) {
      const unitId = `legacy-character-${character.id}`;
      const scope = character.project_id ? 'episode' : (character.series_id ? 'series' : 'global');
      const scopeId = character.project_id || character.series_id || null;
      const variants = getDb().prepare(`SELECT * FROM character_assets
        WHERE character_id = ? ORDER BY revision ASC, id ASC`).all(character.id);
      const selected = variants.find((row) => Number(row.selected) === 1) || variants[variants.length - 1] || null;
      const selectedVariantId = selected ? String(selected.variant_key || `legacy-character-${character.id}-asset-${selected.id}`) : null;
      const createdAt = Number(character.created_at) || Date.now();
      const updatedAt = Number(character.updated_at) || createdAt;
      getDb().prepare(`INSERT OR IGNORE INTO asset_units
        (id, asset_type, legacy_entity_id, name, scope, scope_id, project_id, series_id, metadata, status,
         selected_variant_id, created_at, updated_at)
        VALUES (?, 'character', ?, ?, ?, ?, ?, ?, '{}', 'active', ?, ?, ?)`)
        .run(unitId, character.id, character.name || `Character ${character.id}`, scope, scopeId,
          character.project_id || null, character.series_id || null, selectedVariantId, createdAt, updatedAt);
      getDb().prepare(`UPDATE asset_units SET name=?, scope=?, scope_id=?, project_id=?, series_id=?,
        selected_variant_id=?, updated_at=? WHERE id=?`)
        .run(character.name || `Character ${character.id}`, scope, scopeId, character.project_id || null,
          character.series_id || null, selectedVariantId, updatedAt, unitId);

      for (const variant of variants) {
        const variantId = String(variant.variant_key || `legacy-character-${character.id}-asset-${variant.id}`);
        const mediaReference = variant.media_reference || JSON.stringify({
          kind: /^https?:\/\//i.test(String(variant.file_url || '')) ? 'public_url' : 'project_media',
          media_id: variant.image_id == null ? null : Number(variant.image_id),
          object_key: '',
          url: String(variant.file_url || variant.file_path || '').split(/[?#]/, 1)[0],
          mime: '',
          content_hash: variant.content_hash || '',
        });
        const variantCreatedAt = Number(variant.created_at) || createdAt;
        const variantUpdatedAt = Number(variant.updated_at) || variantCreatedAt;
        getDb().prepare(`INSERT OR IGNORE INTO asset_variants
          (id, asset_unit_id, revision, label, status, selected, favorite, parent_variant_id, provider, model,
           prompt, media_reference, content_hash, archived_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(variantId, unitId, Number(variant.revision) || 1, variant.label || '', variant.status || 'active',
            Number(variant.selected) || 0, Number(variant.favorite) || 0, variant.parent_variant_id || null,
            variant.provider || '', variant.model || '', variant.prompt || '', mediaReference,
            variant.content_hash || '', variant.archived_at || null, variantCreatedAt, variantUpdatedAt);
      }
    }
  }

  // 一致性质检记录 — 保存生成前/生成后的连续性评分、问题和修正建议。
  db.run(`
    CREATE TABLE IF NOT EXISTS continuity_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      storyboard_id INTEGER,
      image_id INTEGER,
      score INTEGER,
      status TEXT,
      issues TEXT,
      suggestions TEXT,
      repair_action TEXT,
      resolved_at INTEGER,
      selected_as_reference INTEGER DEFAULT 0,
      created_at INTEGER
    )
  `);

  // 创作工作台检查记录 — 保存最近一次项目状态检查，供前端提示条和排障回看。
  db.run(`
    CREATE TABLE IF NOT EXISTS workbench_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      current_step TEXT,
      next_action TEXT,
      missing_items TEXT,
      repair_items TEXT,
      summary TEXT,
      created_at INTEGER
    )
  `);

  // 生成缓存 — prompt + 模型 + 角色上下文命中时可复用上次结果，减少重复等待。
  db.run(`
    CREATE TABLE IF NOT EXISTS generation_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      project_id INTEGER,
      storyboard_id INTEGER,
      kind TEXT DEFAULT 'image',
      provider TEXT,
      model TEXT,
      prompt_hash TEXT,
      prompt TEXT,
      context_hash TEXT,
      result TEXT,
      hit_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // 图片生成结果埋点——用于计算可复核的首次直出率、最终真实出图率与占位兜底率。
  // 这里只记录模型链结果，不保存提示词、图片或密钥等内容。
  db.run(`
    CREATE TABLE IF NOT EXISTS image_gen_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      storyboard_id INTEGER,
      requested_model TEXT,
      first_model TEXT,
      first_attempt_ok INTEGER,
      final_ok INTEGER,
      used_placeholder INTEGER,
      downgraded INTEGER,
      attempts_count INTEGER,
      final_provider TEXT,
      source TEXT,
      created_at INTEGER
    )
  `);

  // 草稿快照表（功能⑥）— 项目编辑节点存档，可回滚分镜+脚本状态
  db.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      label TEXT,
      snapshot TEXT,
      created_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // v8：可视化 Studio 只持久化视图状态，不把画布 JSON 当作领域事实。
  // 复合主键允许后续增加时间线、候选评审等独立视图；项目删除时自动级联清理。
  db.run(`
    CREATE TABLE IF NOT EXISTS project_view_states (
      project_id INTEGER NOT NULL,
      view_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, view_key),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // v9：Series 资产 fork lineage、字段级 stale 与不可变 Prompt/分镜修订历史。
  // 全部采用 additive migration；旧字段和旧 API 继续保留。
  for (const [table, column, definition] of [
    ['asset_units', 'forked_from_unit_id', 'TEXT'],
    ['asset_units', 'forked_from_variant_id', 'TEXT'],
    ['storyboards', 'stale_fields', "TEXT NOT NULL DEFAULT '[]'"],
    ['storyboards', 'stale_sources', "TEXT NOT NULL DEFAULT '[]'"],
    ['images', 'stale_fields', "TEXT NOT NULL DEFAULT '[]'"],
    ['images', 'stale_sources', "TEXT NOT NULL DEFAULT '[]'"],
    ['images', 'prompt_revision_id', 'TEXT'],
    ['storyboards', 'prompt_revision_id', 'TEXT'],
    ['storyboard_asset_bindings', 'stale_fields', "TEXT NOT NULL DEFAULT '[]'"],
    ['storyboard_asset_bindings', 'stale_sources', "TEXT NOT NULL DEFAULT '[]'"],
    ['stage_artifacts', 'stale_fields', "TEXT NOT NULL DEFAULT '[]'"],
    ['stage_artifacts', 'stale_sources', "TEXT NOT NULL DEFAULT '[]'"],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch {}
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS storyboard_field_revisions (
      id TEXT PRIMARY KEY,
      storyboard_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      changed_fields TEXT NOT NULL,
      field_hashes TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      UNIQUE(storyboard_id, revision),
      FOREIGN KEY (storyboard_id) REFERENCES storyboards(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prompt_revisions (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL,
      storyboard_id INTEGER,
      kind TEXT NOT NULL,
      revision INTEGER NOT NULL,
      parent_revision_id TEXT,
      source TEXT NOT NULL,
      prompt_version TEXT,
      provider TEXT,
      model TEXT,
      content TEXT NOT NULL,
      negative_content TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id, storyboard_id, kind, revision),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (storyboard_id) REFERENCES storyboards(id) ON DELETE CASCADE
    )
  `);

  // 不在数据库初始化时把运行中任务粗暴终结。app 启动完成后由 taskRecovery
  // 根据任务类型和持久化检查点重建 runner；未知类型才会保留为 interrupted 供诊断。

  // 创建索引 — 加速高频 JOIN 和排序查询（v1.6.6 合规修复）
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_storyboards_project_id ON storyboards(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_images_storyboard_id ON images(storyboard_id)',
    'CREATE INDEX IF NOT EXISTS idx_exports_project_id ON exports(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_type_created ON tasks(type, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_provider_task_id ON tasks(provider, provider_task_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_parent_attempt ON tasks(parent_task_id, attempt)',
    'CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_records(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_stage_artifacts_project_stage ON stage_artifacts(project_id, stage, revision DESC)',
    'CREATE INDEX IF NOT EXISTS idx_stage_artifacts_status ON stage_artifacts(project_id, status, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_projects_series_id ON projects(series_id)',
    'CREATE INDEX IF NOT EXISTS idx_story_bibles_series_id ON story_bibles(series_id)',
    'CREATE INDEX IF NOT EXISTS idx_characters_series_id ON characters(series_id)',
    'CREATE INDEX IF NOT EXISTS idx_character_assets_character_id ON character_assets(character_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_character_assets_variant_key ON character_assets(variant_key)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_character_assets_revision ON character_assets(character_id, revision)',
    'CREATE INDEX IF NOT EXISTS idx_asset_units_scope ON asset_units(asset_type, scope, scope_id)',
    'CREATE INDEX IF NOT EXISTS idx_asset_variants_unit ON asset_variants(asset_unit_id, revision)',
    'CREATE INDEX IF NOT EXISTS idx_storyboard_asset_bindings_storyboard ON storyboard_asset_bindings(storyboard_id)',
    'CREATE INDEX IF NOT EXISTS idx_storyboard_asset_bindings_variant ON storyboard_asset_bindings(variant_id)',
    'CREATE INDEX IF NOT EXISTS idx_images_review ON images(storyboard_id, archived_at, favorite, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_storyboard_characters_storyboard_id ON storyboard_characters(storyboard_id)',
    'CREATE INDEX IF NOT EXISTS idx_continuity_checks_project_id ON continuity_checks(project_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_workbench_checks_project_id ON workbench_checks(project_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_generation_cache_project_id ON generation_cache(project_id, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_image_gen_stats_created_at ON image_gen_stats(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_project_view_states_updated ON project_view_states(project_id, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_storyboard_field_revisions ON storyboard_field_revisions(storyboard_id, revision DESC)',
    'CREATE INDEX IF NOT EXISTS idx_prompt_revisions_scope ON prompt_revisions(project_id, storyboard_id, kind, revision DESC)',
  ];
  for (const sql of indexes) {
    try { db.run(sql); } catch (e: unknown) {
      console.warn(`[DB] 索引创建跳过（可能已存在）: ${errorMessage(e)}`);
    }
  }

  if (previousSchemaVersion <= SCHEMA_VERSION) db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  // 初始化阶段直接同步写盘一次
  saveDb();

  // 注册退出钩子
  setupExitHook();

  return db;
}

// 兼容 better-sqlite3 的 prepare API
export function getDb(): DbClient {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  const database = db
  return {
    prepare(sql: string): DbStatement {
      return {
        all(...params: unknown[]): SqlRow[] {
          const stmt = database.prepare(sql);
          stmt.bind(bindValues(params));
          const results: SqlRow[] = [];
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        },
        get(...params: unknown[]): SqlRow | undefined {
          const stmt = database.prepare(sql);
          stmt.bind(bindValues(params));
          const result = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return result;
        },
        run(...params: unknown[]): DbRunResult {
          // 用 prepare/step 而非 db.run，确保 last_insert_rowid 在同一连接上下文
          const stmt = database.prepare(sql);
          stmt.bind(bindValues(params));
          stmt.step();
          stmt.free();
          // 立即查询 ID 和 changes
          const info = database.exec("SELECT last_insert_rowid() as id, changes() as changes");
          const lastId = info[0]?.values[0]?.[0] || 0;
          const changes = info[0]?.values[0]?.[1] || 0;
          // 非事务模式：调度延迟写盘（节流）
          // 事务模式：由 transaction 统一在 COMMIT 后 saveDb
          if (database._txDepth === 0) scheduleSave();
          return { lastInsertRowid: lastId, changes };
        }
      };
    },
    transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult {
      return (...args: TArgs): TResult => {
        const isOuter = database._txDepth === 0;
        if (isOuter) database.run('BEGIN');
        database._txDepth++;
        try {
          const result = fn(...args);
          database._txDepth--;
          if (isOuter) {
            database.run('COMMIT');
            // 事务结束立即写盘（不走节流，保证强一致）
            saveDb();
          }
          return result;
        } catch (e) {
          database._txDepth--;
          if (isOuter) {
            try { database.run('ROLLBACK'); } catch { /* 已无活动事务 */ }
          }
          throw e;
        }
      };
    }
  };
}

// F8 备份还原：用上传的 SQLite 字节流热替换当前内存库（免重启 PM2）。
// 替换后立刻重申外键并落盘。返回是否成功。
export function restoreRaw(buffer: Uint8Array): true {
  if (!SQL) throw new Error('SQL.js 未初始化');
  const fresh = createSqlJsRuntime(new SQL.Database(new Uint8Array(buffer)));
  const integrity = fresh.exec('PRAGMA integrity_check')[0]?.values?.[0]?.[0];
  if (integrity !== 'ok') { fresh.close(); throw new Error(`备份数据库完整性校验失败：${integrity || 'unknown'}`); }
  const required = fresh.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','storyboards','tasks')")[0]?.values || [];
  if (required.length < 3) { fresh.close(); throw new Error('备份缺少必要业务表'); }
  const incomingVersion = userVersion(fresh);
  if (incomingVersion > SCHEMA_VERSION) { fresh.close(); throw new Error(`备份 schema v${incomingVersion} 高于当前程序 v${SCHEMA_VERSION}`); }

  // 覆盖前先把当前连接同步到主文件，再创建可独立恢复的一致性快照。
  saveDb();
  if (fs.existsSync(DB_PATH)) {
    const backupDir = path.join(path.dirname(DB_PATH), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(DB_PATH, path.join(backupDir, `restore-point-${Date.now()}.sqlite`));
  }
  const tempPath = `${DB_PATH}.restore.tmp`;
  const restoredBytes = Buffer.from(fresh.export());
  const currentDriver = db?.driver || 'sqljs';
  if (db) { try { db.close(); } catch {} }
  try {
    fs.writeFileSync(tempPath, restoredBytes);
    fs.renameSync(tempPath, DB_PATH);
    if (currentDriver === 'better-sqlite3') {
      fresh.close();
      db = createBetterSqliteRuntime(DB_PATH);
    } else {
      db = fresh;
    }
    db.configurePersistentMode();
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    if (currentDriver === 'better-sqlite3') {
      try {
        db = createBetterSqliteRuntime(DB_PATH);
        db.configurePersistentMode();
      } catch {}
    }
    throw error;
  }
  return true;
}

// F8 备份：导出当前库的原始 SQLite 字节（Buffer），不落盘
export function exportRaw(): Buffer {
  if (!db) throw new Error('Database not initialized');
  const data = db.export();
  db.run('PRAGMA foreign_keys = ON'); // export 会关外键，重申
  return Buffer.from(data);
}

export function getDatabaseDriver(): RuntimeDatabase['driver'] {
  if (!db) throw new Error('Database not initialized');
  return db.driver;
}
