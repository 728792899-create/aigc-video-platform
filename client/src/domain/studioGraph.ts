export type StudioNodeKind =
  | 'topic'
  | 'script'
  | 'assets'
  | 'storyboard'
  | 'visuals'
  | 'voice'
  | 'subtitle'
  | 'timeline'
  | 'export'

export type StudioNodeStatus =
  | 'blocked'
  | 'ready'
  | 'running'
  | 'attention'
  | 'failed'
  | 'complete'

export interface StudioProjectSummary {
  id: string | number
  name: string
  theme?: string | null
  status?: string | null
  scriptContent?: string | null
}

export interface StudioShotSummary {
  id: string | number
  sceneNumber: number
  description: string
  hasSelectedImage: boolean
  hasVoice: boolean
  hasSubtitle: boolean
  stale: boolean
}

export interface StudioTaskSummary {
  id: string
  type: string
  status: string
  error?: string | null
  retryable: boolean
  currentStage?: string | null
}

export interface StudioGraphSnapshot {
  project: StudioProjectSummary
  storyboards: StudioShotSummary[]
  assetUnitCount: number
  bindingCount: number
  successfulExportCount: number
  staleStages: string[]
  tasks: StudioTaskSummary[]
}

export interface StudioGraphNode {
  id: string
  kind: StudioNodeKind
  status: StudioNodeStatus
  completed: number
  total: number
  stale: boolean
  route: string
  optional?: boolean
  diagnosis?: string | null
  taskId?: string | null
  retryable?: boolean
}

export interface StudioGraphEdge {
  id: string
  source: string
  target: string
  state: 'active' | 'blocked' | 'stale'
}

export interface StudioGraph {
  projectId: string
  nodes: StudioGraphNode[]
  edges: StudioGraphEdge[]
}

const ORDER: StudioNodeKind[] = [
  'topic',
  'script',
  'assets',
  'storyboard',
  'visuals',
  'voice',
  'subtitle',
  'timeline',
  'export',
]

const TASK_MATCHERS: Record<StudioNodeKind, RegExp> = {
  topic: /topic|theme/i,
  script: /script|storyboard-generate/i,
  assets: /asset|character|scene|prop|style/i,
  storyboard: /storyboard|shot/i,
  visuals: /image|visual|t2i/i,
  voice: /voice|tts|audio/i,
  subtitle: /subtitle|caption/i,
  timeline: /timeline|assembly/i,
  export: /export|compose|video|auto-produce/i,
}

const RUNNING_TASK_STATES = new Set([
  'pending',
  'waiting',
  'queued',
  'running',
  'composing',
  'retrying',
  'resumed',
  'reconciling',
  'cancel_requested',
])
const FAILED_TASK_STATES = new Set(['failed', 'timed_out', 'orphaned'])

function stageId(projectId: string, kind: StudioNodeKind): string {
  return `project:${projectId}:${kind}`
}

function countWhere<T>(values: T[], predicate: (value: T) => boolean): number {
  return values.reduce((count, value) => count + (predicate(value) ? 1 : 0), 0)
}

function normalizedStage(value: string): StudioNodeKind | null {
  const stage = value.toLowerCase()
  if (stage === 'image') return 'visuals'
  if (stage === 'audio' || stage === 'tts') return 'voice'
  if (stage === 'video' || stage === 'compose') return 'export'
  return ORDER.find((kind) => kind === stage) ?? null
}

function taskForKind(kind: StudioNodeKind, tasks: StudioTaskSummary[]): StudioTaskSummary | undefined {
  const relevant = tasks.filter((task) => {
    const explicitStage = task.currentStage ? normalizedStage(task.currentStage) : null
    return explicitStage ? explicitStage === kind : TASK_MATCHERS[kind].test(task.type)
  })
  return relevant.find((task) => RUNNING_TASK_STATES.has(task.status))
    ?? relevant.find((task) => FAILED_TASK_STATES.has(task.status))
    ?? relevant.find((task) => task.status === 'partial')
}

function applyTask(node: StudioGraphNode, tasks: StudioTaskSummary[]): StudioGraphNode {
  const task = taskForKind(node.kind, tasks)
  if (!task) return node
  if (RUNNING_TASK_STATES.has(task.status)) {
    return { ...node, status: 'running', taskId: task.id, retryable: false }
  }
  if (FAILED_TASK_STATES.has(task.status)) {
    return {
      ...node,
      status: 'failed',
      diagnosis: task.error || (task.status === 'orphaned' ? '任务结果待核对，避免重复提交。' : '任务失败，可查看诊断。'),
      taskId: task.id,
      retryable: task.retryable,
    }
  }
  return { ...node, status: 'attention', taskId: task.id, retryable: task.retryable }
}

function baseNode(
  projectId: string,
  kind: StudioNodeKind,
  status: StudioNodeStatus,
  completed: number,
  total: number,
  route: string,
  options: Pick<StudioGraphNode, 'stale' | 'optional'> = { stale: false },
): StudioGraphNode {
  return {
    id: stageId(projectId, kind),
    kind,
    status,
    completed,
    total,
    route,
    stale: options.stale,
    optional: options.optional,
    diagnosis: null,
    taskId: null,
    retryable: false,
  }
}

export function buildStudioGraph(snapshot: StudioGraphSnapshot): StudioGraph {
  const projectId = String(snapshot.project.id)
  const shots = snapshot.storyboards
  const shotCount = shots.length
  const imageCount = countWhere(shots, (shot) => shot.hasSelectedImage)
  const voiceCount = countWhere(shots, (shot) => shot.hasVoice)
  const subtitleCount = countWhere(shots, (shot) => shot.hasSubtitle)
  const staleKinds = new Set(snapshot.staleStages.map(normalizedStage).filter((kind): kind is StudioNodeKind => kind !== null))
  if (shots.some((shot) => shot.stale)) staleKinds.add('storyboard')

  const topicReady = Boolean(snapshot.project.theme?.trim())
  const scriptReady = Boolean(snapshot.project.scriptContent?.trim()) || shotCount > 0
  const storyboardStatus: StudioNodeStatus = shotCount === 0
    ? (scriptReady ? 'ready' : 'blocked')
    : staleKinds.has('storyboard') ? 'attention' : 'complete'
  const visualStatus: StudioNodeStatus = shotCount === 0
    ? 'blocked'
    : imageCount === shotCount ? 'complete'
      : imageCount > 0 ? 'attention' : 'ready'
  const voiceStatus: StudioNodeStatus = shotCount === 0
    ? 'blocked'
    : voiceCount === shotCount ? 'complete'
      : voiceCount > 0 ? 'attention' : 'ready'
  const subtitleStatus: StudioNodeStatus = shotCount === 0
    ? 'blocked'
    : subtitleCount === shotCount ? 'complete'
      : subtitleCount > 0 ? 'attention' : 'ready'
  const exported = snapshot.successfulExportCount > 0
  const assemblyReady = visualStatus === 'complete' && voiceStatus === 'complete' && subtitleStatus === 'complete'
  const timelineStatus: StudioNodeStatus = exported ? 'complete' : assemblyReady ? 'ready' : 'blocked'
  const exportStatus: StudioNodeStatus = exported ? 'complete' : timelineStatus === 'ready' ? 'ready' : 'blocked'

  const routes: Record<StudioNodeKind, string> = {
    topic: `/projects/${projectId}/script`,
    script: `/projects/${projectId}/script`,
    assets: `/projects/${projectId}/assets`,
    storyboard: `/projects/${projectId}/script`,
    visuals: `/projects/${projectId}/images`,
    voice: `/projects/${projectId}/audio`,
    subtitle: `/projects/${projectId}/audio`,
    timeline: `/projects/${projectId}/preview`,
    export: `/projects/${projectId}/preview`,
  }

  const nodes = [
    baseNode(projectId, 'topic', topicReady ? 'complete' : 'ready', topicReady ? 1 : 0, 1, routes.topic, { stale: staleKinds.has('topic') }),
    baseNode(projectId, 'script', scriptReady ? 'complete' : topicReady ? 'ready' : 'blocked', scriptReady ? 1 : 0, 1, routes.script, { stale: staleKinds.has('script') }),
    baseNode(
      projectId,
      'assets',
      snapshot.assetUnitCount > 0 ? 'complete' : scriptReady ? 'ready' : 'blocked',
      snapshot.bindingCount,
      Math.max(snapshot.assetUnitCount, 1),
      routes.assets,
      { stale: staleKinds.has('assets'), optional: true },
    ),
    baseNode(projectId, 'storyboard', storyboardStatus, shotCount, Math.max(shotCount, 1), routes.storyboard, { stale: staleKinds.has('storyboard') }),
    baseNode(projectId, 'visuals', visualStatus, imageCount, Math.max(shotCount, 1), routes.visuals, { stale: staleKinds.has('visuals') }),
    baseNode(projectId, 'voice', voiceStatus, voiceCount, Math.max(shotCount, 1), routes.voice, { stale: staleKinds.has('voice') }),
    baseNode(projectId, 'subtitle', subtitleStatus, subtitleCount, Math.max(shotCount, 1), routes.subtitle, { stale: staleKinds.has('subtitle') }),
    baseNode(projectId, 'timeline', timelineStatus, timelineStatus === 'complete' ? 1 : 0, 1, routes.timeline, { stale: staleKinds.has('timeline') }),
    baseNode(projectId, 'export', exportStatus, snapshot.successfulExportCount, Math.max(snapshot.successfulExportCount, 1), routes.export, { stale: staleKinds.has('export') }),
  ].map((node) => applyTask(node, snapshot.tasks))

  const dependencies: Array<[StudioNodeKind, StudioNodeKind]> = [
    ['topic', 'script'],
    ['script', 'assets'],
    ['script', 'storyboard'],
    ['assets', 'visuals'],
    ['storyboard', 'visuals'],
    ['storyboard', 'voice'],
    ['storyboard', 'subtitle'],
    ['visuals', 'timeline'],
    ['voice', 'timeline'],
    ['subtitle', 'timeline'],
    ['timeline', 'export'],
  ]
  const byKind = new Map(nodes.map((node) => [node.kind, node]))
  const edges = dependencies.map(([sourceKind, targetKind]) => {
    const source = stageId(projectId, sourceKind)
    const target = stageId(projectId, targetKind)
    const targetNode = byKind.get(targetKind)
    const sourceNode = byKind.get(sourceKind)
    return {
      id: `${source}->${target}`,
      source,
      target,
      state: sourceNode?.stale || targetNode?.stale
        ? 'stale' as const
        : targetNode?.status === 'blocked' ? 'blocked' as const : 'active' as const,
    }
  })

  return { projectId, nodes, edges }
}

export function findNextStudioNode(graph: StudioGraph): StudioGraphNode | null {
  const actionable = new Set<StudioNodeStatus>(['failed', 'attention', 'ready', 'running'])
  return graph.nodes.find((node) => actionable.has(node.status) && !(node.optional && node.status === 'ready')) ?? null
}
