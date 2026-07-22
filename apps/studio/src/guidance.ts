import type { ExecutionPlan, GenerationTask } from '@aigc-director/contracts'

export type StudioGuideStageId = 'project' | 'source' | 'plan' | 'approval' | 'candidates' | 'review' | 'export'
export type StudioGuideAction = 'open-project' | 'open-source' | 'create-plan' | 'open-plan' | 'produce-demo' | 'open-review' | 'open-delivery' | 'open-tasks'

export type StudioGuideInput = {
  hasProject: boolean
  sourceCount: number
  eventCount: number
  shotCount: number
  selectedShotCount: number
  candidateCount: number
  planStatus?: ExecutionPlan['status'] | undefined
  tasks: GenerationTask[]
}

export type StudioGuideStage = {
  id: StudioGuideStageId
  label: string
  completed: boolean
  current: boolean
}

export type StudioGuideResult = {
  stages: StudioGuideStage[]
  activeStage: StudioGuideStage
  completedCount: number
  isComplete: boolean
  title: string
  description: string
  completion: string
  metric: string
  action: StudioGuideAction
  actionLabel: string
  interruption?: {
    kind: 'unknown' | 'failed'
    taskId: string
    stage: string
  }
}

const definitions: ReadonlyArray<{ id: StudioGuideStageId; label: string }> = [
  { id: 'project', label: '项目' },
  { id: 'source', label: '原著' },
  { id: 'plan', label: '计划' },
  { id: 'approval', label: '批准' },
  { id: 'candidates', label: '生成' },
  { id: 'review', label: '审阅' },
  { id: 'export', label: '导出' },
]

const taskNeedsReconcile = (task: GenerationTask): boolean => ['outcome_unknown', 'orphaned', 'reconciling', 'needs_attention'].includes(task.status)
const taskFailed = (task: GenerationTask): boolean => task.retryable && ['failed', 'timed_out'].includes(task.status)

function newestTask(tasks: GenerationTask[], predicate: (task: GenerationTask) => boolean): GenerationTask | undefined {
  return [...tasks].filter(predicate).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export function deriveStudioGuide(input: StudioGuideInput): StudioGuideResult {
  const planCreated = Boolean(input.planStatus) || input.shotCount > 0
  const planApproved = ['approved', 'running', 'succeeded'].includes(input.planStatus ?? '') || input.shotCount > 0
  const candidatesReady = input.candidateCount > 0
  const reviewComplete = input.shotCount > 0 && input.selectedShotCount === input.shotCount
  const exportSucceeded = input.tasks.some((task) => task.type === 'export' && task.status === 'succeeded')
  const completed = [input.hasProject, input.sourceCount > 0 && input.eventCount > 0, planCreated, planApproved, candidatesReady, reviewComplete, exportSucceeded]
  const firstIncomplete = completed.findIndex((value) => !value)
  const activeIndex = firstIncomplete === -1 ? definitions.length - 1 : firstIncomplete
  const stages = definitions.map((definition, index) => ({
    ...definition,
    completed: completed[index] ?? false,
    current: index === activeIndex,
  }))
  const activeStage = stages[activeIndex]!
  const base = {
    stages,
    activeStage,
    completedCount: completed.filter(Boolean).length,
    isComplete: exportSucceeded,
  }

  if (!exportSucceeded) {
    const unknown = newestTask(input.tasks, taskNeedsReconcile)
    if (unknown) return {
      ...base,
      title: '先确认未知任务的真实结果',
      description: '任务结果尚未确定，禁止直接重复提交。打开任务中心查看诊断并先执行对账。',
      completion: '完成条件：任务变为已完成、失败或需要人工处理',
      metric: `${unknown.stage} · ${unknown.status}`,
      action: 'open-tasks',
      actionLabel: unknown.status === 'reconciling' ? '查看对账进度' : '打开任务中心并对账',
      interruption: { kind: 'unknown', taskId: unknown.id, stage: unknown.stage },
    }
    const failed = newestTask(input.tasks, taskFailed)
    if (failed) return {
      ...base,
      title: '先修复失败的任务',
      description: '原任务、attempt 和诊断证据已经保留；确认原因后只重试失败阶段。',
      completion: '完成条件：失败阶段产生新的成功 attempt，或明确取消',
      metric: `${failed.stage} · attempt ${failed.attempt}`,
      action: 'open-tasks',
      actionLabel: '诊断并重试失败项',
      interruption: { kind: 'failed', taskId: failed.id, stage: failed.stage },
    }
  }

  const content: Record<StudioGuideStageId, Pick<StudioGuideResult, 'title' | 'description' | 'completion' | 'metric' | 'action' | 'actionLabel'>> = {
    project: {
      title: '先创建或打开一个项目',
      description: '项目是脚本、媒体、任务快照和崩溃恢复的边界。',
      completion: '完成条件：顶部显示当前项目名称',
      metric: '尚未选择项目',
      action: 'open-project',
      actionLabel: '创建或打开项目',
    },
    source: {
      title: '导入原著，建立可追溯事件图',
      description: '先粘贴文本或隔离预览 TXT/Markdown；确认前不会写入项目。',
      completion: '完成条件：至少 1 个来源，并提取出事件',
      metric: `${input.sourceCount} 个来源 · ${input.eventCount} 个事件`,
      action: 'open-source',
      actionLabel: '导入原著',
    },
    plan: {
      title: '让导演 Agent 先生成制作计划',
      description: '计划会列出写入范围、风险和持久检查点，生成后仍需你批准。',
      completion: '完成条件：出现可审查的计划与 checkpoint',
      metric: `${input.eventCount} 个事件可用于规划`,
      action: 'create-plan',
      actionLabel: '生成制作计划',
    },
    approval: {
      title: '检查计划后再批准写入',
      description: '批准会创建场景和镜头；此步骤不会调用付费 Provider。',
      completion: '完成条件：计划状态变为 approved，并生成镜头',
      metric: `计划状态：${input.planStatus ?? '未生成'}`,
      action: 'open-plan',
      actionLabel: '检查并批准计划',
    },
    candidates: {
      title: '生成零 Key Demo 候选',
      description: '使用本地确定性占位素材验证生产链路，付费请求始终为 0。',
      completion: '完成条件：每个镜头至少产生一个可审阅候选',
      metric: `${input.shotCount} 个镜头 · ${input.candidateCount} 个候选`,
      action: 'produce-demo',
      actionLabel: '生成零 Key Demo 候选',
    },
    review: {
      title: '为每个镜头批准一个候选',
      description: '先比较、收藏和查看证据，再把最终候选绑定到镜头。',
      completion: '完成条件：所有镜头都显示“已批准”候选',
      metric: `${input.selectedShotCount} / ${input.shotCount} 个镜头已完成`,
      action: 'open-review',
      actionLabel: '审阅并批准候选',
    },
    export: exportSucceeded ? {
      title: '本轮创作已完成',
      description: '本地导出任务已成功，任务证据和项目快照可用于恢复与复查。',
      completion: '完成条件：导出任务已完成',
      metric: '成功导出 · 付费请求 0',
      action: 'open-delivery',
      actionLabel: '查看交付结果',
    } : {
      title: '完成预检并导出本地成片',
      description: '选择目录后先检查镜头、规格、费用与装配 hash，再明确确认导出。',
      completion: '完成条件：本地导出任务状态为 succeeded',
      metric: `${input.selectedShotCount} 个已选镜头可装配`,
      action: 'open-delivery',
      actionLabel: '前往导出',
    },
  }

  return { ...base, ...content[activeStage.id] }
}
