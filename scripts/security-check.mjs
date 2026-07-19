import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const scanRoots = ['apps', 'packages', 'scripts', 'resources']
const textExtensions = new Set(['.ts', '.vue', '.css', '.html', '.json', '.mjs', '.js', '.md', '.yaml', '.yml', '.plist', '.svg'])
const forbiddenFile = /\.(?:sqlite|sqlite3|db|log|pem|pfx|key|dmg|pkg|exe|msi)$/iu
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['OpenAI-style key', /\bsk-(?!test|fake|demo)[A-Za-z0-9_-]{20,}\b/u],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/u],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/u],
  ['credential URL', /https?:\/\/[^\s/:]+:[^\s/@]+@/iu],
  ['hard-coded user path', /\/(?:Users|home)\/[^/\s"']+/u],
]

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || ['node_modules', 'dist', '.package-stage', '.desktop-stage', 'coverage'].includes(entry.name) || / \d+(?:\.[^/]*)?$/u.test(entry.name)) return []
    const absolute = join(directory, entry.name)
    return entry.isDirectory() ? walk(absolute) : [absolute]
  })
}

const files = scanRoots.flatMap((directory) => walk(join(root, directory)))
const findings = []
for (const absolute of files) {
  const name = relative(root, absolute).split('\\').join('/')
  if (forbiddenFile.test(name) || /(^|\/)(?:uploads|logs|exports|runtime)(\/|$)|(^|\/)data\/media(\/|$)/u.test(name)) findings.push(`禁止的运行时/凭据文件: ${name}`)
  if (!textExtensions.has(extname(name))) continue
  let content
  try { content = readFileSync(absolute, 'utf8') } catch { continue }
  for (const [label, pattern] of secretPatterns) {
    if (label === 'credential URL' && /(^|\/)test(s)?\//u.test(name)) continue
    if (pattern.test(content)) findings.push(`${label}: ${name}`)
  }
}

const stagedPackage = join(root, '.package-stage/server/package.json')
const builtFiles = [
  ...walk(join(root, 'apps/studio/dist')),
  ...walk(join(root, 'apps/desktop/dist')),
  ...walk(join(root, 'apps/server/dist')),
  ...walk(join(root, '.package-stage/server/dist')),
  ...(existsSync(stagedPackage) ? [stagedPackage] : []),
]
for (const absolute of builtFiles) {
  const builtName = relative(root, absolute).split('\\').join('/')
  if (/(?:^|\/)[^/]+ \d+(?:\.[^/]*)?$/u.test(builtName)) findings.push(`构建产物含用户副本: ${builtName}`)
  if (!['.js', '.cjs', '.html', '.css', '.json'].includes(extname(absolute))) continue
  const content = readFileSync(absolute, 'utf8')
  if (/OPENAI_API_KEY|KLING_API_KEY|DEEPSEEK_API_KEY|BEGIN PRIVATE KEY/u.test(content)) findings.push(`构建产物含敏感标识: ${relative(root, absolute)}`)
  if (/director-local-dev-session-token/u.test(content)) findings.push(`构建产物含固定开发会话: ${relative(root, absolute)}`)
  if (/\/(?:Users|home)\/[^/\s"']+/u.test(content)) findings.push(`构建产物含本机路径: ${relative(root, absolute)}`)
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`✗ ${finding}`)
  process.exitCode = 1
} else {
  console.log(`Security scan passed: ${files.length} source files and ${builtFiles.length} build files`)
}
