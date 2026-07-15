'use strict';

import express from 'express'
import {
  AssetBatchBindingSchema,
  AssetBindingUpdateSchema,
  AssetUnitForkSchema,
  AssetUnitCreateSchema,
  AssetVariantCreateSchema,
  MusicAssetMetadataSchema,
  VoiceAssetMetadataSchema,
} from '@aigc-video/contracts'
import { getDb } from '../db'
import type { AssetLibraryService, AssetRepository } from '../services/assetDomain'
import { asRecord, errorDetails, errorMessage, parseJsonRecord, type JsonRecord, type RouteErrorDetails } from './routeSupport'
const router = express.Router();
interface CharacterAsset {
  id: unknown
  selected?: unknown
  revision?: unknown
  [key: string]: unknown
}
interface CharacterUnit {
  id: unknown
  project_id?: unknown
  name: unknown
  locked?: unknown
  assets: CharacterAsset[]
}
interface ContinuityService {
  listCharacters(projectId: unknown, options: { includeArchivedAssets: boolean }): CharacterUnit[]
}
const continuity: ContinuityService = require('../services/continuity');
const {
  assetLibrary,
  databaseRepository,
}: {
  assetLibrary: AssetLibraryService
  databaseRepository: () => AssetRepository
} = require('../services/assetLibrary');

interface PresentedVariant extends JsonRecord {
  id?: unknown
  revision?: unknown
  selected: boolean
  favorite: boolean
  media_reference: JsonRecord | null
}

function presentVariant(value: unknown): PresentedVariant {
  const row = asRecord(value);
  return {
    ...row,
    selected: Number(row.selected) === 1,
    favorite: Number(row.favorite) === 1,
    media_reference: Object.keys(parseJsonRecord(row.media_reference)).length
      ? parseJsonRecord(row.media_reference)
      : null,
  };
}

function entityId(value: unknown): string | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : String(value || '')
}

function presentBinding(value: unknown): JsonRecord & { storyboard_id?: unknown } {
  const row = asRecord(value);
  const snapshot = parseJsonRecord(row.snapshot);
  const stableAssetId = row.asset_type !== 'character' && row.asset_unit_id
    ? String(row.asset_unit_id)
    : row.asset_id;
  const array = (value: unknown): string[] => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch { return []; }
  };
  return {
    ...row, asset_id: stableAssetId, snapshot,
    stale_fields: array(row.stale_fields), stale_sources: array(row.stale_sources),
  };
}

function statusFor(error: RouteErrorDetails): number {
  if (['ASSET_NOT_FOUND', 'ASSET_VARIANT_NOT_FOUND'].includes(error.code || '')) return 404;
  if (error.code === 'ASSET_VARIANT_IN_USE') return 409;
  return 400;
}

// Provider-neutral 资产视图：Character 继续从兼容表读取；Scene / Prop / Style
// 使用 v7 通用表，并按 Episode > Series > Global 解析同名覆盖关系。
router.get('/projects/:projectId', (req, res) => {
  try {
    const project = getDb().prepare('SELECT id, series_id FROM projects WHERE id = ?').get(req.params.projectId);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    const repository = databaseRepository();
    const characterUnits = continuity.listCharacters(req.params.projectId, { includeArchivedAssets: true }).map((character) => ({
      id: entityId(character.id),
      asset_type: 'character',
      scope: Number(character.project_id) === Number(req.params.projectId) ? 'episode' : 'series',
      project_id: Number(character.project_id) || null,
      series_id: Number(project.series_id) || null,
      name: String(character.name || ''),
      locked: !!character.locked,
      selected_variant_id: repository.listVariants('character', entityId(character.id)).find((item) => Number(item.selected) === 1)?.id || null,
      variants: repository.listVariants('character', entityId(character.id)).map(presentVariant)
        .sort((a, b) => Number(a.revision) - Number(b.revision) || Number(a.id) - Number(b.id)),
    }));
    const genericUnits = assetLibrary.listResolvedProject(Number(project.id), Number(project.series_id) || null)
      .map((unit) => ({
        ...unit,
        variants: repository.listVariants(unit.asset_type, unit.id).map(presentVariant),
      }));
    const units = [...characterUnits, ...genericUnits];
    const bindings = getDb().prepare(
      'SELECT * FROM storyboard_asset_bindings WHERE project_id = ? ORDER BY storyboard_id, id'
    ).all(req.params.projectId).map(presentBinding);
    res.json({
      code: 200,
      data: {
        units,
        bindings,
        supported_asset_types: ['character', 'scene', 'prop', 'style', 'voice', 'music'],
        resolution_order: ['episode', 'series', 'global'],
      },
      message: 'success',
    });
  } catch (error) {
    res.status(500).json({ code: 500, data: null, message: `读取资产库失败: ${errorMessage(error)}` });
  }
});

router.post('/projects/:projectId/units', (req, res) => {
  try {
    const project = getDb().prepare('SELECT id, series_id FROM projects WHERE id = ?').get(req.params.projectId);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
    const body = AssetUnitCreateSchema.parse(req.body);
    const metadata = body.asset_type === 'voice'
      ? VoiceAssetMetadataSchema.parse(body.metadata)
      : body.asset_type === 'music'
        ? MusicAssetMetadataSchema.parse(body.metadata)
        : body.metadata;
    const scope = body.scope || 'episode';
    const unit = assetLibrary.createUnit({
      assetType: body.asset_type,
      name: body.name,
      scope,
      projectId: scope === 'episode' ? Number(project.id) : null,
      seriesId: scope === 'series' || scope === 'episode' ? Number(project.series_id) || null : null,
      metadata,
    });
    res.status(201).json({ code: 201, data: unit, message: '资产已创建' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.post('/units/:unitId/fork', (req, res) => {
  try {
    const body = AssetUnitForkSchema.parse(req.body);
    const project = getDb().prepare('SELECT id, series_id FROM projects WHERE id = ?').get(body.project_id);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '目标项目不存在' });
    if (Number(project.series_id) !== body.series_id) {
      return res.status(400).json({ code: 400, data: null, message: '目标项目不属于指定 Series' });
    }
    const unit = getDb().prepare('SELECT * FROM asset_units WHERE id = ? AND status = ?').get(req.params.unitId, 'active');
    if (!unit) return res.status(404).json({ code: 404, data: null, message: '来源资产不存在' });
    const result = assetLibrary.forkUnit({
      assetType: unit.asset_type, assetId: unit.id, projectId: body.project_id,
      seriesId: body.series_id, variantId: body.variant_id,
    });
    getDb().prepare('INSERT INTO op_logs (action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('asset.fork', 'asset_unit', String(result.unit.id), JSON.stringify({
        source_unit_id: unit.id, source_variant_id: result.unit.forked_from_variant_id,
        project_id: body.project_id,
      }), Date.now());
    res.status(201).json({ code: 201, data: result, message: 'Series 资产已 fork 为 Episode 副本' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.post('/bindings/batch', (req, res) => {
  try {
    const body = AssetBatchBindingSchema.parse(req.body);
    const rows = getDb().prepare(`SELECT id, project_id FROM storyboards WHERE id IN (${body.storyboard_ids.map(() => '?').join(',')})`)
      .all(...body.storyboard_ids);
    const found = new Set(rows.map((row) => Number(row.id)));
    const missing = body.storyboard_ids.filter((id) => !found.has(id));
    if (missing.length || rows.some((row) => Number(row.project_id) !== Number(body.project_id))) {
      return res.status(400).json({ code: 400, data: { missing_storyboard_ids: missing }, message: '批量目标包含不存在或跨项目的镜头' });
    }
    const result = assetLibrary.batchBindVariant({
      storyboardIds: body.storyboard_ids, projectId: body.project_id,
      assetType: body.asset_type, assetId: body.asset_id, variantId: body.variant_id,
      sourceScope: body.source_scope,
    });
    getDb().prepare('INSERT INTO op_logs (action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('asset.batch-rebind', 'project', String(body.project_id), JSON.stringify({
        asset_id: body.asset_id, variant_id: body.variant_id, ...result,
      }), Date.now());
    res.json({ code: 200, data: result, message: `已改绑 ${result.changed_storyboard_ids.length} 个镜头` });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.get('/projects/:projectId/impact', (req, res) => {
  const project = getDb().prepare('SELECT id, series_id FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });
  const unitId = String(req.query.unit_id || '');
  const variantId = String(req.query.variant_id || '');
  if (!unitId && !variantId) return res.status(400).json({ code: 400, data: null, message: '需要 unit_id 或 variant_id' });
  const clauses: string[] = ['project_id = ?'];
  const params: unknown[] = [project.id];
  if (unitId) { clauses.push('asset_unit_id = ?'); params.push(unitId); }
  if (variantId) { clauses.push('(variant_key = ? OR CAST(variant_id AS TEXT) = ?)'); params.push(variantId, variantId); }
  const bindings = getDb().prepare(`SELECT * FROM storyboard_asset_bindings WHERE ${clauses.join(' AND ')} ORDER BY storyboard_id`)
    .all(...params).map(presentBinding);
  const forks = unitId ? getDb().prepare(
    'SELECT id, project_id, series_id, selected_variant_id FROM asset_units WHERE forked_from_unit_id = ? AND status = ? ORDER BY updated_at DESC'
  ).all(unitId, 'active') : [];
  res.json({ code: 200, data: { bindings, forks, affected_storyboard_ids: bindings.map((row) => Number(row.storyboard_id)) }, message: 'success' });
});

router.post('/units/:unitId/variants', (req, res) => {
  try {
    const unit = getDb().prepare('SELECT * FROM asset_units WHERE id = ? AND status = ?').get(req.params.unitId, 'active');
    if (!unit) return res.status(404).json({ code: 404, data: null, message: '资产不存在' });
    const body = AssetVariantCreateSchema.parse(req.body);
    const variant = assetLibrary.addVariant({
      assetType: unit.asset_type,
      assetId: unit.id,
      projectId: unit.project_id,
      label: body.label,
      provider: body.provider,
      model: body.model,
      prompt: body.prompt,
      parentVariantId: body.parent_variant_id,
      contentHash: body.content_hash,
      mediaReference: body.media_reference,
    });
    res.status(201).json({ code: 201, data: variant, message: 'Variant 已创建' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.post('/units/:unitId/variants/:variantId/select', (req, res) => {
  try {
    const unit = getDb().prepare('SELECT * FROM asset_units WHERE id = ? AND status = ?').get(req.params.unitId, 'active');
    if (!unit) return res.status(404).json({ code: 404, data: null, message: '资产不存在' });
    const variant = assetLibrary.selectVariant({
      assetType: unit.asset_type,
      assetId: unit.id,
      variantId: req.params.variantId,
    });
    res.json({ code: 200, data: variant, message: '默认 Variant 已切换' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.post('/characters/:characterId/variants', (req, res) => {
  try {
    const legacyBody = asRecord(req.body);
    const body = AssetVariantCreateSchema.parse({
      ...legacyBody,
      media_reference: legacyBody.media_reference || {
        kind: /^https?:\/\//i.test(String(legacyBody.file_url || legacyBody.file_path || '')) ? 'public_url' : 'project_media',
        media_id: legacyBody.image_id,
        url: legacyBody.file_url || legacyBody.file_path,
      },
    });
    const variant = assetLibrary.addVariant({
      assetType: 'character',
      assetId: req.params.characterId,
      projectId: legacyBody.project_id,
      label: body.label,
      provider: body.provider,
      model: body.model,
      prompt: body.prompt,
      parentVariantId: body.parent_variant_id,
      contentHash: body.content_hash,
      mediaReference: body.media_reference,
    });
    res.json({ code: 200, data: variant, message: 'Variant 已创建' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.post('/characters/:characterId/variants/:variantId/select', (req, res) => {
  try {
    const variant = assetLibrary.selectVariant({
      assetType: 'character', assetId: req.params.characterId, variantId: req.params.variantId,
    });
    res.json({ code: 200, data: variant, message: '默认 Variant 已切换' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.get('/storyboards/:storyboardId/bindings', (req, res) => {
  const storyboard = getDb().prepare('SELECT id FROM storyboards WHERE id = ?').get(req.params.storyboardId);
  if (!storyboard) return res.status(404).json({ code: 404, data: null, message: '分镜不存在' });
  const rows = getDb().prepare(
    'SELECT * FROM storyboard_asset_bindings WHERE storyboard_id = ? ORDER BY asset_type, asset_id'
  ).all(req.params.storyboardId).map(presentBinding);
  res.json({ code: 200, data: rows, message: 'success' });
});

router.put('/storyboards/:storyboardId/bindings', (req, res) => {
  try {
    const storyboard = getDb().prepare('SELECT * FROM storyboards WHERE id = ?').get(req.params.storyboardId);
    if (!storyboard) return res.status(404).json({ code: 404, data: null, message: '分镜不存在' });
    const body = AssetBindingUpdateSchema.parse(req.body);
    if (body.project_id != null && Number(body.project_id) !== Number(storyboard.project_id)) {
      return res.status(400).json({ code: 400, data: null, message: '分镜不属于当前项目' });
    }
    const binding = assetLibrary.bindVariant({
      storyboardId: storyboard.id,
      projectId: storyboard.project_id,
      assetType: body.asset_type,
      assetId: body.asset_id,
      variantId: body.variant_id,
      sourceScope: body.source_scope,
    });
    res.json({ code: 200, data: presentBinding(binding), message: '镜头资产快照已保存' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.delete('/variants/:variantId', (req, res) => {
  try {
    const variant = assetLibrary.archiveVariant(req.params.variantId);
    res.json({ code: 200, data: variant, message: 'Variant 已归档' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

module.exports = router;
