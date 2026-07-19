import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DirectorDatabase } from '../src/db/database.js'
import { SharedAssetMediaService } from '../src/services/sharedAssetMediaService.js'

describe('Series/Episode 与分层共享资产', () => {
  let directory: string
  let database: DirectorDatabase

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aigc-series-assets-'))
    database = new DirectorDatabase(join(directory, 'director.sqlite'))
  })

  afterEach(() => database.close())

  it('新 Project 原子建立 standalone Episode，并可按序加入 Series', () => {
    const first = database.createProject({ name: '第一集' })
    const second = database.createProject({ name: '第二集' })
    expect(database.getEpisodeByProject(first.id)).toMatchObject({ projectId: first.id, ordinal: 0 })

    const series = database.createSeries({ name: '灯塔系列', artDirection: '冷色悬疑' })
    const firstEpisode = database.attachEpisode(first.id, series.id, 0)
    const secondEpisode = database.attachEpisode(second.id, series.id, 1)
    expect(database.listEpisodes(series.id).map((episode) => episode.id)).toEqual([firstEpisode.id, secondEpisode.id])
    expect(database.getEpisodeContext(secondEpisode.id)).toMatchObject({ series: { id: series.id }, episode: { ordinal: 1 } })
  })

  it('按 Episode local → Series → Global 解析，并通过 fork 隔离共享源', () => {
    const project = database.createProject({ name: '试播集' })
    const series = database.createSeries({ name: '共享世界观' })
    database.attachEpisode(project.id, series.id, 0)
    const logicalId = randomUUID()
    const globalAsset = database.createSharedAsset({ scope: 'global', logicalId, type: 'character', name: 'Global 主角' })
    const globalVariant = database.createSharedAssetVariant(globalAsset.id, { label: 'Global v1' })
    const seriesAsset = database.createSharedAsset({ scope: 'series', seriesId: series.id, logicalId, type: 'character', name: 'Series 主角' })
    const seriesVariant = database.createSharedAssetVariant(seriesAsset.id, { label: 'Series v1' })

    expect(database.resolveAssets(project.id).find((asset) => asset.logicalId === logicalId)).toMatchObject({
      source: 'series', assetId: seriesAsset.id, variantId: seriesVariant.id,
    })
    const forked = database.forkSharedAsset(project.id, seriesAsset.id, seriesVariant.id)
    expect(forked.asset.forkedFromAssetId).toBe(seriesAsset.id)
    expect(forked.variant.forkedFromVariantId).toBe(seriesVariant.id)
    expect(database.resolveAssets(project.id).find((asset) => asset.logicalId === logicalId)).toMatchObject({
      source: 'episode', assetId: forked.asset.id, variantId: forked.variant.id,
    })
    expect(database.getSharedAsset(globalAsset.id)?.selectedVariantId).toBe(globalVariant.id)
    expect(database.getSharedAsset(seriesAsset.id)?.name).toBe('Series 主角')
  })

  it('共享资产被镜头绑定后拒绝删除并报告影响', () => {
    const project = database.createProject({ name: '引用保护' })
    const series = database.createSeries({ name: '引用系列' })
    database.attachEpisode(project.id, series.id, 0)
    const shared = database.createSharedAsset({ scope: 'series', seriesId: series.id, type: 'style', name: '胶片风格' })
    const variant = database.createSharedAssetVariant(shared.id, { label: '暖调' })
    const shotId = randomUUID()
    const now = new Date().toISOString()
    const sceneId = randomUUID()
    database.put('scenes', project.id, {
      id: sceneId, projectId: project.id, title: '测试场景', synopsis: '', ordinal: 0,
      revision: 1, staleFields: [], createdAt: now, updatedAt: now,
    })
    database.put('shots', project.id, {
      id: shotId, projectId: project.id, sceneId, title: '测试镜头', description: '引用共享风格',
      durationMs: 1_000, ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now,
    })
    database.putAssetBinding({
      id: randomUUID(), projectId: project.id, shotId, slot: 'style', assetKind: 'shared', assetId: shared.id,
      variantId: variant.id, assetRevision: shared.revision, originScope: 'series', originScopeId: series.id,
      drifted: false, createdAt: now, updatedAt: now,
    })
    const taskId = randomUUID()
    database.put('generation_tasks', project.id, {
      id: taskId, projectId: project.id, type: 'image', status: 'queued', stage: 'queued',
      idempotencyKey: `asset-impact-${randomUUID()}`, provider: 'demo-local', model: 'demo-image-v1', attempt: 1,
      inputSnapshot: { sharedAssetId: shared.id, sharedVariantId: variant.id }, retryable: true,
      createdAt: now, updatedAt: now,
    })

    expect(database.assetImpact(shared.id)).toMatchObject({ canDelete: false, shotIds: [shotId], taskIds: [taskId] })
    expect(() => database.deleteSharedAsset(shared.id)).toThrow('ASSET_REFERENCED')
  })

  it('promote 与 fork 将媒体复制到共享存储和目标 Episode', async () => {
    const project = database.createProject({ name: '媒体连续性' })
    const series = database.createSeries({ name: '媒体系列' })
    database.attachEpisode(project.id, series.id, 0)
    const mediaData = Buffer.from('series-media-snapshot')
    const mediaId = randomUUID()
    const mediaDirectory = join(directory, 'media', project.id)
    await mkdir(mediaDirectory, { recursive: true })
    await writeFile(join(mediaDirectory, `${mediaId}.png`), mediaData)
    const now = new Date().toISOString()
    database.put('media_references', project.id, {
      id: mediaId, projectId: project.id, kind: 'image', storage: 'managed-file', locator: `${mediaId}.png`,
      mime: 'image/png', size: mediaData.byteLength,
      sha256: 'cfa33ac22288e84519af6b56db73c25013c8d24f9da06682369caaca4ebf91ee', createdAt: now,
    })
    const assetId = randomUUID()
    const variantId = randomUUID()
    database.put('assets', project.id, {
      id: assetId, projectId: project.id, logicalId: randomUUID(), type: 'character', scope: 'episode', name: '林遥',
      description: '', metadata: {}, selectedVariantId: variantId, revision: 1, archived: false, createdAt: now, updatedAt: now,
    })
    database.put('asset_variants', project.id, {
      id: variantId, assetId, revision: 1, label: '红围巾', prompt: '', metadata: {}, mediaId,
      favorite: false, archived: false, createdAt: now,
    })

    const service = new SharedAssetMediaService(database, directory)
    const promoted = await service.promoteLocalAsset(project.id, assetId, variantId, { scope: 'series', seriesId: series.id })
    expect(promoted.variant.mediaSnapshot?.sha256).toBe('cfa33ac22288e84519af6b56db73c25013c8d24f9da06682369caaca4ebf91ee')
    const sharedMedia = database.getSharedMediaReference(promoted.variant.mediaSnapshot!.sharedMediaId)
    expect(sharedMedia).toBeDefined()
    expect(await readFile(join(directory, 'media', 'shared', sharedMedia!.locator))).toEqual(mediaData)

    const forked = await service.forkSharedAsset(project.id, promoted.asset.id, promoted.variant.id)
    expect(forked.variant.mediaId).toBeDefined()
    const forkedMedia = database.get<{ locator: string }>('media_references', forked.variant.mediaId!)
    expect(forkedMedia).toBeDefined()
    expect(await readFile(join(mediaDirectory, forkedMedia!.locator))).toEqual(mediaData)
  })
})
