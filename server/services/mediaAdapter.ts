import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as modelCatalog from './modelCatalog'
import { normalizeMediaReference } from './assetDomain'
import { assertSafeRemoteUrl, type RemoteLookup } from './remoteMedia'
import { UPLOADS_ROOT } from '../utils/fileCleanup'

type JsonObject = Record<string, unknown>
type MediaKind = 'project_media' | 'local_file' | 'object_key' | 'public_url'

interface MediaReference extends JsonObject {
  kind: MediaKind
  url: string
  media_id?: string | number | null
  content_hash?: string
}

interface ResolveInput {
  provider: string
  model: string
  reference: unknown
}

interface ResolvedMedia extends JsonObject {
  kind: 'public_url' | 'data_url'
  transient_value: string
  snapshot: JsonObject
}

export class MediaAdapterError extends Error {
  readonly code: string
  readonly status = 400
  readonly retryable = false
  readonly details: JsonObject

  constructor(code: string, message: string, details: JsonObject = {}) {
    super(message)
    this.name = 'MediaAdapterError'
    this.code = code
    this.details = details
  }
}

function imageMime(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
  return ''
}

function adapterError(code: string, message: string, details: JsonObject = {}): never {
  throw new MediaAdapterError(code, message, details)
}

function validatedReference(value: unknown): MediaReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) adapterError('MEDIA_REFERENCE_INVALID', '媒体引用格式无效')
  const raw = Object.fromEntries(Object.entries(value))
  const kind = raw.kind
  if (!['project_media', 'local_file', 'object_key', 'public_url'].includes(String(kind))) {
    adapterError('MEDIA_REFERENCE_INVALID', '媒体引用类型无效')
  }
  return {
    ...raw,
    kind: String(kind) === 'public_url' ? 'public_url'
      : String(kind) === 'object_key' ? 'object_key'
        : String(kind) === 'local_file' ? 'local_file' : 'project_media',
    url: String(raw.url || ''),
    media_id: typeof raw.media_id === 'string' || typeof raw.media_id === 'number' ? raw.media_id : null,
    content_hash: typeof raw.content_hash === 'string' ? raw.content_hash : '',
  }
}

export function createMediaAdapter({
  uploadDir = UPLOADS_ROOT,
  maxInputBytes = 9 * 1024 * 1024,
  lookup,
  objectResolver = null,
}: {
  uploadDir?: string
  maxInputBytes?: number
  lookup?: RemoteLookup
  objectResolver?: ((reference: MediaReference) => Promise<unknown> | unknown) | null
} = {}) {
  const root = path.resolve(uploadDir)

  function managedPath(reference: MediaReference): string {
    const relativeUrl = reference.url
    if (!relativeUrl.startsWith('/uploads/')) adapterError('MEDIA_REFERENCE_INVALID', '媒体不在受管 uploads 目录')
    const absolute = path.resolve(root, relativeUrl.slice('/uploads/'.length))
    const relative = path.relative(root, absolute)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) adapterError('MEDIA_REFERENCE_INVALID', '媒体路径越过受管 uploads 目录')
    return absolute
  }

  async function resolveForModel({ provider, model, reference }: ResolveInput): Promise<ResolvedMedia> {
    const initial = modelCatalog.get(provider, model)
    const requiredCapability = initial?.modality === 'video' ? 'image_to_video' : 'reference_image'
    const definition = modelCatalog.assertSelection({ provider, model, requires: [requiredCapability] })
    const referenceRecord = reference !== null && typeof reference === 'object' && !Array.isArray(reference)
      ? Object.fromEntries(Object.entries(reference))
      : {}
    const normalized = validatedReference(normalizeMediaReference(referenceRecord))

    if (normalized.kind === 'public_url') {
      if (!definition.accepted_media_references.includes('public_url')) adapterError('MEDIA_DELIVERY_UNSUPPORTED', `模型 ${definition.id} 不接受公开 URL 媒体`)
      await assertSafeRemoteUrl(normalized.url, lookup ? { lookup } : undefined)
      return {
        kind: 'public_url',
        transient_value: normalized.url,
        snapshot: {
          source_kind: normalized.kind,
          source_url: normalized.url,
          media_id: normalized.media_id,
          content_hash: normalized.content_hash || '',
        },
      }
    }

    if (normalized.kind === 'object_key') {
      if (!objectResolver) adapterError('MEDIA_DELIVERY_UNSUPPORTED', '当前安装未配置对象存储媒体解析器')
      const resolved = await objectResolver(normalized)
      return resolveForModel({ provider, model, reference: resolved })
    }

    if (!definition.accepted_media_references.includes('data_url')) adapterError('MEDIA_DELIVERY_UNSUPPORTED', `模型 ${definition.id} 不接受本地媒体输入`)
    const absolute = managedPath(normalized)
    let stat: fs.Stats
    try { stat = fs.statSync(absolute) } catch { adapterError('MEDIA_INPUT_MISSING', '媒体文件不存在或不可读', { source_url: normalized.url }) }
    if (!stat.isFile()) adapterError('MEDIA_INPUT_INVALID', '媒体引用不是普通文件')
    if (stat.size > maxInputBytes) adapterError('MEDIA_INPUT_TOO_LARGE', `媒体超过输入上限 ${maxInputBytes} 字节`, { bytes: stat.size, max_bytes: maxInputBytes })
    const bytes = fs.readFileSync(absolute)
    const mime = imageMime(bytes)
    if (!mime) adapterError('MEDIA_SIGNATURE_INVALID', '媒体内容不是受支持的 PNG/JPEG/WebP/GIF 图片')
    const contentHash = crypto.createHash('sha256').update(bytes).digest('hex')
    return {
      kind: 'data_url',
      transient_value: `data:${mime};base64,${bytes.toString('base64')}`,
      snapshot: {
        source_kind: normalized.kind,
        source_url: normalized.url,
        media_id: normalized.media_id,
        mime,
        bytes: stat.size,
        content_hash: normalized.content_hash || contentHash,
      },
    }
  }

  return { resolveForModel }
}

export const mediaAdapter = createMediaAdapter()
