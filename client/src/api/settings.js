/**
 * 系统设置 API 客户端
 */
import api from './index'

// 取全部配置（密钥已脱敏）
export function getSettings() {
  return api.get('/settings').then((r) => r.data.data)
}

// API 预设档
export function getPresets() {
  return api.get('/settings/presets').then((r) => r.data.data)
}

// 批量保存配置（patch 语义）。脱敏占位密钥会被后端忽略，不会覆盖真实值
export function saveSettings(patch) {
  return api.post('/settings', patch).then((r) => r.data)
}

export function saveDefaults(patch) {
  return api.put('/settings/defaults', patch).then((r) => r.data)
}

export function clearProviderKey(provider) {
  return api.post('/settings/keys/clear', { provider }).then((r) => r.data)
}

// 测试 API 连通性。type: 'deepseek' | 'pollinations'
// deepseek 可附带临时 apiKey/baseUrl/model（未保存也能测）
export function testApi(payload) {
  return api.post('/settings/test-api', payload).then((r) => r.data.data)
}

// 校验存储目录可用性
export function checkDir(dir, create = false) {
  return api.post('/settings/check-dir', { dir, create }).then((r) => r.data.data)
}

// 打开本机目录选择器（由本地后端弹出系统目录选择框）
export function pickDir() {
  return api.post('/settings/pick-dir').then((r) => r.data.data)
}

// 存储空间统计
export function getStorageStats() {
  return api.get('/settings/storage-stats').then((r) => r.data.data)
}

// 清理临时文件
export function cleanTemp() {
  return api.post('/settings/clean-temp').then((r) => r.data)
}

// ===== F8 配置导入导出 / 备份还原 =====

// 导出配置（mask=true 时密钥脱敏）
export function exportConfig(mask = false) {
  return api.get('/settings/export-config', { params: { mask } }).then((r) => r.data.data)
}

// 导入配置
export function importConfig(config) {
  return api.post('/settings/import-config', { config }).then((r) => r.data)
}

// 整体备份（返回信封对象，前端存为文件）
export function getBackup() {
  return api.get('/settings/backup').then((r) => r.data.data)
}

// 还原备份（传入信封对象）
export function restoreBackup(envelope) {
  return api.post('/settings/restore', envelope).then((r) => r.data)
}

// 系统健康检查（各子系统状态）
export function getHealth() {
  return api.get('/health').then((r) => r.data.data)
}

// 当前版本号
export function getVersion() {
  return api.get('/system/version').then((r) => r.data.data)
}

// 诊断日志（运行日志 + 操作日志 + 运行环境）
export function getDiagnostics() {
  return api.get('/system/diagnostics').then((r) => r.data.data)
}

// 检查更新
export function checkUpdate() {
  return api.get('/system/check-update').then((r) => r.data.data)
}
