import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'

import api, { unwrap } from './index'

export type JsonObject = Record<string, unknown>

const JsonObjectSchema = z.record(z.string(), z.unknown())
const CredentialSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  accessKey: z.string().optional(),
  secretKey: z.string().optional(),
  appId: z.string().optional(),
  cluster: z.string().optional(),
}).passthrough()

export const SettingsDataSchema = z.object({
  uploadDir: z.string().default('./uploads'),
  ffmpegPath: z.string().default('ffmpeg'),
  defaultImageModel: z.string().default('flux'),
  defaultStyle: z.string().default('写实'),
  defaultVoice: z.string().default('xiaoxiao'),
  defaultDuration: z.string().default('150-210'),
  deepseek: CredentialSchema.default({}),
  pollinations: z.object({
    timeout: z.coerce.number().int().positive().default(20_000),
    retries: z.coerce.number().int().min(0).default(3),
  }).passthrough().default({ timeout: 20_000, retries: 3 }),
  pacing: z.object({
    tightPace: z.boolean().default(true),
    tightTail: z.coerce.number().min(0).default(0.12),
    standardTail: z.coerce.number().min(0).default(0.3),
    noVoiceTail: z.coerce.number().min(0).default(0.6),
  }).passthrough().default({ tightPace: true, tightTail: 0.12, standardTail: 0.3, noVoiceTail: 0.6 }),
  credentials: z.record(z.string(), CredentialSchema).optional(),
  _runtime: z.object({ settingsFile: z.string().optional() }).passthrough().optional(),
}).passthrough()
export type SettingsData = z.infer<typeof SettingsDataSchema>

const DeepseekPresetSchema = z.object({
  label: z.string(),
  baseUrl: z.string(),
  model: z.string(),
})
export type DeepseekPreset = z.infer<typeof DeepseekPresetSchema>

const SettingsPresetsSchema = z.object({
  deepseek: z.array(DeepseekPresetSchema).default([]),
}).passthrough()

const ApiTestResultSchema = z.object({
  ok: z.boolean(),
  latency: z.number().optional(),
  message: z.string().optional(),
}).passthrough()
export type ApiTestResult = z.infer<typeof ApiTestResultSchema>

export const ProviderHealthItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.string(),
  kindLabel: z.string().optional(),
  configured: z.boolean().default(false),
  userConfigured: z.boolean().optional(),
  free: z.boolean().optional(),
  status: z.string(),
  message: z.string(),
  last_error: z.string().optional(),
  last_error_at: z.number().optional(),
  usage: z.object({
    ok: z.number(),
    fail: z.number(),
    success_rate: z.number(),
    last_ms: z.number(),
  }).nullable().optional(),
}).passthrough()
export type ProviderHealthItem = z.infer<typeof ProviderHealthItemSchema>

const HealthCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['ok', 'warn', 'error']),
  message: z.string(),
  metrics: JsonObjectSchema.default({}),
}).passthrough()
export type HealthCheck = z.infer<typeof HealthCheckSchema>

const HealthDataSchema = z.object({
  overall: z.enum(['ok', 'warn', 'error']).default('ok'),
  checked_at: z.number().default(0),
  checks: z.array(HealthCheckSchema).default([]),
  needs_setup: z.boolean().optional(),
  setup_message: z.string().optional(),
}).passthrough()
export type HealthData = z.infer<typeof HealthDataSchema>

const SystemVersionSchema = z.object({ version: z.string(), node: z.string().optional() }).passthrough()
const DiagnosticsSchema = z.object({
  version: z.string(),
  node: z.string(),
  platform: z.string(),
  uptime_sec: z.number(),
  memory_mb: z.number(),
  generated_at: z.string(),
  out_log: z.array(z.string()).default([]),
  error_log: z.array(z.string()).default([]),
  op_log: z.array(z.unknown()).default([]),
}).passthrough()
export type Diagnostics = z.infer<typeof DiagnosticsSchema>

const UpdateInfoSchema = z.object({
  current: z.string(),
  latest: z.string(),
  has_update: z.boolean(),
  download_url: z.string(),
  notes: z.string().optional(),
}).passthrough()
export type UpdateInfo = z.infer<typeof UpdateInfoSchema>

const ConfigExportSchema = z.object({
  version: z.number(),
  exportedAt: z.number(),
  secretsIncluded: z.literal(false),
  config: SettingsDataSchema,
}).passthrough()
export type ConfigExport = z.infer<typeof ConfigExportSchema>

export const BackupEnvelopeSchema = z.object({
  magic: z.literal('AIGC_BACKUP'),
  version: z.number(),
  createdAt: z.number(),
  config: SettingsDataSchema,
  secretsIncluded: z.literal(false),
  db: z.string().min(1),
}).passthrough()
export type BackupEnvelope = z.infer<typeof BackupEnvelopeSchema>

export interface SettingsSaveEnvelope extends ApiEnvelope<SettingsData> {
  needRestart?: boolean
}

export interface DirectoryCheckResult extends JsonObject {
  path?: string
  writable?: boolean
  exists?: boolean
  ok?: boolean
  message?: string
}

export interface StorageStats {
  root: string
  totalSize: number
  totalFiles: number
  breakdown: Record<string, { size: number; count: number }>
}

export async function getSettings(): Promise<SettingsData> {
  return SettingsDataSchema.parse(unwrap(await api.get<ApiEnvelope<SettingsData>>('/settings')))
}

export async function getPresets(): Promise<{ deepseek: DeepseekPreset[] }> {
  return SettingsPresetsSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/settings/presets')))
}

export async function saveSettings(patch: JsonObject): Promise<SettingsSaveEnvelope> {
  return (await api.post<SettingsSaveEnvelope>('/settings', patch)).data
}

export async function saveDefaults(patch: JsonObject): Promise<SettingsSaveEnvelope> {
  return (await api.put<SettingsSaveEnvelope>('/settings/defaults', patch)).data
}

export function clearProviderKey(provider: string): Promise<ApiEnvelope<JsonObject>> {
  return api.post<ApiEnvelope<JsonObject>>('/settings/keys/clear', { provider }).then((response) => response.data)
}

export async function testApi(payload: JsonObject): Promise<ApiTestResult> {
  return ApiTestResultSchema.parse(unwrap(await api.post<ApiEnvelope<unknown>>('/settings/test-api', payload)))
}

export function checkDir(dir: string, create = false): Promise<DirectoryCheckResult> {
  return api.post<ApiEnvelope<DirectoryCheckResult>>('/settings/check-dir', { dir, create }).then(unwrap)
}

export async function pickDir(): Promise<{ path: string } | null> {
  if (window.aigcStudio?.selectExportDirectory) {
    const path = await window.aigcStudio.selectExportDirectory()
    return path ? { path } : null
  }
  return api.post<ApiEnvelope<{ path: string } | null>>('/settings/pick-dir').then(unwrap)
}

export async function getStorageStats(): Promise<StorageStats> {
  const schema = z.object({
    root: z.string(),
    totalSize: z.number(),
    totalFiles: z.number(),
    breakdown: z.record(z.string(), z.object({ size: z.number(), count: z.number() })),
  })
  return schema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/settings/storage-stats')))
}

export function cleanTemp(): Promise<ApiEnvelope<JsonObject>> {
  return api.post<ApiEnvelope<JsonObject>>('/settings/clean-temp').then((response) => response.data)
}

export async function exportConfig(_mask = true): Promise<ConfigExport> {
  return ConfigExportSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/settings/export-config')))
}

export function importConfig(config: JsonObject): Promise<ApiEnvelope<JsonObject>> {
  return api.post<ApiEnvelope<JsonObject>>('/settings/import-config', { config }).then((response) => response.data)
}

export async function getBackup(): Promise<BackupEnvelope> {
  return BackupEnvelopeSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/settings/backup')))
}

export function restoreBackup(envelope: BackupEnvelope): Promise<ApiEnvelope<JsonObject>> {
  return api.post<ApiEnvelope<JsonObject>>('/settings/restore', envelope).then((response) => response.data)
}

export async function getHealth(): Promise<HealthData> {
  return HealthDataSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/health')))
}

export async function getVersion(): Promise<z.infer<typeof SystemVersionSchema>> {
  return SystemVersionSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/system/version')))
}

export async function getDiagnostics(): Promise<Diagnostics> {
  return DiagnosticsSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/system/diagnostics')))
}

export async function checkUpdate(): Promise<UpdateInfo> {
  return UpdateInfoSchema.parse(unwrap(await api.get<ApiEnvelope<unknown>>('/system/check-update')))
}
