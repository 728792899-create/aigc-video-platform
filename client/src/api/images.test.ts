import { describe, expect, it } from 'vitest'

import { BatchImageResultSchema, ImageCandidateSchema, ImageGenerationResultSchema } from './images'

describe('image workflow contracts', () => {
  it('normalizes candidate review flags returned by SQLite', () => {
    const candidate = ImageCandidateSchema.parse({
      id: 9,
      storyboard_id: 3,
      file_url: '/uploads/images/demo.png',
      favorite: 1,
      stale: 0,
    })

    expect(candidate.favorite).toBe(true)
    expect(candidate.stale).toBe(false)
  })

  it('rejects an unstructured task result instead of treating it as success', () => {
    expect(ImageGenerationResultSchema.safeParse(null).success).toBe(false)
  })

  it('keeps partial batch failures available for stage retry', () => {
    const result = BatchImageResultSchema.parse({
      successes: [{ storyboard_id: 1 }],
      failures: [{ storyboard_id: 2, diagnosis: { reason: 'DEMO_FAILURE' } }],
    })

    expect(result.successes).toHaveLength(1)
    expect(result.failures[0]?.diagnosis?.reason).toBe('DEMO_FAILURE')
  })
})
