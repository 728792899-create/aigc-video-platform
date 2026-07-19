import { createRouter, createWebHistory } from 'vue-router'
import DirectorStudio from './views/DirectorStudio.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/studio/:projectId?', name: 'studio', component: DirectorStudio },
    { path: '/:pathMatch(.*)*', redirect: '/studio' },
  ],
})
