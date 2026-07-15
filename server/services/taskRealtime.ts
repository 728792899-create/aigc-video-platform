import { timingSafeEqual } from 'node:crypto'
import type { Server as HttpServer } from 'node:http'

import { TaskRealtimeEventSchema, type TaskRealtimeEvent } from '@aigc-video/contracts'
import { Server as SocketServer, type Socket } from 'socket.io'

import type { TaskManager, TaskRecord } from './taskManager'

export interface TaskRealtimeEmitter {
  emit(event: string, payload: unknown): unknown
}

function changedEvent(task: TaskRecord): TaskRealtimeEvent {
  return TaskRealtimeEventSchema.parse({ type: 'task.changed', task })
}

export function bindTaskRealtime(emitter: TaskRealtimeEmitter, taskManager: TaskManager): () => void {
  const listener = (task: TaskRecord) => emitter.emit('task:changed', changedEvent(task))
  taskManager.on('change', listener)
  return () => taskManager.off('change', listener)
}

function sameToken(given: unknown, expected: unknown): boolean {
  const left = Buffer.from(String(given || ''))
  const right = Buffer.from(String(expected || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

function socketToken(socket: Socket): string {
  const authorization = String(socket.handshake.headers.authorization || '')
  if (authorization.startsWith('Bearer ')) return authorization.slice(7)
  const auth = socket.handshake.auth as Record<string, unknown> | undefined
  return typeof auth?.token === 'string' ? auth.token : ''
}

export interface TaskRealtimeServer {
  io: SocketServer
  stop(): void
}

export function createTaskRealtimeServer(
  server: HttpServer,
  taskManager: TaskManager,
  allowedOrigins: string[],
): TaskRealtimeServer {
  const originAllowed = (origin: string | undefined): boolean => !origin || allowedOrigins.includes(origin)
  const io = new SocketServer(server, {
    path: '/api/realtime',
    serveClient: false,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 64 * 1024,
    cors: {
      origin(origin, callback) {
        if (originAllowed(origin)) callback(null, true)
        else callback(new Error('Socket.IO CORS 来源未获允许'))
      },
      credentials: true,
    },
    allowRequest(request, callback) {
      callback(null, originAllowed(request.headers.origin))
    },
  })

  io.use((socket, next) => {
    const expected = process.env.API_TOKEN
    if (!expected || sameToken(socketToken(socket), expected)) return next()
    next(new Error('未授权：缺少或错误的 API Token'))
  })

  io.on('connection', (socket) => {
    const tasks = taskManager.list().sort((left, right) => right.created_at - left.created_at)
    const snapshot = TaskRealtimeEventSchema.parse({ type: 'tasks.snapshot', tasks, server_time: Date.now() })
    socket.emit('tasks:snapshot', snapshot)
  })

  const unbind = bindTaskRealtime(io, taskManager)
  return {
    io,
    stop() {
      unbind()
      io.disconnectSockets(true)
      io.removeAllListeners()
    },
  }
}
