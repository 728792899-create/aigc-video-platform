import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const view = readFileSync(resolve(here, '..', 'components', 'ProjectCard.vue'), 'utf8')

describe('项目卡片可访问入口', () => {
  it('提供明确的打开按钮和 Space 键入口，不依赖点击非语义容器', () => {
    expect(view).toContain('@keydown.space.prevent="$emit(\'open\')"')
    expect(view).toContain('aria-label="打开项目"')
    expect(view).toContain('>打开</el-button>')
  })
})
