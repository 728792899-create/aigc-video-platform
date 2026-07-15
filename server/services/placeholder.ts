import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'

import * as config from './config'
import { resolveFfmpegPath } from '../utils/ffmpeg'

export interface PlaceholderOptions {
  demo?: boolean
}

export interface PlaceholderResult {
  local_path: string
  file_url: string
  filename: string
}

const FFMPEG = resolveFfmpegPath(config.get('ffmpegPath')).path
const UPLOAD_DIR = path.resolve(String(config.get('uploadDir') || './uploads'), 'images')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const RATIO_TO_SIZE: Readonly<Record<string, readonly [number, number]>> = {
  '21:9': [1680, 720], '16:9': [1280, 720], '3:2': [1200, 800],
  '4:3': [1024, 768], '1:1': [1024, 1024], '3:4': [768, 1024],
  '2:3': [800, 1200], '9:16': [720, 1280],
}

function resolveCjkFont(): string | null {
  const windowsDirectory = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows'
  const candidates = ['msyh.ttc', 'msyhbd.ttc', 'simhei.ttf', 'simsun.ttc', 'simkai.ttf']
  for (const filename of candidates) {
    const candidate = path.join(windowsDirectory, 'Fonts', filename)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function ffmpegFontPath(fontPath: string): string {
  return fontPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:')
}

/** 所有图片 Provider 失败时生成本地占位图；失败返回 null。 */
export function generatePlaceholder(
  ratio = '16:9',
  options: PlaceholderOptions = {},
): Promise<PlaceholderResult | null> {
  return new Promise((resolve) => {
    const [width, height] = RATIO_TO_SIZE[ratio] || [1280, 720]
    const filename = `placeholder_${uuidv4()}.png`
    const filePath = path.join(UPLOAD_DIR, filename)
    const cjkFont = resolveCjkFont()
    const fontExpression = cjkFont ? `fontfile='${ffmpegFontPath(cjkFont)}':` : ''
    const line1 = options.demo
      ? (cjkFont ? 'Demo 本地占位画面' : 'Demo local placeholder')
      : (cjkFont ? '图片暂未生成' : 'Image not generated')
    const line2 = options.demo
      ? (cjkFont ? '未调用任何付费模型' : 'No paid model request')
      : (cjkFont ? '请检查网络后重新生成' : 'check network and retry')
    const filter = `drawtext=${fontExpression}text='${line1}':`
      + `fontcolor=white:fontsize=${Math.round(width / 22)}:`
      + `x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(height / 28)},`
      + `drawtext=${fontExpression}text='${line2}':`
      + `fontcolor=0x9aa0b4:fontsize=${Math.round(width / 38)}:`
      + `x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(height / 28)}`
    const args = [
      '-y', '-f', 'lavfi',
      '-i', `color=c=${options.demo ? '0x152449' : '0x2b2b3d'}:s=${width}x${height}`,
      '-vf', filter,
      '-frames:v', '1', filePath,
    ]
    const child = spawn(FFMPEG, args, { windowsHide: true })
    child.stderr.on('data', () => { /* 保持消费 stderr，避免管道阻塞 */ })
    child.on('error', (cause) => {
      console.error('[placeholder] ffmpeg 启动失败:', cause.message)
      resolve(null)
    })
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        resolve({ local_path: filePath, file_url: `/uploads/images/${filename}`, filename })
        return
      }

      console.warn('[placeholder] 带文字生成失败，尝试纯色兜底。code=', code)
      const fallback = spawn(FFMPEG, [
        '-y', '-f', 'lavfi', '-i', `color=c=0x2b2b3d:s=${width}x${height}`,
        '-frames:v', '1', filePath,
      ], { windowsHide: true })
      fallback.on('error', () => resolve(null))
      fallback.on('close', (fallbackCode) => {
        if (fallbackCode === 0 && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          resolve({ local_path: filePath, file_url: `/uploads/images/${filename}`, filename })
        } else {
          resolve(null)
        }
      })
    })
  })
}
