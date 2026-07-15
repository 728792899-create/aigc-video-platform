export const API_BASE = import.meta.env.VITE_API_BASE || ''
export const API_URL = `${API_BASE}/api`

export function mediaUrl(relativePath: string | null | undefined): string {
  if (!relativePath) return ''
  if (/^https?:\/\//.test(relativePath)) return relativePath
  return `${API_BASE}${relativePath.startsWith('/') ? '' : '/'}${relativePath}`
}
