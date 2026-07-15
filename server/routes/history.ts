/**
 * 历史记录中心 - 回溯所有生成任务（含已脱内存的长期记录）
 *
 * 数据源：tasks 表（taskManager 已软清理，DB 长期保留）。
 * GET  /api/history            - 分页查询，支持 type/status 筛选，附带项目名
 * POST /api/history/:id/retry  - 按 meta 重新发起同类任务（目前支持 auto-produce）
 * DELETE /api/history/:id       - 删除单条历史记录
 * DELETE /api/history           - 批量删除（{ ids: [] }）/ 清空终态（{ all: true }）
 */
import express from 'express'
import { getDb, type SqlRow, type SqlValue } from '../db'
import type { TaskManager } from '../services/taskManager'
import idempotency = require('../services/idempotency')
import { createWorkflow } from '../services/workflowStateMachine'
import { asRecord, errorMessage, parseJsonRecord, queryText, sqlNumber, sqlText } from './routeSupport'
const router = express.Router();
const taskManager: TaskManager = require('../services/taskManager');

// 安全 JSON 解析
// 把一行 task 记录加工成前端友好结构（解析 meta/result，附项目名）
function enrich(row: SqlRow, projectNames: Map<string, string>) {
  const meta = parseJsonRecord(row.meta);
  const result = parseJsonRecord(row.result);
  const partialResult = asRecord(result.partialResult);
  const projectId = meta.project_id || result.project_id || null;
  const diagnosis = meta.diagnosis || result.diagnosis || partialResult.diagnosis || null;
  const projectKey = String(projectId ?? '');
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    theme: meta.theme || (result && result.title) || '',
    project_id: projectId,
    project_name: projectId != null ? (projectNames.get(projectKey) || null) : null,
    project_exists: projectId != null ? projectNames.has(projectKey) : false,
    result,
    diagnosis,
  };
}

module.exports = router;

// 分页列表：直接查 DB（长期记录），不走内存
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const type = queryText(req.query.type);
    const status = queryText(req.query.status);
    const page = Math.max(1, parseInt(queryText(req.query.page), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(queryText(req.query.pageSize), 10) || 20));

    const where: string[] = [];
    const params: SqlValue[] = [];
    if (type) { where.push('type = ?'); params.push(type); }
    if (status) { where.push('status = ?'); params.push(status); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = sqlNumber(db.prepare(`SELECT COUNT(*) AS n FROM tasks ${whereSql}`).get(...params)?.n);
    const rows = db.prepare(
      `SELECT * FROM tasks ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, (page - 1) * pageSize);

    // 一次性取项目名映射，避免 N+1
    const projRows = db.prepare('SELECT id, name FROM projects').all();
    const projectNames = new Map<string, string>();
    for (const project of projRows) projectNames.set(String(project.id), sqlText(project.name));

    res.json({
      code: 200,
      data: {
        list: rows.map((row) => enrich(row, projectNames)),
        page, pageSize, total,
      },
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});

// 重新发起任务：目前支持 auto-produce（按原 theme/style 重跑一键成片）
router.post('/:id/retry', idempotency(), async (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, message: '历史记录不存在' });
    if (row.type !== 'auto-produce') {
      return res.status(400).json({ code: 400, message: '该任务类型暂不支持一键重试，请到对应页面重新操作' });
    }
    const meta = parseJsonRecord(row.meta);
    const theme = typeof meta.theme === 'string' ? meta.theme : '';
    if (!theme.trim()) return res.status(400).json({ code: 400, message: '原任务缺少主题信息，无法重试' });
    if (row.status === 'orphaned' && req.body?.confirm_uncertain_outcome !== true) {
      return res.status(409).json({
        code: 409,
        message: '该任务的远端结果无法确认。请先核对任务和资产，再明确确认重试。',
      });
    }

    // 复用 auto-produce：新建项目 + 任务 + 后台流水线
    const projName = theme.trim().slice(0, 30);
    const projRes = db.prepare(
      'INSERT INTO projects (name, theme, style, status) VALUES (?, ?, ?, ?)'
    ).run(projName, theme.trim(), meta.style || '写实', 'generating');
    const projectId = projRes.lastInsertRowid;
    const params = {
      ...(meta.params || {}),
      theme: theme.trim(),
      style: asRecord(meta.params).style || meta.style || '写实',
    };
    const demoMode = ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase());
    const attempt = Math.max(1, Number(meta.attempt) || 1) + 1;
    const task = taskManager.create('auto-produce', {
      ...meta,
      project_id: projectId,
      theme: theme.trim(),
      params,
      retry_of: row.id,
      attempt,
      idempotency_key: req.idempotency?.key || null,
      input_hash: req.idempotency?.requestHash || null,
      workflow: createWorkflow({ projectId, topic: theme.trim() }),
      demo_mode: demoMode,
      recovery: {
        kind: 'auto-produce',
        mode: demoMode ? 'safe-auto' : 'manual-reconcile',
        attempts: 0,
        max_attempts: 3,
      },
    });
    const queue = require('../services/autoProduceQueue');
    const aiRouter = require('./ai');
    const queued = queue.enqueue(task, () => aiRouter.runAutoProduceTask(task.id, projectId, params));
    res.json({
      code: 200,
      data: { project_id: projectId, task_id: task.id, retry_of: row.id, attempt, status: queued.status },
      message: '已重新发起一键成片',
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});

// 批量删除 / 清空终态历史记录
router.delete('/', (req, res) => {
  try {
    const db = getDb();
    const { ids, all } = req.body || {};
    let removed = 0;
    if (all) {
      const r = db.prepare("DELETE FROM tasks WHERE status IN ('success','failed','interrupted','orphaned','partial','canceled')").run();
      removed = sqlNumber(r.changes);
    } else if (Array.isArray(ids) && ids.length) {
      const ph = ids.map(() => '?').join(',');
      const r = db.prepare(`DELETE FROM tasks WHERE id IN (${ph})`).run(...ids);
      removed = sqlNumber(r.changes);
    } else {
      return res.status(400).json({ code: 400, message: '请提供 ids 数组或 all=true' });
    }
    // 同步从内存卸载
    for (const id of ids || []) taskManager.forget(String(id));
    res.json({ code: 200, data: { removed }, message: `已删除 ${removed} 条记录` });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});

// 删除单条历史记录
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const r = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    taskManager.forget(req.params.id || '');
    res.json({ code: 200, data: { removed: r.changes || 0 }, message: '已删除' });
  } catch (e) {
    res.status(500).json({ code: 500, message: errorMessage(e) });
  }
});
