import { flushPromises, mount } from '@vue/test-utils'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GraphNodeCard from '../src/components/GraphNodeCard.vue'
import AgentPanel from '../src/components/AgentPanel.vue'
import AssetsWorkspace from '../src/components/AssetsWorkspace.vue'
import ArtifactHistoryPanel from '../src/components/ArtifactHistoryPanel.vue'
import CandidateEvidence from '../src/components/CandidateEvidence.vue'
import CandidateReviewPanel from '../src/components/CandidateReviewPanel.vue'
import CreativeBriefPanel from '../src/components/CreativeBriefPanel.vue'
import ContinuityWorkspace from '../src/components/ContinuityWorkspace.vue'
import DeliveryPanel from '../src/components/DeliveryPanel.vue'
import ExportSettingsWorkspace from '../src/components/ExportSettingsWorkspace.vue'
import GenerationPolicyPanel from '../src/components/GenerationPolicyPanel.vue'
import GenerationWorkspace from '../src/components/GenerationWorkspace.vue'
import ReviewWorkspace from '../src/components/ReviewWorkspace.vue'
import TimelineWorkspace from '../src/components/TimelineWorkspace.vue'
import MediaPreview from '../src/components/MediaPreview.vue'
import MemoryWorkspace from '../src/components/MemoryWorkspace.vue'
import PromptOperationsWorkspace from '../src/components/PromptOperationsWorkspace.vue'
import ProviderPublisherTrust from '../src/components/ProviderPublisherTrust.vue'
import RecoveryCenterPanel from '../src/components/RecoveryCenterPanel.vue'
import ScriptWorkspace from '../src/components/ScriptWorkspace.vue'
import ShotsWorkspace from '../src/components/ShotsWorkspace.vue'
import SecurityAuditPanel from '../src/components/SecurityAuditPanel.vue'
import StudioDialogs from '../src/components/StudioDialogs.vue'
import ProjectSwitcher from '../src/components/ProjectSwitcher.vue'
import SourceComposer from '../src/components/SourceComposer.vue'
import ShotContinuityPanel from '../src/components/ShotContinuityPanel.vue'
import StudioInspector from '../src/components/StudioInspector.vue'
import TaskTray from '../src/components/TaskTray.vue'
import StudioJourneyGuide from '../src/components/StudioJourneyGuide.vue'
import { createPinia, setActivePinia } from 'pinia'
import { directorApi } from '../src/api/client.js'
import { router } from '../src/router.js'
import { upsertTask } from '../src/stores/studio.js'
import { useStudioStore } from '../src/stores/studio.js'
import { deriveStudioGuide, type StudioGuideInput } from '../src/guidance.js'
import { AgentRunCheckpointSchema, ArtifactVersionSchema, CandidateBatchSchema, CandidateSchema, CreativeBriefStateSchema, EpisodeContinuityStateSchema, ExecutionPlanSchema, ExportPreflightSchema, GenerationTaskSchema, MemoryRecordSchema, ProjectSnapshotSchema, PromptRevisionSchema, ReviewDecisionSchema, ShotSchema } from '@aigc-director/contracts'

describe('2.0 单一工作室壳', () => {
  afterEach(() => vi.restoreAllMocks())

  it('只公开 /studio 产品路由，未知路径回到工作室', () => {
    const routes = router.getRoutes()
    expect(routes.some((route) => route.path === '/studio/:projectId?')).toBe(true)
    expect(routes.some((route) => ['/dashboard', '/projects', '/script', '/preview'].includes(route.path))).toBe(false)
  })

  it('领域节点暴露状态与可理解标签', () => {
    const wrapper = mount(GraphNodeCard, {
      props: { data: { type: 'event', label: '舞台灯亮起', subtitle: 'revelation', status: 'ready' }, selected: true },
    })
    expect(wrapper.attributes('aria-label')).toContain('舞台灯亮起')
    expect(wrapper.classes()).toContain('graph-node--selected')
  })

  it('创作任务带从真实快照推导唯一下一步，不保存独立完成状态', () => {
    const base: StudioGuideInput = {
      hasProject: false, sourceCount: 0, eventCount: 0, shotCount: 0,
      selectedShotCount: 0, candidateCount: 0, tasks: [],
    }
    const cases: Array<[StudioGuideInput, string, string]> = [
      [base, '创建或打开项目', 'project'],
      [{ ...base, hasProject: true }, '导入原著', 'source'],
      [{ ...base, hasProject: true, sourceCount: 1, eventCount: 3 }, '生成制作计划', 'plan'],
      [{ ...base, hasProject: true, sourceCount: 1, eventCount: 3, planStatus: 'awaiting_approval' }, '检查并批准计划', 'approval'],
      [{ ...base, hasProject: true, sourceCount: 1, eventCount: 3, planStatus: 'approved', shotCount: 2 }, '生成零 Key Demo 候选', 'candidates'],
      [{ ...base, hasProject: true, sourceCount: 1, eventCount: 3, planStatus: 'approved', shotCount: 2, candidateCount: 4, selectedShotCount: 1 }, '审阅并批准候选', 'review'],
      [{ ...base, hasProject: true, sourceCount: 1, eventCount: 3, planStatus: 'approved', shotCount: 2, candidateCount: 4, selectedShotCount: 2 }, '前往导出', 'export'],
    ]

    for (const [input, actionLabel, stageId] of cases) {
      const result = deriveStudioGuide(input)
      expect(result.actionLabel).toBe(actionLabel)
      expect(result.activeStage.id).toBe(stageId)
      expect(result.stages.filter((stage) => stage.current)).toHaveLength(1)
    }
  })

  it('未知或失败任务会中断普通引导并给出恢复动作，成功导出后不再误报旧失败', () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const completeInput: StudioGuideInput = {
      hasProject: true, sourceCount: 1, eventCount: 3, shotCount: 2,
      selectedShotCount: 2, candidateCount: 4, planStatus: 'approved',
      tasks: [],
    }
    const unknown = GenerationTaskSchema.parse({
      id: crypto.randomUUID(), projectId, type: 'video', status: 'outcome_unknown', stage: '视频生成',
      idempotencyKey: `unknown-${crypto.randomUUID()}`, provider: 'demo-local', model: 'demo-video-v1', attempt: 1,
      inputSnapshot: {}, retryable: false, needsAttentionReason: '等待 Provider 对账', createdAt: now, updatedAt: now,
    })
    const interrupted = deriveStudioGuide({ ...completeInput, tasks: [unknown] })
    expect(interrupted.interruption?.kind).toBe('unknown')
    expect(interrupted.action).toBe('open-tasks')
    expect(interrupted.actionLabel).toContain('对账')

    const failed = GenerationTaskSchema.parse({
      ...unknown, id: crypto.randomUUID(), type: 'export', status: 'failed', stage: '本地导出',
      idempotencyKey: `failed-${crypto.randomUUID()}`, retryable: true,
    })
    expect(deriveStudioGuide({ ...completeInput, tasks: [failed] }).interruption?.kind).toBe('failed')

    const succeeded = GenerationTaskSchema.parse({
      ...failed, id: crypto.randomUUID(), status: 'succeeded', retryable: false,
      idempotencyKey: `succeeded-${crypto.randomUUID()}`, finishedAt: now,
    })
    const completed = deriveStudioGuide({ ...completeInput, tasks: [failed, succeeded] })
    expect(completed.isComplete).toBe(true)
    expect(completed.interruption).toBeUndefined()
    expect(completed.title).toContain('已完成')
  })

  it('任务带同时显示进度、原因、完成条件和单一主操作', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    store.currentProjectId = projectId
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '引导测试', status: 'active', graphRevision: 1, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: [], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const wrapper = mount(StudioJourneyGuide, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain('第 2 / 7 步')
    expect(wrapper.text()).toContain('为什么现在做')
    expect(wrapper.text()).toContain('完成条件')
    expect(wrapper.findAll('.studio-guide__primary')).toHaveLength(1)
    expect(wrapper.get('[aria-current="step"]').text()).toContain('导入原著')
    await wrapper.get('.studio-guide__primary').trigger('click')
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['open-source'])
    wrapper.unmount()
  })

  it('通过显式 action 选择和关闭领域节点，供画布与列表共享', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const nodeId = `episode:${crypto.randomUUID()}`
    store.selectNode(nodeId)
    expect(store.selectedNodeId).toBe(nodeId)
    store.selectNode()
    expect(store.selectedNodeId).toBeUndefined()
  })

  it('创意简报在 Inspector 中编辑并只提交类型化领域数据', async () => {
    const projectId = crypto.randomUUID()
    const state = CreativeBriefStateSchema.parse({
      projectId,
      brief: {
        goal: '制作灯塔悬疑短片', targetAudience: '悬疑观众', platform: 'generic', genre: '悬疑',
        tone: '克制', targetDurationSeconds: 45, aspectRatio: '9:16', language: 'zh-CN', constraints: ['保留灯塔线索'],
      },
      staleSceneCount: 2, staleShotCount: 3,
    })
    const wrapper = mount(CreativeBriefPanel, { props: { state } })
    expect(wrapper.text()).toContain('2 个场景、3 个镜头')
    await wrapper.findAll('textarea')[1]!.setValue('低饱和、紧张')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ tone: '低饱和、紧张', constraints: ['保留灯塔线索'] })
    wrapper.unmount()
  })

  it('创意简报候选保留字段锁并要求二次确认后才发出审阅动作', async () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const brief = {
      goal: '保持灯塔原著事实', targetAudience: '悬疑观众', platform: 'generic' as const, genre: '悬疑',
      tone: '克制', targetDurationSeconds: 60, aspectRatio: '9:16' as const, language: 'zh-CN', constraints: ['保留灯塔线索'],
    }
    const batchId = crypto.randomUUID()
    const artifact = ArtifactVersionSchema.parse({
      id: crypto.randomUUID(), projectId, workflow: { id: 'workflow.one_click_short_video', version: '1.0.0' },
      stageId: `brief-candidate:${batchId}:1`, artifactType: 'CreativeBriefCandidate', revision: 1,
      scope: { type: 'project', id: projectId }, dependencies: [],
      content: { result: { ...brief, tone: '紧凑、悬疑' }, candidate: { batchId, label: '节奏优先' } },
      contentHash: 'a'.repeat(64), status: 'draft', createdAt: now, updatedAt: now,
    })
    const state = CreativeBriefStateSchema.parse({
      projectId, brief, staleSceneCount: 0, staleShotCount: 0,
      candidates: [{
        batchId, artifact, brief: { ...brief, tone: '紧凑、悬疑' }, label: '节奏优先',
        changedFields: ['tone'], lockedFields: ['goal', 'language'],
      }],
    })
    const wrapper = mount(CreativeBriefPanel, { props: { state } })
    await wrapper.get('textarea[placeholder*="加强行动节奏"]').setValue('加强行动节奏')
    const goalLock = wrapper.findAll('.creative-brief__locks input').find((input) => input.attributes('value') === 'goal')
    await goalLock?.setValue(true)
    await wrapper.findAll('button').find((button) => button.text().includes('生成 3 个候选'))!.trigger('click')
    expect(wrapper.emitted('generate')?.[0]).toEqual(['加强行动节奏', ['goal']])

    const approve = wrapper.findAll('button').find((button) => button.text() === '采用候选')!
    await approve.trigger('click')
    expect(wrapper.emitted('review')).toBeUndefined()
    expect(approve.text()).toBe('再次确认采用')
    await approve.trigger('click')
    expect(wrapper.emitted('review')?.[0]).toEqual([artifact.id, 'approve'])
    wrapper.unmount()
  })

  it('创作简报主界面按 Figma v2 选择结构候选并二次确认批准', async () => {
    const projectId = crypto.randomUUID()
    const state = CreativeBriefStateSchema.parse({
      projectId,
      brief: {
        goal: '守护失落记忆的机械人陪同星图修复师穿过云上城市',
        targetAudience: '国风科幻漫剧观众', platform: 'generic', genre: '国风科幻', tone: '克制、电影化',
        targetDurationSeconds: 540, aspectRatio: '9:16', language: 'zh-CN', constraints: ['两位主角'],
      },
      staleSceneCount: 0, staleShotCount: 0,
    })
    const wrapper = mount(CreativeBriefPanel, { props: { state } })
    expect(wrapper.attributes('data-figma-node')).toBe('14:2')
    expect(wrapper.text()).toContain('原始意图')
    expect(wrapper.findAll('.creative-brief__candidate')).toHaveLength(3)

    const unitCandidate = wrapper.findAll('.creative-brief__candidate').find((button) => button.text().includes('单元任务'))!
    await unitCandidate.trigger('click')
    const approve = wrapper.get('.creative-brief__approve')
    await approve.trigger('click')
    expect(wrapper.emitted('approve')).toBeUndefined()
    expect(approve.text()).toContain('再次确认')
    await approve.trigger('click')
    const approval = wrapper.emitted('approve')?.[0]?.[0] as { brief: { genre: string } }
    expect(approval.brief.genre).toContain('单元任务')
    wrapper.unmount()
  })

  it('剧本编辑室按 Figma v2 提供六场景 Demo，并在卸载前保存本机草稿', async () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '星阙回声', status: 'active', graphRevision: 4, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: [], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const storageKey = `aigc-director:script-draft:${projectId}:demo-scene-03`
    localStorage.removeItem(storageKey)
    const wrapper = mount(ScriptWorkspace, { props: { snapshot, creativeBriefRevision: 3 } })
    expect(wrapper.attributes('data-figma-node')).toBe('14:63')
    expect(wrapper.findAll('.script-workspace__tree button')).toHaveLength(6)
    expect(wrapper.get<HTMLInputElement>('.script-workspace__title-input').element.value).toContain('星核显现')
    expect(wrapper.text()).toContain('CreativeBrief r3')
    await wrapper.get('.script-workspace__body-input').setValue('本机草稿：星核在塔厅上升。')
    wrapper.unmount()
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toMatchObject({ content: '本机草稿：星核在塔厅上升。' })

    const restored = mount(ScriptWorkspace, { props: { snapshot, creativeBriefRevision: 3 } })
    expect(restored.get<HTMLTextAreaElement>('.script-workspace__body-input').element.value).toContain('本机草稿')
    restored.unmount()
    localStorage.removeItem(storageKey)
  })

  it('资产圣经按 Figma v2 展示六个原创资产并切换身份绑定详情', async () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '星阙回声', status: 'active', graphRevision: 4, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: [], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const wrapper = mount(AssetsWorkspace, { props: { snapshot } })
    expect(wrapper.attributes('data-figma-node')).toBe('14:123')
    expect(wrapper.findAll('.assets-workspace__card')).toHaveLength(6)
    expect(wrapper.get('.assets-workspace__card img').attributes('src')).toBe('/demo/xingque/character-su-ling.png')
    expect(wrapper.get('.assets-workspace__inspector').text()).toContain('苏绫 · 身份绑定')
    expect(wrapper.get('.assets-workspace__inspector').text()).toContain('character_master r1')

    const xuanGe = wrapper.findAll('.assets-workspace__card').find((card) => card.text().includes('玄戈'))!
    await xuanGe.trigger('click')
    expect(xuanGe.attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.assets-workspace__inspector').text()).toContain('玄戈 · 身份绑定')
    wrapper.unmount()
  })

  it('分镜导演工作区按 Figma v2 展示六镜头并同步预览与属性', async () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '星阙回声', status: 'active', graphRevision: 4, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: [], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const wrapper = mount(ShotsWorkspace, { props: { snapshot } })

    expect(wrapper.attributes('data-figma-node')).toBe('14:184')
    expect(wrapper.findAll('.shots-workspace__shot')).toHaveLength(6)
    expect(wrapper.get('.shots-workspace__shot.active').text()).toContain('SHOT 02 · 星核升起')
    expect(wrapper.get('.shots-workspace__preview img').attributes('src')).toBe('/demo/xingque/storyboard-01.png')
    expect(wrapper.get('.shots-workspace__inspector').text()).toContain('中景 → 特写')
    expect(wrapper.get('.shots-workspace__inspector').text()).toContain('前置条件已满足')

    const thirdShot = wrapper.findAll('.shots-workspace__shot')[2]!
    await thirdShot.trigger('click')
    expect(thirdShot.attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.shots-workspace__preview-title').text()).toContain('云桥逃离')
    expect(wrapper.get('.shots-workspace__preview img').attributes('src')).toBe('/demo/xingque/storyboard-02.png')
    wrapper.unmount()
  })

  it('连续性实验室按 Figma v2 比较三帧并以二次确认准备局部修复', async () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '星阙回声', status: 'active', graphRevision: 4, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: [], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const wrapper = mount(ContinuityWorkspace, { props: { snapshot } })

    expect(wrapper.attributes('data-figma-node')).toBe('16:2')
    expect(wrapper.findAll('.continuity-workspace__frame img').map((image) => image.attributes('src'))).toEqual([
      '/demo/xingque/storyboard-02.png',
      '/demo/xingque/storyboard-03.png',
      '/demo/xingque/storyboard-04.png',
    ])
    expect(wrapper.get('.continuity-workspace__inspector').text()).toContain('发现 2 项冲突')
    expect(wrapper.get('.continuity-workspace__inspector').text()).toContain('视线方向')
    expect(wrapper.get('.continuity-workspace__inspector').text()).toContain('星核位置')
    expect(wrapper.get('.continuity-workspace__inspector').text()).toContain('身份与服装一致')

    const issues = wrapper.findAll('.continuity-workspace__issue')
    await issues[1]!.trigger('click')
    expect(issues[1]!.attributes('aria-pressed')).toBe('true')

    await wrapper.get('.continuity-workspace__primary').trigger('click')
    expect(wrapper.emitted('prepare-repair')).toBeUndefined()
    expect(wrapper.text()).toContain('确认后才会进入生成队列')
    await wrapper.get('.continuity-workspace__primary').trigger('click')
    expect(wrapper.emitted('prepare-repair')).toEqual([[expect.objectContaining({ conflictId: 'prop-position', label: '星核位置' })]])
    wrapper.unmount()
  })

  it('生成队列按 Figma v2 展示真实批次状态，并只在二次确认后重试失败候选', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const sceneId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const batchId = crypto.randomUUID()
    const tasks = [
      GenerationTaskSchema.parse({
        id: crypto.randomUUID(), projectId, type: 'image', status: 'succeeded', stage: 'Candidate A',
        idempotencyKey: `candidate-a-${crypto.randomUUID()}`, provider: 'demo-local', model: 'demo-frame-v1', attempt: 1,
        inputSnapshot: { batchId, variant: 0 }, result: { billed: false, size: 1_258_291 }, retryable: false,
        progress: 1, createdAt: now, startedAt: now, updatedAt: now, finishedAt: now,
      }),
      GenerationTaskSchema.parse({
        id: crypto.randomUUID(), projectId, type: 'image', status: 'running', stage: 'Candidate B',
        idempotencyKey: `candidate-b-${crypto.randomUUID()}`, provider: 'demo-local', model: 'demo-frame-v1', attempt: 1,
        inputSnapshot: { batchId, variant: 1 }, retryable: false, progress: 0.62,
        createdAt: now, startedAt: now, updatedAt: now,
      }),
      GenerationTaskSchema.parse({
        id: crypto.randomUUID(), projectId, type: 'image', status: 'failed', stage: 'Candidate C',
        idempotencyKey: `candidate-c-${crypto.randomUUID()}`, provider: 'demo-local', model: 'demo-frame-v1', attempt: 1,
        inputSnapshot: { batchId, variant: 2 }, retryable: true,
        error: { code: 'PROVIDER_RATE_LIMITED', userMessage: 'Provider 限流，稍后可重试。', retryable: true, correlationId: 'corr-generation-test', timestamp: now },
        createdAt: now, startedAt: now, updatedAt: now, finishedAt: now,
      }),
    ]
    store.currentProjectId = projectId
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '星阙回声', status: 'active', graphRevision: 4, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [],
      shots: [{
        id: shotId, projectId, sceneId, title: '星核升起', description: '苏绫抬头看向星核。', durationMs: 6000,
        ordinal: 1, revision: 2, createdAt: now, updatedAt: now,
      }],
      assets: [], variants: [], media: [], candidates: [],
      candidateBatches: [{
        id: batchId, projectId, shotId, kind: 'image', modelId: 'demo-frame-v1',
        idempotencyKey: `batch-${crypto.randomUUID()}`, quantity: 3, maxConcurrent: 1, status: 'partial',
        completedCount: 1, failedCount: 1, parametersSnapshot: {}, source: 'demo-production',
        createdAt: now, updatedAt: now, finishedAt: now,
      }],
      tasks, plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    store.tasks = tasks
    store.generationPolicy = {
      projectId, revision: 1, billingMode: 'demo-only', paidProviders: 'blocked', maxConcurrentTasks: 4,
      maxCandidatesPerBatch: 4, maxExportDurationMs: 120_000, dailyPaidBudgetMicros: 0, updatedAt: now,
    }
    store.taskAdmission = {
      projectId, allowed: true, activeTasks: 1, maxConcurrentTasks: 4, maxCandidatesPerBatch: 4,
      maxExportDurationMs: 120_000, policyRevision: 1, paidProviders: 'blocked', dailyPaidBudgetMicros: 0,
      dailyPaidSpentMicros: 0, remainingPaidBudgetMicros: 0, providerNetworkDisabled: true, reasons: [], checkedAt: now,
    }
    const retry = vi.spyOn(store, 'retryFailedCandidateBatch').mockResolvedValue()
    const wrapper = mount(GenerationWorkspace, { global: { plugins: [pinia] } })

    expect(wrapper.attributes('data-figma-node')).toBe('17:18')
    expect(wrapper.text()).toContain('零 Key Demo · demo-local')
    expect(wrapper.text()).toContain('网络禁用 · 付费请求 0')
    expect(wrapper.findAll('.generation-workspace__task')).toHaveLength(3)
    expect(wrapper.text()).toContain('Candidate B · 生成中')
    expect(wrapper.text()).toContain('62%')
    expect(wrapper.text()).toContain('Candidate C · 失败')
    expect(wrapper.text()).toContain('RATE_LIMITED')
    expect(wrapper.get('.generation-workspace__preview img').attributes('src')).toBe('/demo/xingque/candidate-02.png')

    const retryButton = wrapper.get('.generation-workspace__retry')
    await retryButton.trigger('click')
    expect(retry).not.toHaveBeenCalled()
    expect(retryButton.text()).toContain('确认仅重试 1 个失败候选')
    await retryButton.trigger('click')
    expect(retry).toHaveBeenCalledWith(batchId)
    wrapper.unmount()
  })

  it('候选审阅按 Figma v2 呈现真实候选、零 Key 证据和二次批准', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const sceneId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const batchId = crypto.randomUUID()
    const candidates = Array.from({ length: 3 }, (_, index) => CandidateSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, kind: 'image', taskId: crypto.randomUUID(), batchId,
      provider: 'demo-local', model: 'demo-frame-v1', inputSnapshot: { variant: index }, parametersSnapshot: {},
      label: `Candidate ${String.fromCharCode(65 + index)}`,
      tags: index === 1 ? ['双人平衡', '星核亮度合适'] : index === 2 ? ['远景构图'] : [],
      status: 'ready', favorite: index === 1, createdAt: now,
    }))
    store.currentProjectId = projectId
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '星阙回声', status: 'active', graphRevision: 7, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [],
      shots: [{
        id: shotId, projectId, sceneId, title: '星核升起', description: '苏绫与玄戈确认星核坐标。', durationMs: 6000,
        ordinal: 0, revision: 2, selectedCandidateId: candidates[1]!.id, createdAt: now, updatedAt: now,
      }],
      assets: [], variants: [], media: [], candidates,
      candidateBatches: [{
        id: batchId, projectId, shotId, kind: 'image', modelId: 'demo-frame-v1',
        idempotencyKey: `batch-${crypto.randomUUID()}`, quantity: 3, maxConcurrent: 1, status: 'succeeded',
        completedCount: 3, failedCount: 0, parametersSnapshot: {}, source: 'demo-production', createdAt: now, updatedAt: now, finishedAt: now,
      }],
      tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [],
      reviews: [
        ReviewDecisionSchema.parse({
          id: crypto.randomUUID(), projectId, candidateId: candidates[1]!.id, source: 'automatic_critic', decision: 'approved',
          rubric: { continuity: 0.94, composition: 0.91 }, reasons: ['星核亮度合适'], createdAt: now,
        }),
        ReviewDecisionSchema.parse({
          id: crypto.randomUUID(), projectId, candidateId: candidates[1]!.id, source: 'human', decision: 'approved',
          rubric: {}, reasons: ['通过，进入时间线'], createdAt: now,
        }),
      ],
      artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const annotate = vi.spyOn(store, 'annotateCandidate').mockResolvedValue()
    const select = vi.spyOn(store, 'selectCandidate').mockResolvedValue()
    const wrapper = mount(ReviewWorkspace, { global: { plugins: [pinia] } })

    expect(wrapper.attributes('data-figma-node')).toBe('19:2')
    expect(wrapper.findAll('.review-workspace__candidate')).toHaveLength(3)
    expect(wrapper.findAll('.review-workspace__candidate-image img').map((image) => image.attributes('src'))).toEqual([
      '/demo/xingque/candidate-01.png', '/demo/xingque/candidate-02.png', '/demo/xingque/candidate-03.png',
    ])
    expect(wrapper.get('.review-workspace__candidate--active').text()).toContain('ACTIVE TAKE')
    expect(wrapper.get('.review-workspace__inspector').text()).toContain('Candidate B')
    expect(wrapper.get('.review-workspace__inspector').text()).toContain('Provider：demo-local')
    expect(wrapper.get('.review-workspace__inspector').text()).toContain('费用：¥0 · billed=false')
    expect(wrapper.get('.review-workspace__inspector').text()).toContain('审阅证据 2')

    await wrapper.get('.review-workspace__favorite').trigger('click')
    expect(annotate).toHaveBeenCalledWith(candidates[1]!.id, { favorite: false })

    await wrapper.findAll('.review-workspace__candidate-image')[2]!.trigger('click')
    expect(wrapper.get('.review-workspace__inspector').text()).toContain('Candidate C')
    const approve = wrapper.get('.review-workspace__primary')
    await approve.trigger('click')
    expect(select).not.toHaveBeenCalled()
    expect(approve.text()).toContain('确认批准 Candidate C')
    await approve.trigger('click')
    expect(select).toHaveBeenCalledWith(shotId, candidates[2]!.id)
    wrapper.unmount()
  })

  it('音频字幕时间线按 Figma v2 只装配已批准候选并如实标记未持久化轨道', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const sceneId = crypto.randomUUID()
    const shots = Array.from({ length: 3 }, (_, index) => {
      const candidateId = crypto.randomUUID()
      const shotId = crypto.randomUUID()
      return {
        shot: {
          id: shotId, projectId, sceneId, title: `镜头 ${index + 1}`, description: `第 ${index + 1} 个镜头`,
          dialogue: index === 2 ? '' : `对白 ${index + 1}`, durationMs: 4_000 + index * 500,
          ordinal: index, revision: 3, selectedCandidateId: candidateId, createdAt: now, updatedAt: now,
        },
        candidate: CandidateSchema.parse({
          id: candidateId, projectId, shotId, kind: 'image', taskId: crypto.randomUUID(),
          provider: 'demo-local', model: 'demo-frame-v1', inputSnapshot: { variant: 1 }, parametersSnapshot: {},
          label: 'Candidate B', tags: [], status: 'ready', favorite: false, createdAt: now,
        }),
      }
    })
    store.currentProjectId = projectId
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '星阙回声', status: 'active', graphRevision: 11, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: shots.map((item) => item.shot),
      assets: [
        { id: crypto.randomUUID(), projectId, logicalId: crypto.randomUUID(), type: 'voice', scope: 'episode', name: 'Demo 旁白', description: '本地静音测试音轨', metadata: { purpose: 'narrator', language: 'zh-CN', speed: 1, pitchSemitones: 0, emotion: 'neutral', rightsStatus: 'original', rightsNote: '静音 fixture' }, revision: 1, archived: false, createdAt: now, updatedAt: now },
        { id: crypto.randomUUID(), projectId, logicalId: crypto.randomUUID(), type: 'music', scope: 'episode', name: 'Demo 氛围', description: '本地静音占位', metadata: { mood: '', musicalKey: '', source: 'demo_fixture', rightsStatus: 'original', licenseNote: '静音 fixture' }, revision: 1, archived: false, createdAt: now, updatedAt: now },
      ],
      variants: [], media: [], candidates: shots.map((item) => item.candidate), candidateBatches: [], tasks: [], plans: [],
      promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const wrapper = mount(TimelineWorkspace, { global: { plugins: [pinia] } })

    expect(wrapper.attributes('data-figma-node')).toBe('19:55')
    expect(wrapper.findAll('.timeline-workspace__clip--video')).toHaveLength(3)
    expect(wrapper.text()).toContain('视频装配：3 / 3')
    expect(wrapper.text()).toContain('对白脚本：2 / 3')
    expect(wrapper.text()).toContain('语音媒体：0 / 3 · Demo 静音')
    expect(wrapper.text()).toContain('自由剪辑能力：Planned')
    expect(wrapper.text()).toContain('付费请求：0')
    expect(wrapper.get('.timeline-workspace__preview img').attributes('src')).toBe('/demo/xingque/storyboard-05.png')
    expect(wrapper.text()).not.toContain('24 条')
    wrapper.unmount()
  })

  it('导出与交付按 Figma v2 呈现真实装配证据并使用两步本地确认', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const sceneId = crypto.randomUUID()
    const media = Array.from({ length: 3 }, (_, index) => ({
      id: crypto.randomUUID(), projectId, kind: 'image' as const, storage: 'managed-file' as const,
      locator: `candidate-${index + 1}.png`, mime: 'image/png', size: 8_192 + index,
      sha256: String(index + 1).repeat(64), createdAt: now,
    }))
    const shots = media.map((item, index) => {
      const shotId = crypto.randomUUID()
      const candidate = CandidateSchema.parse({
        id: crypto.randomUUID(), projectId, shotId, kind: 'image', taskId: crypto.randomUUID(), mediaId: item.id,
        provider: 'demo-local', model: 'demo-frame-v1', inputSnapshot: {}, parametersSnapshot: {},
        label: `Candidate ${index + 1}`, tags: [], status: 'ready', favorite: false, createdAt: now,
      })
      return {
        shot: {
          id: shotId, projectId, sceneId, title: `镜头 ${index + 1}`, description: '星核通过档案塔。', dialogue: '',
          durationMs: 3_000, ordinal: index, revision: 3, selectedCandidateId: candidate.id, createdAt: now, updatedAt: now,
        },
        candidate,
      }
    })
    store.currentProjectId = projectId
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '星阙回声', status: 'active', graphRevision: 12, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: shots.map((item) => item.shot),
      assets: [{
        id: crypto.randomUUID(), projectId, type: 'music', scope: 'episode', name: 'Demo 氛围', description: '本地静音占位',
        metadata: { rightsStatus: 'original', source: 'demo_fixture' }, revision: 1, archived: false, createdAt: now, updatedAt: now,
      }],
      variants: [], media, candidates: shots.map((item) => item.candidate), candidateBatches: [], tasks: [], plans: [],
      promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const prepare = vi.spyOn(store, 'prepareExport').mockResolvedValue(undefined)
    const wrapper = mount(ExportSettingsWorkspace, { global: { plugins: [pinia] } })

    expect(wrapper.attributes('data-figma-node')).toBe('22:192')
    expect(wrapper.text()).toContain('候选已批准')
    expect(wrapper.text()).toContain('3 / 3')
    expect(wrapper.text()).toContain('媒体完整性')
    expect(wrapper.text()).toContain('Provider demo-local · 付费请求 0')
    expect(wrapper.text()).toContain('未烧录 · SRT Planned')
    expect(wrapper.text()).toContain('创建交付记录 · Planned')
    expect(wrapper.text()).not.toContain('24 / 24')
    expect(wrapper.text()).not.toContain('412 MB')
    expect(wrapper.text()).not.toContain('/tmp/')
    expect(wrapper.text()).not.toContain('approvalToken')

    await wrapper.get('.export-delivery__primary').trigger('click')
    expect(prepare).toHaveBeenCalledWith('/tmp/aigc-director-export', {
      fileName: '星阙回声_S01_v12.mp4', width: 1080, height: 1920, fps: 24,
    })
    wrapper.unmount()
  })

  it('导出预检只展示脱敏装配摘要并要求显式确认', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const candidateId = crypto.randomUUID()
    store.currentProjectId = projectId
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '安全导出', status: 'active', graphRevision: 3, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [],
      shots: [{
        id: shotId, projectId, sceneId: crypto.randomUUID(), title: '镜头一', description: '角色走入画面',
        durationMs: 2_500, ordinal: 0, revision: 1, selectedCandidateId: candidateId, createdAt: now, updatedAt: now,
      }],
      assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [],
      providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    store.pendingExportPreflight = ExportPreflightSchema.parse({
      id: crypto.randomUUID(), projectId, fileName: '安全导出.mp4', shotCount: 1, selectedCandidateCount: 1,
      durationMs: 2_500, width: 1280, height: 720, fps: 24, assemblyHash: 'c'.repeat(64),
      destination: 'local-directory-selected',
      billing: { provider: 'demo-local', verified: true, amountMicros: 0, currency: 'none' },
      approvalToken: 'approval-token-that-is-never-rendered',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const confirm = vi.spyOn(store, 'confirmExport').mockResolvedValue(undefined)
    const wrapper = mount(DeliveryPanel, { global: { plugins: [pinia] } })

    expect(wrapper.text()).toContain('确认本地导出')
    expect(wrapper.text()).toContain('¥0 · Demo 已验证')
    expect(wrapper.text()).toContain('1280×720 · 24 fps')
    expect(wrapper.text()).toContain('cccccccccc…cccccc')
    expect(wrapper.text()).not.toContain('approval-token-that-is-never-rendered')
    expect(wrapper.text()).not.toContain('/Users/')

    await wrapper.findAll('button').find((button) => button.text().includes('确认并开始导出'))!.trigger('click')
    expect(confirm).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('Agent 面板展示脱敏记忆 provenance 而不暴露正文', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    const planId = crypto.randomUUID()
    store.currentPlan = ExecutionPlanSchema.parse({
      id: planId, projectId, runId, title: '记忆可追溯计划', goal: '生成场景', checkpointRevision: 2,
      memoryContextHash: 'a'.repeat(64), memoryCitationCount: 1, status: 'awaiting_approval',
      steps: [{ id: crypto.randomUUID(), title: '审查事件', description: '只读检查', action: 'analyze', risk: 'read_only', status: 'pending' }],
      createdAt: now, updatedAt: now,
    })
    store.currentCheckpoint = AgentRunCheckpointSchema.parse({
      id: crypto.randomUUID(), projectId, runId, planId, graphRevision: 2, memoryQuery: '灯塔', memoryContextHash: 'a'.repeat(64),
      memoryCitations: [{ memoryId: crypto.randomUUID(), scope: 'episode', sourceType: 'story_event', sourceKey: `event:${crypto.randomUUID()}`, sourceRevision: 3, contentHash: 'b'.repeat(64), score: 60, matchedKeywords: ['灯塔'], reasons: ['Episode 作用域优先'] }],
      inputArtifactHashes: [], createdAt: now,
    })
    const wrapper = mount(AgentPanel, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain('记忆证据')
    expect(wrapper.text()).toContain('episode · story_event r3')
    expect(wrapper.text()).toContain('不复制记忆正文')
    wrapper.unmount()
  })

  it('Artifact Inspector 展示字段 diff 并要求二次确认追加式回滚', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const scope = { type: 'project' as const, id: projectId }
    const base = {
      projectId, workflow: { id: 'workflow.test', version: '1.0.0' }, stageId: 'script', artifactType: 'SceneScript',
      scope, dependencies: [], status: 'approved' as const, createdAt: now, updatedAt: now,
    }
    const oldVersion = ArtifactVersionSchema.parse({ ...base, id: crypto.randomUUID(), revision: 1, content: { title: '旧标题' }, contentHash: 'a'.repeat(64) })
    const currentVersion = ArtifactVersionSchema.parse({ ...base, id: crypto.randomUUID(), revision: 2, parentArtifactVersionId: oldVersion.id, content: { title: '新标题' }, contentHash: 'b'.repeat(64) })
    vi.spyOn(directorApi, 'artifactHistory').mockResolvedValue({
      head: { scope, artifactType: 'SceneScript', currentVersionId: currentVersion.id, expectedRevision: 2, updatedAt: now },
      versions: [currentVersion, oldVersion],
    })
    vi.spyOn(directorApi, 'artifactDiff').mockResolvedValue({
      fromVersionId: oldVersion.id, toVersionId: currentVersion.id, changes: [{ field: 'title', before: '旧标题', after: '新标题' }],
    })
    const rollback = vi.spyOn(store, 'rollbackArtifactVersion').mockResolvedValue(ArtifactVersionSchema.parse({
      ...oldVersion, id: crypto.randomUUID(), revision: 3, parentArtifactVersionId: currentVersion.id,
    }))
    const wrapper = mount(ArtifactHistoryPanel, { props: { artifact: currentVersion }, global: { plugins: [pinia] } })
    await flushPromises()
    await wrapper.findAll('.artifact-history__versions button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('title')
    expect(wrapper.text()).toContain('旧标题')
    const rollbackButton = wrapper.get('.artifact-history__rollback')
    await rollbackButton.trigger('click')
    expect(rollback).not.toHaveBeenCalled()
    expect(rollbackButton.text()).toContain('再次确认')
    await rollbackButton.trigger('click')
    await flushPromises()
    expect(rollback).toHaveBeenCalledOnce()
    expect(rollback).toHaveBeenCalledWith(oldVersion, 2)
    wrapper.unmount()
  })

  it('Prompt 工作台只允许已发布 revision 对单个目标追加局部产物', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const sceneId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    store.currentProjectId = projectId
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '局部任务', status: 'active', graphRevision: 4, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [],
      scenes: [{ id: sceneId, projectId, title: '雨夜车站', synopsis: '人物收到来信', ordinal: 0, revision: 2, createdAt: now, updatedAt: now }],
      shots: [{
        id: shotId, projectId, sceneId, title: '镜头一', description: '人物走入雨幕', dialogue: '旧对白',
        visualPrompt: '', videoPrompt: '', negativePrompt: '', durationMs: 3_000, beats: [], boundaryFrames: [],
        ordinal: 0, revision: 2, staleFields: [], createdAt: now, updatedAt: now,
      }], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
    })
    const prompt = PromptRevisionSchema.parse({
      id: crypto.randomUUID(), projectId, stableKey: 'script.scoped-ui', revision: 3, title: '局部修订', role: 'execution',
      languageDrafts: { original: '润色 {{topic}}', zhReview: '润色 {{topic}}', enExecution: 'Polish {{topic}}' },
      variablesSchema: { properties: { topic: { type: 'string' } } }, outputSchema: { required: ['result'] },
      status: 'published', source: 'project-override', contentHash: 'a'.repeat(64), createdAt: now, updatedAt: now,
    })
    vi.spyOn(directorApi, 'listPromptRevisions').mockImplementation(async (_stableKey, requestedProjectId) => requestedProjectId ? [prompt] : [])
    vi.spyOn(directorApi, 'listSkillVersions').mockResolvedValue([])
    const artifact = ArtifactVersionSchema.parse({
      id: crypto.randomUUID(), projectId, workflow: { id: 'workflow.scoped_regeneration', version: '1.0.0' },
      stageId: `scoped-regeneration:scene:${sceneId}`, artifactType: 'SceneScriptRevision', revision: 1,
      scope: { type: 'scene', id: sceneId }, dependencies: [], content: { promptRevisionId: prompt.id, patch: {
        sceneId, baseRevision: 2, changes: { synopsis: '雨夜车站的可拍摄修订' },
        shotPatches: [{ shotId, baseRevision: 2, changes: { dialogue: '新对白' } }],
      } },
      contentHash: 'b'.repeat(64), status: 'draft', createdAt: now, updatedAt: now,
    })
    const task = GenerationTaskSchema.parse({
      id: crypto.randomUUID(), projectId, type: 'adaptation', status: 'succeeded', stage: '局部重生成',
      idempotencyKey: 'scoped-regenerate-test-task', provider: 'demo-local', model: 'demo-structured-v1', attempt: 1,
      inputSnapshot: { promptBinding: { promptRevisionId: prompt.id, targetType: 'scene', targetId: sceneId, targetRevision: 2 } },
      result: { artifactVersionId: artifact.id, billed: false }, retryable: false, createdAt: now, updatedAt: now, finishedAt: now,
    })
    const regenerate = vi.spyOn(directorApi, 'scopedRegenerate').mockResolvedValue({ task, artifact })
    const apply = vi.spyOn(directorApi, 'applyScenePatch').mockResolvedValue({
      artifact: { ...artifact, status: 'approved' },
      scene: { ...store.snapshot.scenes[0]!, synopsis: '雨夜车站的可拍摄修订', revision: 3 },
      staleShotIds: [shotId],
      updatedShots: [{ ...store.snapshot.shots[0]!, dialogue: '新对白', revision: 3, staleFields: ['script.shot.dialogue', 'voice', 'subtitle', 'timeline', 'export'] }],
      changedFields: [
        { targetType: 'scene', targetId: sceneId, fields: ['synopsis'], staleFields: ['script.scene.synopsis', 'image', 'video', 'timeline', 'export'] },
        { targetType: 'shot', targetId: shotId, fields: ['dialogue'], staleFields: ['script.shot.dialogue', 'voice', 'subtitle', 'timeline', 'export'] },
      ],
      projectGraphRevision: 5, reused: false,
    })
    vi.spyOn(store, 'loadProject').mockResolvedValue()
    const wrapper = mount(PromptOperationsWorkspace, { global: { plugins: [pinia] } })
    await flushPromises()
    await wrapper.get('.prompt-ops__versions button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('局部重生成')
    expect(wrapper.text()).toContain('任务会保存 Prompt 与目标 revision')
    await wrapper.get('.prompt-ops__regeneration button').trigger('click')
    await flushPromises()
    expect(regenerate).toHaveBeenCalledOnce()
    expect(regenerate.mock.calls[0]?.[1]).toMatchObject({ promptRevisionId: prompt.id, targetType: 'scene', targetId: sceneId })
    expect(wrapper.text()).toContain('已生成结构化 patch')
    expect(wrapper.text()).toContain('待审阅的场景修订')
    expect(wrapper.text()).toContain('雨夜车站的可拍摄修订')
    expect(wrapper.text()).toContain('镜头 1 · 对白')
    expect(wrapper.text()).toContain('旧对白')
    expect(wrapper.text()).toContain('新对白')
    await wrapper.get('[data-action="apply-scene-patch"]').trigger('click')
    await flushPromises()
    expect(apply).toHaveBeenCalledWith(projectId, artifact.id, expect.objectContaining({ expectedProjectRevision: 4, expectedSceneRevision: 2, confirmation: 'APPLY_SCENE_PATCH' }))
    expect(wrapper.text()).toContain('已应用 2 组字段变更')
    wrapper.unmount()
  })

  it('Prompt 工作台用确定性 Demo 润色追加 revision 并显示 last-known-good', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    store.currentProjectId = projectId
    const published = PromptRevisionSchema.parse({
      id: crypto.randomUUID(), projectId, stableKey: 'script.ui-polish', revision: 2, title: 'UI 润色', role: 'execution',
      languageDrafts: { original: '写 {{topic}}', zhReview: '写 {{topic}}', enExecution: 'Write {{topic}}' },
      variablesSchema: { properties: { topic: { type: 'string' } } }, outputSchema: { required: ['result'] },
      status: 'published', source: 'project-override', contentHash: 'a'.repeat(64), createdAt: now, updatedAt: now,
    })
    const polished = PromptRevisionSchema.parse({
      ...published, id: crypto.randomUUID(), revision: 3, parentRevisionId: published.id, status: 'draft',
      languageDrafts: {
        ...published.languageDrafts,
        zhReview: `${published.languageDrafts.zhReview}\n用户反馈：强化空间调度`,
        enExecution: `${published.languageDrafts.enExecution}\nReviewer feedback: 强化空间调度`,
      },
      feedback: '强化空间调度', modelPolicy: { polishMode: 'demo-deterministic' },
      contentHash: 'b'.repeat(64), createdAt: now, updatedAt: now,
    })
    let revisions = [published]
    vi.spyOn(directorApi, 'listPromptRevisions').mockImplementation(async (_stableKey, requestedProjectId) => requestedProjectId ? revisions : [])
    vi.spyOn(directorApi, 'listSkillVersions').mockResolvedValue([])
    const polish = vi.spyOn(directorApi, 'polishPrompt').mockImplementation(async (_revisionId, input) => {
      revisions = [polished, published]
      return {
        sourceRevisionId: published.id, revision: polished, lastKnownGoodRevisionId: published.id,
        diff: {
          fromRevisionId: published.id, toRevisionId: polished.id,
          changes: [{ field: 'feedback', kind: 'changed', before: '', after: input.feedback }],
        },
        requestHash: 'c'.repeat(64), mode: 'demo-deterministic', reused: false,
      }
    })
    const wrapper = mount(PromptOperationsWorkspace, { global: { plugins: [pinia] } })
    await flushPromises()
    await wrapper.get('.prompt-ops__versions button').trigger('click')
    await wrapper.get('[aria-label="Prompt 润色反馈"]').setValue('强化空间调度')
    await wrapper.get('[aria-label="Prompt 润色方向"]').setValue('cinematic')
    await wrapper.get('[data-action="polish-prompt"]').trigger('click')
    await flushPromises()
    expect(polish).toHaveBeenCalledWith(published.id, expect.objectContaining({
      expectedRevision: 2, feedback: '强化空间调度', direction: 'cinematic',
    }))
    expect(wrapper.text()).toContain('last-known-good 为 r2')
    expect(wrapper.text()).toContain('feedback')
    expect(wrapper.text()).toContain('强化空间调度')
    wrapper.unmount()
  })

  it('桌面通知不覆盖左侧 Agent 审批区', async () => {
    const css = await readFile(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    expect(css).toMatch(/\.toast\s*\{[^}]*top:\s*146px;[^}]*right:\s*20px;/s)
    expect(css).not.toMatch(/\.toast\s*\{[^}]*left:\s*92px;[^}]*bottom:\s*20px;/s)
  })

  it('交付列表将导出面板放入布局而不是遮挡任务节点', async () => {
    const css = await readFile(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    expect(css).toMatch(/\.graph-stage--list\.graph-stage--delivery\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto;/s)
    expect(css).toMatch(/\.graph-stage--list\.graph-stage--delivery\s+\.delivery-panel\s*\{[^}]*position:\s*static;/s)
  })

  it('媒体读取失败显示可恢复占位且不产生未处理拒绝', async () => {
    vi.spyOn(directorApi, 'mediaBlob').mockRejectedValueOnce(new Error('MEDIA_LOAD_FAILED'))
    const wrapper = mount(MediaPreview, { props: { projectId: crypto.randomUUID(), locator: `${crypto.randomUUID()}.svg` } })
    await flushPromises()
    expect(wrapper.text()).toContain('媒体加载失败')
    wrapper.unmount()
  })

  it('实时任务事件按稳定 ID 更新而不重复', () => {
    const base = GenerationTaskSchema.parse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), type: 'export', status: 'running', stage: 'encoding',
      idempotencyKey: 'task-event-idempotency-key', provider: 'demo-local', model: 'local-ffmpeg', attempt: 1,
      inputSnapshot: {}, retryable: true, cancellationState: 'none', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    const updated = GenerationTaskSchema.parse({ ...base, status: 'succeeded', stage: 'completed', retryable: false, finishedAt: new Date().toISOString() })
    expect(upsertTask([base], updated)).toEqual([updated])
  })

  it('任务中心要求未知结果先对账，并对失败重试执行二次确认', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const unknown = GenerationTaskSchema.parse({
      id: crypto.randomUUID(), projectId, type: 'video', status: 'outcome_unknown', stage: '视频生成',
      idempotencyKey: `unknown-${crypto.randomUUID()}`, provider: 'demo-local', model: 'demo-video-v1', attempt: 1,
      inputSnapshot: {}, retryable: false, needsAttentionReason: '必须先对账', createdAt: now, updatedAt: now,
    })
    const failed = GenerationTaskSchema.parse({
      ...unknown, id: crypto.randomUUID(), type: 'export', status: 'failed', stage: '导出',
      idempotencyKey: `failed-${crypto.randomUUID()}`, model: 'local-ffmpeg', retryable: true,
    })
    store.currentProjectId = projectId
    store.tasks = [unknown, failed]
    const reconcile = vi.spyOn(store, 'reconcileTask').mockResolvedValue()
    const retry = vi.spyOn(store, 'retryTask').mockResolvedValue()
    vi.spyOn(store, 'refreshTasks').mockResolvedValue()
    const wrapper = mount(TaskTray, { global: { plugins: [pinia] } })
    await wrapper.get('.task-tray__trigger').trigger('click')
    expect(wrapper.get('[aria-label="下载脱敏诊断包"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('结果未知')
    expect(wrapper.text()).toContain('必须先对账')
    const unknownRow = wrapper.findAll('.task').find((row) => row.text().includes('视频生成'))
    expect(unknownRow?.text()).toContain('对账')
    expect(unknownRow?.text()).not.toContain('重试')
    await unknownRow?.findAll('button').find((button) => button.text().includes('对账'))?.trigger('click')
    expect(reconcile).toHaveBeenCalledWith(unknown.id)
    const failedRow = wrapper.findAll('.task').find((row) => row.text().includes('导出'))
    const retryButton = failedRow?.findAll('button').find((button) => button.text().includes('重试'))
    await retryButton?.trigger('click')
    expect(retry).not.toHaveBeenCalled()
    expect(failedRow?.text()).toContain('确认新 attempt')
    await failedRow?.findAll('button').find((button) => button.text().includes('确认新 attempt'))?.trigger('click')
    expect(retry).toHaveBeenCalledWith(failed.id)
    wrapper.unmount()
  })

  it('候选 Inspector 显示自动 Critic、人工决策与 ArtifactVersion 证据', () => {
    const projectId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const candidate = CandidateSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, kind: 'image', taskId: crypto.randomUUID(),
      promptRevisionId: crypto.randomUUID(), provider: 'demo-local', model: 'demo-frame-v1',
      inputSnapshot: { providerMediaOrder: [`first-frame:${crypto.randomUUID()}:${'c'.repeat(64)}`] }, status: 'ready', createdAt: new Date().toISOString(),
    })
    const critic = ReviewDecisionSchema.parse({
      id: crypto.randomUUID(), projectId, candidateId: candidate.id, source: 'automatic_critic', decision: 'pending',
      rubric: { identity: 1, continuity: 0.9, technicalQuality: 0.8 }, reasons: ['需要人工确认最终视觉选择。'], createdAt: new Date().toISOString(),
    })
    const artifact = ArtifactVersionSchema.parse({
      id: crypto.randomUUID(), projectId, workflow: { id: 'workflow.one_click_short_video', version: '1.0.0' },
      stageId: `image-review:${shotId}`, artifactType: 'ImageReviewDecision', revision: 1,
      scope: { type: 'shot', id: shotId }, dependencies: [], content: { candidateId: candidate.id },
      contentHash: 'a'.repeat(64), status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    const wrapper = mount(CandidateEvidence, { props: { candidate, reviews: [critic], artifacts: [artifact] } })
    expect(wrapper.text()).toContain('待人工确认')
    expect(wrapper.text()).toContain('连续性')
    expect(wrapper.text()).toContain('90')
    expect(wrapper.text()).toContain('r1')
    expect(wrapper.text()).toContain('未创建')
    expect(wrapper.text()).toContain('1 个有序快照')
    expect(wrapper.text()).toContain('first-frame')
    wrapper.unmount()
  })

  it('候选批次评审保持收藏、比较和批准选择相互独立并支持键盘', async () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const batch = CandidateBatchSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, kind: 'image', modelId: 'demo-frame-v1',
      idempotencyKey: `batch-${crypto.randomUUID()}`, quantity: 2, maxConcurrent: 1, status: 'succeeded',
      completedCount: 2, failedCount: 0, parametersSnapshot: {}, source: 'demo-production', createdAt: now, updatedAt: now, finishedAt: now,
    })
    const candidates = [1, 2].map((index) => CandidateSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, kind: 'image', taskId: crypto.randomUUID(), batchId: batch.id,
      provider: 'demo-local', model: 'demo-frame-v1', inputSnapshot: {}, label: `候选 ${index}`,
      status: 'ready', favorite: index === 1, createdAt: now,
    }))
    const wrapper = mount(CandidateReviewPanel, { props: { candidates, batches: [batch], selectedCandidateId: candidates[0]!.id } })
    expect(wrapper.text()).toContain('1 个批次 · 1 已完成')
    expect(wrapper.text()).toContain('已批准')
    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    await wrapper.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('openCandidate')?.at(-1)?.[0]).toBe(candidates[1]!.id)
    await wrapper.trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('annotate')?.at(-1)).toEqual([candidates[1]!.id, { favorite: true }])
    await wrapper.get('button[aria-label="加入比较"]').trigger('click')
    expect(wrapper.text()).toContain('候选选择与收藏状态相互独立')
    wrapper.unmount()
  })

  it('候选批次失败项需要二次确认才创建新批次', async () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const batch = CandidateBatchSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, kind: 'image', modelId: 'demo-frame-v1',
      idempotencyKey: `partial-${crypto.randomUUID()}`, quantity: 2, maxConcurrent: 1, status: 'partial',
      completedCount: 1, failedCount: 1, parametersSnapshot: {}, source: 'demo-production', createdAt: now, updatedAt: now, finishedAt: now,
    })
    const candidate = CandidateSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, kind: 'image', taskId: crypto.randomUUID(), batchId: batch.id,
      provider: 'demo-local', model: 'demo-frame-v1', inputSnapshot: {}, status: 'ready', createdAt: now,
    })
    const wrapper = mount(CandidateReviewPanel, { props: { candidates: [candidate], batches: [batch] } })
    const retry = wrapper.get('.candidate-review__retry button')
    await retry.trigger('click')
    expect(wrapper.emitted('retryFailedBatch')).toBeUndefined()
    expect(retry.text()).toContain('确认')
    await retry.trigger('click')
    expect(wrapper.emitted('retryFailedBatch')?.[0]).toEqual([batch.id])
    wrapper.unmount()
  })

  it('项目生成策略要求二次确认，并在 Demo 模式保持外部成本预算为 0', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const projectId = crypto.randomUUID()
    store.currentProjectId = projectId
    store.generationPolicy = {
      projectId, revision: 1, billingMode: 'demo-only', paidProviders: 'blocked', maxConcurrentTasks: 4,
      maxCandidatesPerBatch: 4, maxExportDurationMs: 120_000, dailyPaidBudgetMicros: 0, updatedAt: new Date().toISOString(),
    }
    store.taskAdmission = {
      projectId, allowed: true, activeTasks: 0, maxConcurrentTasks: 4, maxCandidatesPerBatch: 4,
      maxExportDurationMs: 120_000, policyRevision: 1, paidProviders: 'blocked', dailyPaidBudgetMicros: 0,
      dailyPaidSpentMicros: 0, remainingPaidBudgetMicros: 0, providerNetworkDisabled: true, reasons: [], checkedAt: new Date().toISOString(),
    }
    const update = vi.spyOn(store, 'updateGenerationPolicy').mockResolvedValue(true)
    const wrapper = mount(GenerationPolicyPanel, { global: { plugins: [pinia] } })
    const inputs = wrapper.findAll('input')
    await inputs[1]!.setValue('2')
    await inputs[2]!.setValue('3')
    await inputs[3]!.setValue('90')
    expect(wrapper.text()).toContain('外部 Provider 关闭')
    expect(wrapper.text()).toContain('US$0.00 / US$0.00')
    const save = wrapper.get('button[type="submit"]')
    const form = wrapper.get('form')
    await form.trigger('submit')
    expect(update).not.toHaveBeenCalled()
    expect(save.text()).toContain('再次确认')
    await form.trigger('submit')
    expect(update).toHaveBeenCalledWith({ billingMode: 'demo-only', dailyPaidBudgetMicros: 0, maxConcurrentTasks: 2, maxCandidatesPerBatch: 3, maxExportDurationMs: 90_000 })
    wrapper.unmount()
  })

  it('恢复中心对账未知任务并用二次确认解除失效边界帧', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const projectId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const taskId = crypto.randomUUID()
    store.currentProjectId = projectId
    vi.spyOn(directorApi, 'projectRecoveryReport').mockResolvedValue({
      projectId, generatedAt: new Date().toISOString(),
      summary: { errors: 0, warnings: 1, recoverableTasks: 1 },
      issues: [{
        code: 'BOUNDARY_MEDIA_MISSING', severity: 'warning', entityType: 'shot', entityId: shotId,
        relatedEntityId: crypto.randomUUID(), boundaryRole: 'start', action: 'clear_boundary',
        message: '镜头首帧引用的媒体不存在，可安全解除失效绑定。',
      }],
      tasks: [{
        taskId, type: 'video', status: 'outcome_unknown', stage: '等待 Provider 对账',
        actions: ['reconcile', 'inspect'], updatedAt: new Date().toISOString(),
      }],
    })
    const reconcile = vi.spyOn(store, 'reconcileTask').mockResolvedValue()
    const changeView = vi.spyOn(store, 'changeView').mockResolvedValue()
    const clearBoundary = vi.spyOn(store, 'clearBoundaryFrame').mockResolvedValue()
    const wrapper = mount(RecoveryCenterPanel, { props: { active: true }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.text()).toContain('恢复与完整性中心')
    expect(wrapper.text()).toContain('可恢复任务')
    expect(wrapper.text()).toContain('结果未知')

    const bulk = wrapper.findAll('button').find((button) => button.text().includes('对账全部未知任务'))
    if (!bulk) throw new Error('RECOVERY_BULK_BUTTON_MISSING')
    await bulk.trigger('click')
    await flushPromises()
    expect(reconcile).toHaveBeenCalledWith(taskId)

    const clear = wrapper.findAll('button').find((button) => button.text().includes('解除失效绑定'))
    if (!clear) throw new Error('RECOVERY_CLEAR_BUTTON_MISSING')
    await clear.trigger('click')
    expect(clearBoundary).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('再次确认解除')
    await clear.trigger('click')
    await flushPromises()
    expect(changeView).toHaveBeenCalledWith('production')
    expect(clearBoundary).toHaveBeenCalledWith(shotId, 'start')
    wrapper.unmount()
  })

  it('安全审计面板只展示固定动作、状态、关联 ID 与哈希引用', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const projectId = crypto.randomUUID()
    const operationId = crypto.randomUUID()
    store.currentProjectId = projectId
    vi.spyOn(directorApi, 'projectSecurityAudit').mockResolvedValue({
      projectId, generatedAt: new Date().toISOString(),
      events: [{
        id: crypto.randomUUID(), operationId, projectId, action: 'generation_policy.update', status: 'succeeded',
        targetType: 'project', targetReferenceHash: 'a'.repeat(64), correlationId: 'security-audit-ui-001', createdAt: new Date().toISOString(),
      }],
    })
    const wrapper = mount(SecurityAuditPanel, { props: { active: true }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.text()).toContain('高风险动作审计')
    expect(wrapper.text()).toContain('更新生成策略')
    expect(wrapper.text()).toContain('已完成')
    expect(wrapper.text()).toContain('aaaaaaaaaaaa')
    expect(wrapper.text()).not.toContain(projectId)
    wrapper.unmount()
  })

  it('系统面板展示 schema v12、安全凭据库、Prompt/Skill 与分层记忆工作台', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    vi.spyOn(directorApi, 'listPromptRevisions').mockResolvedValue([])
    vi.spyOn(directorApi, 'listSkillVersions').mockResolvedValue([])
    vi.spyOn(directorApi, 'memoryModelStatus').mockResolvedValue({
      mode: 'keyword', keywordReady: true,
      onnx: { enabled: false, installed: false, status: 'not-requested', modelId: 'test', revision: 'test', expectedSha256: 'a'.repeat(64) },
    })
    vi.spyOn(directorApi, 'listMemory').mockResolvedValue([])
    vi.spyOn(directorApi, 'egressStatus').mockResolvedValue({
      enabled: false, networkDisabled: true,
      policies: [{ id: 'model-api.default', channel: 'model-api', enabled: false, allowedHosts: [], allowedMethods: ['POST'], timeoutMs: 60_000, maxRequestBytes: 2_000_000, maxResponseBytes: 10_000_000, maxRedirects: 0, allowedResponseMimePrefixes: ['application/json'], credentialConfigured: false }],
    })
    vi.spyOn(directorApi, 'projectSecurityAudit').mockResolvedValue({ projectId: crypto.randomUUID(), generatedAt: new Date().toISOString(), events: [] })
    const wrapper = mount(StudioDialogs, {
      props: {
        commandOpen: false, systemsOpen: true, hasProject: true, views: [],
        promptPack: {
          package: '@local/ai-video-director-prompt-pack@0.1.0',
          prompts: Array.from({ length: 26 }, (_, index) => ({ id: `prompt-${index}`, version: '1.0.0', title: `Prompt ${index}`, stage: 'test', status: 'active' as const, contentHash: 'a'.repeat(64) })),
          skills: Array.from({ length: 31 }, (_, index) => ({ id: `skill-${index}`, version: '1.0.0', title: `Skill ${index}`, family: 'production' as const, trustLevel: 'builtin' as const, contentHash: 'b'.repeat(64) })),
          workflows: [{ id: 'workflow.test', version: '1.0.0', title: 'Test', stepCount: 16 }],
          providerProfileCount: 13,
        },
        evidence: { promptRuns: 20, artifacts: 18, automaticReviews: 6 },
      },
      global: {
        plugins: [pinia],
        stubs: {
          DialogRoot: { template: '<div><slot /></div>' },
          DialogPortal: { template: '<div><slot /></div>' },
          DialogOverlay: { template: '<div />' },
          DialogContent: { template: '<section><slot /></section>' },
          DialogTitle: { template: '<h2><slot /></h2>' },
          DialogDescription: { template: '<p><slot /></p>' },
          DialogClose: { template: '<button><slot /></button>' },
        },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Schema v12')
    expect(wrapper.text()).toContain('26 Prompt · 31 Skill · 1 Workflow · 16 阶段')
    expect(wrapper.text()).toContain('20 PromptRun · 18 Artifact · 6 Critic')
    expect(wrapper.text()).toContain('版本、diff 与发布门禁')
    expect(wrapper.find('[aria-label="Prompt stable key"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('创建 Skill 版本')
    expect(wrapper.text()).toContain('可追溯创作记忆')
    expect(wrapper.text()).toContain('出口 Broker')
    expect(wrapper.text()).toContain('网络门禁关闭 · 1 通道 · 0 个授权主机')
    expect(wrapper.text()).toContain('安全凭据库')
    expect(wrapper.text()).toContain('系统 Keychain/Credential Manager')
    expect(wrapper.text()).toContain('Docker 使用只读 Secret')
    expect(wrapper.text()).toContain('可执行插件已关闭')
    expect(wrapper.text()).toContain('不上传或执行第三方 JavaScript/Python')
    expect(wrapper.text()).not.toContain('Deno 2.9.2')
    expect(wrapper.find('.runtime-card button').exists()).toBe(false)
    expect(directorApi.listPromptRevisions).toHaveBeenCalled()
    expect(directorApi.listSkillVersions).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('Provider 扩展只引导到内置或声明式 HTTPS 连接', () => {
    const wrapper = mount(ProviderPublisherTrust)
    expect(wrapper.text()).toContain('可执行插件已封存')
    expect(wrapper.text()).toContain('不上传或执行第三方 JavaScript/Python')
    expect(wrapper.text()).toContain('OpenAI-compatible 或声明式 HTTP 连接')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
    wrapper.unmount()
  })

  it('分层记忆展示采用原因，并且禁用与删除不会改写 canonical source', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const projectId = crypto.randomUUID()
    store.currentProjectId = projectId
    const now = new Date().toISOString()
    const record = MemoryRecordSchema.parse({
      id: crypto.randomUUID(), scope: 'episode', scopeId: projectId, originProjectId: projectId,
      sourceType: 'story_event', sourceKey: `story-event:${crypto.randomUUID()}`, sourceRevision: 2,
      title: '灯塔来信', summary: '主角在灯塔收到改变路线的来信。', content: '灯塔来信已经由用户批准。',
      keywords: ['灯塔', '来信'], contentHash: 'd'.repeat(64), stale: false, disabled: false,
      sensitiveFlags: [], createdAt: now, updatedAt: now,
    })
    vi.spyOn(directorApi, 'memoryModelStatus').mockResolvedValue({
      mode: 'keyword', keywordReady: true,
      onnx: { enabled: false, installed: false, status: 'not-requested', modelId: 'test', revision: 'test', expectedSha256: 'a'.repeat(64) },
    })
    vi.spyOn(directorApi, 'listMemory').mockResolvedValue([record])
    vi.spyOn(directorApi, 'rebuildMemory').mockResolvedValue({ projectId, created: 1, reused: 0, markedStale: 0, skippedSensitive: 0, indexedChunks: 1 })
    vi.spyOn(directorApi, 'searchMemory').mockResolvedValue([{
      record, score: 120, matchedKeywords: ['灯塔'], reasons: ['Episode 作用域优先', '关键词命中：灯塔'],
    }])
    const toggleSpy = vi.spyOn(directorApi, 'toggleMemory').mockResolvedValue({ ...record, disabled: true, updatedAt: new Date(Date.now() + 1_000).toISOString() })
    const deleteSpy = vi.spyOn(directorApi, 'deleteMemory').mockResolvedValue({ deleted: true })

    const wrapper = mount(MemoryWorkspace, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.text()).toContain('关键词降级')
    expect(wrapper.text()).toContain('not-requested')
    expect(wrapper.text()).toContain('当前作用域已有 1 条记录')

    await wrapper.get('#memory-query').setValue('灯塔')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Episode 作用域优先')
    expect(wrapper.text()).toContain('关键词命中：灯塔')

    await wrapper.get('.memory-actions button').trigger('click')
    expect(toggleSpy).toHaveBeenCalledWith(record.id, true)
    await flushPromises()
    expect(wrapper.text()).toContain('启用')

    const deleteButton = wrapper.findAll('.memory-actions button')[1]!
    await deleteButton.trigger('click')
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('再次确认删除')
    await deleteButton.trigger('click')
    await flushPromises()
    expect(deleteSpy).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain('灯塔来信')
    wrapper.unmount()
  })

  it('项目切换器提供自包含备份与安全导入入口', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    store.currentProjectId = crypto.randomUUID()
    const wrapper = mount(ProjectSwitcher, {
      global: {
        plugins: [pinia, router],
        stubs: {
          DialogRoot: { template: '<div><slot /></div>' }, DialogTrigger: { template: '<div><slot /></div>' },
          DialogPortal: { template: '<div><slot /></div>' }, DialogOverlay: { template: '<div />' },
          DialogContent: { template: '<section><slot /></section>' }, DialogTitle: { template: '<h2><slot /></h2>' },
          DialogDescription: { template: '<p><slot /></p>' }, DialogClose: { template: '<button><slot /></button>' },
        },
      },
    })
    expect(wrapper.text()).toContain('导入项目包')
    expect(wrapper.text()).toContain('备份当前项目')
    expect(wrapper.text()).toContain('凭据、日志和本机路径永不入包')
    expect(wrapper.get('input[type="file"]').attributes('accept')).toContain('.aigcproj')
    wrapper.unmount()
  })

  it('TXT/Markdown 在确认前只显示服务端隔离预览', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const projectId = crypto.randomUUID()
    store.currentProjectId = projectId
    const preview = {
      id: crypto.randomUUID(), projectId, originalFileName: 'story.md', format: 'markdown' as const, encoding: 'utf-8' as const,
      byteSize: 54, characterCount: 28, contentHash: 'b'.repeat(64), suggestedTitle: '第一章 起点',
      previewText: '# 第一章 起点\n灯光突然亮起。', previewTruncated: false,
      chapterTitles: ['第一章 起点'], warnings: [], expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    vi.spyOn(directorApi, 'previewSourceImport').mockResolvedValue(preview)
    vi.spyOn(directorApi, 'cancelSourceImport').mockResolvedValue({ id: preview.id, status: 'cancelled' })
    const wrapper = mount(SourceComposer, {
      global: {
        plugins: [pinia],
        stubs: {
          DialogRoot: { template: '<div><slot /></div>' }, DialogTrigger: { template: '<div><slot /></div>' },
          DialogPortal: { template: '<div><slot /></div>' }, DialogOverlay: { template: '<div />' },
          DialogContent: { template: '<section><slot /></section>' }, DialogTitle: { template: '<h2><slot /></h2>' },
          DialogDescription: { template: '<p><slot /></p>' }, DialogClose: { template: '<button><slot /></button>' },
        },
      },
    })
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    const input = wrapper.get<HTMLInputElement>('#source-file')
    expect(input.attributes('accept')).toContain('.markdown')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['# 第一章 起点\n灯光突然亮起。'], 'story.md', { type: 'text/markdown' })] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('隔离预览已就绪')
    expect(wrapper.text()).toContain('第一章 起点')
    expect(wrapper.get('.source-import-text').text()).toContain('灯光突然亮起')
    expect(directorApi.previewSourceImport).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('从父级按钮打开原著导入对话框', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(SourceComposer, {
      attachTo: document.body,
      slots: { default: '<button type="button">导入原著</button>' },
      global: { plugins: [pinia] },
    })

    expect(document.body.textContent).not.toContain('导入原著或创意文本')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('导入原著或创意文本')
    wrapper.unmount()
  })

  it('镜头 Inspector 编辑 Beat 并显示可追溯首尾帧', async () => {
    const now = new Date().toISOString()
    const shot = ShotSchema.parse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), sceneId: crypto.randomUUID(), title: '连续镜头',
      description: '推门后停步', durationMs: 3_000, ordinal: 1, revision: 2,
      beats: [
        { id: crypto.randomUUID(), ordinal: 0, startMs: 0, durationMs: 1_500, action: '推门', camera: '中景' },
        { id: crypto.randomUUID(), ordinal: 1, startMs: 1_500, durationMs: 1_500, action: '停步', camera: '特写' },
      ],
      boundaryFrames: [{
        id: crypto.randomUUID(), role: 'start', mediaId: crypto.randomUUID(), mediaSha256: 'f'.repeat(64),
        sourceShotId: crypto.randomUUID(), sourceRevision: 1, provenance: 'linked_previous_end', createdAt: now,
      }],
      createdAt: now, updatedAt: now,
    })
    const wrapper = mount(ShotContinuityPanel, { props: { shot, canLinkPrevious: true } })
    expect(wrapper.text()).toContain('2 个节拍 · 3.0 秒')
    expect(wrapper.text()).toContain('沿用上一镜头尾帧')
    expect(wrapper.text()).toContain('linked_previous_end')
    await wrapper.get('[data-action="save-beats"]').trigger('click')
    expect(wrapper.emitted('saveBeats')?.[0]?.[0]).toEqual(shot.beats)
    await wrapper.get('[data-action="link-previous"]').trigger('click')
    expect(wrapper.emitted('linkPrevious')).toHaveLength(1)
    wrapper.unmount()
  })

  it('资产 Inspector 展示 Series 来源、revision、影响和显式 fork 入口', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const seriesId = crypto.randomUUID()
    const episodeId = crypto.randomUUID()
    const assetId = crypto.randomUUID()
    const variantId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '第一集', status: 'active', graphRevision: 3, createdAt: now, updatedAt: now },
      series: { id: seriesId, workspaceId: crypto.randomUUID(), name: '连续剧', revision: 1, createdAt: now, updatedAt: now },
      episode: { id: episodeId, projectId, seriesId, ordinal: 0, title: '第一集', revision: 2, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: [], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [],
      resolvedAssets: [{ logicalId: crypto.randomUUID(), source: 'series', sourceId: seriesId, assetKind: 'shared', assetId, variantId, revision: 4, type: 'character', name: '共享主角', drifted: true }],
      assetBindings: [{ id: crypto.randomUUID(), projectId, shotId, slot: 'character', assetKind: 'shared', assetId, variantId, assetRevision: 3, originScope: 'series', originScopeId: seriesId, drifted: true, createdAt: now, updatedAt: now }],
    })
    store.graph = { projectId, view: 'production', revision: 3, nodes: [{ id: `asset:${assetId}`, entityId: assetId, type: 'asset', label: '共享主角', subtitle: 'character · series', status: 'stale', position: { x: 0, y: 0 }, metadata: {} }], edges: [], generatedAt: now }
    store.selectedNodeId = `asset:${assetId}`
    const wrapper = mount(StudioInspector, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain('series')
    expect(wrapper.text()).toContain('r4')
    expect(wrapper.text()).toContain('受影响镜头')
    expect(wrapper.text()).toContain('Fork 到当前 Episode')
    expect(wrapper.text()).toContain('预览修复')
    wrapper.unmount()
  })

  it('Episode Inspector 显示跨集摘要 stale 原因并要求二次确认生成', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useStudioStore()
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const episodeId = crypto.randomUUID()
    const previousProjectId = crypto.randomUUID()
    const previousEpisodeId = crypto.randomUUID()
    const sourceId = crypto.randomUUID()
    const episode = { id: episodeId, projectId, ordinal: 1, title: '第二集', revision: 2, createdAt: now, updatedAt: now }
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '第二集', status: 'active', graphRevision: 3, createdAt: now, updatedAt: now },
      episode,
      sources: [], chapters: [], events: [], eventEdges: [], scenes: [], shots: [], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [],
    })
    store.episodeContinuity = EpisodeContinuityStateSchema.parse({
      current: {
        episode, currentSource: { id: sourceId, revision: 2, contentHash: 'a'.repeat(64) },
        stale: true, staleReasons: ['missing_summary'],
      },
      previous: {
        episode: { id: previousEpisodeId, projectId: previousProjectId, ordinal: 0, title: '第一集', revision: 3, createdAt: now, updatedAt: now },
        summary: {
          episodeId: previousEpisodeId, source: { id: crypto.randomUUID(), revision: 1, contentHash: 'b'.repeat(64) },
          summary: '上一集主角抵达灯塔。', nextHook: '地下室仍亮着灯。', eventRevisionHash: 'c'.repeat(64), generatedAt: now,
        },
        stale: true, staleReasons: ['source_changed'],
      },
    })
    store.graph = {
      projectId, view: 'story', revision: 3,
      nodes: [{ id: `episode:${episodeId}`, entityId: episodeId, type: 'episode', label: '第二集', subtitle: 'Episode 2', status: 'stale', position: { x: 0, y: 0 }, metadata: {} }],
      edges: [], generatedAt: now,
    }
    store.selectedNodeId = `episode:${episodeId}`
    const generate = vi.spyOn(store, 'createEpisodeContinuitySummary').mockResolvedValue()
    const wrapper = mount(StudioInspector, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain('上一集主角抵达灯塔')
    expect(wrapper.text()).toContain('source_changed')
    const action = wrapper.findAll('button').find((button) => button.text().includes('生成跨集摘要'))
    if (!action) throw new Error('TEST_CONTINUITY_ACTION_MISSING')
    await action.trigger('click')
    expect(generate).not.toHaveBeenCalled()
    expect(action.text()).toContain('确认固定')
    await action.trigger('click')
    expect(generate).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
