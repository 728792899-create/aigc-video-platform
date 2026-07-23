import { createHash, randomUUID } from 'node:crypto'
import {
  ProjectSecurityAuditLogSchema,
  SecurityAuditEventSchema,
  type ProjectSecurityAuditLog,
  type SecurityAuditAction,
  type SecurityAuditEvent,
} from '@aigc-director/contracts'
import type { DirectorDatabase } from '../db/database.js'

interface AuditedOperation {
  projectId: string
  action: SecurityAuditAction
  targetType: SecurityAuditEvent['targetType']
  targetId: string
  correlationId: string
}

const hashReference = (value: string): string => createHash('sha256').update(value).digest('hex')

export class SecurityAuditService {
  constructor(private readonly database: DirectorDatabase) {}

  private append(
    operation: AuditedOperation,
    operationId: string,
    status: SecurityAuditEvent['status'],
    errorCode?: string,
  ): SecurityAuditEvent {
    return this.database.appendSecurityAuditEvent(SecurityAuditEventSchema.parse({
      id: randomUUID(),
      operationId,
      projectId: operation.projectId,
      action: operation.action,
      status,
      targetType: operation.targetType,
      targetReferenceHash: hashReference(operation.targetId),
      correlationId: operation.correlationId,
      ...(errorCode ? { errorCode } : {}),
      createdAt: new Date().toISOString(),
    }))
  }

  async capture<T>(
    operation: AuditedOperation,
    execute: () => T | Promise<T>,
    stableErrorCode: (error: unknown) => string,
  ): Promise<T> {
    const operationId = randomUUID()
    this.append(operation, operationId, 'started')
    try {
      const result = await execute()
      this.append(operation, operationId, 'succeeded')
      return result
    } catch (error) {
      this.append(operation, operationId, 'rejected', stableErrorCode(error))
      throw error
    }
  }

  list(projectId: string, limit: number): ProjectSecurityAuditLog {
    return ProjectSecurityAuditLogSchema.parse({
      projectId,
      generatedAt: new Date().toISOString(),
      events: this.database.listSecurityAuditEvents(projectId, limit),
    })
  }
}
