import { ProjectSchema } from '@aigc-video/contracts'
import { z } from 'zod'

export type EntityId = string | number
export type ProjectStatus = 'draft' | 'generating' | 'partial' | 'ready' | 'failed' | 'completed' | string

const AssetHealthIssueSchema = z.object({
  level: z.string().optional(),
  code: z.string().optional(),
  message: z.string(),
}).passthrough()

const AssetHealthSchema = z.object({
  status: z.string().optional(),
  summary: z.string().optional(),
  issues: z.array(AssetHealthIssueSchema).optional(),
}).passthrough()

export const ProjectViewSchema = ProjectSchema.extend({
  script_content: z.string().nullish(),
  cover_url: z.string().nullish(),
  duration_min: z.number().nullish(),
  duration_max: z.number().nullish(),
  updated_at_ms: z.number().nullish(),
  ending_summary: z.string().nullish(),
  export_count: z.number().optional(),
  storyboard_count: z.number().optional(),
  asset_health: AssetHealthSchema.nullish(),
}).passthrough()
export type ProjectView = z.infer<typeof ProjectViewSchema>

export type ProjectTranslator = (key: string, values?: Record<string, unknown>) => string

export function projectStatusLabel(status: ProjectStatus | null | undefined, translate: ProjectTranslator): string {
  const labels: Record<string, string> = {
    draft: translate('projects.statusDraft'),
    generating: translate('projects.statusGenerating'),
    partial: translate('projects.statusPartial'),
    ready: translate('projects.statusReady'),
    failed: translate('projects.statusFailed'),
    completed: translate('projects.statusCompleted'),
  }
  return status ? labels[status] ?? translate('projects.statusDraft') : translate('projects.statusDraft')
}

export function projectAssetHealthStatus(project: ProjectView): 'ok' | 'warn' | 'error' | 'unknown' {
  const status = project.asset_health?.status
  return status === 'ok' || status === 'warn' || status === 'error' ? status : 'unknown'
}

export function projectAssetHealthLabel(project: ProjectView, translate: ProjectTranslator): string {
  const health = project.asset_health
  if (!health) return translate('projects.assetUnknown')
  if (health.status === 'ok') return translate('projects.assetOk')
  if (health.status === 'warn') return health.summary || translate('projects.assetWarn')
  if (health.status === 'error') {
    const issue = (health.issues ?? []).find((candidate) => candidate.level === 'error')
    if (issue?.code === 'MISSING_IMAGES') return translate('projects.assetMissingImages')
    if (issue?.code === 'FFMPEG_UNAVAILABLE') return translate('projects.assetFfmpegMissing')
    return health.summary || translate('projects.assetError')
  }
  return translate('projects.assetUnknown')
}

export function projectAssetHealthTitle(project: ProjectView, translate: ProjectTranslator): string {
  const issues = project.asset_health?.issues ?? []
  if (!issues.length) return projectAssetHealthLabel(project, translate)
  return issues.map((issue) => issue.message).join('\n')
}

export function parseProjectTimeMs(value: unknown): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value
  if (/^\d+$/.test(String(value))) return Number(value)
  const raw = String(value).trim()
  const sqlite = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if (sqlite) {
    const [, year, month, day, hour, minute, second] = sqlite
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export function projectTimeMs(project: ProjectView): number {
  return Number(project.updated_at_ms || 0)
    || parseProjectTimeMs(project.updated_at)
    || parseProjectTimeMs(project.created_at)
}

export function projectRelativeTime(
  project: ProjectView,
  translate: ProjectTranslator,
  now = Date.now(),
): string {
  const timeMs = projectTimeMs(project)
  if (!timeMs) return ''
  const seconds = Math.floor(Math.max(0, now - timeMs) / 1_000)
  if (seconds < 60) return translate('projects.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return translate('projects.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return translate('projects.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return translate('projects.daysAgo', { n: days })
  return translate('projects.monthsAgo', { n: Math.floor(days / 30) })
}

function hashString(value: unknown): number {
  let hash = 0
  const source = String(value || '未命名')
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

export function projectCoverGradient(name: unknown): { background: string } {
  const hash = hashString(name)
  const firstHue = hash % 360
  const secondHue = (firstHue + 40 + (hash % 60)) % 360
  return { background: `linear-gradient(135deg, hsl(${firstHue} 70% 58%), hsl(${secondHue} 72% 46%))` }
}

export function projectCoverInitial(name: unknown): string {
  const value = String(name || '').trim()
  return value ? value.slice(0, 1).toUpperCase() : '?'
}
