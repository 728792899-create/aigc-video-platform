import crypto, { randomUUID } from 'node:crypto'

import type { PromptKind, PromptRevisionCreate } from '@aigc-video/contracts'
import { getDb } from '../db'

export interface PromptRevision {
  id: string
  project_id: number
  storyboard_id: number | null
  kind: PromptKind
  revision: number
  parent_revision_id: string | null
  source: string
  prompt_version: string
  provider: string
  model: string
  content: string
  negative_content: string
  content_hash: string
  created_at: number
}

export interface PromptRevisionRepository {
  list(projectId: number, storyboardId: number | null, kind?: PromptKind): PromptRevision[]
  get(id: string): PromptRevision | null
  insert(row: PromptRevision): PromptRevision
  transaction<T>(operation: () => T): T
}

type CreateInput = Omit<PromptRevisionCreate, 'negative_content' | 'prompt_version' | 'provider' | 'model'> & {
  project_id: number
  negative_content?: string
  prompt_version?: string
  provider?: string
  model?: string
}

function hash(content: string, negativeContent: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({ content, negativeContent })).digest('hex')
}

function row(value: Record<string, unknown> | undefined): PromptRevision | null {
  if (!value) return null
  return {
    id: String(value.id), project_id: Number(value.project_id),
    storyboard_id: value.storyboard_id == null ? null : Number(value.storyboard_id),
    kind: String(value.kind) as PromptKind, revision: Number(value.revision),
    parent_revision_id: value.parent_revision_id == null ? null : String(value.parent_revision_id),
    source: String(value.source || 'manual'), prompt_version: String(value.prompt_version || ''),
    provider: String(value.provider || ''), model: String(value.model || ''), content: String(value.content || ''),
    negative_content: String(value.negative_content || ''), content_hash: String(value.content_hash || ''),
    created_at: Number(value.created_at) || 0,
  }
}

function databaseRepository(): PromptRevisionRepository {
  return {
    list(projectId, storyboardId, kind) {
      const clauses = ['project_id = ?', 'storyboard_id IS ?']
      const params: unknown[] = [projectId, storyboardId]
      if (kind) { clauses.push('kind = ?'); params.push(kind) }
      return getDb().prepare(`SELECT * FROM prompt_revisions WHERE ${clauses.join(' AND ')} ORDER BY revision DESC`)
        .all(...params).map((value) => row(value)).filter((value): value is PromptRevision => value !== null)
    },
    get(id) { return row(getDb().prepare('SELECT * FROM prompt_revisions WHERE id = ?').get(id)) },
    insert(value) {
      getDb().prepare(`INSERT INTO prompt_revisions
        (id, project_id, storyboard_id, kind, revision, parent_revision_id, source, prompt_version,
         provider, model, content, negative_content, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(value.id, value.project_id, value.storyboard_id, value.kind, value.revision, value.parent_revision_id,
          value.source, value.prompt_version, value.provider, value.model, value.content, value.negative_content,
          value.content_hash, value.created_at)
      return value
    },
    transaction(operation) { return getDb().transaction(operation)() },
  }
}

export function diffPromptLines(before: string, after: string): Array<{ type: 'same' | 'added' | 'removed'; line: string }> {
  const left = before.split('\n')
  const right = after.split('\n')
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))
  const cell = (row: number, column: number): number => matrix[row]?.[column] ?? 0
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i]![j] = left[i] === right[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1))
    }
  }
  const lines: Array<{ type: 'same' | 'added' | 'removed'; line: string }> = []
  let i = 0; let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      lines.push({ type: 'same', line: left[i] || '' }); i += 1; j += 1
    } else if (i < left.length && (j >= right.length || cell(i + 1, j) >= cell(i, j + 1))) {
      lines.push({ type: 'removed', line: left[i] || '' }); i += 1
    } else if (j < right.length) {
      lines.push({ type: 'added', line: right[j] || '' }); j += 1
    }
  }
  return lines
}

export function createPromptRevisionService({
  repository = databaseRepository(), now = Date.now, idFactory = randomUUID,
}: { repository?: PromptRevisionRepository; now?: () => number; idFactory?: () => string } = {}) {
  function list(projectId: number, storyboardId: number | null, kind?: PromptKind): PromptRevision[] {
    return repository.list(projectId, storyboardId, kind)
  }

  function create(input: CreateInput): PromptRevision {
    const projectId = Number(input.project_id)
    const storyboardId = input.storyboard_id == null ? null : Number(input.storyboard_id)
    const history = repository.list(projectId, storyboardId, input.kind)
    const parent = input.parent_revision_id ? repository.get(input.parent_revision_id) : history[0] || null
    if (parent && (parent.project_id !== projectId || parent.storyboard_id !== storyboardId || parent.kind !== input.kind)) {
      throw Object.assign(new Error('父 Prompt revision 不属于相同作用域和类型'), { code: 'PROMPT_PARENT_INVALID' })
    }
    return repository.transaction(() => repository.insert({
      id: String(idFactory()), project_id: projectId, storyboard_id: storyboardId, kind: input.kind,
      revision: (history[0]?.revision || 0) + 1, parent_revision_id: parent?.id || null,
      source: input.source || 'manual', prompt_version: input.prompt_version || '',
      provider: input.provider || '', model: input.model || '', content: input.content,
      negative_content: input.negative_content || '', content_hash: hash(input.content, input.negative_content || ''),
      created_at: Number(now()),
    }))
  }

  function restore(id: string): PromptRevision {
    const source = repository.get(id)
    if (!source) throw Object.assign(new Error('Prompt revision 不存在'), { code: 'PROMPT_REVISION_NOT_FOUND' })
    return create({ ...source, source: 'restore', parent_revision_id: source.id })
  }

  function diff(id: string, againstId?: string) {
    const current = repository.get(id)
    if (!current) throw Object.assign(new Error('Prompt revision 不存在'), { code: 'PROMPT_REVISION_NOT_FOUND' })
    const against = againstId ? repository.get(againstId) : current.parent_revision_id ? repository.get(current.parent_revision_id) : null
    if (against && (against.project_id !== current.project_id || against.storyboard_id !== current.storyboard_id || against.kind !== current.kind)) {
      throw Object.assign(new Error('只能比较相同作用域和类型的 Prompt'), { code: 'PROMPT_DIFF_SCOPE_MISMATCH' })
    }
    return { current, against, lines: diffPromptLines(against?.content || '', current.content) }
  }

  return { create, diff, list, restore, get: repository.get.bind(repository) }
}

export const promptRevisions = createPromptRevisionService()
