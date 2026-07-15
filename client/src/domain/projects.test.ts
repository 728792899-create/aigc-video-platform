import { describe, expect, it } from 'vitest'

import {
  parseProjectTimeMs,
  projectAssetHealthLabel,
  projectCoverGradient,
  projectRelativeTime,
  projectStatusLabel,
} from './projects'

const translate = (key: string, values?: Record<string, unknown>) => `${key}:${values?.n ?? ''}`

describe('project view domain', () => {
  it('maps stable status and actionable asset health labels', () => {
    expect(projectStatusLabel('failed', translate)).toBe('projects.statusFailed:')
    expect(projectAssetHealthLabel({
      id: 1,
      name: 'demo',
      asset_health: { status: 'error', issues: [{ level: 'error', code: 'MISSING_IMAGES', message: 'missing' }] },
    }, translate)).toBe('projects.assetMissingImages:')
  })

  it('normalizes SQLite timestamps and keeps relative time deterministic', () => {
    const updated = parseProjectTimeMs('2026-07-14 12:00:00')
    expect(updated).toBe(Date.UTC(2026, 6, 14, 12, 0, 0))
    expect(projectRelativeTime({ id: 1, name: 'demo', updated_at_ms: updated }, translate, updated + 120_000))
      .toBe('projects.minutesAgo:2')
  })

  it('generates deterministic no-network cover gradients', () => {
    expect(projectCoverGradient('same')).toEqual(projectCoverGradient('same'))
    expect(projectCoverGradient('same')).not.toEqual(projectCoverGradient('different'))
  })
})
