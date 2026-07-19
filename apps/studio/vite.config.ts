import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:33100', changeOrigin: false },
      '/studio-v2/socket.io': { target: 'ws://127.0.0.1:33100', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 220,
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-flow': ['@vue-flow/core', '@vue-flow/background', '@vue-flow/controls', '@vue-flow/minimap'],
          'reka-ui': ['reka-ui'],
        },
      },
    },
  },
  test: { environment: 'happy-dom' },
})
