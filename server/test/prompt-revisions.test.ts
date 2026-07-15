import assert from 'node:assert/strict'
import test from 'node:test'

import { createPromptRevisionService, type PromptRevision, type PromptRevisionRepository } from '../services/promptRevisions'

function memoryRepository(): PromptRevisionRepository & { rows: PromptRevision[] } {
  const rows: PromptRevision[] = []
  return {
    rows,
    list(projectId, storyboardId, kind) {
      return rows.filter((row) => row.project_id === projectId
        && row.storyboard_id === storyboardId && (!kind || row.kind === kind)).sort((a, b) => b.revision - a.revision)
    },
    get(id) { return rows.find((row) => row.id === id) || null },
    insert(row) { rows.push({ ...row }); return { ...row } },
    transaction(operation) { return operation() },
  }
}

test('Prompt revision 不可变递增，恢复旧版本会创建新 revision', () => {
  const repository = memoryRepository()
  let id = 0
  const service = createPromptRevisionService({ repository, idFactory: () => `prompt-${++id}`, now: () => 1000 + id })
  const first = service.create({ project_id: 3, storyboard_id: 11, kind: 'image', content: '雨夜车站', source: 'manual' })
  const second = service.create({ project_id: 3, storyboard_id: 11, kind: 'image', content: '雨夜车站，蓝调光线', source: 'polish' })
  const restored = service.restore(first.id)
  assert.deepEqual([first.revision, second.revision, restored.revision], [1, 2, 3])
  assert.equal(restored.content, first.content)
  assert.equal(restored.parent_revision_id, first.id)
  assert.equal(restored.source, 'restore')
  assert.equal(repository.rows[1]!.content, '雨夜车站，蓝调光线')
})

test('Prompt diff 返回稳定 added/removed/same 行', () => {
  const repository = memoryRepository()
  let id = 0
  const service = createPromptRevisionService({ repository, idFactory: () => `diff-${++id}` })
  const first = service.create({ project_id: 3, storyboard_id: 11, kind: 'image', content: '远景\n雨夜\n车站', source: 'manual' })
  const second = service.create({ project_id: 3, storyboard_id: 11, kind: 'image', content: '远景\n蓝色雨夜\n车站', source: 'polish' })
  assert.deepEqual(service.diff(second.id, first.id).lines, [
    { type: 'same', line: '远景' },
    { type: 'removed', line: '雨夜' },
    { type: 'added', line: '蓝色雨夜' },
    { type: 'same', line: '车站' },
  ])
})
