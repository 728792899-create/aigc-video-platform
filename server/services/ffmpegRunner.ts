import { execFile, spawn, type ChildProcess } from 'node:child_process'

import * as config from './config'
import { resolveFfmpegPath } from '../utils/ffmpeg'

export interface SpawnOptions {
  timeout?: number
}

export interface SpawnResult {
  stdout: string
  stderr: string
}

export type FfmpegStage = 'segment' | 'chapter' | 'final' | 'encode'

const activeProcesses = new Set<ChildProcess>()
let encodePreset: string | null = null
let ffmpegTimeout = 300_000

function killProcessTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch { /* 进程可能已经退出 */ }
}

export function spawnAsync(command: string, args: readonly string[], options: SpawnOptions = {}): Promise<SpawnResult> {
  const timeout = options.timeout || 300_000
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    activeProcesses.add(child)
    let stdout = ''
    const stderrLines: string[] = []
    let settled = false

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrLines.push(chunk.toString())
      if (stderrLines.length > 50) stderrLines.shift()
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killProcessTree(child.pid)
      reject(new Error(`FFmpeg 超时 (${timeout / 1_000}s)，已强制终止`))
    }, timeout)

    child.on('close', (code) => {
      clearTimeout(timer)
      activeProcesses.delete(child)
      if (settled) return
      settled = true
      const stderr = stderrLines.join('')
      if (code !== 0) reject(new Error(stderr.slice(-500).trim() || `exit code ${String(code)}`))
      else resolve({ stdout, stderr })
    })
    child.on('error', (cause) => {
      clearTimeout(timer)
      activeProcesses.delete(child)
      if (!settled) {
        settled = true
        reject(cause)
      }
    })
  })
}

export function ffmpeg(...args: string[]): Promise<SpawnResult> {
  const executable = resolveFfmpegPath(config.get('ffmpegPath')).path
  const lastArgument = args[args.length - 1]
  const finalArgs = encodePreset && args.length >= 2 && lastArgument
    ? [...args.slice(0, -1), '-preset', encodePreset, lastArgument]
    : args
  return spawnAsync(executable, finalArgs, { timeout: ffmpegTimeout || 300_000 })
}

export function setEncodePreset(value: unknown): void {
  encodePreset = value ? String(value) : null
}

export function timeoutForSeconds(seconds: unknown, stage: FfmpegStage = 'encode'): number {
  const duration = Math.max(1, Number(seconds) || 60)
  const multipliers: Record<FfmpegStage, number> = { segment: 45, chapter: 24, final: 12, encode: 30 }
  const minimum = stage === 'final' ? 600_000 : 300_000
  const maximum = stage === 'final' ? 6 * 60 * 60 * 1_000 : 2 * 60 * 60 * 1_000
  return Math.max(minimum, Math.min(maximum, Math.round(duration * multipliers[stage] * 1_000)))
}

export async function withFfmpegTimeout<T>(milliseconds: number, operation: () => T | Promise<T>): Promise<T> {
  const previous = ffmpegTimeout
  ffmpegTimeout = milliseconds
  try {
    return await operation()
  } finally {
    ffmpegTimeout = previous
  }
}

export function killAll(): void {
  for (const child of activeProcesses) killProcessTree(child.pid)
  activeProcesses.clear()
}

process.once('exit', killAll)
