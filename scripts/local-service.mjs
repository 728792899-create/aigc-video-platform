import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverEntry = join(root, 'apps', 'server', 'dist', 'index.js')
const studioDirectory = join(root, 'apps', 'studio', 'dist')
const studioEntry = join(studioDirectory, 'index.html')
const demoAssetDirectory = join(root, 'resources', 'demo', 'xingque')

function defaultDataDirectory() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'AIGC Director Studio')
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'AIGC Director Studio')
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'aigc-director-studio')
}

function fail(message) {
  process.stderr.write(`[local] ${message}\n`)
  process.exit(1)
}

const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map((part) => Number.parseInt(part, 10))
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 20)) fail('需要 Node.js 22.20 或更高版本。')
if (!existsSync(serverEntry) || !existsSync(studioEntry)) fail('缺少生产构建，请先运行 pnpm local:prepare。')
if (!existsSync(demoAssetDirectory)) fail('缺少零 Key Demo 素材目录。')
const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
if (ffmpeg.status !== 0) fail('未找到 FFmpeg，请安装后重试。')

const smokeDataDirectory = process.env.AIGC_DIRECTOR_EXIT_AFTER_READY === '1' && !process.env.AIGC_DIRECTOR_DATA_DIR
  ? mkdtempSync(join(tmpdir(), 'aigc-director-local-smoke-'))
  : undefined
const bootstrapToken = randomBytes(32).toString('base64url')
const sessionToken = randomBytes(32).toString('base64url')
const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: {
    ...process.env,
    DEMO_MODE: process.env.DEMO_MODE ?? '1',
    PROVIDER_NETWORK_DISABLED: process.env.PROVIDER_NETWORK_DISABLED ?? '1',
    AIGC_DIRECTOR_PORT: process.env.AIGC_DIRECTOR_PORT ?? '33100',
    AIGC_DIRECTOR_DATA_DIR: resolve(process.env.AIGC_DIRECTOR_DATA_DIR ?? smokeDataDirectory ?? defaultDataDirectory()),
    AIGC_DIRECTOR_SESSION_TOKEN: sessionToken,
    AIGC_DIRECTOR_BOOTSTRAP_TOKEN: bootstrapToken,
    AIGC_DIRECTOR_STUDIO_DIR: studioDirectory,
    AIGC_DIRECTOR_DEMO_ASSET_DIR: demoAssetDirectory,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let ready = false
let stdoutBuffer = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk
  const lines = stdoutBuffer.split('\n')
  stdoutBuffer = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.startsWith('DIRECTOR_SERVER_READY ')) {
      process.stdout.write(`${line}\n`)
      continue
    }
    const info = JSON.parse(line.slice('DIRECTOR_SERVER_READY '.length))
    const origin = `http://127.0.0.1:${info.port}`
    const url = `${origin}/local-session/bootstrap?token=${encodeURIComponent(bootstrapToken)}&return=${encodeURIComponent('/studio?workspace=project_center')}`
    ready = true
    process.stdout.write(`AIGC 导演工作室已启动：${origin}/studio\n`)
    process.stdout.write(process.env.AIGC_DIRECTOR_NO_OPEN === '1'
      ? '自动打开浏览器已禁用；关闭本终端或按 Ctrl+C 即可停止服务。\n'
      : '浏览器将自动打开；关闭本终端或按 Ctrl+C 即可停止服务。\n')
    process.stdout.write('数据仅保存在本机；默认为零 Key Demo，Provider 网络已禁用。\n')
    if (process.env.AIGC_DIRECTOR_EXIT_AFTER_READY === '1') {
      child.kill('SIGTERM')
      return
    }
    if (process.env.AIGC_DIRECTOR_NO_OPEN !== '1') openBrowser(url, `${origin}/studio`)
  }
})
child.stderr.pipe(process.stderr)

function openBrowser(url, publicUrl) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const opener = spawn(command, args, { detached: true, stdio: 'ignore' })
  opener.once('error', () => {
    process.stderr.write(`[local] 无法调用默认浏览器；服务仍运行于 ${publicUrl}。一次性会话地址不会写入日志，请修复默认浏览器设置后重启。\n`)
  })
  opener.unref()
}

let shuttingDown = false
function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true
  if (!child.killed) child.kill(signal)
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
child.once('exit', (code, signal) => {
  if (smokeDataDirectory) rmSync(smokeDataDirectory, { recursive: true, force: true })
  if (!ready && code !== 0) process.stderr.write(`[local] 服务启动失败：${signal ?? code ?? 'unknown'}\n`)
  process.exit(code ?? (signal ? 1 : 0))
})
