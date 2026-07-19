import { createHash, randomUUID } from 'node:crypto'
import { basename, extname, join, resolve } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import {
  MediaReferenceSchema,
  SharedMediaReferenceSchema,
  type MediaReference,
  type SharedAssetVariant,
} from '@aigc-director/contracts'
import type { DirectorDatabase } from '../db/database.js'

function verifyBytes(data: Buffer, expected: { size: number; sha256: string }): void {
  if (data.byteLength !== expected.size || createHash('sha256').update(data).digest('hex') !== expected.sha256) {
    throw new Error('ASSET_MEDIA_HASH_MISMATCH')
  }
}

function safeExtension(locator: string): string {
  if (basename(locator) !== locator) throw new Error('ASSET_MEDIA_PATH_INVALID')
  const extension = extname(locator).slice(1).toLowerCase()
  if (!/^[a-z0-9]{1,8}$/u.test(extension)) throw new Error('ASSET_MEDIA_PATH_INVALID')
  return extension
}

export class SharedAssetMediaService {
  private readonly mediaRoot: string

  constructor(private readonly database: DirectorDatabase, dataDirectory: string) {
    this.mediaRoot = join(resolve(dataDirectory), 'media')
  }

  async promoteLocalAsset(
    projectId: string,
    assetId: string,
    variantId: string,
    target: { scope: 'global' | 'series'; seriesId?: string },
  ): Promise<ReturnType<DirectorDatabase['promoteLocalAsset']>> {
    const variant = this.database.get<{ id: string; assetId: string; mediaId?: string }>('asset_variants', variantId)
    if (!variant || variant.assetId !== assetId) throw new Error('ASSET_VARIANT_NOT_FOUND')
    if (!variant.mediaId) return this.database.promoteLocalAsset(projectId, assetId, variantId, target)
    const media = this.database.get<MediaReference>('media_references', variant.mediaId)
    if (!media || media.projectId !== projectId || media.storage !== 'managed-file') throw new Error('ASSET_MEDIA_NOT_FOUND')
    const extension = safeExtension(media.locator)
    const data = await readFile(join(this.mediaRoot, projectId, media.locator)).catch(() => { throw new Error('ASSET_MEDIA_NOT_FOUND') })
    verifyBytes(data, media)
    const sharedMediaId = randomUUID()
    const locator = `${sharedMediaId}.${extension}`
    const sharedDirectory = join(this.mediaRoot, 'shared')
    await mkdir(sharedDirectory, { recursive: true })
    const temporary = join(sharedDirectory, `.${locator}.${randomUUID()}.tmp`)
    const finalPath = join(sharedDirectory, locator)
    await writeFile(temporary, data, { flag: 'wx' })
    await rename(temporary, finalPath)
    const sharedMedia = SharedMediaReferenceSchema.parse({
      id: sharedMediaId, kind: media.kind, storage: 'managed-file', locator, mime: media.mime,
      size: media.size, sha256: media.sha256, createdAt: new Date().toISOString(),
    })
    const mediaSnapshot: NonNullable<SharedAssetVariant['mediaSnapshot']> = {
      sharedMediaId, kind: media.kind, mime: media.mime, size: media.size, sha256: media.sha256,
    }
    try {
      return this.database.transaction(() => {
        this.database.putSharedMediaReference(sharedMedia)
        return this.database.promoteLocalAsset(projectId, assetId, variantId, { ...target, mediaSnapshot })
      })
    } catch (error) {
      await rm(finalPath, { force: true })
      throw error
    }
  }

  async forkSharedAsset(
    projectId: string,
    sharedAssetId: string,
    sharedVariantId: string,
  ): Promise<ReturnType<DirectorDatabase['forkSharedAsset']>> {
    const variant = this.database.getSharedAssetVariant(sharedVariantId)
    if (!variant || variant.sharedAssetId !== sharedAssetId) throw new Error('ASSET_VARIANT_NOT_FOUND')
    if (!variant.mediaSnapshot) return this.database.forkSharedAsset(projectId, sharedAssetId, sharedVariantId)
    const sharedMedia = this.database.getSharedMediaReference(variant.mediaSnapshot.sharedMediaId)
    if (!sharedMedia || sharedMedia.storage !== 'managed-file') throw new Error('ASSET_MEDIA_NOT_FOUND')
    const extension = safeExtension(sharedMedia.locator)
    const data = await readFile(join(this.mediaRoot, 'shared', sharedMedia.locator)).catch(() => { throw new Error('ASSET_MEDIA_NOT_FOUND') })
    verifyBytes(data, sharedMedia)
    const mediaId = randomUUID()
    const locator = `${mediaId}.${extension}`
    const projectDirectory = join(this.mediaRoot, projectId)
    await mkdir(projectDirectory, { recursive: true })
    const temporary = join(projectDirectory, `.${locator}.${randomUUID()}.tmp`)
    const finalPath = join(projectDirectory, locator)
    await writeFile(temporary, data, { flag: 'wx' })
    await rename(temporary, finalPath)
    const media = MediaReferenceSchema.parse({
      id: mediaId, projectId, kind: sharedMedia.kind, storage: 'managed-file', locator,
      mime: sharedMedia.mime, size: sharedMedia.size, sha256: sharedMedia.sha256, createdAt: new Date().toISOString(),
    })
    try {
      return this.database.forkSharedAsset(projectId, sharedAssetId, sharedVariantId, media)
    } catch (error) {
      await rm(finalPath, { force: true })
      throw error
    }
  }

  async deleteSharedAsset(assetId: string): Promise<boolean> {
    const media = this.database.listSharedAssetVariants(assetId)
      .flatMap((variant) => variant.mediaSnapshot ? [this.database.getSharedMediaReference(variant.mediaSnapshot.sharedMediaId)] : [])
      .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference))
    const deleted = this.database.deleteSharedAsset(assetId)
    if (deleted) await Promise.all(media.map(async (reference) => {
      await rm(join(this.mediaRoot, 'shared', reference.locator), { force: true }).catch(() => undefined)
    }))
    return deleted
  }
}
