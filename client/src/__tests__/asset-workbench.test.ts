import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AssetVariantGrid from '../components/assets/AssetVariantGrid.vue'
import type { AssetUnit } from '@aigc-video/contracts'

const unit: AssetUnit = {
  id: 'asset-scene-1',
  asset_type: 'scene',
  name: '雨夜车站',
  scope: 'episode',
  project_id: 7,
  series_id: null,
  selected_variant_id: 'variant-1',
  metadata: {},
  variants: [{
    id: 'variant-1',
    asset_id: 'asset-scene-1',
    revision: 1,
    status: 'active',
    selected: true,
    favorite: false,
    parent_variant_id: null,
    media_reference: {
      kind: 'project_media', media_id: 9, object_key: '', url: '/uploads/images/station.png', mime: 'image/png', content_hash: '',
    },
    provider: 'local-library',
    model: 'managed-media',
    prompt: '雨夜，青色霓虹，广角镜头',
    content_hash: '',
    label: '主视觉 v1',
  }],
}

function wrapper() {
  return mount(AssetVariantGrid, {
    props: {
      unit,
      bindings: [{
        storyboard_id: 11,
        project_id: 7,
        asset_type: 'scene',
        asset_id: unit.id,
        variant_id: 'variant-1',
        revision: 1,
        source_scope: 'episode',
        stale_fields: [],
        stale_sources: [],
        snapshot: { variant_id: 'variant-1' },
      }],
    },
    global: { mocks: { $t: (key: string, values?: { count?: number }) => values?.count == null ? key : `${key}:${values.count}` } },
  })
}

describe('分层资产工作台', () => {
  it('展示稳定 revision、作用域绑定数量与受管媒体预览', () => {
    const view = wrapper()
    expect(view.text()).toContain('主视觉 v1')
    expect(view.text()).toContain('R1')
    expect(view.text()).toContain('assets.boundShots:1')
    expect(view.get('img').attributes('src')).toBe('/uploads/images/station.png')
  })

  it('支持 Enter 选择、B 绑定和 Delete 归档的键盘路径', async () => {
    const view = wrapper()
    const card = view.get('article')
    await card.trigger('keydown', { key: 'Enter' })
    await card.trigger('keydown', { key: 'b' })
    await card.trigger('keydown', { key: 'Delete' })
    expect(view.emitted('select')?.[0]?.[0]).toMatchObject({ id: 'variant-1' })
    expect(view.emitted('bind')?.[0]?.[0]).toMatchObject({ id: 'variant-1' })
    expect(view.emitted('archive')?.[0]?.[0]).toMatchObject({ id: 'variant-1' })
  })

  it('为 Voice 和 Music 空状态提示受管音频而不是图片', () => {
    const audioUnit: AssetUnit = { ...unit, id: 'voice-1', asset_type: 'voice', variants: [], selected_variant_id: null }
    const view = mount(AssetVariantGrid, {
      props: { unit: audioUnit, bindings: [] },
      global: { mocks: { $t: (key: string) => key } },
    })
    expect(view.text()).toContain('assets.noAudioVariantsHint')
    expect(view.text()).not.toContain('assets.noVariantsHint')
  })
})
