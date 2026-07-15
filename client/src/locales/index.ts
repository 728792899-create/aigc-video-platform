import { createI18n, type MessageContext, type MessageFunction } from 'vue-i18n'

import audio from './modules/audio'
import assets from './modules/assets'
import common from './modules/common'
import dashboard from './modules/dashboard'
import files from './modules/files'
import history from './modules/history'
import images from './modules/images'
import library from './modules/library'
import nav from './modules/nav'
import preview from './modules/preview'
import projects from './modules/projects'
import script from './modules/script'
import settings from './modules/settings'
import skills from './modules/skills'
import studio from './modules/studio'
import task from './modules/task'
import trash from './modules/trash'

export type SupportedLocale = 'zh' | 'en'
type CompiledMessage = string | MessageFunction | CompiledMessage[] | CompiledMessageTree
type CompiledMessageTree = { [key: string]: CompiledMessage }
type SourceMessageTree = { [key: string]: unknown }
type LocaleModule = Partial<Record<SupportedLocale, SourceMessageTree>>

const modules: Record<string, LocaleModule> = {
  common,
  nav,
  dashboard,
  settings,
  projects,
  script,
  images,
  preview,
  audio,
  assets,
  history,
  files,
  library,
  trash,
  task,
  skills,
  studio,
}

function build(lang: SupportedLocale): CompiledMessageTree {
  const output: CompiledMessageTree = {}
  for (const [namespace, localeModule] of Object.entries(modules)) {
    output[namespace] = compileMessageTree(localeModule[lang] ?? {})
  }
  return output
}

// 桌面端 CSP 不允许 unsafe-eval，因此在初始化时将受信的本地语言表编译为简单插值函数。
function compileMessageText(source: string): MessageFunction<string> {
  const parts: Array<string | { named: string }> = []
  const pattern = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    if (match.index > cursor) parts.push(source.slice(cursor, match.index))
    const named = match[1]
    if (named) parts.push({ named })
    cursor = match.index + match[0].length
  }
  if (cursor < source.length) parts.push(source.slice(cursor))
  return (context: MessageContext<string>) => parts.map((part) => (
    typeof part === 'string' ? part : String(context.named(part.named) ?? '')
  )).join('')
}

function compileMessageTree(value: unknown): CompiledMessage {
  if (typeof value === 'string') return compileMessageText(value)
  if (Array.isArray(value)) return value.map(compileMessageTree)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value ?? '')
  if (!value || typeof value !== 'object') return String(value ?? '')
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compileMessageTree(child)]))
}

const STORAGE_KEY = 'aigc-video-studio-locale'

export function getSavedLocale(): SupportedLocale {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'zh' || value === 'en') return value
  } catch {
    // 隐私模式或受限 WebView 可能禁用 localStorage，保持中文默认值。
  }
  return 'zh'
}

export function persistLocale(locale: SupportedLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // 本地持久化不可用时仍继续更新当前界面。
  }
  window.aigcStudio?.setLocale(locale)
  document.documentElement.setAttribute('lang', locale === 'en' ? 'en' : 'zh-CN')
}

const options = {
  legacy: false,
  globalInjection: true,
  locale: getSavedLocale(),
  fallbackLocale: 'zh',
  messages: { zh: build('zh'), en: build('en') },
} as const

const i18n = createI18n<false, typeof options>(options)

export default i18n
