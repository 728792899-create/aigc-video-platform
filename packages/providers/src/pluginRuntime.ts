import { createHash, createPublicKey, verify } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import {
  JsonObjectSchema,
  ProviderPluginManifestSchema,
  type ProviderPluginManifest,
} from '@aigc-director/contracts'

export type UnsignedProviderPluginManifest = Omit<ProviderPluginManifest, 'signature'>

export interface VerifiedProviderPluginBundle {
  manifest: ProviderPluginManifest
  bundleSha256: string
}

export type ProviderPluginVerificationErrorCode =
  | 'PLUGIN_MANIFEST_INVALID'
  | 'PLUGIN_BUNDLE_HASH_MISMATCH'
  | 'PLUGIN_PUBLISHER_UNTRUSTED'
  | 'PLUGIN_SIGNATURE_INVALID'

export class ProviderPluginVerificationError extends Error {
  constructor(readonly code: ProviderPluginVerificationErrorCode) { super(code) }
}

export const MAX_PLUGIN_RPC_BYTES = 64 * 1024

const PluginRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.string().min(1).max(120),
  result: JsonObjectSchema.optional(),
  error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/), message: z.string().max(500) }).optional(),
}).refine((response) => Boolean(response.result) !== Boolean(response.error), { message: '必须且只能提供 result 或 error' })

export type ProviderPluginRpcResponse = z.infer<typeof PluginRpcResponseSchema>

const PluginRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.string().min(1).max(120),
  method: z.literal('broker.execute'),
  params: JsonObjectSchema,
})

export type ProviderPluginRpcRequest = z.infer<typeof PluginRpcRequestSchema>
export type ProviderPluginRpcMessage = ProviderPluginRpcResponse | ProviderPluginRpcRequest
const PluginRpcMessageSchema = z.union([PluginRpcResponseSchema, PluginRpcRequestSchema])

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')

export function providerPluginSignaturePayload(manifest: UnsignedProviderPluginManifest): Buffer {
  return Buffer.from(JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    displayName: manifest.displayName,
    publisherKeyId: manifest.publisherKeyId,
    bundleSha256: manifest.bundleSha256,
    channels: [...manifest.channels].sort(),
    runtime: manifest.runtime,
  }), 'utf8')
}

export function verifyProviderPluginBundle(
  rawManifest: unknown,
  bundle: Uint8Array,
  trustedPublisherKeys: Readonly<Record<string, string | Buffer>>,
): VerifiedProviderPluginBundle {
  const parsed = ProviderPluginManifestSchema.safeParse(rawManifest)
  if (!parsed.success) throw new ProviderPluginVerificationError('PLUGIN_MANIFEST_INVALID')
  const manifest = parsed.data
  const bundleSha256 = sha256(bundle)
  if (bundleSha256 !== manifest.bundleSha256) throw new ProviderPluginVerificationError('PLUGIN_BUNDLE_HASH_MISMATCH')
  const key = trustedPublisherKeys[manifest.publisherKeyId]
  if (!key) throw new ProviderPluginVerificationError('PLUGIN_PUBLISHER_UNTRUSTED')
  const { signature, ...unsigned } = manifest
  let valid = false
  try { valid = verify(null, providerPluginSignaturePayload(unsigned), createPublicKey(key), Buffer.from(signature, 'base64')) } catch { valid = false }
  if (!valid) throw new ProviderPluginVerificationError('PLUGIN_SIGNATURE_INVALID')
  return { manifest, bundleSha256 }
}

export function parseProviderPluginRpcLine(line: string): ProviderPluginRpcResponse {
  if (Buffer.byteLength(line, 'utf8') > MAX_PLUGIN_RPC_BYTES) throw new Error('PLUGIN_RPC_MESSAGE_TOO_LARGE')
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { throw new Error('PLUGIN_RPC_JSON_INVALID') }
  const response = PluginRpcResponseSchema.safeParse(parsed)
  if (!response.success) throw new Error('PLUGIN_RPC_SCHEMA_INVALID')
  return response.data
}

export function parseProviderPluginRpcMessageLine(line: string): ProviderPluginRpcMessage {
  if (Buffer.byteLength(line, 'utf8') > MAX_PLUGIN_RPC_BYTES) throw new Error('PLUGIN_RPC_MESSAGE_TOO_LARGE')
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { throw new Error('PLUGIN_RPC_JSON_INVALID') }
  const message = PluginRpcMessageSchema.safeParse(parsed)
  if (!message.success) throw new Error('PLUGIN_RPC_SCHEMA_INVALID')
  return message.data
}

export function denoPluginCommand(runtimePath: string, bundlePath: string): { command: string; args: string[]; env: Record<string, string> } {
  if (!isAbsolute(runtimePath) || !isAbsolute(bundlePath)) throw new Error('PLUGIN_RUNTIME_PATH_INVALID')
  return {
    command: runtimePath,
    args: [
      'run', '--quiet', '--no-prompt', '--no-config', '--cached-only',
      '--deny-read', '--deny-write', '--deny-net', '--deny-env', '--deny-run', '--deny-sys', '--deny-ffi', '--deny-import',
      bundlePath,
    ],
    env: { DENO_NO_UPDATE_CHECK: '1', DENO_NO_PROMPT: '1', NO_COLOR: '1' },
  }
}
