import { describe, expect, it } from 'vitest'
import { getModel, listModels, requireModelCapability } from '../src/index.js'

describe('确定性 Model Catalog', () => {
  it('以稳定 ID 和 hash 输出唯一运行目录', () => {
    const first = listModels()
    const second = listModels()
    expect(first).toEqual(second)
    expect(first.map((model) => model.id)).toEqual(['demo-structured-v1', 'demo-frame-v1', 'demo-tone-v1'])
    expect(new Set(first.map((model) => model.contentHash)).size).toBe(first.length)
  })

  it('未知模型、modality 或能力组合 fail fast', () => {
    expect(getModel('demo-frame-v1').limits.maxMediaReferences).toBe(8)
    expect(requireModelCapability({ modelId: 'demo-frame-v1', modality: 'image', features: ['reference-images'] }).providerId).toBe('demo-local')
    expect(() => requireModelCapability({ modelId: 'demo-frame-v1', modality: 'video' })).toThrow('MODEL_CAPABILITY_UNSUPPORTED')
    expect(() => requireModelCapability({ modelId: 'missing-model', modality: 'image' })).toThrow('MODEL_NOT_FOUND')
  })
})
