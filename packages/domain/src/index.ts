import { createHash, randomUUID } from 'node:crypto'
import type {
  Chapter,
  ExecutionPlan,
  GenerationTask,
  GraphEdge,
  GraphNode,
  GraphProjection,
  ProjectSnapshot,
  Scene,
  Shot,
  ShotBeat,
  BoundaryFrame,
  SourceDocument,
  StoryEvent,
  StoryEventEdge,
} from '@aigc-director/contracts'

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
export const nowIso = (): string => new Date().toISOString()

export interface ExtractedStory {
  chapters: Chapter[]
  events: StoryEvent[]
  edges: StoryEventEdge[]
}

const chapterPattern = /^(?:(?:#{1,6}\s*)?(?:第[一二三四五六七八九十百千\d]+章|chapter\s+\d+)[^\n]*|#{1,6}\s+\S[^\n]*)$/gimu
const sentencePattern = /[^。！？!?\n]+[。！？!?]?/gu

export interface ChapterHeading { title: string; start: number; end: number }

export function detectChapterHeadings(content: string): ChapterHeading[] {
  return [...content.matchAll(chapterPattern)].map((match) => ({
    title: match[0].trim().replace(/^#{1,6}\s*/u, '').replace(/\s+#+$/u, '').trim().slice(0, 200),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))
}

export function extractStoryDeterministically(source: SourceDocument): ExtractedStory {
  const headings = detectChapterHeadings(source.content)
  const boundaries = headings.length > 0
    ? headings.map((heading, index) => ({
      title: heading.title,
      start: heading.start,
      bodyStart: heading.end,
      end: headings[index + 1]?.start ?? source.content.length,
    }))
    : [{ title: source.title, start: 0, bodyStart: 0, end: source.content.length }]

  const chapters: Chapter[] = []
  const events: StoryEvent[] = []
  const edges: StoryEventEdge[] = []
  let eventOrder = 0

  for (const [chapterIndex, boundary] of boundaries.entries()) {
    const chapterId = randomUUID()
    const body = source.content.slice(boundary.bodyStart, boundary.end)
    const chapter: Chapter = {
      id: chapterId,
      projectId: source.projectId,
      sourceId: source.id,
      title: boundary.title,
      ordinal: chapterIndex,
      sourceStart: boundary.start,
      sourceEnd: Math.max(boundary.start + 1, boundary.end),
      summary: body.trim().slice(0, 500),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    chapters.push(chapter)

    const sentences = [...body.matchAll(sentencePattern)]
      .map((match) => ({ text: match[0].trim(), relativeStart: match.index ?? 0 }))
      .filter(({ text }) => text.length >= 4)
      .slice(0, 24)
    const chapterEvents: StoryEvent[] = sentences.map(({ text, relativeStart }, sentenceIndex) => {
      const sourceStart = boundary.bodyStart + relativeStart
      const type: StoryEvent['type'] = sentenceIndex === 0
        ? 'setup'
        : sentenceIndex === sentences.length - 1
          ? 'turning_point'
          : text.includes('却') || text.includes('突然') || text.includes('但是')
            ? 'revelation'
            : text.includes('说') || text.includes('问')
              ? 'dialogue'
              : 'action'
      return {
        id: randomUUID(),
        projectId: source.projectId,
        chapterId,
        type,
        title: text.replace(/[。！？!?]$/u, '').slice(0, 36),
        summary: text,
        sourceStart,
        sourceEnd: sourceStart + text.length,
        narrativeOrder: eventOrder++,
        chronologicalOrder: eventOrder - 1,
        characterStateBefore: {},
        characterStateAfter: {},
        lockedFacts: [],
        revision: 1,
        contentHash: sha256(text),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
    })
    events.push(...chapterEvents)
    for (let index = 1; index < chapterEvents.length; index += 1) {
      const previous = chapterEvents[index - 1]
      const current = chapterEvents[index]
      if (previous && current) {
        edges.push({
          id: randomUUID(),
          projectId: source.projectId,
          sourceEventId: previous.id,
          targetEventId: current.id,
          type: 'follows',
          createdAt: nowIso(),
        })
      }
    }
  }
  return { chapters, events, edges }
}

const acyclicEdgeTypes = new Set<StoryEventEdge['type']>(['follows', 'causes', 'depends_on'])

export function validateStoryGraph(events: StoryEvent[], edges: StoryEventEdge[]): { valid: boolean; issues: string[] } {
  const issues: string[] = []
  const eventById = new Map(events.map((event) => [event.id, event]))
  for (const edge of edges) {
    const source = eventById.get(edge.sourceEventId)
    const target = eventById.get(edge.targetEventId)
    if (!source || !target) issues.push(`边 ${edge.id} 引用了不存在的事件`)
    else if (source.projectId !== target.projectId || source.projectId !== edge.projectId) issues.push(`边 ${edge.id} 跨越了项目边界`)
  }

  const adjacency = new Map<string, string[]>()
  for (const edge of edges.filter((item) => acyclicEdgeTypes.has(item.type))) {
    adjacency.set(edge.sourceEventId, [...(adjacency.get(edge.sourceEventId) ?? []), edge.targetEventId])
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true
    visiting.delete(id)
    visited.add(id)
    return false
  }
  if (events.some((event) => visit(event.id))) issues.push('受约束事件关系包含循环')
  return { valid: issues.length === 0, issues }
}

export function createAdaptationArtifacts(projectId: string, events: StoryEvent[]): { scenes: Scene[]; shots: Shot[] } {
  const scenes: Scene[] = []
  const shots: Shot[] = []
  for (const [index, event] of events.entries()) {
    const sceneId = randomUUID()
    const timestamp = nowIso()
    scenes.push({
      id: sceneId,
      projectId,
      eventId: event.id,
      title: `场景 ${index + 1} · ${event.title}`,
      synopsis: event.summary,
      ordinal: index,
      revision: 1,
      staleFields: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const durationMs = 3_000
    const beats = normalizeShotBeats(durationMs, [
      { id: randomUUID(), action: `建立画面：${event.summary}`, camera: '中景建立空间', weight: 1 },
      { id: randomUUID(), action: event.type === 'dialogue' ? `完成台词：${event.summary}` : `推进动作：${event.summary}`, camera: '缓慢推进到主体', dialogue: event.type === 'dialogue' ? event.summary : '', weight: 1 },
    ])
    shots.push({
      id: randomUUID(),
      projectId,
      sceneId,
      title: `镜头 ${index + 1}`,
      description: event.summary,
      dialogue: event.type === 'dialogue' ? event.summary : '',
      visualPrompt: `电影感短剧画面，${event.summary}，构图清晰，角色连续`,
      videoPrompt: `镜头缓慢推进，动作自然，${event.summary}`,
      negativePrompt: '文字水印，品牌标志，低清晰度，畸形肢体',
      durationMs,
      beats,
      boundaryFrames: [],
      ordinal: index,
      revision: 1,
      staleFields: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }
  return { scenes, shots }
}

export interface ShotBeatDraft {
  id: string
  action: string
  camera: string
  dialogue?: string
  referenceIds?: string[]
  weight?: number
}

export function normalizeShotBeats(durationMs: number, drafts: ShotBeatDraft[]): ShotBeat[] {
  if (!Number.isSafeInteger(durationMs) || durationMs < 500 || durationMs > 120_000) throw new Error('SHOT_DURATION_INVALID')
  if (drafts.length < 1 || drafts.length > 16) throw new Error('SHOT_BEAT_COUNT_INVALID')
  if (durationMs < drafts.length * 100) throw new Error('SHOT_BEAT_MIN_DURATION_UNSATISFIABLE')
  const weights = drafts.map((draft) => Number.isFinite(draft.weight) && (draft.weight ?? 0) > 0 ? draft.weight! : 1)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const distributable = durationMs - drafts.length * 100
  const durations = weights.map((weight) => 100 + Math.floor(distributable * weight / totalWeight))
  const provisional = durations.reduce((sum, value) => sum + value, 0)
  durations[durations.length - 1] = durations[durations.length - 1]! + durationMs - provisional
  if (durations.some((value) => value < 100)) throw new Error('SHOT_BEAT_MIN_DURATION_UNSATISFIABLE')
  let cursor = 0
  return drafts.map((draft, ordinal) => {
    const duration = durations[ordinal]!
    const beat: ShotBeat = {
      id: draft.id,
      ordinal,
      startMs: cursor,
      durationMs: duration,
      action: draft.action,
      camera: draft.camera,
      dialogue: draft.dialogue ?? '',
      referenceIds: draft.referenceIds ?? [],
    }
    cursor += duration
    return beat
  })
}

export function linkPreviousEndFrame(current: Shot, previous: Shot, options: { propagateStale?: boolean } = {}): Shot {
  const source = previous.boundaryFrames.find((frame) => frame.role === 'end')
  if (!source) throw new Error('PREVIOUS_END_FRAME_MISSING')
  const linked: BoundaryFrame = {
    id: randomUUID(),
    role: 'start',
    mediaId: source.mediaId,
    mediaSha256: source.mediaSha256,
    sourceShotId: previous.id,
    ...(source.sourceCandidateId ? { sourceCandidateId: source.sourceCandidateId } : {}),
    sourceBoundaryFrameId: source.id,
    sourceRevision: previous.revision,
    provenance: 'linked_previous_end',
    createdAt: nowIso(),
  }
  return {
    ...current,
    boundaryFrames: [...current.boundaryFrames.filter((frame) => frame.role !== 'start'), linked],
    revision: current.revision + 1,
    staleFields: options.propagateStale === false
      ? current.staleFields
      : [...new Set([...current.staleFields, 'video', 'timeline', 'export'])],
    updatedAt: nowIso(),
  }
}

export const staleDependents: Readonly<Record<string, readonly string[]>> = {
  title: ['image', 'video', 'timeline', 'export'],
  description: ['image', 'video', 'timeline', 'export'],
  visualPrompt: ['image', 'video', 'timeline', 'export'],
  negativePrompt: ['image', 'video', 'timeline', 'export'],
  videoPrompt: ['video', 'timeline', 'export'],
  dialogue: ['voice', 'subtitle', 'timeline', 'export'],
  durationMs: ['subtitle', 'timeline', 'export'],
  beats: ['image', 'video', 'voice', 'subtitle', 'timeline', 'export'],
  assetBinding: ['image', 'video', 'timeline', 'export'],
  music: ['timeline', 'export'],
}

export function propagateStaleFields(changedFields: string[]): string[] {
  return [...new Set(changedFields.flatMap((field) => staleDependents[field] ?? []))]
}

export const sceneStaleDependents: Readonly<Record<string, readonly string[]>> = {
  title: ['image', 'video', 'timeline', 'export'],
  synopsis: ['image', 'video', 'timeline', 'export'],
}

export function propagateSceneStaleFields(changedFields: string[]): string[] {
  return [...new Set(changedFields.flatMap((field) => sceneStaleDependents[field] ?? []))]
}

const allowedTaskTransitions: Readonly<Record<GenerationTask['status'], readonly GenerationTask['status'][]>> = {
  queued: ['running', 'cancel_requested', 'cancelled'],
  running: ['succeeded', 'failed', 'cancel_requested', 'timed_out', 'orphaned', 'waiting_approval', 'outcome_unknown'],
  waiting_approval: ['running', 'cancelled'],
  retrying: ['running', 'failed', 'outcome_unknown'],
  succeeded: [],
  failed: ['retrying'],
  cancel_requested: ['cancelled', 'succeeded', 'failed', 'outcome_unknown'],
  cancelled: [],
  timed_out: ['retrying', 'reconciling', 'outcome_unknown'],
  orphaned: ['reconciling', 'failed', 'needs_attention'],
  reconciling: ['running', 'succeeded', 'failed', 'orphaned', 'outcome_unknown', 'needs_attention'],
  outcome_unknown: ['reconciling', 'succeeded', 'failed', 'needs_attention'],
  needs_attention: ['reconciling', 'retrying', 'cancelled'],
}

export function canTransitionTask(from: GenerationTask['status'], to: GenerationTask['status']): boolean {
  return allowedTaskTransitions[from].includes(to)
}

export function createDemoPlan(projectId: string, graphRevision: number): ExecutionPlan {
  const timestamp = nowIso()
  const runId = randomUUID()
  return {
    id: randomUUID(),
    projectId,
    runId,
    title: '从事件图谱推进到可预览成片',
    goal: '保持事件事实与角色连续性，生成一条可恢复、可审阅的短视频生产路径。',
    checkpointRevision: graphRevision,
    memoryCitationCount: 0,
    status: 'awaiting_approval',
    steps: [
      { id: randomUUID(), title: '审查章节事件', description: '检查原文覆盖、顺序和锁定事实。', action: 'analyze', risk: 'read_only', status: 'pending' },
      { id: randomUUID(), title: '生成场景与镜头', description: '从已确认事件创建场景、镜头和 Prompt revision。', action: 'write_scenes', risk: 'writes_project', status: 'pending' },
      { id: randomUUID(), title: '规划生产资产', description: '创建原创占位资产与候选，不调用外部 Provider。', action: 'plan_assets', risk: 'writes_project', status: 'pending' },
      { id: randomUUID(), title: '装配并导出', description: '生成时间线并等待用户确认导出。', action: 'export', risk: 'export', status: 'pending' },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

const node = (entityId: string, type: GraphNode['type'], label: string, subtitle: string, index: number, column: number, status: GraphNode['status'] = 'ready'): GraphNode => ({
  id: `${type}:${entityId}`,
  entityId,
  type,
  label,
  subtitle,
  status,
  position: { x: 80 + column * 310, y: 80 + index * 150 },
  metadata: {},
})

export function projectGraph(snapshot: ProjectSnapshot, view: GraphProjection['view']): GraphProjection {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  if (view === 'story') {
    nodes.push(node(snapshot.project.id, 'project', snapshot.project.name, '创意简报与项目约束', 0, snapshot.series ? 2 : snapshot.episode ? 1 : 0))
    if (snapshot.series) nodes.push(node(snapshot.series.id, 'series', snapshot.series.name, `Series revision ${snapshot.series.revision}`, 0, 0))
    if (snapshot.episode) nodes.push(node(snapshot.episode.id, 'episode', snapshot.episode.title, `Episode ${snapshot.episode.ordinal + 1}`, 0, snapshot.series ? 1 : 0))
    const offset = snapshot.series ? 3 : snapshot.episode ? 2 : 1
    snapshot.sources.forEach((source, index) => nodes.push(node(source.id, 'source', source.title, `原著 revision ${source.revision}`, index, offset)))
    snapshot.chapters.forEach((chapter, index) => nodes.push(node(chapter.id, 'chapter', chapter.title, chapter.summary.slice(0, 80), index, offset + 1)))
    snapshot.events.forEach((event, index) => nodes.push(node(event.id, 'event', event.title, event.type, index, offset + 2)))
    if (snapshot.series && snapshot.episode) edges.push({ id: `series:${snapshot.series.id}:episode:${snapshot.episode.id}`, source: `series:${snapshot.series.id}`, target: `episode:${snapshot.episode.id}`, type: 'contains', animated: false })
    if (snapshot.episode) edges.push({ id: `episode:${snapshot.episode.id}:project:${snapshot.project.id}`, source: `episode:${snapshot.episode.id}`, target: `project:${snapshot.project.id}`, type: 'produces', animated: false })
    snapshot.sources.forEach((source) => edges.push({ id: `project:${snapshot.project.id}:source:${source.id}`, source: `project:${snapshot.project.id}`, target: `source:${source.id}`, type: 'contains', animated: false }))
    snapshot.chapters.forEach((chapter) => edges.push({ id: `source:${chapter.sourceId}:chapter:${chapter.id}`, source: `source:${chapter.sourceId}`, target: `chapter:${chapter.id}`, type: 'contains', animated: false }))
    snapshot.events.forEach((event) => edges.push({ id: `chapter:${event.chapterId}:event:${event.id}`, source: `chapter:${event.chapterId}`, target: `event:${event.id}`, type: 'contains', animated: false }))
    snapshot.eventEdges.forEach((edge) => edges.push({ id: edge.id, source: `event:${edge.sourceEventId}`, target: `event:${edge.targetEventId}`, type: edge.type, label: edge.type, animated: edge.type === 'causes' }))
  } else if (view === 'production') {
    snapshot.scenes.forEach((scene, index) => nodes.push(node(scene.id, 'scene', scene.title, scene.synopsis.slice(0, 80), index, 0, scene.staleFields.length ? 'stale' : 'ready')))
    snapshot.shots.forEach((shot, index) => nodes.push(node(shot.id, 'shot', shot.title, `${(shot.durationMs / 1_000).toFixed(1)}s`, index, 1, shot.staleFields.length ? 'stale' : 'ready')))
    snapshot.resolvedAssets.forEach((asset, index) => nodes.push(node(asset.assetId, 'asset', asset.name, `${asset.type} · ${asset.source}`, index, 2, asset.drifted ? 'stale' : 'ready')))
    snapshot.candidates.forEach((candidate, index) => nodes.push(node(candidate.id, 'candidate', `${candidate.kind} 候选`, candidate.provider, index, 3, candidate.status === 'failed' ? 'failed' : 'ready')))
    snapshot.shots.forEach((shot) => edges.push({ id: `scene:${shot.sceneId}:shot:${shot.id}`, source: `scene:${shot.sceneId}`, target: `shot:${shot.id}`, type: 'contains', animated: false }))
    snapshot.assetBindings.forEach((binding) => edges.push({
      id: `shot:${binding.shotId}:asset:${binding.assetId}:${binding.slot}`,
      source: `shot:${binding.shotId}`, target: `asset:${binding.assetId}`, type: `uses:${binding.slot}`,
      label: binding.drifted ? `${binding.slot} · revision drift` : binding.slot, animated: binding.drifted,
    }))
    snapshot.candidates.forEach((candidate) => edges.push({ id: `shot:${candidate.shotId}:candidate:${candidate.id}`, source: `shot:${candidate.shotId}`, target: `candidate:${candidate.id}`, type: 'generated', animated: true }))
  } else {
    snapshot.shots.forEach((shot, index) => nodes.push(node(shot.id, 'track', shot.title, `${(shot.durationMs / 1_000).toFixed(1)}s`, index, 0, shot.selectedCandidateId ? 'selected' : 'warning')))
    snapshot.tasks.forEach((task, index) => nodes.push(node(task.id, 'task', task.stage, task.status, index, 1, task.status === 'failed' ? 'failed' : task.status === 'running' ? 'running' : 'ready')))
    snapshot.tasks.forEach((task) => edges.push({ id: `task-project:${task.id}`, source: `track:${snapshot.shots[0]?.id ?? task.projectId}`, target: `task:${task.id}`, type: 'executes', animated: task.status === 'running' }))
  }
  return { projectId: snapshot.project.id, view, revision: snapshot.project.graphRevision, nodes, edges, generatedAt: nowIso() }
}
