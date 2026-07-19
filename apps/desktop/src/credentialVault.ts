import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { z } from 'zod'

const keySchema = z.string().regex(/^[a-z][a-z0-9._-]{2,80}$/)
const secretSchema = z.string().min(1).max(20_000)

export class CredentialVault {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<Record<string, string>> {
    try { return JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, string> }
    catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  async set(key: string, secret: string): Promise<void> {
    const safeKey = keySchema.parse(key)
    const safeSecret = secretSchema.parse(secret)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('CREDENTIAL_ENCRYPTION_UNAVAILABLE')
    const values = await this.read()
    values[safeKey] = safeStorage.encryptString(safeSecret).toString('base64')
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.tmp`
    await writeFile(temporary, JSON.stringify(values), { mode: 0o600 })
    await rename(temporary, this.filePath)
  }

  async get(key: string): Promise<string | undefined> {
    const encoded = (await this.read())[keySchema.parse(key)]
    return encoded ? safeStorage.decryptString(Buffer.from(encoded, 'base64')) : undefined
  }

  async remove(key: string): Promise<void> {
    const values = await this.read()
    delete values[keySchema.parse(key)]
    await writeFile(this.filePath, JSON.stringify(values), { mode: 0o600 })
  }
}
