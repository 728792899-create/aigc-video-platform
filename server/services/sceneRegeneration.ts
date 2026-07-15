import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { getDb } from '../db'
import { resolveFfmpegPath } from '../utils/ffmpeg'
import * as config from './config'
import { generatePlaceholder } from './placeholder'
import type { TaskManager } from './taskManager'

type Stage = 'image' | 'voice' | 'video'
type JsonObject = Record<string, unknown>

export interface SceneRegenerationOptions {
  stages: Stage[]
  prompt: string
  promptRevisionId?: string
  provider?: string
  model?: string
  confirmCost?: boolean
}

const taskManager = require('./taskManager') as TaskManager

function isDemo(): boolean {
  return ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase())
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function localSceneVideo(storyboardId: number, seconds: number, imagePath?: string): Promise<{ file_url: string; local_path: string }> {
  const outputDir = path.resolve(String(config.get('uploadDir')), 'videos', 'scene-regeneration')
  fs.mkdirSync(outputDir, { recursive: true })
  const filename = `scene-${storyboardId}-${randomUUID()}.mp4`
  const output = path.join(outputDir, filename)
  const ffmpeg = resolveFfmpegPath(config.get('ffmpegPath')).path
  const duration = Math.max(1, Math.min(60, seconds || 5))
  const input = imagePath && fs.existsSync(imagePath)
    ? ['-loop', '1', '-i', imagePath]
    : ['-f', 'lavfi', '-i', `color=c=0x152449:s=1280x720:d=${duration}`]
  const args = ['-y', ...input, '-t', String(duration), '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-r', '24', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', output]
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
        resolve({ file_url: `/uploads/videos/scene-regeneration/${filename}`, local_path: output })
      } else reject(new Error(`本地镜头视频生成失败（FFmpeg ${code}）: ${stderr.slice(-500)}`))
    })
  })
}

function managedImagePath(fileUrl: unknown): string | undefined {
  const url = String(fileUrl || '')
  if (!url.startsWith('/uploads/')) return undefined
  const relative = url.replace(/^\/uploads\//, '')
  const root = path.resolve(String(config.get('uploadDir')))
  const candidate = path.resolve(root, relative)
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : undefined
}

export async function runSceneRegeneration(taskId: string, storyboardId: number, options: SceneRegenerationOptions): Promise<void> {
  const db = getDb()
  const storyboard = db.prepare('SELECT * FROM storyboards WHERE id = ?').get(storyboardId)
  if (!storyboard) throw new Error('分镜不存在')
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(storyboard.project_id)
  if (!project) throw new Error('项目不存在')
  taskManager.start(taskId, '正在逐场景重生成')
  const results: JsonObject = {}
  const failures: Array<{ stage: Stage; error: string }> = []
  let selectedImageUrl = ''

  for (let index = 0; index < options.stages.length; index += 1) {
    const stage = options.stages[index]
    if (!stage) continue
    const current = taskManager.get(taskId)
    if (current?.meta?.cancel_requested) { taskManager.cancel(taskId, '已取消逐场景重生成'); return }
    taskManager.progress(taskId, Math.max(2, Math.round(index / options.stages.length * 90)), `正在处理 ${stage}`)
    try {
      if (stage === 'image') {
        let files: Array<{ local_path: string; file_url: string }> = []
        let provider = options.provider || 'demo'
        let model = options.model || 'local-placeholder'
        if (isDemo()) {
          const generated = await generatePlaceholder(String(project.ratio || '16:9'), { demo: true })
          if (!generated) throw new Error('Demo 占位画面生成失败')
          files = [generated]
        } else {
          const imageGen = require('./imageGen') as { generate(input: JsonObject): Promise<JsonObject & { local_files?: Array<{ local_path: string; file_url: string }>; provider?: string; model?: string }> }
          const generated = await imageGen.generate({
            description: storyboard.description || storyboard.dialog || '', userPrompt: options.prompt,
            style: project.style || '写实', ratio: project.ratio || '16:9', model: options.model || 'auto', batchSize: 1,
            visualAnchor: project.visual_anchor || '', seed: project.image_seed || null,
          })
          files = generated.local_files || []
          provider = String(generated.provider || provider); model = String(generated.model || model)
        }
        const candidateIds: number[] = []
        for (const file of files) {
          const inserted = db.prepare(`INSERT INTO images
            (storyboard_id, prompt, file_path, file_url, submit_id, gen_status, provider, model, prompt_revision_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(storyboardId, options.prompt, file.file_url, file.file_url, `local-${randomUUID()}`, 'success', provider, model,
              options.promptRevisionId || null, Date.now())
          candidateIds.push(Number(inserted.lastInsertRowid)); selectedImageUrl = file.file_url
        }
        if (!storyboard.selected_image_id && candidateIds[0]) {
          db.prepare('UPDATE storyboards SET selected_image_id = ? WHERE id = ?').run(candidateIds[0], storyboardId)
        }
        results.image = { candidate_ids: candidateIds, prompt_revision_id: options.promptRevisionId || null }
      } else if (stage === 'voice') {
        const ttsProvider = require('./ttsProvider') as { synthesize(input: JsonObject): Promise<JsonObject & { file_url?: string; words?: unknown[] }> }
        const audio = await ttsProvider.synthesize({
          text: storyboard.dialog || storyboard.description || '', voice: storyboard.voice || 'xiaoxiao',
          storyboardId, provider: isDemo() ? 'edge' : options.provider, model: options.model,
        })
        if (!audio.file_url) throw new Error('配音结果缺少文件引用')
        db.prepare('UPDATE storyboards SET audio_url = ?, audio_words = ?, prompt_revision_id = ? WHERE id = ?')
          .run(audio.file_url, JSON.stringify(audio.words || []), options.promptRevisionId || null, storyboardId)
        results.voice = { file_url: audio.file_url, prompt_revision_id: options.promptRevisionId || null }
      } else if (stage === 'video') {
        if (!selectedImageUrl) {
          const selected = db.prepare(`SELECT i.file_url FROM images i
            JOIN storyboards s ON s.selected_image_id = i.id WHERE s.id = ?`).get(storyboardId)
          selectedImageUrl = String(selected?.file_url || '')
        }
        if (isDemo()) {
          const video = await localSceneVideo(storyboardId, Number(storyboard.duration) || 5, managedImagePath(selectedImageUrl))
          db.prepare('UPDATE storyboards SET video_path = ?, prompt_revision_id = ? WHERE id = ?')
            .run(video.file_url, options.promptRevisionId || null, storyboardId)
          results.video = { file_url: video.file_url, local: true }
        } else {
          if (!options.confirmCost || !options.provider) throw new Error('真实视频重生成需要费用确认和 Provider')
          const t2v = require('./t2vProvider') as { generate(input: JsonObject): Promise<JsonObject & { file_url?: string }> }
          const video = await t2v.generate({ provider: options.provider, model: options.model, prompt: options.prompt,
            ratio: project.ratio || '16:9', imageUrl: selectedImageUrl || undefined, seconds: Number(storyboard.duration) || 5 })
          if (!video.file_url) throw new Error('视频 Provider 结果缺少文件引用')
          db.prepare('UPDATE storyboards SET video_path = ?, prompt_revision_id = ? WHERE id = ?')
            .run(video.file_url, options.promptRevisionId || null, storyboardId)
          results.video = { file_url: video.file_url, local: false }
        }
      }
    } catch (error) {
      failures.push({ stage, error: errorMessage(error) })
    }
  }
  if (failures.length === options.stages.length) taskManager.fail(taskId, new Error(failures.map((item) => `${item.stage}: ${item.error}`).join('; ')))
  else if (failures.length) taskManager.partial(taskId, { ...results, failures }, '逐场景重生成部分完成')
  else taskManager.succeed(taskId, results, '逐场景重生成完成')
}
