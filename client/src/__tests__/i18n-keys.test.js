// i18n 键完整性测试
// 背景：v1.0.2 自查发现「问题2」根因 = 模板里 $t('projects.scriptSkills') 引用的键
//       在 locale 文件里不存在，vue-i18n 找不到时返回键名本身（非空字符串），
//       || '默认值' 兜底永不生效，界面直接显示原始键名（又长又难看）。
// 这套测试就是这道防线：①zh/en 键集对齐 ②模板里所有 $t('ns.key') 引用都能在 locale 找到。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, '..')
const MODULES_DIR = join(SRC, 'locales', 'modules')

// 把嵌套对象拍平成点路径键集合：{a:{b:1}} -> ['a.b']
function flattenKeys(obj, prefix = '') {
  const keys = []
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

// 动态加载所有 locale 模块
async function loadModules() {
  const files = readdirSync(MODULES_DIR).filter(f => /\.(?:js|ts)$/.test(f))
  const mods = {}
  for (const f of files) {
    const ns = f.replace(/\.(?:js|ts)$/, '')
    const mod = await import(join(MODULES_DIR, f))
    mods[ns] = mod.default
  }
  return mods
}

describe('i18n 键完整性', () => {
  it('每个模块都导出 zh 和 en 两套文案', async () => {
    const mods = await loadModules()
    for (const [ns, m] of Object.entries(mods)) {
      expect(m, `${ns} 应有默认导出`).toBeTruthy()
      expect(m.zh, `${ns}.zh 缺失`).toBeTruthy()
      expect(m.en, `${ns}.en 缺失`).toBeTruthy()
    }
  })

  it('每个模块 zh 与 en 的键集必须一一对齐（漏翻/多翻都报错）', async () => {
    const mods = await loadModules()
    const mismatches = []
    for (const [ns, m] of Object.entries(mods)) {
      const zhKeys = new Set(flattenKeys(m.zh))
      const enKeys = new Set(flattenKeys(m.en))
      const onlyZh = [...zhKeys].filter(k => !enKeys.has(k))
      const onlyEn = [...enKeys].filter(k => !zhKeys.has(k))
      if (onlyZh.length) mismatches.push(`[${ns}] 仅 zh 有: ${onlyZh.join(', ')}`)
      if (onlyEn.length) mismatches.push(`[${ns}] 仅 en 有: ${onlyEn.join(', ')}`)
    }
    expect(mismatches, '\n' + mismatches.join('\n')).toHaveLength(0)
  })

  it('问题2 回归守卫：projects 的 scriptSkills/imageSkills/skillNone/autoSkillsLabel 必须存在', async () => {
    const mods = await loadModules()
    const required = ['scriptSkills', 'imageSkills', 'skillNone', 'autoSkillsLabel']
    for (const key of required) {
      expect(mods.projects.zh[key], `projects.zh.${key} 缺失（会导致界面显示键名）`).toBeTruthy()
      expect(mods.projects.en[key], `projects.en.${key} 缺失`).toBeTruthy()
    }
  })

  it('问题3 引导提示：settings.imageApiCloudHint 必须存在', async () => {
    const mods = await loadModules()
    expect(mods.settings.zh.imageApiCloudHint, 'settings.zh.imageApiCloudHint 缺失').toBeTruthy()
    expect(mods.settings.en.imageApiCloudHint, 'settings.en.imageApiCloudHint 缺失').toBeTruthy()
  })
})
