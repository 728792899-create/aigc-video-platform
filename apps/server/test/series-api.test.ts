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
})
