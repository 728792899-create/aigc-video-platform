import { createHash, randomUUID } from 'node:crypto'
import {
  MemoryChunkSchema,
  MemoryModelStatusSchema,
  MemoryRebuildReportSchema,
  MemoryRecordSchema,
  MemorySearchResultSchema,
  type ArtifactVersion,
  type AgentMemoryCitation,
  type MemoryChunk,
  type MemoryModelStatus,
  type MemoryRecord,
  type MemoryRebuildReport,
  type MemorySearchResult,
  type ReviewDecision,
} from '@aigc-director/contracts'
import type { DirectorDatabase } from '../db/database.js'

const ONNX_MODEL = {
  modelId: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
  revision: 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42',
  expectedSha256: '10f7a088420252b26caf819236ca2c9d2987afd0fc06fec7553b542a5655a05a',
} as const

interface MemoryDraft extends Omit<MemoryRecord, 'id' | 'contentHash' | 'stale' | 'disabled' | 'sensitiveFlags' | 'createdAt' | 'updatedAt'> {}

export interface AgentCheckpointContext {
  memoryQuery: string
  memoryCitations: AgentMemoryCitation[]
  memoryContextHash: string
  inputArtifactHashes: Array<{ artifactVersionId: string; contentHash: string }>
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function detectSensitive(value: string): MemoryRecord['sensitiveFlags'] {
  const flags = new Set<MemoryRecord['sensitiveFlags'][number]>()
  if (/(?:api[_-]?key|secret|authorization)\s*[:=]|bearer\s+[a-z0-9._-]{12,}|\bsk-[a-z0-9_-]{12,}/iu.test(value)) flags.add('credential')
  if (/[?&](?:x-amz-signature|signature|sig|access_token|token)=[^\s&]+/iu.test(value)) flags.add('signed-url')
  if (/(?:\/Users\/|\/home\/[^/\s]+\/|[a-z]:\\Users\\)/iu.test(value)) flags.add('private-path')
  if (/\u0000|[\u0001-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) flags.add('binary-content')
  return [...flags]
}

export function memoryKeywords(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('zh-CN')
  const result = new Set<string>()
  for (const token of normalized.match(/[\p{L}\p{N}]{2,40}/gu) ?? []) {
    result.add(token)
    if (/\p{Script=Han}/u.test(token)) {
      const characters = [...token]
      for (let index = 0; index < characters.length - 1; index += 1) result.add(characters.slice(index, index + 2).join(''))
    }
  }
  return [...result].slice(0, 100)
}

function chunksFor(record: MemoryRecord): MemoryChunk[] {
  const parts = record.content.match(/[\s\S]{1,1000}/gu) ?? [record.content]
  return parts.map((text, ordinal) => MemoryChunkSchema.parse({
    id: randomUUID(), memoryId: record.id, ordinal, text, keywords: memoryKeywords(text).slice(0, 60),
    contentHash: hash(text), createdAt: record.createdAt,
  }))
}

export class MemoryService {
  constructor(private readonly db: DirectorDatabase) {}

  contexts(projectId: string): Array<{ scope: MemoryRecord['scope']; scopeId: string }> {
    const episode = this.db.getEpisodeByProject(projectId)
    if (!episode) throw new Error('EPISODE_NOT_FOUND')
    return [
      { scope: 'episode', scopeId: episode.id },
      ...(episode.seriesId ? [{ scope: 'series' as const, scopeId: episode.seriesId }] : []),
      { scope: 'global', scopeId: this.db.workspaceId() },
    ]
  }

  rebuild(projectId: string): MemoryRebuildReport {
    const snapshot = this.db.snapshot(projectId)
    const episode = snapshot.episode
    if (!episode) throw new Error('EPISODE_NOT_FOUND')
    const drafts: MemoryDraft[] = snapshot.events.map((event) => ({
      scope: 'episode', scopeId: episode.id, originProjectId: projectId, sourceType: 'story_event', sourceKey: `event:${event.id}`,
      sourceRevision: event.revision, title: event.title, summary: event.summary,
      content: [event.summary, ...event.lockedFacts, JSON.stringify(event.characterStateAfter)].filter(Boolean).join('\n'),
      keywords: memoryKeywords(`${event.title}\n${event.summary}\n${event.lockedFacts.join('\n')}`),
    }))
    for (const artifact of snapshot.artifactVersions.filter((item) => item.status === 'approved')) drafts.push(this.artifactDraft(projectId, episode.id, artifact))
    for (const shot of snapshot.shots) {
      const selected = snapshot.candidates.find((candidate) => candidate.id === shot.selectedCandidateId)
      if (!selected) continue
      drafts.push({
        scope: 'episode', scopeId: episode.id, originProjectId: projectId, sourceType: 'selected_candidate', sourceKey: `shot:${shot.id}`,
        sourceRevision: shot.revision, title: `${shot.title} · 已批准候选`, summary: selected.label || `${selected.kind} candidate`,
        content: `镜头：${shot.description}\n模型：${selected.model}\n标签：${selected.tags.join('、') || '无'}`,
        keywords: memoryKeywords(`${shot.title}\n${shot.description}\n${selected.label}\n${selected.tags.join(' ')}`),
      })
    }
    const humanReviews = snapshot.reviews.filter((review) => review.source === 'human')
    for (const review of humanReviews) drafts.push(this.feedbackDraft(projectId, episode.id, review))
    if (snapshot.series) drafts.push({
      scope: 'series', scopeId: snapshot.series.id, originProjectId: projectId, sourceType: 'series_bible', sourceKey: `series:${snapshot.series.id}`,
      sourceRevision: snapshot.series.revision, title: snapshot.series.name, summary: snapshot.series.description || 'Series 连续性设定',
      content: `${snapshot.series.description}\n艺术方向：${snapshot.series.artDirection}`.trim(),
      keywords: memoryKeywords(`${snapshot.series.name}\n${snapshot.series.description}\n${snapshot.series.artDirection}`),
    })
    for (const asset of this.db.listSharedAssets('global')) drafts.push({
      scope: 'global', scopeId: this.db.workspaceId(), originProjectId: projectId, sourceType: 'shared_asset', sourceKey: `asset:${asset.id}`,
      sourceRevision: asset.revision, title: asset.name, summary: asset.description || `${asset.type} 全局资产`,
      content: `${asset.type}\n${asset.name}\n${asset.description}`, keywords: memoryKeywords(`${asset.type}\n${asset.name}\n${asset.description}`),
    })
    if (snapshot.series) for (const asset of this.db.listSharedAssets('series', snapshot.series.id)) drafts.push({
      scope: 'series', scopeId: snapshot.series.id, originProjectId: projectId, sourceType: 'shared_asset', sourceKey: `asset:${asset.id}`,
      sourceRevision: asset.revision, title: asset.name, summary: asset.description || `${asset.type} Series 资产`,
      content: `${asset.type}\n${asset.name}\n${asset.description}`, keywords: memoryKeywords(`${asset.type}\n${asset.name}\n${asset.description}`),
    })

    let created = 0
    let reused = 0
    let markedStale = 0
    let skippedSensitive = 0
    let indexedChunks = 0
    this.db.transaction(() => {
      const existing = this.db.listMemoryRecords(this.contexts(projectId))
      for (const draft of drafts) {
        const contentHash = hash(JSON.stringify({ title: draft.title, summary: draft.summary, content: draft.content, keywords: draft.keywords }))
        const sensitiveFlags = detectSensitive(`${draft.title}\n${draft.summary}\n${draft.content}`)
        if (sensitiveFlags.length > 0) { skippedSensitive += 1; continue }
        for (const record of existing.filter((item) => item.scope === draft.scope && item.scopeId === draft.scopeId && item.sourceType === draft.sourceType && item.sourceKey === draft.sourceKey && !item.stale && (item.sourceRevision !== draft.sourceRevision || item.contentHash !== contentHash))) {
          this.db.putMemoryRecord({ ...record, stale: true, updatedAt: new Date().toISOString() })
          markedStale += 1
        }
        const match = existing.find((item) => item.scope === draft.scope && item.scopeId === draft.scopeId && item.sourceType === draft.sourceType && item.sourceKey === draft.sourceKey && item.sourceRevision === draft.sourceRevision && item.contentHash === contentHash)
        if (match) {
          if (match.stale) this.db.putMemoryRecord({ ...match, stale: false, updatedAt: new Date().toISOString() })
          reused += 1
          indexedChunks += this.db.listMemoryChunks(match.id).length
          continue
        }
        const timestamp = new Date().toISOString()
        const record = MemoryRecordSchema.parse({ ...draft, id: randomUUID(), contentHash, stale: false, disabled: false, sensitiveFlags: [], createdAt: timestamp, updatedAt: timestamp })
        this.db.putMemoryRecord(record)
        const chunks = chunksFor(record)
        this.db.replaceMemoryChunks(record.id, chunks)
        created += 1
        indexedChunks += chunks.length
      }
    })
    return MemoryRebuildReportSchema.parse({ projectId, created, reused, markedStale, skippedSensitive, indexedChunks })
  }

  search(projectId: string, query: string, limit = 12): MemorySearchResult[] {
    const terms = memoryKeywords(query)
    if (terms.length === 0) return []
    const scopeWeight: Record<MemoryRecord['scope'], number> = { episode: 30, series: 20, global: 10 }
    return this.db.listMemoryRecords(this.contexts(projectId))
      .filter((record) => !record.stale && !record.disabled && record.sensitiveFlags.length === 0)
      .map((record) => {
        const haystack = `${record.title}\n${record.summary}\n${record.content}`.normalize('NFKC').toLocaleLowerCase('zh-CN')
        const matchedKeywords = terms.filter((term) => record.keywords.includes(term) || haystack.includes(term))
        const phrase = haystack.includes(query.normalize('NFKC').toLocaleLowerCase('zh-CN'))
        const score = scopeWeight[record.scope] + matchedKeywords.length * 10 + (phrase ? 15 : 0)
        const scopeReason = record.scope === 'episode' ? 'Episode 作用域优先' : record.scope === 'series' ? 'Series 共享上下文' : 'Global 可复用上下文'
        return MemorySearchResultSchema.parse({
          record, score, matchedKeywords,
          reasons: [scopeReason, ...(matchedKeywords.length ? [`关键词命中：${matchedKeywords.join('、')}`] : []), ...(phrase ? ['完整短语命中'] : [])],
        })
      })
      .filter((result) => result.matchedKeywords.length > 0)
      .sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt))
      .slice(0, Math.max(1, Math.min(50, limit)))
  }

  checkpointContext(projectId: string, limit = 12): AgentCheckpointContext {
    this.rebuild(projectId)
    const eligible = this.db.listMemoryRecords(this.contexts(projectId))
      .filter((record) => !record.stale && !record.disabled && record.sensitiveFlags.length === 0)
      .sort((left, right) => left.scope.localeCompare(right.scope) || left.sourceKey.localeCompare(right.sourceKey) || right.sourceRevision - left.sourceRevision)
    const memoryQuery = [...new Set(eligible.flatMap((record) => record.keywords))].slice(0, 24).join(' ').slice(0, 500)
    const memoryCitations: AgentMemoryCitation[] = memoryQuery
      ? this.search(projectId, memoryQuery, limit).map((result) => ({
        memoryId: result.record.id,
        scope: result.record.scope,
        sourceType: result.record.sourceType,
        sourceKey: result.record.sourceKey,
        sourceRevision: result.record.sourceRevision,
        contentHash: result.record.contentHash,
        score: result.score,
        matchedKeywords: result.matchedKeywords,
        reasons: result.reasons,
      }))
      : []
    const inputArtifactHashes = this.db.snapshot(projectId).artifactVersions
      .filter((artifact) => artifact.status === 'approved')
      .map((artifact) => ({ artifactVersionId: artifact.id, contentHash: artifact.contentHash }))
      .sort((left, right) => left.artifactVersionId.localeCompare(right.artifactVersionId))
    const memoryContextHash = hash(JSON.stringify({ memoryCitations, inputArtifactHashes }))
    return { memoryQuery, memoryCitations, memoryContextHash, inputArtifactHashes }
  }

  setDisabled(memoryId: string, disabled: boolean): MemoryRecord {
    const record = this.db.getMemoryRecord(memoryId)
    if (!record) throw new Error('MEMORY_NOT_FOUND')
    return this.db.putMemoryRecord({ ...record, disabled, updatedAt: new Date().toISOString() })
  }

  delete(memoryId: string): void {
    if (!this.db.deleteMemoryRecord(memoryId)) throw new Error('MEMORY_NOT_FOUND')
  }

  modelStatus(): MemoryModelStatus {
    return MemoryModelStatusSchema.parse({ mode: 'keyword', keywordReady: true, onnx: { enabled: false, installed: false, status: 'not-requested', ...ONNX_MODEL } })
  }

  private artifactDraft(projectId: string, episodeId: string, artifact: ArtifactVersion): MemoryDraft {
    return {
      scope: 'episode', scopeId: episodeId, originProjectId: projectId, sourceType: 'artifact', sourceKey: `artifact:${artifact.stageId}:${artifact.scope.type}:${artifact.scope.id}`,
      sourceRevision: artifact.revision, title: artifact.artifactType, summary: `已批准阶段产物 ${artifact.stageId} r${artifact.revision}`,
      content: `产物类型：${artifact.artifactType}\n阶段：${artifact.stageId}\n内容 hash：${artifact.contentHash}`,
      keywords: memoryKeywords(`${artifact.artifactType}\n${artifact.stageId}`),
    }
  }

  private feedbackDraft(projectId: string, episodeId: string, review: ReviewDecision): MemoryDraft {
    return {
      scope: 'episode', scopeId: episodeId, originProjectId: projectId, sourceType: 'user_feedback', sourceKey: `review:${review.id}`,
      sourceRevision: 1, title: '候选人工反馈', summary: review.reasons.join('；') || review.decision,
      content: `决策：${review.decision}\n原因：${review.reasons.join('；')}`, keywords: memoryKeywords(review.reasons.join('\n')),
    }
  }
}
