import { ref } from 'vue'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'aigc-theme'
const theme = ref<Theme>('light')

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark'
}

function apply(value: Theme): void {
  document.documentElement.setAttribute('data-theme', value)
}

export function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY)
  const systemTheme: Theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  theme.value = isTheme(saved) ? saved : systemTheme
  apply(theme.value)
  if (!saved && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        theme.value = event.matches ? 'dark' : 'light'
        apply(theme.value)
      }
    })
  }
}

export function useTheme() {
  const toggle = () => {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, theme.value)
    apply(theme.value)
  }
  return { theme, toggle }
}
