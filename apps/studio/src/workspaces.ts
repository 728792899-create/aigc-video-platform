import type { GraphNode, GraphProjection } from '@aigc-director/contracts'

export type StudioWorkspaceId =
  | 'project_center'
  | 'project_setup'
  | 'brief'
  | 'script'
  | 'assets'
  | 'shots'
  | 'continuity'
  | 'generation'
  | 'review'
  | 'timeline'
  | 'canvas'
  | 'prompt_skill'
  | 'tasks'
  | 'provider_connections'
  | 'local_governance'
  | 'export_settings'

export type StudioWorkspacePrerequisite =
  | 'none'
  | 'project'
  | 'source'
  | 'plan'
  | 'shots'
  | 'candidates'
  | 'approved_candidates'

export type StudioWorkspaceDefinition = {
  id: StudioWorkspaceId
  domainView: GraphProjection['view']
  prerequisite: StudioWorkspacePrerequisite
  previous?: StudioWorkspaceId
  next?: StudioWorkspaceId
  primaryAction: string
  helpTopic: string
  title: string
  shortTitle: string
  description: string
  completion: string
  implementation: 'implemented' | 'partial' | 'planned'
  currentAlternative?: string
}

export type StudioWorkspaceFacts = {
  hasProject: boolean
  hasSource: boolean
  hasPlan: boolean
  hasShots: boolean
  hasCandidates: boolean
  hasApprovedCandidates: boolean
}

export type StudioWorkspaceAvailability = {
  available: boolean
  reason?: string
  alternativeWorkspace?: StudioWorkspaceId
}

export const STUDIO_WORKSPACES = [
  {
    id: 'project_center', domainView: 'story', prerequisite: 'none', next: 'project_setup',
    primaryAction: '创建或打开项目', helpTopic: '项目、备份与恢复', title: '项目中心', shortTitle: '项目',
    description: '打开最近项目、恢复现场，或从零 Key Demo 开始。', completion: '已选择一个可正常读取的项目。', implementation: 'partial',
  },
  {
    id: 'project_setup', domainView: 'story', prerequisite: 'none', previous: 'project_center', next: 'brief',
    primaryAction: '打开项目创建与导入', helpTopic: '新建项目与安全导入', title: '新建项目向导', shortTitle: '新建',
    description: '创建空项目、打开 Demo，或通过隔离预览导入项目包。', completion: '项目已创建且未留下失败残留。', implementation: 'partial',
  },
  {
    id: 'brief', domainView: 'story', prerequisite: 'project', previous: 'project_setup', next: 'script',
    primaryAction: '编辑并批准创作简报', helpTopic: '创作简报、候选与字段锁', title: '创作简报', shortTitle: '简报',
    description: '把创作意图整理为可审阅的结构化约束，并批准唯一当前版本。', completion: '简报已保存；需要时完成候选批准。', implementation: 'partial',
  },
  {
    id: 'script', domainView: 'story', prerequisite: 'project', previous: 'brief', next: 'assets',
    primaryAction: '导入原著并生成故事结构', helpTopic: '原著隔离导入与剧本结构', title: '剧本编辑器', shortTitle: '剧本',
    description: '从来源、章节、事件和场景组织可追踪的改编结构。', completion: '至少存在一个已确认来源与可追踪事件。', implementation: 'partial',
  },
  {
    id: 'assets', domainView: 'production', prerequisite: 'source', previous: 'script', next: 'shots',
    primaryAction: '检查资产与镜头绑定', helpTopic: '资产作用域、变体与绑定', title: '资产库', shortTitle: '资产',
    description: '管理人物、场景、道具与跨集共享资产的版本和绑定。', completion: '生产所需资产可用，漂移项已修复或明确保留。', implementation: 'partial',
  },
  {
    id: 'shots', domainView: 'production', prerequisite: 'source', previous: 'assets', next: 'continuity',
    primaryAction: '生成或检查制作计划', helpTopic: '分镜、节拍与制作计划', title: '分镜导演工作区', shortTitle: '分镜',
    description: '审批制作计划，组织 Shot/Beat，并批量检查镜头事实。', completion: '制作计划已批准且至少存在一个镜头。', implementation: 'partial',
  },
  {
    id: 'continuity', domainView: 'production', prerequisite: 'shots', previous: 'shots', next: 'generation',
    primaryAction: '检查镜头连续性', helpTopic: '边界帧与连续性冲突', title: '连续性检查器', shortTitle: '连续性',
    description: '对照首尾帧、事实和资产 revision，发现跨镜头冲突。', completion: '阻断性连续性问题已处理或记录为已知风险。', implementation: 'partial',
  },
  {
    id: 'generation', domainView: 'production', prerequisite: 'shots', previous: 'continuity', next: 'review',
    primaryAction: '选择镜头并确认生成方式', helpTopic: '生成策略、成本与任务语义', title: '图像与视频生成', shortTitle: '生成',
    description: '在提交前确认编译结果、Provider、预算和批次范围。', completion: '候选批次已有可审阅结果；部分失败保留诊断。', implementation: 'partial',
  },
  {
    id: 'review', domainView: 'production', prerequisite: 'candidates', previous: 'generation', next: 'timeline',
    primaryAction: '审阅并采用镜头候选', helpTopic: '候选证据与失败项重试', title: '候选审阅', shortTitle: '审阅',
    description: '比较候选、检查证据，为每个镜头选择唯一 active take。', completion: '全部镜头均已选择候选。', implementation: 'partial',
  },
  {
    id: 'timeline', domainView: 'delivery', prerequisite: 'approved_candidates', previous: 'review', next: 'export_settings',
    primaryAction: '检查装配与导出预检', helpTopic: '时间线装配与媒体缺失', title: '音频字幕时间线', shortTitle: '时间线',
    description: '检查 canonical assembly、已选候选、音频与字幕轨道。', completion: '装配满足导出预检要求。', implementation: 'partial',
    currentAlternative: '自由剪辑尚未开放；当前可检查规范化装配与导出预检。',
  },
  {
    id: 'canvas', domainView: 'story', prerequisite: 'project',
    primaryAction: '查看领域图与检查器', helpTopic: '领域图、列表与节点状态', title: '可视化制作画布', shortTitle: '画布',
    description: '在 Story、Production、Delivery 领域图之间追踪对象与依赖。', completion: '已定位当前任务对应的领域对象与状态。', implementation: 'implemented',
  },
  {
    id: 'prompt_skill', domainView: 'story', prerequisite: 'project',
    primaryAction: '打开 Prompt 与 Skill 管理', helpTopic: '不可变 revision、评测与回滚', title: 'Prompt 与 Skill', shortTitle: 'Prompt',
    description: '检查 revision、diff、黄金评测、发布、LKG 与追加式回滚。', completion: '当前发布版本、评测证据和回滚路径明确。', implementation: 'partial',
  },
  {
    id: 'tasks', domainView: 'production', prerequisite: 'project',
    primaryAction: '打开任务诊断与恢复', helpTopic: '任务、Attempt、对账与恢复', title: '任务中心与诊断', shortTitle: '任务',
    description: '查看任务进度、Attempt、稳定错误码，并处理失败或未知结果。', completion: '阻断任务已成功、取消或进入明确的人工处理状态。', implementation: 'partial',
  },
  {
    id: 'provider_connections', domainView: 'production', prerequisite: 'none',
    primaryAction: '管理本机 Provider 连接', helpTopic: 'Provider 市场、模型能力与密钥边界', title: 'Provider 与模型连接', shortTitle: 'Provider',
    description: '配置本机私有连接、测试模型能力，并为项目绑定明确的生成模型。', completion: '所需连接已通过安全测试，或继续使用零 Key Demo。', implementation: 'partial',
  },
  {
    id: 'local_governance', domainView: 'delivery', prerequisite: 'none',
    primaryAction: '检查本地安全与备份', helpTopic: '凭证库、数据目录、审计与恢复', title: '本地安全、恢复与备份', shortTitle: '本地安全',
    description: '检查系统凭证库、数据完整性、恢复点、脱敏诊断与本地备份。', completion: '凭证和数据状态健康，最近备份可验证恢复。', implementation: 'partial',
  },
  {
    id: 'export_settings', domainView: 'delivery', prerequisite: 'project', previous: 'timeline',
    primaryAction: '打开导出预检与设置', helpTopic: '导出、凭证、备份与隐私', title: '导出与设置', shortTitle: '导出',
    description: '完成本地导出预检，并管理生成策略、凭证、备份和安全审计。', completion: '导出成功，或预检问题有明确修复入口。', implementation: 'partial',
  },
] as const satisfies ReadonlyArray<StudioWorkspaceDefinition>

const workspaceMap = new Map<StudioWorkspaceId, StudioWorkspaceDefinition>(
  STUDIO_WORKSPACES.map((workspace) => [workspace.id, workspace]),
)

export const STUDIO_WORKSPACE_IDS = STUDIO_WORKSPACES.map((workspace) => workspace.id)

export function isStudioWorkspaceId(value: unknown): value is StudioWorkspaceId {
  return typeof value === 'string' && workspaceMap.has(value as StudioWorkspaceId)
}

export function workspaceById(id: StudioWorkspaceId): StudioWorkspaceDefinition {
  return workspaceMap.get(id)!
}

export function workspaceForLegacyView(view: GraphProjection['view']): StudioWorkspaceId {
  if (view === 'production') return 'shots'
  if (view === 'delivery') return 'timeline'
  return 'canvas'
}

const workspaceNodeTypes: Partial<Record<StudioWorkspaceId, ReadonlySet<GraphNode['type']>>> = {
  project_center: new Set(['series', 'episode', 'project', 'task']),
  project_setup: new Set(['project']),
  brief: new Set(['project']),
  script: new Set(['source', 'chapter', 'event', 'scene']),
  assets: new Set(['character', 'style', 'asset', 'shot']),
  shots: new Set(['plan', 'scene', 'shot']),
  continuity: new Set(['shot', 'asset', 'candidate']),
  generation: new Set(['shot', 'candidate', 'task']),
  review: new Set(['shot', 'candidate']),
  timeline: new Set(['track', 'candidate', 'task', 'export']),
  tasks: new Set(['task']),
  local_governance: new Set(['project', 'task', 'export']),
  export_settings: new Set(['track', 'candidate', 'task', 'export']),
}

export function focusGraphForWorkspace(graph: GraphProjection, workspaceId: StudioWorkspaceId): GraphProjection {
  const allowed = workspaceNodeTypes[workspaceId]
  if (!allowed || workspaceId === 'canvas') return graph
  const nodes = graph.nodes.filter((node) => allowed.has(node.type))
  const nodeIds = new Set(nodes.map((node) => node.id))
  return { ...graph, nodes, edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)) }
}

export function workspaceAvailability(
  workspace: StudioWorkspaceDefinition,
  facts: StudioWorkspaceFacts,
): StudioWorkspaceAvailability {
  const requirements: Record<StudioWorkspacePrerequisite, { met: boolean; reason?: string; alternativeWorkspace?: StudioWorkspaceId }> = {
    none: { met: true },
    project: { met: facts.hasProject, reason: '请先创建或打开项目。', alternativeWorkspace: 'project_center' },
    source: { met: facts.hasSource, reason: '请先导入并确认原著来源。', alternativeWorkspace: facts.hasProject ? 'script' : 'project_center' },
    plan: { met: facts.hasPlan, reason: '请先生成并批准制作计划。', alternativeWorkspace: facts.hasSource ? 'shots' : 'script' },
    shots: { met: facts.hasShots, reason: '请先批准制作计划并生成镜头。', alternativeWorkspace: facts.hasSource ? 'shots' : 'script' },
    candidates: { met: facts.hasCandidates, reason: '请先生成可审阅的候选素材。', alternativeWorkspace: facts.hasShots ? 'generation' : 'shots' },
    approved_candidates: { met: facts.hasApprovedCandidates, reason: '请先为全部镜头采用候选素材。', alternativeWorkspace: facts.hasCandidates ? 'review' : 'generation' },
  }
  const requirement = requirements[workspace.prerequisite]
  return requirement.met
    ? { available: true }
    : {
        available: false,
        ...(requirement.reason ? { reason: requirement.reason } : {}),
        ...(requirement.alternativeWorkspace ? { alternativeWorkspace: requirement.alternativeWorkspace } : {}),
      }
}

export function deriveDefaultWorkspace(facts: StudioWorkspaceFacts): StudioWorkspaceId {
  if (!facts.hasProject) return 'project_center'
  if (!facts.hasSource) return 'script'
  if (!facts.hasPlan) return 'shots'
  if (!facts.hasShots) return 'shots'
  if (!facts.hasCandidates) return 'generation'
  if (!facts.hasApprovedCandidates) return 'review'
  return 'export_settings'
}

export function resolveStudioWorkspace(
  rawWorkspace: unknown,
  rawLegacyView: unknown,
  facts: StudioWorkspaceFacts,
): StudioWorkspaceId {
  if (isStudioWorkspaceId(rawWorkspace)) return rawWorkspace
  if (rawLegacyView === 'story' || rawLegacyView === 'production' || rawLegacyView === 'delivery') {
    return workspaceForLegacyView(rawLegacyView)
  }
  return deriveDefaultWorkspace(facts)
}
