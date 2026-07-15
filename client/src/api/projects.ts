import { ProjectSchema, type ApiEnvelope, type Project } from '@aigc-video/contracts'

import api, { unwrap } from './index'
import { ProjectViewSchema, type ProjectView } from '../domain/projects'

export type ProjectId = number | string
export type JsonObject = Record<string, unknown>

export async function listProjects(params: JsonObject = {}): Promise<ProjectView[]> {
  return ProjectViewSchema.array().parse(unwrap(await api.get<ApiEnvelope<ProjectView[]>>('/projects', { params })))
}

export async function getProject(id: ProjectId): Promise<Project> {
  return ProjectSchema.parse(unwrap(await api.get<ApiEnvelope<Project>>(`/projects/${encodeURIComponent(id)}`)))
}

export async function createProject(payload: JsonObject): Promise<Project> {
  return ProjectSchema.parse(unwrap(await api.post<ApiEnvelope<Project>>('/projects', payload)))
}

export async function updateProject(id: ProjectId, payload: JsonObject): Promise<Project> {
  return ProjectSchema.parse(unwrap(await api.put<ApiEnvelope<Project>>(`/projects/${encodeURIComponent(id)}`, payload)))
}

async function getRecord(path: string): Promise<JsonObject> {
  return unwrap(await api.get<ApiEnvelope<JsonObject>>(path))
}

async function postRecord(path: string, payload: JsonObject = {}): Promise<JsonObject> {
  return unwrap(await api.post<ApiEnvelope<JsonObject>>(path, payload))
}

export function getProjectAssetHealth(id: ProjectId) { return getRecord(`/projects/${encodeURIComponent(id)}/assets/health`) }
export function getWorkbenchStatus(id: ProjectId) { return getRecord(`/projects/${encodeURIComponent(id)}/workbench-status`) }
export function repairWorkbench(id: ProjectId, payload: JsonObject = {}) { return postRecord(`/projects/${encodeURIComponent(id)}/workbench/repair`, payload) }
export function generateAllProjectImages(id: ProjectId, payload: JsonObject = {}) { return postRecord(`/projects/${encodeURIComponent(id)}/images/generate-all`, payload) }
export function completeProjectCheck(id: ProjectId) { return postRecord(`/projects/${encodeURIComponent(id)}/complete-check`) }
export function getProjectSeries(id: ProjectId) { return getRecord(`/projects/${encodeURIComponent(id)}/series`) }
