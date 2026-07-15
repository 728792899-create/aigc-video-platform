import { describe, expect, it } from 'vitest'
import i18n from '../locales'

describe('CSP-safe i18n runtime messages', () => {
  it('renders static and named messages without the runtime compiler', () => {
    expect(i18n.global.t('common.yes')).toBe('是')
    expect(i18n.global.t('dashboard.createFailed', { msg: 'offline' })).toBe('创建项目失败：offline')
    expect(i18n.global.t('preview.resolutionHint', { w: 1920, h: 1080 })).toBe('实际输出 1920×1080 像素')
  })
})
