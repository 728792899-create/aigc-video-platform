import { createHash, randomUUID } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { basename, extname, join, resolve } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import {
  ProjectPackageImportReportSchema,
  ProjectPackageManifestSchema,
  ProjectPackageManifestV2Schema,
  MediaReferenceSchema,
  ProjectSnapshotSchema,
  SeriesPackagePayloadSchema,
  type AssetUnit,
  type AssetVariant,
  type GenerationTask,
  type MediaReference,
  type ProjectPackageImportReport,
  type ProjectPackageManifest,
  type ProjectPackageManifestV2,
  type ProjectSnapshot,
  type SeriesPackagePayload,
  type SharedAsset,
  type SharedAssetVariant,
  type SharedMediaReference,
} from '@aigc-director/contracts'
import { LATEST_SCHEMA_VERSION, type DirectorDatabase } from '../db/database.js'

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_ENTRY_BYTES = 50 * 1024 * 1024
const MAX_ENTRIES = 5_002
const UTF8_FLAG = 0x0800
const ZIP_LOCAL_FILE = 0x04034b50
const ZIP_CENTRAL_FILE = 0x02014b50
const ZIP_END = 0x06054b50

interface ZipEntry { name: string; data: Buffer }

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  return value >>> 0
})

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xffffffff) >>> 0
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function safeEntryName(name: string): boolean {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/u.test(name)) return false
  const segments = name.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function ensureSafeEntryName(name: string): void {
  if (!safeEntryName(name)) throw new Error('PROJECT_PACKAGE_PATH_UNSAFE')
}

export function encodeZipEntries(entries: readonly ZipEntry[]): Buffer {
  if (entries.length === 0 || entries.length > MAX_ENTRIES) throw new Error('PROJECT_PACKAGE_ENTRY_LIMIT')
  const seen = new Set<string>()
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    ensureSafeEntryName(entry.name)
    if (seen.has(entry.name)) throw new Error('PROJECT_PACKAGE_DUPLICATE_ENTRY')
    seen.add(entry.name)
    if (entry.data.byteLength > MAX_ENTRY_BYTES) throw new Error('PROJECT_PACKAGE_ENTRY_TOO_LARGE')
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 6 })
    const checksum = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(ZIP_LOCAL_FILE, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8_FLAG, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.byteLength, 18)
    local.writeUInt32LE(entry.data.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(ZIP_CENTRAL_FILE, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(UTF8_FLAG, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.byteLength, 20)
    central.writeUInt32LE(entry.data.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE((0o100600 * 0x10000) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.byteLength + name.byteLength + compressed.byteLength
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(ZIP_END, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  const archive = Buffer.concat([...localParts, centralDirectory, end])
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('PROJECT_PACKAGE_ARCHIVE_TOO_LARGE')
  return archive
}

function findEndRecord(archive: Buffer): number {
  const minimum = Math.max(0, archive.byteLength - 65_557)
  for (let cursor = archive.byteLength - 22; cursor >= minimum; cursor -= 1) {
    if (archive.readUInt32LE(cursor) === ZIP_END) return cursor
  }
  throw new Error('PROJECT_PACKAGE_ZIP_INVALID')
}

export function decodeZipEntries(archive: Buffer): Map<string, Buffer> {
  if (archive.byteLength < 22 || archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('PROJECT_PACKAGE_ARCHIVE_SIZE_INVALID')
  const endOffset = findEndRecord(archive)
  const diskEntries = archive.readUInt16LE(endOffset + 8)
  const totalEntries = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  if (diskEntries !== totalEntries || totalEntries === 0xffff || totalEntries === 0 || totalEntries > MAX_ENTRIES) throw new Error('PROJECT_PACKAGE_ENTRY_LIMIT')
  if (centralOffset + centralSize > endOffset) throw new Error('PROJECT_PACKAGE_ZIP_INVALID')
  const entries = new Map<string, Buffer>()
  let cursor = centralOffset
  let totalInflated = 0
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > archive.byteLength || archive.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE) throw new Error('PROJECT_PACKAGE_ZIP_INVALID')
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const checksum = archive.readUInt32LE(cursor + 16)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const attributes = archive.readUInt32LE(cursor + 38) >>> 16
    const localOffset = archive.readUInt32LE(cursor + 42)
    if ((flags & 1) !== 0 || ![0, 8].includes(method)) throw new Error('PROJECT_PACKAGE_ZIP_UNSUPPORTED')
    if ((attributes & 0o170000) === 0o120000) throw new Error('PROJECT_PACKAGE_SYMLINK_REJECTED')
    if (uncompressedSize > MAX_ENTRY_BYTES || totalInflated + uncompressedSize > MAX_ARCHIVE_BYTES) throw new Error('PROJECT_PACKAGE_UNCOMPRESSED_LIMIT')
    if (compressedSize > 0 && uncompressedSize > 1024 * 1024 && uncompressedSize / compressedSize > 200) throw new Error('PROJECT_PACKAGE_COMPRESSION_RATIO')
    const nameStart = cursor + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd + extraLength + commentLength > archive.byteLength) throw new Error('PROJECT_PACKAGE_ZIP_INVALID')
    const name = archive.subarray(nameStart, nameEnd).toString('utf8')
    ensureSafeEntryName(name)
    if (entries.has(name)) throw new Error('PROJECT_PACKAGE_DUPLICATE_ENTRY')
    if (localOffset + 30 > archive.byteLength || archive.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE) throw new Error('PROJECT_PACKAGE_ZIP_INVALID')
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > archive.byteLength) throw new Error('PROJECT_PACKAGE_ZIP_INVALID')
    const compressed = archive.subarray(dataStart, dataEnd)
    const data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES })
    if (data.byteLength !== uncompressedSize || crc32(data) !== checksum) throw new Error('PROJECT_PACKAGE_CRC_MISMATCH')
    entries.set(name, data)
    totalInflated += data.byteLength
    cursor = nameEnd + extraLength + commentLength
  }
  if (cursor !== centralOffset + centralSize) throw new Error('PROJECT_PACKAGE_ZIP_INVALID')
  return entries
}

function redactPortableValue(value: unknown, key = ''): unknown {
  if (/api.?key|secret|token|password|credential|authorization|cookie|signed.?url|outputDirectory|localPath/iu.test(key)) return '[excluded]'
  if (typeof value === 'string' && (/^(?:\/|~\/|[a-zA-Z]:\\|file:\/\/)/u.test(value))) return '[excluded]'
  if (Array.isArray(value)) return value.map((item) => redactPortableValue(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactPortableValue(child, childKey)]))
  return value
}

function sanitizeFileName(name: string): string {
  const safe = name.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
  return `${safe || 'aigc-director-project'}.aigcproj`
}

function remapValue(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => remapValue(item, ids))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapValue(child, ids)]))
  return value
}

function entityIds(snapshot: ProjectSnapshot): Set<string> {
  const ids = new Set<string>([snapshot.project.id])
  if (snapshot.episode) ids.add(snapshot.episode.id)
  const collections = [snapshot.sources, snapshot.chapters, snapshot.events, snapshot.eventEdges, snapshot.scenes, snapshot.shots,
    snapshot.assets, snapshot.variants, snapshot.assetBindings, snapshot.media, snapshot.candidates, snapshot.candidateBatches, snapshot.providerMediaReceipts, snapshot.tasks, snapshot.plans, snapshot.promptRuns,
    snapshot.attempts, snapshot.providerReceipts, snapshot.reviews, snapshot.artifactVersions]
  for (const entity of collections.flat()) ids.add(entity.id)
  for (const plan of snapshot.plans) {
    ids.add(plan.runId)
    for (const step of plan.steps) ids.add(step.id)
  }
  for (const shot of snapshot.shots) {
    for (const beat of shot.beats) ids.add(beat.id)
    for (const frame of shot.boundaryFrames) ids.add(frame.id)
  }
  return ids
}

function normalizeImportedTasks(tasks: GenerationTask[]): { tasks: GenerationTask[]; interrupted: number } {
  const nonTerminal = new Set(['queued', 'running', 'waiting_approval', 'retrying', 'cancel_requested', 'reconciling'])
  let interrupted = 0
  return {
    tasks: tasks.map((task) => {
      if (!nonTerminal.has(task.status)) return task
      interrupted += 1
      return {
        ...task, status: 'orphaned', stage: 'imported-for-review', retryable: false, updatedAt: new Date().toISOString(),
        error: {
          code: 'TASK_IMPORTED_FOR_REVIEW', userMessage: '导入的未完成任务已停止自动提交，请先诊断。', technicalMessage: 'non-terminal task imported from portable package',
          retryable: false, correlationId: randomUUID(), taskId: task.id, timestamp: new Date().toISOString(),
        },
      }
    }),
    interrupted,
  }
}

function validateDeclaredEntries(entries: Map<string, Buffer>, manifest: ProjectPackageManifest): number {
  const declared = new Set(['manifest.json'])
  let totalBytes = 0
  for (const file of manifest.files) {
    const data = entries.get(file.path)
    if (!data) throw new Error('PROJECT_PACKAGE_DECLARED_FILE_MISSING')
    if (data.byteLength !== file.size || sha256(data) !== file.sha256) throw new Error('PROJECT_PACKAGE_HASH_MISMATCH')
    declared.add(file.path)
    totalBytes += data.byteLength
  }
  if (declared.size !== entries.size || [...entries.keys()].some((path) => !declared.has(path))) throw new Error('PROJECT_PACKAGE_UNDECLARED_ENTRY')
  return totalBytes
}

export class ProjectPackageService {
  constructor(private readonly database: DirectorDatabase, private readonly dataDirectory: string) {}

  private portableProjectSnapshot(projectId: string): { snapshot: ProjectSnapshot; sharedMediaSources: Map<string, SharedMediaReference> } {
    const original = this.database.snapshot(projectId)
    const assets: AssetUnit[] = [...original.assets]
    const variants: AssetVariant[] = [...original.variants]
    const media: MediaReference[] = [...original.media]
    const sharedMediaSources = new Map<string, SharedMediaReference>()
    const assetIds = new Set(assets.map((asset) => asset.id))
    const variantIds = new Set(variants.map((variant) => variant.id))
    const pinned = new Map<string, { assetId: string; variantId: string }>()
    const timestamp = new Date().toISOString()
    const assetBindings = original.assetBindings.map((binding) => {
      if (binding.assetKind === 'local') return binding
      const shared = this.database.getSharedAsset(binding.assetId)
      const sharedVariant = this.database.getSharedAssetVariant(binding.variantId)
      if (!shared || !sharedVariant || sharedVariant.sharedAssetId !== shared.id) throw new Error('PROJECT_PACKAGE_SHARED_ASSET_MISSING')
      const pinKey = `${shared.id}:${sharedVariant.id}`
      const existingPin = pinned.get(pinKey)
      const pinnedAssetId = existingPin?.assetId ?? randomUUID()
      const pinnedVariantId = existingPin?.variantId ?? randomUUID()
      pinned.set(pinKey, { assetId: pinnedAssetId, variantId: pinnedVariantId })
      if (!assetIds.has(pinnedAssetId)) {
        assets.push({
          id: pinnedAssetId, projectId, logicalId: shared.logicalId, type: shared.type, scope: 'episode', name: shared.name,
          description: shared.description, metadata: { ...shared.metadata, portablePinnedFromScope: shared.scope },
          selectedVariantId: pinnedVariantId, revision: shared.revision, forkedFromAssetId: shared.id,
          archived: false, createdAt: timestamp, updatedAt: timestamp,
        })
        assetIds.add(pinnedAssetId)
      }
      if (!variantIds.has(pinnedVariantId)) {
        let mediaId: string | undefined
        if (sharedVariant.mediaSnapshot) {
          const sourceMedia = this.database.getSharedMediaReference(sharedVariant.mediaSnapshot.sharedMediaId)
          if (!sourceMedia || sourceMedia.sha256 !== sharedVariant.mediaSnapshot.sha256 || sourceMedia.size !== sharedVariant.mediaSnapshot.size) {
            throw new Error('PROJECT_PACKAGE_SHARED_MEDIA_MISSING')
          }
          const extension = extname(sourceMedia.locator).slice(1).toLowerCase()
          if (!/^[a-z0-9]{1,8}$/u.test(extension)) throw new Error('PROJECT_PACKAGE_MEDIA_EXTENSION_INVALID')
          mediaId = randomUUID()
          media.push(MediaReferenceSchema.parse({
            id: mediaId, projectId, kind: sourceMedia.kind, storage: 'managed-file', locator: `${mediaId}.${extension}`,
            mime: sourceMedia.mime, size: sourceMedia.size, sha256: sourceMedia.sha256, createdAt: sourceMedia.createdAt,
          }))
          sharedMediaSources.set(mediaId, sourceMedia)
        }
        variants.push({
          id: pinnedVariantId, assetId: pinnedAssetId, revision: sharedVariant.revision, label: sharedVariant.label,
          prompt: sharedVariant.prompt, metadata: { ...sharedVariant.metadata, sharedMediaSnapshot: sharedVariant.mediaSnapshot },
          ...(mediaId ? { mediaId } : {}),
          forkedFromVariantId: sharedVariant.id, favorite: sharedVariant.favorite, archived: false, createdAt: sharedVariant.createdAt,
        })
        variantIds.add(pinnedVariantId)
      }
      return {
        ...binding, assetKind: 'local' as const, assetId: pinnedAssetId, variantId: pinnedVariantId, originScope: 'episode' as const,
        originScopeId: original.episode?.id, drifted: false, updatedAt: timestamp,
      }
    })
    const episode = original.episode ? {
      id: original.episode.id, projectId, ordinal: 0, title: original.episode.title,
      ...(original.episode.previousSummaryArtifactId ? { previousSummaryArtifactId: original.episode.previousSummaryArtifactId } : {}),
      ...(original.episode.nextHookArtifactId ? { nextHookArtifactId: original.episode.nextHookArtifactId } : {}),
      revision: original.episode.revision, createdAt: original.episode.createdAt, updatedAt: original.episode.updatedAt,
    } : undefined
    return { snapshot: ProjectSnapshotSchema.parse({
      ...original, ...(episode ? { episode } : {}), series: undefined, assets, variants, assetBindings, media,
      resolvedAssets: [],
    }), sharedMediaSources }
  }

  async exportProject(projectId: string): Promise<{ fileName: string; buffer: Buffer; manifest: ProjectPackageManifest }> {
    const portable = this.portableProjectSnapshot(projectId)
    const snapshot = ProjectSnapshotSchema.parse(redactPortableValue(portable.snapshot))
    const projectData = Buffer.from(JSON.stringify(snapshot), 'utf8')
    const files: ProjectPackageManifest['files'] = [{ path: 'project.json', kind: 'project', size: projectData.byteLength, sha256: sha256(projectData) }]
    const entries: ZipEntry[] = [{ name: 'project.json', data: projectData }]
    for (const media of snapshot.media) {
      if (media.storage !== 'managed-file' || basename(media.locator) !== media.locator) throw new Error('PROJECT_PACKAGE_MEDIA_UNSUPPORTED')
      const sharedSource = portable.sharedMediaSources.get(media.id)
      const sourcePath = sharedSource
        ? join(resolve(this.dataDirectory), 'media', 'shared', sharedSource.locator)
        : join(resolve(this.dataDirectory), 'media', projectId, media.locator)
      const data = await readFile(sourcePath).catch(() => { throw new Error('PROJECT_PACKAGE_MEDIA_MISSING') })
      if (data.byteLength !== media.size || sha256(data) !== media.sha256) throw new Error('PROJECT_PACKAGE_MEDIA_HASH_MISMATCH')
      const extension = extname(media.locator).slice(1).toLowerCase()
      if (!/^[a-z0-9]{1,8}$/u.test(extension)) throw new Error('PROJECT_PACKAGE_MEDIA_EXTENSION_INVALID')
      const path = `media/${media.id}.${extension}`
      files.push({ path, kind: 'media', size: data.byteLength, sha256: media.sha256, mime: media.mime, mediaId: media.id })
      entries.push({ name: path, data })
    }
    const manifest = ProjectPackageManifestV2Schema.parse({
      format: 'aigc-director-project', formatVersion: 2, appVersion: '2.0.0', schemaVersion: this.database.schemaVersion(),
      bundleKind: 'project', sourceProjectId: snapshot.project.id, bundleName: snapshot.project.name, createdAt: new Date().toISOString(), files,
      excluded: ['credentials', 'provider-secrets', 'logs', 'absolute-paths'],
    })
    const manifestData = Buffer.from(JSON.stringify(manifest), 'utf8')
    return { fileName: sanitizeFileName(snapshot.project.name), buffer: encodeZipEntries([{ name: 'manifest.json', data: manifestData }, ...entries]), manifest }
  }

  async exportSeries(seriesId: string): Promise<{ fileName: string; buffer: Buffer; manifest: ProjectPackageManifest }> {
    const series = this.database.getSeries(seriesId)
    if (!series) throw new Error('SERIES_NOT_FOUND')
    const episodes = this.database.listEpisodes(seriesId)
    if (episodes.length === 0) throw new Error('SERIES_EPISODES_REQUIRED')
    const sourceProjects = episodes.map((episode) => this.database.snapshot(episode.projectId))
    const requiredSharedIds = new Set(sourceProjects.flatMap((snapshot) => snapshot.assetBindings.filter((binding) => binding.assetKind === 'shared').map((binding) => binding.assetId)))
    for (const asset of this.database.listSharedAssets('series', seriesId)) requiredSharedIds.add(asset.id)
    const sourceSharedAssets = [...requiredSharedIds].map((id) => this.database.getSharedAsset(id)).filter((asset): asset is SharedAsset => Boolean(asset))
    const portableAssetIds = new Map<string, string>()
    const portableVariantIds = new Map<string, string>()
    const sharedAssets = sourceSharedAssets.map((asset) => {
      const portableId = asset.scope === 'global' ? randomUUID() : asset.id
      portableAssetIds.set(asset.id, portableId)
      return {
        ...asset, id: portableId, scope: 'series' as const, seriesId,
        ...(asset.scope === 'global' ? { metadata: { ...asset.metadata, portablePinnedFromScope: 'global' }, forkedFromAssetId: asset.id } : {}),
      }
    })
    const sharedVariants: SharedAssetVariant[] = []
    for (const sourceAsset of sourceSharedAssets) {
      const targetAssetId = portableAssetIds.get(sourceAsset.id)!
      for (const variant of this.database.listSharedAssetVariants(sourceAsset.id)) {
        const targetVariantId = sourceAsset.scope === 'global' ? randomUUID() : variant.id
        portableVariantIds.set(variant.id, targetVariantId)
        sharedVariants.push({ ...variant, id: targetVariantId, sharedAssetId: targetAssetId })
      }
    }
    const normalizedSharedAssets = sharedAssets.map((asset) => ({
      ...asset,
      ...(asset.selectedVariantId ? { selectedVariantId: portableVariantIds.get(asset.selectedVariantId) ?? asset.selectedVariantId } : {}),
    }))
    const projects = sourceProjects.map((snapshot) => ProjectSnapshotSchema.parse({
      ...snapshot,
      resolvedAssets: [],
      assetBindings: snapshot.assetBindings.map((binding) => binding.assetKind === 'shared' ? {
        ...binding,
        assetId: portableAssetIds.get(binding.assetId) ?? binding.assetId,
        variantId: portableVariantIds.get(binding.variantId) ?? binding.variantId,
        originScope: 'series', originScopeId: seriesId,
      } : binding),
    }))
    const sharedMediaIds = new Set(sharedVariants.flatMap((variant) => variant.mediaSnapshot ? [variant.mediaSnapshot.sharedMediaId] : []))
    const sharedMediaReferences = [...sharedMediaIds].map((id) => this.database.getSharedMediaReference(id))
      .filter((reference): reference is SharedMediaReference => Boolean(reference))
    if (sharedMediaReferences.length !== sharedMediaIds.size) throw new Error('PROJECT_PACKAGE_SHARED_MEDIA_MISSING')
    const payload = SeriesPackagePayloadSchema.parse(redactPortableValue({
      series, episodes, projects, sharedAssets: normalizedSharedAssets, sharedVariants, sharedMediaReferences,
    }))
    const seriesData = Buffer.from(JSON.stringify(payload), 'utf8')
    const files: ProjectPackageManifest['files'] = [{ path: 'series.json', kind: 'series', size: seriesData.byteLength, sha256: sha256(seriesData) }]
    const entries: ZipEntry[] = [{ name: 'series.json', data: seriesData }]
    for (const snapshot of projects) {
      for (const media of snapshot.media) {
        if (media.storage !== 'managed-file' || basename(media.locator) !== media.locator) throw new Error('PROJECT_PACKAGE_MEDIA_UNSUPPORTED')
        const data = await readFile(join(resolve(this.dataDirectory), 'media', snapshot.project.id, media.locator)).catch(() => { throw new Error('PROJECT_PACKAGE_MEDIA_MISSING') })
        if (data.byteLength !== media.size || sha256(data) !== media.sha256) throw new Error('PROJECT_PACKAGE_MEDIA_HASH_MISMATCH')
        const extension = extname(media.locator).slice(1).toLowerCase()
        if (!/^[a-z0-9]{1,8}$/u.test(extension)) throw new Error('PROJECT_PACKAGE_MEDIA_EXTENSION_INVALID')
        const path = `media/${snapshot.project.id}/${media.id}.${extension}`
        files.push({ path, kind: 'media', size: data.byteLength, sha256: media.sha256, mime: media.mime, mediaId: media.id })
        entries.push({ name: path, data })
      }
    }
    for (const media of sharedMediaReferences) {
      if (basename(media.locator) !== media.locator) throw new Error('PROJECT_PACKAGE_MEDIA_UNSUPPORTED')
      const data = await readFile(join(resolve(this.dataDirectory), 'media', 'shared', media.locator)).catch(() => { throw new Error('PROJECT_PACKAGE_SHARED_MEDIA_MISSING') })
      if (data.byteLength !== media.size || sha256(data) !== media.sha256) throw new Error('PROJECT_PACKAGE_MEDIA_HASH_MISMATCH')
      const extension = extname(media.locator).slice(1).toLowerCase()
      if (!/^[a-z0-9]{1,8}$/u.test(extension)) throw new Error('PROJECT_PACKAGE_MEDIA_EXTENSION_INVALID')
      const path = `shared-media/${media.id}.${extension}`
      files.push({ path, kind: 'shared-media', size: data.byteLength, sha256: media.sha256, mime: media.mime, mediaId: media.id })
      entries.push({ name: path, data })
    }
    const manifest = ProjectPackageManifestV2Schema.parse({
      format: 'aigc-director-project', formatVersion: 2, appVersion: '2.0.0', schemaVersion: this.database.schemaVersion(),
      bundleKind: 'series', sourceSeriesId: series.id, bundleName: series.name, createdAt: new Date().toISOString(), files,
      excluded: ['credentials', 'provider-secrets', 'logs', 'absolute-paths'],
    })
    const manifestData = Buffer.from(JSON.stringify(manifest), 'utf8')
    return { fileName: sanitizeFileName(series.name), buffer: encodeZipEntries([{ name: 'manifest.json', data: manifestData }, ...entries]), manifest }
  }

  async importProject(archive: Buffer, requestedName?: string): Promise<ProjectPackageImportReport> {
    return await this.importEntries(decodeZipEntries(archive), requestedName)
  }

  async importEntriesForTest(entries: Map<string, Buffer>, requestedName?: string): Promise<ProjectPackageImportReport> {
    return await this.importEntries(entries, requestedName)
  }

  private async importEntries(entries: Map<string, Buffer>, requestedName?: string): Promise<ProjectPackageImportReport> {
    const manifestData = entries.get('manifest.json')
    if (!manifestData) throw new Error('PROJECT_PACKAGE_REQUIRED_ENTRY_MISSING')
    let manifest: ProjectPackageManifest
    try {
      manifest = ProjectPackageManifestSchema.parse(JSON.parse(manifestData.toString('utf8')))
    } catch { throw new Error('PROJECT_PACKAGE_SCHEMA_INVALID') }
    if (manifest.schemaVersion > LATEST_SCHEMA_VERSION) throw new Error('PROJECT_PACKAGE_VERSION_UNSUPPORTED')
    const totalBytes = validateDeclaredEntries(entries, manifest)
    if (manifest.formatVersion === 2 && manifest.bundleKind === 'series') return await this.importSeriesEntries(entries, manifest, totalBytes, requestedName)
    const projectData = entries.get('project.json')
    if (!projectData) throw new Error('PROJECT_PACKAGE_REQUIRED_ENTRY_MISSING')
    if (sha256(projectData) !== manifest.files.find((file) => file.path === 'project.json')?.sha256) throw new Error('PROJECT_PACKAGE_HASH_MISMATCH')
    let original: ProjectSnapshot
    try { original = ProjectSnapshotSchema.parse(JSON.parse(projectData.toString('utf8'))) } catch { throw new Error('PROJECT_PACKAGE_SCHEMA_INVALID') }
    if (manifest.sourceProjectId !== original.project.id) throw new Error('PROJECT_PACKAGE_PROJECT_MISMATCH')

    const idMap = new Map([...entityIds(original)].map((id) => [id, randomUUID()]))
    const timestamp = new Date().toISOString()
    const remapped = remapValue(original, idMap) as ProjectSnapshot
    const projectId = idMap.get(original.project.id)
    if (!projectId) throw new Error('PROJECT_PACKAGE_ID_REMAP_FAILED')
    const name = requestedName?.trim() || `${original.project.name}（导入）`
    const normalized = normalizeImportedTasks(remapped.tasks)
    const mediaById = new Map(manifest.files.filter((file) => file.kind === 'media' && file.mediaId).map((file) => [file.mediaId!, file]))
    if (mediaById.size !== manifest.files.filter((file) => file.kind === 'media').length) throw new Error('PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH')
    const remappedArtifactHashes = new Map(remapped.artifactVersions.map((artifact) => [artifact.id, sha256(Buffer.from(JSON.stringify(artifact.content), 'utf8'))]))
    const snapshot = ProjectSnapshotSchema.parse({
      ...remapped,
      project: { ...remapped.project, id: projectId, name, status: 'active', createdAt: timestamp, updatedAt: timestamp },
      tasks: normalized.tasks,
      media: remapped.media.map((media, index) => {
        const source = original.media[index]
        const declaredFile = source ? mediaById.get(source.id) : undefined
        if (!source || !declaredFile) throw new Error('PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH')
        if (declaredFile.sha256 !== source.sha256 || declaredFile.size !== source.size || declaredFile.mime !== source.mime) throw new Error('PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH')
        return { ...media, locator: `${media.id}${extname(declaredFile.path)}` }
      }),
      artifactVersions: remapped.artifactVersions.map((artifact) => ({
        ...artifact,
        contentHash: remappedArtifactHashes.get(artifact.id),
        dependencies: artifact.dependencies.map((dependency) => ({
          ...dependency,
          contentHash: remappedArtifactHashes.get(dependency.artifactVersionId) ?? dependency.contentHash,
        })),
      })),
    })

    const stagingDirectory = join(resolve(this.dataDirectory), 'imports', randomUUID())
    const finalDirectory = join(resolve(this.dataDirectory), 'media', projectId)
    await mkdir(stagingDirectory, { recursive: true })
    try {
      for (let index = 0; index < original.media.length; index += 1) {
        const source = original.media[index]!
        const target = snapshot.media[index]!
        const declaredFile = mediaById.get(source.id)
        const data = declaredFile ? entries.get(declaredFile.path) : undefined
        if (!declaredFile || !data) throw new Error('PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH')
        await writeFile(join(stagingDirectory, target.locator), data, { flag: 'wx' })
      }
      this.database.importSnapshot(snapshot)
      await mkdir(join(resolve(this.dataDirectory), 'media'), { recursive: true })
      try { await rename(stagingDirectory, finalDirectory) } catch (error) {
        this.database.deleteProject(projectId)
        throw error
      }
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true })
      throw error
    }
    const warnings = normalized.interrupted > 0 ? [`${normalized.interrupted} 个未完成任务已标记为 orphaned，不会自动重复提交。`] : []
    return ProjectPackageImportReportSchema.parse({
      project: snapshot.project, formatVersion: manifest.formatVersion, bundleKind: 'project', fileCount: manifest.files.length,
      mediaCount: snapshot.media.length, totalBytes, remappedEntityCount: idMap.size, warnings,
    })
  }

  private async importSeriesEntries(
    entries: Map<string, Buffer>,
    manifest: ProjectPackageManifestV2,
    totalBytes: number,
    requestedName?: string,
  ): Promise<ProjectPackageImportReport> {
    const seriesData = entries.get('series.json')
    if (!seriesData) throw new Error('PROJECT_PACKAGE_REQUIRED_ENTRY_MISSING')
    let original: SeriesPackagePayload
    try { original = SeriesPackagePayloadSchema.parse(JSON.parse(seriesData.toString('utf8'))) } catch { throw new Error('PROJECT_PACKAGE_SCHEMA_INVALID') }
    if (manifest.sourceSeriesId !== original.series.id) throw new Error('PROJECT_PACKAGE_PROJECT_MISMATCH')
    const ids = new Set<string>([original.series.id, ...original.episodes.map((episode) => episode.id)])
    for (const snapshot of original.projects) for (const id of entityIds(snapshot)) ids.add(id)
    for (const asset of original.sharedAssets) { ids.add(asset.id); ids.add(asset.logicalId) }
    for (const variant of original.sharedVariants) ids.add(variant.id)
    for (const media of original.sharedMediaReferences) ids.add(media.id)
    const idMap = new Map([...ids].map((id) => [id, randomUUID()]))
    const remapped = remapValue(original, idMap) as SeriesPackagePayload
    const timestamp = new Date().toISOString()
    const seriesId = idMap.get(original.series.id)
    if (!seriesId) throw new Error('PROJECT_PACKAGE_ID_REMAP_FAILED')
    const normalizedSeries = { ...remapped.series, id: seriesId, name: requestedName?.trim() || `${original.series.name}（导入）`, createdAt: timestamp, updatedAt: timestamp }
    const normalizedSharedAssets = remapped.sharedAssets.map((asset) => asset.scope === 'global' ? {
      ...asset, scope: 'series' as const, seriesId,
      metadata: { ...asset.metadata, portablePinnedFromScope: 'global' },
    } : { ...asset, seriesId })
    const normalizedSharedMediaReferences = remapped.sharedMediaReferences.map((media, index) => {
      const source = original.sharedMediaReferences[index]
      if (!source) throw new Error('PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH')
      return { ...media, locator: `${media.id}${extname(source.locator)}` }
    })
    let interrupted = 0
    const projects = remapped.projects.map((snapshot) => {
      const normalizedTasks = normalizeImportedTasks(snapshot.tasks)
      interrupted += normalizedTasks.interrupted
      const artifactHashes = new Map(snapshot.artifactVersions.map((artifact) => [artifact.id, sha256(Buffer.from(JSON.stringify(artifact.content), 'utf8'))]))
      return ProjectSnapshotSchema.parse({
        ...snapshot,
        project: { ...snapshot.project, status: 'active', createdAt: timestamp, updatedAt: timestamp },
        series: normalizedSeries,
        tasks: normalizedTasks.tasks,
        media: snapshot.media.map((media) => ({ ...media, locator: `${media.id}${extname(media.locator)}` })),
        artifactVersions: snapshot.artifactVersions.map((artifact) => ({
          ...artifact, contentHash: artifactHashes.get(artifact.id),
          dependencies: artifact.dependencies.map((dependency) => ({ ...dependency, contentHash: artifactHashes.get(dependency.artifactVersionId) ?? dependency.contentHash })),
        })),
      })
    })
    const mediaById = new Map(manifest.files.filter((file) => file.kind === 'media' && file.mediaId).map((file) => [file.mediaId!, file]))
    const sharedMediaById = new Map(manifest.files.filter((file) => file.kind === 'shared-media' && file.mediaId).map((file) => [file.mediaId!, file]))
    if (sharedMediaById.size !== original.sharedMediaReferences.length) throw new Error('PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH')
    const stagingRoot = join(resolve(this.dataDirectory), 'imports', randomUUID())
    await mkdir(stagingRoot, { recursive: true })
    const finalDirectories: string[] = []
    const finalSharedPaths: string[] = []
    try {
      for (let projectIndex = 0; projectIndex < original.projects.length; projectIndex += 1) {
        const sourceSnapshot = original.projects[projectIndex]!
        const targetSnapshot = projects[projectIndex]!
        const stageProject = join(stagingRoot, targetSnapshot.project.id)
        await mkdir(stageProject, { recursive: true })
        for (let mediaIndex = 0; mediaIndex < sourceSnapshot.media.length; mediaIndex += 1) {
          const sourceMedia = sourceSnapshot.media[mediaIndex]!
          const targetMedia = targetSnapshot.media[mediaIndex]!
          const declared = mediaById.get(sourceMedia.id)
          const data = declared ? entries.get(declared.path) : undefined
          if (!declared || !data || declared.sha256 !== sourceMedia.sha256 || declared.mime !== sourceMedia.mime) throw new Error('PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH')
          await writeFile(join(stageProject, targetMedia.locator), data, { flag: 'wx' })
        }
      }
      const stageShared = join(stagingRoot, 'shared')
      await mkdir(stageShared, { recursive: true })
      for (let mediaIndex = 0; mediaIndex < original.sharedMediaReferences.length; mediaIndex += 1) {
        const sourceMedia = original.sharedMediaReferences[mediaIndex]!
        const targetMedia = normalizedSharedMediaReferences[mediaIndex]!
        const declared = sharedMediaById.get(sourceMedia.id)
        const data = declared ? entries.get(declared.path) : undefined
        if (!declared || !data || declared.sha256 !== sourceMedia.sha256 || declared.mime !== sourceMedia.mime || data.byteLength !== sourceMedia.size) {
          throw new Error('PROJECT_PACKAGE_MEDIA_MANIFEST_MISMATCH')
        }
        await writeFile(join(stageShared, targetMedia.locator), data, { flag: 'wx' })
      }
      const sharedDirectory = join(resolve(this.dataDirectory), 'media', 'shared')
      await mkdir(sharedDirectory, { recursive: true })
      for (const targetMedia of normalizedSharedMediaReferences) {
        const finalPath = join(sharedDirectory, targetMedia.locator)
        await rename(join(stageShared, targetMedia.locator), finalPath)
        finalSharedPaths.push(finalPath)
      }
      this.database.transaction(() => {
        this.database.importSeries(normalizedSeries)
        for (const media of normalizedSharedMediaReferences) this.database.importSharedMediaReference(media)
        for (const asset of normalizedSharedAssets) {
          this.database.importSharedAsset(asset, remapped.sharedVariants.filter((variant) => variant.sharedAssetId === asset.id))
        }
        for (const snapshot of projects) this.database.importSnapshot(snapshot)
      })
      await mkdir(join(resolve(this.dataDirectory), 'media'), { recursive: true })
      for (const snapshot of projects) {
        const finalDirectory = join(resolve(this.dataDirectory), 'media', snapshot.project.id)
        await rename(join(stagingRoot, snapshot.project.id), finalDirectory)
        finalDirectories.push(finalDirectory)
      }
    } catch (error) {
      this.database.transaction(() => {
        for (const snapshot of projects) this.database.deleteProject(snapshot.project.id)
        this.database.raw.prepare('DELETE FROM shared_asset_variants WHERE shared_asset_id IN (SELECT id FROM shared_assets WHERE series_id = ?)').run(seriesId)
        this.database.raw.prepare('DELETE FROM shared_assets WHERE series_id = ?').run(seriesId)
        for (const media of normalizedSharedMediaReferences) this.database.raw.prepare('DELETE FROM shared_media_references WHERE id = ?').run(media.id)
        this.database.raw.prepare('DELETE FROM series WHERE id = ?').run(seriesId)
      })
      await Promise.all(finalDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
      await Promise.all(finalSharedPaths.map((path) => rm(path, { force: true })))
      await rm(stagingRoot, { recursive: true, force: true })
      throw error
    }
    await rm(stagingRoot, { recursive: true, force: true })
    const importedProjects = projects.map((snapshot) => snapshot.project)
    const firstProject = importedProjects[0]
    if (!firstProject) throw new Error('PROJECT_PACKAGE_SCHEMA_INVALID')
    const warnings = interrupted > 0 ? [`${interrupted} 个未完成任务已标记为 orphaned，不会自动重复提交。`] : []
    return ProjectPackageImportReportSchema.parse({
      project: firstProject, series: normalizedSeries, projects: importedProjects,
      formatVersion: 2, bundleKind: 'series', fileCount: manifest.files.length,
      mediaCount: projects.reduce((sum, snapshot) => sum + snapshot.media.length, 0) + normalizedSharedMediaReferences.length, totalBytes,
      remappedEntityCount: idMap.size, warnings,
    })
  }
}
