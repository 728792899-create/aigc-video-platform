import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const view = readFileSync(resolve(here, '..', 'views', 'Images.vue'), 'utf8')
const api = readFileSync(resolve(here, '..', 'api', 'assets.ts'), 'utf8')
const imagesApi = readFileSync(resolve(here, '..', 'api', 'images.ts'), 'utf8')

describe('画面候选与资产 Variant 工作台契约', () => {
  it('选图使用独立 Candidate API，不把整个分镜对象回写覆盖', () => {
    expect(api).toContain('`/images/${encodeURIComponent(candidateId)}/select`')
    expect(view).toContain('const storyboard = selectedStoryboard.value')
    expect(view).toContain('await selectCandidate(img.id, storyboard.id)')
    expect(view).not.toContain('...selectedStoryboard.value,\n      selected_image_id: img.id')
  })

  it('支持稳定 Variant 绑定、作用域提示和候选历史归档', () => {
    expect(api).toContain('/assets/storyboards/${encodeURIComponent(storyboardId)}/bindings')
    expect(view).toContain('source_scope: assetUnitFor(character.id)?.scope')
    expect(imagesApi).toContain("include_archived: includeArchived ? 'true' : undefined")
    expect(view).toContain("reviewCandidate(img.id, { archived:")
  })

  it('候选卡支持焦点、Enter 选用与 F 收藏', () => {
    expect(view).toContain('tabindex="0"')
    expect(view).toContain('@keydown.enter.prevent="selectImage(img)"')
    expect(view).toContain('@keydown.f.prevent="toggleFavorite(img)"')
    expect(view).toContain(':aria-selected=')
  })

  it('分镜列表可由键盘和桌面辅助技术选择', () => {
    expect(view).toContain('role="button"')
    expect(view).toContain(':aria-pressed="selectedStoryboard?.id === sb.id"')
    expect(view).toContain('@keydown.enter.prevent="selectStoryboard(sb)"')
    expect(view).toContain('@keydown.space.prevent="selectStoryboard(sb)"')
  })
})
