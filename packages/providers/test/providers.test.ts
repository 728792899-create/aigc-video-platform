import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { ZipFile } from 'yazl'
import { describe, expect, it, vi } from 'vitest'
import type { EgressRequestDescriptor } from '@aigc-director/contracts'
import {
  denoPluginCommand,
  DenoRuntimeInstallError,
  DenoRuntimeInstaller,
  DeclarativeHttpProvider,
  EgressBroker,
  EgressBrokerError,
  FakeProvider,
  OpenAiCompatibleProvider,
  isPublicNetworkAddress,
  isSafeBrokerUrl,
  parseProviderPluginRpcLine,
  parseProviderPluginRpcMessageLine,
  ProviderPluginProcessError,
  ProviderPluginProcessSupervisor,
  ProviderExecutionError,
  ProviderRouter,
  providerPluginSignaturePayload,
  resolveDenoRuntimeArtifact,
  verifyProviderPluginBundle,
  type EgressRuntimePolicy,
  type EgressTransportResponse,
  type PluginChildProcess,
  type ProviderAdapter,
} from '../src/index.js'

async function runtimeZip(entries: ReadonlyArray<{ name: string; body: string }>): Promise<Buffer> {
  const archive = new ZipFile()
  for (const entry of entries) archive.addBuffer(Buffer.from(entry.body), entry.name, { mode: 0o100755 })
  archive.end()
  const chunks: Buffer[] = []
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

class FakePluginChild extends EventEmitter implements PluginChildProcess {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly pid = 4321
  readonly kill = vi.fn((_signal?: NodeJS.Signals | number): boolean => true)
}

const brokerPolicy: EgressRuntimePolicy = {
  id: 'model-api.test', channel: 'model-api', enabled: true,
  allowedHosts: ['api.example.com', 'cdn.example.com'], allowedMethods: ['POST'],
  timeoutMs: 5_000, maxRequestBytes: 2_000_000, maxResponseBytes: 64,
  maxRedirects: 1, allowedResponseMimePrefixes: ['application/json'],
  credential: { reference: 'provider.test', header: 'authorization', prefix: 'Bearer ' },
}

function transportResponse(status: number, headers: Record<string, string>, chunks: string[]): EgressTransportResponse {
  return {
    status, headers,
    body: (async function* () { for (const chunk of chunks) yield Buffer.from(chunk) })(),
    abort: vi.fn(),
  }
}

const brokerRequest = (): EgressRequestDescriptor => ({
  id: crypto.randomUUID(), channel: 'model-api', url: 'https://api.example.com/v1/tasks', method: 'POST',
  headers: { 'content-type': 'application/json' }, bodyText: '{"prompt":"demo"}',
})

describe('Provider 安全契约', () => {
  it('OpenAI-compatible 只通过 Broker 注入凭据并解析文本响应', async () => {
    const transport = vi.fn(async (request: { headers: Record<string, string>; body?: Uint8Array }) => {
      expect(request.headers.authorization).toBe('Bearer provider-secret')
      expect(JSON.parse(Buffer.from(request.body ?? []).toString('utf8'))).toMatchObject({ model: 'text-model' })
      return transportResponse(200, { 'content-type': 'application/json' }, [JSON.stringify({ choices: [{ message: { content: '结构化结果' } }], usage: { total_tokens: 12 } })])
    })
    const broker = new EgressBroker({
      policies: [{ ...brokerPolicy, maxResponseBytes: 1024 }], testNetworkEnabled: true, resolveHost: async () => ['8.8.8.8'],
      resolveSecret: async () => 'provider-secret', transport,
    })
    const adapter = new OpenAiCompatibleProvider({ id: 'relay.test', endpointOrigin: 'https://api.example.com/', broker })
    const result = await adapter.execute({ model: 'text-model', prompt: '生成结果', modality: 'text' }, {
      projectId: crypto.randomUUID(), taskId: crypto.randomUUID(), outputDirectory: '/tmp', signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ provider: 'relay.test', text: '结构化结果', metadata: { billed: 'provider-account', protocol: 'openai-compatible', usage: { total_tokens: 12 } } })
    expect(JSON.stringify(result)).not.toContain('provider-secret')
  })

  it('OpenAI-compatible 验证 Base64 媒体类型并以幂等文件落盘', async () => {
    const output = await mkdtemp(join(tmpdir(), 'director-openai-compatible-'))
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('offline-test')])
    const broker = new EgressBroker({
      policies: [brokerPolicy], testNetworkEnabled: true, resolveHost: async () => ['8.8.8.8'], resolveSecret: async () => 'provider-secret',
      transport: async () => transportResponse(200, { 'content-type': 'application/json' }, [JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })]),
    })
    const adapter = new OpenAiCompatibleProvider({ id: 'relay.image', endpointOrigin: 'https://api.example.com/', broker })
    const context = { projectId: crypto.randomUUID(), taskId: crypto.randomUUID(), outputDirectory: output, signal: new AbortController().signal }
    const result = await adapter.execute({ model: 'image-model', prompt: '原创画面', modality: 'image' }, context)
    expect(result.media).toMatchObject({ mime: 'image/png', locator: `${context.taskId}.png`, size: png.length })
    expect(await readFile(join(output, result.media?.locator ?? ''))).toEqual(png)
  })

  it('外部协议将限流、异常格式和提交结果未知映射为稳定语义', async () => {
    const createAdapter = (response: EgressTransportResponse) => new OpenAiCompatibleProvider({
      id: 'relay.errors', endpointOrigin: 'https://api.example.com/', broker: new EgressBroker({
        policies: [brokerPolicy], testNetworkEnabled: true, resolveHost: async () => ['8.8.8.8'], resolveSecret: async () => 'provider-secret', transport: async () => response,
      }),
    })
    const context = { projectId: crypto.randomUUID(), taskId: crypto.randomUUID(), outputDirectory: '/tmp', signal: new AbortController().signal }
    await expect(createAdapter(transportResponse(429, { 'content-type': 'application/json' }, ['{}'])).execute({ model: 'm', prompt: 'p', modality: 'text' }, context))
      .rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED', retryable: true, outcomeKnown: true })
    await expect(createAdapter(transportResponse(200, { 'content-type': 'application/json' }, ['{"choices":[]}'])).execute({ model: 'm', prompt: 'p', modality: 'text' }, context))
      .rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID', retryable: false, outcomeKnown: true })
    await expect(createAdapter(transportResponse(503, { 'content-type': 'application/json' }, ['{}'])).execute({ model: 'm', prompt: 'p', modality: 'text' }, context))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN', retryable: false, outcomeKnown: false })
  })

  it('声明式 HTTP 只提交固定 JSON，异步任务携带远端 ID 并强制先对账', async () => {
    const responses = [
      transportResponse(202, { 'content-type': 'application/json' }, ['{"job":"remote-123","state":"queued"}']),
      transportResponse(200, { 'content-type': 'application/json' }, ['{"state":"done","output":"ready"}']),
      transportResponse(202, { 'content-type': 'application/json' }, ['{}']),
    ]
    const transport = vi.fn(async () => responses.shift()!)
    const policy: EgressRuntimePolicy = { ...brokerPolicy, allowedMethods: ['GET', 'POST'], maxResponseBytes: 1024 }
    const adapter = new DeclarativeHttpProvider({
      id: 'relay.declarative', endpointOrigin: 'https://api.example.com/',
      broker: new EgressBroker({ policies: [policy], testNetworkEnabled: true, resolveHost: async () => ['8.8.8.8'], resolveSecret: async () => 'provider-secret', transport }),
      manifest: {
        version: 1,
        submit: { method: 'POST', path: '/jobs', response: { jobId: 'job', status: 'state' } },
        poll: { method: 'GET', pathTemplate: '/jobs/{jobId}', response: { status: 'state', outputUrl: 'output' } },
        cancel: { method: 'POST', pathTemplate: '/jobs/{jobId}/cancel' },
        terminalStates: { succeeded: ['done'], failed: ['failed'] },
      },
    })
    const context = { projectId: crypto.randomUUID(), taskId: crypto.randomUUID(), outputDirectory: '/tmp', signal: new AbortController().signal }
    await expect(adapter.execute({ model: 'remote-image', prompt: '受限声明式任务', modality: 'image' }, context))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN', outcomeKnown: false, providerTaskId: 'remote-123' })
    const reconciled = await adapter.reconcile?.('remote-123', context)
    expect(reconciled).toMatchObject({ status: 'succeeded', result: { providerTaskId: 'remote-123' } })
    await expect(adapter.cancel?.('remote-123', context)).resolves.toEqual({ status: 'requested' })
    expect(JSON.stringify(reconciled)).not.toContain('provider-secret')
  })

  it('路由只在结果已知且可重试时降级，未知结果必须先对账', async () => {
    const calls: string[] = []
    const retryable = {
      id: 'retryable', models: [],
      execute: async () => { calls.push('retryable'); throw new ProviderExecutionError('PROVIDER_RATE_LIMITED', true, true) },
    }
    const fallback = {
      id: 'fallback', models: [],
      execute: async (input: { model: string }) => { calls.push('fallback'); return { provider: 'fallback', model: input.model, text: 'ok', metadata: { billed: false } } },
    }
    const fallbackConnectionId = crypto.randomUUID()
    const route = {
      modality: 'text' as const, primaryConnectionId: crypto.randomUUID(), fallbackConnectionIds: [fallbackConnectionId],
      fallbackConnectionModels: { [fallbackConnectionId]: 'fallback-text-v2' }, model: 'text-v1', maxAttempts: 2, timeoutMs: 20_000,
    }
    const adapters = new Map<string, ProviderAdapter>([[route.primaryConnectionId, retryable], [route.fallbackConnectionIds[0]!, fallback]])
    const routed = new ProviderRouter((id) => adapters.get(id))
    const result = await routed.execute(route, { prompt: 'demo', modality: 'text' }, {
      projectId: crypto.randomUUID(), taskId: crypto.randomUUID(), outputDirectory: '/tmp', signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ provider: 'fallback', model: 'fallback-text-v2', metadata: { fallbackCount: 1 } })
    expect(calls).toEqual(['retryable', 'fallback'])

    calls.length = 0
    const unknown = { ...retryable, execute: async () => { calls.push('unknown'); throw new ProviderExecutionError('PROVIDER_OUTCOME_UNKNOWN', true, false) } }
    const blocked = new ProviderRouter((id) => id === route.primaryConnectionId ? unknown : fallback)
    await expect(blocked.execute(route, { prompt: 'demo', modality: 'text' }, {
      projectId: crypto.randomUUID(), taskId: crypto.randomUUID(), outputDirectory: '/tmp', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILE_REQUIRED' })
    expect(calls).toEqual(['unknown'])
  })

  it('路由超时会中止当前适配器并要求对账，不会盲目执行降级链', async () => {
    const primaryId = crypto.randomUUID()
    const fallbackId = crypto.randomUUID()
    const fallback = vi.fn(async (input: { model: string }) => ({ provider: 'fallback', model: input.model, text: 'should-not-run', metadata: {} }))
    const router = new ProviderRouter((id) => id === primaryId ? {
      id: 'slow', models: [], execute: async (_input, context) => await new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true })
      }),
    } : { id: 'fallback', models: [], execute: fallback })
    await expect(router.execute({
      modality: 'text', primaryConnectionId: primaryId, fallbackConnectionIds: [fallbackId],
      model: 'slow-v1', maxAttempts: 2, timeoutMs: 5,
    }, { prompt: 'timeout', modality: 'text' }, {
      projectId: crypto.randomUUID(), taskId: crypto.randomUUID(), outputDirectory: '/tmp', signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILE_REQUIRED', outcomeKnown: false, providerId: primaryId })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('Demo Provider 无密钥、无网络地产生可审计候选', async () => {
    const output = await mkdtemp(join(tmpdir(), 'director-provider-'))
    const result = await new FakeProvider().execute(
      { model: 'demo-frame-v1', prompt: '原创夜景镜头', modality: 'image' },
      { projectId: '11111111-1111-4111-8111-111111111111', taskId: '22222222-2222-4222-8222-222222222222', outputDirectory: output, signal: new AbortController().signal },
    )
    expect(result.metadata).toMatchObject({ demo: true, billed: false })
    expect(await readFile(join(output, result.media?.locator ?? ''), 'utf8')).toContain('Demo local candidate')
  })

  it('优先复制经过清单验证的原创 Demo 素材且保持零计费', async () => {
    const output = await mkdtemp(join(tmpdir(), 'director-provider-output-'))
    const assets = await mkdtemp(join(tmpdir(), 'director-provider-assets-'))
    const original = Buffer.from('original-demo-png')
    await writeFile(join(assets, 'candidate-01.png'), original)
    const result = await new FakeProvider(assets).execute(
      { model: 'demo-frame-v1', prompt: '使用原创视觉', modality: 'image' },
      { projectId: crypto.randomUUID(), taskId: crypto.randomUUID(), outputDirectory: output, signal: new AbortController().signal },
    )
    expect(result.media).toMatchObject({ mime: 'image/png', size: original.length })
    expect(await readFile(join(output, result.media?.locator ?? ''))).toEqual(original)
    expect(result.metadata).toMatchObject({ demo: true, billed: false, demoAsset: 'candidate-01.png' })
  })

  it('按顺序消费首尾帧快照且不支持时 fail fast', async () => {
    const output = await mkdtemp(join(tmpdir(), 'director-provider-boundary-'))
    const media = {
      id: crypto.randomUUID(), projectId: crypto.randomUUID(), kind: 'image' as const, storage: 'managed-file' as const,
      locator: 'frame.svg', mime: 'image/svg+xml', size: 12, sha256: 'e'.repeat(64), createdAt: new Date().toISOString(),
    }
    const provider = new FakeProvider()
    const accepted = await provider.execute(
      { model: 'demo-frame-v1', prompt: '保持动作连续', modality: 'image', media: [{ role: 'first-frame', order: 0, media }] },
      { projectId: media.projectId, taskId: crypto.randomUUID(), outputDirectory: output, signal: new AbortController().signal },
    )
    expect(accepted.metadata).toMatchObject({ receivedMediaOrder: [`first-frame:${media.id}:${media.sha256}`] })
    await expect(provider.execute(
      { model: 'demo-structured-v1', prompt: '不应忽略引用', modality: 'text', media: [{ role: 'first-frame', order: 0, media }] },
      { projectId: media.projectId, taskId: crypto.randomUUID(), outputDirectory: output, signal: new AbortController().signal },
    )).rejects.toThrow('PROVIDER_BOUNDARY_FRAME_UNSUPPORTED')
  })

  it('Broker 拒绝 HTTP、凭据和未授权主机', () => {
    expect(isSafeBrokerUrl('https://api.example.com/v1', ['api.example.com'])).toBe(true)
    expect(isSafeBrokerUrl('http://api.example.com/v1', ['api.example.com'])).toBe(false)
    expect(isSafeBrokerUrl('https://user:secret@api.example.com/v1', ['api.example.com'])).toBe(false)
    expect(isSafeBrokerUrl('https://127.0.0.1/v1', ['api.example.com'])).toBe(false)
    expect(isSafeBrokerUrl('https://127.0.0.1/v1', ['127.0.0.1'])).toBe(false)
  })

  it('网络地址分类拒绝 loopback、私网、metadata、文档段和 IPv6 特殊网段', () => {
    expect(isPublicNetworkAddress('8.8.8.8')).toBe(true)
    expect(isPublicNetworkAddress('2606:4700:4700::1111')).toBe(true)
    for (const denied of ['127.0.0.1', '10.0.0.4', '100.64.1.1', '169.254.169.254', '172.20.0.2', '192.168.1.2', '192.0.2.3', '198.51.100.4', '203.0.113.5', '::1', 'fc00::1', 'fe80::1', '2001:db8::1']) {
      expect(isPublicNetworkAddress(denied), denied).toBe(false)
    }
  })

  it('Broker 默认关闭，即使有策略也不执行运输', async () => {
    const transport = vi.fn()
    const broker = new EgressBroker({ policies: [brokerPolicy], testNetworkEnabled: false, transport })
    expect(broker.status()).toMatchObject({ enabled: false, networkDisabled: true, policies: [{ credentialConfigured: true }] })
    await expect(broker.execute(brokerRequest())).rejects.toMatchObject({ code: 'EGRESS_DISABLED' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('凭据只由 Broker 注入，成功响应和审计都不泄露密钥与 URL', async () => {
    const audits: unknown[] = []
    const transport = vi.fn(async (request: { headers: Record<string, string> }) => {
      expect(request.headers.authorization).toBe('Bearer unit-test-secret')
      return transportResponse(200, { 'content-type': 'application/json', 'set-cookie': 'secret=forbidden', 'x-request-id': 'remote-request' }, ['{"ok":true}'])
    })
    const broker = new EgressBroker({
      policies: [brokerPolicy], testNetworkEnabled: true, resolveHost: async () => ['8.8.8.8'],
      resolveSecret: async () => 'unit-test-secret', transport, onAudit: (record) => audits.push(record),
    })
    const result = await broker.execute(brokerRequest())
    expect(result.status).toBe(200)
    expect(result.headers).toEqual({ 'content-type': 'application/json', 'x-request-id': 'remote-request' })
    expect(JSON.stringify({ result: result.audit, audits })).not.toMatch(/unit-test-secret|api\.example\.com|\/v1\/tasks|set-cookie/iu)
  })

  it('每次重定向都重新解析 DNS，私网回绑在第二跳前被拒绝', async () => {
    const first = transportResponse(307, { location: 'https://cdn.example.com/v1/tasks' }, [])
    const transport = vi.fn(async () => first)
    const broker = new EgressBroker({
      policies: [brokerPolicy], testNetworkEnabled: true,
      resolveHost: async (hostname) => hostname === 'api.example.com' ? ['8.8.8.8'] : ['10.0.0.9'],
      resolveSecret: async () => 'secret', transport,
    })
    await expect(broker.execute(brokerRequest())).rejects.toMatchObject({ code: 'EGRESS_DNS_DENIED' })
    expect(first.abort).toHaveBeenCalledOnce()
    expect(transport).toHaveBeenCalledOnce()
  })

  it('流式响应超出上限时终止运输并返回稳定错误', async () => {
    const oversized = transportResponse(200, { 'content-type': 'application/json' }, ['x'.repeat(40), 'y'.repeat(40)])
    const broker = new EgressBroker({
      policies: [brokerPolicy], testNetworkEnabled: true, resolveHost: async () => ['8.8.8.8'], resolveSecret: async () => 'secret',
      transport: async () => oversized,
    })
    await expect(broker.execute(brokerRequest())).rejects.toEqual(new EgressBrokerError('EGRESS_RESPONSE_TOO_LARGE'))
    expect(oversized.abort).toHaveBeenCalledOnce()
  })

  it('超时覆盖响应流读取，不只覆盖建立连接', async () => {
    const broker = new EgressBroker({
      policies: [{ ...brokerPolicy, timeoutMs: 500 }], testNetworkEnabled: true,
      resolveHost: async () => ['8.8.8.8'], resolveSecret: async () => 'secret',
      transport: async (request) => ({
        status: 200, headers: { 'content-type': 'application/json' }, abort: vi.fn(),
        body: (async function* () {
          await new Promise<void>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
          yield Buffer.from('{}')
        })(),
      }),
    })
    await expect(broker.execute(brokerRequest())).rejects.toMatchObject({ code: 'EGRESS_TIMEOUT' })
  })

  it('Deno 插件默认无权限', () => {
    const command = denoPluginCommand('/runtime/deno', '/plugin/main.ts')
    const args = command.args
    expect(args.some((argument) => argument.startsWith('--allow-'))).toBe(false)
    expect(args).toContain('--no-prompt')
    expect(args).toContain('--cached-only')
    expect(args).toContain('--deny-net')
    expect(args).toContain('--deny-import')
    expect(args).toContain('--deny-run')
    expect(args).toContain('--deny-ffi')
    expect(command.env).toEqual({ DENO_NO_UPDATE_CHECK: '1', DENO_NO_PROMPT: '1', NO_COLOR: '1' })
  })

  it('插件 bundle 必须通过 hash 和受信 Ed25519 发布者签名', () => {
    const bundle = Buffer.from('console.log(JSON.stringify({jsonrpc:"2.0",id:"ready",result:{ready:true}}))')
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const unsigned = {
      id: 'provider.clean-room-demo', version: '1.0.0', apiVersion: 1 as const, displayName: '原创 Provider 演示',
      publisherKeyId: 'publisher.demo', bundleSha256: createHash('sha256').update(bundle).digest('hex'),
      channels: ['model-api' as const], runtime: { name: 'deno' as const, version: '2.9.2' as const },
    }
    const manifest = { ...unsigned, signature: sign(null, providerPluginSignaturePayload(unsigned), privateKey).toString('base64') }
    const trusted = { 'publisher.demo': publicKey.export({ type: 'spki', format: 'pem' }).toString() }
    expect(verifyProviderPluginBundle(manifest, bundle, trusted).bundleSha256).toBe(unsigned.bundleSha256)
    expect(() => verifyProviderPluginBundle(manifest, Buffer.from('tampered'), trusted)).toThrow('PLUGIN_BUNDLE_HASH_MISMATCH')
    expect(() => verifyProviderPluginBundle({ ...manifest, displayName: '被篡改' }, bundle, trusted)).toThrow('PLUGIN_SIGNATURE_INVALID')
    expect(() => verifyProviderPluginBundle(manifest, bundle, {})).toThrow('PLUGIN_PUBLISHER_UNTRUSTED')
  })

  it('插件 JSON-RPC 输出有 64 KiB 上限且必须符合受限 schema', () => {
    expect(parseProviderPluginRpcLine('{"jsonrpc":"2.0","id":"one","result":{"ready":true}}')).toMatchObject({ id: 'one', result: { ready: true } })
    expect(() => parseProviderPluginRpcLine('{not-json')).toThrow('PLUGIN_RPC_JSON_INVALID')
    expect(() => parseProviderPluginRpcLine('{"jsonrpc":"2.0","id":"one","result":{},"error":{"code":"FAILED","message":"x"}}')).toThrow('PLUGIN_RPC_SCHEMA_INVALID')
    expect(() => parseProviderPluginRpcLine('x'.repeat(64 * 1024 + 1))).toThrow('PLUGIN_RPC_MESSAGE_TOO_LARGE')
    expect(parseProviderPluginRpcMessageLine('{"jsonrpc":"2.0","id":"broker-one","method":"broker.execute","params":{"requestId":"one"}}')).toMatchObject({ method: 'broker.execute' })
    expect(() => parseProviderPluginRpcMessageLine('{"jsonrpc":"2.0","id":"one","method":"filesystem.read","params":{}}')).toThrow('PLUGIN_RPC_SCHEMA_INVALID')
  })

  it('插件监督器使用最小环境完成受限 JSON-RPC 往返', async () => {
    const child = new FakePluginChild()
    const spawnProcess = vi.fn(() => child)
    child.stdin.on('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString('utf8')) as { id: string }
      queueMicrotask(() => child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { healthy: true } })}\n`))
    })
    const supervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.clean-room-demo', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 200, spawnProcess,
    })
    expect(supervisor.start()).toBe('tested')
    await expect(supervisor.request('provider.health', {})).resolves.toEqual({ healthy: true })
    expect(spawnProcess).toHaveBeenCalledWith('/runtime/deno', expect.any(Array), expect.objectContaining({
      shell: false, windowsHide: true, env: { DENO_NO_UPDATE_CHECK: '1', DENO_NO_PROMPT: '1', NO_COLOR: '1' },
    }))
    expect(supervisor.snapshot()).toMatchObject({ state: 'tested', running: true, toolCalls: 1, pendingRequests: 0 })
    supervisor.stop()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('插件超时会终止子进程并进入隔离态', async () => {
    const child = new FakePluginChild()
    const supervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.timeout-demo', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'enabled', requestTimeoutMs: 20, spawnProcess: () => child,
    })
    supervisor.start()
    await expect(supervisor.request('provider.execute', {})).rejects.toEqual(new ProviderPluginProcessError('PLUGIN_REQUEST_TIMEOUT'))
    expect(supervisor.snapshot()).toMatchObject({ state: 'quarantined', running: false, quarantineReason: 'PLUGIN_REQUEST_TIMEOUT' })
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('插件的超大无换行输出不会无界缓冲', async () => {
    const child = new FakePluginChild()
    const supervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.oversized-demo', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 200, spawnProcess: () => child,
    })
    supervisor.start()
    const pending = supervisor.request('provider.health', {})
    child.stdout.write(Buffer.alloc(64 * 1024 + 1, 120))
    await expect(pending).rejects.toEqual(new ProviderPluginProcessError('PLUGIN_RPC_MESSAGE_TOO_LARGE'))
    expect(supervisor.snapshot().state).toBe('quarantined')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('插件协议错误、异常退出和工具调用上限都使用稳定失败语义', async () => {
    const malformed = new FakePluginChild()
    const malformedSupervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.invalid-demo', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 200, spawnProcess: () => malformed,
    })
    malformedSupervisor.start()
    const malformedPending = malformedSupervisor.request('provider.health', {})
    malformed.stdout.write('{invalid}\n')
    await expect(malformedPending).rejects.toEqual(new ProviderPluginProcessError('PLUGIN_RPC_JSON_INVALID'))

    const exited = new FakePluginChild()
    const exitedSupervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.exit-demo', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 200, spawnProcess: () => exited,
    })
    exitedSupervisor.start()
    const exitPending = exitedSupervisor.request('provider.health', {})
    exited.emit('close', 2, null)
    await expect(exitPending).rejects.toEqual(new ProviderPluginProcessError('PLUGIN_PROCESS_EXITED'))

    const limited = new FakePluginChild()
    limited.stdin.on('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString('utf8')) as { id: string }
      queueMicrotask(() => limited.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } })}\n`))
    })
    const limitedSupervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.limit-demo', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 200, maxToolCalls: 1, spawnProcess: () => limited,
    })
    limitedSupervisor.start()
    await expect(limitedSupervisor.request('provider.health', {})).resolves.toEqual({ ok: true })
    await expect(limitedSupervisor.request('provider.health', {})).rejects.toEqual(new ProviderPluginProcessError('PLUGIN_TOOL_CALL_LIMIT'))
    expect(limitedSupervisor.snapshot().state).toBe('quarantined')
  })

  it('插件只能通过受限 broker.execute 请求宿主网络', async () => {
    const child = new FakePluginChild()
    const stdinLines: string[] = []
    child.stdin.on('data', (chunk: Buffer) => stdinLines.push(chunk.toString('utf8')))
    const handleHostRequest = vi.fn(async (_method: 'broker.execute', params: Record<string, unknown>) => ({ accepted: params.requestId === 'request-one' }))
    const supervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.broker-demo', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 200, spawnProcess: () => child, handleHostRequest,
    })
    supervisor.start()
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'plugin-request-one', method: 'broker.execute', params: { requestId: 'request-one' } })}\n`)
    await vi.waitFor(() => expect(stdinLines.length).toBe(1))
    expect(handleHostRequest).toHaveBeenCalledWith('broker.execute', { requestId: 'request-one' }, expect.any(AbortSignal))
    expect(JSON.parse(stdinLines[0] ?? '{}')).toEqual({ jsonrpc: '2.0', id: 'plugin-request-one', result: { accepted: true } })
    expect(supervisor.snapshot()).toMatchObject({ hostRequests: 1, pendingHostRequests: 0, state: 'tested' })
    supervisor.stop()
  })

  it('宿主 Broker 拒绝只返回稳定错误，未授权方法会隔离插件', async () => {
    const rejected = new FakePluginChild()
    const rejectedLines: string[] = []
    rejected.stdin.on('data', (chunk: Buffer) => rejectedLines.push(chunk.toString('utf8')))
    const rejectedSupervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.broker-rejected', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 200, spawnProcess: () => rejected,
      handleHostRequest: async () => { throw new Error('credential=must-not-leak') },
    })
    rejectedSupervisor.start()
    rejected.stdout.write('{"jsonrpc":"2.0","id":"plugin-rejected","method":"broker.execute","params":{}}\n')
    await vi.waitFor(() => expect(rejectedLines.length).toBe(1))
    expect(rejectedLines[0]).toContain('BROKER_REQUEST_REJECTED')
    expect(rejectedLines[0]).not.toContain('credential=must-not-leak')
    expect(rejectedSupervisor.snapshot().state).toBe('tested')
    rejectedSupervisor.stop()

    const forbidden = new FakePluginChild()
    const forbiddenSupervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.forbidden-method', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 200, spawnProcess: () => forbidden,
    })
    forbiddenSupervisor.start()
    forbidden.stdout.write('{"jsonrpc":"2.0","id":"forbidden","method":"filesystem.read","params":{}}\n')
    await vi.waitFor(() => expect(forbiddenSupervisor.snapshot().state).toBe('quarantined'))
    expect(forbidden.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('宿主 Broker handler 挂起时会返回限时错误且释放请求 ID', async () => {
    const child = new FakePluginChild()
    const stdinLines: string[] = []
    child.stdin.on('data', (chunk: Buffer) => stdinLines.push(chunk.toString('utf8')))
    let receivedSignal: AbortSignal | undefined
    const supervisor = new ProviderPluginProcessSupervisor({
      pluginId: 'provider.broker-timeout', pluginVersion: '1.0.0', runtimePath: '/runtime/deno', bundlePath: '/plugin/main.ts',
      mode: 'test', requestTimeoutMs: 20, spawnProcess: () => child,
      handleHostRequest: async (_method, _params, signal) => {
        receivedSignal = signal
        return await new Promise(() => undefined)
      },
    })
    supervisor.start()
    child.stdout.write('{"jsonrpc":"2.0","id":"broker-timeout","method":"broker.execute","params":{}}\n')
    await vi.waitFor(() => expect(stdinLines.length).toBe(1))
    expect(stdinLines[0]).toContain('BROKER_REQUEST_TIMEOUT')
    expect(receivedSignal?.aborted).toBe(true)
    expect(supervisor.snapshot()).toMatchObject({ state: 'tested', pendingHostRequests: 0 })
    supervisor.stop()
  })

  it('外部取消会一直传递到 Broker transport', async () => {
    const external = new AbortController()
    const transportAbort = vi.fn()
    const transport = vi.fn(async (request: { signal: AbortSignal }) => ({
      status: 200, headers: { 'content-type': 'application/json' }, abort: transportAbort,
      body: (async function* () {
        await new Promise<void>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        yield Buffer.from('{}')
      })(),
    }))
    const broker = new EgressBroker({
      policies: [brokerPolicy], testNetworkEnabled: true, resolveHost: async () => ['8.8.8.8'], resolveSecret: async () => 'secret',
      transport,
    })
    const pending = broker.execute(brokerRequest(), external.signal)
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce())
    external.abort()
    await expect(pending).rejects.toMatchObject({ code: 'EGRESS_ABORTED' })
  })

  it('Deno 2.9.2 运行时目录固定官方资产、大小和 SHA-256', () => {
    expect(resolveDenoRuntimeArtifact('darwin', 'arm64')).toMatchObject({
      version: '2.9.2', assetName: 'deno-aarch64-apple-darwin.zip', size: 37_981_362,
      sha256: '687ae485168ba73a4f1ee3a954eb4f077eca82f2fefd236a6a83a3889287876c',
    })
    expect(resolveDenoRuntimeArtifact('darwin', 'x64').sha256).toBe('c953379e5a85a0a30e99aa51b807633e380e809a1181f53e4904d5fa73785bff')
    expect(resolveDenoRuntimeArtifact('win32', 'x64').sha256).toBe('5fe194d26ac5ef77fcc5288c2c438c7a0465f3b6180440ebf04092714bf2dcdf')
    expect(() => resolveDenoRuntimeArtifact('win32', 'arm64')).toThrow('DENO_RUNTIME_PLATFORM_UNSUPPORTED')
  })

  it('运行时安装校验官方归档 hash、单文件 ZIP、版本并原子复用', async () => {
    const archive = await runtimeZip([{ name: 'deno', body: '#!/bin/sh\necho deno 2.9.2\n' }])
    const artifact = {
      ...resolveDenoRuntimeArtifact('darwin', 'arm64'), size: archive.length,
      sha256: createHash('sha256').update(archive).digest('hex'),
    }
    const rootDirectory = await mkdtemp(join(tmpdir(), 'director-deno-runtime-'))
    const download = vi.fn(async function* () { yield archive.subarray(0, 9); yield archive.subarray(9) })
    const probe = vi.fn(async () => 'deno 2.9.2\nv8 fixture')
    const installer = new DenoRuntimeInstaller({ rootDirectory, catalog: [artifact], download, probe })
    const progress: Array<{ phase: string; receivedBytes: number; totalBytes: number }> = []
    expect(await installer.inspect('darwin', 'arm64')).toMatchObject({ state: 'not-installed', artifact: { version: '2.9.2' } })
    const installed = await installer.install('darwin', 'arm64', new AbortController().signal, (update) => progress.push(update))
    expect(installed).toMatchObject({ reused: false, version: '2.9.2', archiveSha256: artifact.sha256 })
    expect(await readFile(installed.executablePath, 'utf8')).toContain('deno 2.9.2')
    expect(await readdir(join(installed.executablePath, '..'))).toEqual(['deno', 'runtime.json'])
    const reused = await installer.install('darwin', 'arm64')
    expect(reused).toMatchObject({ reused: true, binarySha256: installed.binarySha256 })
    expect(await installer.inspect('darwin', 'arm64')).toMatchObject({ state: 'ready', receipt: { binarySha256: installed.binarySha256 } })
    expect(download).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledTimes(3)
    expect(progress.map((update) => update.phase)).toEqual(['downloading', 'downloading', 'downloading', 'verifying', 'extracting', 'probing', 'publishing'])
    expect(progress.filter((update) => update.phase === 'downloading').map((update) => update.receivedBytes)).toEqual([0, 9, archive.length])
    expect(progress.every((update) => update.totalBytes === archive.length)).toBe(true)
  })

  it('运行时 checksum 错误、ZIP 路径异常和已安装篡改都 fail closed', async () => {
    const archive = await runtimeZip([{ name: 'deno', body: 'fixture' }])
    const base = resolveDenoRuntimeArtifact('darwin', 'arm64')
    const rootDirectory = await mkdtemp(join(tmpdir(), 'director-deno-invalid-'))
    const invalidHashInstaller = new DenoRuntimeInstaller({
      rootDirectory, catalog: [{ ...base, size: archive.length, sha256: '0'.repeat(64) }],
      download: async function* () { yield archive }, probe: async () => 'deno 2.9.2',
    })
    await expect(invalidHashInstaller.install('darwin', 'arm64')).rejects.toEqual(new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_HASH_MISMATCH'))

    const nested = await runtimeZip([{ name: 'nested/deno', body: 'fixture' }])
    const nestedInstaller = new DenoRuntimeInstaller({
      rootDirectory: await mkdtemp(join(tmpdir(), 'director-deno-nested-')),
      catalog: [{ ...base, size: nested.length, sha256: createHash('sha256').update(nested).digest('hex') }],
      download: async function* () { yield nested }, probe: async () => 'deno 2.9.2',
    })
    await expect(nestedInstaller.install('darwin', 'arm64')).rejects.toEqual(new DenoRuntimeInstallError('DENO_RUNTIME_ARCHIVE_INVALID'))

    const validRoot = await mkdtemp(join(tmpdir(), 'director-deno-tamper-'))
    const validArtifact = { ...base, size: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }
    const validInstaller = new DenoRuntimeInstaller({
      rootDirectory: validRoot, catalog: [validArtifact], download: async function* () { yield archive }, probe: async () => 'deno 2.9.2',
    })
    const installed = await validInstaller.install('darwin', 'arm64')
    await writeFile(installed.executablePath, 'tampered')
    expect(await validInstaller.inspect('darwin', 'arm64')).toMatchObject({ state: 'invalid' })
    await expect(validInstaller.install('darwin', 'arm64')).rejects.toEqual(new DenoRuntimeInstallError('DENO_RUNTIME_INSTALL_CONFLICT'))
  })

  it('运行时安装取消后不会发布半成品', async () => {
    const archive = await runtimeZip([{ name: 'deno', body: 'fixture' }])
    const base = resolveDenoRuntimeArtifact('darwin', 'arm64')
    const controller = new AbortController()
    const rootDirectory = await mkdtemp(join(tmpdir(), 'director-deno-abort-'))
    const installer = new DenoRuntimeInstaller({
      rootDirectory,
      catalog: [{ ...base, size: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }],
      download: async function* () {
        yield archive.subarray(0, 8)
        controller.abort()
        yield archive.subarray(8)
      },
      probe: async () => 'deno 2.9.2',
    })
    await expect(installer.install('darwin', 'arm64', controller.signal)).rejects.toEqual(new DenoRuntimeInstallError('DENO_RUNTIME_ABORTED'))
    expect((await readdir(rootDirectory)).filter((name) => !name.startsWith('.'))).toEqual([])
  })
})
