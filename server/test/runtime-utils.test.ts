import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveFfmpegPath, resolveFfprobePath } from '../utils/ffmpeg'
import { verifyFileSignature } from '../utils/fileSignature'
import { attachTimeMs, parseDbTimeMs } from '../utils/time'

test('数据库时间解析保持数字、SQLite UTC 与 ISO 输入兼容', () => {
  assert.equal(parseDbTimeMs(null), null)
  assert.equal(parseDbTimeMs(''), null)
  assert.equal(parseDbTimeMs(1_725_000_000_000), 1_725_000_000_000)
  assert.equal(parseDbTimeMs('1725000000000'), 1_725_000_000_000)
  assert.equal(parseDbTimeMs('2026-07-15 10:20:30'), Date.UTC(2026, 6, 15, 10, 20, 30))
  assert.equal(parseDbTimeMs('not-a-time'), null)

  assert.deepEqual(
    attachTimeMs({ id: 7, created_at: '2026-07-15 10:20:30', updated_at: null }),
    {
      id: 7,
      created_at: '2026-07-15 10:20:30',
      updated_at: null,
      created_at_ms: Date.UTC(2026, 6, 15, 10, 20, 30),
      updated_at_ms: null,
    },
  )
  assert.equal(attachTimeMs(null), null)
})

test('FFmpeg 路径解析优先显式配置，并从可执行文件名推导 ffprobe', () => {
  assert.deepEqual(resolveFfmpegPath('/opt/aigc/bin/ffmpeg'), {
    path: '/opt/aigc/bin/ffmpeg',
    source: '配置路径',
  })
  assert.equal(resolveFfprobePath('/opt/aigc/bin/ffmpeg'), '/opt/aigc/bin/ffprobe')
  assert.equal(resolveFfprobePath('C:\\tools\\ffmpeg.exe'), 'C:\\tools\\ffprobe.exe')
  assert.equal(resolveFfprobePath('/opt/aigc/bin/custom-encoder'), 'ffprobe')
})

test('文件签名校验接受真实白名单魔数并拒绝 MIME 伪装', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-file-signature-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const pngPath = path.join(root, 'frame.png')
  const fakePath = path.join(root, 'fake.jpg')
  const wavePath = path.join(root, 'voice.wav')

  fs.writeFileSync(pngPath, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))
  fs.writeFileSync(fakePath, Buffer.from('MZ executable payload', 'utf8'))
  fs.writeFileSync(wavePath, Buffer.from('524946460000000057415645666d7420', 'hex'))

  assert.equal(verifyFileSignature(pngPath, ['image/png']), true)
  assert.equal(verifyFileSignature(pngPath, ['image/jpeg']), false)
  assert.equal(verifyFileSignature(fakePath, ['image/jpg']), false)
  assert.equal(verifyFileSignature(wavePath, ['audio/x-wav']), true)
})
