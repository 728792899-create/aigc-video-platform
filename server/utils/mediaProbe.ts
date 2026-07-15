import { spawn } from 'node:child_process'

import * as config from '../services/config'
import { resolveFfmpegPath, resolveFfprobePath } from './ffmpeg'

function ffmpegBin(): string {
  try {
    return resolveFfmpegPath(config.get('ffmpegPath')).path
  } catch {
    return resolveFfmpegPath('ffmpeg').path
  }
}

function ffprobeBin(): string {
  return resolveFfprobePath(ffmpegBin())
}

function viaFfprobe(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let output = ''
    let done = false
    const finish = (value: number | null): void => {
      if (!done) {
        done = true
        resolve(value)
      }
    }
    try {
      const child = spawn(ffprobeBin(), [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', filePath,
      ], { windowsHide: true })
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* 已退出 */ }
        finish(null)
      }, 15_000)
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.on('close', () => {
        clearTimeout(timer)
        const duration = Number.parseFloat(output.trim())
        finish(Number.isFinite(duration) && duration > 0 ? duration : null)
      })
      child.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
    } catch {
      finish(null)
    }
  })
}

function viaFfmpeg(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let errorOutput = ''
    let done = false
    const finish = (value: number | null): void => {
      if (!done) {
        done = true
        resolve(value)
      }
    }
    try {
      const child = spawn(ffmpegBin(), ['-i', filePath], { windowsHide: true })
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* 已退出 */ }
        finish(null)
      }, 15_000)
      child.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString() })
      child.on('close', () => {
        clearTimeout(timer)
        const match = errorOutput.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
        const hours = match?.[1]
        const minutes = match?.[2]
        const seconds = match?.[3]
        if (hours && minutes && seconds) {
          const duration = Number(hours) * 3_600 + Number(minutes) * 60 + Number.parseFloat(seconds)
          finish(Number.isFinite(duration) && duration > 0 ? duration : null)
        } else {
          finish(null)
        }
      })
      child.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
    } catch {
      finish(null)
    }
  })
}

/** 读取音视频真实时长；ffprobe 不可用时回退解析 ffmpeg stderr。 */
export async function probeDuration(filePath: string): Promise<number | null> {
  if (!filePath) return null
  const probed = await viaFfprobe(filePath)
  if (probed && probed > 0) return probed
  const fallback = await viaFfmpeg(filePath)
  return fallback && fallback > 0 ? fallback : null
}
