import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifestPath = join(root, '.desktop-stage', 'local-package-output.json')

if (process.platform !== 'darwin') throw new Error('DESKTOP_OPEN_DEMO_UNSUPPORTED_PLATFORM')
if (!existsSync(manifestPath)) throw new Error('DESKTOP_PACKAGE_MANIFEST_MISSING: run pnpm pack first')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.platform !== 'darwin' || manifest.arch !== process.arch) {
  throw new Error(`DESKTOP_PACKAGE_PLATFORM_MISMATCH:${manifest.platform}/${manifest.arch}`)
}

const appBundle = join(resolve(manifest.output), `mac-${process.arch}`, 'AIGC 导演工作室.app')
if (!existsSync(appBundle)) throw new Error(`DESKTOP_PACKAGE_MISSING:${appBundle}`)

const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundle], {
  encoding: 'utf8',
})
if (verified.status !== 0) {
  throw new Error(`DESKTOP_PACKAGE_SIGNATURE_INVALID:${String(verified.stderr).trim().slice(-500)}`)
}

const isolatedRoot = mkdtempSync(join(tmpdir(), 'aigc-director-isolated-'))
const opened = spawnSync('/usr/bin/open', [
  '-n',
  appBundle,
  '--args',
  `--director-isolated-root=${isolatedRoot}`,
], { stdio: 'inherit' })
if (opened.error) throw opened.error
if (opened.status !== 0) throw new Error(`DESKTOP_OPEN_FAILED:${opened.status ?? 'unknown'}`)

console.log(`Opened verified isolated Demo package: ${appBundle}`)
console.log(`Isolated runtime root: ${isolatedRoot}`)
