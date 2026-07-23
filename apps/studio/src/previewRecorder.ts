import type { StudioWorkspaceId } from './workspaces.js'

export type PreviewActionResult = 'succeeded' | 'failed' | 'cancelled' | 'blocked'

export type PreviewActionEvent = {
  workspace: StudioWorkspaceId
  action: string
  durationMs: number
  result: PreviewActionResult
  errorCode?: string
  timestamp: string
}

type PreviewEventInput = Omit<PreviewActionEvent, 'timestamp'> & { timestamp?: string }
type PreviewRecorderStorage = Pick<Storage, 'getItem' | 'setItem'>

export const PREVIEW_RECORDER_STORAGE_KEY = 'aigc-director:preview-events'
export const PREVIEW_RECORDER_PREFERENCE_KEY = 'aigc-director:preview-recorder-enabled'
const MAX_EVENTS = 200

export function isBrowserPreviewRecorderEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(PREVIEW_RECORDER_PREFERENCE_KEY) === '1' } catch { return false }
}

export function browserPreviewRecorderStorage(): PreviewRecorderStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try { return window.sessionStorage } catch { return undefined }
}

function safeLabel(value: string, maxLength: number): string {
  return value.replace(/[^\p{L}\p{N}_.:-]/gu, '_').slice(0, maxLength)
}

export function sanitizePreviewEvent(input: PreviewEventInput): PreviewActionEvent {
  return {
    workspace: input.workspace,
    action: safeLabel(input.action, 80),
    durationMs: Math.max(0, Math.min(86_400_000, Math.round(Number.isFinite(input.durationMs) ? input.durationMs : 0))),
    result: input.result,
    ...(input.errorCode ? { errorCode: safeLabel(input.errorCode.toUpperCase(), 80) } : {}),
    timestamp: input.timestamp && !Number.isNaN(Date.parse(input.timestamp)) ? input.timestamp : new Date().toISOString(),
  }
}

export function readPreviewEvents(storage?: PreviewRecorderStorage): PreviewActionEvent[] {
  if (!storage) return []
  try {
    const value = JSON.parse(storage.getItem(PREVIEW_RECORDER_STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.slice(-MAX_EVENTS).filter((item) => item && typeof item === 'object') as PreviewActionEvent[] : []
  } catch {
    return []
  }
}

export function recordPreviewEvent(
  enabled: boolean,
  storage: PreviewRecorderStorage | undefined,
  input: PreviewEventInput,
): PreviewActionEvent | undefined {
  if (!enabled || !storage) return undefined
  const event = sanitizePreviewEvent(input)
  try {
    storage.setItem(PREVIEW_RECORDER_STORAGE_KEY, JSON.stringify([...readPreviewEvents(storage), event].slice(-MAX_EVENTS)))
  } catch { /* 记录器绝不阻断产品流程 */ }
  return event
}
