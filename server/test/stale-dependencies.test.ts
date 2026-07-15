import assert from 'node:assert/strict'
import test from 'node:test'

import { changedStoryboardFields, staleImpactForFields } from '../services/staleDependencies'

test('字段级 diff 只返回真实变化字段并稳定处理 JSON 数组', () => {
  const before = {
    description: '远景', dialog: '你好', duration: 5, prompt: 'blue hour', voice: 'narrator-a',
    characters_in_scene: '[{"id":1}]',
  }
  const after = {
    ...before, dialog: '你好，世界', duration: 7, characters_in_scene: [{ id: 1 }],
  }
  assert.deepEqual(changedStoryboardFields(before, after), ['dialog', 'duration'])
})

test('字段依赖传播区分视觉、配音与装配阶段', () => {
  assert.deepEqual(staleImpactForFields(['prompt']), ['image', 'video', 'timeline', 'export'])
  assert.deepEqual(staleImpactForFields(['dialog', 'voice']), ['voice', 'subtitle', 'timeline', 'export'])
  assert.deepEqual(staleImpactForFields(['duration', 'music']), ['subtitle', 'timeline', 'export'])
  assert.deepEqual(
    staleImpactForFields(['description', 'dialog', 'transition']),
    ['image', 'video', 'voice', 'subtitle', 'timeline', 'export'],
  )
})
