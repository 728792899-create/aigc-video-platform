/**
 * 历史记录中心 API 客户端
 */
import api from './index'

// 分页查询历史任务。params: { type, status, page, pageSize }
export function getHistory(params = {}) {
  return api.get('/history', { params }).then((r) => r.data.data)
}

// 重新发起任务（目前支持 auto-produce）。返回 { project_id, task_id }
export function retryHistory(id) {
  return api.post(`/history/${id}/retry`).then((r) => r.data.data)
}

// 删除单条历史记录
export function deleteHistory(id) {
  return api.delete(`/history/${id}`).then((r) => r.data)
}

// 批量删除 / 清空终态。payload: { ids: [] } 或 { all: true }
export function deleteHistoryBatch(payload) {
  return api.delete('/history', { data: payload }).then((r) => r.data)
}
