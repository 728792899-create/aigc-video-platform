import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import {
  EgressBrokerStatusSchema,
  EgressPolicySchema,
  EgressRequestDescriptorSchema,
  type EgressBrokerStatus,
  type EgressPolicy,
  type EgressRequestDescriptor,
} from '@aigc-director/contracts'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const SAFE_RESPONSE_HEADERS = new Set(['content-type', 'content-length', 'etag', 'last-modified', 'x-request-id', 'retry-after'])

export type EgressErrorCode =
  | 'EGRESS_DISABLED'
  | 'EGRESS_POLICY_NOT_FOUND'
  | 'EGRESS_METHOD_DENIED'
  | 'EGRESS_URL_DENIED'
  | 'EGRESS_DNS_DENIED'
  | 'EGRESS_REDIRECT_DENIED'
  | 'EGRESS_REQUEST_TOO_LARGE'
  | 'EGRESS_RESPONSE_TOO_LARGE'
  | 'EGRESS_RESPONSE_MIME_DENIED'
  | 'EGRESS_CREDENTIAL_UNAVAILABLE'
  | 'EGRESS_ABORTED'
  | 'EGRESS_TIMEOUT'
  | 'EGRESS_TRANSPORT_FAILED'

export class EgressBrokerError extends Error {
  constructor(readonly code: EgressErrorCode) { super(code) }
}

export interface EgressCredentialBinding {
  reference: string
  header: 'authorization' | 'x-api-key'
  prefix?: string
}

export interface EgressRuntimePolicy extends Omit<EgressPolicy, 'credentialConfigured'> {
  credential?: EgressCredentialBinding
}

export interface EgressAuditRecord {
  requestId: string
  channel: EgressRequestDescriptor['channel']
  policyId?: string
  hostHash?: string
  pathHash?: string
  method: EgressRequestDescriptor['method']
  status: 'succeeded' | 'failed'
  statusCode?: number
  responseBytes?: number
  redirects: number
  errorCode?: EgressErrorCode
  timestamp: string
}

export interface EgressTransportRequest {
  url: URL
  method: EgressRequestDescriptor['method']
  headers: Record<string, string>
  body?: Uint8Array
  resolvedAddress: string
  signal: AbortSignal
}

export interface EgressTransportResponse {
  status: number
  headers: Record<string, string>
  body: AsyncIterable<Uint8Array>
  abort(): void
}

export interface EgressBrokerResponse {
  status: number
  headers: Record<string, string>
  body: Uint8Array
  audit: EgressAuditRecord
}

export interface EgressBrokerOptions {
  policies: readonly EgressRuntimePolicy[]
  resolveSecret?: (reference: string) => Promise<string | undefined>
  onAudit?: (record: EgressAuditRecord) => void
  resolveHost?: (hostname: string) => Promise<string[]>
  transport?: (request: EgressTransportRequest) => Promise<EgressTransportResponse>
  testNetworkEnabled?: boolean
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

function parseIpv4(address: string): number[] | undefined {
  const parts = address.split('.')
  if (parts.length !== 4) return undefined
  const values = parts.map((part) => Number(part))
  if (values.some((value, index) => !Number.isInteger(value) || value < 0 || value > 255 || String(value) !== parts[index])) return undefined
  return values
}

function ipv6BigInt(address: string): bigint | undefined {
  const withoutZone = address.split('%')[0]?.toLowerCase()
  if (!withoutZone || withoutZone.includes('.')) return undefined
  const halves = withoutZone.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return undefined
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 2 && missing < 1)) return undefined
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return undefined
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n)
}

function hasIpv6Prefix(value: bigint, prefix: bigint, bits: number): boolean {
  const shift = 128n - BigInt(bits)
  return (value >> shift) === (prefix >> shift)
}

export function isPublicNetworkAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = parseIpv4(address)
    if (!octets) return false
    const [a, b, c] = octets
    if (a === undefined || b === undefined || c === undefined) return false
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (isIP(address) !== 6) return false
  const value = ipv6BigInt(address)
  if (value === undefined || !hasIpv6Prefix(value, 0x20000000000000000000000000000000n, 3)) return false
  const denied = [
    [0x20010000000000000000000000000000n, 32],
    [0x20010002000000000000000000000000n, 48],
    [0x20010010000000000000000000000000n, 28],
    [0x20010db8000000000000000000000000n, 32],
    [0x20020000000000000000000000000000n, 16],
  ] as const
  return denied.every(([prefix, bits]) => !hasIpv6Prefix(value, prefix, bits))
}

function validateUrl(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new EgressBrokerError('EGRESS_URL_DENIED') }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || !allowedHosts.includes(host) || host === 'localhost' || host.endsWith('.localhost')) {
    throw new EgressBrokerError('EGRESS_URL_DENIED')
  }
  if (isIP(host) > 0 && !isPublicNetworkAddress(host)) throw new EgressBrokerError('EGRESS_URL_DENIED')
  return url
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  if (isIP(hostname) > 0) return [hostname]
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)
}

function responseHeaders(raw: NodeJS.Dict<string | string[]>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string') normalized[name.toLowerCase()] = value
    else if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(', ')
  }
  return normalized
}

async function defaultTransport(input: EgressTransportRequest): Promise<EgressTransportResponse> {
  return await new Promise((resolve, reject) => {
    const family = isIP(input.resolvedAddress)
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => callback(null, input.resolvedAddress, family)
    const request = httpsRequest(input.url, {
      method: input.method,
      headers: input.headers,
      signal: input.signal,
      lookup: pinnedLookup,
      servername: input.url.hostname,
      rejectUnauthorized: true,
    }, (incoming) => {
      resolve({ status: incoming.statusCode ?? 502, headers: responseHeaders(incoming.headers), body: incoming, abort: () => incoming.destroy() })
    })
    request.once('error', reject)
    if (input.body) request.write(input.body)
    request.end()
  })
}

function publicPolicy(policy: EgressRuntimePolicy): EgressPolicy {
  const { credential: _credential, ...visible } = policy
  return EgressPolicySchema.parse({ ...visible, credentialConfigured: Boolean(policy.credential) })
}

function allowedMime(contentType: string | undefined, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return true
  if (!contentType) return false
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return prefixes.some((prefix) => prefix.endsWith('/') ? mime.startsWith(prefix) : mime === prefix)
}

function sanitizedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => SAFE_RESPONSE_HEADERS.has(name)))
}

export class EgressBroker {
  private readonly networkEnabled: boolean
  private readonly resolveHost: NonNullable<EgressBrokerOptions['resolveHost']>
  private readonly transport: NonNullable<EgressBrokerOptions['transport']>

  constructor(private readonly options: EgressBrokerOptions) {
    this.networkEnabled = process.env.NODE_ENV === 'test' && options.testNetworkEnabled !== undefined
      ? options.testNetworkEnabled
      : process.env.PROVIDER_NETWORK_DISABLED === '0'
    this.resolveHost = options.resolveHost ?? defaultResolveHost
    this.transport = options.transport ?? defaultTransport
  }

  status(): EgressBrokerStatus {
    const policies = this.options.policies.map(publicPolicy)
    return EgressBrokerStatusSchema.parse({ enabled: this.networkEnabled && policies.some((policy) => policy.enabled), networkDisabled: !this.networkEnabled, policies })
  }

  async execute(raw: EgressRequestDescriptor, externalSignal?: AbortSignal): Promise<EgressBrokerResponse> {
    const descriptor = EgressRequestDescriptorSchema.parse(raw)
    let policy: EgressRuntimePolicy | undefined
    let url: URL | undefined
    let redirects = 0
    try {
      if (externalSignal?.aborted) throw new EgressBrokerError('EGRESS_ABORTED')
      if (!this.networkEnabled) throw new EgressBrokerError('EGRESS_DISABLED')
      policy = this.options.policies.find((candidate) => candidate.channel === descriptor.channel && candidate.enabled)
      if (!policy) throw new EgressBrokerError('EGRESS_POLICY_NOT_FOUND')
      const normalizedPolicy = publicPolicy(policy)
      if (!normalizedPolicy.allowedMethods.includes(descriptor.method)) throw new EgressBrokerError('EGRESS_METHOD_DENIED')
      const body = descriptor.bodyText === undefined ? undefined : Buffer.from(descriptor.bodyText, 'utf8')
      if ((body?.byteLength ?? 0) > normalizedPolicy.maxRequestBytes) throw new EgressBrokerError('EGRESS_REQUEST_TOO_LARGE')
      if (descriptor.method === 'GET' && body) throw new EgressBrokerError('EGRESS_METHOD_DENIED')
      url = validateUrl(descriptor.url, normalizedPolicy.allowedHosts)

      while (true) {
        const addresses = await this.resolveHost(url.hostname)
        if (externalSignal?.aborted) throw new EgressBrokerError('EGRESS_ABORTED')
        if (addresses.length === 0 || addresses.some((address) => !isPublicNetworkAddress(address))) throw new EgressBrokerError('EGRESS_DNS_DENIED')
        const resolvedAddress = [...addresses].sort()[0]
        if (!resolvedAddress) throw new EgressBrokerError('EGRESS_DNS_DENIED')
        const headers = { ...descriptor.headers }
        if (policy.credential) {
          const secret = await this.options.resolveSecret?.(policy.credential.reference)
          if (externalSignal?.aborted) throw new EgressBrokerError('EGRESS_ABORTED')
          if (!secret) throw new EgressBrokerError('EGRESS_CREDENTIAL_UNAVAILABLE')
          headers[policy.credential.header] = `${policy.credential.prefix ?? ''}${secret}`
        }
        const controller = new AbortController()
        let transportResponse: EgressTransportResponse | undefined
        let timedOut = false
        const abortTransport = () => { controller.abort(); transportResponse?.abort() }
        const timeout = setTimeout(() => { timedOut = true; abortTransport() }, normalizedPolicy.timeoutMs)
        externalSignal?.addEventListener('abort', abortTransport, { once: true })
        try {
          transportResponse = await this.transport({ url, method: descriptor.method, headers, ...(body ? { body } : {}), resolvedAddress, signal: controller.signal })

          if (REDIRECT_STATUSES.has(transportResponse.status)) {
            transportResponse.abort()
            if (redirects >= normalizedPolicy.maxRedirects) throw new EgressBrokerError('EGRESS_REDIRECT_DENIED')
            if (descriptor.method !== 'GET' && ![307, 308].includes(transportResponse.status)) throw new EgressBrokerError('EGRESS_REDIRECT_DENIED')
            const location = transportResponse.headers.location
            if (!location) throw new EgressBrokerError('EGRESS_REDIRECT_DENIED')
            url = validateUrl(new URL(location, url).toString(), normalizedPolicy.allowedHosts)
            redirects += 1
            continue
          }

          const declaredLength = Number(transportResponse.headers['content-length'] ?? '0')
          if ((Number.isFinite(declaredLength) && declaredLength > normalizedPolicy.maxResponseBytes) || !allowedMime(transportResponse.headers['content-type'], normalizedPolicy.allowedResponseMimePrefixes)) {
            transportResponse.abort()
            if (declaredLength > normalizedPolicy.maxResponseBytes) throw new EgressBrokerError('EGRESS_RESPONSE_TOO_LARGE')
            throw new EgressBrokerError('EGRESS_RESPONSE_MIME_DENIED')
          }
          const chunks: Uint8Array[] = []
          let total = 0
          for await (const chunk of transportResponse.body) {
            total += chunk.byteLength
            if (total > normalizedPolicy.maxResponseBytes) {
              transportResponse.abort()
              throw new EgressBrokerError('EGRESS_RESPONSE_TOO_LARGE')
            }
            chunks.push(chunk)
          }
          if (externalSignal?.aborted) throw new EgressBrokerError('EGRESS_ABORTED')
          if (controller.signal.aborted) throw new EgressBrokerError('EGRESS_TIMEOUT')
          const audit: EgressAuditRecord = {
            requestId: descriptor.id, channel: descriptor.channel, policyId: normalizedPolicy.id,
            hostHash: sha256(url.hostname), pathHash: sha256(url.pathname), method: descriptor.method,
            status: 'succeeded', statusCode: transportResponse.status, responseBytes: total, redirects, timestamp: new Date().toISOString(),
          }
          this.options.onAudit?.(audit)
          return { status: transportResponse.status, headers: sanitizedHeaders(transportResponse.headers), body: Buffer.concat(chunks), audit }
        } catch (error) {
          if (externalSignal?.aborted) throw new EgressBrokerError('EGRESS_ABORTED')
          if (timedOut || controller.signal.aborted) throw new EgressBrokerError('EGRESS_TIMEOUT')
          if (error instanceof EgressBrokerError) throw error
          throw new EgressBrokerError('EGRESS_TRANSPORT_FAILED')
        } finally {
          clearTimeout(timeout)
          externalSignal?.removeEventListener('abort', abortTransport)
        }
      }
    } catch (error) {
      const code = error instanceof EgressBrokerError ? error.code : 'EGRESS_TRANSPORT_FAILED'
      const audit: EgressAuditRecord = {
        requestId: descriptor.id, channel: descriptor.channel, ...(policy ? { policyId: policy.id } : {}),
        ...(url ? { hostHash: sha256(url.hostname), pathHash: sha256(url.pathname) } : {}),
        method: descriptor.method, status: 'failed', redirects, errorCode: code, timestamp: new Date().toISOString(),
      }
      this.options.onAudit?.(audit)
      throw new EgressBrokerError(code)
    }
  }
}
