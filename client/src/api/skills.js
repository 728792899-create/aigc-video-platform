import api from './index'

// 创作技能库 API（功能⑦）
export async function listSkills(stage, enabledOnly = false) {
  const params = {}
  if (stage) params.stage = stage
  if (enabledOnly) params.enabled_only = 1
  const res = await api.get('/skills', { params })
  return res.data?.data || []
}

export async function getSkill(id) {
  const res = await api.get(`/skills/${id}`)
  return res.data?.data
}

export async function createSkill(payload) {
  const res = await api.post('/skills', payload)
  return res.data?.data
}

export async function updateSkill(id, payload) {
  const res = await api.put(`/skills/${id}`, payload)
  return res.data?.data
}

export async function deleteSkill(id) {
  const res = await api.delete(`/skills/${id}`)
  return res.data
}

export async function restoreBuiltinSkills() {
  const res = await api.post('/skills/restore-builtins')
  return res.data?.data
}

export async function listSkillVersions(id) {
  const res = await api.get(`/skills/${id}/versions`)
  return res.data?.data || []
}

export async function restoreSkillVersion(id, versionId) {
  const res = await api.post(`/skills/${id}/versions/${versionId}/restore`)
  return res.data?.data
}

export async function importSkills(list) {
  const res = await api.post('/skills/import', list)
  return res.data?.data
}

// 列出当前会自动生效的必用技能（供创作页透明展示）
export async function listActiveSkills(stage) {
  const params = {}
  if (stage) params.stage = stage
  const res = await api.get('/skills/active', { params })
  return res.data?.data || []
}
