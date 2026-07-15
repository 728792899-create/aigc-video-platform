import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('路由页面生命周期', () => {
  it('异步路由组件使用 fullPath key，避免 out-in 过渡保留旧页面', () => {
    const appSource = readFileSync(resolve(here, '..', 'App.vue'), 'utf8')
    expect(appSource).toContain('<component :is="Component" :key="route.fullPath" />')
    expect(appSource).not.toContain('<transition name="page-fade" mode="out-in">')
  })
})
