export type DesktopUpdateStatus =
  | 'disabled'
  | 'unconfigured'
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  version?: string
  percent?: number
  transferred?: number
  total?: number
  errorCode?: 'UPDATE_CHECK_FAILED' | 'UPDATE_DOWNLOAD_FAILED'
  updatedAt: number
}

export interface UpdateInfoLike {
  version: string
}

export interface UpdateProgressLike {
  percent: number
  transferred: number
  total: number
}

export interface UpdateAgent {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'update-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'update-not-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'download-progress', listener: (progress: UpdateProgressLike) => void): unknown
  on(event: 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface DesktopUpdateServiceOptions {
  enabled: boolean
  configured: boolean
  checkDelayMs?: number
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => { unref?: () => void }
  confirmDownload(info: UpdateInfoLike): Promise<boolean>
  confirmInstall(info: UpdateInfoLike): Promise<boolean>
  onState?(state: Readonly<DesktopUpdateState>): void
  onError?(error: Error, state: Readonly<DesktopUpdateState>): void
  log?(message: string): void
}

export class DesktopUpdateService {
  private state: DesktopUpdateState
  private started = false
  private readonly now: () => number

  constructor(
    private readonly agent: UpdateAgent,
    private readonly options: DesktopUpdateServiceOptions,
  ) {
    this.now = options.now || Date.now
    this.state = { status: 'idle', updatedAt: this.now() }
  }

  getState(): Readonly<DesktopUpdateState> {
    return { ...this.state }
  }

  start(): Readonly<DesktopUpdateState> {
    if (this.started) return this.getState()
    this.started = true
    if (!this.options.enabled) return this.publish({ status: 'disabled' })
    if (!this.options.configured) return this.publish({ status: 'unconfigured' })

    this.agent.autoDownload = false
    this.agent.autoInstallOnAppQuit = true
    this.bindEvents()
    this.publish({ status: 'idle' })
    const schedule = this.options.schedule || ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
    const timer = schedule(() => { void this.check() }, this.options.checkDelayMs ?? 15_000)
    timer.unref?.()
    return this.getState()
  }

  async check(): Promise<Readonly<DesktopUpdateState>> {
    if (!this.options.enabled || !this.options.configured) return this.getState()
    this.publish({ status: 'checking' })
    try {
      await this.agent.checkForUpdates()
    } catch (cause: unknown) {
      this.fail('UPDATE_CHECK_FAILED', cause)
    }
    return this.getState()
  }

  private bindEvents(): void {
    this.agent.on('error', (error) => this.fail(
      this.state.status === 'downloading' ? 'UPDATE_DOWNLOAD_FAILED' : 'UPDATE_CHECK_FAILED',
      error,
    ))
    this.agent.on('update-not-available', (info) => {
      this.options.log?.(`[update] 当前已是最新版本 ${info.version}`)
      this.publish({ status: 'up_to_date', version: info.version })
    })
    this.agent.on('update-available', (info) => { void this.handleAvailable(info) })
    this.agent.on('download-progress', (progress) => {
      this.publish({
        status: 'downloading',
        percent: Math.max(0, Math.min(100, progress.percent)),
        transferred: Math.max(0, progress.transferred),
        total: Math.max(0, progress.total),
      })
    })
    this.agent.on('update-downloaded', (info) => { void this.handleDownloaded(info) })
  }

  private async handleAvailable(info: UpdateInfoLike): Promise<void> {
    this.options.log?.(`[update] 发现新版本 ${info.version}`)
    this.publish({ status: 'available', version: info.version })
    if (!await this.options.confirmDownload(info)) return
    this.publish({ status: 'downloading', version: info.version, percent: 0, transferred: 0, total: 0 })
    try {
      await this.agent.downloadUpdate()
    } catch (cause: unknown) {
      this.fail('UPDATE_DOWNLOAD_FAILED', cause)
    }
  }

  private async handleDownloaded(info: UpdateInfoLike): Promise<void> {
    this.publish({ status: 'downloaded', version: info.version, percent: 100 })
    if (await this.options.confirmInstall(info)) this.agent.quitAndInstall(false, true)
  }

  private fail(errorCode: NonNullable<DesktopUpdateState['errorCode']>, cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    const state = this.publish({ status: 'error', errorCode })
    this.options.onError?.(error, state)
  }

  private publish(next: Omit<DesktopUpdateState, 'updatedAt'>): Readonly<DesktopUpdateState> {
    this.state = { ...next, updatedAt: this.now() }
    const snapshot = this.getState()
    this.options.onState?.(snapshot)
    return snapshot
  }
}
