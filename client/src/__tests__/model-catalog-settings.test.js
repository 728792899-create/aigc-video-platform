import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const view = readFileSync(resolve(here, '..', 'views', 'Settings.vue'), 'utf8')
const api = readFileSync(resolve(here, '..', 'api', 'providers.ts'), 'utf8')

describe('模型能力目录设置界面', () => {
  it('从独立 catalog API 读取静态能力，并在四阶段显示能力摘要', () => {
    expect(api).toContain('`/providers/catalog${query}`')
    expect(api).toContain('ModelDescriptorSchema.array().parse')
    expect(view).toContain('getProviders(), getModelCatalog(), getStageModels()')
    for (const stage of ['script', 'image', 'video', 'voice']) {
      expect(view).toContain(`capabilitySummary('${stage}')`)
    }
  })

  it('明确提示当前图片适配器并未直接上传参考图', () => {
    const locale = readFileSync(resolve(here, '..', 'locales', 'modules', 'settings.ts'), 'utf8')
    expect(view).toContain("t('settings.capReferenceText')")
    expect(locale).toContain("capReferenceText: '参考图仅作文字锚点'")
    expect(locale).toContain("capReferenceText: 'Reference images use text anchors only'")
  })
})
