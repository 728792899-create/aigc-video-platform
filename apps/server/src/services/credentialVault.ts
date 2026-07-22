import { readFile } from 'node:fs/promises'
import { z } from 'zod'

export interface CredentialVault {
  readonly backend: 'keychain' | 'docker-secret' | 'memory'
  reference(key: string): string
  has(key: string): Promise<boolean>
  get(key: string): Promise<string | undefined>
  set(key: string, secret: string): Promise<void>
  delete(key: string): Promise<boolean>
}

const credentialKey = z.string().regex(/^[a-zA-Z0-9._-]{3,120}$/u)
const credentialSecret = z.string().min(8).max(16_384)

export class InMemoryCredentialVault implements CredentialVault {
  readonly backend = 'memory' as const
  private readonly entries = new Map<string, string>()

  reference(key: string): string { return `keychain:${credentialKey.parse(key)}` }
  async has(key: string): Promise<boolean> { return this.entries.has(credentialKey.parse(key)) }
  async get(key: string): Promise<string | undefined> { return this.entries.get(credentialKey.parse(key)) }
  async set(key: string, secret: string): Promise<void> { this.entries.set(credentialKey.parse(key), credentialSecret.parse(secret)) }
  async delete(key: string): Promise<boolean> { return this.entries.delete(credentialKey.parse(key)) }
}

export class DockerSecretCredentialVault implements CredentialVault {
  readonly backend = 'docker-secret' as const
  constructor(private readonly filePath: string) {}

  reference(key: string): string { return `docker-secret:${credentialKey.parse(key)}` }

  private async entries(): Promise<Record<string, string>> {
    const raw = await readFile(this.filePath, { encoding: 'utf8' })
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('CREDENTIAL_SECRET_FILE_TOO_LARGE')
    return z.record(credentialKey, credentialSecret).parse(JSON.parse(raw))
  }

  async has(key: string): Promise<boolean> { return (await this.get(key)) !== undefined }
  async get(key: string): Promise<string | undefined> { return (await this.entries())[credentialKey.parse(key)] }
  async set(_key: string, _secret: string): Promise<void> { throw new Error('CREDENTIAL_STORE_READ_ONLY') }
  async delete(_key: string): Promise<boolean> { throw new Error('CREDENTIAL_STORE_READ_ONLY') }
}

export class SystemKeychainCredentialVault implements CredentialVault {
  readonly backend = 'keychain' as const
  private readonly service = 'com.aigc-director.studio.provider'

  reference(key: string): string { return `keychain:${credentialKey.parse(key)}` }

  private async entry(key: string) {
    const { AsyncEntry } = await import('@napi-rs/keyring')
    return new AsyncEntry(this.service, credentialKey.parse(key))
  }

  async has(key: string): Promise<boolean> { return (await this.get(key)) !== undefined }
  async get(key: string): Promise<string | undefined> { return await (await this.entry(key)).getPassword() }
  async set(key: string, secret: string): Promise<void> { await (await this.entry(key)).setPassword(credentialSecret.parse(secret)) }
  async delete(key: string): Promise<boolean> { return await (await this.entry(key)).deleteCredential() }
}

export function createCredentialVault(environment: NodeJS.ProcessEnv = process.env): CredentialVault {
  const dockerSecretPath = environment.AIGC_DIRECTOR_CREDENTIALS_FILE
  return dockerSecretPath ? new DockerSecretCredentialVault(dockerSecretPath) : new SystemKeychainCredentialVault()
}
