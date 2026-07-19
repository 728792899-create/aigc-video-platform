import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const stage = resolve(root, '.desktop-stage')
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const requiredInputs = Object.freeze([
  'apps/desktop/dist/main.cjs',
  'apps/desktop/dist/preload.cjs',
  'apps/desktop/dist/purge.html',
  'apps/studio/dist/index.html',
  '.package-stage/server/dist/index.js',
  'resources/icon.icns',
  'resources/icon.ico',
  'resources/icon.png',
  'resources/entitlements.adhoc.plist',
  'resources/entitlements.mac.plist',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'scripts/after-pack.mjs',
  'scripts/notarize.mjs',
])

for (const input of requiredInputs) {
  const absolute = resolve(root, input)
  if (!existsSync(absolute) || statSync(absolute).size === 0) throw new Error(`DESKTOP_STAGE_INPUT_MISSING:${input}`)
}

if (existsSync(stage) && lstatSync(stage).isSymbolicLink()) throw new Error('DESKTOP_STAGE_SYMLINK_REJECTED')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

const copies = Object.freeze([
  ['apps/desktop/dist', 'apps/desktop/dist'],
  ['apps/studio/dist', 'studio'],
  ['.package-stage/server', 'server'],
  ['resources', 'resources'],
  ['LICENSE', 'LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['scripts/after-pack.mjs', 'scripts/after-pack.mjs'],
  ['scripts/notarize.mjs', 'scripts/notarize.mjs'],
])
for (const [source, target] of copies) {
  cpSync(resolve(root, source), resolve(stage, target), { recursive: true, verbatimSymlinks: true })
}

const { directories: _directories, extraResources: _extraResources, ...portableBuild } = rootPackage.build
const stagePackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  private: true,
  description: rootPackage.description,
  author: rootPackage.author,
  license: rootPackage.license,
  packageManager: 'npm@10.9.2',
  main: 'apps/desktop/dist/main.cjs',
  build: {
    ...portableBuild,
    npmRebuild: false,
    directories: { output: '../dist-electron', buildResources: 'resources' },
    files: ['apps/desktop/dist/**/*', 'package.json'],
    extraResources: [
      { from: 'server', to: 'server' },
      { from: 'studio', to: 'studio' },
      { from: 'LICENSE', to: 'LICENSE' },
      { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
    ],
  },
}
writeFileSync(resolve(stage, 'package.json'), `${JSON.stringify(stagePackage, null, 2)}\n`, 'utf8')

const forbiddenName = /(?:^|\/)[^/]+ \d+(?:\.[^/]*)?$|(?:\.d)?\.(?:ts|tsx|map)$|\.(?:sqlite3?|db|log|pem|pfx|key)$/iu
const forbiddenDirectory = /(?:^|\/)(?:logs?|uploads?|media|exports?|runtime|\.director-data)(?:\/|$)/iu
function verify(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    const name = relative(stage, absolute).split('\\').join('/')
    if (forbiddenName.test(name) || forbiddenDirectory.test(name)) throw new Error(`DESKTOP_STAGE_FORBIDDEN_FILE:${name}`)
    if (entry.isDirectory()) verify(absolute)
  }
}
verify(stage)

console.log(`Desktop package stage prepared: ${stage}`)
