import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const sourceRoots = ['packages/contracts/src', 'client/src', 'server', 'electron']
// Acceptance measures first-party runtime code. Tests and one-off runners are
// validated by their own gates, but do not inflate or dilute runtime coverage.
const ignoredDirectories = new Set(['node_modules', 'dist', 'uploads', 'logs', 'test', '__tests__', 'scripts'])
const ignoredFiles = new Set(['electron-builder.yml'])
const minimum = Number(process.env.TYPE_COVERAGE_MIN || 95)

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolute, files)
    else files.push(absolute)
  }
  return files
}

function sourceKind(file, content) {
  if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'typed'
  if (file.endsWith('.vue')) return /<script\b[^>]*\blang=["']ts["']/i.test(content) ? 'typed' : 'untyped'
  if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.cjs')) return 'untyped'
  // .mjs is the explicit compatibility allowance for build and acceptance runners.
  return 'ignored'
}

const totals = { typed: 0, untyped: 0 }
const untypedFiles = []
for (const relativeRoot of sourceRoots) {
  const absoluteRoot = path.join(root, relativeRoot)
  if (!fs.existsSync(absoluteRoot)) continue
  for (const file of walk(absoluteRoot)) {
    if (ignoredFiles.has(path.basename(file))) continue
    const content = fs.readFileSync(file, 'utf8')
    const kind = sourceKind(file, content)
    if (kind === 'ignored') continue
    const lines = content.split(/\r?\n/).filter((line) => line.trim()).length
    totals[kind] += lines
    if (kind === 'untyped') untypedFiles.push({ file: path.relative(root, file), lines })
  }
}

const measured = totals.typed + totals.untyped
const coverage = measured === 0 ? 100 : (totals.typed / measured) * 100
console.log(`[type-coverage] typed=${totals.typed} untyped=${totals.untyped} coverage=${coverage.toFixed(2)}% target=${minimum}%`)
for (const entry of untypedFiles.sort((a, b) => b.lines - a.lines).slice(0, 20)) {
  console.log(`  - ${entry.file}: ${entry.lines} lines`)
}
if (coverage + Number.EPSILON < minimum) {
  console.error(`[type-coverage] FAIL: ${coverage.toFixed(2)}% < ${minimum}%`)
  process.exit(1)
}
