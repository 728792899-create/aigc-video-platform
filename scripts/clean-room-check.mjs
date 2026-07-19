import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtimeRoots = ['apps/studio/src', 'apps/server/src', 'apps/desktop/src', 'packages/contracts/src', 'packages/domain/src', 'packages/agents/src', 'packages/providers/src', 'packages/media/src']
const publicDocs = ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/README.md', 'docs/architecture-v2.md', 'docs/api-v2.md', 'docs/data-model-v2.md', 'docs/demo-v2.md', 'docs/security-v2.md', 'docs/testing-ci-v2.md', 'docs/desktop-release-v2.md', 'docs/release-checklist-v2.md']
const textExtensions = new Set(['.ts', '.vue', '.css', '.html', '.json', '.md'])
const rules = [
  ['参考产品品牌', /\btoon\s*flow\b/iu],
  ['参考组织名称', /\bhbai(?:-ltd)?\b/iu],
  ['参考仓库路径', /Toonflow-app|github\.com\/HBAI-Ltd/iu],
  ['参考角色字面量', /\b(?:ScriptAgent|ProductionAgent)\b/u],
  ['固定参考提交', /bc61ec7a1b5df31293b286981a5f4ad4635464ee/iu],
]
const legacyRules = [/史努比大王/u, /snoopy-king/iu, /AIGC 视频工作台/u]

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || ['dist', 'node_modules'].includes(entry.name)) return []
    const absolute = join(directory, entry.name)
    return entry.isDirectory() ? walk(absolute) : [absolute]
  })
}

const files = runtimeRoots.flatMap((directory) => walk(join(root, directory))).filter((file) => textExtensions.has(extname(file)))
files.push(...publicDocs.map((file) => join(root, file)).filter(existsSync))
const findings = []
for (const absolute of files) {
  const name = relative(root, absolute).split('\\').join('/')
  const content = readFileSync(absolute, 'utf8')
  for (const [label, pattern] of rules) if (pattern.test(content)) findings.push(`${label}: ${name}`)
  if (!['apps/desktop/src/legacyPurge.ts'].includes(name)) {
    for (const pattern of legacyRules) if (pattern.test(content)) findings.push(`旧产品字面量: ${name}`)
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`✗ ${finding}`)
  process.exitCode = 1
} else {
  console.log(`Clean-room scan passed: ${files.length} runtime/public files; legal provenance is isolated`)
}
