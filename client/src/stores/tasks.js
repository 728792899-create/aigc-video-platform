/**
 * 全局任务进度 store
 * 轮询后端 GET /api/tasks，维护所有后台任务（配图/合成/一键成片）的实时状态，
 * 供右下角的 TaskDock 浮窗展示。自适应轮询：有活动任务时 2s 一次，空闲时 6s 一次。
 */
import { defineStore } from 'pinia'
import api from '../api'

// 任务类型 → 友好标签
const TYPE_LABELS = {
  image: 'AI 配图',
  video: '视频合成',
  'auto-produce': '一键成片',
  tts: '语音合成',
}

// 终态任务在浮窗里继续展示的时长（让用户看到结果），之后自动消失
const FINISHED_TTL = 8000
const ACTIVE_STATUSES = new Set(['pending', 'waiting', 'running', 'composing'])
const ATTENTION_STATUSES = new Set(['failed', 'partial', 'interrupted'])

export function taskTypeLabel(type) {
  return TYPE_LABELS[type] || '后台任务'
}

export const useTaskStore = defineStore('tasks', {
  state: () => ({
    tasks: {},        // id -> task（含 _finishedAt 标记）
    dismissed: {},    // id -> true，用户手动关掉的终态任务
    polling: false,
    _timer: null,
  }),

  getters: {
    // 浮窗里要显示的任务：进行中 + 最近完成（未被手动关掉）
    visibleTasks(state) {
      const now = Date.now()
      return Object.values(state.tasks)
        .filter((t) => {
          if (state.dismissed[t.id]) return false
          if (ACTIVE_STATUSES.has(t.status)) return true
          if (ATTENTION_STATUSES.has(t.status)) return true
          // 终态：只在 TTL 内展示
          return t._finishedAt && now - t._finishedAt < FINISHED_TTL
        })
        .sort((a, b) => b.created_at - a.created_at)
    },
    activeCount(state) {
      return Object.values(state.tasks).filter(
        (t) => ACTIVE_STATUSES.has(t.status)
      ).length
    },
  },

  actions: {
    // 把后端任务合并进本地 state，标记终态完成时刻
    _merge(list) {
      const seen = new Set()
      for (const t of list) {
        seen.add(t.id)
        const prev = this.tasks[t.id]
        const merged = { ...t }
        const isFinished =
          t.status === 'success' || t.status === 'failed' || t.status === 'interrupted'
          || t.status === 'partial' || t.status === 'canceled'
        if (isFinished) {
          merged._finishedAt = prev?._finishedAt || Date.now()
        }
        this.tasks[t.id] = merged
      }
      // 清掉后端已不存在（被 cleanup 删除）的终态任务
      for (const id of Object.keys(this.tasks)) {
        if (!seen.has(id) && this.tasks[id]._finishedAt) {
          delete this.tasks[id]
          delete this.dismissed[id]
        }
      }
    },

    async fetchOnce() {
      try {
        const res = await api.get('/tasks')
        const list = res.data?.data || []
        this._merge(list)
      } catch (e) {
        // 后端暂时不可达时静默，不打断用户
      }
    },

    startPolling() {
      if (this.polling) return
      this.polling = true
      const tick = async () => {
        if (!this.polling) return
        await this.fetchOnce()
        // 自适应间隔：有活动任务 2s，否则 6s
        const delay = this.activeCount > 0 ? 2000 : 6000
        this._timer = setTimeout(tick, delay)
      }
      tick()
    },

    stopPolling() {
      this.polling = false
      if (this._timer) {
        clearTimeout(this._timer)
        this._timer = null
      }
    },

    dismiss(id) {
      this.dismissed[id] = true
    },
  },
})
