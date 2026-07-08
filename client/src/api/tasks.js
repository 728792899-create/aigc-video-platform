/**
 * 任务进度跟踪工具
 * 优先 SSE，浏览器/网络不支持时降级到轮询
 */
import api from './index'
import { API_URL } from './config'

const API_BASE = API_URL

/**
 * 跟踪任务进度
 * @param {string} taskId
 * @param {Object} handlers
 * @param {(task) => void} handlers.onProgress  收到任意进度更新
 * @param {(task) => void} handlers.onSuccess
 * @param {(error) => void} handlers.onError
 * @returns {() => void} 返回 stop 函数
 */
export function trackTask(taskId, { onProgress, onSuccess, onError }) {
  let stopped = false
  const terminal = new Set(['success', 'failed', 'partial', 'interrupted', 'canceled'])
  const isErrorStatus = (status) => ['failed', 'partial', 'interrupted', 'canceled'].includes(status)
  const toTaskError = (task) => {
    const err = new Error(task.error || task.message || '任务失败')
    err.task = task
    err.diagnosis = task.diagnosis || task.meta?.diagnosis || task.result?.diagnosis
    return err
  }

  // 优先尝试 SSE
  if (typeof EventSource !== 'undefined') {
    const es = new EventSource(`${API_BASE}/tasks/${taskId}/stream`)
    es.onmessage = (ev) => {
      if (stopped) return
      try {
        const task = JSON.parse(ev.data)
        onProgress?.(task)
        if (task.status === 'success') {
          es.close()
          onSuccess?.(task)
        } else if (isErrorStatus(task.status)) {
          es.close()
          onError?.(toTaskError(task))
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    es.onerror = () => {
      // SSE 失败 → 降级轮询
      es.close()
      if (!stopped) startPolling()
    }
    return () => {
      stopped = true
      es.close()
    }
  }

  startPolling()

  function startPolling() {
    const poll = async () => {
      if (stopped) return
      try {
        const res = await api.get(`/tasks/${taskId}`)
        const task = res.data?.data
        if (!task) throw new Error('任务不存在')
        onProgress?.(task)
        if (task.status === 'success') return onSuccess?.(task)
        if (terminal.has(task.status) && isErrorStatus(task.status)) return onError?.(toTaskError(task))
        setTimeout(poll, 1500)
      } catch (err) {
        onError?.(err)
      }
    }
    poll()
  }

  return () => {
    stopped = true
  }
}

export function retryFailedTask(taskId, payload = {}) {
  return api.post(`/tasks/${taskId}/retry-failed`, payload).then((r) => r.data.data)
}
