import {
  TaskRealtimeEventSchema,
  type GenerationTask,
  type TaskRealtimeEvent,
} from '@aigc-video/contracts'
import { io, type Socket } from 'socket.io-client'

import { API_BASE } from './config'

export interface TaskRealtimeHandlers {
  onSnapshot?(tasks: GenerationTask[]): void
  onTask?(task: GenerationTask): void
  onConnectionChange?(connected: boolean): void
  onProtocolError?(cause: Error): void
}

export function parseTaskRealtimeEvent(value: unknown): TaskRealtimeEvent {
  const parsed = TaskRealtimeEventSchema.safeParse(value)
  if (!parsed.success) throw new Error('实时任务事件格式异常')
  return parsed.data
}

function endpoint(): { origin: string; path: string } {
  const target = new URL(API_BASE || window.location.origin, window.location.origin)
  const prefix = target.pathname.replace(/\/+$/, '')
  return { origin: target.origin, path: `${prefix}/api/realtime`.replace(/\/{2,}/g, '/') }
}

export function connectTaskRealtime(handlers: TaskRealtimeHandlers = {}): () => void {
  if (typeof window === 'undefined') return () => undefined
  const target = endpoint()
  const token = import.meta.env.VITE_API_TOKEN
  const socket: Socket = io(target.origin, {
    path: target.path,
    transports: ['websocket', 'polling'],
    auth: token ? { token } : undefined,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8_000,
    timeout: 5_000,
  })

  const handle = (value: unknown): void => {
    try {
      const event = parseTaskRealtimeEvent(value)
      if (event.type === 'tasks.snapshot') handlers.onSnapshot?.(event.tasks)
      else handlers.onTask?.(event.task)
    } catch (cause) {
      handlers.onProtocolError?.(cause instanceof Error ? cause : new Error('实时任务事件格式异常'))
    }
  }

  socket.on('connect', () => handlers.onConnectionChange?.(true))
  socket.on('disconnect', () => handlers.onConnectionChange?.(false))
  socket.on('connect_error', () => handlers.onConnectionChange?.(false))
  socket.on('tasks:snapshot', handle)
  socket.on('task:changed', handle)

  return () => {
    socket.removeAllListeners()
    socket.close()
    handlers.onConnectionChange?.(false)
  }
}
