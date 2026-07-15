import { createHash } from 'node:crypto'
import {
  DirectorAdvicePlanSchema,
  type DirectorAdviceAction,
  type DirectorAdviceEvidence,
  type DirectorAdvicePlan,
} from '@aigc-video/contracts'

import { getDb, type SqlRow } from '../db'

const RUNNING = new Set(['pending', 'waiting', 'queued', 'running', 'composing', 'retrying', 'reconciling'])
const FAILED = new Set(['failed', 'partial', 'timed_out', 'orphaned'])

function count(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function taskBelongsToProject(row: SqlRow, projectId: number): boolean {
  try {
    const meta = JSON.parse(text(row.meta) || '{}') as unknown
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false
    const candidate = meta as Record<string, unknown>
    return String(candidate.project_id ?? candidate.projectId ?? '') === String(projectId)
  } catch {
    return false
  }
}

function action(
  id: string,
  stage: DirectorAdviceAction['stage'],
  operation: DirectorAdviceAction['operation'],
  title: string,
  reason: string,
  route: string,
  priority: number,
  risk: DirectorAdviceAction['risk'] = 'none',
): DirectorAdviceAction {
  return { id: `advice:${id}`, stage, operation, title, reason, route, priority, risk, requires_confirmation: risk === 'cost' }
}

function healthScore(project: SqlRow, evidence: DirectorAdviceEvidence): number {
  const shots = Math.max(evidence.shots, 1)
  const score =
    (text(project.theme) ? 10 : 0)
    + (text(project.script_content) || evidence.shots ? 15 : 0)
    + (evidence.shots ? 15 : 0)
    + Math.round(20 * Math.min(1, evidence.selected_visuals / shots))
    + Math.round(10 * Math.min(1, evidence.voiced_shots / shots))
    + Math.round(10 * Math.min(1, evidence.subtitled_shots / shots))
    + (evidence.exports ? 20 : 0)
  return Math.max(0, Math.min(100, score))
}

export function buildDirectorAdvice(projectId: number, now = Date.now()): DirectorAdvicePlan {
  const db = getDb()
  const project = db.prepare('SELECT id, theme, script_content FROM projects WHERE id = ?').get(projectId)
  if (!project) throw Object.assign(new Error('项目不存在'), { code: 'PROJECT_NOT_FOUND', status: 404 })

  const shotRow = db.prepare(`SELECT
      COUNT(*) AS shots,
      SUM(CASE WHEN selected_image_id IS NOT NULL THEN 1 ELSE 0 END) AS selected_visuals,
      SUM(CASE WHEN no_voice = 1 OR (audio_url IS NOT NULL AND audio_url != '') THEN 1 ELSE 0 END) AS voiced_shots,
      SUM(CASE WHEN subtitle_text IS NOT NULL AND subtitle_text != '' THEN 1 ELSE 0 END) AS subtitled_shots
    FROM storyboards WHERE project_id = ?`).get(projectId) || {}
  const tasks = db.prepare('SELECT status, meta FROM tasks ORDER BY updated_at DESC LIMIT 500').all()
    .filter((row) => taskBelongsToProject(row, projectId))
  const evidence: DirectorAdviceEvidence = {
    shots: count(shotRow.shots),
    selected_visuals: count(shotRow.selected_visuals),
    voiced_shots: count(shotRow.voiced_shots),
    subtitled_shots: count(shotRow.subtitled_shots),
    asset_units: count(db.prepare('SELECT COUNT(*) AS count FROM asset_units WHERE project_id = ? AND status != ?').get(projectId, 'archived')?.count),
    active_skills: count(db.prepare('SELECT COUNT(*) AS count FROM skills WHERE enabled = 1 AND deleted_at = 0').get()?.count),
    failed_tasks: tasks.filter((row) => FAILED.has(text(row.status))).length,
    running_tasks: tasks.filter((row) => RUNNING.has(text(row.status))).length,
    exports: count(db.prepare(`SELECT COUNT(*) AS count FROM exports
      WHERE project_id = ? AND status IN ('success', 'completed', 'ready')
        AND (file_url IS NOT NULL OR file_path IS NOT NULL)`).get(projectId)?.count),
  }

  const route = (suffix: string) => `/projects/${projectId}/${suffix}`
  const actions: DirectorAdviceAction[] = []
  if (evidence.failed_tasks) actions.push(action(
    'diagnose-task', 'timeline', 'diagnose-task', '先诊断失败任务',
    `${evidence.failed_tasks} 个任务需要核对；重试前保留失败证据并确认远端结果。`, '/history', 100, 'review',
  ))
  if (!text(project.theme)) actions.push(action(
    'edit-brief', 'topic', 'edit-brief', '补全创作主题', '主题是后续剧本与视觉约束的来源。', route('script'), 95,
  ))
  if (!text(project.script_content) && !evidence.shots) actions.push(action(
    'edit-script', 'script', 'edit-script', '完成结构化剧本', '当前还没有可验证的剧本产物。', route('script'), 90,
  ))
  if (!evidence.shots) actions.push(action(
    'plan-shots', 'storyboard', 'plan-shots', '拆解分镜与镜头', '至少需要一个镜头才能进入媒体生成。', route('script'), 85,
  ))
  if (evidence.shots && evidence.selected_visuals < evidence.shots) actions.push(action(
    'review-visuals', 'visuals', 'review-visuals', '补齐并评审画面候选',
    `${evidence.shots - evidence.selected_visuals} 个镜头尚未选定画面。`, route('images'), 80, 'cost',
  ))
  if (!evidence.asset_units && (text(project.script_content) || evidence.shots)) actions.push(action(
    'design-assets', 'assets', 'design-assets', '建立可复用视觉资产', '角色、场景和风格版本可降低跨镜头漂移。', route('images'), 70, 'review',
  ))
  if (evidence.shots && evidence.voiced_shots < evidence.shots) actions.push(action(
    'complete-audio', 'voice', 'complete-audio', '补齐配音',
    `${evidence.shots - evidence.voiced_shots} 个镜头尚未完成配音或明确静音。`, route('audio'), 65, 'cost',
  ))
  if (evidence.shots && evidence.subtitled_shots < evidence.shots) actions.push(action(
    'complete-subtitles', 'subtitle', 'complete-subtitles', '检查字幕',
    `${evidence.shots - evidence.subtitled_shots} 个镜头尚未确认字幕。`, route('audio'), 60, 'review',
  ))
  if (evidence.shots && evidence.selected_visuals === evidence.shots && !evidence.exports) actions.push(action(
    'review-timeline', 'timeline', 'review-timeline', '预览时间线', '合成前检查画面、声音、字幕和节奏。', route('preview'), 50, 'review',
  ))
  if (evidence.shots && !evidence.exports) actions.push(action(
    'export-video', 'export', 'export-video', '导出成片', '导出会在明确确认后启动本地 FFmpeg 任务。', route('preview'), 40, 'cost',
  ))
  actions.sort((a, b) => b.priority - a.priority)

  const score = healthScore(project, evidence)
  const summary = evidence.running_tasks
    ? `${evidence.running_tasks} 个任务正在运行；建议等待实时状态更新后再决定下一步。`
    : actions[0]?.reason || '核心制作阶段已完成，可检查导出结果与项目备份。'
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ projectId, score, evidence, actions: actions.map((item) => item.id) }))
    .digest('hex')
    .slice(0, 16)

  return DirectorAdvicePlanSchema.parse({
    schema_version: 1,
    plan_id: `director:${fingerprint}`,
    project_id: projectId,
    generated_at: now,
    health_score: score,
    summary,
    evidence,
    actions,
    next_action_id: actions[0]?.id ?? null,
  })
}
