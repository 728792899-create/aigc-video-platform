import { describe, expect, it } from 'vitest'

import { EditableStoryboardSchema, ScriptResultSchema } from './script'

describe('script workflow contracts', () => {
  it('normalizes a persisted storyboard row', () => {
    const storyboard = EditableStoryboardSchema.parse({
      id: 7,
      scene_number: '2',
      description: '雨夜街道',
      dialog: '故事开始。',
      duration: '8',
      no_voice: 0,
    })

    expect(storyboard.scene_number).toBe(2)
    expect(storyboard.duration).toBe(8)
    expect(storyboard.no_voice).toBe(false)
  })

  it('rejects malformed generated storyboard output', () => {
    const parsed = ScriptResultSchema.safeParse({
      title: '测试剧本',
      storyboards: [{ scene_number: 1, duration: -1 }],
    })

    expect(parsed.success).toBe(false)
  })

  it('preserves editable provider metadata without trusting unknown fields', () => {
    const result = ScriptResultSchema.parse({
      title: '测试剧本',
      generation: { provider: 'demo', model: 'fixture', untrusted: 'kept-at-boundary' },
      storyboards: [{ scene_number: 1, description: '镜头', dialog: '', duration: 5 }],
    })

    expect(result.generation?.provider).toBe('demo')
    expect(result.storyboards).toHaveLength(1)
  })

  it('accepts the semantic schema version returned by the structured-script service', () => {
    const result = ScriptResultSchema.parse({
      schema_version: '1.0.0',
      prompt_version: 'script-2026-07-14.1',
      title: 'Demo 结构化剧本',
      storyboards: [{ scene_number: 1, description: '开场镜头', dialog: '开始。', duration: 5 }],
    })

    expect(result.schema_version).toBe('1.0.0')
  })
})
