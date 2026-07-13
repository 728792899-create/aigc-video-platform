/**
 * 数据库层 - 使用 sql.js (纯JS SQLite实现)
 * 提供与 better-sqlite3 兼容的同步API封装
 *
 * 改进：
 *  1. 节流写盘 — 高频写入合并为一次磁盘 IO，主线程不再被反复阻塞
 *  2. 临时文件 + rename — 防止写到一半 crash 损坏数据库
 *  3. 嵌套事务计数器 — 替代单一布尔标志，支持事务回调内再开事务
 *  4. 进程退出钩子 — 进程意外退出时兜底 flush 一次
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// DB 路径：优先用环境变量 DB_PATH（Electron 打包时指向用户数据目录的可写位置），
// 否则用开发默认 server/db/database.sqlite。库不存在时 initDb 会自动新建。
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, 'database.sqlite');

let db = null;
let SQL = null;

// ============ 写盘节流 + 互斥 ============
let saveTimer = null;
let saving = false;

/**
 * 真正执行写盘（同步，带互斥标志防重入）
 */
function flushDb() {
  if (!db || saving) return;
  saving = true;
  try {
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
  } catch (err) {
    console.error('[DB] flushDb error:', err.message);
  } finally {
    saving = false;
  }
}

/**
 * 标记需要写盘，500ms 后统一执行（节流）
 * 高频写入时只触发一次磁盘 IO，避免主线程反复同步阻塞
 */
function scheduleSave() {
  if (saveTimer) return; // 已有定时器在等
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushDb();
  }, 500);
}

/**
 * 立即同步写盘（事务结束/进程退出/外部强制时使用）
 */
function saveDb() {
  // 取消待执行的节流任务，立刻 flush
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushDb();
}

// 进程退出兜底：确保未 flush 的数据落盘
function setupExitHook() {
  const handler = (signal) => {
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
async function initDb() {
  SQL = await initSqlJs();
  // 确保 DB 所在目录存在（Electron 打包后 DB_PATH 指向用户数据目录，首次启动可能不存在）
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // 用计数器替代布尔标志，支持事务嵌套场景下的 saveDb 决策
  db._txDepth = 0;

  // 启用外键
  db.run('PRAGMA foreign_keys = ON');

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (storyboard_id) REFERENCES storyboards(id) ON DELETE CASCADE
    )
  `);

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

  // 启动恢复：把上次进程残留的 pending/running 任务标记为 interrupted（已中断），
  // 因为 worker 进程已死无法续跑，但要给前端一个明确终态而不是 404
  try {
    db.run(
      `UPDATE tasks SET status = 'interrupted',
         message = '任务因服务重启而中断',
         updated_at = ?
       WHERE status IN ('pending', 'waiting', 'running', 'composing')`,
      [Date.now()]
    );
  } catch (e) {
    console.error('[DB] 恢复任务状态失败:', e.message);
  }

  // 创建索引 — 加速高频 JOIN 和排序查询（v1.6.6 合规修复）
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_storyboards_project_id ON storyboards(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_images_storyboard_id ON images(storyboard_id)',
    'CREATE INDEX IF NOT EXISTS idx_exports_project_id ON exports(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_type_created ON tasks(type, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_projects_series_id ON projects(series_id)',
    'CREATE INDEX IF NOT EXISTS idx_story_bibles_series_id ON story_bibles(series_id)',
    'CREATE INDEX IF NOT EXISTS idx_characters_series_id ON characters(series_id)',
    'CREATE INDEX IF NOT EXISTS idx_character_assets_character_id ON character_assets(character_id)',
    'CREATE INDEX IF NOT EXISTS idx_storyboard_characters_storyboard_id ON storyboard_characters(storyboard_id)',
    'CREATE INDEX IF NOT EXISTS idx_continuity_checks_project_id ON continuity_checks(project_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_workbench_checks_project_id ON workbench_checks(project_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_generation_cache_project_id ON generation_cache(project_id, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_image_gen_stats_created_at ON image_gen_stats(created_at DESC)',
  ];
  for (const sql of indexes) {
    try { db.run(sql); } catch (e) {
      console.warn(`[DB] 索引创建跳过（可能已存在）: ${e.message}`);
    }
  }

  // 初始化阶段直接同步写盘一次
  saveDb();

  // 注册退出钩子
  setupExitHook();

  return db;
}

// 兼容 better-sqlite3 的 prepare API
function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return {
    prepare(sql) {
      return {
        all(...params) {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          const results = [];
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        },
        get(...params) {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          const result = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return result;
        },
        run(...params) {
          // 用 prepare/step 而非 db.run，确保 last_insert_rowid 在同一连接上下文
          const stmt = db.prepare(sql);
          stmt.bind(params);
          stmt.step();
          stmt.free();
          // 立即查询 ID 和 changes
          const info = db.exec("SELECT last_insert_rowid() as id, changes() as changes");
          const lastId = info[0]?.values[0]?.[0] || 0;
          const changes = info[0]?.values[0]?.[1] || 0;
          // 非事务模式：调度延迟写盘（节流）
          // 事务模式：由 transaction 统一在 COMMIT 后 saveDb
          if (db._txDepth === 0) scheduleSave();
          return { lastInsertRowid: lastId, changes };
        }
      };
    },
    transaction(fn) {
      return (...args) => {
        const isOuter = db._txDepth === 0;
        if (isOuter) db.run('BEGIN');
        db._txDepth++;
        try {
          const result = fn(...args);
          db._txDepth--;
          if (isOuter) {
            db.run('COMMIT');
            // 事务结束立即写盘（不走节流，保证强一致）
            saveDb();
          }
          return result;
        } catch (e) {
          db._txDepth--;
          if (isOuter) {
            try { db.run('ROLLBACK'); } catch (re) { /* 已无活动事务 */ }
          }
          throw e;
        }
      };
    }
  };
}

// F8 备份还原：用上传的 SQLite 字节流热替换当前内存库（免重启 PM2）。
// 替换后立刻重申外键并落盘。返回是否成功。
function restoreRaw(buffer) {
  if (!SQL) throw new Error('SQL.js 未初始化');
  const fresh = new SQL.Database(new Uint8Array(buffer));
  // 简单完整性校验：必须能查到 projects 表
  fresh.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'");
  if (db) { try { db.close(); } catch {} }
  db = fresh;
  db._txDepth = 0;
  db.run('PRAGMA foreign_keys = ON');
  saveDb();
  return true;
}

// F8 备份：导出当前库的原始 SQLite 字节（Buffer），不落盘
function exportRaw() {
  if (!db) throw new Error('Database not initialized');
  const data = db.export();
  db.run('PRAGMA foreign_keys = ON'); // export 会关外键，重申
  return Buffer.from(data);
}

module.exports = { initDb, getDb, saveDb, restoreRaw, exportRaw };
