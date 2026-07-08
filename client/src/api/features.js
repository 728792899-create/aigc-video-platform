/**
 * 新功能 API 客户端（成片库 / 字幕 / 批量 / 时长建议 / 预设 / 快照 / 配音试听）
 */
import api from './index'
import { API_URL } from './config'

// ===== ① 成片库 =====
export function listLibrary() {
  return api.get('/video/library').then((r) => r.data.data)
}
export function deleteExport(id) {
  return api.delete(`/video/exports/${id}`).then((r) => r.data)
}
export function projectExports(projectId) {
  return api.get(`/video/exports/${projectId}`).then((r) => r.data.data)
}

export function getExportLocation() {
  return api.get('/video/export-location').then((r) => r.data.data)
}

export function getProjectTimeline(projectId, { videoSpeed = 1 } = {}) {
  return api.get(`/projects/${projectId}/timeline`, { params: { videoSpeed } }).then((r) => r.data.data)
}

export function rebuildProjectTimeline(projectId, { videoSpeed = 1 } = {}) {
  return api.post(`/projects/${projectId}/timeline/rebuild`, { videoSpeed }).then((r) => r.data.data)
}

// ===== ② 字幕 SRT 下载 =====
export function srtDownloadUrl(projectId) {
  return `${API_URL}/subtitle/project/${projectId}/download`
}

// ===== ③ 分镜批量操作 =====
export function batchUpdateStoryboards(ids, patch) {
  return api.post('/storyboards/batch-update', { ids, patch }).then((r) => r.data)
}

// ===== ④ 智能时长建议 =====
export function suggestDuration(projectId, { apply = false, speed = 1.0 } = {}) {
  return api.get(`/storyboards/suggest-duration/${projectId}`, { params: { apply, speed } }).then((r) => r.data.data)
}

// ===== ⑤ 成片模板/预设 =====
export function listPresets() {
  return api.get('/presets').then((r) => r.data.data)
}
export function createPreset(payload) {
  return api.post('/presets', payload).then((r) => r.data.data)
}
export function updatePreset(id, payload) {
  return api.put(`/presets/${id}`, payload).then((r) => r.data.data)
}
export function deletePreset(id) {
  return api.delete(`/presets/${id}`).then((r) => r.data)
}

// ===== ⑥ 草稿快照 =====
export function listSnapshots(projectId) {
  return api.get(`/snapshots/project/${projectId}`).then((r) => r.data.data)
}
export function createSnapshot(projectId, label) {
  return api.post(`/snapshots/project/${projectId}`, { label }).then((r) => r.data.data)
}
export function restoreSnapshot(id) {
  return api.post(`/snapshots/${id}/restore`).then((r) => r.data)
}
export function deleteSnapshot(id) {
  return api.delete(`/snapshots/${id}`).then((r) => r.data)
}

// ===== ⑦ 配音音色 + 试听 =====
export function listVoices() {
  return api.get('/ai/voices').then((r) => r.data.data)
}
export function voicePreview({ voice, speed, pitch, text, emotion, volume } = {}) {
  return api.post('/ai/voice-preview', { voice, speed, pitch, text, emotion, volume }).then((r) => r.data.data)
}
