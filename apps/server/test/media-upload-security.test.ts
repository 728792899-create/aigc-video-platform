import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MediaReference, Project } from '@aigc-director/contracts'
import { createDirectorApp } from '../src/http/app.js'
import { sharpRuntime } from '../src/runtimeModules.js'
import { inject, jsonBody, multipartFile, type InjectResponse } from './http-inject.js'

const token = 'media-boundary-test-session-token'
const auth = { authorization: `Bearer ${token}` }
type Runtime = ReturnType<typeof createDirectorApp>

async function api<T>(runtime: Runtime, method: string, path: string, body?: unknown): Promise<InjectResponse<T>> {
  const payload = body === undefined ? { headers: {} as Record<string, string> } : jsonBody(body)
  return await inject<T>(runtime.app, {
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

const twoFrameGif = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
  0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x4c, 0x01, 0x00, 0x3b,
])

describe('静态图片媒体边界', () => {
  let runtime: Runtime
  let directory: string
  let project: Project

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aigc-media-boundary-'))
    runtime = createDirectorApp({ databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token })
    project = (await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '媒体边界' })).body.data
  })

  afterEach(() => stop(runtime))

  it('解码后重新编码静态图片并移除 EXIF/ICC 等隐私元数据', async () => {
    const marker = 'AIGC_PRIVATE_EXIF_MARKER'
    const original = await sharpRuntime({
      create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 60 } },
    }).jpeg().withMetadata({ exif: { IFD0: { Artist: marker } } }).toBuffer()
    expect((await sharpRuntime(original).metadata()).exif).toBeDefined()

    const multipart = multipartFile('file', { name: 'private.jpg', mime: 'image/jpeg', data: original })
    const uploaded = await inject<{ data: MediaReference }>(runtime.app, {
      method: 'POST', path: `/api/v2/projects/${project.id}/media`, headers: { ...auth, ...multipart.headers }, body: multipart.body,
    })
    expect(uploaded.status).toBe(201)
    const media = uploaded.body.data
    const persisted = await readFile(join(directory, 'media', project.id, media.locator))
    const metadata = await sharpRuntime(persisted).metadata()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(persisted.includes(Buffer.from(marker))).toBe(false)
    expect(media.size).toBe(persisted.byteLength)
  })

  it('拒绝伪装为静态素材的多帧 WebP，避免总像素和处理成本绕过', async () => {
    const animatedWebp = await sharpRuntime(twoFrameGif, { animated: true }).webp().toBuffer()
    expect((await sharpRuntime(animatedWebp, { animated: true }).metadata()).pages).toBe(2)
    const multipart = multipartFile('file', { name: 'animated.webp', mime: 'image/webp', data: animatedWebp })
    const uploaded = await inject<{ error: { code: string } }>(runtime.app, {
      method: 'POST', path: `/api/v2/projects/${project.id}/media`, headers: { ...auth, ...multipart.headers }, body: multipart.body,
    })
    expect(uploaded.status).toBe(422)
    expect(uploaded.body.error.code).toBe('UPLOAD_ANIMATION_UNSUPPORTED')
  })
})
