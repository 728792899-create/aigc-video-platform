import { getDb, type SqlRow } from '../db'
import { normalizeMediaReference } from './assetLibrary'

interface CandidateMetadata {
  prompt?: unknown
  referenceImageIds?: readonly unknown[]
  consistencyMode?: unknown
  taskId?: unknown
  provider?: unknown
  model?: unknown
  parentImageId?: unknown
}

function clean(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max)
}

export function annotateCandidate(id: unknown, metadata: CandidateMetadata = {}): SqlRow | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id)
  if (!row) return null
  const url = row.file_url || row.file_path || ''
  let mediaReference = row.media_reference || null
  if (!mediaReference && url) {
    mediaReference = JSON.stringify(normalizeMediaReference({
      kind: 'project_media',
      media_id: Number(row.id),
      url,
    }))
  }

  const inputSnapshot = JSON.stringify({
    prompt: clean(metadata.prompt || row.prompt, 12_000),
    reference_image_ids: [...new Set((metadata.referenceImageIds || []).map(Number).filter(Boolean))],
    consistency_mode: clean(metadata.consistencyMode, 40),
  })
  db.prepare(`UPDATE images SET task_id=?, provider=?, model=?, input_snapshot=?, media_reference=?,
    parent_image_id=?, updated_at=? WHERE id=?`).run(
    clean(metadata.taskId || row.task_id, 160),
    clean(metadata.provider || row.provider, 80),
    clean(metadata.model || row.model, 160),
    inputSnapshot,
    mediaReference,
    metadata.parentImageId == null ? row.parent_image_id : Number(metadata.parentImageId),
    Date.now(),
    row.id,
  )
  return db.prepare('SELECT * FROM images WHERE id = ?').get(row.id) || null
}

export function annotateCandidates(ids: readonly unknown[] = [], metadata: CandidateMetadata = {}): SqlRow[] {
  return ids.map((id) => annotateCandidate(id, metadata)).filter((row): row is SqlRow => Boolean(row))
}
