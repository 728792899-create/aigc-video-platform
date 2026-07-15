import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns/promises'
import net from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'

type MediaKind = 'image' | 'video'
type MediaFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'mp4'
type Headers = http.OutgoingHttpHeaders

export type RemoteLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>

interface RemoteTarget {
  url: URL
  address: string
  family: number
}

interface OpenOptions {
  headers?: Headers
  timeoutMs?: number
  idleTimeoutMs?: number
}

interface RemoteResponse {
  statusCode: number
  headers: http.IncomingHttpHeaders | Headers
  stream: Readable
  abort(error?: Error): void
}

type RemoteOpen = (target: RemoteTarget, options?: OpenOptions) => Promise<RemoteResponse>

interface DownloadOptions extends OpenOptions {
  kind?: MediaKind
  destination: string
  maxBytes?: number
  maxRedirects?: number
  normalizeExtension?: boolean
}

interface DownloadResult {
  destination: string
  bytes: number
  contentType: string
  format: MediaFormat
  finalUrl: string
}

const DEFAULT_LIMITS: Readonly<Record<MediaKind, number>> = Object.freeze({
  image: 50 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
})

const MIME: Readonly<Record<MediaKind, ReadonlySet<string>>> = Object.freeze({
  image: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'application/octet-stream']),
  video: new Set(['video/mp4', 'application/mp4', 'application/octet-stream']),
})

interface RemoteMediaErrorOptions {
  retryable?: boolean
  cause?: unknown
}

export class RemoteMediaError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, { retryable = false, cause }: RemoteMediaErrorOptions = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'RemoteMediaError'
    this.code = code
    this.retryable = retryable
  }
}

function fail(code: string, message: string, options: RemoteMediaErrorOptions = {}): never {
  throw new RemoteMediaError(code, message, options)
}

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  const [a = 0, b = 0, c = 0, d = 0] = parts
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0
}

function inV4Range(value: number, base: number, prefix: number): boolean {
  const shift = 32 - prefix
  return (value >>> shift) === (base >>> shift)
}

function isForbiddenIpv4(address: string): boolean {
  const value = ipv4Number(address)
  if (value == null) return true
  const ranges: Array<readonly [string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ]
  return ranges.some(([baseAddress, prefix]) => {
    const base = ipv4Number(baseAddress)
    return base == null || inV4Range(value, base, prefix)
  })
}

function ipv6Bytes(address: string): Buffer | null {
  let value = address.toLowerCase().split('%')[0]?.replace(/^\[|\]$/g, '') || ''
  const ipv4Tail = value.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (ipv4Tail) {
    const v4 = ipv4Number(ipv4Tail)
    if (v4 == null) return null
    value = value.slice(0, -ipv4Tail.length) + `${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const halves = value.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const words = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right]
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null
  return Buffer.from(words.flatMap((word) => {
    const number = parseInt(word, 16)
    return [number >>> 8, number & 0xff]
  }))
}

function isForbiddenIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address)
  if (!bytes) return true
  const byte = (index: number): number => bytes[index] ?? 0
  const allZero = bytes.every((item) => item === 0)
  const loopback = bytes.subarray(0, 15).every((item) => item === 0) && byte(15) === 1
  const uniqueLocal = (byte(0) & 0xfe) === 0xfc
  const linkLocal = byte(0) === 0xfe && (byte(1) & 0xc0) === 0x80
  const multicast = byte(0) === 0xff
  const documentation = byte(0) === 0x20 && byte(1) === 0x01 && byte(2) === 0x0d && byte(3) === 0xb8
  const mappedV4 = bytes.subarray(0, 10).every((item) => item === 0) && byte(10) === 0xff && byte(11) === 0xff
  const compatibleV4 = bytes.subarray(0, 12).every((item) => item === 0)
  const nat64V4 = bytes.subarray(0, 12).equals(Buffer.from([0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0]))
  if (mappedV4 || compatibleV4 || nat64V4) return isForbiddenIpv4(Array.from(bytes.subarray(12)).join('.'))
  return allZero || loopback || uniqueLocal || linkLocal || multicast || documentation
}

export function isForbiddenAddress(address: unknown): boolean {
  const normalized = String(address || '').replace(/^\[|\]$/g, '')
  const family = net.isIP(normalized)
  if (family === 4) return isForbiddenIpv4(normalized)
  if (family === 6) return isForbiddenIpv6(normalized)
  return true
}

const defaultLookup: RemoteLookup = (hostname, options) => dns.lookup(hostname, options)

export async function assertSafeRemoteUrl(
  input: unknown,
  { lookup = defaultLookup }: { lookup?: RemoteLookup } = {},
): Promise<RemoteTarget> {
  let url: URL
  try { url = new URL(String(input || '')) } catch { fail('MEDIA_URL_INVALID', '远程媒体 URL 格式无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('MEDIA_URL_FORBIDDEN', '远程媒体只允许不含凭证的 HTTP/HTTPS URL')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    fail('MEDIA_URL_FORBIDDEN', '远程媒体地址不允许指向本机或内部域名')
  }

  const directFamily = net.isIP(hostname)
  let addresses: Array<{ address: string; family: number }>
  if (directFamily) addresses = [{ address: hostname, family: directFamily }]
  else {
    try { addresses = await lookup(hostname, { all: true, verbatim: true }) }
    catch (cause: unknown) { throw new RemoteMediaError('MEDIA_DNS_FAILED', '远程媒体域名解析失败', { retryable: true, cause }) }
  }
  if (!addresses.length || addresses.some((item) => isForbiddenAddress(item.address))) fail('MEDIA_URL_FORBIDDEN', '远程媒体地址解析到本机、私网或保留网络')
  const selected = addresses[0]
  if (!selected) fail('MEDIA_DNS_FAILED', '远程媒体域名无可用地址', { retryable: true })
  return { url, address: selected.address, family: Number(selected.family) || net.isIP(selected.address) }
}

async function openPinned(target: RemoteTarget, { headers = {}, timeoutMs = 120000, idleTimeoutMs = 30000 }: OpenOptions = {}): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    const lib = target.url.protocol === 'https:' ? https : http
    let hardTimer: NodeJS.Timeout | undefined
    const request = lib.request(target.url, {
      method: 'GET',
      headers,
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [{ address: target.address, family: target.family }])
        else callback(null, target.address, target.family)
      },
      ...(target.url.protocol === 'https:' && !net.isIP(target.url.hostname.replace(/^\[|\]$/g, '')) ? { servername: target.url.hostname } : {}),
    }, (response) => {
      const clear = (): void => { if (hardTimer) clearTimeout(hardTimer) }
      response.once('end', clear)
      response.once('close', clear)
      response.once('error', clear)
      resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers || {},
        stream: response,
        abort: (error?: Error) => request.destroy(error),
      })
    })
    request.once('error', (cause: Error) => {
      if (hardTimer) clearTimeout(hardTimer)
      reject(new RemoteMediaError('MEDIA_NETWORK_ERROR', '远程媒体下载失败', { retryable: true, cause }))
    })
    request.setTimeout(idleTimeoutMs, () => request.destroy(new RemoteMediaError('MEDIA_TIMEOUT', '远程媒体数据流超时', { retryable: true })))
    hardTimer = setTimeout(() => request.destroy(new RemoteMediaError('MEDIA_TIMEOUT', '远程媒体下载超过总时限', { retryable: true })), timeoutMs)
    hardTimer.unref()
    request.end()
  })
}

function headerValue(headers: RemoteResponse['headers'], name: string): string | number | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' || typeof first === 'number' ? first : undefined
}

function detectFormat(kind: MediaKind, bytes: Buffer): MediaFormat | null {
  if (kind === 'video') return bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' ? 'mp4' : null
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'gif'
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'))) return 'avif'
  return null
}

const MIME_FORMAT: Readonly<Record<string, MediaFormat>> = Object.freeze({
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'video/mp4': 'mp4', 'application/mp4': 'mp4',
})
const FORMAT_EXTENSION: Readonly<Record<MediaFormat, string>> = Object.freeze({ png: '.png', jpeg: '.jpg', webp: '.webp', gif: '.gif', avif: '.avif', mp4: '.mp4' })

function sanitizedUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`
}

export function createRemoteMediaFetcher({ lookup = defaultLookup, open = openPinned }: { lookup?: RemoteLookup; open?: RemoteOpen } = {}) {
  return {
    async download(input: unknown, options: DownloadOptions): Promise<DownloadResult> {
      const kind: MediaKind = options.kind === 'video' ? 'video' : 'image'
      if (!options.destination) fail('MEDIA_DESTINATION_INVALID', '缺少远程媒体保存位置')
      const destination = path.resolve(options.destination)
      const maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_LIMITS[kind])
      const requestedRedirects = options.maxRedirects == null ? 4 : Number(options.maxRedirects)
      const maxRedirects = Math.max(0, Math.min(10, Number.isFinite(requestedRedirects) ? requestedRedirects : 4))
      let current = String(input || '')

      for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
        const target = await assertSafeRemoteUrl(current, { lookup })
        const response = await open(target, { headers: options.headers || {}, timeoutMs: options.timeoutMs, idleTimeoutMs: options.idleTimeoutMs })
        const location = headerValue(response.headers, 'location')
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.stream.resume()
          if (!location) fail('MEDIA_REDIRECT_INVALID', '远程媒体重定向缺少目标地址')
          if (redirect >= maxRedirects) fail('MEDIA_REDIRECT_LIMIT', '远程媒体重定向次数过多')
          current = new URL(String(location), target.url).toString()
          continue
        }
        if (response.statusCode !== 200) {
          response.stream.resume()
          fail('MEDIA_HTTP_ERROR', `远程媒体下载失败（HTTP ${response.statusCode}）`, { retryable: response.statusCode === 429 || response.statusCode >= 500 })
        }

        const contentType = String(headerValue(response.headers, 'content-type') || '').split(';')[0]?.trim().toLowerCase() || ''
        if (!MIME[kind].has(contentType)) {
          response.abort()
          fail('MEDIA_MIME_INVALID', '远程媒体 MIME 类型不受支持')
        }
        const declaredLength = Number(headerValue(response.headers, 'content-length'))
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.abort()
          fail('MEDIA_TOO_LARGE', `远程媒体超过 ${maxBytes} 字节限制`)
        }

        fs.mkdirSync(path.dirname(destination), { recursive: true })
        const tempPath = `${destination}.part-${randomUUID()}`
        let file: fs.promises.FileHandle | null = null
        let total = 0
        let prefix = Buffer.alloc(0)
        try {
          file = await fs.promises.open(tempPath, 'wx')
          for await (const value of response.stream) {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
            total += chunk.length
            if (total > maxBytes) {
              response.abort()
              fail('MEDIA_TOO_LARGE', `远程媒体超过 ${maxBytes} 字节限制`)
            }
            if (prefix.length < 32) prefix = Buffer.concat([prefix, chunk]).subarray(0, 32)
            await file.write(chunk)
          }
          await file.sync()
          await file.close()
          file = null
          const format = detectFormat(kind, prefix)
          if (!format || (MIME_FORMAT[contentType] && MIME_FORMAT[contentType] !== format)) fail('MEDIA_SIGNATURE_INVALID', '远程媒体内容与声明类型不匹配')
          const finalDestination = options.normalizeExtension
            ? destination.slice(0, destination.length - path.extname(destination).length) + FORMAT_EXTENSION[format]
            : destination
          if (fs.existsSync(finalDestination)) fail('MEDIA_DESTINATION_EXISTS', '目标媒体文件已存在')
          fs.renameSync(tempPath, finalDestination)
          return { destination: finalDestination, bytes: total, contentType, format, finalUrl: sanitizedUrl(target.url) }
        } catch (error: unknown) {
          try { await file?.close() } catch {}
          try { fs.rmSync(tempPath, { force: true }) } catch {}
          if (error instanceof RemoteMediaError) throw error
          throw new RemoteMediaError('MEDIA_WRITE_FAILED', '远程媒体保存失败', { cause: error })
        }
      }
      fail('MEDIA_REDIRECT_LIMIT', '远程媒体重定向次数过多')
    },
  }
}

const defaultFetcher = createRemoteMediaFetcher()
export const downloadRemoteMedia = defaultFetcher.download
