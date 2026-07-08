const { getDb } = require('../db');

// 操作日志服务 — 记录关键操作（创建/删除/还原/生成/配置变更）。
// 写日志永远不该阻断主流程，任何异常吞掉只打印。
const ACTIONS = {
  'project.create': '创建项目',
  'project.update': '更新项目',
  'project.delete': '删除项目',
  'project.restore': '还原项目',
  'project.purge': '彻底删除项目',
  'storyboard.create': '创建分镜',
  'storyboard.update': '更新分镜',
  'storyboard.delete': '删除分镜',
  'auto-produce.start': '启动一键成片',
  'file.delete': '删除文件',
  'file.restore': '还原文件',
  'file.purge': '彻底删除文件',
  'history.delete': '删除历史记录',
  'history.retry': '重试任务',
  'settings.update': '修改配置',
  'settings.import': '导入配置',
  'backup.restore': '还原备份',
  'trash.empty': '清空回收站',
};

/** 写一条操作日志。action 为枚举键，detail 可为对象（会 JSON 化）。 */
function log(action, targetType, targetId, detail) {
  try {
    const d = detail == null ? null
      : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    getDb().prepare(
      `INSERT INTO op_logs (action, target_type, target_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(action, targetType || null, targetId == null ? null : String(targetId), d, Date.now());
  } catch (e) {
    console.error('[opLog] 写日志失败:', e.message);
  }
}

/** 读最近 N 条日志（倒序），附中文动作名 */
function recent(limit = 100) {
  const rows = getDb().prepare(
    `SELECT * FROM op_logs ORDER BY id DESC LIMIT ?`
  ).all(Math.min(Number(limit) || 100, 500));
  return rows.map(r => ({
    ...r,
    action_label: ACTIONS[r.action] || r.action,
    detail: safeParse(r.detail),
  }));
}

function safeParse(s) {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return s; }
}

module.exports = { log, recent, ACTIONS };
