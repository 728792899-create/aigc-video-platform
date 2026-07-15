import assert from 'node:assert/strict'
import test from 'node:test'

import { TaskManager } from '../services/taskManager'

test('稳定幂等键可以复用最近一次 Provider 子任务，并保留 attempt 血缘', () => {
  const manager = new TaskManager()
  const first = manager.create('video-generation', {
    provider: 'fake-video',
    model: 'fake-v1',
    idempotency_key: 'video-generation:stable-hash',
    attempt: 1,
  })
  manager.succeed(first.id, { file_url: '/uploads/videos/shot-1.mp4' })

  const found = manager.findByIdempotency('video-generation:stable-hash', 'video-generation')
  assert.equal(found?.id, first.id)
  assert.equal(found?.status, 'success')
  assert.equal(found?.attempt, 1)
})

test('同键有多次尝试时返回最新记录，不覆盖失败证据', async () => {
  const manager = new TaskManager()
  const failed = manager.create('video-generation', {
    idempotency_key: 'video-generation:retry-hash',
    attempt: 1,
  })
  manager.fail(failed.id, new Error('第一次失败'))
  await new Promise((resolve) => setTimeout(resolve, 2))
  const retry = manager.create('video-generation', {
    idempotency_key: 'video-generation:retry-hash',
    attempt: 2,
    retry_of: failed.id,
  })

  const found = manager.findByIdempotency('video-generation:retry-hash', 'video-generation')
  assert.equal(found?.id, retry.id)
  assert.equal(manager.get(failed.id)?.status, 'failed')
  assert.equal(retry.parent_task_id, failed.id)
  assert.equal(retry.attempt, 2)
})
