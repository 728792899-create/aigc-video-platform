import { randomUUID } from 'node:crypto'

import type { AssetScope, AssetType, MediaReference } from '@aigc-video/contracts'

export type AssetId = string | number

export interface AssetUnitRow {
  id: AssetId
  asset_type: AssetType
  legacy_entity_id: number | null
  name: string
  scope: AssetScope
  scope_id: number | null
  project_id: number | null
  series_id: number | null
  forked_from_unit_id?: AssetId | null
  forked_from_variant_id?: AssetId | null
  metadata: Record<string, unknown>
  status: 'active' | 'archived'
  selected_variant_id: AssetId | null
  created_at: number
  updated_at: number
}

export interface AssetVariantRow {
  id: AssetId
  variant_key: string
  asset_type: AssetType
  asset_id: AssetId
  project_id: number | null
  label: string
  revision: number
  status: 'active' | 'archived'
  selected: number
  favorite: number
  archived_at: number | null
  provider: string
  model: string
  prompt: string
  parent_variant_id: AssetId | null
  media_reference: MediaReference
  content_hash: string
  created_at: number
  updated_at: number
}

export interface AssetBindingRow {
  id?: number
  storyboard_id: number
  project_id: number | null
  asset_type: AssetType
  asset_id: AssetId
  asset_unit_id: string
  variant_id: AssetId
  variant_key: string
  revision: number
  source_scope: AssetScope
  stale_fields?: string[]
  stale_sources?: string[]
  snapshot: Record<string, unknown>
  created_at: number
  updated_at: number
}

export interface AssetRepository {
  getUnit(type: AssetType, id: AssetId): AssetUnitRow | null
  listVariants(type: AssetType, id: AssetId): AssetVariantRow[]
  getVariant(id: AssetId): AssetVariantRow | null
  insertVariant(row: AssetVariantRow): AssetVariantRow
  selectVariant(type: AssetType, assetId: AssetId, variantId: AssetId, updatedAt: number): AssetVariantRow
  upsertBinding(row: AssetBindingRow): AssetBindingRow
  bindingsForVariant(variantId: AssetId): AssetBindingRow[]
  bindingsForStoryboards?(storyboardIds: number[]): AssetBindingRow[]
  archiveVariant(id: AssetId, archivedAt: number): AssetVariantRow
  transaction<T>(operation: () => T): T
  createUnit?(row: AssetUnitRow): AssetUnitRow
  listApplicableUnits?(projectId: number, seriesId: number | null): AssetUnitRow[]
}

export interface AssetLibraryService {
  createUnit(input?: Record<string, unknown>): AssetUnitRow
  listResolvedProject(projectId: number, seriesId?: number | null): AssetUnitRow[]
  addVariant(input?: Record<string, unknown>): AssetVariantRow
  selectVariant(input?: Record<string, unknown>): AssetVariantRow
  bindVariant(input?: Record<string, unknown>): AssetBindingRow
  batchBindVariant(input?: Record<string, unknown>): {
    changed_storyboard_ids: number[]
    skipped_storyboard_ids: number[]
    conflicts: Array<{ storyboard_id: number; code: string; message: string }>
  }
  forkUnit(input?: Record<string, unknown>): { unit: AssetUnitRow; variant: AssetVariantRow }
  archiveVariant(variantId: AssetId): AssetVariantRow
  normalizeMediaReference(input?: Record<string, unknown>): MediaReference
}

export class AssetDomainError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'AssetDomainError'
    this.code = code
    this.details = details
  }
}

export const ASSET_TYPES = new Set<AssetType>(['character', 'scene', 'prop', 'style', 'voice', 'music'])
const MEDIA_KINDS = new Set<MediaReference['kind']>(['project_media', 'local_file', 'object_key', 'public_url'])
const SCOPES = new Set<AssetScope>(['episode', 'series', 'global'])

function domainError(code: string, message: string, details: Record<string, unknown> = {}): AssetDomainError {
  return new AssetDomainError(code, message, details)
}

function cleanText(value: unknown, max = 1000): string {
  return String(value || '').trim().slice(0, max)
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function assetType(value: unknown): AssetType {
  const normalized = cleanText(value, 40) as AssetType
  if (!ASSET_TYPES.has(normalized)) throw domainError('ASSET_TYPE_UNSUPPORTED', `不支持的资产类型: ${normalized}`)
  return normalized
}

function assetScope(value: unknown, fallback: AssetScope = 'episode'): AssetScope {
  const normalized = value === 'project' ? 'episode' : cleanText(value || fallback, 40)
  if (!SCOPES.has(normalized as AssetScope)) throw domainError('ASSET_SCOPE_INVALID', `不支持的资产作用域: ${normalized}`)
  return normalized as AssetScope
}

function sanitizeUrl(value: unknown): string {
  const raw = cleanText(value, 4096)
  if (!raw) return ''
  if (raw.startsWith('/')) return raw.split(/[?#]/, 1)[0] || ''
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw domainError('MEDIA_REFERENCE_INVALID', '媒体 URL 格式无效') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw domainError('MEDIA_REFERENCE_INVALID', '媒体 URL 只允许无凭据的 HTTP/HTTPS 地址')
  }
  return `${parsed.origin}${parsed.pathname}`
}

export function normalizeMediaReference(input: Record<string, unknown> = {}): MediaReference {
  const kind = cleanText(input.kind || 'project_media', 40) as MediaReference['kind']
  if (!MEDIA_KINDS.has(kind)) throw domainError('MEDIA_REFERENCE_INVALID', `不支持的媒体引用类型: ${kind}`)
  const reference: MediaReference = {
    kind,
    media_id: numberOrNull(input.media_id),
    object_key: cleanText(input.object_key, 1024),
    url: sanitizeUrl(input.url || input.file_url),
    mime: cleanText(input.mime, 120),
    content_hash: cleanText(input.content_hash, 128),
  }
  if ((kind === 'project_media' || kind === 'local_file') && reference.url && !reference.url.startsWith('/uploads/')) {
    throw domainError('MEDIA_REFERENCE_INVALID', '本地媒体必须位于受管 uploads 目录')
  }
  if ((kind === 'project_media' || kind === 'local_file') && reference.url) {
    let decoded = reference.url
    try { decoded = decodeURIComponent(decoded) } catch { /* invalid encoding stays unsafe below */ }
    if (decoded.includes('\\') || decoded.split('/').some((part) => part === '..' || part === '.')) {
      throw domainError('MEDIA_REFERENCE_INVALID', '本地媒体路径不得包含穿越片段')
    }
  }
  if (kind === 'public_url' && reference.url && !/^https?:\/\//.test(reference.url)) {
    throw domainError('MEDIA_REFERENCE_INVALID', '公开媒体引用必须使用 HTTP/HTTPS URL')
  }
  if (reference.object_key && (
    reference.object_key.startsWith('/')
    || reference.object_key.includes('\\')
    || reference.object_key.split('/').some((part) => part === '..' || part === '.')
  )) {
    throw domainError('MEDIA_REFERENCE_INVALID', '对象键不得包含绝对路径或穿越片段')
  }
  if (!reference.media_id && !reference.object_key && !reference.url) {
    throw domainError('MEDIA_REFERENCE_INVALID', '媒体引用至少需要 media_id、object_key 或 url')
  }
  return reference
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stableUnitId(value: unknown): AssetId {
  const text = cleanText(value, 200)
  if (!text) throw domainError('ASSET_ID_INVALID', '资产 ID 不能为空')
  return /^\d+$/.test(text) ? Number(text) : text
}

export function createAssetLibraryService({
  repository,
  now = Date.now,
  idFactory = randomUUID,
}: {
  repository: AssetRepository
  now?: () => number
  idFactory?: () => string
}): AssetLibraryService {
  if (!repository) throw new Error('asset repository is required')

  function assertUnit(type: AssetType, id: AssetId): AssetUnitRow {
    const unit = repository.getUnit(type, id)
    if (!unit) throw domainError('ASSET_NOT_FOUND', '资产不存在', { assetType: type, assetId: id })
    return unit
  }

  function createUnit(input: Record<string, unknown> = {}): AssetUnitRow {
    if (!repository.createUnit) throw domainError('ASSET_CREATE_UNAVAILABLE', '当前存储不支持创建通用资产')
    const type = assetType(input.assetType || input.asset_type)
    if (type === 'character') throw domainError('ASSET_USE_CHARACTER_API', '角色资产请继续使用兼容角色接口创建')
    const scope = assetScope(input.scope)
    const projectId = numberOrNull(input.projectId ?? input.project_id)
    const seriesId = numberOrNull(input.seriesId ?? input.series_id)
    if (scope === 'episode' && !projectId) throw domainError('ASSET_SCOPE_INVALID', 'Episode 资产必须指定 project_id')
    if (scope === 'series' && !seriesId) throw domainError('ASSET_SCOPE_INVALID', 'Series 资产必须指定 series_id')
    const timestamp = Number(now())
    const id = `asset-${cleanText(idFactory(), 128)}`
    return repository.createUnit({
      id,
      asset_type: type,
      legacy_entity_id: null,
      name: cleanText(input.name, 200) || '未命名资产',
      scope,
      scope_id: scope === 'episode' ? projectId : scope === 'series' ? seriesId : null,
      project_id: projectId,
      series_id: seriesId,
      forked_from_unit_id: input.forkedFromUnitId ? stableUnitId(input.forkedFromUnitId) : null,
      forked_from_variant_id: input.forkedFromVariantId ? stableUnitId(input.forkedFromVariantId) : null,
      metadata: record(input.metadata),
      status: 'active',
      selected_variant_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    })
  }

  function listResolvedProject(projectId: number, seriesId: number | null = null): AssetUnitRow[] {
    if (!repository.listApplicableUnits) return []
    const rank: Record<AssetScope, number> = { episode: 3, series: 2, global: 1 }
    const selected = new Map<string, AssetUnitRow>()
    for (const unit of repository.listApplicableUnits(projectId, seriesId)) {
      const key = `${unit.asset_type}:${unit.name.trim().toLocaleLowerCase()}`
      const current = selected.get(key)
      if (!current || rank[unit.scope] > rank[current.scope]) selected.set(key, unit)
    }
    return Array.from(selected.values()).sort((left, right) => (
      right.scope.localeCompare(left.scope) || left.asset_type.localeCompare(right.asset_type) || left.name.localeCompare(right.name)
    ))
  }

  function addVariant(input: Record<string, unknown> = {}): AssetVariantRow {
    const type = assetType(input.assetType || input.asset_type)
    const id = stableUnitId(input.assetId ?? input.asset_id)
    assertUnit(type, id)
    const existing = repository.listVariants(type, id)
    let parentId: AssetId | null = null
    if (input.parentVariantId || input.parent_variant_id) {
      const candidate = stableUnitId(input.parentVariantId || input.parent_variant_id)
      const parent = repository.getVariant(candidate)
      if (!parent || parent.asset_type !== type || String(parent.asset_id) !== String(id)) {
        throw domainError('ASSET_VARIANT_PARENT_INVALID', '父 Variant 不属于当前资产')
      }
      parentId = parent.id
    }
    const timestamp = Number(now())
    const revision = existing.reduce((max, row) => Math.max(max, Number(row.revision) || 0), 0) + 1
    const variantKey = `variant-${cleanText(idFactory(), 128)}`
    const mediaInput = record(input.mediaReference || input.media_reference)
    const row: AssetVariantRow = {
      id: variantKey,
      variant_key: variantKey,
      asset_type: type,
      asset_id: id,
      project_id: numberOrNull(input.projectId ?? input.project_id),
      label: cleanText(input.label || `Revision ${revision}`, 200),
      revision,
      status: 'active',
      selected: existing.some((item) => Number(item.selected) === 1) ? 0 : 1,
      favorite: input.favorite === true ? 1 : 0,
      archived_at: null,
      provider: cleanText(input.provider, 80),
      model: cleanText(input.model, 160),
      prompt: cleanText(input.prompt, 12000),
      parent_variant_id: parentId,
      media_reference: normalizeMediaReference(mediaInput),
      content_hash: cleanText(input.contentHash || input.content_hash || mediaInput.content_hash, 128),
      created_at: timestamp,
      updated_at: timestamp,
    }
    return repository.insertVariant(row)
  }

  function selectVariant(input: Record<string, unknown> = {}): AssetVariantRow {
    const type = assetType(input.assetType || input.asset_type)
    const id = stableUnitId(input.assetId ?? input.asset_id)
    assertUnit(type, id)
    const variantId = stableUnitId(input.variantId ?? input.variant_id)
    const variant = repository.getVariant(variantId)
    if (!variant || variant.asset_type !== type || String(variant.asset_id) !== String(id) || variant.status === 'archived') {
      throw domainError('ASSET_VARIANT_INVALID', 'Variant 不存在、已归档或不属于当前资产')
    }
    return repository.transaction(() => repository.selectVariant(type, id, variant.id, Number(now())))
  }

  function bindingRow(input: Record<string, unknown> = {}): AssetBindingRow {
    const type = assetType(input.assetType || input.asset_type)
    const id = stableUnitId(input.assetId ?? input.asset_id)
    const unit = assertUnit(type, id)
    const variantId = stableUnitId(input.variantId ?? input.variant_id)
    const variant = repository.getVariant(variantId)
    if (!variant || variant.asset_type !== type || String(variant.asset_id) !== String(id) || variant.status === 'archived') {
      throw domainError('ASSET_VARIANT_INVALID', '无法绑定不存在、已归档或不匹配的 Variant')
    }
    const snapshot = {
      asset_type: type,
      asset_id: id,
      asset_name: cleanText(unit.name, 200),
      variant_id: variant.id,
      variant_key: variant.variant_key,
      revision: variant.revision,
      media_reference: variant.media_reference,
      provider: variant.provider,
      model: variant.model,
      content_hash: variant.content_hash,
      source_scope: unit.scope,
    }
    const timestamp = Number(now())
    return {
      storyboard_id: Number(input.storyboardId ?? input.storyboard_id),
      project_id: numberOrNull(input.projectId ?? input.project_id ?? unit.project_id ?? variant.project_id),
      asset_type: type,
      // Character 继续使用旧数字 ID 保持 API/唯一键兼容；通用资产使用稳定字符串 ID，
      // 不把仅用于旧表迁移的负数 surrogate 泄漏到领域绑定。
      asset_id: type === 'character' ? (unit.legacy_entity_id ?? id) : id,
      asset_unit_id: type === 'character' ? `legacy-character-${id}` : String(unit.id),
      variant_id: variant.id,
      variant_key: variant.variant_key,
      revision: variant.revision,
      source_scope: assetScope(input.sourceScope || input.source_scope, unit.scope),
      stale_fields: [],
      stale_sources: [],
      snapshot,
      created_at: timestamp,
      updated_at: timestamp,
    }
  }

  function bindVariant(input: Record<string, unknown> = {}): AssetBindingRow {
    const row = bindingRow(input)
    if (!Number.isInteger(row.storyboard_id) || row.storyboard_id <= 0) {
      throw domainError('ASSET_BINDING_TARGET_INVALID', '镜头 ID 无效')
    }
    return repository.transaction(() => repository.upsertBinding(row))
  }

  function batchBindVariant(input: Record<string, unknown> = {}) {
    const rawIds = input.storyboardIds ?? input.storyboard_ids
    const ids = Array.from(new Set((Array.isArray(rawIds) ? rawIds : []).map(Number)))
    const conflicts = ids.filter((id) => !Number.isInteger(id) || id <= 0)
      .map((storyboard_id) => ({ storyboard_id, code: 'ASSET_BINDING_TARGET_INVALID', message: '镜头 ID 无效' }))
    const validIds = ids.filter((id) => Number.isInteger(id) && id > 0)
    if (!validIds.length) throw domainError('ASSET_BINDING_TARGET_INVALID', '至少选择一个有效镜头')
    const base = bindingRow({ ...input, storyboardId: validIds[0] })
    const existing = repository.bindingsForStoryboards?.(validIds) || []
    const current = new Map(existing
      .filter((row) => row.asset_unit_id === base.asset_unit_id)
      .map((row) => [row.storyboard_id, row]))
    const changed: number[] = []
    const skipped: number[] = []
    repository.transaction(() => {
      for (const storyboardId of validIds) {
        const previous = current.get(storyboardId)
        if (previous?.variant_key === base.variant_key && previous.revision === base.revision) {
          skipped.push(storyboardId)
          continue
        }
        repository.upsertBinding({ ...base, storyboard_id: storyboardId })
        changed.push(storyboardId)
      }
    })
    return { changed_storyboard_ids: changed, skipped_storyboard_ids: skipped, conflicts }
  }

  function forkUnit(input: Record<string, unknown> = {}): { unit: AssetUnitRow; variant: AssetVariantRow } {
    const type = assetType(input.assetType || input.asset_type)
    const sourceId = stableUnitId(input.assetId ?? input.asset_id)
    const source = assertUnit(type, sourceId)
    if (source.scope !== 'series') throw domainError('ASSET_FORK_SCOPE_INVALID', '只有 Series 资产可以 fork 为 Episode 资产')
    const projectId = numberOrNull(input.projectId ?? input.project_id)
    const seriesId = numberOrNull(input.seriesId ?? input.series_id)
    if (!projectId || !seriesId || source.series_id !== seriesId) {
      throw domainError('ASSET_FORK_TARGET_INVALID', 'fork 目标项目必须属于来源 Series')
    }
    const variants = repository.listVariants(type, sourceId).filter((row) => row.status === 'active')
    const requested = input.variantId ?? input.variant_id
    const sourceVariant = requested
      ? variants.find((row) => String(row.id) === String(requested))
      : variants.find((row) => row.selected === 1) || variants.at(-1)
    if (!sourceVariant) throw domainError('ASSET_VARIANT_NOT_FOUND', 'Series 资产没有可 fork 的 Variant')
    return repository.transaction(() => {
      const unit = createUnit({
        assetType: type, name: source.name, scope: 'episode', projectId, seriesId,
        metadata: { ...source.metadata, lineage: { source_scope: 'series', source_unit_id: source.id } },
        forkedFromUnitId: source.id, forkedFromVariantId: sourceVariant.id,
      })
      const variant = addVariant({
        assetType: type, assetId: unit.id, projectId, label: sourceVariant.label,
        provider: sourceVariant.provider, model: sourceVariant.model, prompt: sourceVariant.prompt,
        contentHash: sourceVariant.content_hash, mediaReference: sourceVariant.media_reference,
      })
      return { unit: { ...unit, selected_variant_id: variant.id }, variant }
    })
  }

  function archiveVariant(variantId: AssetId): AssetVariantRow {
    const variant = repository.getVariant(variantId)
    if (!variant) throw domainError('ASSET_VARIANT_NOT_FOUND', 'Variant 不存在')
    const bindings = repository.bindingsForVariant(variant.id)
    if (variant.selected === 1 || bindings.length) {
      throw domainError('ASSET_VARIANT_IN_USE', 'Variant 正在被选中或被镜头引用，请先选择替代版本并重新绑定', {
        selected: variant.selected === 1,
        storyboard_ids: bindings.map((row) => row.storyboard_id),
      })
    }
    return repository.archiveVariant(variant.id, Number(now()))
  }

  return { createUnit, listResolvedProject, addVariant, selectVariant, bindVariant, batchBindVariant, forkUnit, archiveVariant, normalizeMediaReference }
}
