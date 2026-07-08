import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 顶级构建配置：vendor 分包 + 体积优化 + 本地代理
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: true },
      '/uploads': { target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: {
    // 生产不输出 sourcemap，减小体积、避免泄露源码
    sourcemap: false,
    // 触发分包告警的阈值上调（vendor 本身较大属正常）
    chunkSizeWarningLimit: 700,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // 把第三方库拆成独立、可长期缓存的 vendor chunk，
        // 业务代码变更时这些 chunk 的 hash 不变，浏览器命中缓存。
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@element-plus/icons-vue')) return 'icons'
          if (id.includes('element-plus')) return 'element-plus'
          if (id.includes('/vue/') || id.includes('vue-router') || id.includes('/@vue/') || id.includes('pinia')) return 'vue-core'
          if (id.includes('axios')) return 'net'
          // 其余第三方库（含 vuedraggable 等单页面依赖）返回 undefined，
          // 交给 Rollup 按引用关系自然归入对应的懒加载 chunk。
          return undefined
        },
      },
    },
  },
})
