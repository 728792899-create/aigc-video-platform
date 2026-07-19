import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const stage = join(root, '.package-stage/server')
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const main = readFileSync(join(root, 'apps/desktop/src/main.ts'), 'utf8')
const preload = readFileSync(join(root, 'apps/desktop/src/preload.ts'), 'utf8')
const html = readFileSync(join(root, 'apps/studio/index.html'), 'utf8')
const failures = []
const passed = []
const check = (condition, label) => (condition ? passed : failures).push(label)

function walk(directory, result = []) {
  if (!existsSync(directory)) return result
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isSymbolicLink()) result.push({ absolute, type: 'symlink', target: realpathSync(absolute) })
    else if (entry.isDirectory()) walk(absolute, result)
    else result.push({ absolute, type: 'file' })
  }
  return result
}

function isPathContained(parent, candidate) {
  const candidateRelative = relative(parent, candidate)
  return candidateRelative === '' || (!candidateRelative.startsWith('..') && !isAbsolute(candidateRelative))
}

function normalizedPath(path) {
  return path.replaceAll('\\', '/')
}

check(pkg.version === '2.0.0' && pkg.build?.appId === 'com.aigc.director.studio', '产品身份为 AIGC 导演工作室 2.0')
check(pkg.build?.asar === true, 'Electron 主应用使用 ASAR')
check(pkg.build?.npmRebuild === false, '主 ASAR 不重复重建隔离 Server 的原生依赖')
check(pkg.build?.afterPack === 'scripts/after-pack.mjs', '打包后移除 Electron 示例资源')
check(JSON.stringify(pkg.build?.files ?? []).includes('node_modules') === false, '主 ASAR 不收集整个开发依赖树')
check((pkg.build?.extraResources ?? []).some((item) => item.from === '.package-stage/server'), '后端使用隔离生产部署目录')
check(/contextIsolation:\s*true/u.test(main), 'contextIsolation=true')
check(/nodeIntegration:\s*false/u.test(main), 'nodeIntegration=false')
check(/sandbox:\s*true/u.test(main), 'renderer sandbox=true')
check(/127\.0\.0\.1/u.test(main) && /randomBytes\(32\)/u.test(main), 'Server 仅绑定本机并使用随机会话令牌')
check(/setWindowOpenHandler/u.test(main) && /https:\/\//u.test(main), '外部链接使用 HTTPS 白名单')
check(!/ipcRenderer\.invoke\([^'"`]/u.test(preload), 'preload IPC 通道为静态白名单')
check(/Content-Security-Policy/u.test(html) && /script-src 'self'/u.test(html), 'Studio 提供严格 CSP')
check(pkg.build?.mac?.extendInfo?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false, 'macOS ATS 禁止任意网络加载')
check(existsSync(join(root, 'apps/desktop/dist/main.cjs')) && existsSync(join(root, 'apps/desktop/dist/preload.cjs')), 'Electron 编译产物存在')
check(existsSync(join(root, 'apps/studio/dist/index.html')), 'Studio 生产构建存在')
check(existsSync(join(stage, 'dist/index.js')), 'Server 生产部署目录存在')
check(existsSync(join(stage, 'dist/prompt-pack/registry/prompts.json')), 'Server 生产部署目录包含固定版本 Prompt Registry')

const stagedFiles = walk(stage)
const forbiddenStageFiles = stagedFiles.filter(({ absolute, type, target }) => {
  const normalizedAbsolute = normalizedPath(absolute)
  return (type === 'symlink' && (!target || !isPathContained(stage, target)))
    || /(?:\.d)?\.(?:ts|tsx|map)$/iu.test(normalizedAbsolute)
    || /(^|\/)(?:uploads|logs)(\/|$)/u.test(normalizedAbsolute)
    || /\.(?:sqlite|db|log|pem|pfx|key)$/iu.test(normalizedAbsolute)
})
check(forbiddenStageFiles.length === 0, `生产后端不含源码、sourcemap、外部链接或运行数据（${forbiddenStageFiles.slice(0, 3).map(({ absolute }) => relative(root, absolute)).join(', ') || 'clean'}）`)
const bundledFfmpeg = stagedFiles.filter(({ absolute }) => /(^|\/)(?:ffmpeg|ffprobe)(?:\.exe)?$/iu.test(normalizedPath(absolute)))
check(bundledFfmpeg.length === 0, '发行资源不携带 FFmpeg 二进制')
const nativeSqlite = stagedFiles.find(({ absolute }) => extname(absolute) === '.node' && absolute.includes('better-sqlite3'))
check(Boolean(nativeSqlite), 'better-sqlite3 Electron 原生模块已隔离装入')

if (existsSync(stage)) {
  const electronBinary = require('electron')
  const probe = spawnSync(electronBinary, ['-e', "const p=require.resolve('better-sqlite3',{paths:[process.cwd()]});const DB=require(p);const db=new DB(':memory:');db.exec('select 1');db.close()"], {
    cwd: join(stage, 'vendor'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  })
  check(probe.status === 0, `Electron Node 可加载隔离的 better-sqlite3（${probe.status === 0 ? 'ok' : String(probe.stderr || probe.error || 'unknown').trim().slice(0, 160)}）`)

  const startupProbeRoot = mkdtempSync(join(tmpdir(), 'aigc-director-startup-probe-'))
  const startupProbe = spawnSync(electronBinary, [join(stage, 'dist/index.js')], {
    cwd: stage,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      AIGC_DIRECTOR_STARTUP_PROBE: '1',
      AIGC_DIRECTOR_DATA_DIR: startupProbeRoot,
      AIGC_DIRECTOR_VENDOR_DIR: join(stage, 'vendor'),
      AIGC_DIRECTOR_SESSION_TOKEN: 'preflight-test-token',
      DEMO_MODE: '1',
      PROVIDER_NETWORK_DISABLED: '1',
    },
    encoding: 'utf8',
    timeout: 20_000,
  })
  check(startupProbe.status === 0 && String(startupProbe.stdout).includes('DIRECTOR_SERVER_PROBE_OK'), `Electron Node 可完成 Server/DB/Prompt Pack 启动恢复（${startupProbe.status === 0 ? 'ok' : String(startupProbe.stderr || startupProbe.error || 'unknown').trim().slice(0, 160)}）`)
  rmSync(startupProbeRoot, { recursive: true, force: true })
}

for (const name of ['icon.svg', 'icon.png', 'icon.icns', 'icon.ico', 'entitlements.mac.plist', 'entitlements.adhoc.plist']) {
  check(existsSync(join(root, 'resources', name)) && statSync(join(root, 'resources', name)).size > 100, `发布资源存在：${name}`)
}

for (const label of passed) console.log(`✓ ${label}`)
for (const label of failures) console.error(`✗ ${label}`)
if (failures.length > 0) process.exitCode = 1
