// 模板 $t() 引用键存在性测试 —— 问题2 的核心防线
// 扫描所有 .vue / .js 里的 $t('ns.key') 与 t('ns.key') 调用，
// 验证每个被引用的键都能在 locale（zh）里找到。
// 若有人又像问题2 那样引用了不存在的键，这里会直接红，CI/本地一眼可见。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, '..')
const MODULES_DIR = join(SRC, 'locales', 'modules')

function flattenKeys(obj, prefix = '') {
  const keys = []
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) keys.push(...flattenKeys(v, path))
    else keys.push(path)
  }
  return keys
}

async function loadAllZhKeys() {
  const files = readdirSync(MODULES_DIR).filter(f => /\.(?:js|ts)$/.test(f))
  const all = new Set()
  for (const f of files) {
    const ns = f.replace(/\.(?:js|ts)$/, '')
    const mod = await import(join(MODULES_DIR, f))
    for (const k of flattenKeys(mod.default.zh)) all.add(`${ns}.${k}`)
  }
  return all
}

// 递归收集源文件
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('_backup')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, exts, out)
    else if (exts.some(e => name.endsWith(e))) out.push(p)
  }
  return out
}

// 抓 $t('ns.key') / t('ns.key') / $t("ns.key")，只取静态字符串字面量（含点的命名空间键）
function extractKeys(content) {
  const keys = new Set()
  // 匹配 $t( 或 t( 后紧跟引号字符串，键形如 ns.subkey（至少一个点，纯静态）
  const re = /[\$\s.(]t\(\s*(['"`])([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\1/g
  let m
  while ((m = re.exec(content)) !== null) keys.add(m[2])
  return keys
}

describe('模板 $t() 引用键存在性（问题2 防线）', () => {
  it('所有 .vue/.js 里静态 $t(\'ns.key\') 引用的键都必须在 locale 中存在', async () => {
    const zhKeys = await loadAllZhKeys()
    const files = walk(SRC, ['.vue', '.js', '.ts']).filter(f => !f.includes('locales'))
    const missing = []
    for (const f of files) {
      const content = readFileSync(f, 'utf-8')
      for (const key of extractKeys(content)) {
        if (!zhKeys.has(key)) {
          missing.push(`${key}  ←  ${f.replace(SRC, 'src')}`)
        }
      }
    }
    // 去重
    const uniq = [...new Set(missing)]
    expect(uniq, '\n以下 $t() 键在 locale 里不存在（会导致界面显示原始键名）:\n' + uniq.join('\n') + '\n').toHaveLength(0)
  })
})
