import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createDirectorApp } from './http/app.js'

const dataDirectory = resolve(process.env.AIGC_DIRECTOR_DATA_DIR ?? join(process.cwd(), '.director-data'))
const previousDatabasePath = join(dataDirectory, 'director-v1.sqlite')
const defaultDatabasePath = existsSync(previousDatabasePath) ? previousDatabasePath : join(dataDirectory, 'director.sqlite')
const databasePath = resolve(process.env.AIGC_DIRECTOR_DATABASE ?? defaultDatabasePath)
const sessionToken = process.env.AIGC_DIRECTOR_SESSION_TOKEN ?? randomBytes(32).toString('base64url')
const bootstrapToken = process.env.AIGC_DIRECTOR_BOOTSTRAP_TOKEN
const port = Number.parseInt(process.env.AIGC_DIRECTOR_PORT ?? '33100', 10)
const requestedHost = process.env.AIGC_DIRECTOR_HOST ?? '127.0.0.1'
const host = requestedHost === '0.0.0.0' && process.env.AIGC_DIRECTOR_CONTAINER === '1' ? requestedHost : '127.0.0.1'
const startupProbe = process.env.AIGC_DIRECTOR_STARTUP_PROBE === '1'

const { httpServer, io, db, service, allowOrigin } = createDirectorApp({
  databasePath,
  dataDirectory,
  sessionToken,
  ...(bootstrapToken ? { bootstrapToken } : {}),
  allowedOrigins: (process.env.AIGC_DIRECTOR_ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').map((item) => item.trim()).filter(Boolean),
  ...(process.env.AIGC_DIRECTOR_STUDIO_DIR ? { studioDirectory: process.env.AIGC_DIRECTOR_STUDIO_DIR } : {}),
})

await service.recoverTasks()

if (startupProbe) {
  io.close()
  db.close()
  process.stdout.write(`DIRECTOR_SERVER_PROBE_OK ${JSON.stringify({ version: '2.0.0' })}\n`)
} else {
  httpServer.listen(port, host, () => {
    const address = httpServer.address()
    const boundPort = address && typeof address !== 'string' ? address.port : port
    allowOrigin(`http://${host}:${boundPort}`)
    process.stdout.write(`DIRECTOR_SERVER_READY ${JSON.stringify({ host, port: boundPort, version: '2.0.0' })}\n`)
  })
  httpServer.once('error', (error: NodeJS.ErrnoException) => {
    process.stderr.write(`DIRECTOR_SERVER_ERROR ${error.code ?? 'LISTEN_FAILED'}\n`)
    db.close()
    process.exitCode = 1
  })
}

const shutdown = (): void => {
  io.close()
  httpServer.close(() => {
    db.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 8_000).unref()
}

if (!startupProbe) {
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
