import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getDb } from '../db'
import * as config from './config'

const { resolveUploadPath } = require('../utils/fileCleanup') as {
  resolveUploadPath(value: unknown): string | null
}

export interface ExportOptions extends Record<string, unknown> {
  skipExternalExportCopy?: boolean
  skip_external_export_copy?: boolean
  exportDirectory?: string
  export_directory?: string
  setAsDefaultExportDirectory?: boolean
  set_as_default_export_directory?: boolean
}

export interface ExportCopyResult {
  library_directory: string
  library_file_path: string
  external_directory: string
  external_file_path: string
  external_copy_status: 'skipped' | 'success' | 'error'
  export_directory_source: 'library' | 'custom' | 'default'
  saved_as_default_export_directory: boolean
  external_copy_error?: string
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function expandUserPath(input: unknown): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

export function exportLibraryDirectory(): string {
  return path.resolve(String(config.get('uploadDir') || './uploads'), 'videos')
}

export function configuredExternalExportDirectory(): string {
  const saved = String(config.get('export.defaultDirectory') || '').trim()
  return saved ? path.resolve(expandUserPath(saved)) : ''
}

export function ensureWritableDirectory(
  directory: unknown,
  { create = true }: { create?: boolean } = {},
): string {
  const expanded = expandUserPath(directory)
  if (!expanded) throw new Error('导出目录不能为空')
  const target = path.resolve(expanded)
  if (!fs.existsSync(target)) {
    if (!create) throw new Error(`目录不存在: ${target}`)
    fs.mkdirSync(target, { recursive: true })
  }
  if (!fs.statSync(target).isDirectory()) throw new Error(`不是文件夹: ${target}`)
  const probe = path.join(target, `.aigc_export_write_test_${process.pid}_${Date.now()}`)
  fs.writeFileSync(probe, 'ok', { flag: 'wx' })
  fs.unlinkSync(probe)
  return target
}

export function exportLocationInfo(): {
  library_directory: string
  library_url_rule: string
  default_directory: string
  has_custom_default: boolean
} {
  const libraryDirectory = exportLibraryDirectory()
  const defaultDirectory = configuredExternalExportDirectory()
  return {
    library_directory: libraryDirectory,
    library_url_rule: '/uploads/videos/...',
    default_directory: defaultDirectory,
    has_custom_default: Boolean(defaultDirectory),
  }
}

export function requestedExternalExportDirectory(options: ExportOptions = {}): string {
  if (options.skipExternalExportCopy === true || options.skip_external_export_copy === true) return ''
  const explicit = String(options.exportDirectory || options.export_directory || '').trim()
  return explicit ? path.resolve(expandUserPath(explicit)) : configuredExternalExportDirectory()
}

export function preflightExternalExportDirectory(options: ExportOptions = {}): string | null {
  const requested = requestedExternalExportDirectory(options)
  if (!requested) return null
  const target = ensureWritableDirectory(requested, { create: true })
  if (options.setAsDefaultExportDirectory === true || options.set_as_default_export_directory === true) {
    config.set('export.defaultDirectory', target)
  }
  return target
}

export function copyExportToExternal({
  exportId,
  fileUrl,
  options = {},
}: {
  exportId: unknown
  fileUrl: unknown
  options?: ExportOptions
}): ExportCopyResult {
  const sourceAbsolute = resolveUploadPath(fileUrl)
  const result: ExportCopyResult = {
    library_directory: exportLibraryDirectory(),
    library_file_path: sourceAbsolute || '',
    external_directory: '',
    external_file_path: '',
    external_copy_status: 'skipped',
    export_directory_source: 'library',
    saved_as_default_export_directory: false,
  }
  const requested = requestedExternalExportDirectory(options)
  if (!requested) return result

  try {
    const targetDirectory = ensureWritableDirectory(requested, { create: true })
    result.external_directory = targetDirectory
    if (options.setAsDefaultExportDirectory === true || options.set_as_default_export_directory === true) {
      config.set('export.defaultDirectory', targetDirectory)
      result.saved_as_default_export_directory = true
    }
    if (!sourceAbsolute || !fs.existsSync(sourceAbsolute)) throw new Error('成片文件不存在，无法复制到自定义目录')
    const targetPath = path.join(targetDirectory, path.basename(sourceAbsolute))
    fs.copyFileSync(sourceAbsolute, targetPath)
    Object.assign(result, {
      external_file_path: targetPath,
      external_copy_status: 'success',
      export_directory_source: String(options.exportDirectory || options.export_directory || '').trim() ? 'custom' : 'default',
    })
    try {
      getDb().prepare('UPDATE exports SET external_file_path=?, external_directory=?, external_copy_status=? WHERE id=?')
        .run(targetPath, targetDirectory, 'success', exportId)
    } catch { /* 数据库更新失败不撤销已完成的文件复制 */ }
  } catch (cause) {
    Object.assign(result, {
      external_copy_status: 'error',
      external_copy_error: errorMessage(cause),
      external_directory: result.external_directory || requested,
    })
    try {
      getDb().prepare('UPDATE exports SET external_directory=?, external_copy_status=? WHERE id=?')
        .run(requested, 'error', exportId)
    } catch { /* 文件错误仍需返回给调用方 */ }
  }
  return result
}
