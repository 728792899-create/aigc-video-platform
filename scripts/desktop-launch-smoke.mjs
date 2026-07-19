import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const executable = process.env.AIGC_DIRECTOR_EXECUTABLE
if (!executable) throw new Error('AIGC_DIRECTOR_EXECUTABLE_REQUIRED')
const appData = mkdtempSync(join(tmpdir(), 'aigc-director-desktop-smoke-'))

try {
  if (process.platform === 'darwin') {
    const resolvedExecutable = resolve(executable)
    const appMarker = '.app/Contents/MacOS/'
    const markerIndex = resolvedExecutable.indexOf(appMarker)
    const sourceApp = resolvedExecutable.endsWith('.app')
      ? resolvedExecutable
      : markerIndex >= 0 ? resolvedExecutable.slice(0, markerIndex + 4) : undefined
    if (!sourceApp) throw new Error('AIGC_DIRECTOR_MAC_APP_REQUIRED')

    const resultFile = join(appData, 'desktop-smoke-result.txt')
    const launched = spawnSync('open', ['-n', '-W', sourceApp, '--args', '--director-smoke', `--director-smoke-root=${appData}`], { encoding: 'utf8', timeout: 30_000 })
    const result = existsSync(resultFile) ? readFileSync(resultFile, 'utf8').trim() : ''
    if (launched.status !== 0 || result !== 'DIRECTOR_DESKTOP_READY') {
      throw new Error(`DESKTOP_LAUNCH_FAILED:code=${launched.status ?? 'null'}:signal=${launched.signal ?? 'none'}:${result || String(launched.stderr).slice(-300)}`)
    }
    console.log('Desktop launch smoke passed')
  } else {
    const result = await new Promise((resolveResult, reject) => {
    const child = spawn(resolve(executable), [], {
      env: {
        ...process.env,
        AIGC_DIRECTOR_APP_DATA_DIR: appData,
        AIGC_DIRECTOR_SKIP_LEGACY_PURGE: '1',
        AIGC_DIRECTOR_DESKTOP_SMOKE: '1',
        DEMO_MODE: '1',
        PROVIDER_NETWORK_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`DESKTOP_LAUNCH_TIMEOUT:${output.slice(-800)}`)) }, 30_000)
    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code, signal) => { clearTimeout(timer); resolveResult({ code, signal, output }) })
    })
    if (result.code !== 0 || !result.output.includes('DIRECTOR_DESKTOP_READY')) throw new Error(`DESKTOP_LAUNCH_FAILED:code=${result.code ?? 'null'}:signal=${result.signal ?? 'none'}:${result.output.slice(-400)}`)
    console.log('Desktop launch smoke passed')
  }
} finally {
  rmSync(appData, { recursive: true, force: true })
}
