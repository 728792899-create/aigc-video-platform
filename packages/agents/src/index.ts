import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { ExecutionPlan } from '@aigc-director/contracts'
import { createDemoPlan } from '@aigc-director/domain'

export * from './promptPack.js'

export interface ApprovalTicket {
  id: string
  runId: string
  planId: string
  checkpointRevision: number
  token: string
  tokenHash: string
  expiresAt: string
}

export function issueApproval(plan: ExecutionPlan, ttlMs = 15 * 60_000): ApprovalTicket {
  const token = randomBytes(32).toString('base64url')
  return {
    id: randomUUID(),
    runId: plan.runId,
    planId: plan.id,
    checkpointRevision: plan.checkpointRevision,
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  }
}

export function verifyApproval(ticket: Omit<ApprovalTicket, 'token'>, token: string, currentRevision: number, consumed: boolean): { valid: boolean; reason?: string } {
  if (consumed) return { valid: false, reason: 'APPROVAL_ALREADY_CONSUMED' }
  if (ticket.checkpointRevision !== currentRevision) return { valid: false, reason: 'APPROVAL_STALE_CHECKPOINT' }
  if (Date.parse(ticket.expiresAt) <= Date.now()) return { valid: false, reason: 'APPROVAL_EXPIRED' }
  const actual = createHash('sha256').update(token).digest('hex')
  return actual === ticket.tokenHash ? { valid: true } : { valid: false, reason: 'APPROVAL_TOKEN_INVALID' }
}

export function createDeterministicDirectorPlan(projectId: string, graphRevision: number): ExecutionPlan {
  return createDemoPlan(projectId, graphRevision)
}
