import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AppErrorPayloadSchema,
  GenerationTaskSchema,
  MediaReferenceSchema,
  ScriptDocumentSchema,
} from '../src/index.ts'

test('统一错误契约拒绝缺少可重试语义的非结构化错误', () => {
  assert.equal(AppErrorPayloadSchema.safeParse({ code: 'TIMEOUT', userMessage: '请重试' }).success, false)
  assert.equal(AppErrorPayloadSchema.safeParse({
    code: 'PROVIDER_TIMEOUT',
    userMessage: '生成服务响应超时，请稍后重试',
    technicalMessage: 'provider request exceeded 60s',
    retryable: true,
    correlationId: 'rid-contract-1',
    timestamp: 1,
  }).success, true)
})

test('结构化剧本与媒体引用在跨进程边界执行 runtime validation', () => {
  assert.equal(ScriptDocumentSchema.safeParse({
    schema_version: '1.0.0',
    title: '测试短片',
    scenes: [],
    prompt_version: 'script-v1',
  }).success, false)
  assert.equal(ScriptDocumentSchema.safeParse({
    schema_version: 1,
    title: '错误版本类型',
    scenes: [{ id: 1, title: '开场', shots: [{ id: 1 }] }],
    prompt_version: 'script-v1',
  }).success, false)
  assert.equal(MediaReferenceSchema.safeParse({ kind: 'absolute_path', url: '/Users/private/file.png' }).success, false)
})

test('GenerationTask 保留现有状态名并补齐对账字段默认值', () => {
  const task = GenerationTaskSchema.parse({
    id: 'task-contract-1',
    type: 'video',
    status: 'pending',
    progress: 0,
    message: '任务已创建',
    result: null,
    created_at: 1,
    updated_at: 1,
  })
  assert.equal(task.attempt, 1)
  assert.equal(task.retryable, false)
  assert.equal(task.cancel_state, 'none')
  assert.deepEqual(task.media_snapshot, [])
})
