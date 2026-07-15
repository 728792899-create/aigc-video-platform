import assert from 'node:assert/strict'
import test from 'node:test'

import { getBillingStatus, getCapabilities } from '../services/t2vProvider'

test('智谱与可灵只声明官方可确认的 Provider 能力', () => {
  assert.deepEqual(getCapabilities('cogvideo'), {
    reconcile: 'supported', cancel: 'unsupported', billing: 'unverified',
  })
  assert.deepEqual(getCapabilities('kling'), {
    reconcile: 'supported', cancel: 'unsupported', billing: 'unverified',
  })
  assert.deepEqual(getCapabilities('unknown-provider'), {
    reconcile: 'unsupported', cancel: 'unsupported', billing: 'unsupported',
  })
})

test('无密钥账单状态查询零网络、不伪造余额', async () => {
  const status = await getBillingStatus('kling')
  assert.equal(status.capability, 'unverified')
  assert.equal(status.status, 'unknown')
  assert.equal(status.reason_code, 'PROVIDER_BILLING_UNVERIFIED')
  assert.equal(status.balance, null)
  assert.equal(status.currency, null)
})
