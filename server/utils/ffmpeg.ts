import fs from 'node:fs'

export interface FfmpegResolution {
  path: string
  source: '配置路径' | 'ffmpeg-static' | '系统 PATH'
}

function resolveStaticFfmpeg(): string | null {
  try {
    const staticPath: unknown = require('ffmpeg-static')
    if (typeof staticPath === 'string' && staticPath && fs.existsSync(staticPath)) return staticPath
  } catch {
    // ffmpeg-static 在旧安装中可选；下面继续回退系统 PATH。
  }
  return null
}

export function resolveFfmpegPath(configuredPath?: unknown): FfmpegResolution {
  const configured = String(configuredPath || '').trim()
  if (configured && configured !== 'ffmpeg') {
    return { path: configured, source: '配置路径' }
  }

  const staticPath = resolveStaticFfmpeg()
  if (staticPath) return { path: staticPath, source: 'ffmpeg-static' }
  return { path: configured || 'ffmpeg', source: '系统 PATH' }
}

export function resolveFfprobePath(ffmpegPath?: unknown): string {
  const executable = typeof ffmpegPath === 'string' ? ffmpegPath : ''
  if (/ffmpeg(\.exe)?$/i.test(executable)) {
    return executable.replace(/ffmpeg(\.exe)?$/i, (match) => match.replace(/ffmpeg/i, 'ffprobe'))
  }
  return 'ffprobe'
}
