import { lstat, mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

export const LEGACY_CONFIRMATION = '删除旧数据'

export interface LegacyLocation {
  path: string
  label: string
  files: number
  bytes: number
}

export interface LegacySummary {
  locations: LegacyLocation[]
  totalFiles: number
  totalBytes: number
}

// These identifiers exist only to perform the user-approved one-time purge.
const legacyDirectoryNames = ['AIGC 视频工作台', 'aigc-video-studio', 'snoopy-king', '史努比大王'] as const

async function sizeDirectory(directory: string): Promise<{ files: number; bytes: number }> {
  const rootInfo = await lstat(directory)
  if (rootInfo.isSymbolicLink()) throw new Error('LEGACY_PATH_SYMLINK_REJECTED')
  if (!rootInfo.isDirectory()) return { files: 1, bytes: rootInfo.size }
  let files = 0
  let bytes = 0
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) { const info = await stat(path); files += 1; bytes += info.size }
    }
  }
  await walk(directory)
  return { files, bytes }
}

export async function scanLegacyData(appDataDirectory: string, currentUserData: string): Promise<LegacySummary> {
  const appData = resolve(appDataDirectory)
  const current = resolve(currentUserData)
  const locations: LegacyLocation[] = []
  for (const name of legacyDirectoryNames) {
    const path = resolve(appData, name)
    if (path === current) continue
    try {
      const size = await sizeDirectory(path)
      // Canonicalize after the explicit symlink check so macOS /var -> /private/var
      // aliases cannot make the later containment check disagree with realpath(appData).
      locations.push({ path: await realpath(path), label: name, ...size })
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : ''
      if (code !== 'ENOENT') throw error
    }
  }
  return { locations, totalFiles: locations.reduce((sum, item) => sum + item.files, 0), totalBytes: locations.reduce((sum, item) => sum + item.bytes, 0) }
}

function assertContained(appData: string, target: string): void {
  const pathFromRoot = relative(resolve(appData), resolve(target))
  if (!pathFromRoot || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || pathFromRoot.includes(`${sep}..${sep}`)) throw new Error('LEGACY_PATH_OUTSIDE_APP_DATA')
}

export async function purgeLegacyData(appDataDirectory: string, summary: LegacySummary, confirmation: string, tombstonePath: string): Promise<void> {
  if (confirmation !== LEGACY_CONFIRMATION) throw new Error('LEGACY_CONFIRMATION_INVALID')
  const appData = await realpath(resolve(appDataDirectory))
  for (const location of summary.locations) {
    assertContained(appData, location.path)
    const info = await lstat(location.path)
    if (info.isSymbolicLink()) throw new Error('LEGACY_PATH_SYMLINK_REJECTED')
    const parent = await realpath(resolve(location.path, '..'))
    if (parent !== appData) throw new Error('LEGACY_PATH_PARENT_INVALID')
    await rm(location.path, { recursive: true, force: false })
  }
  await mkdir(resolve(tombstonePath, '..'), { recursive: true })
  await writeFile(tombstonePath, JSON.stringify({ completedAt: new Date().toISOString(), locations: summary.locations.map((item) => basename(item.path)) }), { mode: 0o600, flag: 'wx' })
}
