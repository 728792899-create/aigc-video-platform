import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

const token = randomBytes(32).toString('base64url')
const children = new Set()
let shuttingDown = false

function start(label, args, env) {
  const child = spawn('pnpm', args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  children.add(child)
  child.once('exit', (code, signal) => {
    children.delete(child)
    if (!shuttingDown && (signal || code !== 0)) {
      console.error(`[${label}] exited unexpectedly: ${signal ?? code ?? 'unknown'}`)
      shutdown(code ?? 1)
    }
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 800).unref()
}

process.once('SIGINT', () => shutdown(0))
process.once('SIGTERM', () => shutdown(0))

const shared = { DEMO_MODE: '1', PROVIDER_NETWORK_DISABLED: '1' }
start('server', ['--filter', '@aigc-director/server', 'dev'], {
  ...shared,
  AIGC_DIRECTOR_PORT: '33100',
  AIGC_DIRECTOR_SESSION_TOKEN: token,
  AIGC_DIRECTOR_ALLOWED_ORIGINS: 'http://127.0.0.1:5173',
})
start('studio', ['--filter', '@aigc-director/studio', 'dev'], {
  ...shared,
  VITE_DIRECTOR_SESSION_TOKEN: token,
})
