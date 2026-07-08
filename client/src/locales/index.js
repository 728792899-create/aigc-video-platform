// ============================================================
//  i18n 入口：vue-i18n 实例 + 语言持久化 + Element Plus 语言包联动
//  架构：每个页面/模块在 ./modules/ 下独立维护 { zh, en }，此处聚合
// ============================================================
import { createI18n } from 'vue-i18n'
import common from './modules/common'
import nav from './modules/nav'
import dashboard from './modules/dashboard'
import settings from './modules/settings'
import projects from './modules/projects'
import script from './modules/script'
import images from './modules/images'
import preview from './modules/preview'
import audio from './modules/audio'
import history from './modules/history'
import files from './modules/files'
import library from './modules/library'
import trash from './modules/trash'
import task from './modules/task'
import skills from './modules/skills'

// 把各模块按命名空间聚合成 { zh: {ns: {...}}, en: {ns: {...}} }
const modules = {
  common, nav, dashboard, settings, projects, script, images,
  preview, audio, history, files, library, trash, task, skills,
}
function build(lang) {
  const out = {}
  for (const [ns, m] of Object.entries(modules)) out[ns] = m[lang] || {}
  return out
}

const STORAGE_KEY = 'snoopy-locale'

export function getSavedLocale() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'zh' || v === 'en') return v
  } catch (_) {}
  return 'zh'
}

export function persistLocale(locale) {
  try { localStorage.setItem(STORAGE_KEY, locale) } catch (_) {}
  try {
    if (window.snoopy && typeof window.snoopy.setLocale === 'function') {
      window.snoopy.setLocale(locale)
    }
  } catch (_) {}
  try { document.documentElement.setAttribute('lang', locale === 'en' ? 'en' : 'zh-CN') } catch (_) {}
}

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: getSavedLocale(),
  fallbackLocale: 'zh',
  messages: { zh: build('zh'), en: build('en') },
})

export default i18n
