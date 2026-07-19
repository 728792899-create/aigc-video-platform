import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const stage = join(root, '.desktop-stage')
const electronDist = join(root, 'node_modules', 'electron', 'dist')
const builder = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const output = process.env.AIGC_DIRECTOR_PACKAGE_OUTPUT
  ? resolve(process.env.AIGC_DIRECTOR_PACKAGE_OUTPUT)
  : mkdtempSync(join(tmpdir(), 'aigc-director-package-'))

for (const required of [stage, electronDist, builder]) {
  if (!existsSync(required)) throw new Error(`DESKTOP_PACKAGE_INPUT_MISSING:${required}`)
}

const args = [
  builder,
  '--dir',
  '--projectDir', stage,
  `--config.electronDist=${electronDist}`,
  `--config.directories.output=${output}`,
]
if (process.platform === 'darwin') args.push(
  '--config.mac.identity=-',
  '--config.mac.entitlements=resources/entitlements.adhoc.plist',
  '--config.mac.entitlementsInherit=resources/entitlements.adhoc.plist',
)
else if (process.platform === 'win32') args.push('--config.win.signAndEditExecutable=false')

const built = spawnSync(process.execPath, args, {
  cwd: root,
  env: { ...process.env, SKIP_NOTARIZE: '1' },
  encoding: 'utf8',
  stdio: 'inherit',
})
if (built.error) throw built.error
if (built.status !== 0) throw new Error(`DESKTOP_PACKAGE_FAILED:${built.status ?? 'unknown'}`)

if (process.platform === 'darwin') {
  const appBundle = join(output, `mac-${process.arch}`, 'AIGC 导演工作室.app')
  const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundle], { encoding: 'utf8' })
  if (verified.status !== 0) throw new Error(`DESKTOP_PACKAGE_SIGNATURE_INVALID:${String(verified.stderr).trim().slice(-500)}`)
}

// Local ad-hoc bundles are intentionally assembled outside the repository.
// Finder/sync metadata can be reattached to bundles stored in the worktree and
// invalidate their nested signatures after electron-builder has finished. A
// stale dist-electron bundle is therefore actively removed after (and only
// after) a replacement package has passed strict signature verification.
const unsafeWorkspaceOutput = join(root, 'dist-electron')
if (existsSync(unsafeWorkspaceOutput)) {
  rmSync(unsafeWorkspaceOutput, { recursive: true, force: true })
  console.log(`Removed unsafe stale workspace package: ${unsafeWorkspaceOutput}`)
}

const manifest = join(stage, 'local-package-output.json')
writeFileSync(manifest, `${JSON.stringify({ output, platform: process.platform, arch: process.arch, generatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
console.log(`Desktop package verified: ${output}`)
