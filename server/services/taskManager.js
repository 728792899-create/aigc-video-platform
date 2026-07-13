/**
 * Task Manager - 异步任务进度跟踪
 * 用于 AI 图片生成 / 视频合成等长耗时任务
 *
 * 持久化：任务同步落库到 tasks 表，进程重启后可由 loadFromDb() 恢复，
 * 避免前端轮询 /api/tasks/:id 拿到 404 而永久卡住。
 */
const { randomUUID } = require('crypto');
const { EventEmitter } = require('events');
const workflowStateMachine = require('./workflowStateMachine');

const TERMINAL_STATUSES = new Set(['success', 'failed', 'interrupted', 'partial', 'canceled']);

class TaskManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this._db = null; // 延迟注入，DB 就绪后由 loadFromDb 设置
    // 每 30 分钟做一次软清理：终态任务只从内存卸载（DB 长期保留供历史中心回溯），
    // 并对 DB 历史做封顶，避免无限膨胀。
    setInterval(() => this.cleanup(), 30 * 60 * 1000);
  }

  // ---- 持久化辅助（DB 未就绪时静默跳过，不影响内存逻辑）----
  _getDb() {
    if (this._db) return this._db;
    try {
      const { getDb } = require('../db');
      this._db = getDb();
      return this._db;
    } catch {
      return null; // DB 尚未初始化
    }
  }

  _persist(task) {
    const db = this._getDb();
    if (!db) return;
    try {
      db.prepare(
        `INSERT INTO tasks (id, type, status, progress, message, meta, result, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status=excluded.status, progress=excluded.progress, message=excluded.message,
           meta=excluded.meta, result=excluded.result, error=excluded.error, updated_at=excluded.updated_at`
      ).run(
        task.id, task.type, task.status, task.progress, task.message || '',
        JSON.stringify({ ...(task.meta || {}), ...(task.diagnosis ? { diagnosis: task.diagnosis } : {}) }),
        task.result != null ? JSON.stringify(task.result) : null,
        task.error || null,
        task.created_at, task.updated_at
      );
    } catch (e) {
      console.error('[taskManager] 持久化失败:', e.message);
    }
  }

  /**
   * 启动时把 DB 中（已被 initDb 标记为 interrupted 的）历史任务载回内存，
   * 让前端仍能查询到这些任务的终态。
   */
  loadFromDb() {
    const db = this._getDb();
    if (!db) return;
    try {
      const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200').all();
      for (const r of rows) {
        this.tasks.set(r.id, {
          id: r.id,
          type: r.type,
          status: r.status,
          progress: r.progress,
          message: r.message,
          meta: r.meta ? JSON.parse(r.meta) : {},
          result: r.result ? JSON.parse(r.result) : null,
          error: r.error,
          created_at: r.created_at,
          updated_at: r.updated_at,
        });
        const restored = this.tasks.get(r.id);
        if (restored && restored.meta && restored.meta.diagnosis) {
          restored.diagnosis = restored.meta.diagnosis;
        }
      }
      console.log(`[taskManager] 已从 DB 恢复 ${rows.length} 条历史任务`);
    } catch (e) {
      console.error('[taskManager] 从 DB 恢复任务失败:', e.message);
    }
  }

  ensureWorkflow(id, options = {}) {
    const task = this.get(id);
    if (!task) return null;
    const workflow = workflowStateMachine.normalizeWorkflow(task.meta?.workflow, {
      projectId: options.projectId || task.meta?.project_id,
      topic: options.topic || task.meta?.theme,
    });
    this.update(id, { meta: { ...(task.meta || {}), workflow } });
    return workflow;
  }

  transitionStage(id, event) {
    const task = this.get(id);
    if (!task) return null;
    const current = workflowStateMachine.normalizeWorkflow(task.meta?.workflow, {
      projectId: task.meta?.project_id,
      topic: task.meta?.theme,
    });
    const workflow = workflowStateMachine.transition(current, event);
    this.update(id, { meta: { ...(task.meta || {}), workflow } });
    return workflow;
  }

  create(type, meta = {}) {
    const id = randomUUID();
    const task = {
      id,
      type, // 'image' | 'video' | 'tts'
      status: 'pending', // pending | running | success | failed | interrupted
      progress: 0, // 0-100
      message: '任务已创建',
      meta,
      result: null,
      error: null,
      diagnosis: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.tasks.set(id, task);
    this._persist(task);
    this.emit('change', task);
    return task;
  }

  update(id, patch) {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, patch, { updated_at: Date.now() });
    this._persist(task);
    this.emit('change', task);
    this.emit(`change:${id}`, task);
    return task;
  }

  start(id, message = '任务开始') {
    return this.update(id, { status: 'running', message, progress: 1 });
  }

  progress(id, progress, message) {
    const patch = { progress: Math.min(99, Math.max(0, Math.round(progress))) };
    if (message !== undefined) patch.message = message;
    return this.update(id, patch);
  }

  succeed(id, result, message = '完成') {
    return this.update(id, {
      status: 'success',
      progress: 100,
      message,
      result,
    });
  }

  fail(id, error) {
    const raw = error instanceof Error ? error.message : String(error);
    const errMsg = require('./credentialStore').redact(raw);
    return this.update(id, {
      status: 'failed',
      message: errMsg,
      error: errMsg,
      diagnosis: error && error.diagnosis ? error.diagnosis : null,
    });
  }

  partial(id, result, message = '部分完成') {
    return this.update(id, {
      status: 'partial',
      progress: 100,
      message,
      result,
    });
  }

  cancel(id, message = '已取消') {
    return this.update(id, {
      status: 'canceled',
      message,
    });
  }

  get(id) {
    const cached = this.tasks.get(id);
    if (cached) return cached;
    const db = this._getDb();
    if (!db) return undefined;
    try {
      const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!r) return undefined;
      const task = {
        id: r.id,
        type: r.type,
        status: r.status,
        progress: r.progress,
        message: r.message,
        meta: r.meta ? JSON.parse(r.meta) : {},
        result: r.result ? JSON.parse(r.result) : null,
        error: r.error,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
      if (task.meta?.diagnosis) task.diagnosis = task.meta.diagnosis;
      this.tasks.set(id, task);
      return task;
    } catch {
      return undefined;
    }
  }

  list(filter = {}) {
    const all = Array.from(this.tasks.values());
    return all.filter((t) => {
      if (filter.type && t.type !== filter.type) return false;
      if (filter.status && t.status !== filter.status) return false;
      return true;
    });
  }

  /**
   * 软清理：终态任务超过 30 分钟后只从【内存】卸载（释放事件监听 / Map），
   * DB 记录长期保留供「历史记录中心」回溯。同时对 DB 历史做 1000 条封顶，
   * 超出的最旧终态记录被删除，避免数据库无限膨胀。
   */
  cleanup() {
    const now = Date.now();
    const db = this._getDb();
    // 1) 内存卸载：终态且超过 30 分钟
    for (const [id, task] of this.tasks.entries()) {
      if (
        TERMINAL_STATUSES.has(task.status) &&
        now - task.updated_at > 30 * 60 * 1000
      ) {
        this.tasks.delete(id);
      }
    }
    // 2) DB 封顶：保留最近 1000 条，多出来的最旧终态记录删除
    if (db) {
      try {
        db.prepare(
          `DELETE FROM tasks WHERE id IN (
             SELECT id FROM tasks
             WHERE status IN ('success','failed','interrupted','partial','canceled')
             ORDER BY created_at DESC
             LIMIT -1 OFFSET 1000
           )`
        ).run();
      } catch (e) {
        console.error('[taskManager] 历史封顶清理失败:', e.message);
      }
      // 3) op_logs 封顶：保留最近 2000 条操作日志，避免 sql.js 全量序列化随表无限膨胀
      try {
        db.prepare(
          `DELETE FROM op_logs WHERE id IN (
             SELECT id FROM op_logs
             ORDER BY created_at DESC
             LIMIT -1 OFFSET 2000
           )`
        ).run();
      } catch (e) {
        console.error('[taskManager] op_logs 封顶清理失败:', e.message);
      }
    }
  }
}

const taskManager = new TaskManager();

module.exports = taskManager;
module.exports.TaskManager = TaskManager;
