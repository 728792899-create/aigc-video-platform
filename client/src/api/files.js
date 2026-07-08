/**
 * 文件管理器 API 客户端
 */
import api from './index'
import { API_URL } from './config'

// 列出某类文件。type: 'image' | 'audio' | 'video' | 'subtitle'
export function listFiles(type) {
  return api.get('/files', { params: { type } }).then((r) => r.data.data)
}

// 整理素材命名。dry_run=true 只预览，不改磁盘和数据库
export function normalizeNames({ types, dry_run = false } = {}) {
  return api.post('/files/normalize-names', { types, dry_run }).then((r) => r.data)
}

// 批量删除文件（物理 + DB 引用联动清理）。urls: string[]
export function deleteFiles(urls) {
  return api.delete('/files', { data: { urls } }).then((r) => r.data)
}

// 在资源管理器中定位文件（仅 Windows 本机）
export function revealFile(url) {
  return api.post('/files/reveal', { url }).then((r) => r.data)
}

// ===== 剧本（虚拟文件，存于 DB）=====

// 列出所有项目的剧本概览
export function listScripts() {
  return api.get('/files/scripts').then((r) => r.data.data)
}

// 取单项目剧本详情（含分镜）
export function getScript(projectId) {
  return api.get(`/files/scripts/${projectId}`).then((r) => r.data.data)
}

// 导出剧本下载地址。format: 'txt' | 'json'
export function scriptExportUrl(projectId, format = 'txt') {
  return `${API_URL}/files/scripts/${projectId}/export?format=${format}`
}
