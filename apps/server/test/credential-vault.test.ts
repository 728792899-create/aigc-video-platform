import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DockerSecretCredentialVault, InMemoryCredentialVault } from '../src/services/credentialVault.js'

describe('Provider 凭据保险库', () => {
  it('内存替身只返回引用，支持可验证的替换与删除', async () => {
    const vault = new InMemoryCredentialVault()
    await vault.set('relay-primary', 'demo-secret-never-log')
    expect(vault.reference('relay-primary')).toBe('keychain:relay-primary')
    expect(await vault.has('relay-primary')).toBe(true)
    expect(await vault.get('relay-primary')).toBe('demo-secret-never-log')
    expect(await vault.delete('relay-primary')).toBe(true)
    expect(await vault.has('relay-primary')).toBe(false)
  })

  it('Docker Secret 只读且密钥不得被 API 写回文件', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-secret-'))
    const path = join(directory, 'provider-credentials.json')
    await writeFile(path, JSON.stringify({ 'relay-primary': 'demo-secret-from-docker' }), { mode: 0o600 })
    const vault = new DockerSecretCredentialVault(path)
    expect(vault.reference('relay-primary')).toBe('docker-secret:relay-primary')
    expect(await vault.has('relay-primary')).toBe(true)
    await expect(vault.set('relay-primary', 'replacement-secret')).rejects.toThrow('CREDENTIAL_STORE_READ_ONLY')
    await expect(vault.delete('relay-primary')).rejects.toThrow('CREDENTIAL_STORE_READ_ONLY')
  })
})
