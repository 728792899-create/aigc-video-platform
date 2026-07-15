import type { DbClient, SqlRow } from '../db'
import { compile, table } from '../db/queryBuilder'

export interface StudioLayoutRecord extends SqlRow {
  payload: string
  revision: number
  updated_at: number
}

function get(db: DbClient, query: ReturnType<typeof table>): SqlRow | undefined {
  const statement = compile(query)
  return db.prepare(statement.sql).get(...statement.bindings)
}

export function projectExists(db: DbClient, projectId: number): boolean {
  return Boolean(get(db, table('projects').select('id').where('id', projectId).first()))
}

export function readStudioLayoutRecord(
  db: DbClient,
  projectId: number,
  viewKey: string,
): StudioLayoutRecord | undefined {
  return get(
    db,
    table('project_view_states')
      .select('payload', 'revision', 'updated_at')
      .where({ project_id: projectId, view_key: viewKey })
      .first(),
  ) as StudioLayoutRecord | undefined
}

export function readStudioLayoutRevision(db: DbClient, projectId: number, viewKey: string): number {
  const row = get(
    db,
    table('project_view_states')
      .select('revision')
      .where({ project_id: projectId, view_key: viewKey })
      .first(),
  )
  return Number(row?.revision) || 0
}

export function upsertStudioLayoutRecord(
  db: DbClient,
  record: {
    projectId: number
    viewKey: string
    payload: string
    revision: number
    updatedAt: number
  },
): void {
  const statement = compile(
    table('project_view_states')
      .insert({
        project_id: record.projectId,
        view_key: record.viewKey,
        payload: record.payload,
        revision: record.revision,
        updated_at: record.updatedAt,
      })
      .onConflict(['project_id', 'view_key'])
      .merge({
        payload: record.payload,
        revision: record.revision,
        updated_at: record.updatedAt,
      }),
  )
  db.prepare(statement.sql).run(...statement.bindings)
}
