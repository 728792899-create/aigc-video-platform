import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AppErrorPayloadSchema,
  AssetBindingUpdateSchema,
  AssetUnitCreateSchema,
  AssetVariantSchema,
  DirectorAdvicePlanSchema,
  GenerationTaskSchema,
  MediaReferenceSchema,
  ScriptDocumentSchema,
  StudioLayoutUpdateSchema,
  TaskRealtimeEventSchema,
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

test('分层资产契约兼容旧数字 ID，并拒绝没有名称或非法媒体引用的写入', () => {
  assert.equal(AssetVariantSchema.safeParse({
    id: 12,
    asset_id: 4,
    revision: 1,
    status: 'active',
    selected: true,
    favorite: false,
    media_reference: { kind: 'project_media', media_id: 9, url: '/uploads/images/demo.png' },
  }).success, true)
  assert.equal(AssetUnitCreateSchema.safeParse({ asset_type: 'scene', name: '  ', scope: 'episode' }).success, false)
  assert.equal(AssetBindingUpdateSchema.safeParse({
    asset_type: 'prop', asset_id: 'asset-prop', variant_id: 'variant-1', source_scope: 'series',
  }).success, true)
  assert.equal(AssetBindingUpdateSchema.safeParse({
    asset_type: 'prop', asset_id: '', variant_id: 'variant-1', source_scope: 'project',
  }).success, false)
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

test('Studio 布局契约只接受稳定阶段节点与有限坐标', () => {
  const valid = StudioLayoutUpdateSchema.safeParse({
    schema_version: 1,
    base_revision: 2,
    positions: {
      'project:12:topic': { x: 20, y: 30 },
      'project:12:script': { x: 380.5, y: -40 },
    },
  })
  assert.equal(valid.success, true)
  assert.equal(StudioLayoutUpdateSchema.safeParse({
    schema_version: 1,
    positions: { 'arbitrary-user-node': { x: 0, y: 0 } },
  }).success, false)
  assert.equal(StudioLayoutUpdateSchema.safeParse({
    schema_version: 1,
    positions: { 'project:12:topic': { x: Number.POSITIVE_INFINITY, y: 0 } },
  }).success, false)
  assert.equal(StudioLayoutUpdateSchema.safeParse({
    schema_version: 1,
    positions: { 'project:12:topic': { x: 100_001, y: 0 } },
  }).success, false)
})

test('实时任务事件仍通过 GenerationTask 契约，不信任 Socket payload', () => {
  const base = {
    id: 'task-live-1', type: 'image-batch', status: 'running', progress: 30, message: '生成中',
    result: null, created_at: 1, updated_at: 2,
  }
  assert.equal(TaskRealtimeEventSchema.safeParse({ type: 'task.changed', task: base }).success, true)
  assert.equal(TaskRealtimeEventSchema.safeParse({
    type: 'task.changed', task: { ...base, progress: 300, status: 'invented' },
  }).success, false)
})

test('Director Advisor 只返回可审查的白名单动作，不接受任意代码或外部 URL', () => {
  const base = {
    schema_version: 1,
    plan_id: 'director:0123456789abcdef',
    project_id: 12,
    generated_at: 10,
    health_score: 40,
    summary: '建议先完成结构化剧本。',
    evidence: {
      shots: 0, selected_visuals: 0, voiced_shots: 0, subtitled_shots: 0,
      asset_units: 0, active_skills: 2, failed_tasks: 0, running_tasks: 0, exports: 0,
    },
    actions: [{
      id: 'advice:edit-script', stage: 'script', operation: 'edit-script',
      title: '完成剧本', reason: '还没有可用剧本', route: '/projects/12/script',
      priority: 90, risk: 'none', requires_confirmation: false,
    }],
    next_action_id: 'advice:edit-script',
  }
  assert.equal(DirectorAdvicePlanSchema.safeParse(base).success, true)
  assert.equal(DirectorAdvicePlanSchema.safeParse({
    ...base,
    actions: [{ ...base.actions[0], operation: 'execute-code', route: 'https://evil.example' }],
  }).success, false)
})
