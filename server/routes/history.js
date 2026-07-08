/**
 * 历史记录中心 - 回溯所有生成任务（含已脱内存的长期记录）
 *
 * 数据源：tasks 表（taskManager 已软清理，DB 长期保留）。
 * GET  /api/history            - 分页查询，支持 type/status 筛选，附带项目名
 * POST /api/history/:id/retry  - 按 meta 重新发起同类任务（目前支持 auto-produce）
 * DELETE /api/history/:id       - 删除单条历史记录
 * DELETE /api/history           - 批量删除（{ ids: [] }）/ 清空终态（{ all: true }）
 */
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const taskManager = require('../services/taskManager');

// 安全 JSON 解析
function safeParse(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// 把一行 task 记录加工成前端友好结构（解析 meta/result，附项目名）
function enrich(row, projMap) {
  const meta = safeParse(row.meta, {});
  const result = safeParse(row.result, null);
  const projectId = meta.project_id || (result && result.project_id) || null;
  const diagnosis = meta.diagnosis || (result && (result.diagnosis || result.partialResult?.diagnosis)) || null;
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
    project_name: projectId != null ? (projMap[projectId] || null) : null,
    project_exists: projectId != null ? projMap[projectId] != null : false,
    result,
    diagnosis,
  };
}

module.exports = router;

// 分页列表：直接查 DB（长期记录），不走内存
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { type, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));

    const where = [];
    const params = [];
    if (type) { where.push('type = ?'); params.push(type); }
    if (status) { where.push('status = ?'); params.push(status); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare(`SELECT COUNT(*) AS n FROM tasks ${whereSql}`).get(...params).n;
    const rows = db.prepare(
      `SELECT * FROM tasks ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, (page - 1) * pageSize);

    // 一次性取项目名映射，避免 N+1
    const projRows = db.prepare('SELECT id, name FROM projects').all();
    const projMap = {};
    for (const p of projRows) projMap[p.id] = p.name;

    res.json({
      code: 200,
      data: {
        list: rows.map((r) => enrich(r, projMap)),
        page, pageSize, total,
      },
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

// 重新发起任务：目前支持 auto-produce（按原 theme/style 重跑一键成片）
router.post('/:id/retry', async (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, message: '历史记录不存在' });
    if (row.type !== 'auto-produce') {
      return res.status(400).json({ code: 400, message: '该任务类型暂不支持一键重试，请到对应页面重新操作' });
    }
    const meta = safeParse(row.meta, {});
    const theme = meta.theme;
    if (!theme) return res.status(400).json({ code: 400, message: '原任务缺少主题信息，无法重试' });

    // 复用 auto-produce：新建项目 + 任务 + 后台流水线
    const projName = theme.trim().slice(0, 30);
    const projRes = db.prepare(
      'INSERT INTO projects (name, theme, style, status) VALUES (?, ?, ?, ?)'
    ).run(projName, theme.trim(), meta.style || '写实', 'generating');
    const projectId = projRes.lastInsertRowid;
    const task = taskManager.create('auto-produce', { project_id: projectId, theme: theme.trim(), style: meta.style });
    res.json({ code: 200, data: { project_id: projectId, task_id: task.id }, message: '已重新发起一键成片' });

    const { runAutoProduce } = require('../services/pipeline');
    taskManager.start(task.id, '准备中…');
    runAutoProduce(
      { theme: theme.trim(), style: meta.style, projectId },
      (progress, message) => taskManager.progress(task.id, progress, message)
    )
      .then((result) => taskManager.succeed(task.id, result, '🎬 视频已生成'))
      .catch((err) => {
        try { db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('draft', projectId); } catch {}
        taskManager.fail(task.id, err);
      });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

// 批量删除 / 清空终态历史记录
router.delete('/', (req, res) => {
  try {
    const db = getDb();
    const { ids, all } = req.body || {};
    let removed = 0;
    if (all) {
      const r = db.prepare("DELETE FROM tasks WHERE status IN ('success','failed','interrupted')").run();
      removed = r.changes || 0;
    } else if (Array.isArray(ids) && ids.length) {
      const ph = ids.map(() => '?').join(',');
      const r = db.prepare(`DELETE FROM tasks WHERE id IN (${ph})`).run(...ids);
      removed = r.changes || 0;
    } else {
      return res.status(400).json({ code: 400, message: '请提供 ids 数组或 all=true' });
    }
    // 同步从内存卸载
    for (const id of ids || []) taskManager.tasks.delete(id);
    res.json({ code: 200, data: { removed }, message: `已删除 ${removed} 条记录` });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

// 删除单条历史记录
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const r = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    taskManager.tasks.delete(req.params.id);
    res.json({ code: 200, data: { removed: r.changes || 0 }, message: '已删除' });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});
