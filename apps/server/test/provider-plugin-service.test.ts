import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderPluginInstallRequest } from '@aigc-director/contracts'
import { providerPluginSignaturePayload } from '@aigc-director/providers'
import { DirectorDatabase } from '../src/db/database.js'
import { ProviderPluginService, type ProviderPluginLifecycleRunner } from '../src/services/providerPluginService.js'

function signedPlugin(version = '1.0.0'): { request: ProviderPluginInstallRequest; trusted: Record<string, string>; bundle: Buffer } {
  const bundle = Buffer.from('export const plugin = { apiVersion: 1 }\n', 'utf8')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const unsigned = {
    id: 'provider.clean-room-test', version, apiVersion: 1 as const, displayName: 'Clean-room test provider',
    publisherKeyId: 'publisher.test', bundleSha256: createHash('sha256').update(bundle).digest('hex'),
    channels: ['model-api' as const], runtime: { name: 'deno' as const, version: '2.9.2' as const },
  }
  return {
    request: {
      manifest: { ...unsigned, signature: sign(null, providerPluginSignaturePayload(unsigned), privateKey).toString('base64') },
      bundleBase64: bundle.toString('base64'),
    },
    trusted: { 'publisher.test': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    bundle,
  }
}

async function fixture(runner: ProviderPluginLifecycleRunner, pluginsEnabled = false) {
  const directory = await mkdtemp(join(tmpdir(), 'aigc-provider-plugin-'))
  const database = new DirectorDatabase(join(directory, 'director.sqlite'))
  const signed = signedPlugin()
  const service = new ProviderPluginService({
    database, dataDirectory: directory, trustedPublisherKeys: signed.trusted, pluginsEnabled, lifecycleRunner: runner,
  })
  return { directory, database, signed, service }
}

describe('Provider plugin 持久生命周期', () => {
  it('只接受受信签名包，使用相对定位并幂等安装', async () => {
    const runner = { test: vi.fn(async () => ({ healthy: true })) }
    const { directory, database, signed, service } = await fixture(runner)
    try {
      const installed = await service.install(signed.request)
      const repeated = await service.install(signed.request)
      expect(repeated.id).toBe(installed.id)
      expect(service.list()).toHaveLength(1)
      expect(installed.bundleLocator.startsWith('provider-plugins/')).toBe(true)
      expect(installed.bundleLocator).not.toContain(directory)
      await expect(readFile(join(directory, installed.bundleLocator))).resolves.toEqual(signed.bundle)
      expect(() => database.putProviderPlugin({
        ...installed,
        pluginId: 'provider.identity-change',
        manifest: { ...installed.manifest, id: 'provider.identity-change' },
        bundleLocator: `provider-plugins/provider.identity-change/${installed.version}/${installed.manifest.bundleSha256}.ts`,
        revision: 2,
      }, 1)).toThrow('PROVIDER_PLUGIN_IDENTITY_IMMUTABLE')
      await expect(new ProviderPluginService({
        database, dataDirectory: directory, lifecycleRunner: runner,
      }).install(signed.request)).rejects.toThrow('PLUGIN_PUBLISHER_UNTRUSTED')
    } finally { database.close() }
  })

  it('测试、启用和停用均使用 revision 门禁，启用默认关闭', async () => {
    const runner = { test: vi.fn(async () => ({ healthy: true, protocol: 1 })) }
    const { directory, database, signed, service } = await fixture(runner)
    try {
      const installed = await service.install(signed.request)
      const report = await service.test(installed.id, 1)
      expect(report).toMatchObject({ passed: true, plugin: { state: 'tested', revision: 2 } })
      expect(report.evidenceHash).toMatch(/^[a-f0-9]{64}$/u)
      expect(runner.test).toHaveBeenCalledOnce()
      await expect(service.enable(installed.id, 2)).rejects.toThrow('PROVIDER_PLUGINS_DISABLED')

      const enabledService = new ProviderPluginService({
        database, dataDirectory: directory, trustedPublisherKeys: signed.trusted, pluginsEnabled: true, lifecycleRunner: runner,
      })
      const enabled = await enabledService.enable(installed.id, 2)
      expect(enabled).toMatchObject({ state: 'enabled', revision: 3 })
      expect(() => enabledService.disable(installed.id, 2)).toThrow('PROVIDER_PLUGIN_REVISION_CONFLICT')
      expect(enabledService.disable(installed.id, 3)).toMatchObject({ state: 'tested', revision: 4 })
    } finally { database.close() }
  })

  it('本地发布者信任绑定 Ed25519 指纹，撤销前阻止已启用插件', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-provider-publisher-'))
    const database = new DirectorDatabase(join(directory, 'director.sqlite'))
    const signed = signedPlugin()
    const runner = { test: vi.fn(async () => ({ healthy: true })) }
    const service = new ProviderPluginService({ database, dataDirectory: directory, pluginsEnabled: true, lifecycleRunner: runner })
    try {
      const publicKeyPem = signed.trusted['publisher.test']
      if (!publicKeyPem) throw new Error('fixture key missing')
      const trusted = service.trustPublisher({
        keyId: 'publisher.test', displayName: '本地原创发布者', publicKeyPem,
        confirmation: 'TRUST_PROVIDER_PLUGIN_PUBLISHER',
      })
      expect(trusted).toMatchObject({ state: 'trusted', revision: 1 })
      expect(trusted.publicKeyFingerprint).toMatch(/^[a-f0-9]{64}$/u)
      expect(JSON.stringify(trusted)).not.toContain('BEGIN PUBLIC KEY')
      expect(service.trustPublisher({
        keyId: 'publisher.test', displayName: '幂等信任', publicKeyPem,
        confirmation: 'TRUST_PROVIDER_PLUGIN_PUBLISHER',
      }).id).toBe(trusted.id)

      const installed = await service.install(signed.request)
      const tested = await service.test(installed.id, installed.revision)
      const enabled = await service.enable(installed.id, tested.plugin.revision)
      expect(() => service.revokePublisher(trusted.id, {
        expectedRevision: trusted.revision, confirmation: 'REVOKE_PROVIDER_PLUGIN_PUBLISHER',
      })).toThrow('PROVIDER_PUBLISHER_IN_USE')
      service.disable(enabled.id, enabled.revision)
      const revoked = service.revokePublisher(trusted.id, {
        expectedRevision: trusted.revision, confirmation: 'REVOKE_PROVIDER_PLUGIN_PUBLISHER',
      })
      expect(revoked).toMatchObject({ state: 'revoked', revision: 2 })
      await expect(service.enable(installed.id, 4)).rejects.toThrow('PLUGIN_PUBLISHER_UNTRUSTED')

      const restored = service.trustPublisher({
        keyId: 'publisher.test', displayName: '恢复信任', publicKeyPem,
        confirmation: 'TRUST_PROVIDER_PLUGIN_PUBLISHER',
      })
      expect(restored).toMatchObject({ state: 'trusted', revision: 3 })
      await expect(service.enable(installed.id, 4)).resolves.toMatchObject({ state: 'enabled', revision: 5 })
    } finally { database.close() }
  })

  it('文件被篡改或沙箱失败时进入可诊断隔离态', async () => {
    const runner = { test: vi.fn(async () => { throw new Error('PLUGIN_RPC_SCHEMA_INVALID') }) }
    const { directory, database, signed, service } = await fixture(runner)
    try {
      const installed = await service.install(signed.request)
      await writeFile(join(directory, installed.bundleLocator), 'tampered', 'utf8')
      await expect(service.test(installed.id, 1)).rejects.toThrow('PROVIDER_PLUGIN_BUNDLE_TAMPERED')
      expect(service.get(installed.id)).toMatchObject({
        state: 'quarantined', revision: 2, quarantineReason: 'PROVIDER_PLUGIN_BUNDLE_TAMPERED',
      })
      expect(runner.test).not.toHaveBeenCalled()
    } finally { database.close() }
  })
})
