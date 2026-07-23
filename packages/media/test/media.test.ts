import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Shot } from '@aigc-director/contracts'
import { getModel } from '@aigc-director/model-catalog'
import { exportProjectVideo, extractLastVideoFrame, previewMediaResolution, probeMedia } from '../src/index.js'

const projectId = '11111111-1111-4111-8111-111111111111'
const now = new Date().toISOString()
const shot: Shot = {
  id: '22222222-2222-4222-8222-222222222222', projectId, sceneId: '33333333-3333-4333-8333-333333333333',
  title: 'Demo 镜头', description: '本地色板测试', dialogue: '', visualPrompt: '', videoPrompt: '', negativePrompt: '',
  durationMs: 800, beats: [], boundaryFrames: [], ordinal: 0, revision: 1, staleFields: [], createdAt: now, updatedAt: now,
}

describe('媒体导出', () => {
  it('使用系统 FFmpeg 生成并探测有效 MP4', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'director-export-'))
    const result = await exportProjectVideo({ projectId, outputDirectory: directory, fileName: 'demo.mp4', width: 320, height: 320, fps: 12 }, [shot])
    const probe = await probeMedia(result.outputPath)
    expect(result.media.mime).toBe('video/mp4')
    expect(['h264', 'mpeg4']).toContain(result.videoCodec)
    expect(result.audioCodec).toBe('aac')
    expect(probe.durationSeconds).toBeGreaterThan(0.5)
    const assembled = await exportProjectVideo(
      { projectId, outputDirectory: directory, fileName: 'selected-visual.mp4', width: 320, height: 320, fps: 12 },
      [shot],
      { visualInputs: [{ path: result.outputPath, kind: 'video' }] },
    )
    expect((await probeMedia(assembled.outputPath)).durationSeconds).toBeGreaterThan(0.5)
  }, 30_000)

  it('从最后可解码视频帧原子发布 PNG，失败时不留下半成品', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'director-tail-frame-'))
    const exported = await exportProjectVideo({ projectId, outputDirectory: directory, fileName: 'tail.mp4', width: 320, height: 320, fps: 12 }, [shot])
    const extracted = await extractLastVideoFrame(exported.outputPath, join(directory, 'frames'))
    const buffer = await readFile(extracted.outputPath)
    expect([...buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(extracted).toMatchObject({ width: 320, height: 320, size: buffer.byteLength })
    expect(extracted.sha256).toHaveLength(64)

    await expect(extractLastVideoFrame(join(directory, 'missing.mp4'), join(directory, 'failed-frames'))).rejects.toThrow()
    expect(await readdir(join(directory, 'failed-frames'))).toEqual([])
  }, 30_000)

  it('按 Model Catalog 校验媒体顺序并且只返回脱敏 receipt', () => {
    const media = {
      id: crypto.randomUUID(), projectId, kind: 'image' as const, storage: 'managed-file' as const, locator: 'frame.png',
      mime: 'image/png', size: 1024, sha256: 'a'.repeat(64), createdAt: now,
    }
    const preview = previewMediaResolution(projectId, getModel('demo-frame-v1'), [{ role: 'first-frame', order: 0, media }])
    expect(preview).toMatchObject({ supported: true, transmission: 'local-fixture', totalBytes: 1024 })
    expect(preview.receipts[0]).toMatchObject({ mediaId: media.id, sourceSha256: media.sha256 })
    expect(JSON.stringify(preview)).not.toContain(media.locator)
    expect(previewMediaResolution(projectId, getModel('demo-frame-v1'), [{ role: 'first-frame', order: 1, media }]).issues).toContain('MEDIA_ORDER_INVALID')
  })
})
