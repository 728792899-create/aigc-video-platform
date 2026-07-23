import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const contractRoot = join(root, 'docs/cloud-v1')
const files = {
  openapi: join(contractRoot, 'openapi.json'),
  domain: join(contractRoot, 'schemas/domain.schema.json'),
  events: join(contractRoot, 'schemas/events.schema.json'),
  permissions: join(contractRoot, 'permissions.json'),
}

const errors = []
const parsed = new Map()

function fail(message) {
  errors.push(message)
}

function loadJson(absolute) {
  if (!existsSync(absolute)) {
    fail(`缺少文件: ${relative(root, absolute)}`)
    return {}
  }
  try {
    const value = JSON.parse(readFileSync(absolute, 'utf8'))
    parsed.set(absolute, value)
    return value
  } catch (error) {
    fail(`JSON 无法解析: ${relative(root, absolute)} (${error instanceof Error ? error.message : String(error)})`)
    return {}
  }
}

function visit(value, visitor, path = '$') {
  visitor(value, path)
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, visitor, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => visit(item, visitor, `${path}.${key}`))
  }
}

function resolvePointer(document, pointer) {
  if (!pointer || pointer === '#') return document
  if (!pointer.startsWith('#/')) return undefined
  return pointer.slice(2).split('/').reduce((value, token) => {
    if (value === undefined || value === null) return undefined
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~')
    return value[key]
  }, document)
}

function validateReferences(absolute, document) {
  visit(document, (value, path) => {
    if (!value || typeof value !== 'object' || typeof value.$ref !== 'string') return
    const reference = value.$ref
    if (reference.startsWith('#')) {
      if (resolvePointer(document, reference) === undefined) fail(`${relative(root, absolute)} ${path} 内部引用不存在: ${reference}`)
      return
    }
    const [filePart, pointer = ''] = reference.split('#')
    const target = resolve(dirname(absolute), filePart)
    if (!existsSync(target)) {
      fail(`${relative(root, absolute)} ${path} 外部引用文件不存在: ${reference}`)
      return
    }
    const targetDocument = parsed.get(target) ?? loadJson(target)
    if (pointer && resolvePointer(targetDocument, `#${pointer}`) === undefined) {
      fail(`${relative(root, absolute)} ${path} 外部引用指针不存在: ${reference}`)
    }
  })
}

const openapi = loadJson(files.openapi)
const domain = loadJson(files.domain)
const events = loadJson(files.events)
const permissions = loadJson(files.permissions)

for (const [absolute, document] of parsed) validateReferences(absolute, document)

try {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
  ajv.addSchema(domain)
  ajv.addSchema(events)
  const validateProviderConnection = ajv.compile({ $ref: `${domain.$id}#/$defs/ProviderConnection` })
  const validateCloudEvent = ajv.compile({ $ref: `${events.$id}#/$defs/CloudEvent` })
  const id = '00000000-0000-4000-8000-000000000001'
  const now = '2026-07-21T00:00:00.000Z'
  const providerConnection = {
    id,
    organizationId: '00000000-0000-4000-8000-000000000002',
    ownerId: '00000000-0000-4000-8000-000000000003',
    scope: 'personal',
    endpointOrigin: 'https://relay.invalid',
    protocol: 'openai_compatible',
    status: 'draft',
    credentialRef: 'vault:provider:connection:0001',
    credentialFingerprint: 'a'.repeat(64),
    capabilities: ['text'],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }
  if (!validateProviderConnection(providerConnection)) fail(`ProviderConnection 样例不符合 Schema: ${ajv.errorsText(validateProviderConnection.errors)}`)
  if (validateProviderConnection({ ...providerConnection, credential: 'forbidden' })) fail('ProviderConnection Schema 不得接受 credential 明文')

  const taskEvent = {
    eventVersion: 1,
    eventId: id,
    sequence: 1,
    type: 'task.updated',
    emittedAt: now,
    organizationId: '00000000-0000-4000-8000-000000000002',
    projectId: '00000000-0000-4000-8000-000000000004',
    payload: { taskId: '00000000-0000-4000-8000-000000000005', stage: 'demo', status: 'running', progress: 0.5, attempt: 1, revision: 1 },
    correlationId: 'contract-event-0001',
    resumeCursor: 'resume-cursor-0001',
  }
  if (!validateCloudEvent(taskEvent)) fail(`CloudEvent 样例不符合 Schema: ${ajv.errorsText(validateCloudEvent.errors)}`)
  if (validateCloudEvent({ ...taskEvent, payload: { ...taskEvent.payload, apiKey: 'forbidden' } })) fail('CloudEvent Schema 不得接受未声明敏感 payload 字段')
} catch (error) {
  fail(`JSON Schema 编译失败: ${error instanceof Error ? error.message : String(error)}`)
}

if (openapi.openapi !== '3.1.0') fail('openapi.json 必须使用 OpenAPI 3.1.0')
if (openapi.servers?.[0]?.url !== '/api/v2') fail('Cloud v1 必须保持 additive /api/v2 surface')
if (openapi.info?.version !== '0.1.0-rc2') fail('OpenAPI RC 版本与交付候选不一致')

const methods = new Set(['get', 'post', 'put', 'patch', 'delete'])
const operationIds = new Set()
let operationCount = 0
for (const [pathName, pathItem] of Object.entries(openapi.paths ?? {})) {
  const declaredPathParameters = new Set([
    ...(pathItem.parameters ?? []),
  ].map((parameter) => parameter?.$ref?.split('/').at(-1) ?? parameter?.name).filter(Boolean))
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!methods.has(method)) continue
    operationCount += 1
    if (!operation.operationId) fail(`${method.toUpperCase()} ${pathName} 缺少 operationId`)
    if (operationIds.has(operation.operationId)) fail(`重复 operationId: ${operation.operationId}`)
    operationIds.add(operation.operationId)
    if (!operation.responses || Object.keys(operation.responses).length === 0) fail(`${operation.operationId} 缺少 responses`)

    const operationParameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    const parameterNames = new Set(operationParameters.map((parameter) => parameter?.$ref?.split('/').at(-1) ?? parameter?.name).filter(Boolean))
    for (const token of pathName.matchAll(/\{([^}]+)\}/gu)) {
      const expectedName = token[1].replace(/^./u, (character) => character.toUpperCase())
      if (!parameterNames.has(expectedName) && !declaredPathParameters.has(expectedName)) {
        fail(`${operation.operationId} 缺少路径参数 ${token[1]}`)
      }
    }

    const requiredRoles = operation['x-required-roles'] ?? []
    for (const role of requiredRoles) {
      if (!(permissions.roles ?? []).includes(role)) fail(`${operation.operationId} 使用未知角色 ${role}`)
    }
    const mutating = ['post', 'put', 'patch', 'delete'].includes(method)
    const safeException = new Set(['renewSoftLock', 'markNotificationRead', 'testProviderConnection'])
    const hasIdempotency = operation['x-idempotent'] === true || parameterNames.has('IdempotencyKey')
    const hasRevision = parameterNames.has('IfMatch')
    if (mutating && !hasIdempotency && !hasRevision && !safeException.has(operation.operationId)) {
      fail(`${operation.operationId} 写操作缺少幂等或 revision 契约`)
    }
  }
}
if (operationCount < 20) fail(`OpenAPI 操作数量不足: ${operationCount}`)

const expectedDomainDefinitions = [
  'Organization', 'Membership', 'Invitation', 'Presence', 'SoftLock', 'ReviewThread',
  'ReviewComment', 'ReviewDecision', 'Notification', 'ProviderConnection', 'RelayApproval',
  'ModelBinding', 'ProjectBudget', 'CostLedgerEntry', 'ApiErrorResponse',
]
for (const name of expectedDomainDefinitions) {
  if (!domain.$defs?.[name]) fail(`domain.schema.json 缺少 $defs.${name}`)
}
if (domain.$defs?.ProviderConnection?.properties?.credential) fail('ProviderConnection 响应领域对象不得包含 credential')
if (!domain.$defs?.ProviderConnection?.properties?.credentialRef) fail('ProviderConnection 必须只保存 credentialRef')

const expectedEvents = [
  'PresenceUpdated', 'LockUpdated', 'ReviewUpdated', 'TaskUpdated', 'CostUpdated',
  'NotificationCreated', 'ProviderConnectionUpdated', 'MemberAccessUpdated',
]
for (const name of expectedEvents) {
  if (!events.$defs?.[name]) fail(`events.schema.json 缺少 $defs.${name}`)
}
if (events.$defs?.CloudEvent?.oneOf?.length !== expectedEvents.length) fail('CloudEvent 必须覆盖 8 类已冻结事件')

const expectedRoles = ['owner', 'admin', 'editor', 'reviewer', 'operator', 'viewer']
if (JSON.stringify(permissions.roles) !== JSON.stringify(expectedRoles)) fail('permissions.json 固定角色顺序或内容不一致')
for (const [action, policy] of Object.entries(permissions.actions ?? {})) {
  if (!Array.isArray(policy.allow) || !Array.isArray(policy.conditional)) fail(`${action} 权限策略格式错误`)
  for (const role of policy.allow ?? []) if (!expectedRoles.includes(role)) fail(`${action} 允许未知角色 ${role}`)
  if (typeof policy.audit !== 'boolean') fail(`${action} 必须明确 audit 布尔值`)
}
for (const requiredAction of ['organization.delete', 'membership.manage', 'review.decide', 'provider.shared.approve', 'backup.restore']) {
  if (!permissions.actions?.[requiredAction]) fail(`permissions.json 缺少高风险动作 ${requiredAction}`)
}

const sensitiveRequestProperties = [
  openapi.components?.schemas?.CreateProviderConnectionRequest?.properties?.credential,
  openapi.components?.schemas?.AcceptInvitationRequest?.properties?.token,
]
for (const property of sensitiveRequestProperties) {
  if (property?.writeOnly !== true || property?.['x-sensitive'] !== true) fail('敏感请求字段必须同时标记 writeOnly 和 x-sensitive')
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bsk-(?!test|fake|demo)[A-Za-z0-9_-]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  /https?:\/\/[^\s/:]+:[^\s/@]+@/u,
  /\/(?:Users|home)\/[^/\s"']+/u,
]
for (const absolute of Object.values(files)) {
  const content = readFileSync(absolute, 'utf8')
  for (const pattern of secretPatterns) if (pattern.test(content)) fail(`${relative(root, absolute)} 含疑似密钥或本机路径`)
}

const markdownFiles = ['README.md', 'migration-design.md', 'security-contract-tests.md', 'traceability.md']
for (const name of markdownFiles) {
  const absolute = join(contractRoot, name)
  if (!existsSync(absolute)) {
    fail(`缺少文档: docs/cloud-v1/${name}`)
    continue
  }
  const content = readFileSync(absolute, 'utf8')
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const target = match[1]
    if (/^(?:https?:|#)/u.test(target)) continue
    const cleanTarget = target.split('#')[0]
    if (cleanTarget && !existsSync(resolve(dirname(absolute), cleanTarget))) fail(`${relative(root, absolute)} 链接不存在: ${target}`)
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`✗ ${error}`)
  process.exitCode = 1
} else {
  console.log(`Cloud contract validation passed: ${operationCount} operations, ${expectedDomainDefinitions.length} domain definitions, ${expectedEvents.length} events, ${Object.keys(permissions.actions).length} permission actions`)
}
