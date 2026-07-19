import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CandidateSchema, type AgentRunCheckpoint, type ExecutionPlan, type GenerationTask, type GraphProjection, type Project, type ProjectPackageImportReport, type ProjectSnapshot, type ProviderPluginRecord, type ProviderPublisherTrust, type SourceImportPreview } from '@aigc-director/contracts'
import { createDemoPackProvider } from '@aigc-director/agents'
import { DenoRuntimeInstallError, providerPluginSignaturePayload, resolveDenoRuntimeArtifact } from '@aigc-director/providers'
import { createDirectorApp } from '../src/http/app.js'
import { inject, jsonBody, multipartFile, type InjectResponse } from './http-inject.js'

const token = 'server-test-session-token-with-enough-entropy'
const auth = { authorization: `Bearer ${token}` }
type TestRuntime = ReturnType<typeof createDirectorApp>

async function api<T = unknown>(
  runtime: TestRuntime,
  method: string,
  path: string,
  body?: unknown,
  authorized = true,
): Promise<InjectResponse<T>> {
  const payload: { body?: string; headers: Record<string, string> } = body === undefined
    ? { headers: {} }
    : jsonBody(body)
  return await inject<T>(runtime.app, {
    method,
    path,
    headers: { ...(authorized ? auth : {}), ...(payload.headers ?? {}) },
    ...(payload.body === undefined ? {} : { body: payload.body }),
  })
}

function stopRuntime(runtime: TestRuntime): void {
  runtime.io.disconnectSockets(true)
  runtime.io.removeAllListeners()
  runtime.httpServer.removeAllListeners()
  runtime.db.close()
}

function signedPluginRequest() {
  const bundle = Buffer.from('export const plugin = { apiVersion: 1 }\n', 'utf8')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const unsigned = {
    id: 'provider.api-test', version: '1.0.0', apiVersion: 1 as const, displayName: 'API test provider',
    publisherKeyId: 'publisher.api-test', bundleSha256: createHash('sha256').update(bundle).digest('hex'),
    channels: ['model-api' as const], runtime: { name: 'deno' as const, version: '2.9.2' as const },
  }
  return {
    request: {
      manifest: { ...unsigned, signature: sign(null, providerPluginSignaturePayload(unsigned), privateKey).toString('base64') },
      bundleBase64: bundle.toString('base64'),
    },
    trusted: { 'publisher.api-test': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
  }
}

describe('AIGC 导演工作室 API v2', () => {
  let runtime: ReturnType<typeof createDirectorApp>
  let directory: string
  let taskEvents: GenerationTask[]
  let unhandledErrors: unknown[]

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aigc-director-server-'))
    taskEvents = []
    unhandledErrors = []
    runtime = createDirectorApp({
      databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: token,
      onTaskEvent: ({ task }) => taskEvents.push(task),
      onUnhandledError: (error) => unhandledErrors.push(error),
    })
  })

  afterEach(() => stopRuntime(runtime))

  it('旧接口返回 404，新接口要求本地会话', async () => {
    const health = await api(runtime, 'GET', '/api/v2/health', undefined, false)
    expect(health.status).toBe(200)
    expect(health.headers['content-security-policy']).toContain("default-src 'none'")
    expect(runtime.io.of('/studio-v2').name).toBe('/studio-v2')
    expect((await api(runtime, 'GET', '/api/v2/projects', undefined, false)).status).toBe(401)
    expect((await api(runtime, 'GET', '/api/projects', undefined, false)).status).toBe(404)
  })

  it('Deno 运行时默认只读且网络关闭时拒绝安装', async () => {
    const status = await api<{ data: Record<string, unknown> }>(runtime, 'GET', '/api/v2/provider-plugins/runtime')
    expect(status.status).toBe(200)
    expect(status.body.data).toMatchObject({ version: '2.9.2', state: 'not-installed', networkDisabled: true, installAllowed: false })
    expect(JSON.stringify(status.body.data)).not.toContain(directory)
    expect((await api(runtime, 'POST', '/api/v2/provider-plugins/runtime/install', { confirmation: 'yes' })).status).toBe(400)
    const blocked = await api<{ error: { code: string } }>(runtime, 'POST', '/api/v2/provider-plugins/runtime/install', { confirmation: 'INSTALL_DENO_2.9.2' })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('PROVIDER_NETWORK_DISABLED')
  })

  it('Deno 安装 API 只有精确确认后才调用注入式安装器', async () => {
    const artifact = resolveDenoRuntimeArtifact(process.platform, process.arch)
    let installed = false
    let installCalls = 0
    const installedAt = new Date().toISOString()
    const receipt = {
      version: artifact.version, platform: artifact.platform, arch: artifact.arch, assetName: artifact.assetName,
      archiveSha256: artifact.sha256, binarySha256: 'b'.repeat(64), executablePath: join(directory, 'private-deno'), installedAt, reused: false,
    }
    const isolated = createDirectorApp({
      databasePath: join(directory, 'runtime-api.sqlite'), dataDirectory: join(directory, 'runtime-api'), sessionToken: token,
      providerNetworkDisabled: false,
      denoRuntimeInstaller: {
        inspect: async () => installed
          ? { state: 'ready' as const, artifact, receipt: { ...receipt, reused: true } }
          : { state: 'not-installed' as const, artifact },
        install: async () => { installCalls += 1; installed = true; return receipt },
      },
    })
    try {
      const response = await api<{ data: Record<string, unknown> }>(isolated, 'POST', '/api/v2/provider-plugins/runtime/install', { confirmation: 'INSTALL_DENO_2.9.2' })
      expect(response.status).toBe(200)
      expect(response.body.data).toMatchObject({ state: 'ready', networkDisabled: false, installAllowed: false, binarySha256: 'b'.repeat(64) })
      expect(JSON.stringify(response.body.data)).not.toContain('private-deno')
      expect(installCalls).toBe(1)
    } finally { stopRuntime(isolated) }
  })

  it('Deno 安装可在进行中精确取消，且重复取消不伪造成功', async () => {
    const artifact = resolveDenoRuntimeArtifact(process.platform, process.arch)
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const isolated = createDirectorApp({
      databasePath: join(directory, 'runtime-cancel-api.sqlite'), dataDirectory: join(directory, 'runtime-cancel-api'), sessionToken: token,
      providerNetworkDisabled: false,
      denoRuntimeInstaller: {
        inspect: async () => ({ state: 'not-installed' as const, artifact }),
        install: async (_platform, _arch, signal, onProgress) => await new Promise((_, reject) => {
          onProgress?.({ phase: 'downloading', receivedBytes: 128, totalBytes: artifact.size })
          markStarted?.()
          const abort = (): void => reject(new DenoRuntimeInstallError('DENO_RUNTIME_ABORTED'))
          if (signal?.aborted) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        }),
      },
    })
    try {
      const installing = api<{ error: { code: string } }>(isolated, 'POST', '/api/v2/provider-plugins/runtime/install', { confirmation: 'INSTALL_DENO_2.9.2' })
      await started

      const progress = await api<{ data: { state: string; progress: { phase: string; receivedBytes: number; totalBytes: number } } }>(isolated, 'GET', '/api/v2/provider-plugins/runtime')
      expect(progress.body.data).toMatchObject({
        state: 'installing', progress: { phase: 'downloading', receivedBytes: 128, totalBytes: artifact.size },
      })

      expect((await api(isolated, 'POST', '/api/v2/provider-plugins/runtime/install/cancel', { confirmation: 'cancel' })).status).toBe(400)
      const cancelled = await api<{ data: { status: string; runtime: { state: string } } }>(isolated, 'POST', '/api/v2/provider-plugins/runtime/install/cancel', {
        confirmation: 'CANCEL_DENO_2.9.2_INSTALL',
      })
      expect(cancelled.status).toBe(200)
      expect(cancelled.body.data).toEqual(expect.objectContaining({ status: 'cancelled', runtime: expect.objectContaining({ state: 'not-installed' }) }))

      const interrupted = await installing
      expect(interrupted.status).toBe(409)
      expect(interrupted.body.error.code).toBe('DENO_RUNTIME_ABORTED')
      const repeated = await api<{ error: { code: string } }>(isolated, 'POST', '/api/v2/provider-plugins/runtime/install/cancel', {
        confirmation: 'CANCEL_DENO_2.9.2_INSTALL',
      })
      expect(repeated.status).toBe(409)
      expect(repeated.body.error.code).toBe('DENO_RUNTIME_INSTALL_NOT_RUNNING')
    } finally { stopRuntime(isolated) }
  })

  it('Provider 插件 API 只接受受信签名包与精确生命周期确认', async () => {
    const signed = signedPluginRequest()
    const untrusted = await api<{ error: { code: string } }>(runtime, 'POST', '/api/v2/provider-plugins', signed.request)
    expect(untrusted.status).toBe(403)
    expect(untrusted.body.error.code).toBe('PLUGIN_PUBLISHER_UNTRUSTED')

    const isolated = createDirectorApp({
      databasePath: join(directory, 'plugin-api.sqlite'), dataDirectory: join(directory, 'plugin-api'), sessionToken: token,
      trustedProviderPluginKeys: signed.trusted, providerPluginsEnabled: true,
      providerPluginLifecycleRunner: { test: async () => ({ healthy: true, protocol: 1 }) },
    })
    try {
      const installed = await api<{ data: ProviderPluginRecord }>(isolated, 'POST', '/api/v2/provider-plugins', signed.request)
      expect(installed.status).toBe(201)
      expect(installed.body.data).toMatchObject({ state: 'installed', revision: 1 })
      expect(JSON.stringify(installed.body.data)).not.toContain(directory)
      expect(JSON.stringify(installed.body.data)).not.toContain(signed.request.bundleBase64)
      expect((await api(isolated, 'POST', `/api/v2/provider-plugins/${installed.body.data.id}/test`, {
        expectedRevision: 1, confirmation: 'test',
      })).status).toBe(400)
      const tested = await api<{ data: { plugin: ProviderPluginRecord } }>(isolated, 'POST', `/api/v2/provider-plugins/${installed.body.data.id}/test`, {
        expectedRevision: 1, confirmation: 'TEST_SIGNED_PROVIDER_PLUGIN',
      })
      expect(tested.body.data.plugin).toMatchObject({ state: 'tested', revision: 2 })
      const enabled = await api<{ data: ProviderPluginRecord }>(isolated, 'POST', `/api/v2/provider-plugins/${installed.body.data.id}/enable`, {
        expectedRevision: 2, confirmation: 'ENABLE_SIGNED_PROVIDER_PLUGIN',
      })
      expect(enabled.body.data).toMatchObject({ state: 'enabled', revision: 3 })
      const listed = await api<{ data: ProviderPluginRecord[] }>(isolated, 'GET', '/api/v2/provider-plugins')
      expect(listed.body.data).toHaveLength(1)
      expect(listed.body.data[0]).toMatchObject({ id: installed.body.data.id, state: 'enabled' })
    } finally { stopRuntime(isolated) }
  })

  it('Provider 发布者 API 不返回公钥正文，撤销后新安装 fail closed', async () => {
    const signed = signedPluginRequest()
    const isolated = createDirectorApp({
      databasePath: join(directory, 'publisher-api.sqlite'), dataDirectory: join(directory, 'publisher-api'), sessionToken: token,
      providerPluginLifecycleRunner: { test: async () => ({ healthy: true }) },
    })
    try {
      const publicKeyPem = signed.trusted['publisher.api-test']
      if (!publicKeyPem) throw new Error('fixture publisher missing')
      expect((await api(isolated, 'POST', '/api/v2/provider-plugin-publishers', {
        keyId: 'publisher.api-test', displayName: 'API 测试发布者', publicKeyPem, confirmation: 'trust',
      })).status).toBe(400)
      const trusted = await api<{ data: ProviderPublisherTrust }>(isolated, 'POST', '/api/v2/provider-plugin-publishers', {
        keyId: 'publisher.api-test', displayName: 'API 测试发布者', publicKeyPem,
        confirmation: 'TRUST_PROVIDER_PLUGIN_PUBLISHER',
      })
      expect(trusted.status).toBe(201)
      expect(trusted.body.data).toMatchObject({ state: 'trusted', revision: 1 })
      expect(JSON.stringify(trusted.body.data)).not.toContain('BEGIN PUBLIC KEY')
      expect((await api(isolated, 'POST', '/api/v2/provider-plugins', signed.request)).status).toBe(201)

      const revoked = await api<{ data: ProviderPublisherTrust }>(isolated, 'POST', `/api/v2/provider-plugin-publishers/${trusted.body.data.id}/revoke`, {
        expectedRevision: 1, confirmation: 'REVOKE_PROVIDER_PLUGIN_PUBLISHER',
      })
      expect(revoked.body.data).toMatchObject({ state: 'revoked', revision: 2 })
      const listed = await api<{ data: ProviderPublisherTrust[] }>(isolated, 'GET', '/api/v2/provider-plugin-publishers')
      expect(listed.body.data).toEqual([expect.objectContaining({ id: trusted.body.data.id, state: 'revoked' })])
      expect(JSON.stringify(listed.body.data)).not.toContain('BEGIN PUBLIC KEY')
      const rejected = await api<{ error: { code: string } }>(isolated, 'POST', '/api/v2/provider-plugins', signed.request)
      expect(rejected.status).toBe(403)
      expect(rejected.body.error.code).toBe('PLUGIN_PUBLISHER_UNTRUSTED')
    } finally { stopRuntime(isolated) }
  })

  it('随机桌面端口只在监听成功后加入精确 CORS 白名单', async () => {
    const origin = 'http://127.0.0.1:43127'
    runtime.allowOrigin(origin)
    const accepted = await inject(runtime.app, { method: 'GET', path: '/api/v2/health', headers: { origin } })
    expect(accepted.status).toBe(200)
    expect(accepted.headers['access-control-allow-origin']).toBe(origin)

    const rejected = await inject(runtime.app, { method: 'GET', path: '/api/v2/health', headers: { origin: 'http://127.0.0.1:43128' } })
    expect(rejected.status).toBe(500)
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('完成原著→事件图谱→审批→候选→MP4 的零付费闭环', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: 'Demo 试播集' })
    expect(created.status).toBe(201)
    const project = created.body.data

    const imported = await api<{ data: ProjectSnapshot }>(runtime, 'POST', `/api/v2/projects/${project.id}/sources`, {
      title: '旧剧院',
      content: '第一章 门后\n阿澈走进停用的剧院。舞台灯突然亮起。她听见有人说，别回头。',
    })
    expect(imported.status, JSON.stringify({ body: imported.body, errors: unhandledErrors.map((error) => String(error)) })).toBe(201)
    expect(imported.body.data.events.length).toBeGreaterThan(1)

    const graph = await api<{ data: GraphProjection }>(runtime, 'GET', `/api/v2/projects/${project.id}/graph?view=story`)
    expect(graph.body.data.nodes.some((node) => node.type === 'event')).toBe(true)

    const planned = await api<{ data: { plan: ExecutionPlan; approvalToken: string; checkpoint: AgentRunCheckpoint } }>(runtime, 'POST', `/api/v2/projects/${project.id}/agent-plans`, { idempotencyKey: `plan-${project.id}` })
    const planning = planned.body.data
    expect(planning.plan.status).toBe('awaiting_approval')
    expect(planning.plan.memoryCitationCount).toBeGreaterThan(0)
    expect(planning.checkpoint.memoryCitations).toHaveLength(planning.plan.memoryCitationCount)
    expect(planning.checkpoint.memoryContextHash).toBe(planning.plan.memoryContextHash)
    expect(JSON.stringify(planning.checkpoint.memoryCitations)).not.toMatch(/"(?:content|summary|title)"/u)
    const persistedCheckpoint = await api<{ data: AgentRunCheckpoint }>(runtime, 'GET', `/api/v2/agent-runs/${planning.plan.runId}/checkpoint`)
    expect(persistedCheckpoint.body.data).toEqual(planning.checkpoint)
    const repeatedPlanning = await api<{ data: { plan: ExecutionPlan; approvalToken: string; checkpoint: AgentRunCheckpoint } }>(runtime, 'POST', `/api/v2/projects/${project.id}/agent-plans`, { idempotencyKey: `plan-${project.id}` })
    expect(repeatedPlanning.body.data.plan.id).toBe(planning.plan.id)
    expect(repeatedPlanning.body.data.checkpoint).toEqual(planning.checkpoint)

    const approved = await api<{ data: ProjectSnapshot }>(runtime, 'POST', `/api/v2/plans/${planning.plan.id}/approve`, { token: repeatedPlanning.body.data.approvalToken })
    expect(approved.body.data.shots.length).toBeGreaterThan(1)

    const production = await runtime.service.runDemoProduction(project.id, `production-${project.id}`)
    expect(taskEvents.some((task) => task.projectId === project.id && task.provider === 'demo-local' && task.type === 'image')).toBe(true)
    expect(production.candidates).toHaveLength(production.shots.length * 2)
    expect(production.candidateBatches).toHaveLength(production.shots.length)
    expect(production.candidateBatches.every((batch) => batch.status === 'succeeded' && batch.completedCount === 2 && batch.failedCount === 0)).toBe(true)
    expect(production.candidates.every((candidate) => candidate.batchId && candidate.parametersSnapshot.variant)).toBe(true)
    expect(production.providerMediaReceipts.length).toBeGreaterThan(0)
    expect(JSON.stringify(production.providerMediaReceipts)).not.toMatch(/"(?:locator|authorization|api[_-]?key|signedUrl)"/iu)
    expect(production.shots.every((shot) => shot.beats.length >= 2 && shot.beats.reduce((sum, beat) => sum + beat.durationMs, 0) === shot.durationMs)).toBe(true)
    expect(production.shots.every((shot) => shot.boundaryFrames.some((frame) => frame.role === 'start') && shot.boundaryFrames.some((frame) => frame.role === 'end'))).toBe(true)
    expect(production.shots.every((shot) => shot.staleFields.length === 0)).toBe(true)
    expect(production.shots.slice(1).every((shot, index) => {
      const previousEnd = production.shots[index]?.boundaryFrames.find((frame) => frame.role === 'end')
      const currentStart = shot.boundaryFrames.find((frame) => frame.role === 'start')
      return previousEnd?.mediaId === currentStart?.mediaId && previousEnd?.mediaSha256 === currentStart?.mediaSha256
    })).toBe(true)
    expect(production.tasks.filter((task) => task.type === 'image' && Number(task.inputSnapshot.variant) === 1).slice(1)
      .every((task) => Array.isArray(task.inputSnapshot.boundaryFrames)
        && task.inputSnapshot.boundaryFrames.some((frame) => typeof frame === 'object' && frame !== null && (frame as { role?: string }).role === 'start'))).toBe(true)
    expect(production.candidates.filter((candidate) => candidate.inputSnapshot.providerMediaOrder !== undefined)
      .every((candidate) => Array.isArray(candidate.inputSnapshot.providerMediaOrder))).toBe(true)
    expect(new Set(production.assets.map((asset) => asset.type))).toEqual(new Set(['character', 'scene', 'prop', 'style', 'voice', 'music']))
    expect(production.attempts).toHaveLength(production.promptRuns.length)
    expect(production.providerReceipts).toHaveLength(production.promptRuns.length)
    const requiredPromptIds = [
      'intent.normalize', 'story.expand', 'script.structure', 'entity.extract', 'style.analyze', 'shot.plan',
      'asset.character_refine', 'asset.location_refine', 'asset.prop_refine', 'continuity.snapshot', 'frame.compose',
      'prompt.image_assemble', 'candidate.critic',
    ]
    expect(requiredPromptIds.every((promptId) => production.promptRuns.some((run) => run.prompt.id === promptId && run.prompt.version === '1.0.0'))).toBe(true)
    expect(production.promptRuns.filter((run) => run.prompt.id === 'prompt.image_assemble')).toHaveLength(production.candidates.length)
    expect(production.tasks.every((task) => task.promptRunId && task.inputSnapshot.prompt === undefined)).toBe(true)
    expect(production.tasks.every((task) => task.result?.billed === false)).toBe(true)
    expect(production.tasks.every((task) => task.status === 'succeeded' && task.retryable === false)).toBe(true)
    expect(['brief', 'outline', 'script', 'entities', 'style', 'shots', 'characters', 'locations', 'props', 'continuity', 'frames']
      .every((stageId) => production.artifactVersions.some((artifact) => artifact.stageId === stageId && artifact.status === 'approved'))).toBe(true)
    expect(production.shots.every((shot) => production.artifactVersions.some((artifact) => artifact.stageId === `image-candidates:${shot.id}`))).toBe(true)
    expect(production.shots.every((shot) => production.artifactVersions.some((artifact) => artifact.stageId === `image-review:${shot.id}` && artifact.status === 'draft'))).toBe(true)
    expect(production.reviews.filter((review) => review.source === 'automatic_critic' && review.decision === 'pending')).toHaveLength(production.candidates.length)

    const catalog = await api<{ data: { models: Array<{ id: string; availability: string; contentHash: string }> } }>(runtime, 'GET', '/api/v2/models/catalog')
    expect(catalog.body.data.models.some((model) => model.id === 'demo-frame-v1' && model.availability === 'ready' && model.contentHash.length === 64)).toBe(true)
    const egressStatus = await api<{ data: { enabled: boolean; networkDisabled: boolean; policies: Array<{ channel: string; enabled: boolean; allowedHosts: string[]; credentialConfigured: boolean }> } }>(runtime, 'GET', '/api/v2/systems/egress/status')
    expect(egressStatus.body.data).toMatchObject({ enabled: false, networkDisabled: true })
    expect(egressStatus.body.data.policies).toHaveLength(3)
    expect(egressStatus.body.data.policies.every((policy) => !policy.enabled && policy.allowedHosts.length === 0 && !policy.credentialConfigured)).toBe(true)
    const mediaResolution = await api<{ data: { supported: boolean; receipts: Array<Record<string, unknown>> } }>(runtime, 'POST', '/api/v2/media/resolve/preview', {
      projectId: project.id, modelId: 'demo-frame-v1', inputs: [{ mediaId: production.media[0]?.id, role: 'reference', order: 0 }],
    })
    expect(mediaResolution.status).toBe(200)
    expect(mediaResolution.body.data.supported).toBe(true)
    expect(mediaResolution.body.data.receipts).toHaveLength(1)
    expect(JSON.stringify(mediaResolution.body.data)).not.toMatch(/\.svg|"(?:locator|authorization|signedUrl)"/iu)
    expect((await api(runtime, 'POST', '/api/v2/media/resolve/preview', {
      projectId: project.id, modelId: 'unknown-model', inputs: [],
    })).status).toBe(404)

    const annotatedCandidate = production.candidates[0]
    if (!annotatedCandidate) throw new Error('TEST_CANDIDATE_MISSING')
    const annotated = await api<{ data: ProjectSnapshot['candidates'][number] }>(runtime, 'PATCH', `/api/v2/candidates/${annotatedCandidate.id}`, {
      favorite: true, label: '主候选', tags: ['构图稳定', '构图稳定', '待调色'],
    })
    expect(annotated.body.data).toMatchObject({ favorite: true, label: '主候选', tags: ['构图稳定', '待调色'] })
    expect(runtime.db.get<ProjectSnapshot['shots'][number]>('shots', annotatedCandidate.shotId)?.selectedCandidateId).toBeUndefined()

    const preview = production.media[0]
    if (!preview) throw new Error('TEST_PREVIEW_MEDIA_MISSING')
    const previewResponse = await api(runtime, 'GET', `/api/v2/media/${project.id}/${preview.locator}`)
    expect(previewResponse.status).toBe(200)
    expect(previewResponse.headers['content-type']).toContain(preview.mime)

    const prompts = await api<{ data: unknown[] }>(runtime, 'GET', `/api/v2/projects/${project.id}/prompts`)
    const skills = await api<{ data: unknown[] }>(runtime, 'GET', `/api/v2/projects/${project.id}/skills`)
    expect(prompts.body.data).toHaveLength(26)
    expect(skills.body.data).toHaveLength(31)

    let graphRevision = production.project.graphRevision
    const firstShot = production.shots[0]!
    const beatUpdate = await api<{ data: { revision: number } }>(runtime, 'POST', `/api/v2/projects/${project.id}/graph/commands?view=production`, {
      type: 'update_shot_beats', expectedRevision: graphRevision, idempotencyKey: `beats-${firstShot.id}`,
      shotId: firstShot.id, beats: firstShot.beats,
    })
    expect(beatUpdate.status).toBe(200)
    graphRevision = beatUpdate.body.data.revision
    const secondShot = production.shots[1]
    if (secondShot) {
      const cleared = await api<{ data: { revision: number } }>(runtime, 'POST', `/api/v2/projects/${project.id}/graph/commands?view=production`, {
        type: 'clear_boundary_frame', expectedRevision: graphRevision, idempotencyKey: `clear-start-${secondShot.id}`,
        shotId: secondShot.id, role: 'start',
      })
      expect(cleared.status).toBe(200)
      graphRevision = cleared.body.data.revision
      const relinked = await api<{ data: { revision: number } }>(runtime, 'POST', `/api/v2/projects/${project.id}/graph/commands?view=production`, {
        type: 'link_previous_boundary', expectedRevision: graphRevision, idempotencyKey: `relink-start-${secondShot.id}`,
        shotId: secondShot.id,
      })
      expect(relinked.status).toBe(200)
      graphRevision = relinked.body.data.revision
      const relinkedSnapshot = runtime.db.snapshot(project.id)
      expect(relinkedSnapshot.shots[1]?.boundaryFrames.find((frame) => frame.role === 'start')).toMatchObject({
        sourceShotId: relinkedSnapshot.shots[0]?.id, provenance: 'linked_previous_end',
      })
    }
    for (const shot of production.shots) {
      const selected = production.candidates.find((candidate) => candidate.shotId === shot.id)
      if (!selected) throw new Error('TEST_CANDIDATE_MISSING')
      const selection = await api<{ data: { revision: number } }>(runtime, 'POST', `/api/v2/projects/${project.id}/graph/commands?view=production`, {
        type: 'select_candidate', expectedRevision: graphRevision,
        idempotencyKey: `select-${shot.id}-${selected.id}`, shotId: shot.id, candidateId: selected.id,
      })
      graphRevision = selection.body.data.revision
    }
    const reviewed = await api<{ data: ProjectSnapshot }>(runtime, 'GET', `/api/v2/projects/${project.id}`)
    expect(reviewed.body.data.shots.every((shot) => shot.selectedCandidateId)).toBe(true)
    expect(reviewed.body.data.reviews.filter((review) => review.source === 'human' && review.decision === 'approved')).toHaveLength(production.shots.length)
    expect(reviewed.body.data.shots.every((shot) => reviewed.body.data.artifactVersions.some((artifact) => artifact.stageId === `approved-candidate:${shot.id}` && artifact.status === 'approved'))).toBe(true)

    const memoryRebuild = await api<{ data: { created: number; skippedSensitive: number } }>(runtime, 'POST', '/api/v2/memory/rebuild', { projectId: project.id })
    expect(memoryRebuild.body.data.created).toBeGreaterThan(0)
    expect(memoryRebuild.body.data.skippedSensitive).toBe(0)
    const memorySearch = await api<{ data: Array<{ record: { id: string; scope: string; disabled: boolean }; reasons: string[] }> }>(runtime, 'GET', `/api/v2/memory/search?projectId=${project.id}&q=${encodeURIComponent('剧院')}`)
    expect(memorySearch.body.data[0]).toMatchObject({ record: { scope: 'episode', disabled: false } })
    expect(memorySearch.body.data[0]?.reasons.length).toBeGreaterThan(0)
    const firstMemory = memorySearch.body.data[0]?.record
    if (!firstMemory) throw new Error('TEST_MEMORY_MISSING')
    expect((await api(runtime, 'PATCH', `/api/v2/memory/${firstMemory.id}`, { disabled: true })).status).toBe(200)
    const afterDisable = await api<{ data: Array<{ record: { id: string } }> }>(runtime, 'GET', `/api/v2/memory/search?projectId=${project.id}&q=${encodeURIComponent('剧院')}`)
    expect(afterDisable.body.data.some((result) => result.record.id === firstMemory.id)).toBe(false)
    expect((await api<{ data: { mode: string; onnx: { status: string } } }>(runtime, 'GET', '/api/v2/memory/model-status')).body.data)
      .toMatchObject({ mode: 'keyword', onnx: { status: 'not-requested' } })

    const exportRequest = {
      projectId: project.id, outputDirectory: join(directory, 'exports'), fileName: 'demo.mp4', width: 320, height: 320, fps: 12,
    }
    const exported = await api<{ data: GenerationTask }>(runtime, 'POST', '/api/v2/exports', exportRequest)
    expect(exported.status).toBe(202)
    const task = exported.body.data
    const completed = await runtime.service.waitForTask(task.id)
    expect(completed.status).toBe('succeeded')
    expect(completed.result).toMatchObject({ fileName: 'demo.mp4' })
    expect(JSON.stringify(completed.result)).not.toContain(directory)

    const repeated = await api<{ data: GenerationTask }>(runtime, 'POST', '/api/v2/exports', exportRequest)
    expect(repeated.body.data.id).toBe(task.id)

    const alternate = await api<{ data: GenerationTask }>(runtime, 'POST', '/api/v2/exports', { ...exportRequest, outputDirectory: join(directory, 'alternate') })
    const alternateTask = alternate.body.data
    expect(alternateTask.id).not.toBe(task.id)
    expect((await runtime.service.waitForTask(alternateTask.id)).status).toBe('succeeded')

    const sourceVideoTask = runtime.service.startExport({
      projectId: project.id, outputDirectory: join(directory, 'media', project.id), fileName: 'tail-source.mp4', width: 320, height: 320, fps: 12,
    })
    const sourceVideo = await runtime.service.waitForTask(sourceVideoTask.id)
    const sourceVideoMediaId = typeof sourceVideo.result?.mediaId === 'string' ? sourceVideo.result.mediaId : undefined
    if (!sourceVideoMediaId) throw new Error('TEST_VIDEO_MEDIA_MISSING')
    const videoCandidate = CandidateSchema.parse({
      id: crypto.randomUUID(), projectId: project.id, shotId: firstShot.id, kind: 'video', taskId: sourceVideo.id,
      mediaId: sourceVideoMediaId, provider: 'demo-local', model: 'local-ffmpeg', inputSnapshot: { demo: true },
      status: 'ready', createdAt: new Date().toISOString(),
    })
    runtime.db.put('candidates', project.id, videoCandidate)
    const boundaryKey = `boundary-${crypto.randomUUID()}`
    const extraction = await api<{ data: GenerationTask }>(runtime, 'POST', `/api/v2/shots/${firstShot.id}/boundary/extract`, {
      projectId: project.id, candidateId: videoCandidate.id, idempotencyKey: boundaryKey,
    })
    expect(extraction.status).toBe(202)
    const extracted = await runtime.service.waitForTask(extraction.body.data.id)
    expect(extracted.status).toBe('succeeded')
    expect(extracted.result).toMatchObject({ sourceCandidateId: videoCandidate.id })
    const extractedSnapshot = runtime.db.snapshot(project.id)
    const extractedEnd = extractedSnapshot.shots[0]?.boundaryFrames.find((frame) => frame.role === 'end')
    expect(extractedEnd).toMatchObject({ sourceCandidateId: videoCandidate.id, provenance: 'extracted_video' })
    const extractedMedia = extractedSnapshot.media.find((media) => media.id === extractedEnd?.mediaId)
    expect(extractedMedia).toMatchObject({ mime: 'image/png', kind: 'image' })
    const extractedPreview = await api(runtime, 'GET', `/api/v2/media/${project.id}/${extractedMedia?.locator}`)
    expect(extractedPreview.status).toBe(200)
    expect(extractedPreview.headers['content-type']).toContain('image/png')
    const repeatedExtraction = await api<{ data: GenerationTask }>(runtime, 'POST', `/api/v2/shots/${firstShot.id}/boundary/extract`, {
      projectId: project.id, candidateId: videoCandidate.id, idempotencyKey: boundaryKey,
    })
    expect(repeatedExtraction.body.data.id).toBe(extraction.body.data.id)

    const missingMediaId = crypto.randomUUID()
    runtime.db.put('media_references', project.id, {
      id: missingMediaId, projectId: project.id, kind: 'video', storage: 'managed-file', locator: 'missing.mp4',
      mime: 'video/mp4', size: 1, sha256: 'f'.repeat(64), createdAt: new Date().toISOString(),
    })
    const brokenCandidate = CandidateSchema.parse({
      id: crypto.randomUUID(), projectId: project.id, shotId: firstShot.id, kind: 'video', taskId: sourceVideo.id,
      mediaId: missingMediaId, provider: 'demo-local', model: 'local-ffmpeg', inputSnapshot: { demo: true },
      status: 'ready', createdAt: new Date().toISOString(),
    })
    runtime.db.put('candidates', project.id, brokenCandidate)
    const failedExtraction = await api<{ data: GenerationTask }>(runtime, 'POST', `/api/v2/shots/${firstShot.id}/boundary/extract`, {
      projectId: project.id, candidateId: brokenCandidate.id, idempotencyKey: `boundary-failed-${crypto.randomUUID()}`,
    })
    expect((await runtime.service.waitForTask(failedExtraction.body.data.id)).status).toBe('failed')
    expect(runtime.db.snapshot(project.id).shots[0]?.boundaryFrames.find((frame) => frame.role === 'end')?.id).toBe(extractedEnd?.id)
  }, 60_000)

  it('拒绝 MIME 欺骗与非法画布并发版本', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '安全测试' })
    const project = created.body.data
    const multipart = multipartFile('file', { name: 'fake.png', mime: 'image/png', data: Buffer.from('MZ-not-an-image') })
    const upload = await inject(runtime.app, {
      method: 'POST', path: `/api/v2/projects/${project.id}/media`,
      headers: { ...auth, ...multipart.headers }, body: multipart.body,
    })
    expect(upload.status).toBe(500)
    expect(JSON.stringify(upload.body)).not.toContain('MZ-not-an-image')

    const command = await api(runtime, 'POST', `/api/v2/projects/${project.id}/graph/commands?view=story`, {
      type: 'move_nodes', expectedRevision: 99, idempotencyKey: `move-${project.id}`, positions: {},
    })
    expect(command.status).toBe(409)
    expect(command.body).toMatchObject({ ok: false, error: { code: 'GRAPH_REVISION_CONFLICT' } })
  }, 60_000)

  it('通过受保护 API 导出并导入自包含项目包', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: 'API 便携项目' })
    const project = created.body.data
    await api(runtime, 'POST', `/api/v2/projects/${project.id}/sources`, { title: '便携章节', content: '第一章 离线\n剪辑师收好素材，准备换一台电脑继续创作。' })

    const exported = await inject(runtime.app, { method: 'GET', path: `/api/v2/projects/${project.id}/package`, headers: auth })
    expect(exported.status).toBe(200)
    expect(exported.headers['content-type']).toContain('application/vnd.aigc-director.project+zip')
    expect(exported.buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    const multipart = multipartFile('file', { name: 'portable.aigcproj', mime: 'application/zip', data: exported.buffer })
    const imported = await inject<{ data: ProjectPackageImportReport }>(runtime.app, {
      method: 'POST', path: '/api/v2/project-packages/import', headers: { ...auth, ...multipart.headers }, body: multipart.body,
    })
    expect(imported.status, JSON.stringify({ body: imported.body, errors: unhandledErrors.map((error) => String(error)) })).toBe(201)
    expect(imported.body.data.project.id).not.toBe(project.id)
    expect(runtime.db.snapshot(imported.body.data.project.id).events.length).toBeGreaterThan(0)
  })

  it('TXT/Markdown 文件先隔离预览，确认后才事务写入领域数据', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '文件导入' })
    const project = created.body.data
    const markdown = Buffer.from('# 第一章 起点\n灯光突然亮起。\n\n## 第二章 回声\n导演举起相机。镜头里出现一个人。', 'utf8')
    const upload = multipartFile('file', { name: 'story.md', mime: 'text/markdown', data: markdown })
    const previewed = await inject<{ data: SourceImportPreview }>(runtime.app, {
      method: 'POST', path: `/api/v2/projects/${project.id}/source-imports/preview`,
      headers: { ...auth, ...upload.headers }, body: upload.body,
    })
    expect(previewed.status, JSON.stringify(previewed.body)).toBe(201)
    expect(previewed.body.data).toMatchObject({ format: 'markdown', encoding: 'utf-8', previewTruncated: false })
    expect(previewed.body.data.chapterTitles).toEqual(['第一章 起点', '第二章 回声'])
    expect(runtime.db.snapshot(project.id).sources).toHaveLength(0)

    const committed = await api<{ data: ProjectSnapshot }>(runtime, 'POST', `/api/v2/projects/${project.id}/source-imports/${previewed.body.data.id}/commit`, {
      title: '导入的故事', language: 'zh-CN', expectedContentHash: previewed.body.data.contentHash,
    })
    expect(committed.status, JSON.stringify(committed.body)).toBe(201)
    expect(committed.body.data.sources).toHaveLength(1)
    expect(committed.body.data.chapters.map((chapter) => chapter.title)).toEqual(['第一章 起点', '第二章 回声'])
    expect(committed.body.data.events.length).toBeGreaterThanOrEqual(3)

    const repeated = await api<{ data: ProjectSnapshot }>(runtime, 'POST', `/api/v2/projects/${project.id}/source-imports/${previewed.body.data.id}/commit`, {
      title: '导入的故事', language: 'zh-CN', expectedContentHash: previewed.body.data.contentHash,
    })
    expect(repeated.status).toBe(200)
    expect(repeated.body.data.sources).toHaveLength(1)
  })

  it('文本导入拒绝二进制伪装，取消后不能提交', async () => {
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '隔离边界' })
    const project = created.body.data
    const binaryUpload = multipartFile('file', { name: 'story.txt', mime: 'text/plain', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) })
    const rejected = await inject(runtime.app, {
      method: 'POST', path: `/api/v2/projects/${project.id}/source-imports/preview`,
      headers: { ...auth, ...binaryUpload.headers }, body: binaryUpload.body,
    })
    expect(rejected.status).toBe(422)
    expect(rejected.body).toMatchObject({ ok: false, error: { code: 'SOURCE_IMPORT_BINARY_REJECTED' } })

    const textUpload = multipartFile('file', { name: 'cancel.txt', mime: 'application/octet-stream', data: Buffer.from('第一章 取消\n这份内容不会写入项目。', 'utf8') })
    const previewed = await inject<{ data: SourceImportPreview }>(runtime.app, {
      method: 'POST', path: `/api/v2/projects/${project.id}/source-imports/preview`,
      headers: { ...auth, ...textUpload.headers }, body: textUpload.body,
    })
    expect(previewed.status).toBe(201)
    const cancelled = await api(runtime, 'DELETE', `/api/v2/projects/${project.id}/source-imports/${previewed.body.data.id}`)
    expect(cancelled.status).toBe(200)
    const committed = await api(runtime, 'POST', `/api/v2/projects/${project.id}/source-imports/${previewed.body.data.id}/commit`, {
      title: '不应写入', expectedContentHash: previewed.body.data.contentHash,
    })
    expect(committed.status).toBe(404)
    expect(runtime.db.snapshot(project.id).sources).toHaveLength(0)
  })

  it('Provider 已接收但 submit 超时时先 reconcile 且不重复提交', async () => {
    stopRuntime(runtime)
    let submits = 0
    let reconciles = 0
    runtime = createDirectorApp({
      databasePath: join(directory, 'reconcile.sqlite'), dataDirectory: directory, sessionToken: token,
      packProviderFactory: () => {
        const provider = createDemoPackProvider({ submit: 'timeout-after-accept', reconcile: 'succeeded' })
        const submit = provider.submit.bind(provider)
        const reconcile = provider.reconcile.bind(provider)
        provider.submit = async (...args) => { submits += 1; return submit(...args) }
        provider.reconcile = async (...args) => { reconciles += 1; return reconcile(...args) }
        return provider
      },
      onTaskEvent: ({ task }) => taskEvents.push(task),
    })
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '对账恢复' })
    const project = created.body.data
    await api(runtime, 'POST', `/api/v2/projects/${project.id}/sources`, { title: '单场', content: '第一章 夜路\n林舟抵达路口。远处的灯忽然熄灭。' })
    const planned = await api<{ data: { plan: ExecutionPlan; approvalToken: string } }>(runtime, 'POST', `/api/v2/projects/${project.id}/agent-plans`, { idempotencyKey: `reconcile-plan-${project.id}` })
    const planning = planned.body.data
    await api(runtime, 'POST', `/api/v2/plans/${planning.plan.id}/approve`, { token: planning.approvalToken })

    const snapshot = await runtime.service.runDemoProduction(project.id, `reconcile-production-${project.id}`)
    expect(submits).toBe(snapshot.promptRuns.length)
    expect(reconciles).toBe(snapshot.promptRuns.length)
    expect(snapshot.providerReceipts).toHaveLength(0)
    expect(snapshot.attempts.every((attempt) => attempt.status === 'succeeded' && attempt.diagnosticHash)).toBe(true)
    expect(snapshot.tasks.every((task) => task.status === 'succeeded' && task.providerTaskId === undefined && task.result?.reconciled === true)).toBe(true)
  }, 120_000)

  it('服务重启后使用持久 receipt 恢复 Demo 媒体任务', async () => {
    const databasePath = join(directory, 'restart-recovery.sqlite')
    stopRuntime(runtime)
    runtime = createDirectorApp({ databasePath, dataDirectory: directory, sessionToken: token, onTaskEvent: ({ task }) => taskEvents.push(task) })
    const created = await api<{ data: Project }>(runtime, 'POST', '/api/v2/projects', { name: '重启恢复' })
    const project = created.body.data
    await api(runtime, 'POST', `/api/v2/projects/${project.id}/sources`, { title: '恢复场景', content: '第一章 机房\n指示灯闪烁。工程师推开机房门。备用电源开始工作。' })
    const planned = await api<{ data: { plan: ExecutionPlan; approvalToken: string } }>(runtime, 'POST', `/api/v2/projects/${project.id}/agent-plans`, { idempotencyKey: `restart-plan-${project.id}` })
    const planning = planned.body.data
    await api(runtime, 'POST', `/api/v2/plans/${planning.plan.id}/approve`, { token: planning.approvalToken })
    const produced = await runtime.service.runDemoProduction(project.id, `restart-production-${project.id}`)
    const candidate = produced.candidates[0]
    const target = candidate ? produced.tasks.find((item) => item.id === candidate.taskId) : undefined
    if (!target || !candidate?.mediaId) throw new Error('RESTART_FIXTURE_MISSING')
    runtime.db.remove('candidates', candidate.id)
    runtime.db.remove('media_references', candidate.mediaId)
    const { result: _result, finishedAt: _finishedAt, progress: _progress, ...interrupted } = target
    runtime.db.put('generation_tasks', project.id, { ...interrupted, status: 'running', retryable: true, updatedAt: new Date().toISOString() })
    stopRuntime(runtime)

    runtime = createDirectorApp({ databasePath, dataDirectory: directory, sessionToken: token, onTaskEvent: ({ task }) => taskEvents.push(task) })
    expect(await runtime.service.recoverTasks()).toEqual({ resumed: 1, orphaned: 0 })
    const restored = runtime.db.snapshot(project.id)
    expect(restored.candidates.some((item) => item.taskId === target.id)).toBe(true)
    expect(restored.tasks.find((item) => item.id === target.id)).toMatchObject({ status: 'succeeded', result: { recoveredAfterRestart: true, billed: false } })
  }, 60_000)
})
