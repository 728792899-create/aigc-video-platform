import { cpSync, rmSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const stage = resolve(root, '.package-stage/server')
const stageRoot = resolve(root, '.package-stage')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'aigc-director-package-'))
const temporaryStage = resolve(temporaryRoot, 'server')
const pnpmCli = process.env.npm_execpath ? resolve(process.env.npm_execpath) : undefined
if (!pnpmCli || !existsSync(pnpmCli)) throw new Error('PACKAGE_STAGE_PNPM_CLI_MISSING')
mkdirSync(stageRoot, { recursive: true })
if (existsSync(stage)) renameSync(stage, resolve(stageRoot, `stale-${Date.now()}`))

function run(command, args, allowFailure = false) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  if (result.status !== 0 && !allowFailure) {
    const reason = result.error instanceof Error ? result.error.message : String(result.status ?? 'unknown')
    throw new Error(`PACKAGE_STAGE_FAILED:${command}:${reason}`)
  }
  return result
}

function runPnpm(args, allowFailure = false) {
  return run(process.execPath, [pnpmCli, ...args], allowFailure)
}

const serverPackage = JSON.parse(readFileSync(resolve(root, 'apps/server/package.json'), 'utf8'))
const runtimePackage = {
  name: serverPackage.name,
  version: serverPackage.version,
  private: true,
  type: 'module',
  main: './dist/index.js',
  dependencies: serverPackage.dependencies,
}

function packageVersion(directory, dependency) {
  try { return JSON.parse(readFileSync(resolve(directory, dependency, 'package.json'), 'utf8')).version }
  catch { return undefined }
}

function compatibleCachedDeployment() {
  const localModules = resolve(root, 'apps/server/node_modules')
  return readdirSync(stageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('stale-'))
    .map((entry) => resolve(stageRoot, entry.name))
    .filter((candidate) => existsSync(resolve(candidate, 'vendor/node_modules')))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    .find((candidate) => Object.keys(serverPackage.dependencies).every((dependency) => {
      const expected = packageVersion(localModules, dependency)
      const cached = packageVersion(resolve(candidate, 'vendor/node_modules'), dependency)
      return Boolean(expected && cached && expected === cached)
    }))
}

const deploy = runPnpm(['--filter', '@aigc-director/server', 'deploy', '--prod', '--offline', '--trust-lockfile', temporaryStage], true)
if (deploy.status !== 0) {
  const cached = compatibleCachedDeployment()
  const reason = deploy.error instanceof Error ? deploy.error.message : String(deploy.status ?? 'unknown')
  if (!cached) throw new Error(`PACKAGE_STAGE_NO_COMPATIBLE_OFFLINE_CACHE:${reason}`)
  console.warn(`Offline deploy store is incomplete; reusing a direct-dependency-version-compatible prior stage from ${cached}`)
  rmSync(temporaryStage, { recursive: true, force: true })
  mkdirSync(temporaryStage, { recursive: true })
  cpSync(resolve(cached, 'vendor/node_modules'), resolve(temporaryStage, 'node_modules'), { recursive: true, verbatimSymlinks: true })
}
rmSync(resolve(temporaryStage, 'dist'), { recursive: true, force: true })
cpSync(resolve(root, 'apps/server/dist'), resolve(temporaryStage, 'dist'), { recursive: true })
writeFileSync(resolve(temporaryStage, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8')

function electronCanLoadSqlite(directory) {
  const probe = spawnSync(require('electron'), ['-e', "const p=require.resolve('better-sqlite3',{paths:[process.cwd()]});const DB=require(p);const db=new DB(':memory:');db.exec('select 1');db.close()"], {
    cwd: directory,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  })
  return probe.status === 0
}

function hostNodeCanLoadSqlite() {
  const probe = spawnSync(process.execPath, ['-e', "const p=require.resolve('better-sqlite3',{paths:[process.cwd()]});const DB=require(p);const db=new DB(':memory:');db.exec('select 1');db.close()"], {
    cwd: resolve(root, 'apps/server'),
    encoding: 'utf8',
  })
  return probe.status === 0
}

if (!electronCanLoadSqlite(temporaryStage)) {
  // pnpm deploy can use hard links or copy-on-write clones from its content
  // store. Rebuilding such a file in place can poison the cached host-Node
  // ABI for later CI jobs. Replace the native package with an ordinary copy
  // before electron-rebuild is allowed to mutate it.
  const nativePackage = realpathSync(resolve(temporaryStage, 'node_modules/better-sqlite3'))
  const isolatedNativePackage = `${nativePackage}.electron-${Date.now()}`
  cpSync(nativePackage, isolatedNativePackage, { recursive: true, dereference: true })
  rmSync(nativePackage, { recursive: true, force: true })
  renameSync(isolatedNativePackage, nativePackage)
  runPnpm(['exec', 'electron-rebuild', '-f', '-m', temporaryStage, '-w', 'better-sqlite3', '-v', '40.10.6'])
}
if (!electronCanLoadSqlite(temporaryStage)) throw new Error('PACKAGE_STAGE_SQLITE_ELECTRON_ABI_INVALID')
if (!hostNodeCanLoadSqlite()) throw new Error('PACKAGE_STAGE_MUTATED_HOST_SQLITE_ABI')

for (const relative of [
  'src', 'test', 'tsconfig.json', '.director-data', '.env', 'logs', 'uploads', 'media', 'exports', 'runtime',
]) rmSync(resolve(temporaryStage, relative), { recursive: true, force: true })
mkdirSync(resolve(temporaryStage, 'vendor'), { recursive: true })
renameSync(resolve(temporaryStage, 'node_modules'), resolve(temporaryStage, 'vendor', 'node_modules'))
function scrub(directory, packageRoot) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = realpathSync(absolute)
      if (target !== packageRoot && !target.startsWith(`${packageRoot}/`)) throw new Error(`PACKAGE_STAGE_EXTERNAL_SYMLINK:${absolute}`)
      continue
    }
    if (entry.isDirectory()) {
      if (/^(?:test|tests|__tests__|coverage)$/iu.test(entry.name)) rmSync(absolute, { recursive: true, force: true })
      else scrub(absolute, packageRoot)
    } else if (entry.isFile() && (/(?:\.d)?\.(?:ts|tsx|map)$/iu.test(entry.name) || / \d+(?:\.[^.]+)?$/u.test(entry.name))) {
      rmSync(absolute, { force: true })
    } else if (!lstatSync(absolute).isFile()) {
      throw new Error(`PACKAGE_STAGE_UNSUPPORTED_ENTRY:${absolute}`)
    }
  }
}
scrub(temporaryStage, realpathSync(temporaryStage))

const forbiddenRuntimeName = /(?:^|\/)(?:\.director-data|logs?|uploads?|media|exports?|runtime)(?:\/|$)|\.(?:sqlite3?|db|log)(?:-|$|\.)/iu
function assertNoRuntimeData(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    const relative = absolute.slice(temporaryStage.length + 1)
    if (forbiddenRuntimeName.test(relative)) throw new Error(`PACKAGE_STAGE_RUNTIME_DATA:${relative}`)
    if (entry.isDirectory()) assertNoRuntimeData(absolute)
  }
}
assertNoRuntimeData(temporaryStage)
cpSync(temporaryStage, stage, { recursive: true, verbatimSymlinks: true })
rmSync(temporaryRoot, { recursive: true, force: true })

if (!existsSync(resolve(stage, 'dist/index.js'))) throw new Error('PACKAGE_STAGE_SERVER_MISSING')
if (!existsSync(resolve(stage, 'dist/prompt-pack/registry/prompts.json'))) throw new Error('PACKAGE_STAGE_PROMPT_PACK_MISSING')
console.log(`Package stage prepared: ${stage}`)
