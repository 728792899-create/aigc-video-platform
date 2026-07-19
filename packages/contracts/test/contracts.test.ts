import { describe, expect, it } from 'vitest'
import {
  AgentRunCheckpointSchema,
  ArtifactDiffSchema,
  ArtifactVersionSchema,
  ArtifactHeadSchema,
  AssetBindingSchema,
  CandidateBatchSchema,
  CandidateSchema,
  GenerationTaskSchema,
  EgressBrokerStatusSchema,
  DenoRuntimeInstallRequestSchema,
  DenoRuntimeCancelRequestSchema,
  DenoRuntimeStatusSchema,
  EgressRequestDescriptorSchema,
  GraphCommandSchema,
  ProjectPackageManifestSchema,
  ReconcilePreviewSchema,
  PromptRevisionSchema,
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
  ModelDescriptorSchema,
  MemoryRecordSchema,
  MemorySearchResultSchema,
  SkillPackageVersionSchema,
  ResolvedAssetSchema,
  SharedAssetSchema,
  ShotSchema,
  SourceImportPreviewSchema,
  StoryEventEdgeSchema,
} from '../src/index.js'

describe('2.0 跨进程契约', () => {
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
