import { getDb } from '../db'

type EntityId = string | number
type JsonObject = Record<string, unknown>

function toEntityId(value: unknown): EntityId | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

interface CandidateRow extends JsonObject {
  id: EntityId
  storyboard_id: EntityId
  archived_at?: number | null
  favorite?: number
  stale?: boolean | number
  stale_reason?: string
}

interface StoryboardRow extends JsonObject {
  id: EntityId
  selected_image_id?: EntityId | null
}

interface CandidateReviewPatch {
  favorite?: boolean
  archived?: boolean
}

interface CandidateUpdate {
  favorite?: number
  archived_at?: number | null
  updated_at: number
}

interface CandidateRepository {
  getCandidate(id: EntityId): CandidateRow | null
  getStoryboard(id: EntityId): StoryboardRow | null
  selectCandidate(storyboardId: EntityId, candidateId: EntityId, selectedAt: number): CandidateRow
  updateReview(id: EntityId, patch: CandidateUpdate): CandidateRow
  transaction<T>(fn: () => T): T
}

export class CandidateReviewError extends Error {
  readonly code: string
  readonly details: JsonObject

  constructor(code: string, message: string, details: JsonObject = {}) {
    super(message)
    this.name = 'CandidateReviewError'
    this.code = code
    this.details = details
  }
}

function candidateError(code: string, message: string, details: JsonObject = {}): CandidateReviewError {
  return new CandidateReviewError(code, message, details)
}

export function shouldAutoSelectCandidate({
  currentSelectedId,
  explicitRepair = false,
}: { currentSelectedId?: EntityId | null; explicitRepair?: boolean } = {}): boolean {
  return !currentSelectedId || explicitRepair === true
}

export function resolveSelectedCandidateId({
  currentSelectedId,
  candidateId,
  canReplace = false,
}: { currentSelectedId?: EntityId | null; candidateId?: EntityId | null; canReplace?: boolean } = {}): number | null {
  if (currentSelectedId && !canReplace) return Number(currentSelectedId)
  return candidateId ? Number(candidateId) : null
}

export function createCandidateReviewService({
  repository,
  now = Date.now,
}: { repository: CandidateRepository; now?: () => number }) {
  if (!repository) throw new Error('candidate repository is required')

  function select({ storyboardId, candidateId }: { storyboardId?: EntityId; candidateId?: EntityId } = {}): CandidateRow {
    if (storyboardId === undefined || candidateId === undefined) throw candidateError('CANDIDATE_INPUT_INVALID', '缺少分镜或候选 ID')
    const storyboard = repository.getStoryboard(storyboardId)
    const candidate = repository.getCandidate(candidateId)
    if (!storyboard) throw candidateError('STORYBOARD_NOT_FOUND', '分镜不存在')
    if (!candidate || Number(candidate.storyboard_id) !== Number(storyboardId)) throw candidateError('CANDIDATE_INVALID', '候选不存在或不属于当前分镜')
    if (candidate.archived_at) throw candidateError('CANDIDATE_ARCHIVED', '已归档候选不能直接选用，请先恢复')
    return repository.transaction(() => repository.selectCandidate(storyboardId, candidateId, Number(now())))
  }

  function review(candidateId: EntityId, patch: CandidateReviewPatch = {}): CandidateRow {
    const candidate = repository.getCandidate(candidateId)
    if (!candidate) throw candidateError('CANDIDATE_NOT_FOUND', '候选不存在')
    const storyboard = repository.getStoryboard(candidate.storyboard_id)
    if (patch.archived === true && Number(storyboard?.selected_image_id) === Number(candidate.id)) {
      throw candidateError('CANDIDATE_IN_USE', '当前正在使用该候选，请先选择其他候选', { storyboard_id: candidate.storyboard_id })
    }
    const update: CandidateUpdate = { updated_at: Number(now()) }
    if (patch.favorite !== undefined) update.favorite = patch.favorite ? 1 : 0
    if (patch.archived !== undefined) update.archived_at = patch.archived ? Number(now()) : null
    return repository.updateReview(candidate.id, update)
  }

  return { select, review }
}

export function databaseRepository(): CandidateRepository {
  return {
    getCandidate(id) {
      const row = getDb().prepare('SELECT * FROM images WHERE id = ?').get(id)
      if (!row) return null
      const rowId = toEntityId(row.id)
      const storyboardId = toEntityId(row.storyboard_id)
      return rowId !== null && storyboardId !== null ? { ...row, id: rowId, storyboard_id: storyboardId } : null
    },
    getStoryboard(id) {
      const row = getDb().prepare('SELECT * FROM storyboards WHERE id = ?').get(id)
      if (!row) return null
      const rowId = toEntityId(row.id)
      return rowId !== null ? { ...row, id: rowId } : null
    },
    selectCandidate(storyboardId, candidateId, selectedAt) {
      const candidate = this.getCandidate(candidateId)
      if (!candidate) throw candidateError('CANDIDATE_NOT_FOUND', '候选不存在')
      getDb().prepare('UPDATE storyboards SET selected_image_id = ?, assets_stale = ?, stale_reason = ? WHERE id = ?')
        .run(candidateId, candidate.stale ? 1 : 0, candidate.stale ? (candidate.stale_reason || 'SELECTED_STALE_CANDIDATE') : null, storyboardId)
      getDb().prepare('UPDATE images SET selected_at = ?, updated_at = ? WHERE id = ?').run(selectedAt, selectedAt, candidateId)
      return this.getCandidate(candidateId) ?? candidate
    },
    updateReview(id, patch) {
      const current = this.getCandidate(id)
      if (!current) throw candidateError('CANDIDATE_NOT_FOUND', '候选不存在')
      getDb().prepare('UPDATE images SET favorite=?, archived_at=?, updated_at=? WHERE id=?')
        .run(patch.favorite === undefined ? current.favorite : patch.favorite,
          patch.archived_at === undefined ? current.archived_at : patch.archived_at,
          patch.updated_at, id)
      return this.getCandidate(id) ?? current
    },
    transaction<T>(fn: () => T): T { return getDb().transaction(fn)() },
  }
}

export const candidateReview = createCandidateReviewService({ repository: databaseRepository() })
