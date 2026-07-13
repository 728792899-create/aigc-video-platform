'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { getDb } = require('../db');
const { resolveUploadPath } = require('../utils/fileCleanup');

function expandUserPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function exportLibraryDirectory() { return path.resolve(config.get('uploadDir'), 'videos'); }
function configuredExternalExportDirectory() {
  const saved = String(config.get('export.defaultDirectory') || '').trim();
  return saved ? path.resolve(expandUserPath(saved)) : '';
}

function ensureWritableDirectory(dir, { create = true } = {}) {
  const target = path.resolve(expandUserPath(dir));
  if (!target) throw new Error('导出目录不能为空');
  if (!fs.existsSync(target)) {
    if (!create) throw new Error(`目录不存在: ${target}`);
    fs.mkdirSync(target, { recursive: true });
  }
  if (!fs.statSync(target).isDirectory()) throw new Error(`不是文件夹: ${target}`);
  const probe = path.join(target, `.aigc_export_write_test_${process.pid}_${Date.now()}`);
  fs.writeFileSync(probe, 'ok', { flag: 'wx' });
  fs.unlinkSync(probe);
  return target;
}

function exportLocationInfo() {
  const libraryDirectory = exportLibraryDirectory();
  const defaultDirectory = configuredExternalExportDirectory();
  return { library_directory: libraryDirectory, library_url_rule: '/uploads/videos/...', default_directory: defaultDirectory, has_custom_default: !!defaultDirectory };
}

function requestedExternalExportDirectory(options = {}) {
  if (options.skipExternalExportCopy === true || options.skip_external_export_copy === true) return '';
  const explicit = String(options.exportDirectory || options.export_directory || '').trim();
  return explicit ? path.resolve(expandUserPath(explicit)) : configuredExternalExportDirectory();
}

function preflightExternalExportDirectory(options = {}) {
  const requested = requestedExternalExportDirectory(options);
  if (!requested) return null;
  const target = ensureWritableDirectory(requested, { create: true });
  if (options.setAsDefaultExportDirectory === true || options.set_as_default_export_directory === true) config.set('export.defaultDirectory', target);
  return target;
}

function copyExportToExternal({ exportId, fileUrl, options = {} }) {
  const sourceAbs = resolveUploadPath(fileUrl);
  const result = { library_directory: exportLibraryDirectory(), library_file_path: sourceAbs || '', external_directory: '', external_file_path: '', external_copy_status: 'skipped', export_directory_source: 'library', saved_as_default_export_directory: false };
  const requested = requestedExternalExportDirectory(options);
  if (!requested) return result;
  try {
    const targetDir = ensureWritableDirectory(requested, { create: true });
    result.external_directory = targetDir;
    if (options.setAsDefaultExportDirectory === true || options.set_as_default_export_directory === true) {
      config.set('export.defaultDirectory', targetDir);
      result.saved_as_default_export_directory = true;
    }
    if (!sourceAbs || !fs.existsSync(sourceAbs)) throw new Error('成片文件不存在，无法复制到自定义目录');
    const targetPath = path.join(targetDir, path.basename(sourceAbs));
    fs.copyFileSync(sourceAbs, targetPath);
    Object.assign(result, { external_file_path: targetPath, external_copy_status: 'success', export_directory_source: String(options.exportDirectory || options.export_directory || '').trim() ? 'custom' : 'default' });
    try { getDb().prepare('UPDATE exports SET external_file_path=?, external_directory=?, external_copy_status=? WHERE id=?').run(targetPath, targetDir, 'success', exportId); } catch {}
  } catch (error) {
    Object.assign(result, { external_copy_status: 'error', external_copy_error: error.message, external_directory: result.external_directory || requested });
    try { getDb().prepare('UPDATE exports SET external_directory=?, external_copy_status=? WHERE id=?').run(requested, 'error', exportId); } catch {}
  }
  return result;
}

module.exports = { exportLibraryDirectory, configuredExternalExportDirectory, ensureWritableDirectory, exportLocationInfo, requestedExternalExportDirectory, preflightExternalExportDirectory, copyExportToExternal };
