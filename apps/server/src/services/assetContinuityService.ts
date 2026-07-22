import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  AssetBatchBindPreviewSchema,
  AssetBatchBindReportSchema,
  AssetBindingSchema,
  ReconcilePreviewSchema,
  ReconcileReportSchema,
  type AssetBatchBindingDraft,
  type AssetBatchBindPreview,
  type AssetBatchBindReport,
  type AssetBinding,
  type AssetUnit,
  type AssetVariant,
  type ReconcileDecision,
  type ReconcilePreview,
  type ReconcileReport,
  type SharedAsset,
  type Shot,
} from '@aigc-director/contracts'
import type { DirectorDatabase } from '../db/database.js'

const APPROVAL_TTL_MS = 15 * 60_000
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex')

interface StoredReconcile {
  kind: 'reconcile'
  expectedProjectRevision: number
  decisions: ReconcileDecision[]
  changed: string[]
  skipped: string[]
  conflicts: Array<{ bindingId: string; code: string; message: string }>
  tokenHash: string
  expiresAt: string
}

interface StoredBatchBind {
  kind: 'batch_bind'
  expectedProjectRevision: number
  bindings: AssetBinding[]
  changed: string[]
  skipped: string[]
  conflicts: Array<{ shotId: string; code: string; message: string }>
  tokenHash: string
  expiresAt: string
}

function tokenMatches(candidate: string, expectedHash: string): boolean {
  const actual = Buffer.from(tokenHash(candidate), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export class AssetContinuityService {
  constructor(private readonly database: DirectorDatabase) {}

  previewReconcile(episodeId: string, expectedProjectRevision: number, decisions: ReconcileDecision[]): ReconcilePreview {
    const context = this.database.getEpisodeContext(episodeId)
    if (context.project.graphRevision !== expectedProjectRevision) throw new Error('GRAPH_REVISION_CONFLICT')
    const changed: string[] = []
    const skipped: string[] = []
    const conflicts: StoredReconcile['conflicts'] = []
    for (const decision of decisions) {
      const binding = this.database.getAssetBinding(decision.bindingId)
      if (!binding || binding.projectId !== context.project.id) {
        conflicts.push({ bindingId: decision.bindingId, code: 'BINDING_NOT_FOUND', message: '资产绑定不存在或不属于当前分集。' })
        continue
      }
      if (decision.action === 'keep_local') {
        skipped.push(binding.id)
        continue
      }
      if (decision.action === 'promote') {
        if (binding.assetKind !== 'local') conflicts.push({ bindingId: binding.id, code: 'PROMOTE_REQUIRES_LOCAL', message: '只有分集本地资产可以提升为共享资产。' })
        else if (decision.targetScope === 'series' && !context.episode.seriesId) conflicts.push({ bindingId: binding.id, code: 'SERIES_REQUIRED', message: '当前分集未加入 Series，不能提升到系列作用域。' })
        else changed.push(binding.id)
        continue
      }
      if (!decision.targetAssetId || !decision.targetVariantId) {
        conflicts.push({ bindingId: binding.id, code: 'TARGET_REQUIRED', message: '改绑需要目标资产和 Variant。' })
        continue
      }
      const target = this.resolveTarget(context.project.id, decision.targetAssetId, decision.targetVariantId)
      if (!target) conflicts.push({ bindingId: binding.id, code: 'TARGET_INVALID', message: '目标资产或 Variant 不存在、已归档或不属于当前作用域。' })
      else if (decision.expectedAssetRevision && decision.expectedAssetRevision !== target.revision) conflicts.push({ bindingId: binding.id, code: 'ASSET_REVISION_CONFLICT', message: '目标资产 revision 已变化，请刷新影响预览。' })
      else changed.push(binding.id)
    }
    const operationId = randomUUID()
    const approvalToken = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString()
    const payload: StoredReconcile = {
      kind: 'reconcile', expectedProjectRevision, decisions, changed, skipped, conflicts,
      tokenHash: tokenHash(approvalToken), expiresAt,
    }
    this.database.saveReconcileOperation({ id: operationId, episodeId, projectId: context.project.id, status: 'preview', payload })
    return ReconcilePreviewSchema.parse({ operationId, episodeId, expectedProjectRevision, decisions, changed, skipped, conflicts, approvalToken, expiresAt })
  }

  applyReconcile(episodeId: string, operationId: string, approvalToken: string): ReconcileReport {
    const operation = this.database.getReconcileOperation<StoredReconcile>(operationId)
    if (!operation || operation.episodeId !== episodeId || operation.payload.kind !== 'reconcile') throw new Error('RECONCILE_NOT_FOUND')
    if (operation.status !== 'preview') throw new Error('RECONCILE_ALREADY_APPLIED')
    if (Date.parse(operation.payload.expiresAt) <= Date.now()) throw new Error('RECONCILE_EXPIRED')
    if (!tokenMatches(approvalToken, operation.payload.tokenHash)) throw new Error('APPROVAL_TOKEN_INVALID')
    if (operation.payload.conflicts.length > 0) throw new Error('RECONCILE_HAS_CONFLICTS')
    const context = this.database.getEpisodeContext(episodeId)
    if (context.project.graphRevision !== operation.payload.expectedProjectRevision) throw new Error('GRAPH_REVISION_CONFLICT')
    const appliedAt = new Date().toISOString()
    return this.database.transaction(() => {
      for (const decision of operation.payload.decisions) {
        if (decision.action === 'keep_local') continue
        const binding = this.database.getAssetBinding(decision.bindingId)
        if (!binding || binding.projectId !== context.project.id) throw new Error('BINDING_NOT_FOUND')
        let target: { assetKind: AssetBinding['assetKind']; assetId: string; variantId: string; revision: number; scope: AssetBinding['originScope']; scopeId?: string }
        if (decision.action === 'promote') {
          const targetScope = decision.targetScope ?? (context.episode.seriesId ? 'series' : 'global')
          const promoted = this.database.promoteLocalAsset(context.project.id, binding.assetId, binding.variantId, {
            scope: targetScope,
            ...(targetScope === 'series' && context.episode.seriesId ? { seriesId: context.episode.seriesId } : {}),
          })
          target = {
            assetKind: 'shared', assetId: promoted.asset.id, variantId: promoted.variant.id,
            revision: promoted.asset.revision, scope: promoted.asset.scope,
            ...(promoted.asset.seriesId ? { scopeId: promoted.asset.seriesId } : {}),
          }
        } else {
          const resolved = this.resolveTarget(context.project.id, decision.targetAssetId!, decision.targetVariantId!)
          if (!resolved) throw new Error('ASSET_VARIANT_NOT_FOUND')
          target = resolved
        }
        this.database.putAssetBinding(AssetBindingSchema.parse({
          ...binding, assetKind: target.assetKind, assetId: target.assetId, variantId: target.variantId,
          assetRevision: target.revision, originScope: target.scope,
          ...(target.scopeId ? { originScopeId: target.scopeId } : { originScopeId: undefined }),
          drifted: false, updatedAt: appliedAt,
        }))
        this.markShotStale(context.project.id, binding.shotId, binding.slot, appliedAt)
      }
      const projectRevision = this.database.bumpGraphRevision(context.project.id)
      const report = ReconcileReportSchema.parse({
        operationId, episodeId, projectRevision, changed: operation.payload.changed,
        skipped: operation.payload.skipped, conflicts: [], appliedAt,
      })
      this.database.saveReconcileOperation({ id: operationId, episodeId, projectId: context.project.id, status: 'applied', payload: { ...operation.payload, report } })
      return report
    })
  }

  previewBatchBind(episodeId: string, expectedProjectRevision: number, drafts: AssetBatchBindingDraft[]): AssetBatchBindPreview {
    const context = this.database.getEpisodeContext(episodeId)
    if (context.project.graphRevision !== expectedProjectRevision) throw new Error('GRAPH_REVISION_CONFLICT')
    const timestamp = new Date().toISOString()
    const bindings: AssetBinding[] = []
    const conflicts: StoredBatchBind['conflicts'] = []
    for (const draft of drafts) {
      const shot = this.database.get<Shot>('shots', draft.shotId)
      const target = this.resolveTarget(context.project.id, draft.assetId, draft.variantId)
      if (!shot || shot.projectId !== context.project.id) {
        conflicts.push({ shotId: draft.shotId, code: 'SHOT_NOT_FOUND', message: '镜头不存在或不属于当前分集。' })
        continue
      }
      if (!target || target.assetKind !== draft.assetKind) {
        conflicts.push({ shotId: draft.shotId, code: 'TARGET_INVALID', message: '目标资产或 Variant 不可用于当前分集。' })
        continue
      }
      if (draft.expectedAssetRevision && draft.expectedAssetRevision !== target.revision) {
        conflicts.push({ shotId: draft.shotId, code: 'ASSET_REVISION_CONFLICT', message: '资产 revision 已变化。' })
        continue
      }
      bindings.push(AssetBindingSchema.parse({
        id: randomUUID(), projectId: context.project.id, shotId: draft.shotId, slot: draft.slot,
        assetKind: target.assetKind, assetId: target.assetId, variantId: target.variantId,
        assetRevision: target.revision, originScope: target.scope,
        ...(target.scopeId ? { originScopeId: target.scopeId } : {}), drifted: false, createdAt: timestamp, updatedAt: timestamp,
      }))
    }
    const operationId = randomUUID()
    const approvalToken = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString()
    const payload: StoredBatchBind = {
      kind: 'batch_bind', expectedProjectRevision, bindings, changed: bindings.map((binding) => binding.shotId),
      skipped: [], conflicts, tokenHash: tokenHash(approvalToken), expiresAt,
    }
    this.database.saveReconcileOperation({ id: operationId, episodeId, projectId: context.project.id, status: 'preview', payload })
    return AssetBatchBindPreviewSchema.parse({ operationId, episodeId, expectedProjectRevision, bindings, changed: payload.changed, skipped: [], conflicts, approvalToken, expiresAt })
  }

  applyBatchBind(episodeId: string, operationId: string, approvalToken: string): AssetBatchBindReport {
    const operation = this.database.getReconcileOperation<StoredBatchBind>(operationId)
    if (!operation || operation.episodeId !== episodeId || operation.payload.kind !== 'batch_bind') throw new Error('RECONCILE_NOT_FOUND')
    if (operation.status !== 'preview') throw new Error('RECONCILE_ALREADY_APPLIED')
    if (Date.parse(operation.payload.expiresAt) <= Date.now()) throw new Error('RECONCILE_EXPIRED')
    if (!tokenMatches(approvalToken, operation.payload.tokenHash)) throw new Error('APPROVAL_TOKEN_INVALID')
    if (operation.payload.conflicts.length > 0) throw new Error('RECONCILE_HAS_CONFLICTS')
    const context = this.database.getEpisodeContext(episodeId)
    if (context.project.graphRevision !== operation.payload.expectedProjectRevision) throw new Error('GRAPH_REVISION_CONFLICT')
    const appliedAt = new Date().toISOString()
    return this.database.transaction(() => {
      for (const binding of operation.payload.bindings) {
        this.database.putAssetBinding(binding)
        this.markShotStale(context.project.id, binding.shotId, binding.slot, appliedAt)
      }
      const projectRevision = this.database.bumpGraphRevision(context.project.id)
      const report = AssetBatchBindReportSchema.parse({ operationId, episodeId, projectRevision, bindingIds: operation.payload.bindings.map((binding) => binding.id), appliedAt })
      this.database.saveReconcileOperation({ id: operationId, episodeId, projectId: context.project.id, status: 'applied', payload: { ...operation.payload, report } })
      return report
    })
  }

  private resolveTarget(projectId: string, assetId: string, variantId: string): {
    assetKind: AssetBinding['assetKind']; assetId: string; variantId: string; revision: number;
    scope: AssetBinding['originScope']; scopeId?: string;
  } | undefined {
    const shared = this.database.getSharedAsset(assetId)
    const sharedVariant = this.database.getSharedAssetVariant(variantId)
    if (shared && sharedVariant?.sharedAssetId === shared.id && !shared.archived && !sharedVariant.archived) {
      const episode = this.database.getEpisodeByProject(projectId)
      if (!episode || (shared.scope === 'series' && shared.seriesId !== episode.seriesId)) return undefined
      return {
        assetKind: 'shared', assetId, variantId, revision: shared.revision, scope: shared.scope,
        ...(shared.seriesId ? { scopeId: shared.seriesId } : {}),
      }
    }
    const local = this.database.get<AssetUnit>('assets', assetId)
    const localVariant = this.database.get<AssetVariant>('asset_variants', variantId)
    if (!local || !localVariant || local.projectId !== projectId || localVariant.assetId !== local.id || local.archived || localVariant.archived) return undefined
    const episodeId = this.database.getEpisodeByProject(projectId)?.id
    return {
      assetKind: 'local', assetId, variantId, revision: local.revision, scope: local.scope,
      ...(episodeId ? { scopeId: episodeId } : {}),
    }
  }

  private markShotStale(projectId: string, shotId: string, slot: AssetBinding['slot'], timestamp: string): void {
    const shot = this.database.get<Shot>('shots', shotId)
    if (!shot || shot.projectId !== projectId) throw new Error('SHOT_NOT_FOUND')
    const affected = slot === 'voice'
      ? ['voice', 'subtitle', 'timeline', 'export']
      : slot === 'music'
        ? ['timeline', 'export']
        : ['image', 'video', 'timeline', 'export']
    this.database.put('shots', projectId, {
      ...shot, staleFields: [...new Set([...shot.staleFields, `asset.${slot}`, ...affected])],
      revision: shot.revision + 1, updatedAt: timestamp,
    })
  }
}
