import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ensureWritableDirectory,
  requestedExternalExportDirectory,
} from '../services/exportStorage'
import { spawnAsync, timeoutForSeconds } from '../services/ffmpegRunner'

test('导出目录预检可创建目录并拒绝普通文件', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-export-storage-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const output = path.join(root, 'nested', 'exports')
  const file = path.join(root, 'not-a-directory')
  fs.writeFileSync(file, 'content')

  assert.equal(ensureWritableDirectory(output), path.resolve(output))
  assert.equal(fs.statSync(output).isDirectory(), true)
  assert.equal(requestedExternalExportDirectory({ export_directory: output }), path.resolve(output))
  assert.equal(requestedExternalExportDirectory({ export_directory: output, skip_external_export_copy: true }), '')
  assert.throws(() => ensureWritableDirectory(file), /不是文件夹/)
})

test('FFmpeg 子进程封装保留标准输出并传递失败诊断', async () => {
  const success = await spawnAsync(process.execPath, ['-e', 'process.stdout.write("ready")'], { timeout: 5_000 })
  assert.equal(success.stdout, 'ready')
  assert.equal(success.stderr, '')

  await assert.rejects(
    spawnAsync(process.execPath, ['-e', 'process.stderr.write("encode failed"); process.exit(2)'], { timeout: 5_000 }),
    /encode failed/,
  )
})

test('编码超时预算按阶段设置上下限', () => {
  assert.equal(timeoutForSeconds(1, 'segment'), 300_000)
  assert.equal(timeoutForSeconds(30, 'final'), 600_000)
  assert.equal(timeoutForSeconds(100_000, 'final'), 6 * 60 * 60 * 1_000)
})
