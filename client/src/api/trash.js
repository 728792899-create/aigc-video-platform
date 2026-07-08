/**
 * 回收站 + 操作日志 API 客户端
 */
import api from './index'

// 回收站列表
export function listTrash(category = 'all') {
  return api.get('/trash', { params: { category } }).then((r) => r.data.data)
}

// 回收站详情
export function getTrashDetail(id, groupKey = null) {
  return api.get(`/trash/${id}`, { params: groupKey ? { group_key: groupKey } : {} }).then((r) => r.data.data)
}

// 还原一个条目
export function restoreTrash(id) {
  return api.post(`/trash/${id}/restore`).then((r) => r.data)
}

// 还原回收条目中的指定内容
export function restoreTrashItems(id, keys) {
  return api.post(`/trash/${id}/restore-items`, { keys }).then((r) => r.data)
}

// 彻底删除回收条目中的指定内容
export function purgeTrashItems(id, keys) {
  return api.delete(`/trash/${id}/items`, { data: { keys } }).then((r) => r.data)
}

// 彻底删除一个条目
export function purgeTrash(id) {
  return api.delete(`/trash/${id}`).then((r) => r.data)
}

// 清空回收站
export function emptyTrash() {
  return api.delete('/trash').then((r) => r.data)
}

// 操作日志
export function listLogs(limit = 100) {
  return api.get('/logs', { params: { limit } }).then((r) => r.data.data)
}
