// 独立的 vitest 配置，不复用 vite.config.js（项目用 rolldown 版 vite，
// 直接让 vitest 加载会有解析冲突）。测试是纯 Node 环境的 i18n 键校验，
// 不需要 vue 插件 / 浏览器环境。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.js'],
    globals: false,
  },
})
