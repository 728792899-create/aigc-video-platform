import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  JsonObjectSchema,
  ProviderPluginInstallRequestSchema,
  ProviderPluginRecordSchema,
  ProviderPluginTestReportSchema,
  ProviderPublisherRevokeRequestSchema,
  ProviderPublisherTrustRequestSchema,
  ProviderPublisherTrustSchema,
  type JsonObject,
  type ProviderPluginInstallRequest,
  type ProviderPluginRecord,
  type ProviderPluginTestReport,
  type ProviderPublisherRevokeRequest,
  type ProviderPublisherTrust,
  type ProviderPublisherTrustRequest,
} from '@aigc-director/contracts'
import { verifyProviderPluginBundle } from '@aigc-director/providers'
import type { DirectorDatabase } from '../db/database.js'

const MAX_PLUGIN_BUNDLE_BYTES = 512 * 1024

export interface ProviderPluginLifecycleRunner {
  test(record: ProviderPluginRecord, bundlePath: string): Promise<JsonObject>
}

export interface ProviderPluginServiceOptions {
  database: DirectorDatabase
  dataDirectory: string
  trustedPublisherKeys?: Readonly<Record<string, string | Buffer>>
  pluginsEnabled?: boolean
  lifecycleRunner: ProviderPluginLifecycleRunner
  now?: () => Date
}

const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex')

function decodeCanonicalBase64(value: string): Buffer {
  const bundle = Buffer.from(value, 'base64')
  if (bundle.length < 1 || bundle.length > MAX_PLUGIN_BUNDLE_BYTES || bundle.toString('base64') !== value) {
    throw new Error('PROVIDER_PLUGIN_BUNDLE_INVALID')
  }
  return bundle
}

function stableFailureCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message.split(':')[0] : undefined
  return candidate && /^[A-Z][A-Z0-9_]{2,119}$/u.test(candidate) ? candidate : 'PROVIDER_PLUGIN_TEST_FAILED'
}

export class ProviderPluginService {
  private readonly database: DirectorDatabase
  private readonly dataDirectory: string
  private readonly pluginRoot: string
  private readonly configuredPublisherKeys: Readonly<Record<string, string | Buffer>>
  private readonly pluginsEnabled: boolean
  private readonly lifecycleRunner: ProviderPluginLifecycleRunner
  private readonly now: () => Date

  constructor(options: ProviderPluginServiceOptions) {
    this.database = options.database
    this.dataDirectory = resolve(options.dataDirectory)
    if (!isAbsolute(this.dataDirectory)) throw new Error('PROVIDER_PLUGIN_DATA_DIRECTORY_INVALID')
    this.pluginRoot = resolve(this.dataDirectory, 'provider-plugins')
    this.configuredPublisherKeys = options.trustedPublisherKeys ?? {}
    this.pluginsEnabled = options.pluginsEnabled === true
    this.lifecycleRunner = options.lifecycleRunner
    this.now = options.now ?? (() => new Date())
  }

  list(): ProviderPluginRecord[] { return this.database.listProviderPlugins() }

  listPublishers(): ProviderPublisherTrust[] { return this.database.listProviderPublishers() }

  trustPublisher(rawRequest: ProviderPublisherTrustRequest): ProviderPublisherTrust {
    const request = ProviderPublisherTrustRequestSchema.parse(rawRequest)
    if (Object.prototype.hasOwnProperty.call(this.configuredPublisherKeys, request.keyId)) {
      throw new Error('PROVIDER_PUBLISHER_MANAGED_EXTERNALLY')
    }
    const normalized = normalizePublisherKey(request.publicKeyPem)
    const existing = this.database.getProviderPublisherByKeyId(request.keyId)
    const timestamp = this.now().toISOString()
    if (existing) {
      if (existing.record.publicKeyFingerprint !== normalized.fingerprint) throw new Error('PROVIDER_PUBLISHER_KEY_CONFLICT')
      if (existing.record.state === 'trusted') return existing.record
      return this.database.putProviderPublisher(ProviderPublisherTrustSchema.parse({
        ...existing.record, displayName: request.displayName, state: 'trusted', revision: existing.record.revision + 1,
        revokedAt: undefined, updatedAt: timestamp,
      }), normalized.pem, existing.record.revision)
    }
    return this.database.putProviderPublisher(ProviderPublisherTrustSchema.parse({
      id: randomUUID(), keyId: request.keyId, displayName: request.displayName,
      publicKeyFingerprint: normalized.fingerprint, state: 'trusted', revision: 1,
      createdAt: timestamp, updatedAt: timestamp,
    }), normalized.pem, 0)
  }

  revokePublisher(id: string, rawRequest: ProviderPublisherRevokeRequest): ProviderPublisherTrust {
    const request = ProviderPublisherRevokeRequestSchema.parse(rawRequest)
    const existing = this.database.getProviderPublisher(id)
    if (!existing) throw new Error('PROVIDER_PUBLISHER_NOT_FOUND')
    if (existing.record.revision !== request.expectedRevision) throw new Error('PROVIDER_PUBLISHER_REVISION_CONFLICT')
    if (existing.record.state === 'revoked') return existing.record
    if (this.list().some((plugin) => plugin.manifest.publisherKeyId === existing.record.keyId && plugin.state === 'enabled')) {
      throw new Error('PROVIDER_PUBLISHER_IN_USE')
    }
    const timestamp = this.now().toISOString()
    return this.database.putProviderPublisher(ProviderPublisherTrustSchema.parse({
      ...existing.record, state: 'revoked', revision: existing.record.revision + 1,
      revokedAt: timestamp, updatedAt: timestamp,
    }), existing.publicKeyPem, existing.record.revision)
  }

  get(id: string): ProviderPluginRecord {
    const record = this.database.getProviderPlugin(id)
    if (!record) throw new Error('PROVIDER_PLUGIN_NOT_FOUND')
    return record
  }

  async install(rawRequest: ProviderPluginInstallRequest): Promise<ProviderPluginRecord> {
    const request = ProviderPluginInstallRequestSchema.parse(rawRequest)
    const bundle = decodeCanonicalBase64(request.bundleBase64)
    const verified = verifyProviderPluginBundle(request.manifest, bundle, this.trustedPublisherKeys())
    const existing = this.database.getProviderPluginVersion(verified.manifest.id, verified.manifest.version)
    if (existing) {
      if (existing.manifest.bundleSha256 !== verified.bundleSha256 || JSON.stringify(existing.manifest) !== JSON.stringify(verified.manifest)) {
        throw new Error('PROVIDER_PLUGIN_VERSION_CONFLICT')
      }
      await this.assertStoredBundle(existing, bundle)
      return existing
    }

    const bundleLocator = `provider-plugins/${verified.manifest.id}/${verified.manifest.version}/${verified.bundleSha256}.ts`
    const bundlePath = this.resolveBundlePath(bundleLocator)
    const created = await this.publishBundle(bundlePath, bundle)
    const timestamp = this.now().toISOString()
    const record = ProviderPluginRecordSchema.parse({
      id: randomUUID(), pluginId: verified.manifest.id, version: verified.manifest.version,
      manifest: verified.manifest, state: 'installed', bundleLocator, bundleSize: bundle.length,
      revision: 1, installedAt: timestamp, updatedAt: timestamp,
    })
    try {
      return this.database.putProviderPlugin(record, 0)
    } catch (error) {
      const winner = this.database.getProviderPluginVersion(record.pluginId, record.version)
      if (winner?.manifest.bundleSha256 === record.manifest.bundleSha256) return winner
      if (created && !winner) await rm(bundlePath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async test(id: string, expectedRevision: number): Promise<ProviderPluginTestReport> {
    const current = this.get(id)
    if (current.revision !== expectedRevision) throw new Error('PROVIDER_PLUGIN_REVISION_CONFLICT')
    if (current.state === 'enabled') throw new Error('PROVIDER_PLUGIN_STATE_INVALID')
    if (current.state === 'quarantined') throw new Error('PROVIDER_PLUGIN_QUARANTINED')
    const bundlePath = this.resolveBundlePath(current.bundleLocator)
    const timestamp = this.now().toISOString()
    try {
      await this.assertStoredBundle(current)
      const evidence = JsonObjectSchema.parse(await this.lifecycleRunner.test(current, bundlePath))
      const evidenceHash = sha256(JSON.stringify(evidence))
      const tested = ProviderPluginRecordSchema.parse({
        ...current, state: 'tested', revision: current.revision + 1, testedAt: timestamp,
        testEvidenceHash: evidenceHash, updatedAt: timestamp,
        quarantinedAt: undefined, quarantineReason: undefined, enabledAt: undefined,
      })
      const plugin = this.database.putProviderPlugin(tested, expectedRevision)
      return ProviderPluginTestReportSchema.parse({ plugin, passed: true, evidenceHash, timestamp })
    } catch (error) {
      const reason = stableFailureCode(error)
      const quarantined = ProviderPluginRecordSchema.parse({
        ...current, state: 'quarantined', revision: current.revision + 1,
        quarantinedAt: timestamp, quarantineReason: reason, updatedAt: timestamp, enabledAt: undefined,
      })
      this.database.putProviderPlugin(quarantined, expectedRevision)
      throw new Error(reason)
    }
  }

  async enable(id: string, expectedRevision: number): Promise<ProviderPluginRecord> {
    if (!this.pluginsEnabled) throw new Error('PROVIDER_PLUGINS_DISABLED')
    const current = this.get(id)
    if (current.revision !== expectedRevision) throw new Error('PROVIDER_PLUGIN_REVISION_CONFLICT')
    if (current.state !== 'tested') throw new Error('PROVIDER_PLUGIN_STATE_INVALID')
    await this.assertStoredBundle(current)
    const timestamp = this.now().toISOString()
    return this.database.putProviderPlugin(ProviderPluginRecordSchema.parse({
      ...current, state: 'enabled', revision: current.revision + 1, enabledAt: timestamp, updatedAt: timestamp,
    }), expectedRevision)
  }

  disable(id: string, expectedRevision: number): ProviderPluginRecord {
    const current = this.get(id)
    if (current.revision !== expectedRevision) throw new Error('PROVIDER_PLUGIN_REVISION_CONFLICT')
    if (current.state !== 'enabled') throw new Error('PROVIDER_PLUGIN_STATE_INVALID')
    const timestamp = this.now().toISOString()
    return this.database.putProviderPlugin(ProviderPluginRecordSchema.parse({
      ...current, state: 'tested', revision: current.revision + 1, enabledAt: undefined, updatedAt: timestamp,
    }), expectedRevision)
  }

  private resolveBundlePath(locator: string): string {
    if (isAbsolute(locator) || locator.includes('\\')) throw new Error('PROVIDER_PLUGIN_PATH_INVALID')
    const target = resolve(this.dataDirectory, locator)
    if (!target.startsWith(`${this.pluginRoot}${sep}`) || relative(this.pluginRoot, target).startsWith('..')) {
      throw new Error('PROVIDER_PLUGIN_PATH_INVALID')
    }
    return target
  }

  private async assertStoredBundle(record: ProviderPluginRecord, expected?: Uint8Array): Promise<void> {
    const path = this.resolveBundlePath(record.bundleLocator)
    const bytes = await readFile(path).catch(() => { throw new Error('PROVIDER_PLUGIN_BUNDLE_MISSING') })
    if (bytes.length !== record.bundleSize || sha256(bytes) !== record.manifest.bundleSha256) {
      throw new Error('PROVIDER_PLUGIN_BUNDLE_TAMPERED')
    }
    if (expected && !bytes.equals(expected)) throw new Error('PROVIDER_PLUGIN_BUNDLE_TAMPERED')
    verifyProviderPluginBundle(record.manifest, bytes, this.trustedPublisherKeys())
  }

  private trustedPublisherKeys(): Readonly<Record<string, string | Buffer>> {
    return { ...this.database.trustedProviderPublisherKeys(), ...this.configuredPublisherKeys }
  }

  private async publishBundle(target: string, bundle: Uint8Array): Promise<boolean> {
    const existing = await stat(target).then(() => true, () => false)
    if (existing) {
      const bytes = await readFile(target)
      if (sha256(bytes) !== sha256(bundle) || !bytes.equals(bundle)) throw new Error('PROVIDER_PLUGIN_BUNDLE_TAMPERED')
      return false
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    const staging = join(dirname(target), `.${randomUUID()}.staging`)
    try {
      await writeFile(staging, bundle, { flag: 'wx', mode: 0o600 })
      try { await rename(staging, target) } catch (error) {
        const winner = await readFile(target).catch(() => undefined)
        if (!winner || !winner.equals(bundle)) throw error
      }
      return true
    } finally {
      await rm(staging, { force: true })
    }
  }
}

function normalizePublisherKey(rawPem: string): { pem: string; fingerprint: string } {
  try {
    const key = createPublicKey(rawPem)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type')
    const pem = key.export({ type: 'spki', format: 'pem' }).toString()
    const der = key.export({ type: 'spki', format: 'der' })
    return { pem, fingerprint: sha256(der) }
  } catch {
    throw new Error('PROVIDER_PUBLISHER_KEY_INVALID')
  }
}
