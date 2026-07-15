export const STAGES = [
  'topic',
  'script',
  'storyboard',
  'image',
  'voice',
  'subtitle',
  'timeline',
  'export',
] as const

export type WorkflowStage = (typeof STAGES)[number]
export type StageStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'skipped' | 'partial' | 'failed' | 'canceled'

export interface WorkflowStageRecord {
  status: StageStatus
  attempts: number
  progress: number
  output: unknown
  error: string | null
  started_at: number | null
  completed_at: number | null
  updated_at: number
}

export interface WorkflowState {
  version: number
  project_id: number | null
  current_stage: WorkflowStage | null
  stages: Record<WorkflowStage, WorkflowStageRecord>
  created_at: number
  updated_at: number
}

interface WorkflowOptions {
  projectId?: unknown
  topic?: unknown
  stages?: readonly WorkflowStage[]
}

type JsonObject = Record<string, unknown>

const TERMINAL = new Set<StageStatus>(['succeeded', 'skipped', 'partial'])
const RESUMABLE = new Set<StageStatus>(['ready', 'running', 'failed', 'partial', 'canceled'])

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStage(value: unknown): value is WorkflowStage {
  return typeof value === 'string' && STAGES.some((stage) => stage === value)
}

function isStatus(value: unknown): value is StageStatus {
  return typeof value === 'string' && [
    'pending', 'ready', 'running', 'succeeded', 'skipped', 'partial', 'failed', 'canceled',
  ].includes(value)
}

function now(): number {
  return Date.now()
}

function clone(value: unknown): unknown {
  return structuredClone(value)
}

function stageRecord(status: StageStatus = 'pending'): WorkflowStageRecord {
  return {
    status,
    attempts: 0,
    progress: status === 'succeeded' ? 100 : 0,
    output: null,
    error: null,
    started_at: null,
    completed_at: status === 'succeeded' ? now() : null,
    updated_at: now(),
  }
}

function stageRecords(): Record<WorkflowStage, WorkflowStageRecord> {
  return {
    topic: stageRecord(),
    script: stageRecord(),
    storyboard: stageRecord(),
    image: stageRecord(),
    voice: stageRecord(),
    subtitle: stageRecord(),
    timeline: stageRecord(),
    export: stageRecord(),
  }
}

function normalizeStageRecord(value: unknown): WorkflowStageRecord {
  const base = stageRecord()
  if (!isJsonObject(value)) return base
  return {
    status: isStatus(value.status) ? value.status : base.status,
    attempts: Math.max(0, Number(value.attempts) || 0),
    progress: Math.max(0, Math.min(100, Number(value.progress) || 0)),
    output: value.output === undefined ? null : clone(value.output),
    error: value.error == null ? null : String(value.error),
    started_at: value.started_at == null ? null : Number(value.started_at),
    completed_at: value.completed_at == null ? null : Number(value.completed_at),
    updated_at: Number(value.updated_at) || base.updated_at,
  }
}

export function createWorkflow({ projectId, topic = '', stages = STAGES }: WorkflowOptions = {}): WorkflowState {
  const requestedStages = stages.length ? [...stages] : [...STAGES]
  const records = stageRecords()
  for (const [index, stage] of requestedStages.entries()) {
    records[stage] = stageRecord(index === 0 ? 'succeeded' : index === 1 ? 'ready' : 'pending')
  }
  records.topic.output = { topic: String(topic || '') }
  return {
    version: 1,
    project_id: Number(projectId) || null,
    current_stage: requestedStages[1] || requestedStages[0] || null,
    stages: records,
    created_at: now(),
    updated_at: now(),
  }
}

export function normalizeWorkflow(input: unknown, options: WorkflowOptions = {}): WorkflowState {
  const base = createWorkflow(options)
  if (!isJsonObject(input)) return base
  const inputStages = isJsonObject(input.stages) ? input.stages : {}
  const stages = stageRecords()
  for (const stage of STAGES) stages[stage] = normalizeStageRecord(inputStages[stage])
  return {
    version: Number(input.version) || base.version,
    project_id: Number(input.project_id) || base.project_id,
    current_stage: isStage(input.current_stage) ? input.current_stage : base.current_stage,
    stages,
    created_at: Number(input.created_at) || base.created_at,
    updated_at: Number(input.updated_at) || base.updated_at,
  }
}

function previousStage(stage: WorkflowStage): WorkflowStage | null {
  const index = STAGES.indexOf(stage)
  return index > 0 ? STAGES[index - 1] ?? null : null
}

function assertPrerequisite(workflow: WorkflowState, stage: WorkflowStage): void {
  const previous = previousStage(stage)
  if (!previous) return
  if (!TERMINAL.has(workflow.stages[previous].status)) throw new Error(`前置阶段 ${previous} 尚未完成`)
}

function makeReady(workflow: WorkflowState, stage: WorkflowStage | undefined): void {
  if (!stage) return
  const record = workflow.stages[stage]
  if (record.status === 'pending') {
    record.status = 'ready'
    record.updated_at = now()
  }
}

export function transition(input: unknown, event: unknown): WorkflowState {
  const rawInput = isJsonObject(input) ? input : {}
  const workflow = normalizeWorkflow(input, { projectId: rawInput.project_id })
  if (!isJsonObject(event) || !isStage(event.stage) || typeof event.type !== 'string') {
    throw new Error('工作流事件缺少有效 type 或 stage')
  }
  const stage = event.stage
  const record = workflow.stages[stage]
  const timestamp = now()

  switch (event.type) {
    case 'START':
      assertPrerequisite(workflow, stage)
      if (!RESUMABLE.has(record.status)) throw new Error(`阶段 ${stage} 当前不可启动：${record.status}`)
      record.status = 'running'
      record.attempts = record.attempts || 1
      record.progress = Math.max(1, Number(event.progress) || 1)
      record.started_at = timestamp
      record.error = null
      break
    case 'PROGRESS':
      if (record.status !== 'running') throw new Error(`阶段 ${stage} 未在运行`)
      record.progress = Math.max(0, Math.min(99, Math.round(Number(event.progress) || 0)))
      if (event.output !== undefined) record.output = clone(event.output)
      break
    case 'SUCCEED':
    case 'SKIP': {
      if (!['running', 'ready', 'partial'].includes(record.status)) throw new Error(`阶段 ${stage} 当前不可完成：${record.status}`)
      record.status = event.type === 'SKIP' ? 'skipped' : 'succeeded'
      record.progress = 100
      record.output = event.output === undefined ? record.output : clone(event.output)
      record.error = null
      record.completed_at = timestamp
      const next = STAGES[STAGES.indexOf(stage) + 1]
      makeReady(workflow, next)
      workflow.current_stage = next || stage
      break
    }
    case 'PARTIAL':
      record.status = 'partial'
      record.progress = Math.max(1, Math.min(99, Math.round(Number(event.progress) || record.progress || 1)))
      record.output = event.output === undefined ? record.output : clone(event.output)
      record.error = String(event.error || '阶段部分完成')
      record.completed_at = timestamp
      makeReady(workflow, STAGES[STAGES.indexOf(stage) + 1])
      workflow.current_stage = stage
      break
    case 'FAIL':
      record.status = 'failed'
      record.error = String(event.error || '阶段失败')
      record.completed_at = timestamp
      workflow.current_stage = stage
      break
    case 'CANCEL':
      record.status = 'canceled'
      record.error = null
      record.completed_at = timestamp
      workflow.current_stage = stage
      break
    case 'RETRY':
      if (!['failed', 'partial', 'canceled'].includes(record.status)
        && !(event.allowUncertain === true && record.status === 'running')) {
        throw new Error(`阶段 ${stage} 当前不可重试：${record.status}`)
      }
      assertPrerequisite(workflow, stage)
      record.status = 'ready'
      record.attempts += 1
      record.progress = 0
      record.error = null
      record.completed_at = null
      for (const downstream of STAGES.slice(STAGES.indexOf(stage) + 1)) workflow.stages[downstream] = stageRecord('pending')
      workflow.current_stage = stage
      break
    default:
      throw new Error(`未知工作流事件 ${event.type}`)
  }

  record.updated_at = timestamp
  workflow.updated_at = timestamp
  return workflow
}

export function nextRunnableStage(input: unknown): WorkflowStage | null {
  const raw = isJsonObject(input) ? input : {}
  const workflow = normalizeWorkflow(input, { projectId: raw.project_id })
  return STAGES.find((stage) => RESUMABLE.has(workflow.stages[stage].status)) || null
}

export function canResume(workflow: unknown): boolean {
  return Boolean(nextRunnableStage(workflow))
}
