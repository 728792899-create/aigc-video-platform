// 统一的后端地址配置
// 默认使用【相对路径】（空字符串）= 同源请求：
//   - 桌面应用：后端经 CLIENT_DIST 托管前端，前后端同源，/api 自动打到窗口所在端口
//     （后端端口可能被 findFreePort 顺延到 3001 等，相对路径永远跟随，不会连错端口）
//   - 开发模式：vite dev(5173) 的 proxy 把 /api、/uploads 转发到 3000
// 仅当显式配置 VITE_API_BASE（远程分离部署）时才用绝对地址。
export const API_BASE = import.meta.env.VITE_API_BASE || ''

// API 根路径（带 /api 前缀）
export const API_URL = `${API_BASE}/api`

// 把后端返回的相对资源 URL（如 /uploads/images/x.png）拼成完整可访问地址
export function mediaUrl(relPath) {
  if (!relPath) return ''
  // 已是完整 URL 直接返回
  if (/^https?:\/\//.test(relPath)) return relPath
  return `${API_BASE}${relPath.startsWith('/') ? '' : '/'}${relPath}`
}
