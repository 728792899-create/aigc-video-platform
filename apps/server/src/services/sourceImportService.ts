import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { z } from 'zod'
import {
  IdSchema,
  SourceImportCancelReportSchema,
  SourceImportCommitSchema,
  SourceImportPreviewSchema,
  type ProjectSnapshot,
  type SourceImportCancelReport,
  type SourceImportCommit,
  type SourceImportFormat,
  type SourceImportPreview,
} from '@aigc-director/contracts'
import { detectChapterHeadings } from '@aigc-director/domain'
import type { DirectorDatabase } from '../db/database.js'
import type { DirectorService } from './directorService.js'

const MAX_BYTES = 6 * 1024 * 1024
const MAX_CHARACTERS = 2_000_000
const PREVIEW_CHARACTERS = 20_000
const PREVIEW_TTL_MS = 30 * 60 * 1_000

const metadataSchema = SourceImportPreviewSchema.extend({
  status: z.enum(['active', 'consumed']),
  declaredMime: z.string().max(160),
  commitFingerprint: z.string().length(64).optional(),
  importedSourceId: IdSchema.optional(),
})
type ImportMetadata = z.infer<typeof metadataSchema>

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

function decodeSource(buffer: Buffer): string {
  if (buffer.includes(0)) throw new Error('SOURCE_IMPORT_BINARY_REJECTED')
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('SOURCE_IMPORT_ENCODING_UNSUPPORTED')
  }
  const content = decoded.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').normalize('NFC')
  if (/\0|[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(content)) throw new Error('SOURCE_IMPORT_BINARY_REJECTED')
  if (content.trim().length < 4) throw new Error('SOURCE_IMPORT_CONTENT_TOO_SHORT')
  if (content.length > MAX_CHARACTERS) throw new Error('SOURCE_IMPORT_CHARACTER_LIMIT')
  return content
}

function classifyFileName(originalName: string): { safeName: string; format: SourceImportFormat } {
  if (!originalName || originalName.length > 255 || originalName !== basename(originalName) || /[\u0000-\u001F\u007F/\\]/u.test(originalName)) throw new Error('SOURCE_IMPORT_FILENAME_UNSAFE')
  const extension = extname(originalName).toLowerCase()
  if (!['.txt', '.md', '.markdown'].includes(extension)) throw new Error('SOURCE_IMPORT_EXTENSION_UNSUPPORTED')
  return { safeName: originalName, format: extension === '.txt' ? 'text' : 'markdown' }
}

function titleFromFile(fileName: string, chapterTitles: string[]): string {
  const stem = basename(fileName, extname(fileName)).trim().slice(0, 200)
  return (chapterTitles[0] ?? (stem || '导入文本')).slice(0, 200)
}

export class SourceImportService {
  private readonly quarantineDirectory: string

  constructor(
    private readonly db: DirectorDatabase,
    private readonly director: DirectorService,
    dataDirectory: string,
  ) {
    this.quarantineDirectory = join(resolve(dataDirectory), 'quarantine', 'source-imports')
  }

  async preview(projectId: string, file: { originalName: string; declaredMime: string; buffer: Buffer }): Promise<SourceImportPreview> {
    if (!this.db.getProject(projectId)) throw new Error('PROJECT_NOT_FOUND')
    if (file.buffer.byteLength < 4) throw new Error('SOURCE_IMPORT_CONTENT_TOO_SHORT')
    if (file.buffer.byteLength > MAX_BYTES) throw new Error('SOURCE_IMPORT_FILE_TOO_LARGE')
    const { safeName, format } = classifyFileName(file.originalName)
    const content = decodeSource(file.buffer)
    const headings = detectChapterHeadings(content).slice(0, 100)
    const warnings: string[] = []
    const expectedMimes = format === 'markdown' ? new Set(['text/markdown', 'text/plain', 'application/octet-stream']) : new Set(['text/plain', 'application/octet-stream'])
    if (file.declaredMime && !expectedMimes.has(file.declaredMime.toLowerCase())) warnings.push('浏览器声明的 MIME 与扩展名不一致；已按实际 UTF-8 文本内容隔离处理。')
    const preview = SourceImportPreviewSchema.parse({
      id: randomUUID(), projectId, originalFileName: safeName, format, encoding: 'utf-8',
      byteSize: file.buffer.byteLength, characterCount: content.length, contentHash: sha256(content),
      suggestedTitle: titleFromFile(safeName, headings.map((heading) => heading.title)),
      previewText: content.slice(0, PREVIEW_CHARACTERS), previewTruncated: content.length > PREVIEW_CHARACTERS,
      chapterTitles: headings.map((heading) => heading.title), warnings,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    })
    const metadata = metadataSchema.parse({ ...preview, status: 'active', declaredMime: file.declaredMime || 'application/octet-stream' })
    await mkdir(this.quarantineDirectory, { recursive: true, mode: 0o700 })
    await this.cleanupExpired()
    const contentPath = this.contentPath(preview.id)
    try {
      await writeFile(contentPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await writeFile(this.metadataPath(preview.id), JSON.stringify(metadata), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    } catch (error) {
      await this.safeUnlink(contentPath)
      await this.safeUnlink(this.metadataPath(preview.id))
      throw error
    }
    return preview
  }

  async commit(projectId: string, importId: string, rawInput: SourceImportCommit): Promise<{ snapshot: ProjectSnapshot; repeated: boolean }> {
    const input = SourceImportCommitSchema.parse(rawInput)
    const metadata = await this.readMetadata(importId)
    this.assertProject(metadata, projectId)
    const fingerprint = sha256(JSON.stringify({ title: input.title, language: input.language, contentHash: input.expectedContentHash }))
    if (metadata.status === 'consumed') {
      if (metadata.commitFingerprint !== fingerprint) throw new Error('SOURCE_IMPORT_ALREADY_CONSUMED')
      return { snapshot: this.db.snapshot(projectId), repeated: true }
    }
    if (Date.parse(metadata.expiresAt) <= Date.now()) {
      await this.removeFiles(importId)
      throw new Error('SOURCE_IMPORT_EXPIRED')
    }
    if (metadata.contentHash !== input.expectedContentHash) throw new Error('SOURCE_IMPORT_HASH_MISMATCH')
    const content = decodeSource(await readFile(this.contentPath(importId)))
    if (sha256(content) !== metadata.contentHash) throw new Error('SOURCE_IMPORT_HASH_MISMATCH')
    const snapshot = this.director.importSource(
      projectId,
      { title: input.title, content, language: input.language },
      { idempotencyKey: `source-import:${importId}`, fingerprint },
    )
    const importedSourceId = snapshot.sources.find((source) => source.contentHash === metadata.contentHash && source.title === input.title)?.id
    const consumed = metadataSchema.parse({ ...metadata, status: 'consumed', commitFingerprint: fingerprint, ...(importedSourceId ? { importedSourceId } : {}) })
    await this.writeMetadata(consumed)
    await this.safeUnlink(this.contentPath(importId))
    return { snapshot, repeated: false }
  }

  async cancel(projectId: string, importId: string): Promise<SourceImportCancelReport> {
    const metadata = await this.readMetadata(importId)
    this.assertProject(metadata, projectId)
    if (metadata.status === 'consumed') throw new Error('SOURCE_IMPORT_ALREADY_CONSUMED')
    await this.removeFiles(importId)
    return SourceImportCancelReportSchema.parse({ id: importId, status: 'cancelled' })
  }

  private assertProject(metadata: ImportMetadata, projectId: string): void {
    if (metadata.projectId !== projectId) throw new Error('SOURCE_IMPORT_PROJECT_MISMATCH')
    if (!this.db.getProject(projectId)) throw new Error('PROJECT_NOT_FOUND')
  }

  private async readMetadata(importId: string): Promise<ImportMetadata> {
    IdSchema.parse(importId)
    let raw: string
    try {
      raw = await readFile(this.metadataPath(importId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('SOURCE_IMPORT_NOT_FOUND')
      throw error
    }
    try { return metadataSchema.parse(JSON.parse(raw)) } catch { throw new Error('SOURCE_IMPORT_QUARANTINE_CORRUPT') }
  }

  private async writeMetadata(metadata: ImportMetadata): Promise<void> {
    const target = this.metadataPath(metadata.id)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(metadata), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  }

  private async cleanupExpired(): Promise<void> {
    let entries: string[]
    try { entries = await readdir(this.quarantineDirectory) } catch { return }
    await Promise.all(entries.filter((entry) => /^[a-f0-9-]+\.json$/u.test(entry)).map(async (entry) => {
      const id = entry.slice(0, -5)
      try {
        const metadata = metadataSchema.parse(JSON.parse(await readFile(this.metadataPath(id), 'utf8')))
        if (Date.parse(metadata.expiresAt) <= Date.now()) await this.removeFiles(id)
      } catch { /* Corrupt quarantine entries are never trusted or imported. */ }
    }))
  }

  private async removeFiles(importId: string): Promise<void> {
    await Promise.all([this.safeUnlink(this.contentPath(importId)), this.safeUnlink(this.metadataPath(importId))])
  }

  private async safeUnlink(path: string): Promise<void> {
    try { await unlink(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }

  private contentPath(importId: string): string { return join(this.quarantineDirectory, `${importId}.source`) }
  private metadataPath(importId: string): string { return join(this.quarantineDirectory, `${importId}.json`) }
}
