import { flushPromises, mount } from '@vue/test-utils'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GraphNodeCard from '../src/components/GraphNodeCard.vue'
import AgentPanel from '../src/components/AgentPanel.vue'
import ArtifactHistoryPanel from '../src/components/ArtifactHistoryPanel.vue'
import CandidateEvidence from '../src/components/CandidateEvidence.vue'
import CandidateReviewPanel from '../src/components/CandidateReviewPanel.vue'
import MediaPreview from '../src/components/MediaPreview.vue'
import MemoryWorkspace from '../src/components/MemoryWorkspace.vue'
import PromptOperationsWorkspace from '../src/components/PromptOperationsWorkspace.vue'
import ProviderPublisherTrust from '../src/components/ProviderPublisherTrust.vue'
import StudioDialogs from '../src/components/StudioDialogs.vue'
import ProjectSwitcher from '../src/components/ProjectSwitcher.vue'
import SourceComposer from '../src/components/SourceComposer.vue'
import ShotContinuityPanel from '../src/components/ShotContinuityPanel.vue'
import StudioInspector from '../src/components/StudioInspector.vue'
import { createPinia, setActivePinia } from 'pinia'
import { DirectorApiError, directorApi } from '../src/api/client.js'
import { router } from '../src/router.js'
import { upsertTask } from '../src/stores/studio.js'
import { useStudioStore } from '../src/stores/studio.js'
import { AgentRunCheckpointSchema, ArtifactVersionSchema, CandidateBatchSchema, CandidateSchema, ExecutionPlanSchema, GenerationTaskSchema, MemoryRecordSchema, ProjectSnapshotSchema, PromptRevisionSchema, ReviewDecisionSchema, ShotSchema } from '@aigc-director/contracts'

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
    store.currentProjectId = projectId
    store.snapshot = ProjectSnapshotSchema.parse({
      project: { id: projectId, name: '局部任务', status: 'active', graphRevision: 4, createdAt: now, updatedAt: now },
      sources: [], chapters: [], events: [], eventEdges: [],
      scenes: [{ id: sceneId, projectId, title: '雨夜车站', synopsis: '人物收到来信', ordinal: 0, revision: 2, createdAt: now, updatedAt: now }],
      shots: [], assets: [], variants: [], media: [], candidates: [], tasks: [], plans: [], promptRuns: [], attempts: [], providerReceipts: [], reviews: [], artifactVersions: [], resolvedAssets: [], assetBindings: [],
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
      scope: { type: 'scene', id: sceneId }, dependencies: [], content: { promptRevisionId: prompt.id },
      contentHash: 'b'.repeat(64), status: 'approved', createdAt: now, updatedAt: now,
    })
    const task = GenerationTaskSchema.parse({
      id: crypto.randomUUID(), projectId, type: 'adaptation', status: 'succeeded', stage: '局部重生成',
      idempotencyKey: 'scoped-regenerate-test-task', provider: 'demo-local', model: 'demo-structured-v1', attempt: 1,
      inputSnapshot: { promptBinding: { promptRevisionId: prompt.id, targetType: 'scene', targetId: sceneId, targetRevision: 2 } },
      result: { artifactVersionId: artifact.id, billed: false }, retryable: false, createdAt: now, updatedAt: now, finishedAt: now,
    })
    const regenerate = vi.spyOn(directorApi, 'scopedRegenerate').mockResolvedValue({ task, artifact })
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
    expect(wrapper.text()).toContain('已追加 SceneScriptRevision r1')
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

  it('系统面板展示 Prompt Pack、schema v9、Prompt/Skill 与分层记忆工作台', async () => {
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
    vi.spyOn(directorApi, 'denoRuntimeStatus').mockResolvedValue({
      version: '2.9.2', platform: 'darwin', arch: 'arm64', supported: true, state: 'not-installed',
      assetName: 'deno-aarch64-apple-darwin.zip', downloadBytes: 37_981_362, archiveSha256: 'a'.repeat(64),
      networkDisabled: false, installAllowed: true,
    })
    vi.spyOn(directorApi, 'listProviderPlugins').mockResolvedValue([])
    vi.spyOn(directorApi, 'listProviderPublishers').mockResolvedValue([])
    const readyRuntime = {
      version: '2.9.2', platform: 'darwin', arch: 'arm64', supported: true, state: 'ready',
      assetName: 'deno-aarch64-apple-darwin.zip', downloadBytes: 37_981_362, archiveSha256: 'a'.repeat(64),
      binarySha256: 'b'.repeat(64), installedAt: new Date().toISOString(), networkDisabled: false, installAllowed: false,
    } as const
    const notInstalledRuntime = {
      version: '2.9.2', platform: 'darwin', arch: 'arm64', supported: true, state: 'not-installed',
      assetName: 'deno-aarch64-apple-darwin.zip', downloadBytes: 37_981_362, archiveSha256: 'a'.repeat(64),
      networkDisabled: false, installAllowed: true,
    } as const
    let rejectInstall: ((reason?: unknown) => void) | undefined
    const installRuntime = vi.spyOn(directorApi, 'installDenoRuntime')
      .mockImplementationOnce(async () => await new Promise((_, reject) => { rejectInstall = reject }))
      .mockResolvedValueOnce(readyRuntime)
    const cancelRuntime = vi.spyOn(directorApi, 'cancelDenoRuntimeInstall').mockImplementation(async () => {
      rejectInstall?.(new DirectorApiError('DENO_RUNTIME_ABORTED', '安装已取消', true, 'runtime-cancel-test'))
      return { status: 'cancelled', runtime: notInstalledRuntime }
    })
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
    expect(wrapper.text()).toContain('Schema v9')
    expect(wrapper.text()).toContain('26 Prompt · 31 Skill · 1 Workflow · 16 阶段')
    expect(wrapper.text()).toContain('20 PromptRun · 18 Artifact · 6 Critic')
    expect(wrapper.text()).toContain('版本、diff 与发布门禁')
    expect(wrapper.find('[aria-label="Prompt stable key"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Skill stable key"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('可追溯创作记忆')
    expect(wrapper.text()).toContain('出口 Broker')
    expect(wrapper.text()).toContain('网络门禁关闭 · 1 通道 · 0 个授权主机')
    expect(wrapper.text()).toContain('Deno 2.9.2 · 未安装 · 36.2 MB')
    expect(wrapper.text()).toContain('未安装受信签名插件')
    const runtimeButton = wrapper.get('.runtime-card button')
    await runtimeButton.trigger('click')
    expect(wrapper.text()).toContain('再次点击确认下载')
    expect(installRuntime).not.toHaveBeenCalled()
    await runtimeButton.trigger('click')
    expect(installRuntime).toHaveBeenCalledOnce()
    expect(runtimeButton.text()).toContain('取消安装')
    expect(wrapper.text()).toContain('正在下载 · 0%')
    expect(wrapper.get('progress[aria-label="Deno 运行时安装进度"]').attributes('max')).toBe('100')
    await runtimeButton.trigger('click')
    await flushPromises()
    expect(cancelRuntime).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Deno 2.9.2 · 未安装')
    expect(wrapper.text()).not.toContain('安装已取消')
    await runtimeButton.trigger('click')
    await runtimeButton.trigger('click')
    await flushPromises()
    expect(installRuntime).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Deno 2.9.2 · 已验证')
    expect(directorApi.listPromptRevisions).toHaveBeenCalled()
    expect(directorApi.listSkillVersions).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('Provider 发布者信任需要二次确认，列表只显示指纹', async () => {
    const now = new Date().toISOString()
    const trusted = {
      id: crypto.randomUUID(), keyId: 'publisher.ui-test', displayName: 'UI 原创发布者',
      publicKeyFingerprint: 'e'.repeat(64), state: 'trusted' as const, revision: 1, createdAt: now, updatedAt: now,
    }
    vi.spyOn(directorApi, 'listProviderPublishers').mockResolvedValue([])
    const trust = vi.spyOn(directorApi, 'trustProviderPublisher').mockResolvedValue(trusted)
    const revoke = vi.spyOn(directorApi, 'revokeProviderPublisher').mockResolvedValue({
      ...trusted, state: 'revoked', revision: 2, revokedAt: now,
    })
    const wrapper = mount(ProviderPublisherTrust, { props: { active: true } })
    await flushPromises()
    await wrapper.get('input[placeholder="publisher.example"]').setValue('publisher.ui-test')
    await wrapper.get('input[placeholder="发布者名称"]').setValue('UI 原创发布者')
    const pem = `-----BEGIN PUBLIC KEY-----\n${'A'.repeat(80)}\n-----END PUBLIC KEY-----`
    await wrapper.get('textarea').setValue(pem)
    const trustButton = wrapper.get('.publisher-form button')
    await trustButton.trigger('click')
    expect(trust).not.toHaveBeenCalled()
    expect(trustButton.text()).toContain('再次点击')
    await trustButton.trigger('click')
    await flushPromises()
    expect(trust).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('eeeeeeeeeeee…eeeeeeee')
    expect(wrapper.text()).not.toContain('BEGIN PUBLIC KEY')

    const revokeButton = wrapper.get('.publisher-list button')
    await revokeButton.trigger('click')
    expect(revoke).not.toHaveBeenCalled()
    await revokeButton.trigger('click')
    await flushPromises()
    expect(revoke).toHaveBeenCalledWith(trusted.id, 1)
    expect(wrapper.text()).toContain('已撤销')
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
})
