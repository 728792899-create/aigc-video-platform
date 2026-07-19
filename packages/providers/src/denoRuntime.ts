import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

export const DENO_PLUGIN_RUNTIME_VERSION = '2.9.2' as const

export interface DenoRuntimeArtifact {
  version: typeof DENO_PLUGIN_RUNTIME_VERSION
  platform: 'darwin' | 'win32' | 'linux'
  arch: 'arm64' | 'x64'
  assetName: string
  url: string
  size: number
  sha256: string
}

const releaseBase = `https://github.com/denoland/deno/releases/download/v${DENO_PLUGIN_RUNTIME_VERSION}`
const artifact = (
  platform: DenoRuntimeArtifact['platform'], arch: DenoRuntimeArtifact['arch'],
  assetName: string, size: number, sha256: string,
): DenoRuntimeArtifact => ({ version: DENO_PLUGIN_RUNTIME_VERSION, platform, arch, assetName, url: `${releaseBase}/${assetName}`, size, sha256 })

// Pinned from the official v2.9.2 GitHub release assets and their adjacent .zip.sha256sum files.
export const DENO_RUNTIME_CATALOG: readonly DenoRuntimeArtifact[] = Object.freeze([
  artifact('darwin', 'arm64', 'deno-aarch64-apple-darwin.zip', 37_981_362, '687ae485168ba73a4f1ee3a954eb4f077eca82f2fefd236a6a83a3889287876c'),
  artifact('darwin', 'x64', 'deno-x86_64-apple-darwin.zip', 42_336_919, 'c953379e5a85a0a30e99aa51b807633e380e809a1181f53e4904d5fa73785bff'),
  artifact('win32', 'x64', 'deno-x86_64-pc-windows-msvc.zip', 42_721_120, '5fe194d26ac5ef77fcc5288c2c438c7a0465f3b6180440ebf04092714bf2dcdf'),
  artifact('linux', 'x64', 'deno-x86_64-unknown-linux-gnu.zip', 43_926_976, '934d1bd5cb09eaed7f2e4a4fc58208d04a3c5c0fcde9f319d93d735265c67a4a'),
  artifact('linux', 'arm64', 'deno-aarch64-unknown-linux-gnu.zip', 42_088_401, '310b8f48e59964ff18890d35e64f64fb90e8b1cc5d9ebff8c818327d5afb16d2'),
])

export type DenoRuntimeInstallErrorCode =
  | 'DENO_RUNTIME_PLATFORM_UNSUPPORTED'
  | 'DENO_RUNTIME_DOWNLOAD_FAILED'
  | 'DENO_RUNTIME_DOWNLOAD_TOO_LARGE'
  | 'DENO_RUNTIME_ARCHIVE_SIZE_MISMATCH'
  | 'DENO_RUNTIME_ARCHIVE_HASH_MISMATCH'
  | 'DENO_RUNTIME_ARCHIVE_INVALID'
  | 'DENO_RUNTIME_PROBE_FAILED'
  | 'DENO_RUNTIME_INSTALL_CONFLICT'
  | 'DENO_RUNTIME_ABORTED'

export class DenoRuntimeInstallError extends Error {
  readonly name = 'DenoRuntimeInstallError'
  constructor(readonly code: DenoRuntimeInstallErrorCode) { super(code) }
}

export interface DenoRuntimeInstallReceipt {
  version: typeof DENO_PLUGIN_RUNTIME_VERSION
  platform: DenoRuntimeArtifact['platform']
  arch: DenoRuntimeArtifact['arch']
  assetName: string
  archiveSha256: string
  binarySha256: string
  executablePath: string
  installedAt: string
  reused: boolean
}

export interface DenoRuntimeInspection {
  state: 'not-installed' | 'ready' | 'invalid'
  artifact: DenoRuntimeArtifact
  receipt?: DenoRuntimeInstallReceipt
}

export type DenoRuntimeInstallPhase = 'downloading' | 'verifying' | 'extracting' | 'probing' | 'publishing'
export interface DenoRuntimeInstallProgress {
  phase: DenoRuntimeInstallPhase
  receivedBytes: number
  totalBytes: number
}
export type DenoRuntimeProgressListener = (progress: DenoRuntimeInstallProgress) => void

export type DenoRuntimeDownload = (artifact: DenoRuntimeArtifact, signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>> | AsyncIterable<Uint8Array>
export type DenoRuntimeProbe = (executablePath: string, signal: AbortSignal) => Promise<string>

export interface DenoRuntimeInstallerOptions {
  rootDirectory: string
  catalog?: readonly DenoRuntimeArtifact[]
  download?: DenoRuntimeDownload
  probe?: DenoRuntimeProbe
  now?: () => Date
  maxUncompressedBytes?: number
}

const allowedDownloadHost = (hostname: string): boolean => hostname === 'github.com' || hostname.endsWith('.githubusercontent.com')

async function defaultDownload(input: DenoRuntimeArtifact, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
  let url = new URL(input.url)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (url.protocol !== 'https:' || url.username || url.password || !allowedDownloadHost(url.hostname)) throw new DenoRuntimeInstallError('DENO_RUNTIME_DOWNLOAD_FAILED')
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal, headers: { 'user-agent': 'AIGC-Director-Studio-Runtime-Installer/2.0' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirects === 3) throw new DenoRuntimeInstallError('DENO_RUNTIME_DOWNLOAD_FAILED')
      url = new URL(location, url)
      continue
    }
    if (!response.ok || !response.body) throw new DenoRuntimeInstallError('DENO_RUNTIME_DOWNLOAD_FAILED')
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > input.size) throw new DenoRuntimeInstallError('DENO_RUNTIME_DOWNLOAD_TOO_LARGE')
    const reader = response.body.getReader()
    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const item = await reader.read()
            if (item.done) return
            yield item.value
          }
        } finally { await reader.cancel().catch(() => undefined) }
      },
    }
  }
  throw new DenoRuntimeInstallError('DENO_RUNTIME_DOWNLOAD_FAILED')
}

async function defaultProbe(executablePath: string, signal: AbortSignal): Promise<string> {
  return await new Promise((resolveProbe, rejectProbe) => {
    execFile(executablePath, ['--version'], {
      env: { DENO_NO_UPDATE_CHECK: '1', DENO_NO_PROMPT: '1', NO_COLOR: '1' },
      timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true, signal,
    }, (error, stdout) => error ? rejectProbe(error) : resolveProbe(stdout))
  })
}

const pathExists = async (path: string): Promise<boolean> => await stat(path).then(() => true, () => false)

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

async function openZip(path: string): Promise<ZipFile> {
  return await new Promise((resolveZip, rejectZip) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) rejectZip(error ?? new Error('zip unavailable'))
      else resolveZip(zip)
    })
  })
}

async function extractSingleRuntime(
  archivePath: string,
  executablePath: string,
  expectedName: string,
  maxUncompressedBytes: number,
  signal: AbortSignal,
): Promise<void> {
  const zip = await openZip(archivePath).catch(() => { throw new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_INVALID') })
  await new Promise<void>((resolveExtract, rejectExtract) => {
    let settled = false
    let entries = 0
    const onAbort = (): void => fail(new DenoRuntimeInstallError('DENO_RUNTIME_ABORTED'))
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      zip.close()
      rejectExtract(error instanceof DenoRuntimeInstallError ? error : new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_INVALID'))
    }
    zip.once('error', fail)
    zip.once('end', () => {
      if (entries !== 1) return fail(new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_INVALID'))
      settled = true
      signal.removeEventListener('abort', onAbort)
      zip.close()
      resolveExtract()
    })
    zip.on('entry', (entry: Entry) => {
      entries += 1
      const unixMode = entry.externalFileAttributes >>> 16
      const fileType = unixMode & 0o170000
      if (
        entries > 1 || entry.fileName !== expectedName || entry.fileName.includes('/') || entry.fileName.includes('\\') ||
        (entry.generalPurposeBitFlag & 0x1) !== 0 || fileType === 0o120000 ||
        entry.uncompressedSize <= 0 || entry.uncompressedSize > maxUncompressedBytes
      ) return fail(new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_INVALID'))
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(error)
        let extracted = 0
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            extracted += chunk.length
            if (extracted > maxUncompressedBytes) callback(new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_INVALID'))
            else callback(null, chunk)
          },
        })
        void pipeline(stream, limiter, createWriteStream(executablePath, { flags: 'wx', mode: 0o700 }), { signal })
          .then(() => zip.readEntry(), fail)
      })
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) return onAbort()
    zip.readEntry()
  })
}

const hasExpectedDenoVersion = (output: string, version: string): boolean => {
  const escaped = version.replaceAll('.', '\\.')
  return new RegExp(`^deno ${escaped}(?:\\s|$)`, 'u').test(output.split(/\r?\n/u)[0]?.trim() ?? '')
}

export function resolveDenoRuntimeArtifact(
  platform: NodeJS.Platform,
  arch: string,
  catalog: readonly DenoRuntimeArtifact[] = DENO_RUNTIME_CATALOG,
): DenoRuntimeArtifact {
  const found = catalog.find((item) => item.platform === platform && item.arch === arch)
  if (!found) throw new DenoRuntimeInstallError('DENO_RUNTIME_PLATFORM_UNSUPPORTED')
  return found
}

export class DenoRuntimeInstaller {
  private readonly rootDirectory: string
  private readonly catalog: readonly DenoRuntimeArtifact[]
  private readonly download: DenoRuntimeDownload
  private readonly probe: DenoRuntimeProbe
  private readonly now: () => Date
  private readonly maxUncompressedBytes: number

  constructor(options: DenoRuntimeInstallerOptions) {
    if (!isAbsolute(options.rootDirectory)) throw new Error('DENO_RUNTIME_ROOT_INVALID')
    if (options.catalog && process.env.NODE_ENV !== 'test') throw new Error('DENO_RUNTIME_CATALOG_OVERRIDE_DENIED')
    this.rootDirectory = resolve(options.rootDirectory)
    this.catalog = options.catalog ?? DENO_RUNTIME_CATALOG
    this.download = options.download ?? defaultDownload
    this.probe = options.probe ?? defaultProbe
    this.now = options.now ?? (() => new Date())
    this.maxUncompressedBytes = options.maxUncompressedBytes ?? 250 * 1024 * 1024
  }

  async inspect(platform: NodeJS.Platform, arch: string, signal: AbortSignal = new AbortController().signal): Promise<DenoRuntimeInspection> {
    if (signal.aborted) throw new DenoRuntimeInstallError('DENO_RUNTIME_ABORTED')
    const selected = resolveDenoRuntimeArtifact(platform, arch, this.catalog)
    const { targetDirectory, executablePath } = this.targetFor(selected)
    if (!await pathExists(targetDirectory)) return { state: 'not-installed', artifact: selected }
    try {
      return { state: 'ready', artifact: selected, receipt: await this.reuseInstalled(selected, targetDirectory, executablePath, signal) }
    } catch (error) {
      if (error instanceof DenoRuntimeInstallError && error.code === 'DENO_RUNTIME_ABORTED') throw error
      return { state: 'invalid', artifact: selected }
    }
  }

  async install(
    platform: NodeJS.Platform,
    arch: string,
    signal: AbortSignal = new AbortController().signal,
    onProgress: DenoRuntimeProgressListener = () => undefined,
  ): Promise<DenoRuntimeInstallReceipt> {
    if (signal.aborted) throw new DenoRuntimeInstallError('DENO_RUNTIME_ABORTED')
    const selected = resolveDenoRuntimeArtifact(platform, arch, this.catalog)
    const { targetDirectory, executableName, executablePath } = this.targetFor(selected)
    if (await pathExists(targetDirectory)) return await this.reuseInstalled(selected, targetDirectory, executablePath, signal)

    const stagingDirectory = resolve(this.rootDirectory, `.staging-${randomUUID()}`)
    const archivePath = join(stagingDirectory, selected.assetName)
    const stagedExecutable = join(stagingDirectory, executableName)
    await mkdir(stagingDirectory, { recursive: true, mode: 0o700 })
    try {
      await this.downloadArchive(selected, archivePath, signal, onProgress)
      onProgress({ phase: 'extracting', receivedBytes: selected.size, totalBytes: selected.size })
      await extractSingleRuntime(archivePath, stagedExecutable, executableName, this.maxUncompressedBytes, signal)
      await rm(archivePath, { force: true })
      if (selected.platform !== 'win32') await chmod(stagedExecutable, 0o700)
      onProgress({ phase: 'probing', receivedBytes: selected.size, totalBytes: selected.size })
      const versionOutput = await this.probe(stagedExecutable, signal).catch(() => { throw new DenoRuntimeInstallError(signal.aborted ? 'DENO_RUNTIME_ABORTED' : 'DENO_RUNTIME_PROBE_FAILED') })
      if (!hasExpectedDenoVersion(versionOutput, selected.version)) throw new DenoRuntimeInstallError('DENO_RUNTIME_PROBE_FAILED')
      const binarySha256 = await sha256File(stagedExecutable)
      const installedAt = this.now().toISOString()
      const receipt = {
        version: selected.version, platform: selected.platform, arch: selected.arch, assetName: selected.assetName,
        archiveSha256: selected.sha256, binarySha256, executablePath, installedAt,
      }
      await writeFile(join(stagingDirectory, 'runtime.json'), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await mkdir(dirname(targetDirectory), { recursive: true, mode: 0o700 })
      onProgress({ phase: 'publishing', receivedBytes: selected.size, totalBytes: selected.size })
      try { await rename(stagingDirectory, targetDirectory) } catch {
        if (await pathExists(targetDirectory)) return await this.reuseInstalled(selected, targetDirectory, executablePath, signal)
        throw new DenoRuntimeInstallError('DENO_RUNTIME_INSTALL_CONFLICT')
      }
      return { ...receipt, reused: false }
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true })
    }
  }

  private targetFor(selected: DenoRuntimeArtifact): { targetDirectory: string; executableName: string; executablePath: string } {
    const targetDirectory = resolve(this.rootDirectory, selected.version, `${selected.platform}-${selected.arch}`)
    if (!targetDirectory.startsWith(`${this.rootDirectory}${sep}`)) throw new Error('DENO_RUNTIME_TARGET_INVALID')
    const executableName = selected.platform === 'win32' ? 'deno.exe' : 'deno'
    return { targetDirectory, executableName, executablePath: join(targetDirectory, executableName) }
  }

  private async downloadArchive(
    selected: DenoRuntimeArtifact,
    archivePath: string,
    signal: AbortSignal,
    onProgress: DenoRuntimeProgressListener,
  ): Promise<void> {
    let total = 0
    const digest = createHash('sha256')
    onProgress({ phase: 'downloading', receivedBytes: 0, totalBytes: selected.size })
    try {
      const source = await this.download(selected, signal)
      const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          total += chunk.length
          if (total > selected.size) callback(new DenoRuntimeInstallError('DENO_RUNTIME_DOWNLOAD_TOO_LARGE'))
          else {
            digest.update(chunk)
            onProgress({ phase: 'downloading', receivedBytes: total, totalBytes: selected.size })
            callback(null, chunk)
          }
        },
      })
      await pipeline(Readable.from(source), verifier, createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }), { signal })
    } catch (error) {
      if (error instanceof DenoRuntimeInstallError) throw error
      throw new DenoRuntimeInstallError(signal.aborted ? 'DENO_RUNTIME_ABORTED' : 'DENO_RUNTIME_DOWNLOAD_FAILED')
    }
    if (total !== selected.size) throw new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_SIZE_MISMATCH')
    onProgress({ phase: 'verifying', receivedBytes: total, totalBytes: selected.size })
    if (digest.digest('hex') !== selected.sha256) throw new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_HASH_MISMATCH')
  }

  private async reuseInstalled(
    selected: DenoRuntimeArtifact,
    targetDirectory: string,
    executablePath: string,
    signal: AbortSignal,
  ): Promise<DenoRuntimeInstallReceipt> {
    try {
      const raw = JSON.parse(await readFile(join(targetDirectory, 'runtime.json'), 'utf8')) as Partial<DenoRuntimeInstallReceipt>
      if (
        raw.version !== selected.version || raw.platform !== selected.platform || raw.arch !== selected.arch ||
        raw.assetName !== selected.assetName || raw.archiveSha256 !== selected.sha256 || typeof raw.binarySha256 !== 'string' ||
        typeof raw.installedAt !== 'string' || raw.executablePath !== executablePath || await sha256File(executablePath) !== raw.binarySha256
      ) throw new Error('receipt mismatch')
      const versionOutput = await this.probe(executablePath, signal)
      if (!hasExpectedDenoVersion(versionOutput, selected.version)) throw new Error('version mismatch')
      return {
        version: selected.version, platform: selected.platform, arch: selected.arch, assetName: selected.assetName,
        archiveSha256: selected.sha256, binarySha256: raw.binarySha256, executablePath, installedAt: raw.installedAt, reused: true,
      }
    } catch {
      throw new DenoRuntimeInstallError(signal.aborted ? 'DENO_RUNTIME_ABORTED' : 'DENO_RUNTIME_INSTALL_CONFLICT')
    }
  }
}
