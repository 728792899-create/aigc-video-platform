import { ref } from 'vue'

// 主题状态：'light' | 'dark'，全局单例
const STORAGE_KEY = 'aigc-theme'
const theme = ref('light')

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function apply(t) {
  document.documentElement.setAttribute('data-theme', t)
}

// 初始化：优先读 localStorage，没有则跟随系统
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY)
  theme.value = saved || (systemPrefersDark() ? 'dark' : 'light')
  apply(theme.value)
  // 用户没手动设过时，跟随系统切换
  if (!saved && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        theme.value = e.matches ? 'dark' : 'light'
        apply(theme.value)
      }
    })
  }
}

export function useTheme() {
  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, theme.value)
    apply(theme.value)
  }
  return { theme, toggle }
}
