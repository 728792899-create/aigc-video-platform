import {
  StudioLayoutSchema,
  StudioLayoutUpdateSchema,
  type StudioLayout,
  type StudioLayoutUpdate,
} from '@aigc-video/contracts'

import { getDb } from '../db'
import {
  projectExists,
  readStudioLayoutRecord,
  readStudioLayoutRevision,
  upsertStudioLayoutRecord,
} from '../repositories/studioLayoutRepository'
import { sqlNumber, sqlText } from '../routes/routeSupport'

const VIEW_KEY = 'director-studio'

function serviceError(code: string, message: string, status: number): Error {
  return Object.assign(new Error(message), { code, status, retryable: false })
}

function ensureProject(projectId: number): void {
  if (!projectExists(getDb(), projectId)) throw serviceError('PROJECT_NOT_FOUND', '项目不存在', 404)
}

function emptyLayout(projectId: number): StudioLayout {
  return StudioLayoutSchema.parse({
    schema_version: 1,
    project_id: projectId,
    positions: {},
    revision: 0,
    updated_at: null,
  })
}

export function readStudioLayout(projectId: number): StudioLayout {
  ensureProject(projectId)
  const row = readStudioLayoutRecord(getDb(), projectId, VIEW_KEY)
  if (!row) return emptyLayout(projectId)

  try {
    const payload = StudioLayoutUpdateSchema.omit({ base_revision: true }).parse(
      JSON.parse(sqlText(row.payload, '{}')),
    )
    return StudioLayoutSchema.parse({
      ...payload,
      project_id: projectId,
      revision: sqlNumber(row.revision),
      updated_at: sqlNumber(row.updated_at),
    })
  } catch (cause) {
    throw serviceError(
      'STUDIO_LAYOUT_CORRUPT',
      `Studio 布局无法读取，需要重置布局${cause instanceof Error ? `：${cause.message}` : ''}`,
      500,
    )
  }
}

function assertProjectNodeIds(projectId: number, update: StudioLayoutUpdate): void {
  const prefix = `project:${projectId}:`
  if (Object.keys(update.positions).some((nodeId) => !nodeId.startsWith(prefix))) {
    throw serviceError('STUDIO_LAYOUT_PROJECT_MISMATCH', '布局包含其他项目的节点', 400)
  }
}

export function saveStudioLayout(projectId: number, input: unknown): StudioLayout {
  ensureProject(projectId)
  const parsed = StudioLayoutUpdateSchema.safeParse(input)
  if (!parsed.success) {
    throw serviceError('STUDIO_LAYOUT_INVALID', '画布布局格式无效', 400)
  }
  const update = parsed.data
  assertProjectNodeIds(projectId, update)

  return getDb().transaction(() => {
    const currentRevision = readStudioLayoutRevision(getDb(), projectId, VIEW_KEY)
    if (update.base_revision !== undefined && update.base_revision !== currentRevision) {
      throw serviceError(
        'STUDIO_LAYOUT_CONFLICT',
        '画布布局已在其他窗口更新，请刷新后再调整',
        409,
      )
    }

    const revision = currentRevision + 1
    const updatedAt = Date.now()
    const payload = JSON.stringify({
      schema_version: update.schema_version,
      positions: update.positions,
      ...(update.viewport ? { viewport: update.viewport } : {}),
    })
    upsertStudioLayoutRecord(getDb(), {
      projectId,
      viewKey: VIEW_KEY,
      payload,
      revision,
      updatedAt,
    })

    return StudioLayoutSchema.parse({
      schema_version: update.schema_version,
      project_id: projectId,
      positions: update.positions,
      ...(update.viewport ? { viewport: update.viewport } : {}),
      revision,
      updated_at: updatedAt,
    })
  })()
}
