import { describe, expect, it } from 'vitest'

import { ExportResultSchema, PreviewStoryboardSchema, parseExportResult } from './preview'

describe('preview and export contracts', () => {
  it('normalizes a persisted preview storyboard before it enters the timeline', () => {
    const storyboard = PreviewStoryboardSchema.parse({
      id: 4,
      scene_number: '2',
      description: '雨夜近景',
      dialog: '开始吧。',
      duration: '6',
      transition: undefined,
      audio_words: [{ word: '开始', start: 0, end: 500 }],
    })

    expect(storyboard.scene_number).toBe(2)
    expect(storyboard.duration).toBe(6)
    expect(storyboard.transition).toBe('none')
  })

  it('rejects a malformed export task result instead of announcing success', () => {
    expect(() => parseExportResult('unexpected-provider-response')).toThrow()
  })

  it('accepts an export record with nullable optional paths', () => {
    const result = ExportResultSchema.parse({
      project_id: 9,
      status: 'success',
      file_url: '/uploads/videos/demo.mp4',
      external_file_path: null,
      external_copy_error: null,
      duration: 12.4,
    })

    expect(result.file_url).toBe('/uploads/videos/demo.mp4')
    expect(result.external_file_path).toBeNull()
  })
})
