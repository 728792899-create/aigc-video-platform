import type { ErrorRequestHandler } from 'express'

import credentialStore = require('../services/credentialStore')
import { AppError, httpStatusForError, normalizeAppError, redactDiagnostic } from '../services/appError'

interface HttpError extends Error {
  status?: number
  statusCode?: number
  type?: string
  code?: string
}

function errorLike(value: unknown): HttpError {
  if (value instanceof Error) return value as HttpError
  return new Error(String(value ?? '服务器内部错误'))
}

function statusFrom(error: HttpError, fallback: number): number {
  const status = Number(error.status || error.statusCode)
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback
}

export const errorHandler: ErrorRequestHandler = (cause, request, response, next) => {
  const error = errorLike(cause)
  const isClientError = error.type === 'entity.parse.failed'
    || error.type === 'entity.too.large'
    || error instanceof SyntaxError
    || /^CORS/.test(error.message)
  const safeMessage = credentialStore.redact(redactDiagnostic(error.message || '服务器内部错误'))
  const explicitStatus = statusFrom(error, isClientError ? 400 : 500)
  const normalized = cause instanceof AppError
    ? cause.payload
    : normalizeAppError(error, {
        correlationId: request.requestId,
        fallbackCode: isClientError ? 'REQUEST_INVALID' : undefined,
      })
  const payload = isClientError
    ? { ...normalized, userMessage: safeMessage, retryable: false }
    : normalized
  const status = error.status || error.statusCode
    ? explicitStatus
    : cause instanceof AppError ? httpStatusForError(payload) : explicitStatus

  if (isClientError) {
    console.warn(`[client-error ${status}] [rid:${request.requestId}] ${request.method} ${request.originalUrl}: ${safeMessage}`)
  } else {
    console.error(`[rid:${request.requestId}]`, credentialStore.redact(redactDiagnostic(error.stack || safeMessage)))
  }
  if (response.headersSent) return next(cause)
  response.status(status).json({
    code: status,
    data: null,
    message: payload.userMessage,
    requestId: request.requestId,
    request_id: request.requestId,
    error: payload,
  })
}
