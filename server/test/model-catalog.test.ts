import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import modelCatalog = require('../services/modelCatalog')
import { createMediaAdapter } from '../services/mediaAdapter'

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

test('ModelCatalog 从现有 ProviderRegistry 派生稳定模型 ID 与静态能力', () => {
  const video = modelCatalog.get('cogvideo', 'cogvideox-flash')
  assert.ok(video)
  assert.equal(video.id, 'cogvideo__cogvideox-flash')
  assert.equal(video.modality, 'video')
  assert.equal(video.capabilities.image_to_video, true)
  assert.deepEqual(video.accepted_media_references, ['data_url', 'public_url'])
  assert.equal('configured' in video, false, '静态能力不能混入运行时健康状态')

  const local = modelCatalog.get('static', '')
  assert.ok(local)
  assert.equal(local.modality, 'video')
  assert.equal(local.credential_required, false)
})

test('未知模型、阶段错配和不支持能力在 Provider 调用前 fail fast', () => {
  assert.throws(
    () => modelCatalog.assertSelection({ provider: 'cogview', model: 'not-a-real-model', modality: 'image' }),
    (error) => hasCode(error, 'MODEL_NOT_FOUND'),
  )
  assert.throws(
    () => modelCatalog.assertSelection({ provider: 'cogvideo', model: 'cogvideox-flash', modality: 'image' }),
    (error) => hasCode(error, 'MODEL_MODALITY_MISMATCH'),
  )
  assert.throws(
    () => modelCatalog.assertSelection({
      provider: 'cogview', model: 'cogview-3-flash', modality: 'image', requires: ['reference_image'],
    }),
    (error) => hasCode(error, 'MODEL_CAPABILITY_UNSUPPORTED'),
  )
})

test('LLM 兼容端点允许用户自定义模型 ID，但保留保守能力元数据', () => {
  const custom = modelCatalog.assertSelection({ provider: 'doubao', model: 'ep-user-endpoint-id', modality: 'text' })
  assert.equal(custom.catalog_source, 'custom')
  assert.equal(custom.capabilities.structured_output, true)
})

test('MediaAdapter 只读取受管 uploads 图片，限制大小并返回可持久化的脱敏快照', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-media-adapter-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const images = path.join(root, 'images')
  fs.mkdirSync(images, { recursive: true })
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  fs.writeFileSync(path.join(images, 'frame.png'), png)
  fs.writeFileSync(path.join(images, 'large.png'), Buffer.concat([png, Buffer.alloc(64)]))

  const adapter = createMediaAdapter({ uploadDir: root, maxInputBytes: 32 })
  const resolved = await adapter.resolveForModel({
    provider: 'cogvideo', model: 'cogvideox-flash',
    reference: { kind: 'project_media', media_id: 9, url: '/uploads/images/frame.png?token=secret' },
  })
  assert.match(resolved.transient_value, /^data:image\/png;base64,/)
  assert.equal(resolved.snapshot.source_url, '/uploads/images/frame.png')
  assert.equal(resolved.snapshot.media_id, 9)
  assert.equal('transient_value' in resolved.snapshot, false)
  assert.equal(JSON.stringify(resolved.snapshot).includes('token=secret'), false)

  await assert.rejects(
    adapter.resolveForModel({
      provider: 'cogvideo', model: 'cogvideox-flash',
      reference: { kind: 'project_media', url: '/uploads/images/large.png' },
    }),
    (error) => hasCode(error, 'MEDIA_INPUT_TOO_LARGE'),
  )
  await assert.rejects(
    adapter.resolveForModel({
      provider: 'cogvideo', model: 'cogvideox-flash',
      reference: { kind: 'project_media', url: '/uploads/../private.png' },
    }),
    (error) => hasCode(error, 'MEDIA_REFERENCE_INVALID'),
  )
})

test('MediaAdapter 拒绝给不支持参考图的模型解析媒体', async () => {
  const adapter = createMediaAdapter({ uploadDir: os.tmpdir() })
  await assert.rejects(
    adapter.resolveForModel({
      provider: 'cogview', model: 'cogview-3-flash',
      reference: { kind: 'project_media', url: '/uploads/images/frame.png' },
    }),
    (error) => hasCode(error, 'MODEL_CAPABILITY_UNSUPPORTED'),
  )
})
