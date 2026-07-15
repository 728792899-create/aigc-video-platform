import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const executable = path.resolve(String(process.env.AIGC_DESKTOP_EXECUTABLE || ''))
if (!process.env.AIGC_DESKTOP_EXECUTABLE || !path.isAbsolute(executable) || !fs.existsSync(executable)) {
  throw new Error('AIGC_DESKTOP_EXECUTABLE 必须指向已安装桌面应用的绝对可执行文件')
}

async function freePort() {
  const socket = net.createServer()
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('无法分配桌面冒烟端口')
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()))
  return address.port
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-desktop-install-smoke-'))
const userDataDir = path.join(root, 'user-data')
const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}`
const environment = {
  ...process.env,
  AIGC_STUDIO_ALLOW_USER_DATA_OVERRIDE: '1',
  AIGC_STUDIO_USER_DATA_DIR: userDataDir,
  AIGC_STUDIO_PORT: String(port),
  AIGC_DISABLE_AUTO_UPDATE: '1',
  DEMO_MODE: '1',
  DEMO_SILENT_TTS: '1',
  LOG_HTTP: '0',
}
for (const key of [
  'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'GEMINI_API_KEY',
  'RUNWAY_API_KEY', 'KLING_API_KEY', 'ARK_API_KEY', 'VOLCANO_API_KEY', 'AIGC_CREDENTIALS_B64',
]) delete environment[key]

const child = spawn(executable, [], {
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let output = ''
child.stdout.on('data', (chunk) => { output += chunk.toString() })
child.stderr.on('data', (chunk) => { output += chunk.toString() })

async function waitForHealth(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`桌面应用提前退出：${child.exitCode}\n${output.slice(-2000)}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) { lastError = error instanceof Error ? error.message : String(error) }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`安装后的桌面后端未就绪：${lastError}\n${output.slice(-2000)}`)
}

async function request(method, urlPath, body) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method} ${urlPath}: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 500)}`)
  return payload.data
}

async function waitForTask(taskId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let task = null
  while (Date.now() < deadline) {
    task = await request('GET', `/api/tasks/${taskId}`)
    if (['success', 'failed', 'partial', 'canceled', 'interrupted'].includes(task?.status)) return task
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  throw new Error(`桌面 Demo 导出超时：${JSON.stringify(task).slice(0, 800)}`)
}

async function stop() {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

try {
  await waitForHealth()
  const started = await request('POST', '/api/ai/auto-produce', {
    theme: '干净机安装 Demo 导出验收',
    duration: '8-12',
    ratio: '16:9',
    motion: 'none',
  })
  const task = await waitForTask(started.task_id)
  if (task.status !== 'success' || !task.result?.file_url) {
    throw new Error(`安装后的 Demo 导出失败：${task.status} ${task.error || task.message || ''}\n${JSON.stringify(task.meta?.workflow || {}, null, 2).slice(0, 4000)}`)
  }
  const response = await fetch(`${baseUrl}${task.result.file_url}`)
  if (!response.ok) throw new Error(`导出文件不可读：HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < 2_000 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
    throw new Error(`安装后的导出不是有效 MP4：${bytes.length} bytes`)
  }
  console.log(`[desktop-install-smoke] passed task=${started.task_id} bytes=${bytes.length}`)
} finally {
  await stop()
  const logPath = path.join(userDataDir, 'logs', 'backend.log')
  if (fs.existsSync(logPath)) {
    const log = fs.readFileSync(logPath, 'utf8')
    if (/\b(?:sk|token|key)-[A-Za-z0-9_-]{8,}\b/i.test(log)) throw new Error('桌面日志疑似包含未脱敏密钥')
  }
  if (process.env.AIGC_DESKTOP_KEEP_TEMP === '1') console.error(`[desktop-install-smoke] kept temp directory: ${root}`)
  else fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
