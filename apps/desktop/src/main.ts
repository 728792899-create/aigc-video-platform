import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { access, appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { z } from 'zod'
import { CredentialVault } from './credentialVault.js'
import { LEGACY_CONFIRMATION, purgeLegacyData, scanLegacyData, type LegacySummary } from './legacyPurge.js'
import { extractReadyPort, sanitizeServerDiagnostic, startupErrorDescription } from './serverLifecycle.js'

let mainWindow: BrowserWindow | undefined
let serverProcess: ChildProcess | undefined
let serverConfig: { port: number; token: string } | undefined
let pendingLegacySummary: LegacySummary | undefined

function resolveTemporaryRoot(flag: string, prefix: string): string | undefined {
  const value = process.argv.find((argument) => argument.startsWith(`${flag}=`))?.slice(flag.length + 1)
  if (!value) return undefined
  const root = resolve(value)
  const systemTemp = resolve(tmpdir())
  if (!root.startsWith(`${systemTemp}/${prefix}`)) return undefined
  return root
}

const desktopSmokeRoot = process.argv.includes('--director-smoke')
  ? resolveTemporaryRoot('--director-smoke-root', 'aigc-director-desktop-smoke-')
  : undefined
const isolatedRoot = resolveTemporaryRoot('--director-isolated-root', 'aigc-director-isolated-')
const desktopDataRoot = desktopSmokeRoot ?? isolatedRoot
const desktopSmokeEnabled = Boolean(desktopSmokeRoot)
const appDataDirectory = desktopDataRoot
  ? join(desktopDataRoot, 'app-data')
  : process.env.AIGC_DIRECTOR_APP_DATA_DIR ? resolve(process.env.AIGC_DIRECTOR_APP_DATA_DIR) : app.getPath('appData')
const userDataDirectory = join(appDataDirectory, 'AIGC Director Studio')
mkdirSync(userDataDirectory, { recursive: true, mode: 0o700 })
app.setPath('userData', userDataDirectory)

const preloadPath = join(__dirname, 'preload.cjs')
const credentialVault = new CredentialVault(join(userDataDirectory, 'secure', 'credentials.json'))

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function recordStartupFailure(code: string, details: string, token: string): Promise<void> {
  try {
    const logDirectory = join(userDataDirectory, 'logs')
    await mkdir(logDirectory, { recursive: true, mode: 0o700 })
    const diagnostic = sanitizeServerDiagnostic(details, [token])
    await appendFile(join(logDirectory, 'desktop-startup.log'), `${new Date().toISOString()} ${code}\n${diagnostic}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Logging must never mask the original startup error.
  }
}

async function writeDesktopSmokeResult(result: string): Promise<void> {
  const configuredResult = desktopSmokeRoot ? join(desktopSmokeRoot, 'desktop-smoke-result.txt') : process.env.AIGC_DIRECTOR_DESKTOP_SMOKE_RESULT
  if ((!desktopSmokeEnabled && process.env.AIGC_DIRECTOR_DESKTOP_SMOKE !== '1') || !configuredResult) return
  try {
    const target = resolve(configuredResult)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, `${result}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // The smoke result is diagnostic-only and must not affect product startup.
  }
}

async function startServer(): Promise<{ port: number; token: string }> {
  const token = randomBytes(32).toString('base64url')
  const packaged = app.isPackaged
  const serverEntry = packaged ? join(process.resourcesPath, 'server', 'dist', 'index.js') : join(app.getAppPath(), 'apps', 'server', 'dist', 'index.js')
  const studioDirectory = packaged ? join(process.resourcesPath, 'studio') : join(app.getAppPath(), 'apps', 'studio', 'dist')
  serverProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      AIGC_DIRECTOR_PORT: '0',
      AIGC_DIRECTOR_SESSION_TOKEN: token,
      AIGC_DIRECTOR_DATA_DIR: process.env.AIGC_DIRECTOR_DATA_DIR ?? join(userDataDirectory, 'data'),
      AIGC_DIRECTOR_STUDIO_DIR: studioDirectory,
      AIGC_DIRECTOR_VENDOR_DIR: packaged ? join(process.resourcesPath, 'server', 'vendor') : join(app.getAppPath(), 'node_modules'),
      AIGC_DIRECTOR_ALLOWED_ORIGINS: '',
      DEMO_MODE: process.env.DEMO_MODE ?? '1',
      PROVIDER_NETWORK_DISABLED: process.env.PROVIDER_NETWORK_DISABLED ?? '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const port = await new Promise<number>((resolveReady, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const fail = (code: string, details: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void recordStartupFailure(code, details, token).finally(() => reject(new Error(code)))
    }
    const timeout = setTimeout(() => fail('SERVER_START_TIMEOUT', `${stdout}\n${stderr}`), 20_000)
    serverProcess?.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr = `${stderr}${text}`.slice(-16_000)
      if (desktopSmokeEnabled || process.env.AIGC_DIRECTOR_DESKTOP_SMOKE === '1') process.stderr.write(`DIRECTOR_SERVER_CHILD:${sanitizeServerDiagnostic(text, [token])}`)
    })
    const onData = (chunk: Buffer): void => {
      stdout = `${stdout}${chunk.toString()}`.slice(-16_000)
      const readyPort = extractReadyPort(stdout)
      if (readyPort && !settled) {
        settled = true
        clearTimeout(timeout)
        resolveReady(readyPort)
      }
    }
    serverProcess?.stdout?.on('data', onData)
    serverProcess?.once('exit', (code) => fail('SERVER_EXITED', `exit=${code ?? 'unknown'}\n${stdout}\n${stderr}`))
    serverProcess?.once('error', (error) => fail('SERVER_SPAWN_FAILED', `${error.name}:${error.message}`))
  })
  return { port, token }
}

async function showLegacyPurgeGate(summary: LegacySummary): Promise<boolean> {
  pendingLegacySummary = summary
  const window = new BrowserWindow({
    width: 620, height: 600, resizable: false, maximizable: false, minimizable: false,
    title: 'AIGC 导演工作室 · 数据清理确认',
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  window.removeMenu()
  await window.loadFile(join(__dirname, 'purge.html'))
  return await new Promise<boolean>((resolveDecision) => {
    let resolved = false
    const finish = (decision: boolean): void => { if (!resolved) { resolved = true; resolveDecision(decision) } }
    window.on('closed', () => finish(false))
    ipcMain.once('legacy-purge:completed', () => { finish(true); if (!window.isDestroyed()) window.close() })
    ipcMain.once('legacy-purge:cancelled', () => { finish(false); if (!window.isDestroyed()) window.close() })
  })
}

function registerIpc(): void {
  ipcMain.handle('legacy-purge:summary', () => {
    const summary = pendingLegacySummary
    return summary ? { totalFiles: summary.totalFiles, totalBytes: summary.totalBytes, locations: summary.locations.map((item) => ({ label: item.label, files: item.files, bytes: item.bytes })) } : { totalFiles: 0, totalBytes: 0, locations: [] }
  })
  ipcMain.handle('legacy-purge:confirm', async (_event, rawConfirmation: unknown) => {
    const confirmation = z.string().max(20).parse(rawConfirmation)
    if (!pendingLegacySummary) throw new Error('LEGACY_SUMMARY_MISSING')
    await purgeLegacyData(appDataDirectory, pendingLegacySummary, confirmation, join(userDataDirectory, 'legacy-purge-v2.json'))
    pendingLegacySummary = undefined
    ipcMain.emit('legacy-purge:completed')
    return { completed: true }
  })
  ipcMain.handle('legacy-purge:cancel', () => { ipcMain.emit('legacy-purge:cancelled'); return { cancelled: true } })
  ipcMain.handle('director:session', () => {
    if (!serverConfig) throw new Error('SERVER_NOT_READY')
    return { apiBaseUrl: `http://127.0.0.1:${serverConfig.port}`, sessionToken: serverConfig.token, platform: process.platform }
  })
  ipcMain.handle('director:select-export-directory', async () => {
    const options: OpenDialogOptions = { title: '选择视频导出目录', properties: ['openDirectory', 'createDirectory'] }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('director:app-info', () => ({ name: app.getName(), version: app.getVersion() }))
  ipcMain.handle('credential:set', async (_event, raw: unknown) => {
    const input = z.object({ key: z.string(), secret: z.string() }).parse(raw)
    await credentialVault.set(input.key, input.secret)
    return { stored: true }
  })
  ipcMain.handle('credential:remove', async (_event, rawKey: unknown) => { await credentialVault.remove(z.string().parse(rawKey)); return { removed: true } })
}

async function createMainWindow(): Promise<void> {
  if (!serverConfig) throw new Error('SERVER_NOT_READY')
  const origin = `http://127.0.0.1:${serverConfig.port}`
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, minWidth: 980, minHeight: 680,
    title: 'AIGC 导演工作室', backgroundColor: '#070b13', show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged },
  })
  mainWindow.removeMenu()
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin)) event.preventDefault() })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.once('did-finish-load', async () => {
    if (desktopSmokeEnabled || process.env.AIGC_DIRECTOR_DESKTOP_SMOKE === '1') {
      try {
        const renderedTitle = await mainWindow?.webContents.executeJavaScript(
          "document.querySelector('h1')?.textContent ?? document.body?.innerText ?? ''",
          true,
        ) as unknown
        if (typeof renderedTitle !== 'string' || !renderedTitle.includes('AIGC')) {
          throw new Error('STUDIO_RENDER_FAILED')
        }
        await writeDesktopSmokeResult('DIRECTOR_DESKTOP_READY')
        process.stdout.write('DIRECTOR_DESKTOP_READY\n')
        setTimeout(() => app.quit(), 750)
      } catch (error: unknown) {
        const code = error instanceof Error ? error.message.split(':')[0] : 'STUDIO_RENDER_FAILED'
        await writeDesktopSmokeResult(`DIRECTOR_DESKTOP_ERROR:${code}`)
        process.stderr.write(`DIRECTOR_DESKTOP_ERROR:${code}\n`)
        app.quit()
      }
    }
  })
  await mainWindow.loadURL(`${origin}/studio`)
}

app.whenReady().then(async () => {
  await mkdir(userDataDirectory, { recursive: true, mode: 0o700 })
  registerIpc()
  const tombstone = join(userDataDirectory, 'legacy-purge-v2.json')
  if (!desktopDataRoot && process.env.AIGC_DIRECTOR_SKIP_LEGACY_PURGE !== '1' && !(await fileExists(tombstone))) {
    const summary = await scanLegacyData(appDataDirectory, userDataDirectory)
    if (summary.locations.length > 0 && !(await showLegacyPurgeGate(summary))) { app.quit(); return }
  }
  serverConfig = await startServer()
  await createMainWindow()
}).catch(async (error: unknown) => {
  const safeCode = error instanceof Error ? error.message.split(':')[0] ?? 'UNKNOWN_ERROR' : 'UNKNOWN_ERROR'
  await writeDesktopSmokeResult(`DIRECTOR_DESKTOP_ERROR:${safeCode}`)
  process.stderr.write(`DIRECTOR_DESKTOP_ERROR:${safeCode}\n`)
  dialog.showErrorBox('AIGC 导演工作室启动失败', startupErrorDescription(safeCode))
  app.quit()
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { serverProcess?.kill('SIGTERM') })

export { LEGACY_CONFIRMATION }
