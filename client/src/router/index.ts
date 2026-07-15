import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
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

const router = createRouter({ history: createWebHistory(), routes })

router.onError((cause, to) => {
  const message = cause instanceof Error ? cause.message : String(cause)
  const isChunkError = /Unable to preload|dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(message)
  if (!isChunkError) return
  const target = to?.fullPath || window.location.pathname
  const key = `chunk-reload:${target}`
  if (sessionStorage.getItem(key)) {
    sessionStorage.removeItem(key)
    return
  }
  sessionStorage.setItem(key, '1')
  setTimeout(() => window.location.assign(to?.fullPath || '/'), 800)
})

router.afterEach((to) => {
  try { sessionStorage.removeItem(`chunk-reload:${to.fullPath}`) } catch { /* storage may be unavailable */ }
})

export default router
