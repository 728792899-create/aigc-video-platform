import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { JsonObject, ProviderPluginState } from '@aigc-director/contracts'
import { JsonObjectSchema } from '@aigc-director/contracts'
import {
  MAX_PLUGIN_RPC_BYTES,
  denoPluginCommand,
  parseProviderPluginRpcMessageLine,
  type ProviderPluginRpcRequest,
} from './pluginRuntime.js'

export type ProviderPluginProcessErrorCode =
  | 'PLUGIN_PROCESS_ALREADY_RUNNING'
  | 'PLUGIN_PROCESS_NOT_RUNNING'
  | 'PLUGIN_PROCESS_SPAWN_FAILED'
  | 'PLUGIN_PROCESS_EXITED'
  | 'PLUGIN_REQUEST_INVALID'
  | 'PLUGIN_REQUEST_TIMEOUT'
  | 'PLUGIN_RPC_MESSAGE_TOO_LARGE'
  | 'PLUGIN_RPC_JSON_INVALID'
  | 'PLUGIN_RPC_SCHEMA_INVALID'
  | 'PLUGIN_RPC_ID_UNKNOWN'
  | 'PLUGIN_RPC_ID_REUSED'
  | 'PLUGIN_STDERR_TOO_LARGE'
  | 'PLUGIN_STDIN_FAILED'
  | 'PLUGIN_TOOL_CALL_LIMIT'
  | 'PLUGIN_HOST_REQUEST_LIMIT'
  | 'PLUGIN_REMOTE_ERROR'
  | 'PLUGIN_STOPPED'

export class ProviderPluginProcessError extends Error {
  readonly name = 'ProviderPluginProcessError'
  constructor(readonly code: ProviderPluginProcessErrorCode) { super(code) }
}

interface PluginReadable {
  on(event: 'data', listener: (chunk: Buffer | string) => void): this
}

interface PluginWritable {
  write(chunk: string): boolean
  once(event: 'error', listener: () => void): this
}

export interface PluginChildProcess {
  readonly stdin: PluginWritable
  readonly stdout: PluginReadable
  readonly stderr: PluginReadable
  readonly pid?: number | undefined
  once(event: 'error', listener: () => void): this
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  kill(signal?: NodeJS.Signals | number): boolean
}

export interface PluginSpawnOptions {
  env: Record<string, string>
  shell: false
  windowsHide: true
  stdio: ['pipe', 'pipe', 'pipe']
}

export type SpawnPluginProcess = (command: string, args: readonly string[], options: PluginSpawnOptions) => PluginChildProcess

export interface ProviderPluginSupervisorOptions {
  pluginId: string
  pluginVersion: string
  runtimePath: string
  bundlePath: string
  mode: 'test' | 'enabled'
  requestTimeoutMs?: number
  maxToolCalls?: number
  maxHostRequests?: number
  maxStderrBytes?: number
  spawnProcess?: SpawnPluginProcess
  handleHostRequest?: (method: 'broker.execute', params: JsonObject, signal: AbortSignal) => Promise<JsonObject>
  onStateChange?: (state: ProviderPluginState, reason?: ProviderPluginProcessErrorCode) => void
}

export interface ProviderPluginSupervisorSnapshot {
  pluginId: string
  pluginVersion: string
  state: ProviderPluginState
  running: boolean
  pid?: number
  toolCalls: number
  pendingRequests: number
  hostRequests: number
  pendingHostRequests: number
  quarantineReason?: ProviderPluginProcessErrorCode
}

interface PendingRequest {
  resolve: (result: JsonObject) => void
  reject: (error: ProviderPluginProcessError) => void
  timer: ReturnType<typeof setTimeout>
}

const defaultSpawn: SpawnPluginProcess = (command, args, options) => spawn(command, [...args], options)

const protocolErrorCode = (error: unknown): ProviderPluginProcessErrorCode => {
  if (error instanceof Error && [
    'PLUGIN_RPC_MESSAGE_TOO_LARGE', 'PLUGIN_RPC_JSON_INVALID', 'PLUGIN_RPC_SCHEMA_INVALID',
  ].includes(error.message)) return error.message as ProviderPluginProcessErrorCode
  return 'PLUGIN_RPC_SCHEMA_INVALID'
}

export class ProviderPluginProcessSupervisor {
  private readonly requestTimeoutMs: number
  private readonly maxToolCalls: number
  private readonly maxHostRequests: number
  private readonly maxStderrBytes: number
  private readonly spawnProcess: SpawnPluginProcess
  private readonly pending = new Map<string, PendingRequest>()
  private readonly pendingHostRequests = new Map<string, AbortController>()
  private process: PluginChildProcess | undefined
  private stdoutBuffer = Buffer.alloc(0)
  private stderrBytes = 0
  private toolCalls = 0
  private hostRequests = 0
  private stopping = false
  private running = false
  private state: ProviderPluginState = 'installed'
  private quarantineReason: ProviderPluginProcessErrorCode | undefined

  constructor(private readonly options: ProviderPluginSupervisorOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000
    this.maxToolCalls = options.maxToolCalls ?? 20
    this.maxHostRequests = options.maxHostRequests ?? 20
    this.maxStderrBytes = options.maxStderrBytes ?? MAX_PLUGIN_RPC_BYTES
    this.spawnProcess = options.spawnProcess ?? defaultSpawn
    if (this.requestTimeoutMs < 10 || this.requestTimeoutMs > 120_000) throw new Error('PLUGIN_TIMEOUT_INVALID')
    if (this.maxToolCalls < 1 || this.maxToolCalls > 100) throw new Error('PLUGIN_TOOL_CALL_LIMIT_INVALID')
    if (this.maxHostRequests < 1 || this.maxHostRequests > 100) throw new Error('PLUGIN_HOST_REQUEST_LIMIT_INVALID')
    if (this.maxStderrBytes < 1_024 || this.maxStderrBytes > 1024 * 1024) throw new Error('PLUGIN_STDERR_LIMIT_INVALID')
  }

  start(): ProviderPluginState {
    if (this.running) throw new ProviderPluginProcessError('PLUGIN_PROCESS_ALREADY_RUNNING')
    if (this.state === 'quarantined') throw new ProviderPluginProcessError(this.quarantineReason ?? 'PLUGIN_PROCESS_EXITED')
    const command = denoPluginCommand(this.options.runtimePath, this.options.bundlePath)
    this.stopping = false
    this.stdoutBuffer = Buffer.alloc(0)
    this.stderrBytes = 0
    this.toolCalls = 0
    this.hostRequests = 0
    this.abortPendingHostRequests()
    try {
      this.process = this.spawnProcess(command.command, command.args, {
        env: command.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      throw new ProviderPluginProcessError('PLUGIN_PROCESS_SPAWN_FAILED')
    }
    this.running = true
    this.state = this.options.mode === 'enabled' ? 'enabled' : 'tested'
    this.quarantineReason = undefined
    this.process.stdout.on('data', (chunk) => this.consumeStdout(chunk))
    this.process.stderr.on('data', (chunk) => this.consumeStderr(chunk))
    this.process.stdin.once('error', () => this.quarantine('PLUGIN_STDIN_FAILED'))
    this.process.once('error', () => this.quarantine('PLUGIN_PROCESS_SPAWN_FAILED'))
    this.process.once('close', () => {
      if (this.stopping) return
      this.running = false
      this.process = undefined
      this.setQuarantined('PLUGIN_PROCESS_EXITED', false)
    })
    this.options.onStateChange?.(this.state)
    return this.state
  }

  request(method: string, params: JsonObject): Promise<JsonObject> {
    if (!this.running || !this.process) return Promise.reject(new ProviderPluginProcessError('PLUGIN_PROCESS_NOT_RUNNING'))
    if (!/^[a-z][a-z0-9_.-]{2,119}$/u.test(method) || !JsonObjectSchema.safeParse(params).success) {
      return Promise.reject(new ProviderPluginProcessError('PLUGIN_REQUEST_INVALID'))
    }
    if (this.toolCalls >= this.maxToolCalls) {
      const error = new ProviderPluginProcessError('PLUGIN_TOOL_CALL_LIMIT')
      this.quarantine(error.code)
      return Promise.reject(error)
    }
    const id = randomUUID()
    const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    if (Buffer.byteLength(line, 'utf8') > MAX_PLUGIN_RPC_BYTES) return Promise.reject(new ProviderPluginProcessError('PLUGIN_RPC_MESSAGE_TOO_LARGE'))
    this.toolCalls += 1
    return new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => this.quarantine('PLUGIN_REQUEST_TIMEOUT'), this.requestTimeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.process?.stdin.write(line)
      } catch {
        this.quarantine('PLUGIN_STDIN_FAILED')
      }
    })
  }

  stop(): void {
    if (!this.process) return
    this.stopping = true
    this.running = false
    this.rejectPending('PLUGIN_STOPPED')
    this.abortPendingHostRequests()
    const process = this.process
    this.process = undefined
    process.kill('SIGTERM')
  }

  snapshot(): ProviderPluginSupervisorSnapshot {
    return {
      pluginId: this.options.pluginId,
      pluginVersion: this.options.pluginVersion,
      state: this.state,
      running: this.running,
      ...(this.process?.pid === undefined ? {} : { pid: this.process.pid }),
      toolCalls: this.toolCalls,
      pendingRequests: this.pending.size,
      hostRequests: this.hostRequests,
      pendingHostRequests: this.pendingHostRequests.size,
      ...(this.quarantineReason === undefined ? {} : { quarantineReason: this.quarantineReason }),
    }
  }

  private consumeStdout(chunk: Buffer | string): void {
    if (!this.running) return
    let incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    while (incoming.length > 0 && this.running) {
      const newline = incoming.indexOf(0x0a)
      const segment = newline < 0 ? incoming : incoming.subarray(0, newline)
      if (this.stdoutBuffer.length + segment.length > MAX_PLUGIN_RPC_BYTES) return this.quarantine('PLUGIN_RPC_MESSAGE_TOO_LARGE')
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, segment])
      if (newline < 0) return
      const rawLine = this.stdoutBuffer
      this.stdoutBuffer = Buffer.alloc(0)
      incoming = incoming.subarray(newline + 1)
      const line = rawLine.at(-1) === 0x0d ? rawLine.subarray(0, -1) : rawLine
      if (line.length === 0) continue
      if (!this.consumeRpcLine(line)) return
    }
  }

  private consumeRpcLine(line: Buffer): boolean {
    try {
      const response = parseProviderPluginRpcMessageLine(line.toString('utf8'))
      if ('method' in response) {
        this.consumeHostRequest(response)
        return this.running
      }
      const request = this.pending.get(response.id)
      if (!request) { this.quarantine('PLUGIN_RPC_ID_UNKNOWN'); return false }
      clearTimeout(request.timer)
      this.pending.delete(response.id)
      if (response.error) request.reject(new ProviderPluginProcessError('PLUGIN_REMOTE_ERROR'))
      else request.resolve(response.result ?? {})
      return true
    } catch (error) {
      this.quarantine(protocolErrorCode(error))
      return false
    }
  }

  private consumeHostRequest(request: ProviderPluginRpcRequest): void {
    if (this.pending.has(request.id) || this.pendingHostRequests.has(request.id)) return this.quarantine('PLUGIN_RPC_ID_REUSED')
    if (this.hostRequests >= this.maxHostRequests) return this.quarantine('PLUGIN_HOST_REQUEST_LIMIT')
    this.hostRequests += 1
    const controller = new AbortController()
    this.pendingHostRequests.set(request.id, controller)
    void (async () => {
      let response: JsonObject
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        if (!this.options.handleHostRequest) throw new Error('BROKER_UNAVAILABLE')
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort(new ProviderPluginProcessError('PLUGIN_REQUEST_TIMEOUT'))
            reject(new ProviderPluginProcessError('PLUGIN_REQUEST_TIMEOUT'))
          }, this.requestTimeoutMs)
          timeout.unref?.()
        })
        const result = JsonObjectSchema.parse(await Promise.race([
          this.options.handleHostRequest(request.method, request.params, controller.signal), timeoutPromise,
        ]))
        response = { jsonrpc: '2.0', id: request.id, result }
      } catch (error) {
        const code = error instanceof ProviderPluginProcessError && error.code === 'PLUGIN_REQUEST_TIMEOUT'
          ? 'BROKER_REQUEST_TIMEOUT'
          : 'BROKER_REQUEST_REJECTED'
        response = { jsonrpc: '2.0', id: request.id, error: { code, message: '宿主拒绝了该出口请求。' } }
      } finally {
        if (timeout) clearTimeout(timeout)
      }
      this.pendingHostRequests.delete(request.id)
      if (!this.running) return
      this.writeRpcLine(response)
    })()
  }

  private writeRpcLine(payload: JsonObject): void {
    const line = `${JSON.stringify(payload)}\n`
    if (Buffer.byteLength(line, 'utf8') > MAX_PLUGIN_RPC_BYTES) return this.quarantine('PLUGIN_RPC_MESSAGE_TOO_LARGE')
    try { this.process?.stdin.write(line) } catch { this.quarantine('PLUGIN_STDIN_FAILED') }
  }

  private consumeStderr(chunk: Buffer | string): void {
    if (!this.running) return
    this.stderrBytes += Buffer.byteLength(chunk)
    if (this.stderrBytes > this.maxStderrBytes) this.quarantine('PLUGIN_STDERR_TOO_LARGE')
  }

  private quarantine(code: ProviderPluginProcessErrorCode): void {
    this.setQuarantined(code, true)
  }

  private setQuarantined(code: ProviderPluginProcessErrorCode, terminate: boolean): void {
    if (this.state === 'quarantined') return
    this.state = 'quarantined'
    this.quarantineReason = code
    this.running = false
    this.stopping = true
    this.rejectPending(code)
    this.abortPendingHostRequests()
    const process = this.process
    this.process = undefined
    if (terminate) process?.kill('SIGKILL')
    this.options.onStateChange?.(this.state, code)
  }

  private rejectPending(code: ProviderPluginProcessErrorCode): void {
    const error = new ProviderPluginProcessError(code)
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }

  private abortPendingHostRequests(): void {
    for (const controller of this.pendingHostRequests.values()) controller.abort(new ProviderPluginProcessError('PLUGIN_STOPPED'))
    this.pendingHostRequests.clear()
  }
}
