/**
 * Provider-neutral text/image-to-video adapter.
 *
 * Cloud jobs are persisted by the caller before submit. Reconciliation only
 * queries existing provider task IDs and never re-submits a billable request.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type {
  ProviderAdapter,
  ProviderBillingStatus,
  ProviderContext,
  ProviderOperationCapabilities,
  ProviderReconciliation,
  ProviderSubmission,
} from '@aigc-video/contracts'

import * as config from './config'
import { normalizeAppError } from './appError'
import { assertSelection } from './modelCatalog'
import { resolveCredentials, type ProviderCredentials } from './providers'
import { getProvider, hasCredentials } from './providers'
import { downloadRemoteMedia } from './remoteMedia'

type JsonObject = Record<string, unknown>

interface RequestJsonOptions {
  method?: string
  headers?: http.OutgoingHttpHeaders
  body?: unknown
  timeoutMs?: number
}

interface RetryOptions {
  attempts?: number
  baseDelay?: number
  label?: string
}

interface T2VOptions {
  imageUrl?: string
  seconds?: number
  onSubmitted?: (providerTaskId: string) => void | Promise<void>
}

export interface T2VGenerateArgs extends T2VOptions {
  provider: string
  model?: string | null
  prompt: string
  ratio?: string
}

interface T2VAdapterInput extends T2VOptions {
  model?: string | null
  prompt: string
  ratio?: string
}

interface LocalVideoFile {
  local_path: string
  file_url: string
  filename: string
  remote_url?: string
}

export interface T2VResult {
  submit_id: string
  gen_status: 'success'
  video_url: string
  local_path: string
  file_url: string
  duration: number | null
}

interface ReconciledVideoResult {
  submit_id: string
  file_url: string
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '')
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstRecord(value: unknown): JsonObject {
  return Array.isArray(value) ? asRecord(value[0]) : {}
}

function providerTaskId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

const UPLOAD_DIR = path.resolve(String(config.get('uploadDir')), 'videos', 't2v')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const HANDLED = new Set(['zhipu-video', 'kling'])

export function canHandle(protocol: unknown): boolean {
  return typeof protocol === 'string' && HANDLED.has(protocol)
}

function aspectFor(ratio: string): string {
  if (ratio === '9:16' || ratio === '2:3' || ratio === '3:4') return '9:16'
  if (ratio === '1:1') return '1:1'
  return '16:9'
}

/** Parse all external responses as unknown JSON before reading fields. */
function requestJson(
  url: string,
  { method = 'POST', headers = {}, body = null, timeoutMs = 60_000 }: RequestJsonOptions = {},
): Promise<JsonObject> {
  return new Promise<JsonObject>((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'http:' ? http : https
    const payload = body === null || body === undefined ? null : JSON.stringify(body)
    const requestHeaders: http.OutgoingHttpHeaders = { 'Content-Type': 'application/json', ...headers }
    if (payload) requestHeaders['Content-Length'] = Buffer.byteLength(payload)
    const options: http.RequestOptions = { method, headers: requestHeaders }
    const request = transport.request(target, options, (response) => {
      let data = ''
      response.on('data', (chunk: Buffer | string) => { data += chunk.toString() })
      response.on('end', () => {
        let parsed: JsonObject
        try {
          parsed = data ? asRecord(JSON.parse(data)) : {}
        } catch {
          parsed = { _raw: data }
        }
        const status = response.statusCode || 0
        if (status >= 200 && status < 300) {
          resolve(parsed)
          return
        }
        const nestedError = asRecord(parsed.error)
        const message = nestedError.message || parsed.message || parsed._raw || `HTTP ${status}`
        reject(new Error(`${status}: ${String(message)}`))
      })
    })
    request.on('error', reject)
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`请求超时（>${timeoutMs / 1000}s）`)))
    if (payload) request.write(payload)
    request.end()
  })
}

function isTransient(error: unknown): boolean {
  const message = errorMessage(error)
  return /^429:/.test(message)
    || /访问量过大|too many requests|rate limit/i.test(message)
    || /^(500|502|503|504):/.test(message)
    || /超时|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(message)
}

async function requestJsonRetry(
  url: string,
  options: RequestJsonOptions = {},
  { attempts = 4, baseDelay = 4_000, label = '请求' }: RetryOptions = {},
): Promise<JsonObject> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await requestJson(url, options)
    } catch (error: unknown) {
      lastError = error
      if (attempt === attempts - 1 || !isTransient(error)) throw error
      const delay = baseDelay * (2 ** attempt) + Math.floor(Math.random() * 1_000)
      console.warn(`[t2v] ${label} 瞬时失败（${errorMessage(error)}），${Math.round(delay / 1000)}s 后第 ${attempt + 2}/${attempts} 次重试…`)
      await sleep(delay)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}失败`)
}

async function downloadToLocal(url: string, timeoutMs = 120_000): Promise<LocalVideoFile> {
  const filename = `t2v_${uuidv4()}.mp4`
  const destination = path.join(UPLOAD_DIR, filename)
  const result = await downloadRemoteMedia(url, {
    destination,
    kind: 'video',
    maxBytes: 512 * 1024 * 1024,
    timeoutMs,
    idleTimeoutMs: 30_000,
    headers: { Accept: 'video/mp4,application/mp4,application/octet-stream;q=0.8' },
  })
  return { local_path: result.destination, file_url: `/uploads/videos/t2v/${filename}`, filename }
}

function signKlingJwt(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: accessKey, exp: now + 1800, nbf: now - 5 })}`
  const signature = crypto.createHmac('sha256', secretKey).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

function wrap(submitId: string, file: LocalVideoFile, duration?: number): T2VResult {
  return {
    submit_id: submitId,
    gen_status: 'success',
    video_url: file.file_url,
    local_path: file.local_path,
    file_url: file.file_url,
    duration: duration || null,
  }
}

function cogVideoUrl(response: JsonObject): string | undefined {
  return optionalString(firstRecord(response.video_result).url)
}

function klingData(response: JsonObject): JsonObject {
  return asRecord(response.data)
}

function klingVideoUrl(response: JsonObject): string | undefined {
  const result = asRecord(klingData(response).task_result)
  return optionalString(firstRecord(result.videos).url)
}

async function genCogVideoX(
  credentials: ProviderCredentials,
  model: string,
  prompt: string,
  ratio: string,
  options: T2VOptions = {},
): Promise<T2VResult> {
  const root = credentials.baseUrl.replace(/\/$/, '')
  const body: JsonObject = { model, prompt, quality: 'speed', with_audio: false }
  if (options.imageUrl) body.image_url = options.imageUrl
  else body.size = ratio === '9:16' ? '1080x1920' : ratio === '1:1' ? '1024x1024' : '1920x1080'

  const submitted = await requestJsonRetry(`${root}/api/paas/v4/videos/generations`, {
    headers: { Authorization: `Bearer ${credentials.apiKey}` },
    body,
  }, { label: 'CogVideoX 提交' })
  const taskId = providerTaskId(submitted.id) || providerTaskId(submitted.request_id)
  if (!taskId) throw new Error('CogVideoX 未返回任务 id')
  await options.onSubmitted?.(taskId)

  const queryUrl = `${root}/api/paas/v4/async-result/${encodeURIComponent(taskId)}`
  let pollingErrors = 0
  for (let poll = 0; poll < 60; poll += 1) {
    await sleep(5_000)
    let response: JsonObject
    try {
      response = await requestJson(queryUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      })
    } catch (error: unknown) {
      if (isTransient(error) && ++pollingErrors <= 5) {
        console.warn(`[t2v] CogVideoX 轮询瞬时失败（${errorMessage(error)}），继续等待…`)
        continue
      }
      throw error
    }
    pollingErrors = 0
    const status = optionalString(response.task_status)?.toUpperCase()
    if (status === 'SUCCESS') {
      const remoteUrl = cogVideoUrl(response)
      if (!remoteUrl) throw new Error('CogVideoX 成功但无视频 url')
      const file = await downloadToLocal(remoteUrl)
      return wrap(taskId, { ...file, remote_url: remoteUrl }, options.seconds)
    }
    if (status === 'FAIL') throw new Error(`CogVideoX 任务失败：${String(response.message || 'FAIL')}`)
  }
  throw new Error('CogVideoX 任务轮询超时（>5min）')
}

async function genKling(
  credentials: ProviderCredentials,
  model: string,
  prompt: string,
  ratio: string,
  options: T2VOptions = {},
): Promise<T2VResult> {
  if (!credentials.accessKey || !credentials.secretKey) throw new Error('可灵 Kling 需配置 Access Key + Secret Key')
  const root = credentials.baseUrl.replace(/\/$/, '')
  const imageMode = Boolean(options.imageUrl)
  const body: JsonObject = {
    model_name: model || 'kling-v1',
    prompt,
    aspect_ratio: aspectFor(ratio),
    duration: String(options.seconds || 5),
    mode: 'std',
  }
  if (options.imageUrl) body.image = options.imageUrl
  const submitted = await requestJsonRetry(`${root}/v1/videos/${imageMode ? 'image2video' : 'text2video'}`, {
    headers: { Authorization: `Bearer ${signKlingJwt(credentials.accessKey, credentials.secretKey)}` },
    body,
  }, { label: '可灵提交' })
  const taskId = providerTaskId(klingData(submitted).task_id)
  if (!taskId) throw new Error(`可灵未返回 task_id：${String(submitted.message || '')}`)
  await options.onSubmitted?.(taskId)

  const queryUrl = `${root}/v1/videos/${imageMode ? 'image2video' : 'text2video'}/${encodeURIComponent(taskId)}`
  let pollingErrors = 0
  for (let poll = 0; poll < 60; poll += 1) {
    await sleep(5_000)
    let response: JsonObject
    try {
      response = await requestJson(queryUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${signKlingJwt(credentials.accessKey, credentials.secretKey)}` },
      })
    } catch (error: unknown) {
      if (isTransient(error) && ++pollingErrors <= 5) {
        console.warn(`[t2v] 可灵轮询瞬时失败（${errorMessage(error)}），继续等待…`)
        continue
      }
      throw error
    }
    pollingErrors = 0
    const data = klingData(response)
    const status = optionalString(data.task_status)?.toLowerCase()
    if (status === 'succeed') {
      const remoteUrl = klingVideoUrl(response)
      if (!remoteUrl) throw new Error('可灵成功但无视频 url')
      const file = await downloadToLocal(remoteUrl)
      return wrap(taskId, { ...file, remote_url: remoteUrl }, options.seconds)
    }
    if (status === 'failed') throw new Error(`可灵任务失败：${String(data.task_status_msg || 'failed')}`)
  }
  throw new Error('可灵任务轮询超时（>5min）')
}

export async function generate({
  provider,
  model,
  prompt,
  ratio = '16:9',
  imageUrl,
  seconds,
  onSubmitted,
}: T2VGenerateArgs): Promise<T2VResult> {
  const selection = assertSelection({
    provider,
    model,
    modality: 'video',
    requires: imageUrl ? ['image_to_video'] : [],
  })
  const credentials = resolveCredentials(provider)
  if (!credentials) throw new Error(`未知 provider: ${provider}`)
  const options = { imageUrl, seconds, onSubmitted }
  if (credentials.protocol === 'zhipu-video') {
    if (!credentials.apiKey) throw new Error(`${provider} 未配置 API Key`)
    return genCogVideoX(credentials, selection.model, prompt, ratio, options)
  }
  if (credentials.protocol === 'kling') return genKling(credentials, selection.model, prompt, ratio, options)
  throw new Error(`t2vProvider 不支持协议: ${credentials.protocol}`)
}

function invalidResponse(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'INVALID_RESPONSE' })
}

/** Query an existing cloud task. This function never calls a submit endpoint. */
export async function reconcile(
  provider: string,
  providerTaskIdValue: string,
): Promise<ProviderReconciliation<ReconciledVideoResult>> {
  const credentials = resolveCredentials(provider)
  if (!credentials) return { status: 'unknown' }

  if (credentials.protocol === 'zhipu-video') {
    if (!credentials.apiKey) throw new Error(`${provider} 未配置 API Key`)
    const root = credentials.baseUrl.replace(/\/$/, '')
    const response = await requestJson(`${root}/api/paas/v4/async-result/${encodeURIComponent(providerTaskIdValue)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
    })
    const status = optionalString(response.task_status)?.toUpperCase() || ''
    if (['PROCESSING', 'PENDING', 'RUNNING'].includes(status)) return { status: 'running' }
    if (status === 'SUCCESS') {
      const remoteUrl = cogVideoUrl(response)
      if (!remoteUrl) return { status: 'failed', error: normalizeAppError(invalidResponse('Provider 成功响应缺少视频 URL')) }
      const file = await downloadToLocal(remoteUrl)
      return { status: 'succeeded', result: { submit_id: providerTaskIdValue, file_url: file.file_url } }
    }
    if (status === 'FAIL') {
      return { status: 'failed', error: normalizeAppError(new Error(`CogVideoX 任务失败：${String(response.message || 'FAIL')}`)) }
    }
    return { status: 'unknown' }
  }

  if (credentials.protocol === 'kling') {
    if (!credentials.accessKey || !credentials.secretKey) throw new Error('可灵 Kling 需配置 Access Key + Secret Key')
    const root = credentials.baseUrl.replace(/\/$/, '')
    const token = signKlingJwt(credentials.accessKey, credentials.secretKey)
    let response: JsonObject
    try {
      response = await requestJson(`${root}/v1/videos/text2video/${encodeURIComponent(providerTaskIdValue)}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
      })
    } catch (error: unknown) {
      if (!/^404:/.test(errorMessage(error))) throw error
      response = await requestJson(`${root}/v1/videos/image2video/${encodeURIComponent(providerTaskIdValue)}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
      })
    }
    const data = klingData(response)
    const status = optionalString(data.task_status)?.toLowerCase() || ''
    if (['submitted', 'processing', 'running'].includes(status)) return { status: 'running' }
    if (status === 'succeed') {
      const remoteUrl = klingVideoUrl(response)
      if (!remoteUrl) return { status: 'failed', error: normalizeAppError(invalidResponse('Provider 成功响应缺少视频 URL')) }
      const file = await downloadToLocal(remoteUrl)
      return { status: 'succeeded', result: { submit_id: providerTaskIdValue, file_url: file.file_url } }
    }
    if (status === 'failed') {
      return { status: 'failed', error: normalizeAppError(new Error(`可灵任务失败：${String(data.task_status_msg || 'failed')}`)) }
    }
    return { status: 'unknown' }
  }

  return { status: 'unknown' }
}

/**
 * Capability declarations are deliberately independent from credential state.
 * The documented async-video APIs expose task query, but no video-task cancel
 * or access-key account-balance endpoint. A batch cancel endpoint is not a
 * video generation cancel endpoint and must never be reused here.
 */
export function getCapabilities(provider: string): ProviderOperationCapabilities {
  const definition = getProvider(provider)
  if (!definition || definition.kind !== 't2v' || !canHandle(definition.protocol)) {
    return { reconcile: 'unsupported', cancel: 'unsupported', billing: 'unsupported' }
  }
  if (definition.protocol === 'zhipu-video') {
    return { reconcile: 'supported', cancel: 'unsupported', billing: 'unverified' }
  }
  if (definition.protocol === 'kling') {
    return { reconcile: 'supported', cancel: 'unsupported', billing: 'unverified' }
  }
  return { reconcile: 'unsupported', cancel: 'unsupported', billing: 'unsupported' }
}

export async function getBillingStatus(provider: string): Promise<ProviderBillingStatus> {
  const capabilities = getCapabilities(provider)
  return {
    provider,
    capability: capabilities.billing,
    configured: hasCredentials(provider),
    status: 'unknown',
    reason_code: capabilities.billing === 'unsupported'
      ? 'PROVIDER_CAPABILITY_UNSUPPORTED'
      : 'PROVIDER_BILLING_UNVERIFIED',
    checked_at: Date.now(),
    currency: null,
    balance: null,
  }
}

export function getAdapter(provider: string): ProviderAdapter<T2VAdapterInput, T2VResult | ReconciledVideoResult> | undefined {
  const credentials = resolveCredentials(provider)
  if (!credentials || !canHandle(credentials.protocol)) return undefined
  return {
    provider,
    modality: 'video',
    capabilities: getCapabilities(provider),
    async submit(input: T2VAdapterInput, _context: ProviderContext): Promise<ProviderSubmission<T2VResult>> {
      let submittedId: string | undefined
      const result = await generate({
        provider,
        model: input.model,
        prompt: input.prompt,
        ratio: input.ratio,
        imageUrl: input.imageUrl,
        seconds: input.seconds,
        onSubmitted: (id) => { submittedId = id },
      })
      return { status: 'succeeded', providerTaskId: submittedId || result.submit_id, result }
    },
    async reconcile(taskId: string, _context: ProviderContext): Promise<ProviderReconciliation<ReconciledVideoResult>> {
      return reconcile(provider, taskId)
    },
    async cancel(_taskId: string, _context: ProviderContext): Promise<'unsupported'> {
      return 'unsupported'
    },
    async getBillingStatus(_context: ProviderContext): Promise<ProviderBillingStatus> {
      return getBillingStatus(provider)
    },
  }
}

export async function probe({
  provider,
  model,
  ratio = '16:9',
}: {
  provider: string
  model?: string | null
  ratio?: string
}): Promise<{ ok: true; taskId: string }> {
  const selection = assertSelection({ provider, model, modality: 'video' })
  const credentials = resolveCredentials(provider)
  if (!credentials) throw new Error(`未知 provider: ${provider}`)
  const prompt = '一只猫在草地上奔跑，电影感'

  if (credentials.protocol === 'zhipu-video') {
    if (!credentials.apiKey) throw new Error(`${provider} 未配置 API Key`)
    const root = credentials.baseUrl.replace(/\/$/, '')
    const submitted = await requestJson(`${root}/api/paas/v4/videos/generations`, {
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
      body: { model: selection.model, prompt, with_audio: false },
      timeoutMs: 30_000,
    })
    const taskId = providerTaskId(submitted.id) || providerTaskId(submitted.request_id)
    if (!taskId) throw new Error('CogVideoX 未返回任务 id')
    return { ok: true, taskId }
  }

  if (credentials.protocol === 'kling') {
    if (!credentials.accessKey || !credentials.secretKey) throw new Error('可灵需配置 Access Key + Secret Key')
    const root = credentials.baseUrl.replace(/\/$/, '')
    const submitted = await requestJson(`${root}/v1/videos/text2video`, {
      headers: { Authorization: `Bearer ${signKlingJwt(credentials.accessKey, credentials.secretKey)}` },
      body: {
        model_name: selection.model,
        prompt,
        aspect_ratio: aspectFor(ratio),
        duration: '5',
        mode: 'std',
      },
      timeoutMs: 30_000,
    })
    const taskId = providerTaskId(klingData(submitted).task_id)
    if (!taskId) throw new Error(`可灵未返回 task_id：${String(submitted.message || '')}`)
    return { ok: true, taskId }
  }

  throw new Error(`t2vProvider 不支持协议: ${credentials.protocol}`)
}
