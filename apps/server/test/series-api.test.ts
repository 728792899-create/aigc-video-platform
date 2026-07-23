import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AssetBatchBindPreview,
  AssetBatchBindReport,
  AssetImpact,
  Episode,
  EpisodeContinuityState,
  EpisodeContext,
  Project,
  ReconcilePreview,
  ReconcileReport,
  ResolvedAsset,
  Series,
  SharedAsset,
  SharedAssetVariant,
} from '@aigc-director/contracts'
import { createDirectorApp } from '../src/http/app.js'
import { inject, jsonBody, type InjectResponse } from './http-inject.js'

const token = 'series-api-session-token-with-enough-entropy'
const auth = { authorization: `Bearer ${token}` }
type Runtime = ReturnType<typeof createDirectorApp>

async function api<T>(runtime: Runtime, method: string, path: string, body?: unknown): Promise<InjectResponse<{ ok: true; data: T }>> {
  const payload = body === undefined ? { headers: {} as Record<string, string> } : jsonBody(body)
  return await inject(runtime.app, {
    method, path, headers: { ...auth, ...payload.headers },
    ...('body' in payload && payload.body !== undefined ? { body: payload.body } : {}),
  })
}

function stop(runtime: Runtime): void {
  runtime.io.disconnectSockets(true)
  runtime.io.removeAllListeners()
  runtime.httpServer.removeAllListeners()
  runtime.db.close()
}

describe('Series 与共享资产 API', () => {
  let runtime: Runtime

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-series-api-'))
    runtime = createDirectorApp({ databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token })
  })

  afterEach(() => stop(runtime))

  it('通过 API 建立 Series/Episode、共享资产并 fork 为分集版本', async () => {
    const project = (await api<Project>(runtime, 'POST', '/api/v2/projects', { name: '第一集' })).body.data
    const series = (await api<Series>(runtime, 'POST', '/api/v2/series', { name: '灯塔系列', artDirection: '冷色悬疑' })).body.data
    const episode = (await api<Episode>(runtime, 'POST', `/api/v2/series/${series.id}/episodes`, { projectId: project.id, ordinal: 0 })).body.data
    const context = (await api<EpisodeContext>(runtime, 'GET', `/api/v2/episodes/${episode.id}/context`)).body.data
    expect(context.series?.id).toBe(series.id)

    const logicalId = randomUUID()
    const shared = (await api<SharedAsset>(runtime, 'POST', '/api/v2/assets/shared', {
      scope: 'series', seriesId: series.id, logicalId, type: 'character', name: '共享主角',
    })).body.data
    const variant = (await api<SharedAssetVariant>(runtime, 'POST', `/api/v2/assets/shared/${shared.id}/variants`, { label: '制服版' })).body.data
    const resolved = (await api<ResolvedAsset[]>(runtime, 'GET', `/api/v2/assets/resolve?projectId=${project.id}`)).body.data
    expect(resolved.find((asset) => asset.logicalId === logicalId)).toMatchObject({ source: 'series', variantId: variant.id })

    const forked = (await api<{ asset: { id: string; logicalId?: string }; variant: { id: string } }>(runtime, 'POST', '/api/v2/assets/fork', {
      projectId: project.id, sharedAssetId: shared.id, sharedVariantId: variant.id,
    })).body.data
    const afterFork = (await api<ResolvedAsset[]>(runtime, 'GET', `/api/v2/assets/resolve?projectId=${project.id}`)).body.data
    expect(afterFork.find((asset) => asset.logicalId === logicalId)).toMatchObject({ source: 'episode', assetId: forked.asset.id, variantId: forked.variant.id })
  })

  it('跨集摘要固定上一集 Source revision，来源变化后只标记 stale 不覆盖历史', async () => {
    const firstProject = (await api<Project>(runtime, 'POST', '/api/v2/projects', { name: '第一集' })).body.data
    const secondProject = (await api<Project>(runtime, 'POST', '/api/v2/projects', { name: '第二集' })).body.data
    const series = (await api<Series>(runtime, 'POST', '/api/v2/series', { name: '跨集连续性' })).body.data
    const firstEpisode = (await api<Episode>(runtime, 'POST', `/api/v2/series/${series.id}/episodes`, { projectId: firstProject.id, ordinal: 0 })).body.data
    const secondEpisode = (await api<Episode>(runtime, 'POST', `/api/v2/series/${series.id}/episodes`, { projectId: secondProject.id, ordinal: 1 })).body.data
    await api(runtime, 'POST', `/api/v2/projects/${firstProject.id}/sources`, {
      title: '第一集定稿', content: '第一章 灯塔\n主角抵达废弃灯塔。她发现地下室仍亮着灯。门后传来敲击声。',
    })
    const source = runtime.db.snapshot(firstProject.id).sources.at(-1)
    if (!source) throw new Error('TEST_SOURCE_MISSING')
    const created = (await api<EpisodeContinuityState>(runtime, 'POST', `/api/v2/episodes/${firstEpisode.id}/continuity-summary`, {
      expectedSourceId: source.id, expectedSourceRevision: source.revision, expectedSourceHash: source.contentHash,
      idempotencyKey: `episode-summary-${randomUUID()}`, confirmation: 'CREATE_EPISODE_CONTINUITY_SUMMARY',
    })).body.data
    expect(created.current).toMatchObject({
      stale: false,
      summary: { source: { id: source.id, revision: source.revision, contentHash: source.contentHash } },
    })
    const artifactId = created.current.artifact?.id
    expect(artifactId).toBeTruthy()
    expect(runtime.db.getEpisode(firstEpisode.id)?.nextHookArtifactId).toBe(artifactId)
    expect(runtime.db.getEpisode(secondEpisode.id)?.previousSummaryArtifactId).toBe(artifactId)

    const secondContext = (await api<EpisodeContinuityState>(runtime, 'GET', `/api/v2/episodes/${secondEpisode.id}/continuity`)).body.data
    expect(secondContext.previous).toMatchObject({ stale: false, artifact: { id: artifactId } })
    expect(secondContext.current).toMatchObject({ stale: true, staleReasons: expect.arrayContaining(['missing_summary', 'missing_source']) })

    await api(runtime, 'POST', `/api/v2/projects/${firstProject.id}/sources`, {
      title: '第一集修订稿', content: '第一章 灯塔\n主角抵达仍在运行的灯塔。地下室已经熄灯。门后没有声音。',
    })
    const staleContext = (await api<EpisodeContinuityState>(runtime, 'GET', `/api/v2/episodes/${secondEpisode.id}/continuity`)).body.data
    expect(staleContext.previous).toMatchObject({
      stale: true, artifact: { id: artifactId }, staleReasons: expect.arrayContaining(['source_changed', 'event_revision_changed']),
    })
    expect(runtime.db.list('artifact_versions', firstProject.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: artifactId })]))
  })

  it('批量改绑必须预览和一次性批准，共享 revision 变化传播 drift/stale', async () => {
    const project = (await api<Project>(runtime, 'POST', '/api/v2/projects', { name: '引用集' })).body.data
    const series = (await api<Series>(runtime, 'POST', '/api/v2/series', { name: '连续性系列' })).body.data
    const episode = (await api<Episode>(runtime, 'POST', `/api/v2/series/${series.id}/episodes`, { projectId: project.id })).body.data
    const now = new Date().toISOString()
    const sceneId = randomUUID()
    const shotId = randomUUID()
    runtime.db.put('scenes', project.id, { id: sceneId, projectId: project.id, title: '场景', synopsis: '', ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now })
    runtime.db.put('shots', project.id, { id: shotId, projectId: project.id, sceneId, title: '镜头', description: '主角入场', durationMs: 1_000, ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now })
    const shared = (await api<SharedAsset>(runtime, 'POST', '/api/v2/assets/shared', { scope: 'series', seriesId: series.id, type: 'style', name: '冷色胶片' })).body.data
    const variant = (await api<SharedAssetVariant>(runtime, 'POST', `/api/v2/assets/shared/${shared.id}/variants`, { label: 'v1' })).body.data

    const revision = runtime.db.getProject(project.id)?.graphRevision ?? -1
    const preview = (await api<AssetBatchBindPreview>(runtime, 'POST', '/api/v2/assets/batch-bind/preview', {
      episodeId: episode.id, expectedProjectRevision: revision,
      bindings: [{ shotId, slot: 'style', assetKind: 'shared', assetId: shared.id, variantId: variant.id, expectedAssetRevision: 1 }],
    })).body.data
    expect(preview.conflicts).toHaveLength(0)
    const report = (await api<AssetBatchBindReport>(runtime, 'POST', '/api/v2/assets/batch-bind/apply', {
      episodeId: episode.id, operationId: preview.operationId, approvalToken: preview.approvalToken,
    })).body.data
    expect(report.bindingIds).toHaveLength(1)
    expect((await api<AssetBatchBindReport>(runtime, 'POST', '/api/v2/assets/batch-bind/apply', {
      episodeId: episode.id, operationId: preview.operationId, approvalToken: preview.approvalToken,
    })).status).toBe(409)

    await api<SharedAsset>(runtime, 'PATCH', `/api/v2/assets/shared/${shared.id}`, { description: 'revision 2' })
    expect(runtime.db.listAssetBindings(project.id)[0]).toMatchObject({ drifted: true, assetRevision: 1 })
    expect(runtime.db.get<{ staleFields: string[] }>('shots', shotId)?.staleFields).toEqual(expect.arrayContaining(['image', 'video', 'timeline', 'export']))
    const impact = (await api<AssetImpact>(runtime, 'GET', `/api/v2/assets/${shared.id}/impact`)).body.data
    expect(impact).toMatchObject({ canDelete: false, shotIds: [shotId] })

    const reconcilePreview = (await api<ReconcilePreview>(runtime, 'POST', `/api/v2/episodes/${episode.id}/reconcile/preview`, {
      expectedProjectRevision: runtime.db.getProject(project.id)?.graphRevision,
      decisions: [{ bindingId: report.bindingIds[0], action: 'keep_local' }],
    })).body.data
    const reconciled = (await api<ReconcileReport>(runtime, 'POST', `/api/v2/episodes/${episode.id}/reconcile/apply`, {
      operationId: reconcilePreview.operationId, approvalToken: reconcilePreview.approvalToken,
    })).body.data
    expect(reconciled.skipped).toEqual(report.bindingIds)
  })

  it('Voice 绑定只污染声音、字幕和装配，不误伤图像与视频', async () => {
    const project = (await api<Project>(runtime, 'POST', '/api/v2/projects', { name: '声音作用域' })).body.data
    const series = (await api<Series>(runtime, 'POST', '/api/v2/series', { name: '声音系列' })).body.data
    const episode = (await api<Episode>(runtime, 'POST', `/api/v2/series/${series.id}/episodes`, { projectId: project.id })).body.data
    const now = new Date().toISOString()
    const sceneId = randomUUID()
    const shotId = randomUUID()
    runtime.db.put('scenes', project.id, { id: sceneId, projectId: project.id, title: '对话场景', synopsis: '', ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now })
    runtime.db.put('shots', project.id, { id: shotId, projectId: project.id, sceneId, title: '旁白', description: '镜头不变', dialogue: '灯光即将亮起', durationMs: 1_000, ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now })
    const voice = (await api<SharedAsset>(runtime, 'POST', '/api/v2/assets/shared', { scope: 'series', seriesId: series.id, type: 'voice', name: '旁白声线' })).body.data
    expect(voice.metadata).toMatchObject({ language: 'zh-CN', purpose: 'narrator', speed: 1, rightsStatus: 'review_required' })
    expect((await api(runtime, 'POST', '/api/v2/assets/shared', {
      scope: 'series', seriesId: series.id, type: 'voice', name: '非法声线', metadata: { speed: 3 },
    })).status).toBe(400)
    const variant = (await api<SharedAssetVariant>(runtime, 'POST', `/api/v2/assets/shared/${voice.id}/variants`, { label: '克制版' })).body.data
    const preview = (await api<AssetBatchBindPreview>(runtime, 'POST', '/api/v2/assets/batch-bind/preview', {
      episodeId: episode.id, expectedProjectRevision: runtime.db.getProject(project.id)?.graphRevision,
      bindings: [{ shotId, slot: 'voice', assetKind: 'shared', assetId: voice.id, variantId: variant.id, expectedAssetRevision: 1 }],
    })).body.data
    await api(runtime, 'POST', '/api/v2/assets/batch-bind/apply', { episodeId: episode.id, operationId: preview.operationId, approvalToken: preview.approvalToken })
    const afterBind = runtime.db.get<{ staleFields: string[] }>('shots', shotId)!.staleFields
    expect(afterBind).toEqual(expect.arrayContaining(['asset.voice', 'voice', 'subtitle', 'timeline', 'export']))
    expect(afterBind).not.toEqual(expect.arrayContaining(['image', 'video']))

    runtime.db.put('shots', project.id, { ...runtime.db.get<Record<string, unknown> & { id: string }>('shots', shotId)!, staleFields: [] })
    await api(runtime, 'PATCH', `/api/v2/assets/shared/${voice.id}`, { description: '新的声线 revision' })
    const afterRevision = runtime.db.get<{ staleFields: string[] }>('shots', shotId)!.staleFields
    expect(afterRevision).toEqual(expect.arrayContaining(['asset.voice', 'voice', 'subtitle', 'timeline', 'export']))
    expect(afterRevision).not.toEqual(expect.arrayContaining(['image', 'video']))
  })
})
