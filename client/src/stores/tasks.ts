import type { ApiEnvelope, GenerationTask, TaskStatus } from '@aigc-video/contracts'
import { GenerationTaskSchema } from '@aigc-video/contracts'
import { defineStore } from 'pinia'

import api, { unwrap } from '../api'
import { connectTaskRealtime } from '../api/taskRealtime'

type LocalTask = GenerationTask & { _finishedAt?: number }

interface TaskState {
  tasks: Record<string, LocalTask>
  dismissed: Record<string, boolean>
  polling: boolean
  transport: 'idle' | 'socket' | 'polling'
  _timer: ReturnType<typeof setTimeout> | null
  _realtimeStop: (() => void) | null
}

const TYPE_LABELS: Record<string, string> = {
  image: 'AI 配图',
  video: '视频合成',
  'video-generation': '镜头视频生成',
  'auto-produce': '一键成片',
  tts: '语音合成',
}
const FINISHED_TTL = 8_000
const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'waiting', 'running', 'composing', 'retrying', 'cancel_requested', 'reconciling'])
const ATTENTION_STATUSES = new Set<TaskStatus>(['failed', 'partial', 'timed_out', 'interrupted', 'orphaned'])
const FINISHED_STATUSES = new Set<TaskStatus>(['success', 'failed', 'partial', 'timed_out', 'interrupted', 'orphaned', 'canceled'])

export function taskTypeLabel(type: string): string {
  return TYPE_LABELS[type] || '后台任务'
}

export const useTaskStore = defineStore('tasks', {
  state: (): TaskState => ({
    tasks: {}, dismissed: {}, polling: false, transport: 'idle', _timer: null, _realtimeStop: null,
  }),

  getters: {
    visibleTasks(state): LocalTask[] {
      const now = Date.now()
      return Object.values(state.tasks)
        .filter((task) => {
          if (state.dismissed[task.id]) return false
          if (ACTIVE_STATUSES.has(task.status) || ATTENTION_STATUSES.has(task.status)) return true
          return Boolean(task._finishedAt && now - task._finishedAt < FINISHED_TTL)
        })
        .sort((left, right) => right.created_at - left.created_at)
    },
    activeCount(state): number {
      return Object.values(state.tasks).filter((task) => ACTIVE_STATUSES.has(task.status)).length
    },
  },

  actions: {
    _merge(list: GenerationTask[]) {
      const seen = new Set<string>()
      for (const task of list) {
        seen.add(task.id)
        const previous = this.tasks[task.id]
        const merged: LocalTask = { ...task }
        if (FINISHED_STATUSES.has(task.status)) merged._finishedAt = previous?._finishedAt || Date.now()
        this.tasks[task.id] = merged
      }
      for (const id of Object.keys(this.tasks)) {
        if (!seen.has(id) && this.tasks[id]?._finishedAt) {
          delete this.tasks[id]
          delete this.dismissed[id]
        }
      }
    },

    _upsert(task: GenerationTask) {
      const previous = this.tasks[task.id]
      const merged: LocalTask = { ...task }
      if (FINISHED_STATUSES.has(task.status)) merged._finishedAt = previous?._finishedAt || Date.now()
      this.tasks[task.id] = merged
    },

    async fetchOnce() {
      try {
        const response = await api.get<ApiEnvelope<GenerationTask[]>>('/tasks')
        const result = GenerationTaskSchema.array().safeParse(unwrap(response))
        if (result.success) this._merge(result.data)
      } catch {
        // 弱网或后端重启期间保留最后一次状态，不打断创作。
      }
    },

    _scheduleNext(delay?: number): void {
      if (!this.polling) return
      if (this._timer) clearTimeout(this._timer)
      const interval = delay ?? (this.transport === 'socket' ? 30_000 : this.activeCount > 0 ? 2_000 : 6_000)
      this._timer = setTimeout(() => {
        void this.fetchOnce().finally(() => this._scheduleNext())
      }, interval)
    },

    startPolling() {
      if (this.polling) return
      this.polling = true
      this.transport = 'polling'
      this._realtimeStop = connectTaskRealtime({
        onSnapshot: (tasks) => this._merge(tasks),
        onTask: (task) => this._upsert(task),
        onConnectionChange: (connected) => {
          if (!this.polling) return
          this.transport = connected ? 'socket' : 'polling'
          this._scheduleNext(connected ? 30_000 : 0)
        },
      })
      void this.fetchOnce().finally(() => this._scheduleNext())
    },

    stopPolling() {
      this.polling = false
      this.transport = 'idle'
      if (this._timer) clearTimeout(this._timer)
      this._timer = null
      this._realtimeStop?.()
      this._realtimeStop = null
    },

    dismiss(id: string) {
      this.dismissed[id] = true
    },
  },
})
