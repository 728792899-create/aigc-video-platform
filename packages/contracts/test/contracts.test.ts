import { describe, expect, it } from 'vitest'
import {
  AgentRunCheckpointSchema,
  ArtifactDiffSchema,
  ArtifactVersionSchema,
  ArtifactHeadSchema,
  AssetBindingSchema,
  CandidateBatchRetryRequestSchema,
  CandidateBatchSchema,
  CandidateSchema,
  CreativeBriefCandidateRequestSchema,
  CreativeBriefCandidateReviewRequestSchema,
  CreativeBriefSchema,
  CreativeBriefRevisionRequestSchema,
  GenerationTaskSchema,
  EgressBrokerStatusSchema,
  DenoRuntimeInstallRequestSchema,
  DenoRuntimeCancelRequestSchema,
  DenoRuntimeStatusSchema,
  EgressRequestDescriptorSchema,
  EpisodeContinuitySummaryRequestSchema,
  EpisodeContinuitySummarySchema,
  ExportApprovalRequestSchema,
  ExportPreflightSchema,
  ExportTaskInputSchema,
  GraphCommandSchema,
  ProjectPackageManifestSchema,
  ReconcilePreviewSchema,
  ScenePatchApplyRequestSchema,
  SceneRevisionPatchSchema,
  PromptRevisionSchema,
  PromptPolishRequestSchema,
  ProjectGenerationPolicySchema,
  ProjectGenerationPolicyUpdateRequestSchema,
  ScopedPromptBindingSchema,
  ScopedRegenerationRequestSchema,
  ProviderMediaReceiptSchema,
  ProviderPluginManifestSchema,
  ProviderPluginInstallRequestSchema,
  ProviderPluginTestRequestSchema,
  ProviderPluginEnableRequestSchema,
  ProviderPluginRecordSchema,
  ProviderPublisherRevokeRequestSchema,
  ProviderPublisherTrustRequestSchema,
  ProviderPublisherTrustSchema,
  ProviderConnectionCreateRequestSchema,
  ProviderConnectionSchema,
  ProviderRoutePolicySchema,
  ProjectDiagnosticBundleSchema,
  ProjectSecurityAuditLogSchema,
  SecurityAuditEventSchema,
  ModelDescriptorSchema,
  MusicAssetMetadataSchema,
  MemoryRecordSchema,
  MemorySearchResultSchema,
  SkillPackageVersionSchema,
  ResolvedAssetSchema,
  SharedAssetSchema,
  ShotSchema,
  SourceImportPreviewSchema,
  StoryEventEdgeSchema,
  TaskDiagnosticSchema,
  TaskAdmissionSchema,
  TaskRetryRequestSchema,
  VoiceAssetMetadataSchema,
  parseAssetMetadata,
} from '../src/index.js'

describe('2.0 跨进程契约', () => {
  it('Provider 连接只保存凭据引用，拒绝 HTTP、嵌入凭据和可执行适配器', () => {
    const now = new Date().toISOString()
    const connection = ProviderConnectionSchema.parse({
      id: crypto.randomUUID(), displayName: '主生成连接', protocol: 'openai-compatible',
      endpointOrigin: 'https://relay.example.com/', credentialRef: 'keychain:relay-primary', credentialConfigured: true,
      capabilities: ['text', 'image'], state: 'ready', trust: 'verified-endpoint', revision: 1,
      createdAt: now, updatedAt: now,
    })
    expect(JSON.stringify(connection)).not.toContain('secret-value')
    expect(ProviderConnectionCreateRequestSchema.safeParse({
      displayName: '不安全连接', protocol: 'openai-compatible', endpointOrigin: 'http://relay.example.com/',
      credentialKey: 'relay-primary', credential: 'demo-not-real-secret', capabilities: ['image'],
      confirmation: 'CREATE_LOCAL_PROVIDER_CONNECTION',
    }).success).toBe(false)
    expect(ProviderConnectionCreateRequestSchema.safeParse({
      displayName: '伪插件', protocol: 'declarative-http', endpointOrigin: 'https://relay.example.com/',
      credentialKey: 'relay-primary', capabilities: ['video'], confirmation: 'CREATE_LOCAL_PROVIDER_CONNECTION',
      manifest: {
        version: 1, submit: { method: 'POST', path: '/jobs', response: { jobId: 'data.id', status: 'data.status' } },
        terminalStates: { succeeded: ['done'], failed: ['failed'] }, sourceCode: 'export default () => fetch("*")',
      },
    }).success).toBe(false)
  })

  it('Provider 路由拒绝主连接重复出现在降级链', () => {
    const primary = crypto.randomUUID()
    const fallback = crypto.randomUUID()
    expect(ProviderRoutePolicySchema.safeParse({
      projectId: crypto.randomUUID(), revision: 1,
      routes: [{ modality: 'image', primaryConnectionId: primary, fallbackConnectionIds: [primary], model: 'image-v1', maxAttempts: 2, timeoutMs: 60_000 }],
      dailyBudgetMicros: 0, currency: 'USD', updatedAt: new Date().toISOString(),
    }).success).toBe(false)
    expect(ProviderRoutePolicySchema.parse({
      projectId: crypto.randomUUID(), revision: 1,
      routes: [{
        modality: 'image', primaryConnectionId: primary, fallbackConnectionIds: [fallback],
        fallbackConnectionModels: { [fallback]: 'fallback-image-v2' }, model: 'image-v1', maxAttempts: 2, timeoutMs: 60_000,
      }],
      dailyBudgetMicros: 1_000_000, currency: 'USD', updatedAt: new Date().toISOString(),
    }).routes[0]?.fallbackConnectionModels).toEqual({ [fallback]: 'fallback-image-v2' })
    expect(ProviderRoutePolicySchema.safeParse({
      projectId: crypto.randomUUID(), revision: 1,
      routes: [{
        modality: 'image', primaryConnectionId: primary, fallbackConnectionIds: [fallback],
        fallbackConnectionModels: { [crypto.randomUUID()]: 'unreachable-model' }, model: 'image-v1', maxAttempts: 2, timeoutMs: 60_000,
      }],
      dailyBudgetMicros: 0, currency: 'USD', updatedAt: new Date().toISOString(),
    }).success).toBe(false)
  })

  it('安全审计只接受固定动作、阶段与脱敏目标引用', () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const operationId = crypto.randomUUID()
    const started = SecurityAuditEventSchema.parse({
      id: crypto.randomUUID(), operationId, projectId,
      action: 'generation_policy.update', status: 'started', targetType: 'project',
      targetReferenceHash: 'a'.repeat(64), correlationId: 'audit-contract-request-001', createdAt: now,
    })
    const succeeded = SecurityAuditEventSchema.parse({
      ...started, id: crypto.randomUUID(), status: 'succeeded', createdAt: new Date(Date.now() + 1).toISOString(),
    })
    const log = ProjectSecurityAuditLogSchema.parse({ projectId, generatedAt: now, events: [succeeded, started] })
    expect(log.events).toHaveLength(2)
    expect(SecurityAuditEventSchema.safeParse({ ...started, apiKey: 'forbidden' }).success).toBe(false)
    expect(SecurityAuditEventSchema.safeParse({ ...started, targetReferenceHash: projectId }).success).toBe(false)
    expect(SecurityAuditEventSchema.safeParse({ ...started, action: 'arbitrary.shell.execute' }).success).toBe(false)
  })

  it('创意简报使用严格可验证契约，不允许 UI 夹带未声明字段', () => {
    const brief = {
      goal: '将灯塔故事改编为可发布的竖屏短片', targetAudience: '科幻悬疑观众', platform: 'douyin',
      genre: '科幻悬疑', tone: '克制、电影化', targetDurationSeconds: 60, aspectRatio: '9:16',
      language: 'zh-CN', constraints: ['保留原著的灯塔线索'],
    } as const
    expect(CreativeBriefSchema.parse(brief).targetDurationSeconds).toBe(60)
    expect(CreativeBriefRevisionRequestSchema.safeParse({ expectedRevision: 0, brief, providerPayload: {} }).success).toBe(false)
    expect(CreativeBriefSchema.safeParse({ ...brief, targetDurationSeconds: 4 }).success).toBe(false)
  })

  it('创意简报候选固定锁定字段，批准和拒绝使用不同精确确认', () => {
    expect(CreativeBriefCandidateRequestSchema.parse({
      count: 3, feedback: '增加节奏感', lockedFields: ['goal', 'language'],
      idempotencyKey: 'brief-candidate-request-0001',
    }).lockedFields).toEqual(['goal', 'language'])
    expect(CreativeBriefCandidateReviewRequestSchema.safeParse({
      decision: 'approve', expectedApprovedRevision: 1,
      confirmation: 'APPROVE_CREATIVE_BRIEF', idempotencyKey: 'brief-review-request-0001',
    }).success).toBe(true)
    expect(CreativeBriefCandidateReviewRequestSchema.safeParse({
      decision: 'approve', expectedApprovedRevision: 1,
      confirmation: 'REJECT_CREATIVE_BRIEF', idempotencyKey: 'brief-review-request-0002',
    }).success).toBe(false)
  })

  it('Voice/Music 元数据有明确边界与权利状态', () => {
    expect(parseAssetMetadata('voice', {}).rightsStatus).toBe('review_required')
    expect(VoiceAssetMetadataSchema.safeParse({ language: 'zh-CN', speed: 3 }).success).toBe(false)
    expect(MusicAssetMetadataSchema.safeParse({ durationMs: 4_000, loopStartMs: 3_000, loopEndMs: 5_000 }).success).toBe(false)
    expect(parseAssetMetadata('music', { source: 'demo_fixture', rightsStatus: 'original' })).toMatchObject({ source: 'demo_fixture', rightsStatus: 'original' })
  })

  it('跨集摘要固定来源 revision/hash 且创建操作需要精确确认', () => {
    const sourceId = crypto.randomUUID()
    const episodeId = crypto.randomUUID()
    expect(EpisodeContinuitySummarySchema.parse({
      episodeId, source: { id: sourceId, revision: 2, contentHash: 'a'.repeat(64) },
      summary: '主角抵达灯塔并发现失踪记录。', nextHook: '地下室仍有灯光。',
      lockedFacts: ['灯塔已经停用'], eventRevisionHash: 'b'.repeat(64), generatedAt: new Date().toISOString(),
    }).source.revision).toBe(2)
    expect(EpisodeContinuitySummaryRequestSchema.safeParse({
      expectedSourceId: sourceId, expectedSourceRevision: 2, expectedSourceHash: 'a'.repeat(64),
      idempotencyKey: 'episode-summary-request-001', confirmation: 'CREATE_EPISODE_CONTINUITY_SUMMARY',
    }).success).toBe(true)
    expect(EpisodeContinuitySummaryRequestSchema.safeParse({
      expectedSourceId: sourceId, expectedSourceRevision: 2, expectedSourceHash: 'a'.repeat(64),
      idempotencyKey: 'episode-summary-request-001', confirmation: 'CONFIRM',
    }).success).toBe(false)
  })

  it('导出任务固定 Shot/Candidate/Media 顺序与 hash', () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const shot = {
      id: shotId, projectId, sceneId: crypto.randomUUID(), title: '镜头 1', description: '灯塔', durationMs: 1_000,
      ordinal: 0, revision: 2, staleFields: [], createdAt: now, updatedAt: now,
    }
    const selection = { shotId, shotRevision: 2, candidateId: crypto.randomUUID(), mediaId: crypto.randomUUID(), mediaSha256: 'a'.repeat(64), kind: 'image' }
    expect(ExportTaskInputSchema.parse({
      projectId, outputDirectory: '/tmp/export', fileName: 'demo.mp4', width: 1280, height: 720, fps: 24,
      shotSnapshots: [shot], selections: [selection], assemblyHash: 'b'.repeat(64), assembledAt: now,
    }).selections[0]?.candidateId).toBe(selection.candidateId)
    expect(ExportTaskInputSchema.safeParse({
      projectId, outputDirectory: '/tmp/export', fileName: 'demo.mp4', width: 1280, height: 720, fps: 24,
      shotSnapshots: [shot], selections: [{ ...selection, shotId: crypto.randomUUID() }], assemblyHash: 'b'.repeat(64), assembledAt: now,
    }).success).toBe(false)
  })

  it('导出预检不暴露本机目录，正式启动需要一次性精确确认', () => {
    const preflight = ExportPreflightSchema.parse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), fileName: 'demo.mp4',
      shotCount: 2, selectedCandidateCount: 2, durationMs: 8_000, width: 1280, height: 720, fps: 24,
      assemblyHash: 'a'.repeat(64), destination: 'local-directory-selected',
      billing: { provider: 'demo-local', verified: true, amountMicros: 0, currency: 'none' },
      approvalToken: 'approval-token-with-enough-entropy', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(preflight).not.toHaveProperty('outputDirectory')
    expect(ExportApprovalRequestSchema.safeParse({
      preflightId: preflight.id, approvalToken: preflight.approvalToken, confirmation: 'START_LOCAL_EXPORT',
    }).success).toBe(true)
    expect(ExportApprovalRequestSchema.safeParse({
      preflightId: preflight.id, approvalToken: preflight.approvalToken, confirmation: 'EXPORT',
    }).success).toBe(false)
  })

  it('项目诊断包只能包含脱敏状态证据', () => {
    const bundle = ProjectDiagnosticBundleSchema.parse({
      format: 'aigc-director-diagnostic', version: 1, generatedAt: new Date().toISOString(),
      projectReferenceHash: 'a'.repeat(64),
      runtime: { productVersion: '2.0.0', schemaVersion: 10, providerNetworkDisabled: true, billingMode: 'demo-only' },
      counts: { sources: 1, chapters: 1, events: 2, scenes: 1, shots: 2, assets: 1, candidates: 4, media: 4, artifacts: 3, tasks: 2 },
      taskStatusCounts: { succeeded: 1, failed: 1 },
      tasks: [{
        taskReferenceHash: 'b'.repeat(64), type: 'image', status: 'failed', stage: 'Demo 图片候选',
        provider: 'demo-local', model: 'demo-image-v1', attempt: 1, outcomeCertainty: 'certain',
        reconcileRequired: false, retryAllowed: true, cancelSemantics: 'local_only',
        correlationId: crypto.randomUUID(), errorCode: 'TASK_EXECUTION_FAILED',
        suggestedActions: ['retry', 'inspect'], elapsedMs: 30, updatedAt: new Date().toISOString(),
      }],
      integrityIssues: [],
      privacy: {
        credentialsIncluded: false, absolutePathsIncluded: false, rawUserContentIncluded: false,
        rawPromptsIncluded: false, providerPayloadsIncluded: false, signedUrlsIncluded: false,
      },
      bundleHash: 'c'.repeat(64),
    })
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain('inputSnapshot')
    expect(serialized).not.toContain('providerTaskId')
    expect(serialized).not.toContain('outputDirectory')
    expect(serialized).not.toContain('apiKey')
  })

  it('Agent checkpoint 只保存脱敏记忆引用，不接受记忆正文', () => {
    const now = new Date().toISOString()
    const citation = {
      memoryId: crypto.randomUUID(), scope: 'episode', sourceType: 'story_event', sourceKey: `event:${crypto.randomUUID()}`,
      sourceRevision: 2, contentHash: 'a'.repeat(64), score: 55, matchedKeywords: ['灯塔'], reasons: ['Episode 作用域优先'],
    }
    const checkpoint = AgentRunCheckpointSchema.parse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), runId: crypto.randomUUID(), planId: crypto.randomUUID(),
      graphRevision: 3, memoryQuery: '灯塔 来信', memoryCitations: [citation], memoryContextHash: 'b'.repeat(64),
      inputArtifactHashes: [{ artifactVersionId: crypto.randomUUID(), contentHash: 'c'.repeat(64) }], createdAt: now,
    })
    expect(checkpoint.memoryCitations[0]).not.toHaveProperty('content')
    expect(AgentRunCheckpointSchema.safeParse({
      ...checkpoint, memoryCitations: [{ ...citation, content: '不应持久化的记忆正文' }],
    }).success).toBe(false)
  })

  it('Artifact diff 只接受有界字段变更', () => {
    const diff = ArtifactDiffSchema.parse({
      fromVersionId: crypto.randomUUID(), toVersionId: crypto.randomUUID(),
      changes: [{ field: 'scene.title', before: '旧标题', after: '新标题' }],
    })
    expect(diff.changes[0]?.field).toBe('scene.title')
    expect(ArtifactDiffSchema.safeParse({ ...diff, changes: [{ field: '', before: 1, after: 2 }] }).success).toBe(false)
  })

  it('局部重生成绑定 Prompt 与目标 revision，拒绝夹带未声明快照字段', () => {
    const binding = {
      promptRevisionId: crypto.randomUUID(), stableKey: 'script.scene-polish', promptRevision: 3,
      promptContentHash: 'a'.repeat(64), targetType: 'scene', targetId: crypto.randomUUID(),
      targetRevision: 2, projectGraphRevision: 7,
    }
    expect(ScopedPromptBindingSchema.parse(binding).targetRevision).toBe(2)
    expect(ScopedPromptBindingSchema.safeParse({ ...binding, compiledPrompt: '不得进入绑定契约' }).success).toBe(false)
    expect(ScopedRegenerationRequestSchema.safeParse({
      promptRevisionId: binding.promptRevisionId, targetType: 'scene', targetId: binding.targetId,
      variables: { topic: '雨夜车站' }, idempotencyKey: 'regenerate-scene-0001', unexpected: true,
    }).success).toBe(false)
  })

  it('场景 patch 必须绑定基线 revision，应用前要求明确确认', () => {
    const sceneId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    expect(SceneRevisionPatchSchema.parse({
      sceneId, baseRevision: 2, changes: {},
      shotPatches: [{ shotId, baseRevision: 3, changes: { dialogue: '我会准时赴约。' } }],
    })).toMatchObject({ baseRevision: 2, shotPatches: [{ shotId, baseRevision: 3 }] })
    expect(SceneRevisionPatchSchema.parse({ sceneId, baseRevision: 2, changes: { synopsis: '雨夜站台上，主角发现信件。' } }).shotPatches).toEqual([])
    expect(SceneRevisionPatchSchema.safeParse({ sceneId, baseRevision: 2, changes: {} }).success).toBe(false)
    expect(SceneRevisionPatchSchema.safeParse({
      sceneId, baseRevision: 2, changes: {},
      shotPatches: [
        { shotId, baseRevision: 3, changes: { dialogue: '第一稿' } },
        { shotId, baseRevision: 3, changes: { dialogue: '重复目标' } },
      ],
    }).success).toBe(false)
    expect(ScenePatchApplyRequestSchema.safeParse({
      expectedProjectRevision: 4, expectedSceneRevision: 2, idempotencyKey: 'apply-scene-patch-0001', confirmation: 'confirm',
    }).success).toBe(false)
  })
  it('保存不可变阶段产物及其 Prompt 和依赖证据', () => {
    const now = new Date().toISOString()
    const artifact = ArtifactVersionSchema.parse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), workflow: { id: 'workflow.one_click_short_video', version: '1.0.0' },
      stageId: 'brief', artifactType: 'CreativeBrief', revision: 1, promptRunId: crypto.randomUUID(),
      scope: { type: 'project', id: crypto.randomUUID() }, dependencies: [], content: { goal: '演示目标' },
      contentHash: 'a'.repeat(64), status: 'draft', createdAt: now, updatedAt: now,
    })
    expect(artifact.stageId).toBe('brief')
    expect(artifact.content).toEqual({ goal: '演示目标' })
  })

  it('事件边拒绝自连接', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(StoryEventEdgeSchema.safeParse({ id: crypto.randomUUID(), projectId: id, sourceEventId: id, targetEventId: id, type: 'causes', createdAt: new Date().toISOString() }).success).toBe(false)
  })

  it('画布命令必须携带乐观锁与幂等键', () => {
    expect(GraphCommandSchema.safeParse({ type: 'move_nodes', expectedRevision: 1, idempotencyKey: 'short', positions: {} }).success).toBe(false)
  })

  it('主任务明确区分未知结果和人工关注，重试必须显式确认', () => {
    const now = new Date().toISOString()
    const task = GenerationTaskSchema.parse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), type: 'video', status: 'outcome_unknown',
      stage: '等待 Provider 对账', idempotencyKey: 'provider-submit-idempotency-0001', provider: 'demo-local', model: 'demo-video-v1',
      attempt: 1, inputSnapshot: { promptHash: 'a'.repeat(64) }, retryable: false,
      needsAttentionReason: 'Provider 已可能接受任务，禁止盲目重提。', createdAt: now, updatedAt: now,
    })
    expect(task.status).toBe('outcome_unknown')
    expect(GenerationTaskSchema.parse({ ...task, status: 'needs_attention' }).status).toBe('needs_attention')
    expect(TaskRetryRequestSchema.safeParse({ idempotencyKey: 'retry-idempotency-key-0001', confirmation: 'yes' }).success).toBe(false)
    expect(TaskRetryRequestSchema.parse({ idempotencyKey: 'retry-idempotency-key-0001', confirmation: 'RETRY_FAILED_TASK' })).toBeTruthy()
    const diagnostic = TaskDiagnosticSchema.parse({
      taskId: task.id, projectId: task.projectId, status: task.status, outcomeCertainty: 'unknown',
      reconcileRequired: true, retryAllowed: false, cancelSemantics: 'unsupported', correlationId: crypto.randomUUID(),
      providerReferenceHash: 'b'.repeat(64), suggestedActions: ['reconcile', 'inspect'], elapsedMs: 25, updatedAt: now,
    })
    expect(diagnostic).not.toHaveProperty('inputSnapshot')
    expect(diagnostic).not.toHaveProperty('providerTaskId')
  })

  it('任务准入不伪造价格，并明确付费 Provider 默认关闭', () => {
    const projectId = crypto.randomUUID()
    const policy = ProjectGenerationPolicySchema.parse({
      projectId, revision: 0, billingMode: 'demo-only', paidProviders: 'blocked',
      maxConcurrentTasks: 4, maxCandidatesPerBatch: 4, maxExportDurationMs: 120_000,
      dailyPaidBudgetMicros: 0, updatedAt: new Date().toISOString(),
    })
    expect(ProjectGenerationPolicyUpdateRequestSchema.safeParse({
      expectedRevision: 0, maxConcurrentTasks: 2, maxCandidatesPerBatch: 2,
      maxExportDurationMs: 60_000, confirmation: 'yes',
    }).success).toBe(false)
    const admission = TaskAdmissionSchema.parse({
      projectId, allowed: false, activeTasks: 4, maxConcurrentTasks: 4,
      maxCandidatesPerBatch: 4, maxExportDurationMs: 120_000, policyRevision: policy.revision,
      paidProviders: 'blocked', providerNetworkDisabled: true, reasons: ['concurrency_limit', 'provider_network_disabled'],
      dailyPaidBudgetMicros: 0, dailyPaidSpentMicros: 0, remainingPaidBudgetMicros: 0,
      checkedAt: new Date().toISOString(),
    })
    expect(admission.paidProviders).toBe('blocked')
    expect(admission.dailyPaidBudgetMicros).toBe(0)
    expect(admission).not.toHaveProperty('estimatedPrice')
  })

  it('Deno 运行时状态不暴露本机可执行路径且安装必须精确确认', () => {
    const status = DenoRuntimeStatusSchema.parse({
      version: '2.9.2', platform: 'darwin', arch: 'arm64', supported: true,
      state: 'not-installed', assetName: 'deno-aarch64-apple-darwin.zip', downloadBytes: 37_981_362,
      archiveSha256: 'a'.repeat(64), networkDisabled: true, installAllowed: false,
    })
    expect(status).not.toHaveProperty('executablePath')
    expect(DenoRuntimeInstallRequestSchema.safeParse({ confirmation: 'yes' }).success).toBe(false)
    expect(DenoRuntimeInstallRequestSchema.parse({ confirmation: 'INSTALL_DENO_2.9.2' })).toBeTruthy()
    expect(DenoRuntimeCancelRequestSchema.safeParse({ confirmation: 'cancel' }).success).toBe(false)
    expect(DenoRuntimeCancelRequestSchema.parse({ confirmation: 'CANCEL_DENO_2.9.2_INSTALL' })).toBeTruthy()
    expect(DenoRuntimeStatusSchema.parse({
      ...status, state: 'installing',
      progress: { phase: 'downloading', receivedBytes: 18_990_681, totalBytes: 37_981_362 },
    }).progress?.receivedBytes).toBe(18_990_681)
    expect(DenoRuntimeStatusSchema.safeParse({
      ...status, state: 'installing',
      progress: { phase: 'downloading', receivedBytes: 37_981_363, totalBytes: 37_981_362 },
    }).success).toBe(false)
  })

  it('Provider plugin 记录绑定签名 manifest、相对路径与持久状态证据', () => {
    const now = new Date().toISOString()
    const manifest = ProviderPluginManifestSchema.parse({
      id: 'demo.safe-provider', version: '1.0.0', apiVersion: 1, displayName: 'Safe demo', publisherKeyId: 'publisher.demo',
      bundleSha256: 'a'.repeat(64), signature: `${'A'.repeat(86)}==`, channels: ['model-api'],
      runtime: { name: 'deno', version: '2.9.2' },
    })
    expect(ProviderPluginRecordSchema.parse({
      id: crypto.randomUUID(), pluginId: manifest.id, version: manifest.version, manifest, state: 'installed',
      bundleLocator: `provider-plugins/${manifest.id}/${manifest.version}/${manifest.bundleSha256}.ts`, bundleSize: 128,
      revision: 1, installedAt: now, updatedAt: now,
    }).state).toBe('installed')
    expect(ProviderPluginRecordSchema.safeParse({
      id: crypto.randomUUID(), pluginId: manifest.id, version: manifest.version, manifest, state: 'enabled',
      bundleLocator: `/tmp/${manifest.bundleSha256}.ts`, bundleSize: 128, revision: 1, installedAt: now, updatedAt: now,
    }).success).toBe(false)
    expect(ProviderPluginRecordSchema.safeParse({
      id: crypto.randomUUID(), pluginId: manifest.id, version: manifest.version, manifest, state: 'installed',
      bundleLocator: `provider-plugins/${manifest.id}/${manifest.version}/${'b'.repeat(64)}.ts`, bundleSize: 128,
      revision: 1, installedAt: now, updatedAt: now,
    }).success).toBe(false)
    expect(ProviderPluginInstallRequestSchema.safeParse({ manifest, bundleBase64: 'not base64!' }).success).toBe(false)
    expect(ProviderPluginTestRequestSchema.safeParse({ expectedRevision: 1, confirmation: 'test' }).success).toBe(false)
    expect(ProviderPluginEnableRequestSchema.safeParse({ expectedRevision: 1, confirmation: 'enable' }).success).toBe(false)
  })

  it('Provider 发布者信任只暴露公钥指纹且要求精确确认', () => {
    const now = new Date().toISOString()
    const trust = ProviderPublisherTrustSchema.parse({
      id: crypto.randomUUID(), keyId: 'publisher.clean-room', displayName: '原创演示发布者',
      publicKeyFingerprint: 'd'.repeat(64), state: 'trusted', revision: 1, createdAt: now, updatedAt: now,
    })
    expect(trust).not.toHaveProperty('publicKeyPem')
    const pem = `-----BEGIN PUBLIC KEY-----\n${'A'.repeat(80)}\n-----END PUBLIC KEY-----`
    expect(ProviderPublisherTrustRequestSchema.safeParse({
      keyId: trust.keyId, displayName: trust.displayName, publicKeyPem: pem, confirmation: 'trust',
    }).success).toBe(false)
    expect(ProviderPublisherTrustRequestSchema.parse({
      keyId: trust.keyId, displayName: trust.displayName, publicKeyPem: pem, confirmation: 'TRUST_PROVIDER_PLUGIN_PUBLISHER',
    })).toBeTruthy()
    expect(ProviderPublisherRevokeRequestSchema.safeParse({ expectedRevision: 1, confirmation: 'revoke' }).success).toBe(false)
  })

  it('持久任务区分取消、孤儿与对账状态', () => {
    const parsed = GenerationTaskSchema.safeParse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), type: 'export', status: 'orphaned', stage: 'reconcile',
      idempotencyKey: '0123456789abcdef', provider: 'remote', model: 'video', attempt: 1, inputSnapshot: {}, retryable: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    expect(parsed.success).toBe(true)
  })

  it('项目包 manifest 拒绝路径穿越', () => {
    const base = {
      format: 'aigc-director-project', formatVersion: 1, appVersion: '2.0.0', schemaVersion: 2,
      sourceProjectId: crypto.randomUUID(), projectName: 'portable demo', createdAt: new Date().toISOString(),
      excluded: ['credentials', 'provider-secrets', 'logs', 'absolute-paths'],
    } as const
    expect(ProjectPackageManifestSchema.parse({
      ...base, files: [{ path: 'project.json', kind: 'project', size: 2, sha256: 'a'.repeat(64) }],
    }).files).toHaveLength(1)
    expect(ProjectPackageManifestSchema.safeParse({
      ...base, files: [{ path: '../project.json', kind: 'project', size: 2, sha256: 'a'.repeat(64) }],
    }).success).toBe(false)
    expect(ProjectPackageManifestSchema.parse({
      format: 'aigc-director-project', formatVersion: 2, appVersion: '2.0.0', schemaVersion: 3,
      bundleKind: 'series', sourceSeriesId: crypto.randomUUID(), bundleName: '连续剧', createdAt: new Date().toISOString(),
      files: [{ path: 'series.json', kind: 'series', size: 2, sha256: 'b'.repeat(64) }],
      excluded: ['credentials', 'provider-secrets', 'logs', 'absolute-paths'],
    }).formatVersion).toBe(2)
  })

  it('文本导入预览只暴露受限、可确认的隔离证据', () => {
    const preview = SourceImportPreviewSchema.parse({
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), originalFileName: 'story.md',
      format: 'markdown', encoding: 'utf-8', byteSize: 36, characterCount: 18,
      contentHash: 'b'.repeat(64), suggestedTitle: '第一章 起点', previewText: '# 第一章 起点\n灯亮了。',
      previewTruncated: false, chapterTitles: ['第一章 起点'], warnings: [], expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(preview.format).toBe('markdown')
    expect(SourceImportPreviewSchema.safeParse({ ...preview, originalFileName: '../story.md' }).success).toBe(false)
    expect(SourceImportPreviewSchema.safeParse({ ...preview, originalFileName: 'story\n.md' }).success).toBe(false)
    expect(SourceImportPreviewSchema.safeParse({ ...preview, previewText: 'x'.repeat(20_001) }).success).toBe(false)
  })

  it('镜头 Beat 必须连续覆盖总时长且边界角色唯一', () => {
    const now = new Date().toISOString()
    const base = {
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), sceneId: crypto.randomUUID(), title: '连续动作',
      description: '角色推门后抬头', durationMs: 3_000, ordinal: 0, revision: 1, createdAt: now, updatedAt: now,
      beats: [
        { id: crypto.randomUUID(), ordinal: 0, startMs: 0, durationMs: 1_500, action: '推门', camera: '中景跟随' },
        { id: crypto.randomUUID(), ordinal: 1, startMs: 1_500, durationMs: 1_500, action: '抬头', camera: '缓慢推进' },
      ],
    }
    expect(ShotSchema.parse(base).beats).toHaveLength(2)
    expect(ShotSchema.safeParse({ ...base, beats: [{ ...base.beats[0], durationMs: 1_400 }, base.beats[1]] }).success).toBe(false)
    const frame = {
      id: crypto.randomUUID(), role: 'start', mediaId: crypto.randomUUID(), mediaSha256: 'c'.repeat(64),
      sourceShotId: base.id, sourceRevision: 1, provenance: 'generated_candidate', createdAt: now,
    }
    expect(ShotSchema.safeParse({ ...base, boundaryFrames: [frame, { ...frame, id: crypto.randomUUID() }] }).success).toBe(false)
  })

  it('Series 共享资产强制作用域边界并保存稳定 lineage', () => {
    const now = new Date().toISOString()
    const seriesId = crypto.randomUUID()
    const shared = SharedAssetSchema.parse({
      id: crypto.randomUUID(), logicalId: crypto.randomUUID(), scope: 'series', seriesId,
      type: 'character', name: '主角', revision: 1, createdAt: now, updatedAt: now,
    })
    expect(shared.seriesId).toBe(seriesId)
    expect(SharedAssetSchema.safeParse({ ...shared, scope: 'global', seriesId }).success).toBe(false)
    expect(SharedAssetSchema.safeParse({ ...shared, scope: 'series', seriesId: undefined }).success).toBe(false)
  })

  it('镜头绑定固定资产 revision，resolver 和 reconcile 证据可跨进程校验', () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const assetId = crypto.randomUUID()
    const variantId = crypto.randomUUID()
    const binding = AssetBindingSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, slot: 'character', assetKind: 'shared', assetId, variantId,
      assetRevision: 3, originScope: 'series', originScopeId: crypto.randomUUID(), createdAt: now, updatedAt: now,
    })
    expect(binding.drifted).toBe(false)
    expect(ResolvedAssetSchema.parse({
      logicalId: crypto.randomUUID(), source: 'series', sourceId: binding.originScopeId, assetKind: 'shared',
      assetId, variantId, revision: 3, type: 'character', name: '主角', drifted: false,
    }).revision).toBe(3)
    expect(ReconcilePreviewSchema.safeParse({
      operationId: crypto.randomUUID(), episodeId: crypto.randomUUID(), expectedProjectRevision: 2,
      decisions: [{ bindingId: binding.id, action: 'rebind', targetAssetId: assetId, targetVariantId: variantId }],
      changed: [binding.id], skipped: [], conflicts: [], approvalToken: 'short', expiresAt: now,
    }).success).toBe(false)
  })

  it('Prompt、Artifact head 与 Skill 版本只接受不可变可追溯契约', () => {
    const now = new Date().toISOString()
    const prompt = PromptRevisionSchema.parse({
      id: crypto.randomUUID(), stableKey: 'script.scene-writer', revision: 1, title: '场景编剧', role: 'execution',
      languageDrafts: { original: '写一个场景', zhReview: '写一个场景', enExecution: 'Write one scene' },
      variablesSchema: { type: 'object' }, outputSchema: { type: 'object' }, status: 'draft',
      source: 'original-clean-room', contentHash: 'd'.repeat(64), createdAt: now, updatedAt: now,
    })
    expect(prompt.feedback).toBe('')
    expect(PromptPolishRequestSchema.parse({
      expectedRevision: 1,
      feedback: '强化场景的空间关系',
      direction: 'cinematic',
      idempotencyKey: 'prompt-polish-contract-0001',
    }).direction).toBe('cinematic')
    expect(PromptPolishRequestSchema.safeParse({
      expectedRevision: 1,
      feedback: '强化场景',
      idempotencyKey: 'prompt-polish-contract-0001',
      providerPayload: { apiKey: 'forbidden' },
    }).success).toBe(false)
    expect(ArtifactHeadSchema.parse({
      scope: { type: 'project', id: crypto.randomUUID() }, artifactType: 'SceneScript',
      currentVersionId: crypto.randomUUID(), expectedRevision: 2, updatedAt: now,
    }).expectedRevision).toBe(2)
    expect(SkillPackageVersionSchema.safeParse({
      id: crypto.randomUUID(), stableKey: 'skill.scene', version: '1.0.0',
      manifest: { id: crypto.randomUUID(), name: '场景 Skill', version: '1.0.0', description: '', entry: 'SKILL.md', resources: ['../escape'], sha256: 'e'.repeat(64) },
      markdown: '# 场景', resources: [], trustLevel: 'project', status: 'draft', source: 'user-fork',
      contentHash: 'f'.repeat(64), createdAt: now, updatedAt: now,
    }).success).toBe(false)
  })

  it('模型目录、候选批次和媒体 receipt 不携带 Provider 密钥或定位明文', () => {
    const now = new Date().toISOString()
    const projectId = crypto.randomUUID()
    const shotId = crypto.randomUUID()
    const batch = CandidateBatchSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, kind: 'image', modelId: 'demo-frame-v1',
      idempotencyKey: `batch-${crypto.randomUUID()}`, quantity: 2, maxConcurrent: 1,
      status: 'running', completedCount: 0, failedCount: 0, parametersSnapshot: { variantCount: 2 },
      source: 'demo-production', createdAt: now, updatedAt: now,
    })
    const candidate = CandidateSchema.parse({
      id: crypto.randomUUID(), projectId, shotId, kind: 'image', taskId: crypto.randomUUID(), batchId: batch.id,
      provider: 'demo-local', model: 'demo-frame-v1', inputSnapshot: {}, status: 'ready', createdAt: now,
    })
    const model = ModelDescriptorSchema.parse({
      id: 'demo-frame-v1', providerId: 'demo-local', displayName: 'Demo 候选', modality: 'image',
      features: ['image-generation'], inputModes: ['local-fixture'],
      limits: { maxMediaReferences: 8, maxBytesPerReference: 20_000_000, acceptedMimePrefixes: ['image/'] },
      surfaces: ['demo'], status: 'enabled', availability: 'ready', catalogVersion: '1.0.0', contentHash: 'a'.repeat(64),
    })
    const receipt = ProviderMediaReceiptSchema.parse({
      id: crypto.randomUUID(), projectId, taskId: candidate.taskId, candidateId: candidate.id,
      modelId: model.id, mediaId: crypto.randomUUID(), role: 'reference', order: 0,
      sourceSha256: 'b'.repeat(64), transmission: 'local-fixture', redactedLocatorHash: 'c'.repeat(64), createdAt: now,
    })
    expect(batch.quantity).toBe(2)
    expect(candidate.parametersSnapshot).toEqual({})
    expect(receipt).not.toHaveProperty('locator')
    expect(JSON.stringify({ model, receipt })).not.toMatch(/api[_-]?key|authorization|signedUrl/iu)
  })

  it('候选失败批次重试必须使用精确确认和幂等键', () => {
    expect(CandidateBatchRetryRequestSchema.parse({
      idempotencyKey: 'retry-failed-candidates-001', confirmation: 'RETRY_FAILED_CANDIDATES',
    }).confirmation).toBe('RETRY_FAILED_CANDIDATES')
    expect(CandidateBatchRetryRequestSchema.safeParse({
      idempotencyKey: 'too-short', confirmation: 'RETRY_FAILED_CANDIDATES',
    }).success).toBe(false)
  })

  it('分层记忆保存来源 revision、stale 状态和可解释召回', () => {
    const now = new Date().toISOString()
    const record = MemoryRecordSchema.parse({
      id: crypto.randomUUID(), scope: 'episode', scopeId: crypto.randomUUID(), originProjectId: crypto.randomUUID(),
      sourceType: 'story_event', sourceKey: `event:${crypto.randomUUID()}`, sourceRevision: 2,
      title: '灯塔来信', summary: '主角在灯塔发现未署名来信。', content: '主角进入废弃灯塔，并把未署名来信保存为锁定事实。',
      keywords: ['灯塔', '来信', '主角'], contentHash: 'd'.repeat(64), createdAt: now, updatedAt: now,
    })
    const result = MemorySearchResultSchema.parse({ record, score: 23, matchedKeywords: ['灯塔'], reasons: ['Episode 作用域优先', '关键词命中：灯塔'] })
    expect(result.record.stale).toBe(false)
    expect(result.record.disabled).toBe(false)
    expect(result.reasons).toContain('Episode 作用域优先')
  })

  it('出口 Broker 契约不允许插件携带凭据并且默认关闭', () => {
    const request = EgressRequestDescriptorSchema.parse({
      id: crypto.randomUUID(), channel: 'model-api', url: 'https://api.example.test/v1/tasks', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() }, bodyText: '{"prompt":"demo"}',
    })
    expect(request.headers).not.toHaveProperty('authorization')
    expect(EgressRequestDescriptorSchema.safeParse({ ...request, headers: { authorization: 'Bearer forbidden' } }).success).toBe(false)
    const status = EgressBrokerStatusSchema.parse({
      enabled: false, networkDisabled: true,
      policies: [{ id: 'model-api.default', channel: 'model-api', enabled: false, allowedHosts: [], allowedMethods: ['POST'], timeoutMs: 10_000, maxRequestBytes: 1_000_000, maxResponseBytes: 5_000_000, maxRedirects: 0, credentialConfigured: false }],
    })
    expect(status.enabled).toBe(false)
  })

  it('自定义 Provider manifest 锁定 Deno 版本、bundle hash 和签名身份', () => {
    const manifest = ProviderPluginManifestSchema.parse({
      id: 'provider.clean-room-demo', version: '1.0.0', apiVersion: 1, displayName: '原创 Provider 演示',
      publisherKeyId: 'publisher.demo', bundleSha256: 'a'.repeat(64), signature: 'c2lnbmF0dXJl',
      channels: ['model-api'], runtime: { name: 'deno', version: '2.9.2' },
    })
    expect(manifest.runtime.version).toBe('2.9.2')
    expect(ProviderPluginManifestSchema.safeParse({ ...manifest, runtime: { name: 'deno', version: 'latest' } }).success).toBe(false)
  })
})
