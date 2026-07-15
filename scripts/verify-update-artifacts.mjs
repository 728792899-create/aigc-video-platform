import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputDir = path.resolve(process.argv[2] || path.join(root, 'dist-electron'))
const platform = process.argv[3] || process.platform
const manifestName = platform === 'darwin' || platform === 'mac' ? 'latest-mac.yml' : 'latest.yml'
const manifestPath = path.join(outputDir, manifestName)
if (!fs.existsSync(manifestPath)) throw new Error(`缺少自动更新清单：${manifestPath}`)

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const content = fs.readFileSync(manifestPath, 'utf8')
const version = content.match(/^version:\s*['"]?([^'"\s]+)['"]?/m)?.[1]
if (version !== pkg.version) throw new Error(`${manifestName} 版本 ${version || '(missing)'} 与 package ${pkg.version} 不一致`)
if (!/^sha512:\s*[A-Za-z0-9+/=]{40,}\s*$/m.test(content)) throw new Error(`${manifestName} 缺少有效 sha512`)

const artifactNames = new Set()
for (const match of content.matchAll(/^\s*(?:path|url):\s*['"]?([^'"\r\n]+?)['"]?\s*$/gm)) {
  const name = path.basename(match[1].trim())
  if (/\.(?:dmg|zip|exe)$/i.test(name)) artifactNames.add(name)
}
if (!artifactNames.size) throw new Error(`${manifestName} 未引用任何安装或更新包`)
for (const name of artifactNames) {
  if (!fs.existsSync(path.join(outputDir, name))) throw new Error(`${manifestName} 引用的文件不存在：${name}`)
}
const blockmaps = fs.readdirSync(outputDir).filter((name) => name.endsWith('.blockmap'))
if (!blockmaps.length) throw new Error(`${outputDir} 缺少差分更新 blockmap`)
for (const name of blockmaps) {
  if (!fs.existsSync(path.join(outputDir, name.slice(0, -'.blockmap'.length)))) {
    throw new Error(`blockmap 没有对应发布文件：${name}`)
  }
}

const [major, minor, patch] = String(pkg.version).split('.').map(Number)
if (![major, minor, patch].every(Number.isInteger)) throw new Error(`package version 不是三段语义版本：${pkg.version}`)
const previousVersion = process.env.AIGC_PREVIOUS_VERSION || `${major}.${minor}.${Math.max(0, patch - 1)}`
const previous = previousVersion.split('.').map(Number)
if (previous.length !== 3 || !previous.every(Number.isInteger)) throw new Error(`前一版本格式无效：${previousVersion}`)
const currentValue = major * 1_000_000 + minor * 1_000 + patch
const previousValue = previous[0] * 1_000_000 + previous[1] * 1_000 + previous[2]
if (previousValue >= currentValue) {
  throw new Error(`自动更新测试版本必须递增：${previousVersion} -> ${pkg.version}`)
}

console.log(`[update-artifacts] ${previousVersion} -> ${pkg.version}; ${manifestName}; ${artifactNames.size} artifact(s); ${blockmaps.length} blockmap(s)`)
