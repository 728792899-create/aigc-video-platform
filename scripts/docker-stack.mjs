import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stateDirectory = join(root, '.local', 'docker')
const envFile = join(stateDirectory, 'runtime.env')
const secretFile = join(stateDirectory, 'provider-credentials.json')
const action = process.argv[2] ?? 'up'

function runCompose(args, options = {}) {
  const result = spawnSync('docker', ['compose', '--env-file', envFile, ...args], {
    cwd: root,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`DOCKER_COMPOSE_FAILED:${result.status ?? 'unknown'}`)
  return result.stdout ?? ''
}

async function prepareState() {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  const sessionToken = randomBytes(32).toString('base64url')
  const bootstrapToken = randomBytes(32).toString('base64url')
  const port = process.env.AIGC_DIRECTOR_PUBLIC_PORT ?? '33100'
  const content = [
    `AIGC_DIRECTOR_SESSION_TOKEN=${sessionToken}`,
    `AIGC_DIRECTOR_BOOTSTRAP_TOKEN=${bootstrapToken}`,
    `AIGC_DIRECTOR_PUBLIC_PORT=${port}`,
    `AIGC_DIRECTOR_CREDENTIALS_SECRET_FILE=${secretFile}`,
    `DEMO_MODE=${process.env.DEMO_MODE ?? '1'}`,
    `PROVIDER_NETWORK_DISABLED=${process.env.PROVIDER_NETWORK_DISABLED ?? '1'}`,
    '',
  ].join('\n')
  await writeFile(envFile, content, { encoding: 'utf8', mode: 0o600 })
  await chmod(envFile, 0o600)
  try { await readFile(secretFile, 'utf8') } catch {
    await writeFile(secretFile, '{}\n', { encoding: 'utf8', mode: 0o600 })
  }
  await chmod(secretFile, 0o600)
  return { bootstrapToken, port }
}

function openBrowser(url, publicUrl) {
  if (process.env.AIGC_DIRECTOR_NO_OPEN === '1') return
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.once('error', () => {
    process.stderr.write(`[docker] 无法调用默认浏览器；服务仍运行于 ${publicUrl}。一次性会话地址不会写入日志，请在有桌面浏览器的主机重新执行启动命令。\n`)
  })
  child.unref()
}

async function waitForHealth(port) {
  const deadline = Date.now() + 120_000
  const url = `http://127.0.0.1:${port}/api/v2/health`
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000))
  }
  throw new Error('DOCKER_HEALTH_TIMEOUT')
}

try {
  if (spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status !== 0) throw new Error('DOCKER_COMPOSE_NOT_FOUND')
  if (action === 'down') {
    try { await readFile(envFile, 'utf8') } catch { await prepareState() }
    runCompose(['down'])
    process.stdout.write('Docker 本地服务已停止，数据卷保留。\n')
  } else if (action === 'logs') {
    runCompose(['logs', '--tail=200', '-f', 'studio'])
  } else if (action === 'up' || action === 'smoke') {
    const { bootstrapToken, port } = await prepareState()
    runCompose(['up', '--build', '-d'])
    await waitForHealth(port)
    const origin = `http://127.0.0.1:${port}`
    const url = `${origin}/local-session/bootstrap?token=${encodeURIComponent(bootstrapToken)}&return=${encodeURIComponent('/studio?workspace=project_center')}`
    process.stdout.write(`Docker 工作台已就绪：${origin}/studio\n`)
    process.stdout.write('浏览器将自动打开；容器会在后台继续运行。\n')
    process.stdout.write('凭据文件通过 Docker Secret 只读挂载，不会进入镜像或项目包。\n')
    if (action === 'smoke') {
      runCompose(['down'])
    } else {
      openBrowser(url, `${origin}/studio`)
    }
  } else {
    throw new Error(`UNKNOWN_DOCKER_ACTION:${action}`)
  }
} catch (error) {
  process.stderr.write(`[docker] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
