import { getDb } from '../db'

export const ACTIONS: Readonly<Record<string, string>> = {
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
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 写日志失败不得阻断用户的主操作。 */
export function log(action: string, targetType: unknown, targetId: unknown, detail: unknown): void {
  try {
    const serialized = detail == null
      ? null
      : (typeof detail === 'string' ? detail : JSON.stringify(detail))
    getDb().prepare(
      `INSERT INTO op_logs (action, target_type, target_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(action, targetType || null, targetId == null ? null : String(targetId), serialized ?? null, Date.now())
  } catch (cause) {
    console.error('[opLog] 写日志失败:', errorMessage(cause))
  }
}

function safeParse(value: unknown): unknown {
  if (value == null) return null
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return value }
}

export function recent(limit = 100): Array<Record<string, unknown> & { action_label: string; detail: unknown }> {
  const rows = getDb().prepare('SELECT * FROM op_logs ORDER BY id DESC LIMIT ?')
    .all(Math.min(Number(limit) || 100, 500))
  return rows.map((row) => {
    const action = String(row.action || '')
    return {
      ...row,
      action_label: ACTIONS[action] || action,
      detail: safeParse(row.detail),
    }
  })
}
