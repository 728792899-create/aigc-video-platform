import crypto, { randomUUID } from 'node:crypto'

import type { DbClient } from '../db'

type JsonObject = Record<string, unknown>

export const STORYBOARD_FIELDS = [
  'description', 'dialog', 'duration', 'prompt', 'voice', 'no_voice', 'transition', 'motion',
  'subtitle_text', 'subtitle_style', 'characters_in_scene', 'continuity_notes',
  'scene_state_before', 'scene_state_after', 'style', 'visual_binding', 'music',
] as const
export type StoryboardField = (typeof STORYBOARD_FIELDS)[number]
export type StaleStage = 'image' | 'video' | 'voice' | 'subtitle' | 'timeline' | 'export'

const VISUAL = new Set<StoryboardField>(['description', 'prompt', 'style', 'visual_binding', 'characters_in_scene'])
const VOICE = new Set<StoryboardField>(['dialog', 'voice', 'no_voice'])
const SUBTITLE = new Set<StoryboardField>(['dialog', 'subtitle_text', 'subtitle_style', 'duration', 'no_voice'])
const ASSEMBLY = new Set<StoryboardField>(['duration', 'transition', 'motion', 'music'])
const ORDER: StaleStage[] = ['image', 'video', 'voice', 'subtitle', 'timeline', 'export']

function stable(value: unknown): unknown {
  if (typeof value === 'string') {
    const text = value.trim()
    if (/^[\[{]/.test(text)) {
      try { return stable(JSON.parse(text)) } catch { return text }
    }
    return text
  }
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const row = value as JsonObject
    return Object.fromEntries(Object.keys(row).sort().map((key) => [key, stable(row[key])]))
  }
  return value ?? null
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

export function changedStoryboardFields(before: JsonObject, after: JsonObject): StoryboardField[] {
  return STORYBOARD_FIELDS.filter((field) => (
    after[field] !== undefined && JSON.stringify(stable(before[field])) !== JSON.stringify(stable(after[field]))
  ))
}

export function staleImpactForFields(fields: readonly string[]): StaleStage[] {
  const changed = new Set(fields.filter((field): field is StoryboardField => STORYBOARD_FIELDS.includes(field as StoryboardField)))
  const stages = new Set<StaleStage>()
  if ([...changed].some((field) => VISUAL.has(field))) { stages.add('image'); stages.add('video') }
  if ([...changed].some((field) => VOICE.has(field))) stages.add('voice')
  if ([...changed].some((field) => SUBTITLE.has(field))) stages.add('subtitle')
  if (stages.size || [...changed].some((field) => ASSEMBLY.has(field))) { stages.add('timeline'); stages.add('export') }
  return ORDER.filter((stage) => stages.has(stage))
}

export function recordStoryboardFieldRevision(db: DbClient, input: {
  storyboardId: number
  projectId: number
  changedFields: readonly string[]
  snapshot: JsonObject
  source?: string
  now?: number
}): { id: string; revision: number; changed_fields: string[] } {
  const changedFields = Array.from(new Set(input.changedFields.map(String))).sort()
  const previous = db.prepare('SELECT MAX(revision) AS revision FROM storyboard_field_revisions WHERE storyboard_id = ?')
    .get(input.storyboardId)
  const revision = Number(previous?.revision || 0) + 1
  const fieldHashes = Object.fromEntries(changedFields.map((field) => [field, hash(input.snapshot[field])]))
  const id = randomUUID()
  db.prepare(`INSERT INTO storyboard_field_revisions
    (id, storyboard_id, project_id, revision, changed_fields, field_hashes, snapshot, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.storyboardId, input.projectId, revision, JSON.stringify(changedFields),
      JSON.stringify(fieldHashes), JSON.stringify(stable(input.snapshot)), input.source || 'manual', input.now || Date.now())
  return { id, revision, changed_fields: changedFields }
}
