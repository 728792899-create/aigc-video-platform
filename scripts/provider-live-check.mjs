#!/usr/bin/env node
import crypto from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`缺少 ${name}`)
  return value
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

if (process.env.AIGC_LIVE_PROVIDER_VERIFY !== '1') {
  throw new Error('安全门禁：必须显式设置 AIGC_LIVE_PROVIDER_VERIFY=1')
}
if (['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase())) {
  throw new Error('Demo Mode 不执行线上 Provider 验证')
}

const provider = required('AIGC_LIVE_PROVIDER')
const providerTaskId = required('AIGC_PROVIDER_TASK_ID')
const modulePath = path.resolve('server/dist/services/t2vProvider.js')
const api = await import(pathToFileURL(modulePath).href)
const startedAt = Date.now()
const reconciliation = await api.reconcile(provider, providerTaskId)
const billing = await api.getBillingStatus(provider)
const output = {
  provider,
  provider_task_hash: hash(providerTaskId),
  correlation_id: `live-${hash(`${provider}:${providerTaskId}:${startedAt}`)}`,
  checked_at: new Date(startedAt).toISOString(),
  reconciliation_status: reconciliation.status,
  billing_capability: billing.capability,
  billing_status: billing.status,
  cancel_status: 'not_requested',
}

if (process.env.AIGC_ALLOW_REMOTE_CANCEL === '1') {
  if (process.env.AIGC_CONFIRM_REMOTE_CANCEL !== 'YES') {
    throw new Error('远程 cancel 会改变任务状态；请同时设置 AIGC_CONFIRM_REMOTE_CANCEL=YES')
  }
  const adapter = api.getAdapter(provider)
  output.cancel_status = adapter?.cancel
    ? await adapter.cancel(providerTaskId, { correlationId: output.correlation_id, idempotencyKey: output.correlation_id })
    : 'unsupported'
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
