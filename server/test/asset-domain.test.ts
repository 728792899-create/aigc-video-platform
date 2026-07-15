import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAssetLibraryService,
  normalizeMediaReference,
  type AssetBindingRow,
  type AssetRepository,
  type AssetUnitRow,
  type AssetVariantRow,
} from '../services/assetDomain'

interface MemoryRepository extends AssetRepository {
  units: AssetUnitRow[]
  variants: AssetVariantRow[]
  bindings: AssetBindingRow[]
}

function assetRepository(): MemoryRepository {
  const units: AssetUnitRow[] = [{
    id: 7,
    asset_type: 'character',
    legacy_entity_id: 7,
    project_id: 3,
    series_id: 2,
    scope: 'episode',
    scope_id: 3,
    name: '创作者',
    metadata: {},
    status: 'active',
    selected_variant_id: null,
    created_at: 1,
    updated_at: 1,
  }]
  const variants: AssetVariantRow[] = []
  const bindings: AssetBindingRow[] = []
  const repository: MemoryRepository = {
    units,
    variants,
    bindings,
    getUnit(type, id) {
      return units.find((row) => row.asset_type === type && String(row.id) === String(id)) || null
    },
    listVariants(type, id) {
      return variants.filter((row) => row.asset_type === type && String(row.asset_id) === String(id))
    },
    getVariant(id) { return variants.find((row) => String(row.id) === String(id)) || null },
    insertVariant(row) { variants.push({ ...row }); return { ...row } },
    selectVariant(type, assetId, variantId, updatedAt) {
      variants.filter((row) => row.asset_type === type && String(row.asset_id) === String(assetId))
        .forEach((row) => { row.selected = String(row.id) === String(variantId) ? 1 : 0; row.updated_at = updatedAt })
      const selected = this.getVariant(variantId)
      if (!selected) throw new Error('test variant missing')
      return selected
    },
    upsertBinding(row) {
      const current = bindings.find((item) => item.storyboard_id === row.storyboard_id && item.asset_unit_id === row.asset_unit_id)
      if (current) Object.assign(current, row)
      else bindings.push({ ...row })
      return { ...(current || row) }
    },
    bindingsForVariant(variantId) { return bindings.filter((row) => String(row.variant_id) === String(variantId)) },
    archiveVariant(id, archivedAt) {
      const row = this.getVariant(id)
      if (!row) throw new Error('test variant missing')
      row.status = 'archived'
      row.archived_at = archivedAt
      return { ...row }
    },
    transaction<T>(operation: () => T): T { return operation() },
    createUnit(row) {
      const created = { ...row, legacy_entity_id: -(units.length + 1) }
      units.push(created)
      return created
    },
    listApplicableUnits(projectId, seriesId) {
      return units.filter((unit) => (
        unit.scope === 'global'
        || (unit.scope === 'series' && unit.series_id === seriesId)
        || (unit.scope === 'episode' && unit.project_id === projectId)
      ))
    },
  }
  return repository
}

test('角色 Variant 递增 revision、首个自动选中，Binding 保存不可变引用快照', () => {
  const repository = assetRepository()
  let id = 0
  const service = createAssetLibraryService({ repository, now: () => 1000 + id, idFactory: () => `variant-${++id}` })
  const first = service.addVariant({
    assetType: 'character', assetId: 7, projectId: 3, label: '正面定妆',
    mediaReference: { kind: 'project_media', media_id: 91, url: '/uploads/images/face.png?secret=remove' },
    provider: 'demo', model: 'placeholder', prompt: 'consistent creator',
  })
  const second = service.addVariant({
    assetType: 'character', assetId: 7, projectId: 3, label: '雨夜服装',
    mediaReference: { kind: 'project_media', media_id: 92, url: '/uploads/images/rain.png' },
    parentVariantId: first.id,
  })

  assert.equal(first.revision, 1)
  assert.equal(first.selected, 1)
  assert.equal(first.media_reference.url, '/uploads/images/face.png')
  assert.equal(second.revision, 2)
  assert.equal(second.selected, 0)
  assert.equal(second.parent_variant_id, first.id)

  service.selectVariant({ assetType: 'character', assetId: 7, variantId: second.id })
  const binding = service.bindVariant({ storyboardId: 11, assetType: 'character', assetId: 7, variantId: second.id, sourceScope: 'series' })
  assert.equal(binding.variant_id, second.id)
  assert.equal(binding.revision, 2)
  assert.equal(binding.snapshot.variant_key, second.variant_key)
  assert.equal((binding.snapshot.media_reference as { url?: string }).url, '/uploads/images/rain.png')
  assert.equal(repository.getVariant(first.id)?.selected, 0)
})

test('正在被镜头引用或当前选中的 Variant 只能归档前先改绑', () => {
  const repository = assetRepository()
  let id = 0
  const service = createAssetLibraryService({ repository, idFactory: () => `v-${++id}` })
  const first = service.addVariant({ assetType: 'character', assetId: 7, mediaReference: { kind: 'project_media', media_id: 1, url: '/uploads/images/a.png' } })
  const second = service.addVariant({ assetType: 'character', assetId: 7, mediaReference: { kind: 'project_media', media_id: 2, url: '/uploads/images/b.png' } })
  service.selectVariant({ assetType: 'character', assetId: 7, variantId: second.id })
  service.bindVariant({ storyboardId: 11, assetType: 'character', assetId: 7, variantId: second.id })
  assert.throws(() => service.archiveVariant(second.id), { name: 'AssetDomainError' })
  assert.doesNotThrow(() => service.archiveVariant(first.id))
})

test('Episode > Series > Global 按同名同类型解析，并保留不同资产类型', () => {
  const repository = assetRepository()
  let id = 0
  const service = createAssetLibraryService({ repository, idFactory: () => `scope-${++id}` })
  service.createUnit({ assetType: 'style', name: '水墨', scope: 'global' })
  service.createUnit({ assetType: 'style', name: '水墨', scope: 'series', seriesId: 2 })
  const episode = service.createUnit({ assetType: 'style', name: '水墨', scope: 'episode', projectId: 3, seriesId: 2 })
  const prop = service.createUnit({ assetType: 'prop', name: '铜铃', scope: 'series', seriesId: 2 })

  const resolved = service.listResolvedProject(3, 2)
  assert.equal(resolved.find((unit) => unit.asset_type === 'style')?.id, episode.id)
  assert.equal(resolved.find((unit) => unit.asset_type === 'prop')?.id, prop.id)
  assert.equal(resolved.filter((unit) => unit.asset_type === 'style').length, 1)
})

test('MediaReference 拒绝越界路径、对象键穿越，并移除签名查询参数', () => {
  assert.throws(() => normalizeMediaReference({ kind: 'project_media', url: '/etc/passwd' }), { name: 'AssetDomainError' })
  assert.throws(() => normalizeMediaReference({ kind: 'object_key', object_key: '../private/secret.png' }), { name: 'AssetDomainError' })
  assert.deepEqual(
    normalizeMediaReference({ kind: 'project_media', media_id: 9, url: '/uploads/images/a.png?signature=secret' }),
    { kind: 'project_media', media_id: 9, object_key: '', url: '/uploads/images/a.png', mime: '', content_hash: '' },
  )
  assert.deepEqual(
    normalizeMediaReference({ kind: 'public_url', url: 'https://cdn.example.test/images/a.png?signature=secret#frame' }),
    { kind: 'public_url', media_id: null, object_key: '', url: 'https://cdn.example.test/images/a.png', mime: '', content_hash: '' },
  )
})
