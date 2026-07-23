import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { MediaResolutionPreviewSchema, ProviderMediaReceiptSchema, type ExportRequest, type MediaReference, type ModelDescriptor, type ProviderMediaReceipt, type Shot } from '@aigc-director/contracts'
import { createHash, randomUUID } from 'node:crypto'

export interface ExportProgress {
  stage: 'preparing' | 'encoding' | 'verifying' | 'completed'
  elapsedMs: number
}

export interface ExportResult {
  outputPath: string
  media: MediaReference
  durationMs: number
  videoCodec: 'h264' | 'mpeg4'
  audioCodec: 'aac'
}

export interface ExtractedFrameResult {
  outputPath: string
  fileName: string
  size: number
  sha256: string
  width: number
  height: number
}

export interface OrderedMediaReference {
  role: ProviderMediaReceipt['role']
  order: number
  media: MediaReference
}

export interface ExportVisualInput {
  path: string
  kind: 'image' | 'video'
}

export function previewMediaResolution(projectId: string, model: ModelDescriptor, inputs: readonly OrderedMediaReference[]) {
  const ordered = [...inputs].sort((left, right) => left.order - right.order)
  const issues: string[] = []
  if (ordered.length > model.limits.maxMediaReferences) issues.push('MEDIA_REFERENCE_LIMIT_EXCEEDED')
  if (new Set(ordered.map((input) => input.order)).size !== ordered.length || ordered.some((input, index) => input.order !== index)) issues.push('MEDIA_ORDER_INVALID')
  for (const input of ordered) {
    if (input.media.projectId !== projectId) issues.push(`MEDIA_PROJECT_MISMATCH:${input.media.id}`)
    if (input.media.size > model.limits.maxBytesPerReference) issues.push(`MEDIA_SIZE_LIMIT_EXCEEDED:${input.media.id}`)
    if (!model.limits.acceptedMimePrefixes.some((prefix) => input.media.mime.startsWith(prefix))) issues.push(`MEDIA_MIME_UNSUPPORTED:${input.media.id}`)
    if (input.media.storage === 'managed-file' && basename(input.media.locator) !== input.media.locator) issues.push(`MEDIA_LOCATOR_INVALID:${input.media.id}`)
  }
  const transmission = model.inputModes.includes('local-fixture') ? 'local-fixture'
    : model.inputModes.includes('base64') ? 'base64'
      : model.inputModes.includes('temporary-upload') ? 'temporary-upload'
        : 'signed-url'
  const timestamp = new Date().toISOString()
  const receipts = issues.length === 0 ? ordered.map((input) => ProviderMediaReceiptSchema.parse({
    id: randomUUID(), projectId, modelId: model.id, mediaId: input.media.id, role: input.role, order: input.order,
    sourceSha256: input.media.sha256, transmission,
    redactedLocatorHash: createHash('sha256').update(input.media.locator).digest('hex'), createdAt: timestamp,
  })) : []
  return MediaResolutionPreviewSchema.parse({
    projectId, modelId: model.id, supported: issues.length === 0, transmission, receipts,
    totalBytes: ordered.reduce((sum, input) => sum + input.media.size, 0), issues,
  })
}

export function resolveFfmpegPath(): string {
  return process.env.AIGC_DIRECTOR_FFMPEG_PATH?.trim() || 'ffmpeg'
}

export function resolveFfprobePath(): string {
  if (process.env.AIGC_DIRECTOR_FFPROBE_PATH?.trim()) return process.env.AIGC_DIRECTOR_FFPROBE_PATH.trim()
  const ffmpeg = resolveFfmpegPath()
  return basename(ffmpeg).toLowerCase().startsWith('ffmpeg') ? ffmpeg.replace(/ffmpeg(?:\.exe)?$/iu, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : 'ffprobe'
}

async function run(command: string, args: string[], signal?: AbortSignal, timeoutMs = 120_000): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('MEDIA_PROCESS_TIMEOUT'))
    }, timeoutMs)
    const abort = (): void => { child.kill('SIGTERM') }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-16_000) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-16_000) })
    child.on('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(new DOMException('Export cancelled', 'AbortError'))
      else if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(`MEDIA_PROCESS_FAILED:${code}:${stderr.slice(-500)}`))
    })
  })
}

export async function probeMedia(filePath: string): Promise<{ durationSeconds: number; format: string }> {
  const { stdout } = await run(resolveFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration,format_name', '-of', 'json', filePath], undefined, 20_000)
  const parsed = JSON.parse(stdout) as { format?: { duration?: string; format_name?: string } }
  const durationSeconds = Number(parsed.format?.duration ?? 0)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('MEDIA_PROBE_INVALID_DURATION')
  return { durationSeconds, format: parsed.format?.format_name ?? '' }
}

async function resolveExportVideoEncoder(): Promise<{ codec: 'h264' | 'mpeg4'; args: string[] }> {
  try {
    const { stdout, stderr } = await run(resolveFfmpegPath(), ['-hide_banner', '-encoders'], undefined, 20_000)
    if (/\blibx264\b/u.test(`${stdout}\n${stderr}`)) {
      return { codec: 'h264', args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'] }
    }
  } catch {
    // Minimal FFmpeg builds remain usable; the returned receipt records the fallback codec.
  }
  return { codec: 'mpeg4', args: ['-c:v', 'mpeg4', '-q:v', '3'] }
}

export async function extractLastVideoFrame(
  filePath: string,
  outputDirectory: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ExtractedFrameResult> {
  const inputPath = resolve(filePath)
  const outputRoot = resolve(outputDirectory)
  await mkdir(outputRoot, { recursive: true })
  const probe = await probeMedia(inputPath)
  const fileName = `${randomUUID()}.png`
  const outputPath = join(outputRoot, fileName)
  const temporaryPath = join(outputRoot, `.${fileName}.${randomUUID()}.tmp`)
  const seekSeconds = Math.max(0, probe.durationSeconds - Math.min(5, probe.durationSeconds)).toFixed(3)
  try {
    await run(resolveFfmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', seekSeconds, '-i', inputPath,
      '-map', '0:v:0', '-vf', 'reverse', '-frames:v', '1', '-c:v', 'png', '-f', 'image2', temporaryPath,
    ], options.signal, options.timeoutMs ?? 60_000)
    const buffer = await readFile(temporaryPath)
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('BOUNDARY_FRAME_PNG_INVALID')
    }
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    if (width < 1 || height < 1 || width > 16_384 || height > 16_384) throw new Error('BOUNDARY_FRAME_DIMENSIONS_INVALID')
    await rename(temporaryPath, outputPath)
    return {
      outputPath, fileName, size: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'), width, height,
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    await unlink(outputPath).catch(() => undefined)
    throw error
  }
}

export async function exportProjectVideo(request: ExportRequest, shots: Shot[], options: {
  signal?: AbortSignal
  onProgress?: (progress: ExportProgress) => void
  visualInputs?: readonly ExportVisualInput[]
} = {}): Promise<ExportResult> {
  if (shots.length === 0) throw new Error('EXPORT_REQUIRES_SHOTS')
  if (options.visualInputs && options.visualInputs.length !== shots.length) throw new Error('EXPORT_VISUAL_INPUT_COUNT_MISMATCH')
  const started = Date.now()
  options.onProgress?.({ stage: 'preparing', elapsedMs: 0 })
  const outputDirectory = resolve(request.outputDirectory)
  await mkdir(outputDirectory, { recursive: true })
  const safeName = basename(request.fileName)
  if (safeName !== request.fileName || !safeName.toLowerCase().endsWith('.mp4')) throw new Error('EXPORT_FILE_NAME_INVALID')
  const outputPath = join(outputDirectory, safeName)
  const videoEncoder = await resolveExportVideoEncoder()
  const palette = ['#16233d', '#123c44', '#37234b', '#47351e', '#193a2d', '#3d202b']
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y']
  shots.forEach((shot, index) => {
    const duration = Math.max(0.5, shot.durationMs / 1_000)
    const visual = options.visualInputs?.[index]
    if (visual?.kind === 'image') args.push('-loop', '1', '-t', duration.toFixed(3), '-i', resolve(visual.path))
    else if (visual?.kind === 'video') args.push('-t', duration.toFixed(3), '-i', resolve(visual.path))
    else args.push('-f', 'lavfi', '-t', duration.toFixed(3), '-i', `color=c=${palette[index % palette.length]}:s=${request.width}x${request.height}:r=${request.fps}`)
  })
  const filters = shots.map((shot, index) => {
    const duration = Math.max(0.5, shot.durationMs / 1_000).toFixed(3)
    return `[${index}:v]scale=${request.width}:${request.height}:force_original_aspect_ratio=decrease,pad=${request.width}:${request.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${request.fps},tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS[v${index}]`
  })
  const videoInputs = shots.map((_shot, index) => `[v${index}]`).join('')
  args.push(
    '-f', 'lavfi', '-t', (shots.reduce((total, shot) => total + shot.durationMs, 0) / 1_000).toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', `${filters.join(';')};${videoInputs}concat=n=${shots.length}:v=1:a=0[v]`,
    '-map', '[v]', '-map', `${shots.length}:a`,
    ...videoEncoder.args, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outputPath,
  )
  options.onProgress?.({ stage: 'encoding', elapsedMs: Date.now() - started })
  await run(resolveFfmpegPath(), args, options.signal)
  options.onProgress?.({ stage: 'verifying', elapsedMs: Date.now() - started })
  const probe = await probeMedia(outputPath)
  const info = await stat(outputPath)
  const expectedSeconds = shots.reduce((total, shot) => total + shot.durationMs, 0) / 1_000
  if (Math.abs(probe.durationSeconds - expectedSeconds) > 1.5) throw new Error('EXPORT_DURATION_MISMATCH')
  const digest = createHash('sha256').update(await readFile(outputPath)).digest('hex')
  options.onProgress?.({ stage: 'completed', elapsedMs: Date.now() - started })
  return {
    outputPath,
    durationMs: Math.round(probe.durationSeconds * 1_000),
    videoCodec: videoEncoder.codec,
    audioCodec: 'aac',
    media: {
      id: randomUUID(), projectId: request.projectId, kind: 'video', storage: 'managed-file', locator: safeName,
      mime: 'video/mp4', size: info.size, sha256: digest, createdAt: new Date().toISOString(),
    },
  }
}
