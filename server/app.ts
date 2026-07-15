import 'dotenv/config'

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

import cors from 'cors'
import express, { type RequestHandler } from 'express'
import morgan from 'morgan'

import { initDb } from './db'
import auth = require('./middleware/auth')
import { errorHandler } from './middleware/errorHandler'
import security = require('./middleware/security')
import config = require('./services/config')
import type { TaskManager } from './services/taskManager'
import { createTaskRealtimeServer } from './services/taskRealtime'
import { recoverTasks } from './services/taskRecovery'

// taskManager 暂时保留 CommonJS singleton 形状以兼容所有旧路由；这里把已知的
// 本地模块边界收窄为其导出的 class，而不是让 `any` 扩散到启动恢复流程。
const taskManager = require('./services/taskManager') as TaskManager

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

const app = express()
const PORT = Number.parseInt(String(process.env.PORT || ''), 10) || 3000
const HOST = process.env.HOST || '127.0.0.1'

const uploadDir = path.resolve(String(config.get('uploadDir')))
for (const directory of ['images', 'audio', 'videos', 'temp', 'subtitles']) {
  const directoryPath = path.join(uploadDir, directory)
  if (!fs.existsSync(directoryPath)) fs.mkdirSync(directoryPath, { recursive: true })
}

const defaultOrigins = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
]
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : defaultOrigins

// 关联 ID 必须早于 CORS/body parser，确保预检拒绝和畸形 JSON 也能诊断。
app.use((request, response, next) => {
  const incoming = request.headers['x-request-id']
  const requestId = (typeof incoming === 'string' && incoming.length <= 100 && incoming) || randomUUID()
  request.requestId = requestId
  response.setHeader('X-Request-Id', requestId)
  next()
})
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    const corsError = Object.assign(new Error(`CORS 拒绝来源: ${origin}`), { status: 403 })
    return callback(corsError)
  },
  credentials: true,
}))
if (process.env.LOG_HTTP !== '0') app.use(morgan('dev'))
app.use(security.securityHeaders)
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(uploadDir))

const clientDist = process.env.CLIENT_DIST
if (clientDist && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  console.log(`[static] 托管前端构建产物: ${clientDist}`)
}

app.use(auth.optionalAuth)

const aiLimiter = security.rateLimit({ windowMs: 60_000, max: 60 }) as RequestHandler
const aiGenerateOnly: RequestHandler = (request, response, next) => {
  if (/^\/(generate|auto-produce|voice-preview)/.test(request.path)) return aiLimiter(request, response, next)
  next()
}

app.use('/api/projects', require('./routes/projects'))
app.use('/api', require('./routes/prompts'))
app.use('/api/storyboards', require('./routes/storyboards'))
app.use('/api/images', require('./routes/images'))
app.use('/api/audio', require('./routes/audio'))
app.use('/api/video', require('./routes/video'))
app.use('/api/ai', aiGenerateOnly, require('./routes/ai'))
app.use('/api/subtitle', require('./routes/subtitle'))
app.use('/api/tasks', require('./routes/tasks'))
app.use('/api/settings', require('./routes/settings'))
app.use('/api/history', require('./routes/history'))
app.use('/api/files', require('./routes/files'))
app.use('/api/trash', require('./routes/trash'))
app.use('/api/logs', require('./routes/logs'))
app.use('/api/media', require('./routes/media'))
app.use('/api/providers', require('./routes/providers'))
app.use('/api/health', require('./routes/health'))
app.use('/api/presets', require('./routes/presets'))
app.use('/api/skills', require('./routes/skills'))
app.use('/api/characters', require('./routes/characters'))
app.use('/api/assets', require('./routes/assets'))
app.use('/api/snapshots', require('./routes/snapshots'))
app.use('/api/system', require('./routes/system'))

if (clientDist && fs.existsSync(clientDist)) {
  const indexHtml = path.join(clientDist, 'index.html')
  app.get(/^(?!\/api|\/uploads).*/, (request, response, next) => {
    if (request.method !== 'GET') return next()
    response.sendFile(indexHtml)
  })
}

app.use(errorHandler)

export async function start(): Promise<void> {
  await initDb()
  try {
    taskManager.loadFromDb()
    const aiRouter = require('./routes/ai')
    const queue = require('./services/autoProduceQueue')
    const workbench = require('./services/workbench')
    const t2vProvider = require('./services/t2vProvider')
    recoverTasks({
      taskManager,
      awaitRunners: false,
      getAdapter: (provider) => t2vProvider.getAdapter(provider),
      runners: {
        'auto-produce': (task) => queue.enqueue(task, () => aiRouter.runAutoProduceTask(
          task.id,
          Number(task.meta.project_id),
          task.meta.params || {},
        )),
        'image-batch': (task) => workbench.runProjectImageBatch(
          task.id,
          Number(task.meta.project_id),
          task.meta.payload || {},
        ),
      },
    }).then((summary) => {
      if (summary.scanned) console.log(`[startup] 任务恢复：${JSON.stringify(summary)}`)
    }).catch((cause: unknown) => console.error('[startup] 自动恢复任务失败:', errorMessage(cause)))
  } catch (cause) {
    console.error('[startup] 任务恢复失败:', errorMessage(cause))
  }

  try {
    const trash = require('./services/trash')
    const count = Number(trash.autoClean()) || 0
    if (count) console.log(`[startup] 回收站自动清理 ${count} 个过期条目`)
    setInterval(() => {
      try { trash.autoClean() } catch (cause) { console.error('[trash] 自动清理失败:', errorMessage(cause)) }
    }, 6 * 60 * 60 * 1000).unref()
  } catch (cause) {
    console.error('[startup] 回收站清理初始化失败:', errorMessage(cause))
  }

  const server = createServer(app)
  const realtime = createTaskRealtimeServer(server, taskManager, allowedOrigins)
  server.listen(PORT, HOST, () => {
    console.log(`服务器运行在 http://${HOST}:${PORT}`)
    if (typeof process.send === 'function') process.send({ type: 'server-ready', port: PORT, host: HOST })
  })

  const shutdown = (signal: string) => {
    console.log(`[shutdown] 收到 ${signal}，正在优雅关闭...`)
    realtime.stop()
    server.close(() => {
      try { require('./db').saveDb?.() } catch { /* best effort during shutdown */ }
      console.log('[shutdown] HTTP 服务已关闭，进程退出')
      process.exit(0)
    })
    setTimeout(() => process.exit(0), 5_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

void start().catch((cause: unknown) => {
  console.error('启动失败:', errorMessage(cause))
  process.exit(1)
})

module.exports = app
