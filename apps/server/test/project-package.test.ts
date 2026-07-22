import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MediaReferenceSchema, ProjectPackageManifestSchema, ProjectSnapshotSchema, type GenerationTask } from '@aigc-director/contracts'
import { DirectorDatabase } from '../src/db/database.js'
import { ProjectPackageService, decodeZipEntries } from '../src/services/projectPackageService.js'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

describe('可移植版本化项目包', () => {
  let directory: string
  let database: DirectorDatabase
  let service: ProjectPackageService

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aigc-project-package-'))
    database = new DirectorDatabase(join(directory, 'director.sqlite'))
    service = new ProjectPackageService(database, directory)
  })

  afterEach(() => database.close())

  it('导出 manifest、完整性校验和媒体，导入时事务重映射所有内部 ID', async () => {
    const project = database.createProject({ name: '可移植试播集' })
    const now = new Date().toISOString()
    const sourceId = randomUUID()
    const chapterId = randomUUID()
    database.put('source_documents', project.id, {
      id: sourceId, projectId: project.id, title: '第一章', content: '雨夜里，灯塔重新亮起。', language: 'zh-CN',
      contentHash: createHash('sha256').update('雨夜里，灯塔重新亮起。').digest('hex'), revision: 1, createdAt: now, updatedAt: now,
    })
    database.put('chapters', project.id, {
      id: chapterId, projectId: project.id, sourceId, title: '第一章', ordinal: 0,
      sourceStart: 0, sourceEnd: 12, summary: '灯塔重启', createdAt: now, updatedAt: now,
    })
    const mediaId = randomUUID()
    const locator = `${mediaId}.png`
    await mkdir(join(directory, 'media', project.id), { recursive: true })
    await writeFile(join(directory, 'media', project.id, locator), onePixelPng)
    const media = MediaReferenceSchema.parse({
      id: mediaId, projectId: project.id, kind: 'image', storage: 'managed-file', locator, mime: 'image/png',
      size: onePixelPng.length, sha256: createHash('sha256').update(onePixelPng).digest('hex'), createdAt: now,
    })
    database.put('media_references', project.id, media)
    const sceneId = randomUUID()
    const shotId = randomUUID()
    const beatId = randomUUID()
    const boundaryFrameId = randomUUID()
    database.put('scenes', project.id, {
      id: sceneId, projectId: project.id, title: '灯塔', synopsis: '灯塔重新亮起', ordinal: 0,
      revision: 1, staleFields: [], createdAt: now, updatedAt: now,
    })
    database.put('shots', project.id, {
      id: shotId, projectId: project.id, sceneId, title: '镜头 1', description: '灯塔亮起', durationMs: 3_000,
      ordinal: 0, revision: 1, staleFields: [],
      beats: [{ id: beatId, ordinal: 0, startMs: 0, durationMs: 3_000, action: '灯塔亮起', camera: '远景推进' }],
      boundaryFrames: [{
        id: boundaryFrameId, role: 'end', mediaId, mediaSha256: media.sha256, sourceShotId: shotId,
        sourceRevision: 1, provenance: 'selected_existing', createdAt: now,
      }],
      createdAt: now, updatedAt: now,
    })
    const task: GenerationTask = {
      id: randomUUID(), projectId: project.id, type: 'export', status: 'succeeded', stage: 'completed',
      idempotencyKey: `portable-${randomUUID()}`, provider: 'demo-local', model: 'ffmpeg', providerTaskId: 'remote-sensitive-job-id', attempt: 1,
      inputSnapshot: { outputDirectory: directory, mediaId }, result: { fileName: 'demo.mp4' }, retryable: false,
      createdAt: now, updatedAt: now, finishedAt: now,
    }
    database.put('generation_tasks', project.id, task)
    database.put('provider_receipts', project.id, {
      id: randomUUID(), projectId: project.id, taskId: task.id, attemptId: randomUUID(), providerId: 'demo-local',
      remoteJobId: 'remote-sensitive-job-id', acceptedAt: now, createdAt: now,
    })
    const artifactId = randomUUID()
    database.put('artifact_versions', project.id, {
      id: artifactId, projectId: project.id, workflow: { id: 'workflow.portable', version: '1.0.0' },
      stageId: 'portable-media', artifactType: 'PortableMediaEvidence', revision: 1,
      scope: { type: 'project', id: project.id }, dependencies: [], content: { mediaId },
      contentHash: createHash('sha256').update(JSON.stringify({ mediaId })).digest('hex'), status: 'approved', createdAt: now, updatedAt: now,
    })

    const exported = await service.exportProject(project.id)
    expect(exported.fileName).toMatch(/\.aigcproj$/u)
    const entries = decodeZipEntries(exported.buffer)
    const manifest = ProjectPackageManifestSchema.parse(JSON.parse(entries.get('manifest.json')!.toString('utf8')))
    expect(manifest.formatVersion).toBe(2)
    expect(manifest.formatVersion === 2 ? manifest.bundleKind : undefined).toBe('project')
    expect(manifest.files).toHaveLength(2)
    expect(manifest.excluded).toEqual(expect.arrayContaining(['credentials', 'absolute-paths']))
    expect(exported.buffer.toString('utf8')).not.toContain(directory)
    const portableSnapshot = ProjectSnapshotSchema.parse(JSON.parse(entries.get('project.json')!.toString('utf8')))
    expect(portableSnapshot.tasks[0]?.providerTaskId).toBeUndefined()
    expect(portableSnapshot.providerReceipts).toHaveLength(0)

    const imported = await service.importProject(exported.buffer, '已导入副本')
    expect(imported.project.id).not.toBe(project.id)
    expect(imported.project.name).toBe('已导入副本')
    expect(imported.remappedEntityCount).toBeGreaterThanOrEqual(5)
    const snapshot = database.snapshot(imported.project.id)
    expect(snapshot.sources[0]?.id).not.toBe(sourceId)
    expect(snapshot.chapters[0]?.sourceId).toBe(snapshot.sources[0]?.id)
    expect(snapshot.tasks[0]?.inputSnapshot.outputDirectory).toBe('[excluded]')
    expect(snapshot.tasks[0]?.providerTaskId).toBeUndefined()
    expect(snapshot.providerReceipts).toHaveLength(0)
    expect(snapshot.media[0]?.id).not.toBe(mediaId)
    expect(snapshot.media[0]?.locator).toBe(`${snapshot.media[0]?.id}.png`)
    expect(snapshot.shots[0]?.beats[0]?.id).not.toBe(beatId)
    expect(snapshot.shots[0]?.boundaryFrames[0]?.id).not.toBe(boundaryFrameId)
    expect(snapshot.shots[0]?.boundaryFrames[0]).toMatchObject({ mediaId: snapshot.media[0]?.id, sourceShotId: snapshot.shots[0]?.id })
    expect(snapshot.artifactVersions[0]?.content).toEqual({ mediaId: snapshot.media[0]?.id })
    expect(snapshot.artifactVersions[0]?.contentHash).toBe(createHash('sha256').update(JSON.stringify(snapshot.artifactVersions[0]?.content)).digest('hex'))
    expect(createHash('sha256').update(await readFile(join(directory, 'media', imported.project.id, snapshot.media[0]!.locator))).digest('hex')).toBe(media.sha256)
  })

  it('未知 Provider 任务导入后只进入人工恢复，不携带远端 ID', async () => {
    const project = database.createProject({ name: '未知任务包' })
    const now = new Date().toISOString()
    database.put('generation_tasks', project.id, {
      id: randomUUID(), projectId: project.id, type: 'video', status: 'outcome_unknown', stage: '等待对账',
      idempotencyKey: `portable-unknown-${randomUUID()}`, provider: 'demo-local', model: 'demo-video-v1',
      providerTaskId: 'remote-unknown-sensitive-id', attempt: 1, inputSnapshot: {}, retryable: false,
      createdAt: now, updatedAt: now,
    })
    const exported = await service.exportProject(project.id)
    const exportedSnapshot = ProjectSnapshotSchema.parse(JSON.parse(decodeZipEntries(exported.buffer).get('project.json')!.toString('utf8')))
    expect(exportedSnapshot.tasks[0]?.providerTaskId).toBeUndefined()
    const imported = await service.importProject(exported.buffer, '未知任务副本')
    const importedTask = database.snapshot(imported.project.id).tasks[0]
    expect(importedTask).toMatchObject({ status: 'orphaned', retryable: false, error: { code: 'TASK_IMPORTED_FOR_REVIEW' } })
    expect(importedTask?.providerTaskId).toBeUndefined()
  })

  it('在解压前拒绝 Zip Slip 路径', async () => {
    const project = database.createProject({ name: '路径安全' })
    const exported = await service.exportProject(project.id)
    const unsafe = Buffer.from(exported.buffer)
    let cursor = 0
    let replacements = 0
    while ((cursor = unsafe.indexOf('project.json', cursor, 'utf8')) >= 0) {
      unsafe.write('../evil.json', cursor, 'utf8')
      cursor += 12
      replacements += 1
    }
    expect(replacements).toBe(2)
    expect(() => decodeZipEntries(unsafe)).toThrow('PROJECT_PACKAGE_PATH_UNSAFE')
  })

  it('校验每个包内文件的 SHA-256，损坏时不留下项目', async () => {
    const project = database.createProject({ name: '完整性' })
    const exported = await service.exportProject(project.id)
    const entries = decodeZipEntries(exported.buffer)
    const projectJson = entries.get('project.json')
    if (!projectJson) throw new Error('TEST_PROJECT_JSON_MISSING')
    projectJson[0] = projectJson[0] === 0x7b ? 0x5b : 0x7b
    await expect(service.importEntriesForTest(entries)).rejects.toThrow('PROJECT_PACKAGE_HASH_MISMATCH')
    expect(database.listProjects()).toHaveLength(1)
  })

  it('永久兼容 v1 manifest，导入时仍执行 ID 重映射', async () => {
    const project = database.createProject({ name: '旧包兼容' })
    const exported = await service.exportProject(project.id)
    const entries = decodeZipEntries(exported.buffer)
    const projectData = entries.get('project.json')
    if (!projectData) throw new Error('TEST_PROJECT_JSON_MISSING')
    const v1 = ProjectPackageManifestSchema.parse({
      format: 'aigc-director-project', formatVersion: 1, appVersion: '2.0.0', schemaVersion: 2,
      sourceProjectId: project.id, projectName: project.name, createdAt: new Date().toISOString(),
      files: [{ path: 'project.json', kind: 'project', size: projectData.byteLength, sha256: createHash('sha256').update(projectData).digest('hex') }],
      excluded: ['credentials', 'provider-secrets', 'logs', 'absolute-paths'],
    })
    entries.set('manifest.json', Buffer.from(JSON.stringify(v1), 'utf8'))
    const imported = await service.importEntriesForTest(entries, 'v1 副本')
    expect(imported).toMatchObject({ formatVersion: 1, bundleKind: 'project', project: { name: 'v1 副本' } })
    expect(imported.project.id).not.toBe(project.id)
  })

  it('Project v2 将实际使用的共享资产固定为本地副本，不写入 Global', async () => {
    const project = database.createProject({ name: '共享快照' })
    const series = database.createSeries({ name: '系列资产' })
    database.attachEpisode(project.id, series.id, 0)
    const shared = database.createSharedAsset({ scope: 'series', seriesId: series.id, type: 'style', name: '共享色调' })
    const sharedMediaId = randomUUID()
    const sharedLocator = `${sharedMediaId}.png`
    const sharedHash = createHash('sha256').update(onePixelPng).digest('hex')
    await mkdir(join(directory, 'media', 'shared'), { recursive: true })
    await writeFile(join(directory, 'media', 'shared', sharedLocator), onePixelPng)
    database.putSharedMediaReference({
      id: sharedMediaId, kind: 'image', storage: 'managed-file', locator: sharedLocator, mime: 'image/png',
      size: onePixelPng.length, sha256: sharedHash, createdAt: new Date().toISOString(),
    })
    const variant = database.createSharedAssetVariant(shared.id, {
      label: 'v1', mediaSnapshot: { sharedMediaId, kind: 'image', mime: 'image/png', size: onePixelPng.length, sha256: sharedHash },
    })
    const now = new Date().toISOString()
    const sceneId = randomUUID()
    const shotId = randomUUID()
    database.put('scenes', project.id, { id: sceneId, projectId: project.id, title: '场景', synopsis: '', ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now })
    database.put('shots', project.id, { id: shotId, projectId: project.id, sceneId, title: '镜头', description: '共享风格', durationMs: 1_000, ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now })
    database.putAssetBinding({
      id: randomUUID(), projectId: project.id, shotId, slot: 'style', assetKind: 'shared', assetId: shared.id,
      variantId: variant.id, assetRevision: 1, originScope: 'series', originScopeId: series.id,
      drifted: false, createdAt: now, updatedAt: now,
    })

    const exported = await service.exportProject(project.id)
    const imported = await service.importProject(exported.buffer, '固定副本')
    const snapshot = database.snapshot(imported.project.id)
    expect(snapshot.series).toBeUndefined()
    expect(snapshot.assetBindings[0]).toMatchObject({ assetKind: 'local', originScope: 'episode' })
    expect(snapshot.assets.some((asset) => asset.forkedFromAssetId === shared.id)).toBe(true)
    const pinnedVariant = snapshot.variants.find((item) => item.forkedFromVariantId === variant.id)
    expect(pinnedVariant?.mediaId).toBeDefined()
    const pinnedMedia = snapshot.media.find((item) => item.id === pinnedVariant?.mediaId)
    expect(pinnedMedia?.sha256).toBe(sharedHash)
    expect(await readFile(join(directory, 'media', imported.project.id, pinnedMedia!.locator))).toEqual(onePixelPng)
    expect(database.listSharedAssets('global')).toHaveLength(0)
  })

  it('Series v2 携带有序 Episodes 与系列资产并整体重映射', async () => {
    const first = database.createProject({ name: '第一集' })
    const second = database.createProject({ name: '第二集' })
    const series = database.createSeries({ name: '灯塔季' })
    database.attachEpisode(first.id, series.id, 0)
    database.attachEpisode(second.id, series.id, 1)
    const shared = database.createSharedAsset({ scope: 'series', seriesId: series.id, type: 'character', name: '守塔人' })
    database.createSharedAssetVariant(shared.id, { label: '默认' })
    const globalCountBefore = database.listSharedAssets('global').length
    const sharedMediaId = randomUUID()
    const sharedLocator = `${sharedMediaId}.png`
    const sharedHash = createHash('sha256').update(onePixelPng).digest('hex')
    await mkdir(join(directory, 'media', 'shared'), { recursive: true })
    await writeFile(join(directory, 'media', 'shared', sharedLocator), onePixelPng)
    database.putSharedMediaReference({
      id: sharedMediaId, kind: 'image', storage: 'managed-file', locator: sharedLocator, mime: 'image/png',
      size: onePixelPng.length, sha256: sharedHash, createdAt: new Date().toISOString(),
    })
    const global = database.createSharedAsset({ scope: 'global', type: 'style', name: '全局胶片风格' })
    const globalVariant = database.createSharedAssetVariant(global.id, {
      label: '默认', mediaSnapshot: { sharedMediaId, kind: 'image', mime: 'image/png', size: onePixelPng.length, sha256: sharedHash },
    })
    const now = new Date().toISOString()
    const sceneId = randomUUID()
    const shotId = randomUUID()
    database.put('scenes', first.id, { id: sceneId, projectId: first.id, title: '灯塔', synopsis: '', ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now })
    database.put('shots', first.id, { id: shotId, projectId: first.id, sceneId, title: '灯塔镜头', description: '灯塔重新亮起', durationMs: 1_000, ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now })
    database.putAssetBinding({
      id: randomUUID(), projectId: first.id, shotId, slot: 'style', assetKind: 'shared', assetId: global.id,
      variantId: globalVariant.id, assetRevision: 1, originScope: 'global', drifted: false, createdAt: now, updatedAt: now,
    })

    const exported = await service.exportSeries(series.id)
    const manifest = ProjectPackageManifestSchema.parse(JSON.parse(decodeZipEntries(exported.buffer).get('manifest.json')!.toString('utf8')))
    expect(manifest).toMatchObject({ formatVersion: 2, bundleKind: 'series', sourceSeriesId: series.id })
    const imported = await service.importProject(exported.buffer, '灯塔季副本')
    expect(imported.bundleKind).toBe('series')
    expect(imported.series?.id).not.toBe(series.id)
    expect(imported.projects).toHaveLength(2)
    const episodes = database.listEpisodes(imported.series!.id)
    expect(episodes.map((episode) => episode.ordinal)).toEqual([0, 1])
    const importedAssets = database.listSharedAssets('series', imported.series!.id)
    expect(importedAssets.map((asset) => asset.name)).toEqual(expect.arrayContaining(['守塔人', '全局胶片风格']))
    expect(database.listSharedAssets('global')).toHaveLength(globalCountBefore + 1)
    const importedGlobalPin = importedAssets.find((asset) => asset.name === '全局胶片风格')!
    expect(importedGlobalPin.metadata).toMatchObject({ portablePinnedFromScope: 'global' })
    const importedVariant = database.listSharedAssetVariants(importedGlobalPin.id)[0]!
    const importedSharedMedia = database.getSharedMediaReference(importedVariant.mediaSnapshot!.sharedMediaId)!
    expect(await readFile(join(directory, 'media', 'shared', importedSharedMedia.locator))).toEqual(onePixelPng)
  })
})
