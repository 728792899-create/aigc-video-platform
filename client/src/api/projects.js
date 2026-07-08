/**
 * 项目 API 客户端
 */
import api from './index'

export function listProjects(params = {}) {
  return api.get('/projects', { params }).then((r) => r.data.data)
}

export function getProject(id) {
  return api.get(`/projects/${id}`).then((r) => r.data.data)
}

export function createProject(payload) {
  return api.post('/projects', payload).then((r) => r.data.data)
}

export function updateProject(id, payload) {
  return api.put(`/projects/${id}`, payload).then((r) => r.data.data)
}

export function getProjectAssetHealth(id) {
  return api.get(`/projects/${id}/assets/health`).then((r) => r.data.data)
}

export function getWorkbenchStatus(id) {
  return api.get(`/projects/${id}/workbench-status`).then((r) => r.data.data)
}

export function repairWorkbench(id, payload = {}) {
  return api.post(`/projects/${id}/workbench/repair`, payload).then((r) => r.data.data)
}

export function generateAllProjectImages(id, payload = {}) {
  return api.post(`/projects/${id}/images/generate-all`, payload).then((r) => r.data.data)
}

export function completeProjectCheck(id) {
  return api.post(`/projects/${id}/complete-check`).then((r) => r.data.data)
}

export function getProjectSeries(id) {
  return api.get(`/projects/${id}/series`).then((r) => r.data.data)
}
