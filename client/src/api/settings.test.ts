import { describe, expect, it } from 'vitest'

import { BackupEnvelopeSchema, ProviderHealthItemSchema, SettingsDataSchema } from './settings'

describe('settings response contracts', () => {
  it('applies safe defaults to partial legacy settings', () => {
    const parsed = SettingsDataSchema.parse({ uploadDir: './legacy-uploads' })

    expect(parsed.uploadDir).toBe('./legacy-uploads')
    expect(parsed.pollinations.timeout).toBe(20_000)
    expect(parsed.pacing.tightPace).toBe(true)
  })

  it('rejects a malformed backup before restore', () => {
    const parsed = BackupEnvelopeSchema.safeParse({
      magic: 'AIGC_BACKUP',
      version: 1,
      createdAt: Date.now(),
      config: {},
      secretsIncluded: false,
      db: '',
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts a redacted provider health item', () => {
    const parsed = ProviderHealthItemSchema.parse({
      key: 'demo',
      label: 'Demo Provider',
      kind: 't2i',
      status: 'ok',
      message: '本地演示模式',
      configured: true,
      last_error: '',
    })

    expect(parsed.configured).toBe(true)
    expect(parsed.last_error).toBe('')
  })
})
