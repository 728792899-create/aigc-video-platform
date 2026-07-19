import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import type { Express } from 'express'

class InMemorySocket extends Duplex {
  _read(): void {}

  _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback()
  }
}

export interface InjectRequest {
  method: string
  path: string
  headers?: Record<string, string>
  body?: Buffer | string
}

export interface InjectResponse<T = unknown> {
  status: number
  headers: Record<string, string | string[] | number | undefined>
  text: string
  buffer: Buffer
  body: T
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
}

function asBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk
  if (chunk instanceof Uint8Array) return Buffer.from(chunk)
  return Buffer.from(String(chunk ?? ''), encoding)
}

/**
 * Runs a request through Express without binding a TCP or Unix socket. This is
 * intentionally transport-free so the HTTP contract remains testable in
 * hardened build sandboxes that deny every listen(2) call.
 */
export async function inject<T = unknown>(app: Express, input: InjectRequest): Promise<InjectResponse<T>> {
  const socket = new InMemorySocket()
  Object.defineProperty(socket, 'remoteAddress', { configurable: true, value: '127.0.0.1' })
  const request = new IncomingMessage(socket as never)
  const body = input.body === undefined ? undefined : asBuffer(input.body)
  request.method = input.method.toUpperCase()
  request.url = input.path
  request.headers = {
    host: '127.0.0.1',
    connection: 'close',
    ...normalizeHeaders(input.headers),
    ...(body ? { 'content-length': String(body.byteLength) } : {}),
  }

  const response = new ServerResponse(request)
  response.assignSocket(socket as never)
  const chunks: Buffer[] = []
  const originalWrite = response.write.bind(response)
  const originalEnd = response.end.bind(response)
  response.write = ((chunk: unknown, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
    if (chunk !== undefined && chunk !== null) chunks.push(asBuffer(chunk, encoding))
    return originalWrite(chunk as never, encoding as never, callback as never)
  }) as typeof response.write
  response.end = ((chunk?: unknown, encoding?: BufferEncoding, callback?: () => void) => {
    if (chunk !== undefined && chunk !== null) chunks.push(asBuffer(chunk, encoding))
    return originalEnd(chunk as never, encoding as never, callback as never)
  }) as typeof response.end

  const finished = new Promise<void>((resolve, reject) => {
    response.once('finish', resolve)
    response.once('error', reject)
    request.once('error', reject)
  })
  if (body) request.push(body)
  request.push(null)
  // The complete request body is already buffered before Express receives it.
  // Marking the synthetic IncomingMessage complete prevents multipart parsers
  // from treating the response socket shutdown as a client-side abort.
  request.complete = true
  app(request, response)
  await finished

  const buffer = Buffer.concat(chunks)
  const text = buffer.toString('utf8')
  const contentType = String(response.getHeader('content-type') ?? '')
  let parsed: unknown = text
  if (contentType.includes('application/json') && text) parsed = JSON.parse(text)
  return {
    status: response.statusCode,
    headers: response.getHeaders(),
    buffer,
    text,
    body: parsed as T,
  }
}

export function jsonBody(value: unknown): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(value)
  return { body, headers: { 'content-type': 'application/json' } }
}

export function multipartFile(fieldName: string, file: { name: string; mime: string; data: Buffer }): { body: Buffer; headers: Record<string, string> } {
  const boundary = `aigc-director-${'0'.repeat(32)}`
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return {
    body: Buffer.concat([head, file.data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}
