import crypto, { randomUUID } from 'node:crypto'
import { staleImpactForFields } from './staleDependencies'

export const STAGES = ['topic', 'script', 'storyboard', 'image', 'voice', 'subtitle', 'timeline', 'export'] as const
export type ArtifactStage = (typeof STAGES)[number]
type ArtifactStatus = 'current' | 'stale' | 'superseded' | 'failed' | 'partial' | 'archived'
type JsonObject = Record<string, unknown>

export interface StageArtifactRow extends JsonObject {
  id: string
  project_id: number
  task_id: string
  stage: ArtifactStage
  revision: number
  status: ArtifactStatus
  schema_version: string
  prompt_version: string
  provider: string
  model: string
  input_hash: string
  payload_hash: string
  dependency_snapshot: JsonObject
  payload: unknown
  stale_reason: string
  stale_fields: string[]
  stale_sources: string[]
  created_at: number
  updated_at: number
}

export interface StageArtifactRepository {
  rows?: StageArtifactRow[]
  list(projectId: number): StageArtifactRow[]
  get?(id: string): StageArtifactRow | null
  latest(projectId: number, stage: ArtifactStage): StageArtifactRow | null
  insert(row: StageArtifactRow): StageArtifactRow
  updateStatus(id: string, status: ArtifactStatus, staleReason: string, updatedAt: number, staleFields?: string[], staleSources?: string[]): void
  transaction<T>(fn: () => T): T
}

export interface PublishArtifactInput {
  projectId: string | number
  stage: ArtifactStage
  payload?: unknown
  inputHash?: string
  dependencySnapshot?: JsonObject
  taskId?: string | number
  schemaVersion?: string
  promptVersion?: string
  provider?: string
  model?: string
  changedFields?: string[]
  staleSources?: string[]
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStage(value: unknown): value is ArtifactStage {
  return typeof value === 'string' && STAGES.some((stage) => stage === value)
}

function isStatus(value: unknown): value is ArtifactStatus {
  return typeof value === 'string' && ['current', 'stale', 'superseded', 'failed', 'partial', 'archived'].includes(value)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (isJsonObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  return value
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (value == null || value === '') return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return fallback }
}

function stringArray(value: unknown): string[] {
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
}

function decode(row: unknown): StageArtifactRow | null {
  if (!isJsonObject(row) || !isStage(row.stage)) return null
  const projectId = Number(row.project_id)
  const revision = Number(row.revision)
  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(revision) || revision <= 0) return null
  const dependency = parseJson(row.dependency_snapshot, {})
  return {
    ...row,
    id: String(row.id || ''),
    project_id: projectId,
    task_id: String(row.task_id || ''),
    stage: row.stage,
    revision,
    status: isStatus(row.status) ? row.status : 'current',
    schema_version: String(row.schema_version || ''),
    prompt_version: String(row.prompt_version || ''),
    provider: String(row.provider || ''),
    model: String(row.model || ''),
    input_hash: String(row.input_hash || ''),
    payload_hash: String(row.payload_hash || ''),
    dependency_snapshot: isJsonObject(dependency) ? dependency : {},
    payload: parseJson(row.payload, null),
    stale_reason: String(row.stale_reason || ''),
    stale_fields: stringArray(row.stale_fields),
    stale_sources: stringArray(row.stale_sources),
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
  }
}

function requireDecoded(row: unknown): StageArtifactRow {
  const decoded = decode(row)
  if (!decoded) throw new Error('StageArtifact 数据库行格式无效')
  return decoded
}

function createDbRepository(): StageArtifactRepository {
  const { getDb } = require('../db')
  return {
    list(projectId) {
      return getDb().prepare('SELECT * FROM stage_artifacts WHERE project_id = ? ORDER BY created_at DESC, revision DESC')
        .all(projectId).map(requireDecoded)
    },
    get(id) {
      return decode(getDb().prepare('SELECT * FROM stage_artifacts WHERE id = ?').get(id))
    },
    latest(projectId, stage) {
      return decode(getDb().prepare('SELECT * FROM stage_artifacts WHERE project_id = ? AND stage = ? ORDER BY revision DESC LIMIT 1').get(projectId, stage))
    },
    insert(row) {
      getDb().prepare(
        `INSERT INTO stage_artifacts
          (id, project_id, task_id, stage, revision, status, schema_version, prompt_version,
           provider, model, input_hash, payload_hash, dependency_snapshot, payload,
           stale_reason, stale_fields, stale_sources, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id, row.project_id, row.task_id, row.stage, row.revision, row.status,
        row.schema_version, row.prompt_version, row.provider, row.model, row.input_hash,
        row.payload_hash, JSON.stringify(row.dependency_snapshot), JSON.stringify(row.payload ?? null),
        row.stale_reason, JSON.stringify(row.stale_fields), JSON.stringify(row.stale_sources), row.created_at, row.updated_at,
      )
      return row
    },
    updateStatus(id, status, staleReason, updatedAt, staleFields = [], staleSources = []) {
      getDb().prepare('UPDATE stage_artifacts SET status = ?, stale_reason = ?, stale_fields = ?, stale_sources = ?, updated_at = ? WHERE id = ?')
        .run(status, staleReason || '', JSON.stringify(staleFields), JSON.stringify(staleSources), updatedAt, id)
    },
    transaction<T>(fn: () => T): T { return getDb().transaction(fn)() },
  }
}

export function createStageArtifactService({
  repository = createDbRepository(),
  now = Date.now,
  idFactory = randomUUID,
}: { repository?: StageArtifactRepository; now?: () => number; idFactory?: () => string } = {}) {
  function list(projectId: string | number): StageArtifactRow[] {
    return repository.list(Number(projectId)).map(requireDecoded)
  }

  function get(id: string): StageArtifactRow | null {
    if (repository.get) return decode(repository.get(id))
    return decode(repository.rows?.find((row) => row.id === id))
  }

  function latest(projectId: string | number, stage: ArtifactStage): StageArtifactRow | null {
    return decode(repository.latest(Number(projectId), stage))
  }

  function publish(input: PublishArtifactInput): StageArtifactRow {
    const projectId = Number(input.projectId)
    const stageIndex = STAGES.indexOf(input.stage)
    if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('StageArtifact 缺少有效 projectId')
    if (stageIndex < 0) throw new Error(`StageArtifact 不支持阶段: ${input.stage}`)
    const payloadHash = hash(input.payload ?? null)
    const dependencySnapshot = input.dependencySnapshot || {}
    const dependencyHash = hash(dependencySnapshot)
    const inputHash = String(input.inputHash || hash({ payloadHash, dependencyHash }))

    return repository.transaction(() => {
      const previous = latest(projectId, input.stage)
      if (previous?.status === 'current'
        && previous.input_hash === inputHash
        && previous.payload_hash === payloadHash
        && hash(previous.dependency_snapshot) === dependencyHash) return previous

      const timestamp = Number(now())
      if (previous && ['current', 'stale'].includes(previous.status)) repository.updateStatus(previous.id, 'superseded', '', timestamp)
      const reason = `upstream ${input.stage} revision changed`
      const changedFields = Array.from(new Set((input.changedFields || []).map(String))).sort()
      const affectedStages = new Set(staleImpactForFields(changedFields))
      for (const artifact of list(projectId)) {
        if (STAGES.indexOf(artifact.stage) > stageIndex && artifact.status === 'current'
          && (!changedFields.length || affectedStages.has(artifact.stage as never))) {
          repository.updateStatus(artifact.id, 'stale', reason, timestamp, changedFields, input.staleSources || [])
        }
      }

      const row: StageArtifactRow = {
        id: String(idFactory()),
        project_id: projectId,
        task_id: input.taskId ? String(input.taskId) : '',
        stage: input.stage,
        revision: (previous?.revision || 0) + 1,
        status: 'current',
        schema_version: String(input.schemaVersion || ''),
        prompt_version: String(input.promptVersion || ''),
        provider: String(input.provider || ''),
        model: String(input.model || ''),
        input_hash: inputHash,
        payload_hash: payloadHash,
        dependency_snapshot: dependencySnapshot,
        payload: input.payload ?? null,
        stale_reason: '',
        stale_fields: [],
        stale_sources: [],
        created_at: timestamp,
        updated_at: timestamp,
      }
      repository.insert(row)
      return row
    })
  }

  return { STAGES, get, list, latest, publish }
}

const defaultService = createStageArtifactService()
export const hashArtifactInput = hash
export const get = defaultService.get
export const list = defaultService.list
export const latest = defaultService.latest
export const publish = defaultService.publish
