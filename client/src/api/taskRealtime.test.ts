import { describe, expect, it } from 'vitest'

import { parseTaskRealtimeEvent } from './taskRealtime'

describe('Socket.IO 任务事件边界', () => {
  it('只接受共享契约中的稳定任务状态', () => {
    const event = parseTaskRealtimeEvent({
      type: 'task.changed',
      task: {
        id: 'task-live-1', type: 'video', status: 'running', progress: 42, message: '合成中',
        result: null, created_at: 1, updated_at: 2,
      },
    })
    expect(event.type).toBe('task.changed')
    if (event.type !== 'task.changed') throw new Error('事件类型错误')
    expect(event.task.progress).toBe(42)
    expect(() => parseTaskRealtimeEvent({
      type: 'task.changed',
      task: { id: 'bad', type: 'video', status: 'magic', progress: 42 },
    })).toThrow(/实时任务事件格式异常/)
  })
})
