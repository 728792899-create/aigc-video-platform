import api from './index'

export function getStoryBible(projectId) {
  return api.get(`/projects/${projectId}/story-bible`).then((r) => r.data.data)
}

export function updateStoryBible(projectId, payload) {
  return api.put(`/projects/${projectId}/story-bible`, payload).then((r) => r.data.data)
}

export function listCharacters(projectId) {
  return api.get(`/projects/${projectId}/characters`).then((r) => r.data.data)
}

export function extractCharacters(projectId, force = false) {
  return api.post(`/projects/${projectId}/characters/extract`, { force }).then((r) => r.data.data)
}

export function autoLockCharacters(projectId) {
  return api.post(`/projects/${projectId}/characters/auto-lock`).then((r) => r.data.data)
}

export function updateCharacter(characterId, payload) {
  return api.put(`/characters/${characterId}`, payload).then((r) => r.data.data)
}

export function lockCharacter(characterId, locked = true) {
  return api.post(`/characters/${characterId}/lock`, { locked }).then((r) => r.data.data)
}

export function addCharacterReference(characterId, payload) {
  return api.post(`/characters/${characterId}/reference-images`, payload).then((r) => r.data.data)
}

export function continueProject(projectId, payload = {}) {
  return api.post(`/projects/${projectId}/continue`, payload).then((r) => r.data.data)
}

export function checkContinuity(projectId, payload = {}) {
  return api.post(`/projects/${projectId}/continuity/check`, payload).then((r) => r.data.data)
}

export function repairContinuity(projectId, payload = {}) {
  return api.post(`/projects/${projectId}/continuity/repair`, payload).then((r) => r.data.data)
}
