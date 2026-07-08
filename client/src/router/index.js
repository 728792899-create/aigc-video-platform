import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'Dashboard', component: () => import('../views/Dashboard.vue') },
  { path: '/projects', name: 'Projects', component: () => import('../views/Projects.vue') },
  { path: '/projects/:id/script', name: 'Script', component: () => import('../views/Script.vue') },
  { path: '/projects/:id/images', name: 'Images', component: () => import('../views/Images.vue') },
  { path: '/projects/:id/preview', name: 'Preview', component: () => import('../views/Preview.vue') },
  { path: '/projects/:id/audio', name: 'Audio', component: () => import('../views/Audio.vue') },
  { path: '/settings', name: 'Settings', component: () => import('../views/Settings.vue') },
  { path: '/history', name: 'History', component: () => import('../views/History.vue') },
  { path: '/files', name: 'Files', component: () => import('../views/Files.vue') },
  { path: '/library', name: 'Library', component: () => import('../views/Library.vue') },
  { path: '/skills', name: 'Skills', component: () => import('../views/Skills.vue') },
  { path: '/trash', name: 'Trash', component: () => import('../views/Trash.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 懒加载兜底：后端在崩溃→自动重启的短暂窗口内，按需加载的页面 chunk/CSS 可能瞬时
// 拉取失败（Unable to preload / dynamically imported module / Loading chunk failed）。
// 这类错误会中断路由导航，表现为"点菜单卡住不动"。此处捕获后整页跳转到目标路径，
// 触发一次干净的重新加载（此时后端通常已重启就绪），且用 sessionStorage 标记只重试一次，
// 避免在后端彻底起不来时陷入无限刷新。
router.onError((error, to) => {
  const msg = String(error && error.message || error)
  const isChunkError = /Unable to preload|dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(msg)
  if (!isChunkError) return
  const key = 'chunk-reload:' + (to && to.fullPath || location.pathname)
  if (sessionStorage.getItem(key)) {
    // 已经重试过一次仍失败：清掉标记，不再死循环刷新（后端可能真挂了）
    sessionStorage.removeItem(key)
    return
  }
  sessionStorage.setItem(key, '1')
  const target = (to && to.fullPath) || '/'
  // 延迟 800ms 给后端重启留出就绪时间，再整页跳转重新拉取 chunk
  setTimeout(() => { window.location.assign(target) }, 800)
})

// 导航成功后清除该路径的重试标记，下次再失败仍可重试一次
router.afterEach((to) => {
  try { sessionStorage.removeItem('chunk-reload:' + to.fullPath) } catch (_) {}
})

export default router
