'use strict';

import { getDb, type SqlRow } from '../db'
import type { AssetScope, AssetType } from '@aigc-video/contracts'
import {
  ASSET_TYPES,
  normalizeMediaReference,
  createAssetLibraryService,
  type AssetBindingRow,
  type AssetId,
  type AssetRepository,
  type AssetUnitRow,
  type AssetVariantRow,
} from './assetDomain'

function json(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value));
  try {
    const parsed: unknown = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : fallback;
  } catch { return fallback; }
}

function entityId(value: unknown): AssetId {
  return typeof value === 'number' ? value : String(value || '')
}

function assetType(value: unknown): AssetType {
  const match = [...ASSET_TYPES].find((type) => type === value)
  return match || 'character'
}

function assetScope(value: unknown): AssetScope {
  const scopes: readonly AssetScope[] = ['episode', 'series', 'global']
  return scopes.find((scope) => scope === value) || 'global'
}

function mapUnit(row: SqlRow | undefined): AssetUnitRow | null {
  if (!row) return null;
  return {
    id: entityId(row.id),
    asset_type: assetType(row.asset_type),
    legacy_entity_id: row.legacy_entity_id == null ? null : Number(row.legacy_entity_id),
    name: String(row.name || ''),
    scope: assetScope(row.scope),
    scope_id: row.scope_id == null ? null : Number(row.scope_id),
    project_id: row.project_id == null ? null : Number(row.project_id),
    series_id: row.series_id == null ? null : Number(row.series_id),
    metadata: json(row.metadata, {}),
    status: row.status === 'archived' ? 'archived' : 'active',
    selected_variant_id: row.selected_variant_id ? String(row.selected_variant_id) : null,
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
  };
}

function normalizeVariant(row: SqlRow | undefined, unit: AssetUnitRow | null = null): AssetVariantRow | null {
  if (!row) return null;
  const legacyReference = json(row.media_reference, {
    kind: 'project_media', media_id: row.image_id, url: row.file_url || row.file_path,
  });
  if (legacyReference?.kind === 'project_media' && /^https?:\/\//i.test(String(legacyReference.url || ''))) {
    legacyReference.kind = 'public_url';
  }
  const isGeneric = Boolean(row.asset_unit_id);
  const owner = unit || (isGeneric
    ? mapUnit(getDb().prepare('SELECT * FROM asset_units WHERE id = ?').get(row.asset_unit_id))
    : null);
  return {
    id: isGeneric ? String(row.id) : entityId(row.id),
    variant_key: String(row.variant_key || row.id),
    asset_type: owner?.asset_type || assetType(row.asset_type),
    asset_id: owner?.id || entityId(row.asset_id || row.character_id),
    project_id: owner?.project_id || (row.project_id == null ? null : Number(row.project_id)),
    label: String(row.label || ''),
    revision: Number(row.revision) || 1,
    status: row.status === 'archived' ? 'archived' : 'active',
    selected: Number(row.selected) || 0,
    favorite: Number(row.favorite) || 0,
    archived_at: row.archived_at == null ? null : Number(row.archived_at),
    provider: String(row.provider || ''),
    model: String(row.model || ''),
    prompt: String(row.prompt || ''),
    parent_variant_id: row.parent_variant_id ? entityId(row.parent_variant_id) : null,
    media_reference: normalizeMediaReference(legacyReference),
    content_hash: String(row.content_hash || ''),
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
  };
}

export function databaseRepository(): AssetRepository {
  function genericUnit(type: AssetType, id: AssetId): AssetUnitRow | null {
    return mapUnit(getDb().prepare(
      'SELECT * FROM asset_units WHERE id = ? AND asset_type = ? AND status = ?'
    ).get(String(id), type, 'active'));
  }

  function getUnit(type: AssetType, id: AssetId): AssetUnitRow | null {
    if (type !== 'character') return genericUnit(type, id);
    const row = getDb().prepare('SELECT * FROM characters WHERE id = ? AND COALESCE(deleted_at, 0) = 0').get(id);
    if (!row) return null;
    const scope: AssetScope = row.project_id ? 'episode' : row.series_id ? 'series' : 'global';
    return {
      id: Number(row.id),
      asset_type: 'character',
      legacy_entity_id: Number(row.id),
      name: String(row.name || `Character ${row.id}`),
      scope,
      scope_id: Number(row.project_id || row.series_id) || null,
      project_id: Number(row.project_id) || null,
      series_id: Number(row.series_id) || null,
      metadata: {},
      status: 'active',
      selected_variant_id: null,
      created_at: Number(row.created_at) || 0,
      updated_at: Number(row.updated_at) || Number(row.created_at) || 0,
    };
  }

  function getVariant(id: AssetId): AssetVariantRow | null {
    const generic = getDb().prepare('SELECT * FROM asset_variants WHERE id = ?').get(String(id));
    if (generic) return normalizeVariant(generic);
    const legacy = getDb().prepare(`SELECT ca.*, 'character' AS asset_type, ca.character_id AS asset_id
      FROM character_assets ca WHERE ca.id = ? OR ca.variant_key = ?`).get(id, String(id));
    return normalizeVariant(legacy);
  }

  const repository: AssetRepository = {
    getUnit,
    listVariants(type, id) {
      if (type === 'character') {
        return getDb().prepare(`SELECT ca.*, 'character' AS asset_type, ca.character_id AS asset_id
          FROM character_assets ca WHERE ca.character_id = ? ORDER BY ca.revision ASC, ca.id ASC`).all(id)
          .map((row) => normalizeVariant(row)).filter((row): row is AssetVariantRow => row !== null);
      }
      const unit = genericUnit(type, id);
      if (!unit) return [];
      return getDb().prepare('SELECT * FROM asset_variants WHERE asset_unit_id = ? ORDER BY revision, created_at').all(String(id))
        .map((row) => normalizeVariant(row, unit)).filter((row): row is AssetVariantRow => row !== null);
    },
    getVariant,
    insertVariant(row) {
      if (row.asset_type === 'character') {
        const media = row.media_reference;
        const result = getDb().prepare(`INSERT INTO character_assets
          (character_id, project_id, image_id, file_url, file_path, kind, label, variant_key, revision, status,
           selected, favorite, archived_at, provider, model, prompt, parent_variant_id, media_reference,
           content_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.asset_id, row.project_id, media.media_id, media.url, media.url, 'variant', row.label,
            row.variant_key, row.revision, row.status, row.selected, row.favorite, row.archived_at,
            row.provider, row.model, row.prompt, row.parent_variant_id, JSON.stringify(media),
            row.content_hash, row.created_at, row.updated_at);
        const inserted = getVariant(entityId(result.lastInsertRowid));
        if (!inserted) throw new Error('角色 Variant 保存后无法读取');
        return inserted;
      }
      getDb().prepare(`INSERT INTO asset_variants
        (id, asset_unit_id, revision, label, status, selected, favorite, parent_variant_id, provider, model,
         prompt, media_reference, content_hash, archived_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(String(row.id), String(row.asset_id), row.revision, row.label, row.status, row.selected, row.favorite,
          row.parent_variant_id, row.provider, row.model, row.prompt, JSON.stringify(row.media_reference),
          row.content_hash, row.archived_at, row.created_at, row.updated_at);
      if (row.selected === 1) {
        getDb().prepare('UPDATE asset_units SET selected_variant_id = ?, updated_at = ? WHERE id = ?')
          .run(String(row.id), row.updated_at, String(row.asset_id));
      }
      const inserted = getVariant(row.id);
      if (!inserted) throw new Error('Variant 保存后无法读取');
      return inserted;
    },
    selectVariant(type, assetId, variantId, updatedAt) {
      if (type === 'character') {
        getDb().prepare('UPDATE character_assets SET selected = 0, updated_at = ? WHERE character_id = ?').run(updatedAt, assetId);
        getDb().prepare('UPDATE character_assets SET selected = 1, updated_at = ? WHERE id = ? OR variant_key = ?')
          .run(updatedAt, variantId, String(variantId));
      } else {
        getDb().prepare('UPDATE asset_variants SET selected = 0, updated_at = ? WHERE asset_unit_id = ?').run(updatedAt, String(assetId));
        getDb().prepare('UPDATE asset_variants SET selected = 1, updated_at = ? WHERE id = ?').run(updatedAt, String(variantId));
        getDb().prepare('UPDATE asset_units SET selected_variant_id = ?, updated_at = ? WHERE id = ?')
          .run(String(variantId), updatedAt, String(assetId));
      }
      const selected = getVariant(variantId);
      if (!selected) throw new Error('Variant 选择后无法读取');
      return selected;
    },
    upsertBinding(row) {
      const existing = getDb().prepare(`SELECT id FROM storyboard_asset_bindings
        WHERE storyboard_id = ? AND asset_unit_id = ?`).get(row.storyboard_id, row.asset_unit_id);
      if (existing) {
        getDb().prepare(`UPDATE storyboard_asset_bindings
          SET project_id=?, asset_type=?, asset_id=?, variant_id=?, asset_unit_id=?, variant_key=?, revision=?,
              source_scope=?, snapshot=?, updated_at=? WHERE id=?`)
          .run(row.project_id, row.asset_type, row.asset_id, row.variant_id, row.asset_unit_id, row.variant_key,
            row.revision, row.source_scope, JSON.stringify(row.snapshot), row.updated_at, existing.id);
        return { ...row, id: Number(existing.id) };
      }
      const result = getDb().prepare(`INSERT INTO storyboard_asset_bindings
        (storyboard_id, project_id, asset_type, asset_id, variant_id, revision, source_scope, snapshot,
         created_at, updated_at, asset_unit_id, variant_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.storyboard_id, row.project_id, row.asset_type, row.asset_id, row.variant_id, row.revision,
          row.source_scope, JSON.stringify(row.snapshot), row.created_at, row.updated_at,
          row.asset_unit_id, row.variant_key);
      return { ...row, id: Number(result.lastInsertRowid) };
    },
    bindingsForVariant(variantId) {
      return getDb().prepare('SELECT * FROM storyboard_asset_bindings WHERE variant_key = ? OR variant_id = ?')
        .all(String(variantId), variantId).map((row): AssetBindingRow => ({
          id: Number(row.id),
          storyboard_id: Number(row.storyboard_id),
          project_id: row.project_id == null ? null : Number(row.project_id),
          asset_type: assetType(row.asset_type),
          asset_id: entityId(row.asset_id),
          asset_unit_id: String(row.asset_unit_id || ''),
          variant_id: entityId(row.variant_id),
          variant_key: String(row.variant_key || row.variant_id || ''),
          revision: Number(row.revision) || 1,
          source_scope: assetScope(row.source_scope),
          snapshot: json(row.snapshot, {}),
          created_at: Number(row.created_at) || 0,
          updated_at: Number(row.updated_at) || 0,
        }));
    },
    archiveVariant(id, archivedAt) {
      const generic = getDb().prepare('SELECT id FROM asset_variants WHERE id = ?').get(String(id));
      if (generic) {
        getDb().prepare("UPDATE asset_variants SET status='archived', archived_at=?, updated_at=? WHERE id=?")
          .run(archivedAt, archivedAt, String(id));
      } else {
        getDb().prepare("UPDATE character_assets SET status='archived', archived_at=?, updated_at=? WHERE id=? OR variant_key=?")
          .run(archivedAt, archivedAt, id, String(id));
      }
      const archived = getVariant(id);
      if (!archived) throw new Error('Variant 归档后无法读取');
      return archived;
    },
    transaction(operation) { return getDb().transaction(operation)(); },
    createUnit(row) {
      const min = getDb().prepare('SELECT MIN(legacy_entity_id) AS n FROM asset_units WHERE legacy_entity_id < 0').get();
      const surrogate = Math.min(-1, Number(min?.n || 0) - 1);
      getDb().prepare(`INSERT INTO asset_units
        (id, asset_type, legacy_entity_id, name, scope, scope_id, project_id, series_id, metadata, status,
         selected_variant_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(String(row.id), row.asset_type, surrogate, row.name, row.scope, row.scope_id, row.project_id,
          row.series_id, JSON.stringify(row.metadata), row.status, null, row.created_at, row.updated_at);
      const created = genericUnit(row.asset_type, row.id);
      if (!created) throw new Error('资产保存后无法读取');
      return created;
    },
    listApplicableUnits(projectId, seriesId) {
      const rows = getDb().prepare(`SELECT * FROM asset_units
        WHERE asset_type <> 'character' AND status = 'active' AND (
          (scope = 'episode' AND project_id = ?)
          OR (scope = 'series' AND series_id = ?)
          OR scope = 'global'
        ) ORDER BY updated_at DESC`).all(projectId, seriesId);
      return rows.map((row) => mapUnit(row)).filter((row): row is AssetUnitRow => row !== null);
    },
  };
  return repository;
}

export const assetLibrary = createAssetLibraryService({ repository: databaseRepository() });

export { ASSET_TYPES, normalizeMediaReference, createAssetLibraryService }
