import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'

const elementPlusParent = {
  ElAside: 'container',
  ElAvatarGroup: 'avatar',
  ElBreadcrumbItem: 'breadcrumb',
  ElButtonGroup: 'button',
  ElCarouselItem: 'carousel',
  ElCheckboxButton: 'checkbox',
  ElCheckboxGroup: 'checkbox',
  ElCollapseItem: 'collapse',
  ElDescriptionsItem: 'descriptions',
  ElDropdownItem: 'dropdown',
  ElDropdownMenu: 'dropdown',
  ElFooter: 'container',
  ElFormItem: 'form',
  ElHeader: 'container',
  ElMain: 'container',
  ElMenuItem: 'menu',
  ElMenuItemGroup: 'menu',
  ElOption: 'select',
  ElOptionGroup: 'select',
  ElRadioButton: 'radio',
  ElRadioGroup: 'radio',
  ElSkeletonItem: 'skeleton',
  ElSplitterPanel: 'splitter',
  ElStep: 'steps',
  ElSubMenu: 'menu',
  ElTableColumn: 'table',
  ElTabPane: 'tabs',
  ElTimelineItem: 'timeline',
  ElTourStep: 'tour',
}

function kebabCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

// unplugin-vue-components 的官方 Element Plus resolver 会从 `element-plus/es`
// 根 barrel 导入。这里直达组件入口，避免一个页面把整个组件库拉入首屏。
const directElementPlusResolver = {
  type: 'component',
  resolve(name) {
    if (!/^El[A-Z]/.test(name)) return undefined
    const styleName = kebabCase(name.slice(2))
    const componentName = elementPlusParent[name] || styleName
    return {
      name,
      from: `element-plus/es/components/${componentName}/index`,
      sideEffects: [
        'element-plus/es/components/base/style/css',
        `element-plus/es/components/${styleName}/style/css`,
      ],
    }
  },
}

const directElementPlusDirectiveResolver = {
  type: 'directive',
  resolve(name) {
    if (name !== 'Loading') return undefined
    return {
      name: 'ElLoadingDirective',
      from: 'element-plus/es/components/loading/index',
      sideEffects: [
        'element-plus/es/components/base/style/css',
        'element-plus/es/components/loading/style/css',
      ],
    }
  },
}

function bundleReportPlugin() {
  return {
    name: 'aigc-element-plus-budget',
    generateBundle(_options, bundle) {
      const baselineBytes = 1_026_198
      const maxBytes = Math.floor(baselineBytes * 0.6)
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.name.startsWith('element-plus-')) continue
        const bytes = Buffer.byteLength(output.code)
        if (bytes > maxBytes) {
          this.error(`Element Plus chunk ${output.fileName} is ${bytes} bytes; budget is ${maxBytes} bytes`)
        }
        if (process.env.AIGC_BUNDLE_REPORT !== '1') continue
        const modules = Object.keys(output.modules)
          .filter((id) => id.includes('node_modules/element-plus'))
          .map((id) => id.replace(/^.*node_modules\/element-plus\/es\//, ''))
          .sort()
        console.log(`[bundle-report] ${output.name}:\n${modules.join('\n')}`)
      }
    },
  }
}

// 顶级构建配置：vendor 分包 + 体积优化 + 本地代理
export default defineConfig({
  plugins: [
    vue(),
    Components({ resolvers: [directElementPlusResolver, directElementPlusDirectiveResolver], dts: false }),
    bundleReportPlugin(),
  ],
  resolve: {
    alias: {
      // 语言表已在 locales/index.js 转为 MessageFunction，打包时不带 eval 编译器。
      'vue-i18n': 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js',
    },
  },
  define: {
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_DROP_MESSAGE_COMPILER__: true,
  },
  optimizeDeps: {
    // Vite 7 + the icon package's generated barrel can be split ahead of the
    // Vue shared initializer during dev pre-bundling. Serve this ESM package
    // directly; production still emits the dedicated icons chunk below.
    exclude: ['@element-plus/icons-vue'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: true, ws: true },
      '/uploads': { target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: {
    // 生产不输出 sourcemap，减小体积、避免泄露源码
    sourcemap: false,
    // 真实体积门禁；不用提高阈值掩盖全量 UI vendor。
    chunkSizeWarningLimit: 500,
    cssCodeSplit: true,
    // 路由 dynamic import + Element Plus Resolver 让 Rollup 按页面创建共享 chunk。
    // UI 组件按交互职责分组；首屏只加载 Shell/TaskDock 必需的 core。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@element-plus/icons-vue')) return 'icons'
          if (id.includes('node_modules/element-plus')) {
            const component = id.match(/element-plus\/es\/components\/([^/]+)/)?.[1]
            const shellClosure = new Set([
              'badge', 'button', 'collapse-transition', 'config-provider', 'container', 'focus-trap',
              'form', 'icon', 'input', 'menu', 'message', 'message-box', 'overlay', 'popper',
              'progress', 'slot', 'tooltip',
            ])
            return !component || shellClosure.has(component) ? 'element-plus-shell' : 'element-plus-workbench'
          }
          if (id.includes('axios')) return 'net'
          return undefined
        },
      },
    },
  },
})
