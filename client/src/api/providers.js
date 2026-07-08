/**
 * 模型 Provider API 客户端（升级方案 v3 第一期）
 */
import api from './index'

// 列出全部 provider（按 kind 分组：llm/t2i/t2v/tts）
export function getProviders() {
  return api.get('/providers').then((r) => r.data.data)
}

export function getProviderHealth() {
  return api.get('/providers/health').then((r) => r.data.data)
}

// 读各阶段模型路由
export function getStageModels() {
  return api.get('/providers/stage-models').then((r) => r.data.data)
}

// 保存各阶段模型路由（patch 语义）
export function saveStageModels(patch) {
  return api.post('/providers/stage-models', patch).then((r) => r.data)
}

// 保存某 provider 凭证（脱敏占位会被后端忽略）
export function saveCredentials(payload) {
  return api.post('/providers/credentials', payload).then((r) => r.data)
}

// 连通性测试 { provider, model }
export function testProvider(payload) {
  return api.post('/providers/test', payload).then((r) => r.data.data)
}

// 清空用量统计
export function resetUsage() {
  return api.post('/providers/usage/reset').then((r) => r.data)
}
