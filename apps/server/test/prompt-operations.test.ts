import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ArtifactVersionSchema, SkillPackageVersionSchema } from '@aigc-director/contracts'
import { DirectorDatabase } from '../src/db/database.js'
import { PromptOperationsService } from '../src/services/promptOperationsService.js'

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

describe('Prompt、Artifact 与 Skill 版本运营', () => {
  let database: DirectorDatabase
  let service: PromptOperationsService

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-prompt-operations-'))
    database = new DirectorDatabase(join(directory, 'director.sqlite'))
    service = new PromptOperationsService(database)
  })

  afterEach(() => database.close())

  it('双语 Prompt diff、last-known-good 与发布门禁均追加 revision', () => {
    const first = service.createPromptRevision({
      stableKey: 'script.scene-writer', title: '场景编剧', role: 'execution',
      languageDrafts: { original: '为 {{topic}} 写场景', zhReview: '为 {{topic}} 写场景', enExecution: 'Write a scene about {{topic}}' },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
      outputSchema: { type: 'object', required: ['scene'] },
    })
    const second = service.createPromptRevision({
      stableKey: first.stableKey, title: first.title, role: first.role,
      languageDrafts: { ...first.languageDrafts, zhReview: '围绕 {{topic}} 写一个可拍摄场景' }, feedback: '增加可拍摄性',
      variablesSchema: first.variablesSchema, outputSchema: first.outputSchema,
    })
    expect(service.diffPrompt(first.id, second.id).changes.map((change) => change.field)).toEqual(expect.arrayContaining(['zhReview', 'feedback']))
    expect(() => service.compilePrompt(second.id, {})).toThrow('PROMPT_VARIABLE_MISSING')
    expect(service.compilePrompt(second.id, { topic: '雨夜车站' }).enExecution).toContain('雨夜车站')
    expect(() => service.publishPrompt(second.id)).toThrow('PROMPT_PUBLISH_GATE_FAILED')
    service.evaluateGolden({
      targetType: 'prompt', targetVersionId: second.id, name: '场景结构', input: { topic: '雨夜' },
      expectedSchema: { required: ['scene'] }, fakeOutput: { scene: { title: '相遇' } },
    })
    const published = service.publishPrompt(second.id)
    expect(published).toMatchObject({ revision: 3, status: 'published', parentRevisionId: second.id })
    const restored = service.restorePrompt(first.id)
    expect(restored).toMatchObject({ revision: 4, status: 'draft' })
    expect(database.getPromptRevision(first.id)?.status).toBe('draft')
  })

  it('项目 Prompt 润色固定父 revision、幂等复用并保留 last-known-good', () => {
    const project = database.createProject({ name: 'Prompt 润色' })
    const draft = service.createPromptRevision({
      projectId: project.id, stableKey: 'script.project-polish', title: '项目场景 Prompt', role: 'execution',
      languageDrafts: { original: '写 {{topic}}', zhReview: '写 {{topic}}', enExecution: 'Write {{topic}}' },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
      outputSchema: { type: 'object', required: ['scene'] }, source: 'project-override',
    })
    service.evaluateGolden({
      targetType: 'prompt', targetVersionId: draft.id, name: '结构输出', input: { topic: '雨夜' },
      expectedSchema: { required: ['scene'] }, fakeOutput: { scene: { title: '相遇' } },
    })
    const published = service.publishPrompt(draft.id)
    const input = {
      expectedRevision: published.revision,
      feedback: '保留原始约束，并强化空间调度',
      direction: 'cinematic' as const,
      idempotencyKey: 'prompt-polish-service-0001',
    }
    const polished = service.polishPrompt(published.id, input)
    expect(polished).toMatchObject({
      sourceRevisionId: published.id,
      revision: { revision: published.revision + 1, parentRevisionId: published.id, status: 'draft' },
      lastKnownGoodRevisionId: published.id,
      mode: 'demo-deterministic',
      reused: false,
    })
    expect(polished.diff.changes.map((change) => change.field)).toEqual(expect.arrayContaining(['zhReview', 'enExecution', 'feedback', 'modelPolicy', 'status']))
    expect(polished.revision.languageDrafts.zhReview).toContain(input.feedback)
    expect(service.polishPrompt(published.id, input)).toMatchObject({ revision: { id: polished.revision.id }, reused: true })
    expect(() => service.polishPrompt(published.id, { ...input, feedback: '不同输入' })).toThrow('PROMPT_POLISH_IDEMPOTENCY_CONFLICT')
    expect(() => service.polishPrompt(published.id, { ...input, idempotencyKey: 'prompt-polish-service-0002' })).toThrow('PROMPT_REVISION_CONFLICT')
  })

  it('Artifact rollback 追加新版本并用 CAS 更新 head', () => {
    const project = database.createProject({ name: 'Artifact 项目' })
    const now = new Date().toISOString()
    const scope = { type: 'project' as const, id: project.id }
    const first = ArtifactVersionSchema.parse({
      id: randomUUID(), projectId: project.id, workflow: { id: 'workflow.test', version: '1.0.0' },
      stageId: 'script', artifactType: 'SceneScript', revision: 1, scope, dependencies: [], content: { text: '第一版' },
      contentHash: hash({ text: '第一版' }), status: 'approved', createdAt: now, updatedAt: now,
    })
    const second = ArtifactVersionSchema.parse({
      ...first, id: randomUUID(), revision: 2, parentArtifactVersionId: first.id, content: { text: '第二版' },
      contentHash: hash({ text: '第二版' }), createdAt: now, updatedAt: now,
    })
    database.put('artifact_versions', project.id, first)
    database.put('artifact_versions', project.id, second)
    const rollback = service.rollbackArtifact(project.id, first.id, 2)
    expect(rollback).toMatchObject({ revision: 3, parentArtifactVersionId: second.id, content: { text: '第一版' } })
    expect(database.getArtifactHead(scope, 'SceneScript')).toMatchObject({ currentVersionId: rollback.id, expectedRevision: 3 })
    expect(() => service.rollbackArtifact(project.id, second.id, 2)).toThrow('ARTIFACT_HEAD_CONFLICT')
  })

  it('内置 Skill 只能 fork，资源类型和黄金样例共同决定可发布性', () => {
    const now = new Date().toISOString()
    const builtin = database.createSkillPackageVersion(SkillPackageVersionSchema.parse({
      id: randomUUID(), stableKey: 'skill.scene-blocking', version: '1.0.0',
      manifest: { id: randomUUID(), name: '场面调度', version: '1.0.0', description: '', entry: 'SKILL.md', resources: [], sha256: 'a'.repeat(64) },
      markdown: '# 场面调度\n保持轴线。', resources: [], trustLevel: 'builtin', status: 'published', source: 'builtin',
      contentHash: 'b'.repeat(64), createdAt: now, updatedAt: now,
    }))
    const forked = service.forkSkill(builtin.id)
    expect(forked).toMatchObject({ version: '1.0.1', parentVersionId: builtin.id, source: 'user-fork', status: 'draft' })
    expect(service.validateSkill(forked.id).valid).toBe(false)
    service.evaluateGolden({
      targetType: 'skill', targetVersionId: forked.id, name: '结构输出', input: {},
      expectedSchema: { required: ['steps'] }, fakeOutput: { steps: [] },
    })
    expect(service.validateSkill(forked.id)).toMatchObject({ valid: true, issues: [] })
    const published = service.publishSkill(forked.id)
    expect(published).toMatchObject({ version: '1.0.2', parentVersionId: forked.id, status: 'published' })
    const restored = service.rollbackSkill(builtin.id)
    expect(restored).toMatchObject({ version: '1.0.3', parentVersionId: builtin.id, status: 'draft', source: 'user-fork' })
    expect(database.getSkillPackageVersion(builtin.id)?.status).toBe('published')
  })
})
