import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArtifactVersion, PromptDiff, PromptPolishResult, PromptRevision, ScenePatchApplyResult, ScopedRegenerationResult, Shot } from '@aigc-director/contracts'
import { createDirectorApp } from '../src/http/app.js'
import { inject, jsonBody, type InjectResponse } from './http-inject.js'

const token = 'prompt-api-session-token-with-enough-entropy'
const auth = { authorization: `Bearer ${token}` }
type Runtime = ReturnType<typeof createDirectorApp>

async function api<T>(runtime: Runtime, method: string, path: string, body?: unknown): Promise<InjectResponse<{ ok: true; data: T }>> {
  const payload = body === undefined ? { headers: {} as Record<string, string> } : jsonBody(body)
  return await inject(runtime.app, { method, path, headers: { ...auth, ...payload.headers }, ...('body' in payload ? { body: payload.body } : {}) })
}

describe('Prompt/Skill/Artifact API v2', () => {
  let runtime: Runtime

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-prompt-api-'))
    runtime = createDirectorApp({ databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token })
  })

  afterEach(() => {
    runtime.io.disconnectSockets(true)
    runtime.io.removeAllListeners()
    runtime.httpServer.removeAllListeners()
    runtime.db.close()
  })

  it('创建、diff、黄金样例和发布均保留 Prompt revision', async () => {
    const base = {
      stableKey: 'script.api-scene', title: 'API 场景编剧', role: 'execution',
      languageDrafts: { original: '写 {{topic}}', zhReview: '写 {{topic}}', enExecution: 'Write {{topic}}' },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } } }, outputSchema: { required: ['scene'] },
    }
    const first = (await api<PromptRevision>(runtime, 'POST', '/api/v2/prompt-definitions', base)).body.data
    const second = (await api<PromptRevision>(runtime, 'POST', '/api/v2/prompt-definitions', {
      ...base, languageDrafts: { ...base.languageDrafts, zhReview: '写可拍摄的 {{topic}}' }, feedback: '更可拍摄',
    })).body.data
    const diff = (await api<PromptDiff>(runtime, 'GET', `/api/v2/prompt-revisions/${first.id}/diff?to=${second.id}`)).body.data
    expect(diff.changes.map((change) => change.field)).toContain('zhReview')
    expect((await api(runtime, 'POST', `/api/v2/prompt-revisions/${second.id}/publish`)).status).toBe(409)
    expect((await api(runtime, 'POST', `/api/v2/prompt-revisions/${second.id}/evaluations`, {
      name: '结构输出', input: { topic: '雨夜' }, expectedSchema: { required: ['scene'] }, fakeOutput: { scene: {} },
    })).status).toBe(201)
    const published = (await api<PromptRevision>(runtime, 'POST', `/api/v2/prompt-revisions/${second.id}/publish`)).body.data
    expect(published).toMatchObject({ revision: 3, status: 'published' })
    expect((await api<PromptRevision[]>(runtime, 'GET', '/api/v2/prompt-definitions?stableKey=script.api-scene')).body.data).toHaveLength(3)
  })

  it('交互式润色只创建项目 draft，幂等重放不产生重复 revision', async () => {
    const project = runtime.db.createProject({ name: 'Prompt API 润色' })
    const base = {
      projectId: project.id, stableKey: 'script.api-polish', title: 'API 润色', role: 'execution',
      languageDrafts: { original: '写 {{topic}}', zhReview: '写 {{topic}}', enExecution: 'Write {{topic}}' },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } } }, outputSchema: { required: ['scene'] },
      source: 'project-override',
    }
    const draft = (await api<PromptRevision>(runtime, 'POST', '/api/v2/prompt-definitions', base)).body.data
    await api(runtime, 'POST', `/api/v2/prompt-revisions/${draft.id}/evaluations`, {
      name: '结构输出', input: { topic: '雨夜' }, expectedSchema: { required: ['scene'] }, fakeOutput: { scene: {} },
    })
    const published = (await api<PromptRevision>(runtime, 'POST', `/api/v2/prompt-revisions/${draft.id}/publish`)).body.data
    const request = {
      expectedRevision: published.revision, feedback: '强化雨夜空间关系', direction: 'cinematic',
      idempotencyKey: 'prompt-polish-api-idempotency-0001',
    }
    const polished = (await api<PromptPolishResult>(runtime, 'POST', `/api/v2/prompt-revisions/${published.id}/polish`, request)).body.data
    expect(polished).toMatchObject({ lastKnownGoodRevisionId: published.id, revision: { status: 'draft' }, reused: false })
    const repeated = (await api<PromptPolishResult>(runtime, 'POST', `/api/v2/prompt-revisions/${published.id}/polish`, request)).body.data
    expect(repeated).toMatchObject({ revision: { id: polished.revision.id }, reused: true })
    expect((await api(runtime, 'POST', `/api/v2/prompt-revisions/${published.id}/polish`, { ...request, feedback: '不同输入' })).status).toBe(409)
    expect((await api<PromptRevision[]>(runtime, 'GET', `/api/v2/prompt-definitions?stableKey=${base.stableKey}&projectId=${project.id}`)).body.data).toHaveLength(3)
  })

  it('Artifact rollback 在 API 边界执行 expected head revision CAS', async () => {
    const project = runtime.db.createProject({ name: 'Artifact API' })
    const now = new Date().toISOString()
    const firstId = randomUUID()
    runtime.db.put('artifact_versions', project.id, {
      id: firstId, projectId: project.id, workflow: { id: 'workflow.api', version: '1.0.0' }, stageId: 'script',
      artifactType: 'SceneScript', revision: 1, scope: { type: 'project', id: project.id }, dependencies: [],
      content: { text: 'v1' }, contentHash: 'a'.repeat(64), status: 'approved', createdAt: now, updatedAt: now,
    })
    const rolled = await api<{ revision: number }>(runtime, 'POST', `/api/v2/artifacts/project/${project.id}/rollback`, {
      projectId: project.id, targetVersionId: firstId, expectedHeadRevision: 1,
    })
    expect(rolled).toMatchObject({ status: 201, body: { data: { revision: 2 } } })
    expect((await api(runtime, 'POST', `/api/v2/artifacts/project/${project.id}/rollback`, {
      projectId: project.id, targetVersionId: firstId, expectedHeadRevision: 1,
    })).status).toBe(409)
    expect((await api(runtime, 'POST', `/api/v2/artifacts/project/${randomUUID()}/rollback`, {
      projectId: project.id, targetVersionId: firstId, expectedHeadRevision: 2,
    })).status).toBe(404)
  })

  it('局部重生成固定 Prompt/目标 revision，且只追加目标 Artifact 或 Candidate', async () => {
    const project = runtime.db.createProject({ name: '局部重生成' })
    runtime.service.importSource(project.id, {
      title: '双场景', content: '第一章\n雨夜车站收到来信。\n\n第二章\n清晨码头确认约定。',
    })
    const planned = runtime.service.createPlan(project.id, 'scoped-plan-idempotency-0001', runtime.memory.checkpointContext(project.id))
    runtime.service.approvePlan(planned.plan.id, planned.approvalToken)
    const before = runtime.db.snapshot(project.id)
    expect(before.scenes.length).toBeGreaterThanOrEqual(2)
    expect(before.shots.length).toBeGreaterThanOrEqual(2)

    const base = {
      projectId: project.id, stableKey: 'script.scoped-regeneration', title: '局部场景修订', role: 'execution',
      languageDrafts: { original: '润色 {{topic}}', zhReview: '只润色 {{topic}}', enExecution: 'Polish only {{topic}}' },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } } }, outputSchema: { required: ['result'] },
    }
    const draft = (await api<PromptRevision>(runtime, 'POST', '/api/v2/prompt-definitions', base)).body.data
    await api(runtime, 'POST', `/api/v2/prompt-revisions/${draft.id}/evaluations`, {
      name: '局部输出', input: { topic: '雨夜车站' }, expectedSchema: { required: ['result'] }, fakeOutput: { result: 'ok' },
    })
    const published = (await api<PromptRevision>(runtime, 'POST', `/api/v2/prompt-revisions/${draft.id}/publish`)).body.data

    const scene = before.scenes[0]!
    const sceneResult = (await api<ScopedRegenerationResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'scene', targetId: scene.id,
      variables: { topic: scene.title }, idempotencyKey: 'scoped-scene-regeneration-0001',
    })).body.data
    expect(sceneResult.task).toMatchObject({ status: 'succeeded', inputSnapshot: { promptBinding: {
      promptRevisionId: published.id, targetType: 'scene', targetId: scene.id, targetRevision: scene.revision,
    } } })
    expect(sceneResult.artifact).toMatchObject({ scope: { type: 'scene', id: scene.id }, artifactType: 'SceneScriptRevision', status: 'draft', content: { patch: { sceneId: scene.id, baseRevision: scene.revision } } })
    expect(runtime.db.snapshot(project.id).scenes).toEqual(before.scenes)
    expect(runtime.db.list<ArtifactVersion>('artifact_versions', project.id).filter((item) => item.scope.type === 'scene' && item.scope.id !== scene.id)).toHaveLength(0)

    const repeated = (await api<ScopedRegenerationResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'scene', targetId: scene.id,
      variables: { topic: scene.title }, idempotencyKey: 'scoped-scene-regeneration-0001',
    })).body.data
    expect(repeated).toMatchObject({ task: { id: sceneResult.task.id }, artifact: { id: sceneResult.artifact.id } })
    expect((await api(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'scene', targetId: scene.id,
      variables: { topic: '不同变量' }, idempotencyKey: 'scoped-scene-regeneration-0001',
    })).status).toBe(409)
    expect((await api(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'scene', targetId: before.scenes[1]!.id,
      variables: { topic: before.scenes[1]!.title }, idempotencyKey: 'scoped-scene-regeneration-0001',
    })).status).toBe(409)

    const revisionBeforeApply = runtime.db.getProject(project.id)!.graphRevision
    const applied = (await api<ScenePatchApplyResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scene-patches/${sceneResult.artifact.id}/apply`, {
      expectedProjectRevision: revisionBeforeApply, expectedSceneRevision: scene.revision,
      idempotencyKey: 'apply-scene-patch-idempotency-0001', confirmation: 'APPLY_SCENE_PATCH',
    })).body.data
    expect(applied).toMatchObject({ scene: { id: scene.id, synopsis: scene.title, revision: scene.revision + 1 }, artifact: { status: 'approved' }, reused: false })
    expect(applied.staleShotIds).toEqual(before.shots.filter((item) => item.sceneId === scene.id).map((item) => item.id))
    const afterApply = runtime.db.snapshot(project.id)
    expect(afterApply.scenes.find((item) => item.id === before.scenes[1]!.id)).toEqual(before.scenes[1])
    expect(afterApply.shots.filter((item) => item.sceneId === scene.id).every((item) => item.staleFields.includes('script.scene.synopsis'))).toBe(true)
    const reusedApply = (await api<ScenePatchApplyResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scene-patches/${sceneResult.artifact.id}/apply`, {
      expectedProjectRevision: revisionBeforeApply, expectedSceneRevision: scene.revision,
      idempotencyKey: 'apply-scene-patch-idempotency-0001', confirmation: 'APPLY_SCENE_PATCH',
    })).body.data
    expect(reusedApply).toMatchObject({ projectGraphRevision: applied.projectGraphRevision, reused: true })
    expect((await api(runtime, 'POST', `/api/v2/projects/${project.id}/scene-patches/${randomUUID()}/apply`, {
      expectedProjectRevision: revisionBeforeApply, expectedSceneRevision: scene.revision,
      idempotencyKey: 'apply-scene-patch-idempotency-0001', confirmation: 'APPLY_SCENE_PATCH',
    })).status).toBe(409)
    expect((await api(runtime, 'POST', `/api/v2/projects/${project.id}/scene-patches/${sceneResult.artifact.id}/apply`, {
      expectedProjectRevision: applied.projectGraphRevision, expectedSceneRevision: scene.revision + 1,
      idempotencyKey: 'apply-scene-patch-idempotency-0002', confirmation: 'APPLY_SCENE_PATCH',
    })).status).toBe(409)

    const shot = before.shots[0]!
    const shotResult = (await api<ScopedRegenerationResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scoped-regenerations`, {
      promptRevisionId: published.id, targetType: 'shot', targetId: shot.id,
      variables: { topic: shot.description }, idempotencyKey: 'scoped-shot-regeneration-0001',
    })).body.data
    expect(shotResult.candidate).toMatchObject({ shotId: shot.id, promptRevisionId: published.id, status: 'ready' })
    const after = runtime.db.snapshot(project.id)
    expect(after.shots.find((item) => item.id === shot.id)?.selectedCandidateId).toBeUndefined()
    expect(after.candidates.filter((candidate) => candidate.shotId !== shot.id)).toHaveLength(0)
  })

  it('场景修订可事务应用镜头字段 patch，并只传播真实依赖的 stale', async () => {
    const project = runtime.db.createProject({ name: '字段级场景修订' })
    runtime.service.importSource(project.id, {
      title: '双场景', content: '第一章\n雨夜车站收到来信。\n\n第二章\n清晨码头确认约定。',
    })
    const planned = runtime.service.createPlan(project.id, 'field-patch-plan-idempotency-0001', runtime.memory.checkpointContext(project.id))
    runtime.service.approvePlan(planned.plan.id, planned.approvalToken)
    const before = runtime.db.snapshot(project.id)
    const scene = before.scenes[0]!
    const shot = before.shots.find((item) => item.sceneId === scene.id)!
    const unrelated = before.shots.find((item) => item.sceneId !== scene.id)!
    const now = new Date().toISOString()
    const artifact: ArtifactVersion = {
      id: randomUUID(), projectId: project.id, workflow: { id: 'workflow.scoped_regeneration', version: '1.0.0' },
      stageId: `scoped-regeneration:scene:${scene.id}`, artifactType: 'SceneScriptRevision', revision: 1,
      scope: { type: 'scene', id: scene.id }, dependencies: [],
      content: { patch: {
        sceneId: scene.id, baseRevision: scene.revision, changes: {},
        shotPatches: [{ shotId: shot.id, baseRevision: shot.revision, changes: { dialogue: '我会准时赴约。' } }],
      } },
      contentHash: 'd'.repeat(64), status: 'draft', createdAt: now, updatedAt: now,
    }
    runtime.db.put('artifact_versions', project.id, artifact)
    const revisionBeforeApply = runtime.db.getProject(project.id)!.graphRevision
    const applied = (await api<ScenePatchApplyResult>(runtime, 'POST', `/api/v2/projects/${project.id}/scene-patches/${artifact.id}/apply`, {
      expectedProjectRevision: revisionBeforeApply, expectedSceneRevision: scene.revision,
      idempotencyKey: 'field-patch-apply-idempotency-0001', confirmation: 'APPLY_SCENE_PATCH',
    })).body.data
    expect(applied).toMatchObject({
      scene: { id: scene.id, revision: scene.revision },
      staleShotIds: [shot.id],
      updatedShots: [{ id: shot.id, dialogue: '我会准时赴约。', revision: shot.revision + 1 }],
      changedFields: [{
        targetType: 'shot', targetId: shot.id, fields: ['dialogue'],
        staleFields: ['script.shot.dialogue', 'voice', 'subtitle', 'timeline', 'export'],
      }],
    })
    const after = runtime.db.snapshot(project.id)
    const updated = after.shots.find((item) => item.id === shot.id)!
    expect(updated.staleFields).toEqual(expect.arrayContaining(['script.shot.dialogue', 'voice', 'subtitle', 'timeline', 'export']))
    expect(updated.staleFields).not.toContain('image')
    expect(updated.staleFields).not.toContain('video')
    expect(after.scenes.find((item) => item.id === scene.id)).toEqual(scene)
    expect(after.shots.find((item) => item.id === unrelated.id)).toEqual(unrelated)

    const companion: Shot = { ...updated, id: randomUUID(), title: '同场景第二镜', ordinal: updated.ordinal + 1, revision: 1, staleFields: [], dialogue: '', createdAt: now, updatedAt: now }
    runtime.db.put('shots', project.id, companion)
    const atomicArtifact: ArtifactVersion = {
      ...artifact, id: randomUUID(), revision: 2, status: 'draft', contentHash: 'e'.repeat(64),
      content: { patch: {
        sceneId: scene.id, baseRevision: scene.revision, changes: {},
        shotPatches: [
          { shotId: updated.id, baseRevision: updated.revision, changes: { dialogue: '事务内第一项' } },
          { shotId: companion.id, baseRevision: companion.revision + 1, changes: { dialogue: '过期基线' } },
        ],
      } },
    }
    runtime.db.put('artifact_versions', project.id, atomicArtifact)
    const beforeConflict = runtime.db.get<Shot>('shots', updated.id)!
    const conflict = await api(runtime, 'POST', `/api/v2/projects/${project.id}/scene-patches/${atomicArtifact.id}/apply`, {
      expectedProjectRevision: applied.projectGraphRevision, expectedSceneRevision: scene.revision,
      idempotencyKey: 'field-patch-apply-idempotency-0002', confirmation: 'APPLY_SCENE_PATCH',
    })
    expect(conflict).toMatchObject({ status: 409, body: { error: { code: 'SHOT_PATCH_REVISION_CONFLICT' } } })
    expect(runtime.db.get<Shot>('shots', updated.id)).toEqual(beforeConflict)

    const invalidArtifact: ArtifactVersion = {
      ...artifact, id: randomUUID(), revision: 3, status: 'draft', contentHash: 'f'.repeat(64),
      content: { patch: {
        sceneId: scene.id, baseRevision: scene.revision, changes: {},
        shotPatches: [{ shotId: updated.id, baseRevision: updated.revision, changes: { durationMs: updated.durationMs + 1_000 } }],
      } },
    }
    runtime.db.put('artifact_versions', project.id, invalidArtifact)
    const invalid = await api(runtime, 'POST', `/api/v2/projects/${project.id}/scene-patches/${invalidArtifact.id}/apply`, {
      expectedProjectRevision: applied.projectGraphRevision, expectedSceneRevision: scene.revision,
      idempotencyKey: 'field-patch-apply-idempotency-0003', confirmation: 'APPLY_SCENE_PATCH',
    })
    expect(invalid).toMatchObject({ status: 422, body: { error: { code: 'SHOT_PATCH_INVALID' } } })
    expect(runtime.db.get<Shot>('shots', updated.id)).toEqual(beforeConflict)
  })
})
