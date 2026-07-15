import type { ApiEnvelope } from '@aigc-video/contracts'

import { API_URL } from './config'
import api, { unwrap } from './index'

type EntityId = string | number
type JsonObject = Record<string, unknown>
export type ManagedFileType = 'image' | 'audio' | 'video' | 'subtitle'

export interface ManagedFile extends Record<string, unknown> {
  url: string
  name: string
  display_name?: string
  original_name?: string
  size: number
  mtime?: number
  project_id?: EntityId | null
  project_name?: string | null
  project_deleted?: boolean
  scene_number?: number | null
  normalized?: boolean
}

export interface ManagedFileList { type: ManagedFileType; dir: string; list: ManagedFile[] }
export interface NormalizeResult extends JsonObject { renamed?: number; unchanged?: number }
export interface ScriptOverview extends JsonObject {
  project_id: EntityId
  name: string
  theme?: string | null
  style?: string | null
  status?: string
  scene_count?: number
  char_count?: number
  has_script?: boolean
  created_at?: string | number
  updated_at?: string | number
}
export interface ScriptStoryboard extends JsonObject {
  scene_number?: number
  duration?: number
  description?: string
  dialog?: string
}
export interface ScriptDetail extends JsonObject {
  id: EntityId
  name: string
  summary?: string
  script_content?: string
  theme?: string | null
  storyboards?: ScriptStoryboard[]
}

export function listFiles(type: ManagedFileType): Promise<ManagedFileList> {
  return api.get<ApiEnvelope<ManagedFileList>>('/files', { params: { type } }).then(unwrap)
}

export function normalizeNames(options: { types?: ManagedFileType[]; dry_run?: boolean } = {}): Promise<ApiEnvelope<NormalizeResult>> {
  const { types, dry_run = false } = options
  return api.post<ApiEnvelope<NormalizeResult>>('/files/normalize-names', { types, dry_run }).then((response) => response.data)
}

export function deleteFiles(urls: string[]): Promise<ApiEnvelope<JsonObject>> {
  return api.delete<ApiEnvelope<JsonObject>>('/files', { data: { urls } }).then((response) => response.data)
}

export function revealFile(url: string): Promise<ApiEnvelope<JsonObject>> {
  return api.post<ApiEnvelope<JsonObject>>('/files/reveal', { url }).then((response) => response.data)
}

export function listScripts(): Promise<{ list: ScriptOverview[] }> {
  return api.get<ApiEnvelope<{ list: ScriptOverview[] }>>('/files/scripts').then(unwrap)
}

export function getScript(projectId: EntityId): Promise<ScriptDetail> {
  return api.get<ApiEnvelope<ScriptDetail>>(`/files/scripts/${encodeURIComponent(projectId)}`).then(unwrap)
}

export function scriptExportUrl(projectId: EntityId, format: 'txt' | 'json' = 'txt'): string {
  return `${API_URL}/files/scripts/${encodeURIComponent(projectId)}/export?format=${format}`
}
