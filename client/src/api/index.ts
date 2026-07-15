import type { ApiEnvelope, AppErrorPayload } from '@aigc-video/contracts'
import axios, { AxiosHeaders, type AxiosError, type AxiosResponse } from 'axios'

import { API_URL } from './config'

export type ApiResponse<T> = AxiosResponse<ApiEnvelope<T>>

export class AigcClientError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status?: number
  readonly details?: AppErrorPayload

  constructor(message: string, options: {
    code?: string
    retryable?: boolean
    status?: number
    details?: AppErrorPayload
    cause?: unknown
  } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AigcClientError'
    this.code = options.code || 'CLIENT_ERROR'
    this.retryable = options.retryable === true
    this.status = options.status
    this.details = options.details
  }
}

export function unwrap<T>(response: ApiResponse<T>): T {
  return response.data.data
}

function normalizeAxiosError(cause: unknown): AigcClientError {
  if (!axios.isAxiosError(cause)) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return new AigcClientError(message, { cause })
  }
  const error = cause as AxiosError<Partial<ApiEnvelope<unknown>>>
  const status = error.response?.status
  const backendError = error.response?.data?.error
  const backendMessage = error.response?.data?.message
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
    return new AigcClientError('请求超时，服务器响应较慢，请稍后重试', {
      code: backendError?.code || 'NETWORK_TIMEOUT', retryable: true, status, details: backendError, cause,
    })
  }
  if (error.message === 'Network Error' || !error.response) {
    return new AigcClientError('无法连接到服务器，请确认后端服务是否已启动', {
      code: 'NETWORK_UNAVAILABLE', retryable: true, cause,
    })
  }
  let message = backendMessage || error.message
  if (status === 404) message = backendMessage || '请求的资源不存在'
  else if (status === 413) message = '上传内容过大，请压缩后重试'
  else if (status === 429) message = backendMessage || '请求过于频繁，请稍后再试'
  else if (status && status >= 500) message = backendMessage || '服务器内部错误，请稍后重试'
  return new AigcClientError(message, {
    code: backendError?.code || `HTTP_${status || 'ERROR'}`,
    retryable: backendError?.retryable === true || status === 429 || Boolean(status && status >= 500),
    status,
    details: backendError,
    cause,
  })
}

const api = axios.create({ baseURL: API_URL, timeout: 120_000 })

api.interceptors.request.use((request) => {
  // VITE_API_TOKEN 保留为远程部署兼容入口；桌面构建与 CI 不设置该变量。
  // Provider API Key 从不通过 Vite 环境变量进入前端。
  const apiToken = import.meta.env.VITE_API_TOKEN
  if (apiToken) request.headers.set('Authorization', `Bearer ${apiToken}`)
  const generationMutation = request.url === '/ai/auto-produce'
    || request.url === '/ai/generate-script'
    || request.url === '/ai/expand-dialog'
    || request.url === '/ai/optimize-theme'
    || request.url === '/ai/generate-image'
    || /^\/ai\/auto-produce\/[^/]+\/retry$/.test(request.url || '')
    || /^\/tasks\/[^/]+\/retry-(stage|failed)$/.test(request.url || '')
    || /^\/history\/[^/]+\/retry$/.test(request.url || '')
  const headers = AxiosHeaders.from(request.headers)
  if (request.method === 'post' && generationMutation && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', crypto.randomUUID())
  }
  request.headers = headers
  return request
}, (cause: unknown) => Promise.reject(normalizeAxiosError(cause)))

api.interceptors.response.use(
  (response) => response,
  (cause: unknown) => Promise.reject(normalizeAxiosError(cause)),
)

export default api
