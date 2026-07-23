import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop renderer readiness contract', () => {
  it('uses a stable application marker instead of visible heading copy', async () => {
    const desktop = await readFile(resolve(process.cwd(), 'src/main.ts'), 'utf8')
    const studio = await readFile(resolve(process.cwd(), '../studio/src/views/DirectorStudio.vue'), 'utf8')

    expect(studio).toContain('data-desktop-smoke-ready="aigc-director-studio"')
    expect(desktop).toContain("[data-desktop-smoke-ready=\\\"aigc-director-studio\\\"]")
    expect(desktop).toContain("renderReadyMarker !== 'aigc-director-studio'")
    expect(desktop).not.toContain("document.querySelector('h1')")
  })
})
