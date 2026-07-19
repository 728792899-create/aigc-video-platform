import { describe, expect, it } from 'vitest'
import { createDeterministicDirectorPlan, issueApproval, verifyApproval } from '../src/index.js'

describe('原创 Agent 与审批边界', () => {
  it('审批绑定 checkpoint 且不可重放', () => {
    const plan = createDeterministicDirectorPlan('11111111-1111-4111-8111-111111111111', 3)
    const ticket = issueApproval(plan)
    const stored = { id: ticket.id, runId: ticket.runId, planId: ticket.planId, checkpointRevision: ticket.checkpointRevision, tokenHash: ticket.tokenHash, expiresAt: ticket.expiresAt }
    expect(verifyApproval(stored, ticket.token, 3, false).valid).toBe(true)
    expect(verifyApproval(stored, ticket.token, 4, false).reason).toBe('APPROVAL_STALE_CHECKPOINT')
    expect(verifyApproval(stored, ticket.token, 3, true).reason).toBe('APPROVAL_ALREADY_CONSUMED')
  })
})
