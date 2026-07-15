'use strict';

import express from 'express'
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

function presentBinding(value: unknown) {
  const row = asRecord(value);
  const snapshot = parseJsonRecord(row.snapshot);
  return { ...row, snapshot: Object.keys(snapshot).length ? snapshot : null };
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
    const characterUnits = continuity.listCharacters(req.params.projectId, { includeArchivedAssets: true }).map((character) => ({
      id: character.id,
      asset_type: 'character',
      scope: Number(character.project_id) === Number(req.params.projectId) ? 'episode' : 'series',
      name: character.name,
      locked: !!character.locked,
      selected_variant_id: character.assets.find((item) => Number(item.selected) === 1)?.id || null,
      variants: character.assets.map(presentVariant)
        .sort((a, b) => Number(a.revision) - Number(b.revision) || Number(a.id) - Number(b.id)),
    }));
    const repository = databaseRepository();
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
        supported_asset_types: ['character', 'scene', 'prop', 'style'],
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
    const body = asRecord(req.body);
    const scope = body.scope || 'episode';
    const unit = assetLibrary.createUnit({
      assetType: body.asset_type,
      name: body.name,
      scope,
      projectId: scope === 'episode' ? Number(project.id) : null,
      seriesId: scope === 'series' || scope === 'episode' ? Number(project.series_id) || null : null,
      metadata: body.metadata,
    });
    res.status(201).json({ code: 201, data: unit, message: '资产已创建' });
  } catch (error) {
    const details = errorDetails(error);
    const status = statusFor(details);
    res.status(status).json({ code: status, data: { error_code: details.code, details }, message: errorMessage(error) });
  }
});

router.post('/units/:unitId/variants', (req, res) => {
  try {
    const unit = getDb().prepare('SELECT * FROM asset_units WHERE id = ? AND status = ?').get(req.params.unitId, 'active');
    if (!unit) return res.status(404).json({ code: 404, data: null, message: '资产不存在' });
    const body = asRecord(req.body);
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
    const body = asRecord(req.body);
    const variant = assetLibrary.addVariant({
      assetType: 'character',
      assetId: req.params.characterId,
      projectId: body.project_id,
      label: body.label,
      provider: body.provider,
      model: body.model,
      prompt: body.prompt,
      parentVariantId: body.parent_variant_id,
      contentHash: body.content_hash,
      mediaReference: body.media_reference || {
        kind: /^https?:\/\//i.test(String(body.file_url || body.file_path || '')) ? 'public_url' : 'project_media',
        media_id: body.image_id,
        url: body.file_url || body.file_path,
      },
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
    const body = asRecord(req.body);
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
