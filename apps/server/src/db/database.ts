import type Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  AgentRunCheckpointSchema,
  AssetBindingSchema,
  AssetImpactSchema,
  ArtifactHeadSchema,
  AssetUnitSchema,
  AssetVariantSchema,
  EpisodeContextSchema,
  EpisodeSchema,
  GoldenEvaluationSchema,
  MemoryChunkSchema,
  MemoryRecordSchema,
  PromptRevisionSchema,
  ProjectGenerationPolicySchema,
  SecurityAuditEventSchema,
  ProviderPluginRecordSchema,
  ProviderConnectionSchema,
  ProviderCostLedgerEntrySchema,
  ProviderRoutePolicySchema,
  ProviderPublisherTrustSchema,
  ResolvedAssetSchema,
  SeriesSchema,
  ShotSchema,
  SharedAssetSchema,
  SharedAssetVariantSchema,
  SharedMediaReferenceSchema,
  SkillPackageVersionSchema,
  type ArtifactVersion,
  type AgentRunCheckpoint,
  type ArtifactHead,
  type AssetBinding,
  type AssetImpact,
  ProjectSchema,
  ProjectSnapshotSchema,
  type AssetUnit,
  type AssetVariant,
  type Candidate,
  type CandidateBatch,
  type Chapter,
  type Episode,
  type EpisodeContext,
  type ExecutionPlan,
  type GenerationTask,
  type GoldenEvaluation,
  type MemoryChunk,
  type MemoryRecord,
  type Project,
  type ProjectGenerationPolicy,
  type SecurityAuditEvent,
  type ProjectSnapshot,
  type PromptRun,
  type PromptRevision,
  type ProviderReceiptRecord,
  type ProviderPluginRecord,
  type ProviderConnection,
  type ProviderCostLedgerEntry,
  type ProviderRoutePolicy,
  type ProviderPublisherTrust,
  type ProviderMediaReceipt,
  type ReviewDecision,
  type ResolvedAsset,
  type Scene,
  type Series,
  type SharedAsset,
  type SharedAssetVariant,
  type SharedMediaReference,
  type SkillPackageVersion,
  type MediaReference,
  type Shot,
  type SourceDocument,
  type StoryEvent,
  type StoryEventEdge,
  type TaskAttempt,
  parseAssetMetadata,
} from '@aigc-director/contracts'
import { DatabaseRuntime } from '../runtimeModules.js'

type EntityTable =
  | 'source_documents' | 'chapters' | 'story_events' | 'story_event_edges'
  | 'scenes' | 'shots' | 'assets' | 'asset_variants' | 'media_references'
  | 'candidates' | 'generation_tasks' | 'execution_plans' | 'agent_approvals'
  | 'prompt_definitions' | 'skill_packages' | 'memory_records' | 'video_tracks' | 'exports'
  | 'prompt_runs' | 'task_attempts' | 'provider_receipts' | 'artifact_versions' | 'review_decisions'
  | 'candidate_batches' | 'provider_media_receipts'

const versionOneEntityTables: readonly EntityTable[] = [
  'source_documents', 'chapters', 'story_events', 'story_event_edges', 'scenes', 'shots',
  'assets', 'asset_variants', 'media_references', 'candidates', 'generation_tasks',
  'execution_plans', 'agent_approvals', 'prompt_definitions', 'skill_packages',
  'memory_records', 'video_tracks', 'exports',
]

const versionTwoEntityTables: readonly EntityTable[] = [
  'prompt_runs', 'task_attempts', 'provider_receipts', 'artifact_versions', 'review_decisions',
]

const versionFiveEntityTables: readonly EntityTable[] = ['candidate_batches', 'provider_media_receipts']

const entityTables: readonly EntityTable[] = [...versionOneEntityTables, ...versionTwoEntityTables, ...versionFiveEntityTables]
export const LATEST_SCHEMA_VERSION = 12

interface EntityRow { payload: string }
interface ProjectRow { id: string; name: string; description: string; status: string; graph_revision: number; created_at: string; updated_at: string }
interface PayloadRow { payload: string }
interface ProviderPublisherRow extends PayloadRow { public_key_pem: string }

function staleFieldsForAssetSlot(slot: AssetBinding['slot']): string[] {
  if (slot === 'voice') return ['asset.voice', 'voice', 'subtitle', 'timeline', 'export']
  if (slot === 'music') return ['asset.music', 'timeline', 'export']
  return [`asset.${slot}`, 'image', 'video', 'timeline', 'export']
}

export class DirectorDatabase {
  readonly raw: Database.Database

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true })
    this.raw = new DatabaseRuntime(filePath)
    this.raw.pragma('foreign_keys = ON')
    this.raw.pragma('journal_mode = WAL')
    this.raw.pragma('busy_timeout = 5000')
    this.initialize()
  }

  private initialize(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    const stored = this.raw.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value?: string } | undefined
    const current = stored?.value === undefined ? 0 : Number.parseInt(stored.value, 10)
    if (!Number.isSafeInteger(current) || current < 0 || current > LATEST_SCHEMA_VERSION) {
      throw new Error(`UNSUPPORTED_SCHEMA_VERSION:${stored?.value ?? 'invalid'}`)
    }
    if (current > 0 && current < LATEST_SCHEMA_VERSION) this.createRestorePoint(current)

    if (current < 1) {
      this.raw.transaction(() => {
        this.createCoreTables()
        this.createEntityTables(versionOneEntityTables)
        this.setSchemaVersion(1)
      })()
    } else {
      this.createCoreTables()
      this.createEntityTables(versionOneEntityTables)
    }

    if (current < 2) {
      this.raw.transaction(() => {
        this.createEntityTables(versionTwoEntityTables)
        this.setSchemaVersion(2)
      })()
    } else {
      this.createEntityTables(versionTwoEntityTables)
    }

    if (current < 3) {
      this.raw.transaction(() => {
        this.createSeriesTables()
        this.ensureWorkspaceId()
        this.backfillStandaloneEpisodes()
        this.setSchemaVersion(3)
      })()
    } else {
      this.createSeriesTables()
      this.ensureWorkspaceId()
    }

    if (current < 4) {
      this.raw.transaction(() => {
        this.createPromptOperationsTables()
        this.setSchemaVersion(4)
      })()
    } else {
      this.createPromptOperationsTables()
    }

    if (current < 5) {
      this.raw.transaction(() => {
        this.createEntityTables(versionFiveEntityTables)
        this.setSchemaVersion(5)
      })()
    } else {
      this.createEntityTables(versionFiveEntityTables)
    }

    if (current < 6) {
      this.raw.transaction(() => {
        this.createMemoryTables()
        this.setSchemaVersion(6)
      })()
    } else {
      this.createMemoryTables()
    }

    if (current < 7) {
      this.raw.transaction(() => {
        this.createProviderPluginTables()
        this.setSchemaVersion(7)
      })()
    } else {
      this.createProviderPluginTables()
    }

    if (current < 8) {
      this.raw.transaction(() => {
        this.createProviderPublisherTables()
        this.setSchemaVersion(8)
      })()
    } else {
      this.createProviderPublisherTables()
    }

    if (current < 9) {
      this.raw.transaction(() => {
        this.createAgentRunCheckpointTables()
        this.setSchemaVersion(9)
      })()
    } else {
      this.createAgentRunCheckpointTables()
    }

    if (current < 10) {
      this.raw.transaction(() => {
        this.createGenerationPolicyTables()
        this.setSchemaVersion(10)
      })()
    } else {
      this.createGenerationPolicyTables()
    }

    if (current < 11) {
      this.raw.transaction(() => {
        this.createSecurityAuditTables()
        this.setSchemaVersion(11)
      })()
    } else {
      this.createSecurityAuditTables()
    }

    if (current < 12) {
      this.raw.transaction(() => {
        this.createProviderConnectionTables()
        this.setSchemaVersion(12)
      })()
    } else {
      this.createProviderConnectionTables()
    }
  }

  private createRestorePoint(version: number): void {
    const databasePath = this.raw.name
    if (!databasePath || databasePath === ':memory:') return
    const restorePath = `${databasePath}.schema-v${version}.restore.sqlite`
    if (existsSync(restorePath)) return
    this.raw.pragma('wal_checkpoint(FULL)')
    this.raw.exec(`VACUUM INTO '${restorePath.replaceAll("'", "''")}'`)
  }

  private createSeriesTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS series (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_series_workspace ON series(workspace_id, updated_at);
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        series_id TEXT REFERENCES series(id) ON DELETE SET NULL,
        ordinal INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_episodes_series_order ON episodes(series_id, ordinal, created_at);
      CREATE TABLE IF NOT EXISTS shared_assets (
        id TEXT PRIMARY KEY,
        logical_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('global','series')),
        series_id TEXT REFERENCES series(id) ON DELETE RESTRICT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK((scope = 'global' AND series_id IS NULL) OR (scope = 'series' AND series_id IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_shared_assets_scope ON shared_assets(scope, series_id, logical_id);
      CREATE TABLE IF NOT EXISTS shared_asset_variants (
        id TEXT PRIMARY KEY,
        shared_asset_id TEXT NOT NULL REFERENCES shared_assets(id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(shared_asset_id, revision)
      );
      CREATE TABLE IF NOT EXISTS shared_media_references (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset_bindings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        shot_id TEXT NOT NULL,
        asset_kind TEXT NOT NULL CHECK(asset_kind IN ('local','shared')),
        asset_id TEXT NOT NULL,
        variant_id TEXT NOT NULL,
        asset_revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_asset_bindings_project_shot ON asset_bindings(project_id, shot_id);
      CREATE INDEX IF NOT EXISTS idx_asset_bindings_asset ON asset_bindings(asset_kind, asset_id, variant_id);
      CREATE TABLE IF NOT EXISTS asset_reference_index (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        asset_kind TEXT NOT NULL CHECK(asset_kind IN ('local','shared')),
        asset_id TEXT NOT NULL,
        variant_id TEXT,
        reference_type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_asset_reference_asset ON asset_reference_index(asset_kind, asset_id, reference_type);
      CREATE TABLE IF NOT EXISTS reconcile_operations (
        id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('preview','applied','expired','failed')),
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }

  private createPromptOperationsTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS prompt_revisions (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        stable_key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(scope_key, stable_key, revision)
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_revisions_lookup ON prompt_revisions(scope_key, stable_key, revision DESC);
      CREATE TABLE IF NOT EXISTS artifact_heads (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(scope_type, scope_id, artifact_type)
      );
      CREATE TABLE IF NOT EXISTS skill_package_versions (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        stable_key TEXT NOT NULL,
        version TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(scope_key, stable_key, version)
      );
      CREATE INDEX IF NOT EXISTS idx_skill_versions_lookup ON skill_package_versions(scope_key, stable_key, created_at DESC);
      CREATE TABLE IF NOT EXISTS golden_evaluations (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_version_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_golden_target ON golden_evaluations(target_type, target_version_id, created_at DESC);
    `)
  }

  private createMemoryTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS memory_documents (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK(scope IN ('episode','series','global')),
        scope_id TEXT NOT NULL,
        origin_project_id TEXT,
        source_type TEXT NOT NULL,
        source_key TEXT NOT NULL,
        source_revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(scope, scope_id, source_type, source_key, source_revision, content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_documents_scope ON memory_documents(scope, scope_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_documents_source ON memory_documents(source_type, source_key, source_revision DESC);
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL REFERENCES memory_documents(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(memory_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_memory ON memory_chunks(memory_id, ordinal);
    `)
  }

  private createProviderPluginTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS provider_plugin_versions (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        version TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('installed','tested','enabled','quarantined')),
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(plugin_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_provider_plugin_state ON provider_plugin_versions(state, updated_at DESC);
    `)
  }

  private createProviderPublisherTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS provider_publishers (
        id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK(state IN ('trusted','revoked')),
        revision INTEGER NOT NULL,
        public_key_pem TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provider_publisher_state ON provider_publishers(state, updated_at DESC);
    `)
  }

  private createAgentRunCheckpointTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS agent_run_checkpoints (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL UNIQUE,
        plan_id TEXT NOT NULL UNIQUE,
        graph_revision INTEGER NOT NULL,
        memory_context_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_checkpoint_project ON agent_run_checkpoints(project_id, created_at DESC);
    `)
  }

  private createGenerationPolicyTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS project_generation_policies (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }

  private createSecurityAuditTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS security_audit_events (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('started','succeeded','rejected')),
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_security_audit_project_time
        ON security_audit_events(project_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_security_audit_operation
        ON security_audit_events(operation_id, created_at ASC, id ASC);
      CREATE TRIGGER IF NOT EXISTS security_audit_events_no_update
        BEFORE UPDATE ON security_audit_events
        BEGIN SELECT RAISE(ABORT, 'SECURITY_AUDIT_IMMUTABLE'); END;
      CREATE TRIGGER IF NOT EXISTS security_audit_events_no_delete
        BEFORE DELETE ON security_audit_events
        BEGIN SELECT RAISE(ABORT, 'SECURITY_AUDIT_IMMUTABLE'); END;
    `)
  }

  private createProviderConnectionTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS provider_connections (
        id TEXT PRIMARY KEY,
        protocol TEXT NOT NULL CHECK(protocol IN ('demo-local','openai-compatible','declarative-http')),
        state TEXT NOT NULL CHECK(state IN ('draft','ready','disabled','error')),
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provider_connections_state ON provider_connections(state, updated_at DESC);
      CREATE TABLE IF NOT EXISTS provider_route_policies (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_cost_ledger (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        amount_micros INTEGER NOT NULL,
        currency TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provider_cost_project ON provider_cost_ledger(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_provider_cost_task ON provider_cost_ledger(task_id, created_at DESC);
    `)
  }

  private ensureWorkspaceId(): string {
    const existing = this.raw.prepare("SELECT value FROM schema_meta WHERE key = 'workspace_id'").get() as { value?: string } | undefined
    if (existing?.value) return existing.value
    const workspaceId = randomUUID()
    this.raw.prepare("INSERT INTO schema_meta(key,value) VALUES ('workspace_id',?)").run(workspaceId)
    return workspaceId
  }

  private backfillStandaloneEpisodes(): void {
    const projects = this.raw.prepare('SELECT * FROM projects ORDER BY created_at ASC').all() as ProjectRow[]
    for (const row of projects) {
      const exists = this.raw.prepare('SELECT 1 FROM episodes WHERE project_id = ?').get(row.id)
      if (!exists) this.insertEpisode(this.createStandaloneEpisode(this.mapProject(row)))
    }
  }

  private createCoreTables(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('active','archived')),
        graph_revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_layouts (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        view TEXT NOT NULL CHECK(view IN ('story','production','delivery')),
        positions_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, view)
      );
      CREATE TABLE IF NOT EXISTS idempotency_records (
        key TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        operation TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
  }

  private createEntityTables(tables: readonly EntityTable[]): void {
    for (const table of tables) {
      this.raw.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${table}_project ON ${table}(project_id, created_at);
      `)
    }
  }

  private setSchemaVersion(version: number): void {
    this.raw.prepare("INSERT INTO schema_meta(key,value) VALUES ('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(version))
  }

  schemaVersion(): number {
    const row = this.raw.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string }
    return Number.parseInt(row.value, 10)
  }

  close(): void { this.raw.close() }

  transaction<T>(operation: () => T): T {
    return this.raw.transaction(operation)()
  }

  workspaceId(): string { return this.ensureWorkspaceId() }

  private createStandaloneEpisode(project: Project): Episode {
    return EpisodeSchema.parse({
      id: randomUUID(), projectId: project.id, ordinal: 0, title: project.name, revision: 1,
      createdAt: project.createdAt, updatedAt: project.updatedAt,
    })
  }

  private insertEpisode(episode: Episode): Episode {
    this.raw.prepare('INSERT INTO episodes(id,project_id,series_id,ordinal,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(episode.id, episode.projectId, episode.seriesId ?? null, episode.ordinal, JSON.stringify(episode), episode.createdAt, episode.updatedAt)
    return episode
  }

  createProject(input: { name: string; description?: string }): Project {
    const timestamp = new Date().toISOString()
    const project: Project = {
      id: randomUUID(), name: input.name.trim(), description: input.description?.trim() ?? '', status: 'active',
      graphRevision: 0, createdAt: timestamp, updatedAt: timestamp,
    }
    ProjectSchema.parse(project)
    this.transaction(() => {
      this.raw.prepare('INSERT INTO projects(id,name,description,status,graph_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(project.id, project.name, project.description, project.status, project.graphRevision, project.createdAt, project.updatedAt)
      this.insertEpisode(this.createStandaloneEpisode(project))
    })
    return project
  }

  getGenerationPolicy(projectId: string): ProjectGenerationPolicy | undefined {
    const row = this.raw.prepare('SELECT payload FROM project_generation_policies WHERE project_id = ?').get(projectId) as PayloadRow | undefined
    return row ? ProjectGenerationPolicySchema.parse(JSON.parse(row.payload)) : undefined
  }

  putGenerationPolicy(rawPolicy: ProjectGenerationPolicy, expectedRevision: number): ProjectGenerationPolicy {
    const policy = ProjectGenerationPolicySchema.parse(rawPolicy)
    if (!this.getProject(policy.projectId)) throw new Error('PROJECT_NOT_FOUND')
    const current = this.getGenerationPolicy(policy.projectId)
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('GENERATION_POLICY_REVISION_CONFLICT')
    if (policy.revision !== expectedRevision + 1) throw new Error('GENERATION_POLICY_REVISION_INVALID')
    this.raw.prepare(`INSERT INTO project_generation_policies(project_id,revision,payload,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(policy.projectId, policy.revision, JSON.stringify(policy), policy.updatedAt)
    return policy
  }

  appendSecurityAuditEvent(rawEvent: SecurityAuditEvent): SecurityAuditEvent {
    const event = SecurityAuditEventSchema.parse(rawEvent)
    if (!this.getProject(event.projectId)) throw new Error('PROJECT_NOT_FOUND')
    this.raw.prepare(`INSERT INTO security_audit_events(
      id, operation_id, project_id, action, status, payload, created_at
    ) VALUES (?,?,?,?,?,?,?)`).run(
      event.id,
      event.operationId,
      event.projectId,
      event.action,
      event.status,
      JSON.stringify(event),
      event.createdAt,
    )
    return event
  }

  listSecurityAuditEvents(projectId: string, limit = 100): SecurityAuditEvent[] {
    if (!this.getProject(projectId)) throw new Error('PROJECT_NOT_FOUND')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('SECURITY_AUDIT_LIMIT_INVALID')
    const rows = this.raw.prepare(`SELECT payload FROM security_audit_events
      WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(projectId, limit) as PayloadRow[]
    return rows.map((row) => SecurityAuditEventSchema.parse(JSON.parse(row.payload)))
  }

  createSeries(input: { name: string; description?: string | undefined; artDirection?: string | undefined; defaults?: Record<string, unknown> | undefined }): Series {
    const timestamp = new Date().toISOString()
    const series = SeriesSchema.parse({
      id: randomUUID(), workspaceId: this.workspaceId(), name: input.name,
      description: input.description ?? '', artDirection: input.artDirection ?? '', defaults: input.defaults ?? {},
      revision: 1, archived: false, createdAt: timestamp, updatedAt: timestamp,
    })
    this.raw.prepare('INSERT INTO series(id,workspace_id,payload,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(series.id, series.workspaceId, JSON.stringify(series), series.createdAt, series.updatedAt)
    return series
  }

  getSeries(id: string): Series | undefined {
    const row = this.raw.prepare('SELECT payload FROM series WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? SeriesSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listSeries(): Series[] {
    const rows = this.raw.prepare('SELECT payload FROM series ORDER BY updated_at DESC').all() as PayloadRow[]
    return rows.map((row) => SeriesSchema.parse(JSON.parse(row.payload)))
  }

  importSeries(rawSeries: Series): Series {
    const series = SeriesSchema.parse({ ...rawSeries, workspaceId: this.workspaceId() })
    this.raw.prepare('INSERT INTO series(id,workspace_id,payload,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(series.id, series.workspaceId, JSON.stringify(series), series.createdAt, series.updatedAt)
    return series
  }

  deleteSeries(seriesId: string): boolean {
    if (this.listEpisodes(seriesId).length > 0) throw new Error('SERIES_REFERENCED')
    return this.raw.prepare('DELETE FROM series WHERE id = ?').run(seriesId).changes === 1
  }

  getEpisode(id: string): Episode | undefined {
    const row = this.raw.prepare('SELECT payload FROM episodes WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? EpisodeSchema.parse(JSON.parse(row.payload)) : undefined
  }

  getEpisodeByProject(projectId: string): Episode | undefined {
    const row = this.raw.prepare('SELECT payload FROM episodes WHERE project_id = ?').get(projectId) as PayloadRow | undefined
    return row ? EpisodeSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listEpisodes(seriesId?: string): Episode[] {
    const rows = seriesId
      ? this.raw.prepare('SELECT payload FROM episodes WHERE series_id = ? ORDER BY ordinal ASC, created_at ASC').all(seriesId) as PayloadRow[]
      : this.raw.prepare('SELECT payload FROM episodes ORDER BY created_at ASC').all() as PayloadRow[]
    return rows.map((row) => EpisodeSchema.parse(JSON.parse(row.payload)))
  }

  private saveEpisode(episode: Episode): Episode {
    const parsed = EpisodeSchema.parse(episode)
    const result = this.raw.prepare('UPDATE episodes SET series_id = ?, ordinal = ?, payload = ?, updated_at = ? WHERE id = ?')
      .run(parsed.seriesId ?? null, parsed.ordinal, JSON.stringify(parsed), parsed.updatedAt, parsed.id)
    if (result.changes !== 1) throw new Error('EPISODE_NOT_FOUND')
    return parsed
  }

  private normalizeSeriesOrdinals(seriesId: string): void {
    this.listEpisodes(seriesId).forEach((episode, ordinal) => {
      if (episode.ordinal !== ordinal) this.saveEpisode({ ...episode, ordinal, revision: episode.revision + 1, updatedAt: new Date().toISOString() })
    })
  }

  attachEpisode(projectId: string, seriesId: string, ordinal?: number): Episode {
    const project = this.getProject(projectId)
    const series = this.getSeries(seriesId)
    const episode = this.getEpisodeByProject(projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')
    if (!series) throw new Error('SERIES_NOT_FOUND')
    if (!episode) throw new Error('EPISODE_NOT_FOUND')
    const previousSeriesId = episode.seriesId
    const requestedOrdinal = ordinal ?? this.listEpisodes(seriesId).length
    const updated = this.transaction(() => {
      const next = this.saveEpisode({
        ...episode, seriesId, ordinal: requestedOrdinal, title: project.name,
        revision: episode.revision + 1, updatedAt: new Date().toISOString(),
      })
      if (previousSeriesId && previousSeriesId !== seriesId) this.normalizeSeriesOrdinals(previousSeriesId)
      this.normalizeSeriesOrdinals(seriesId)
      this.bumpGraphRevision(projectId)
      return this.getEpisode(next.id) ?? next
    })
    return updated
  }

  updateEpisodeContinuityArtifacts(
    episodeId: string,
    patch: { previousSummaryArtifactId?: string | undefined; nextHookArtifactId?: string | undefined },
  ): Episode {
    const episode = this.getEpisode(episodeId)
    if (!episode) throw new Error('EPISODE_NOT_FOUND')
    return this.saveEpisode({
      ...episode,
      ...(patch.previousSummaryArtifactId ? { previousSummaryArtifactId: patch.previousSummaryArtifactId } : {}),
      ...(patch.nextHookArtifactId ? { nextHookArtifactId: patch.nextHookArtifactId } : {}),
      revision: episode.revision + 1,
      updatedAt: new Date().toISOString(),
    })
  }

  getEpisodeContext(episodeId: string): EpisodeContext {
    const episode = this.getEpisode(episodeId)
    if (!episode) throw new Error('EPISODE_NOT_FOUND')
    const project = this.getProject(episode.projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')
    const siblings = episode.seriesId ? this.listEpisodes(episode.seriesId) : [episode]
    const index = siblings.findIndex((item) => item.id === episode.id)
    return EpisodeContextSchema.parse({
      project, episode,
      ...(episode.seriesId ? { series: this.getSeries(episode.seriesId) } : {}),
      ...(index > 0 ? { previousEpisode: siblings[index - 1] } : {}),
      ...(index >= 0 && index < siblings.length - 1 ? { nextEpisode: siblings[index + 1] } : {}),
      resolvedAssets: this.resolveAssets(project.id),
    })
  }

  createSharedAsset(input: {
    scope: 'global' | 'series'; seriesId?: string | undefined; logicalId?: string | undefined; type: SharedAsset['type']; name: string;
    description?: string | undefined; metadata?: Record<string, unknown> | undefined; forkedFromAssetId?: string | undefined;
  }): SharedAsset {
    if (input.scope === 'series' && (!input.seriesId || !this.getSeries(input.seriesId))) throw new Error('SERIES_NOT_FOUND')
    const timestamp = new Date().toISOString()
    const asset = SharedAssetSchema.parse({
      id: randomUUID(), logicalId: input.logicalId ?? randomUUID(), scope: input.scope,
      ...(input.seriesId ? { seriesId: input.seriesId } : {}), type: input.type, name: input.name,
      description: input.description ?? '', metadata: parseAssetMetadata(input.type, input.metadata), revision: 1,
      ...(input.forkedFromAssetId ? { forkedFromAssetId: input.forkedFromAssetId } : {}),
      archived: false, createdAt: timestamp, updatedAt: timestamp,
    })
    this.raw.prepare('INSERT INTO shared_assets(id,logical_id,scope,series_id,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(asset.id, asset.logicalId, asset.scope, asset.seriesId ?? null, JSON.stringify(asset), asset.createdAt, asset.updatedAt)
    return asset
  }

  private saveSharedAsset(asset: SharedAsset): SharedAsset {
    const parsed = SharedAssetSchema.parse(asset)
    const result = this.raw.prepare('UPDATE shared_assets SET logical_id = ?, scope = ?, series_id = ?, payload = ?, updated_at = ? WHERE id = ?')
      .run(parsed.logicalId, parsed.scope, parsed.seriesId ?? null, JSON.stringify(parsed), parsed.updatedAt, parsed.id)
    if (result.changes !== 1) throw new Error('ASSET_NOT_FOUND')
    return parsed
  }

  private projectIdsForSharedAsset(asset: SharedAsset): string[] {
    if (asset.scope === 'series' && asset.seriesId) return this.listEpisodes(asset.seriesId).map((episode) => episode.projectId)
    return this.listProjects().map((project) => project.id)
  }

  reviseSharedAsset(assetId: string, patch: { name?: string | undefined; description?: string | undefined; metadata?: Record<string, unknown> | undefined; selectedVariantId?: string | undefined }): SharedAsset {
    const current = this.getSharedAsset(assetId)
    if (!current) throw new Error('ASSET_NOT_FOUND')
    if (patch.selectedVariantId) {
      const variant = this.getSharedAssetVariant(patch.selectedVariantId)
      if (!variant || variant.sharedAssetId !== assetId) throw new Error('ASSET_VARIANT_NOT_FOUND')
    }
    return this.transaction(() => {
      const updated = this.saveSharedAsset({
        ...current,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.metadata === undefined ? {} : { metadata: parseAssetMetadata(current.type, patch.metadata) }),
        ...(patch.selectedVariantId === undefined ? {} : { selectedVariantId: patch.selectedVariantId }),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      })
      const rows = this.raw.prepare("SELECT payload FROM asset_bindings WHERE asset_kind = 'shared' AND asset_id = ?").all(assetId) as PayloadRow[]
      const touchedProjects = new Set<string>(this.projectIdsForSharedAsset(current))
      for (const row of rows) {
        const binding = AssetBindingSchema.parse(JSON.parse(row.payload))
        this.putAssetBinding({ ...binding, drifted: true, updatedAt: new Date().toISOString() })
        const shot = this.get<Shot>('shots', binding.shotId)
        if (shot) {
          this.put('shots', binding.projectId, {
            ...shot,
            staleFields: [...new Set([...shot.staleFields, ...staleFieldsForAssetSlot(binding.slot)])],
            revision: shot.revision + 1,
            updatedAt: new Date().toISOString(),
          })
        }
        touchedProjects.add(binding.projectId)
      }
      for (const projectId of touchedProjects) this.bumpGraphRevision(projectId)
      return updated
    })
  }

  getSharedAsset(id: string): SharedAsset | undefined {
    const row = this.raw.prepare('SELECT payload FROM shared_assets WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? SharedAssetSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listSharedAssets(scope?: 'global' | 'series', seriesId?: string): SharedAsset[] {
    let rows: PayloadRow[]
    if (scope === 'series') rows = this.raw.prepare('SELECT payload FROM shared_assets WHERE scope = ? AND series_id = ? ORDER BY created_at ASC').all(scope, seriesId ?? '') as PayloadRow[]
    else if (scope === 'global') rows = this.raw.prepare('SELECT payload FROM shared_assets WHERE scope = ? ORDER BY created_at ASC').all(scope) as PayloadRow[]
    else rows = this.raw.prepare('SELECT payload FROM shared_assets ORDER BY created_at ASC').all() as PayloadRow[]
    return rows.map((row) => SharedAssetSchema.parse(JSON.parse(row.payload)))
  }

  createSharedAssetVariant(sharedAssetId: string, input: {
    label: string; prompt?: string | undefined; metadata?: Record<string, unknown> | undefined; mediaSnapshot?: SharedAssetVariant['mediaSnapshot'] | undefined;
    forkedFromVariantId?: string | undefined; favorite?: boolean | undefined;
  }): SharedAssetVariant {
    const asset = this.getSharedAsset(sharedAssetId)
    if (!asset) throw new Error('ASSET_NOT_FOUND')
    const revisionRow = this.raw.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM shared_asset_variants WHERE shared_asset_id = ?').get(sharedAssetId) as { revision: number }
    const variant = SharedAssetVariantSchema.parse({
      id: randomUUID(), sharedAssetId, revision: revisionRow.revision + 1, label: input.label,
      prompt: input.prompt ?? '', metadata: input.metadata ?? {},
      ...(input.mediaSnapshot ? { mediaSnapshot: input.mediaSnapshot } : {}),
      ...(input.forkedFromVariantId ? { forkedFromVariantId: input.forkedFromVariantId } : {}),
      favorite: input.favorite ?? false, archived: false, createdAt: new Date().toISOString(),
    })
    this.transaction(() => {
      this.raw.prepare('INSERT INTO shared_asset_variants(id,shared_asset_id,revision,payload,created_at) VALUES (?,?,?,?,?)')
        .run(variant.id, variant.sharedAssetId, variant.revision, JSON.stringify(variant), variant.createdAt)
      if (!asset.selectedVariantId) {
        this.saveSharedAsset({ ...asset, selectedVariantId: variant.id, updatedAt: new Date().toISOString() })
        for (const projectId of this.projectIdsForSharedAsset(asset)) this.bumpGraphRevision(projectId)
      }
    })
    return variant
  }

  getSharedAssetVariant(id: string): SharedAssetVariant | undefined {
    const row = this.raw.prepare('SELECT payload FROM shared_asset_variants WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? SharedAssetVariantSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listSharedAssetVariants(sharedAssetId: string): SharedAssetVariant[] {
    const rows = this.raw.prepare('SELECT payload FROM shared_asset_variants WHERE shared_asset_id = ? ORDER BY revision ASC').all(sharedAssetId) as PayloadRow[]
    return rows.map((row) => SharedAssetVariantSchema.parse(JSON.parse(row.payload)))
  }

  putSharedMediaReference(rawReference: SharedMediaReference): SharedMediaReference {
    const reference = SharedMediaReferenceSchema.parse(rawReference)
    this.raw.prepare(`INSERT INTO shared_media_references(id,payload,created_at,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(reference.id, JSON.stringify(reference), reference.createdAt, new Date().toISOString())
    return reference
  }

  getSharedMediaReference(id: string): SharedMediaReference | undefined {
    const row = this.raw.prepare('SELECT payload FROM shared_media_references WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? SharedMediaReferenceSchema.parse(JSON.parse(row.payload)) : undefined
  }

  importSharedMediaReference(rawReference: SharedMediaReference): SharedMediaReference {
    const reference = SharedMediaReferenceSchema.parse(rawReference)
    this.raw.prepare('INSERT INTO shared_media_references(id,payload,created_at,updated_at) VALUES (?,?,?,?)')
      .run(reference.id, JSON.stringify(reference), reference.createdAt, reference.createdAt)
    return reference
  }

  createPromptRevision(rawRevision: PromptRevision): PromptRevision {
    const revision = PromptRevisionSchema.parse(rawRevision)
    const scopeKey = revision.projectId ?? 'global'
    this.raw.prepare(`INSERT INTO prompt_revisions(id,scope_key,project_id,stable_key,revision,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(revision.id, scopeKey, revision.projectId ?? null, revision.stableKey, revision.revision, JSON.stringify(revision), revision.createdAt, revision.updatedAt)
    return revision
  }

  getPromptRevision(id: string): PromptRevision | undefined {
    const row = this.raw.prepare('SELECT payload FROM prompt_revisions WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? PromptRevisionSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listPromptRevisions(stableKey?: string, projectId?: string): PromptRevision[] {
    const scopeKey = projectId ?? 'global'
    const rows = stableKey
      ? this.raw.prepare('SELECT payload FROM prompt_revisions WHERE scope_key = ? AND stable_key = ? ORDER BY revision DESC').all(scopeKey, stableKey) as PayloadRow[]
      : this.raw.prepare('SELECT payload FROM prompt_revisions WHERE scope_key = ? ORDER BY stable_key, revision DESC').all(scopeKey) as PayloadRow[]
    return rows.map((row) => PromptRevisionSchema.parse(JSON.parse(row.payload)))
  }

  getArtifactHead(scope: ArtifactHead['scope'], artifactType: string): ArtifactHead | undefined {
    const row = this.raw.prepare('SELECT payload FROM artifact_heads WHERE scope_type = ? AND scope_id = ? AND artifact_type = ?')
      .get(scope.type, scope.id, artifactType) as PayloadRow | undefined
    return row ? ArtifactHeadSchema.parse(JSON.parse(row.payload)) : undefined
  }

  putArtifactHead(rawHead: ArtifactHead, expectedCurrentRevision?: number): ArtifactHead {
    const head = ArtifactHeadSchema.parse(rawHead)
    const current = this.getArtifactHead(head.scope, head.artifactType)
    if (expectedCurrentRevision !== undefined && (current?.expectedRevision ?? 0) !== expectedCurrentRevision) throw new Error('ARTIFACT_HEAD_CONFLICT')
    this.raw.prepare(`INSERT INTO artifact_heads(scope_type,scope_id,artifact_type,payload,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(scope_type,scope_id,artifact_type) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(head.scope.type, head.scope.id, head.artifactType, JSON.stringify(head), head.updatedAt)
    return head
  }

  createSkillPackageVersion(rawVersion: SkillPackageVersion): SkillPackageVersion {
    const version = SkillPackageVersionSchema.parse(rawVersion)
    const scopeKey = version.projectId ?? 'global'
    this.raw.prepare(`INSERT INTO skill_package_versions(id,scope_key,project_id,stable_key,version,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(version.id, scopeKey, version.projectId ?? null, version.stableKey, version.version, JSON.stringify(version), version.createdAt, version.updatedAt)
    return version
  }

  getSkillPackageVersion(id: string): SkillPackageVersion | undefined {
    const row = this.raw.prepare('SELECT payload FROM skill_package_versions WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? SkillPackageVersionSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listSkillPackageVersions(stableKey?: string, projectId?: string): SkillPackageVersion[] {
    const scopeKey = projectId ?? 'global'
    const rows = stableKey
      ? this.raw.prepare('SELECT payload FROM skill_package_versions WHERE scope_key = ? AND stable_key = ? ORDER BY created_at DESC').all(scopeKey, stableKey) as PayloadRow[]
      : this.raw.prepare('SELECT payload FROM skill_package_versions WHERE scope_key = ? ORDER BY stable_key, created_at DESC').all(scopeKey) as PayloadRow[]
    return rows.map((row) => SkillPackageVersionSchema.parse(JSON.parse(row.payload)))
  }

  putGoldenEvaluation(rawEvaluation: GoldenEvaluation): GoldenEvaluation {
    const evaluation = GoldenEvaluationSchema.parse(rawEvaluation)
    this.raw.prepare('INSERT INTO golden_evaluations(id,target_type,target_version_id,payload,created_at) VALUES (?,?,?,?,?)')
      .run(evaluation.id, evaluation.targetType, evaluation.targetVersionId, JSON.stringify(evaluation), evaluation.createdAt)
    return evaluation
  }

  listGoldenEvaluations(targetType: GoldenEvaluation['targetType'], targetVersionId: string): GoldenEvaluation[] {
    const rows = this.raw.prepare('SELECT payload FROM golden_evaluations WHERE target_type = ? AND target_version_id = ? ORDER BY created_at DESC')
      .all(targetType, targetVersionId) as PayloadRow[]
    return rows.map((row) => GoldenEvaluationSchema.parse(JSON.parse(row.payload)))
  }

  importSharedAsset(rawAsset: SharedAsset, rawVariants: SharedAssetVariant[]): SharedAsset {
    const asset = SharedAssetSchema.parse(rawAsset)
    const variants = rawVariants.map((variant) => SharedAssetVariantSchema.parse(variant))
    if (variants.some((variant) => variant.sharedAssetId !== asset.id)) throw new Error('ASSET_VARIANT_NOT_FOUND')
    return this.transaction(() => {
      this.raw.prepare('INSERT INTO shared_assets(id,logical_id,scope,series_id,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(asset.id, asset.logicalId, asset.scope, asset.seriesId ?? null, JSON.stringify(asset), asset.createdAt, asset.updatedAt)
      for (const variant of variants) {
        this.raw.prepare('INSERT INTO shared_asset_variants(id,shared_asset_id,revision,payload,created_at) VALUES (?,?,?,?,?)')
          .run(variant.id, variant.sharedAssetId, variant.revision, JSON.stringify(variant), variant.createdAt)
      }
      return asset
    })
  }

  resolveAssets(projectId: string): ResolvedAsset[] {
    const episode = this.getEpisodeByProject(projectId)
    if (!episode) throw new Error('EPISODE_NOT_FOUND')
    const resolved = new Map<string, ResolvedAsset>()
    const bindings = this.listAssetBindings(projectId)
    const shared = [...this.listSharedAssets('global'), ...(episode.seriesId ? this.listSharedAssets('series', episode.seriesId) : [])]
    for (const asset of shared) {
      if (asset.archived || !asset.selectedVariantId) continue
      const variant = this.getSharedAssetVariant(asset.selectedVariantId)
      if (!variant || variant.archived) continue
      const source = asset.scope === 'series' ? 'series' : 'global'
      resolved.set(asset.logicalId, ResolvedAssetSchema.parse({
        logicalId: asset.logicalId, source, sourceId: asset.seriesId ?? this.workspaceId(), assetKind: 'shared',
        assetId: asset.id, variantId: variant.id, revision: asset.revision, type: asset.type, name: asset.name,
        drifted: bindings.some((binding) => binding.assetId === asset.id && binding.drifted),
      }))
    }
    const localAssets = this.list<AssetUnit>('assets', projectId)
    for (const asset of localAssets) {
      if (asset.archived || !asset.selectedVariantId) continue
      const variant = this.get<AssetVariant>('asset_variants', asset.selectedVariantId)
      if (!variant || variant.archived) continue
      const logicalId = asset.logicalId ?? asset.id
      resolved.set(logicalId, ResolvedAssetSchema.parse({
        logicalId, source: 'episode', sourceId: episode.id, assetKind: 'local', assetId: asset.id,
        variantId: variant.id, revision: asset.revision, type: asset.type, name: asset.name,
        drifted: bindings.some((binding) => binding.assetId === asset.id && binding.drifted),
      }))
    }
    return [...resolved.values()]
  }

  forkSharedAsset(projectId: string, sharedAssetId: string, sharedVariantId: string, media?: MediaReference): { asset: AssetUnit; variant: AssetVariant } {
    const episode = this.getEpisodeByProject(projectId)
    const source = this.getSharedAsset(sharedAssetId)
    const sourceVariant = this.getSharedAssetVariant(sharedVariantId)
    if (!episode) throw new Error('EPISODE_NOT_FOUND')
    if (!source || !sourceVariant || sourceVariant.sharedAssetId !== source.id) throw new Error('ASSET_VARIANT_NOT_FOUND')
    const timestamp = new Date().toISOString()
    const assetId = randomUUID()
    const variantId = randomUUID()
    const asset = AssetUnitSchema.parse({
      id: assetId, projectId, logicalId: source.logicalId, type: source.type, scope: 'episode', name: source.name,
      description: source.description, metadata: { ...source.metadata, sourceScope: source.scope }, selectedVariantId: variantId,
      revision: 1, forkedFromAssetId: source.id, archived: false, createdAt: timestamp, updatedAt: timestamp,
    })
    const variant = AssetVariantSchema.parse({
      id: variantId, assetId, revision: 1, label: sourceVariant.label, prompt: sourceVariant.prompt,
      metadata: { ...sourceVariant.metadata, sharedMediaSnapshot: sourceVariant.mediaSnapshot },
      ...(media ? { mediaId: media.id } : {}),
      forkedFromVariantId: sourceVariant.id, favorite: sourceVariant.favorite, archived: false, createdAt: timestamp,
    })
    this.transaction(() => {
      if (media) {
        if (media.projectId !== projectId) throw new Error('ASSET_MEDIA_PROJECT_MISMATCH')
        this.put('media_references', projectId, media)
      }
      this.put('assets', projectId, asset)
      this.put('asset_variants', projectId, variant)
      this.bumpGraphRevision(projectId)
    })
    return { asset, variant }
  }

  promoteLocalAsset(projectId: string, assetId: string, variantId: string, target: {
    scope: 'global' | 'series'; seriesId?: string; mediaSnapshot?: SharedAssetVariant['mediaSnapshot'];
  }): { asset: SharedAsset; variant: SharedAssetVariant } {
    const local = this.get<AssetUnit>('assets', assetId)
    const localVariant = this.get<AssetVariant>('asset_variants', variantId)
    if (!local || local.projectId !== projectId) throw new Error('ASSET_NOT_FOUND')
    if (!localVariant || localVariant.assetId !== local.id) throw new Error('ASSET_VARIANT_NOT_FOUND')
    return this.transaction(() => {
      const asset = this.createSharedAsset({
        ...target, logicalId: local.logicalId ?? local.id, type: local.type, name: local.name,
        description: local.description, metadata: local.metadata, forkedFromAssetId: local.id,
      })
      const variant = this.createSharedAssetVariant(asset.id, {
        label: localVariant.label, prompt: localVariant.prompt, metadata: localVariant.metadata,
        ...(target.mediaSnapshot ? { mediaSnapshot: target.mediaSnapshot } : {}),
        forkedFromVariantId: localVariant.id, favorite: localVariant.favorite,
      })
      return { asset: this.getSharedAsset(asset.id) ?? asset, variant }
    })
  }

  putAssetBinding(rawBinding: AssetBinding): AssetBinding {
    const binding = AssetBindingSchema.parse(rawBinding)
    if (!this.getProject(binding.projectId)) throw new Error('PROJECT_NOT_FOUND')
    const shot = this.get<Shot>('shots', binding.shotId)
    if (!shot || shot.projectId !== binding.projectId) throw new Error('SHOT_NOT_FOUND')
    if (binding.assetKind === 'shared') {
      const asset = this.getSharedAsset(binding.assetId)
      const variant = this.getSharedAssetVariant(binding.variantId)
      if (!asset || !variant || variant.sharedAssetId !== asset.id) throw new Error('ASSET_VARIANT_NOT_FOUND')
    } else {
      const asset = this.get<AssetUnit>('assets', binding.assetId)
      const variant = this.get<AssetVariant>('asset_variants', binding.variantId)
      if (!asset || !variant || asset.projectId !== binding.projectId || variant.assetId !== asset.id) throw new Error('ASSET_VARIANT_NOT_FOUND')
    }
    this.transaction(() => {
      this.raw.prepare(`INSERT INTO asset_bindings(id,project_id,shot_id,asset_kind,asset_id,variant_id,asset_revision,payload,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET shot_id=excluded.shot_id,asset_kind=excluded.asset_kind,asset_id=excluded.asset_id,variant_id=excluded.variant_id,asset_revision=excluded.asset_revision,payload=excluded.payload,updated_at=excluded.updated_at`)
        .run(binding.id, binding.projectId, binding.shotId, binding.assetKind, binding.assetId, binding.variantId, binding.assetRevision, JSON.stringify(binding), binding.createdAt, binding.updatedAt)
      this.raw.prepare(`INSERT INTO asset_reference_index(id,project_id,asset_kind,asset_id,variant_id,reference_type,reference_id,payload,created_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET asset_kind=excluded.asset_kind,asset_id=excluded.asset_id,variant_id=excluded.variant_id,reference_id=excluded.reference_id,payload=excluded.payload`)
        .run(`binding:${binding.id}`, binding.projectId, binding.assetKind, binding.assetId, binding.variantId, 'shot_binding', binding.shotId, JSON.stringify({ bindingId: binding.id, slot: binding.slot }), binding.updatedAt)
    })
    return binding
  }

  listAssetBindings(projectId: string): AssetBinding[] {
    const rows = this.raw.prepare('SELECT payload FROM asset_bindings WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as PayloadRow[]
    return rows.map((row) => AssetBindingSchema.parse(JSON.parse(row.payload)))
  }

  getAssetBinding(id: string): AssetBinding | undefined {
    const row = this.raw.prepare('SELECT payload FROM asset_bindings WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? AssetBindingSchema.parse(JSON.parse(row.payload)) : undefined
  }

  saveReconcileOperation<T>(input: {
    id: string; episodeId: string; projectId: string; status: 'preview' | 'applied' | 'expired' | 'failed'; payload: T;
  }): void {
    const timestamp = new Date().toISOString()
    this.raw.prepare(`INSERT INTO reconcile_operations(id,episode_id,project_id,status,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(input.id, input.episodeId, input.projectId, input.status, JSON.stringify(input.payload), timestamp, timestamp)
  }

  getReconcileOperation<T>(id: string): { episodeId: string; projectId: string; status: string; payload: T } | undefined {
    const row = this.raw.prepare('SELECT episode_id,project_id,status,payload FROM reconcile_operations WHERE id = ?').get(id) as { episode_id: string; project_id: string; status: string; payload: string } | undefined
    return row ? { episodeId: row.episode_id, projectId: row.project_id, status: row.status, payload: JSON.parse(row.payload) as T } : undefined
  }

  private refreshDerivedAssetReferences(assetId: string): void {
    const variantIds = this.listSharedAssetVariants(assetId).map((variant) => variant.id)
    const identifiers = new Set([assetId, ...variantIds])
    const containsIdentifier = (value: unknown): boolean => {
      if (typeof value === 'string') return identifiers.has(value)
      if (Array.isArray(value)) return value.some(containsIdentifier)
      if (value && typeof value === 'object') return Object.values(value).some(containsIdentifier)
      return false
    }
    this.raw.prepare("DELETE FROM asset_reference_index WHERE asset_id = ? AND reference_type <> 'shot_binding'").run(assetId)
    const insert = this.raw.prepare(`INSERT INTO asset_reference_index(id,project_id,asset_kind,asset_id,variant_id,reference_type,reference_id,payload,created_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at`)
    const timestamp = new Date().toISOString()
    for (const table of ['generation_tasks', 'candidates'] as const) {
      const rows = this.raw.prepare(`SELECT id,project_id,payload FROM ${table}`).all() as Array<{ id: string; project_id: string; payload: string }>
      for (const row of rows) {
        const payload = JSON.parse(row.payload) as unknown
        if (!containsIdentifier(payload)) continue
        const referenceType = table === 'generation_tasks' ? 'task' : 'candidate'
        insert.run(`${referenceType}:${assetId}:${row.id}`, row.project_id, 'shared', assetId, null, referenceType, row.id, '{}', timestamp)
      }
    }
    const shotRows = this.raw.prepare('SELECT id,project_id,payload FROM shots').all() as Array<{ id: string; project_id: string; payload: string }>
    for (const row of shotRows) {
      const shot = ShotSchema.parse(JSON.parse(row.payload))
      for (const frame of shot.boundaryFrames) {
        if (!containsIdentifier(frame)) continue
        insert.run(`boundary:${assetId}:${frame.id}`, row.project_id, 'shared', assetId, null, 'boundary_frame', frame.id, JSON.stringify({ shotId: row.id }), timestamp)
      }
    }
  }

  assetImpact(assetId: string): AssetImpact {
    if (this.getSharedAsset(assetId)) this.refreshDerivedAssetReferences(assetId)
    const rows = this.raw.prepare('SELECT reference_type,reference_id,payload FROM asset_reference_index WHERE asset_id = ? ORDER BY created_at ASC').all(assetId) as Array<{ reference_type: string; reference_id: string; payload: string }>
    const bindingIds = rows.map((row) => JSON.parse(row.payload) as { bindingId?: string }).flatMap((payload) => payload.bindingId ? [payload.bindingId] : [])
    const byType = (type: string): string[] => [...new Set(rows.filter((row) => row.reference_type === type).map((row) => row.reference_id))]
    return AssetImpactSchema.parse({
      assetId, bindingIds: [...new Set(bindingIds)], shotIds: byType('shot_binding'), taskIds: byType('task'),
      candidateIds: byType('candidate'), boundaryFrameIds: byType('boundary_frame'), canDelete: rows.length === 0,
    })
  }

  deleteSharedAsset(assetId: string): boolean {
    const impact = this.assetImpact(assetId)
    if (!impact.canDelete) throw new Error('ASSET_REFERENCED')
    const asset = this.getSharedAsset(assetId)
    if (!asset) return false
    return this.transaction(() => {
      const sharedMediaIds = this.listSharedAssetVariants(assetId)
        .flatMap((variant) => variant.mediaSnapshot ? [variant.mediaSnapshot.sharedMediaId] : [])
      this.raw.prepare('DELETE FROM shared_asset_variants WHERE shared_asset_id = ?').run(assetId)
      for (const mediaId of sharedMediaIds) this.raw.prepare('DELETE FROM shared_media_references WHERE id = ?').run(mediaId)
      const deleted = this.raw.prepare('DELETE FROM shared_assets WHERE id = ?').run(assetId).changes === 1
      if (deleted) for (const projectId of this.projectIdsForSharedAsset(asset)) this.bumpGraphRevision(projectId)
      return deleted
    })
  }

  listProjects(): Project[] {
    const rows = this.raw.prepare("SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC").all() as ProjectRow[]
    return rows.map((row) => this.mapProject(row))
  }

  getProject(id: string): Project | undefined {
    const row = this.raw.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
    return row ? this.mapProject(row) : undefined
  }

  private mapProject(row: ProjectRow): Project {
    return ProjectSchema.parse({
      id: row.id, name: row.name, description: row.description, status: row.status,
      graphRevision: row.graph_revision, createdAt: row.created_at, updatedAt: row.updated_at,
    })
  }

  bumpGraphRevision(projectId: string): number {
    const timestamp = new Date().toISOString()
    const result = this.raw.prepare('UPDATE projects SET graph_revision = graph_revision + 1, updated_at = ? WHERE id = ?').run(timestamp, projectId)
    if (result.changes !== 1) throw new Error('PROJECT_NOT_FOUND')
    return this.getProject(projectId)?.graphRevision ?? 0
  }

  put<T extends { id: string; createdAt?: string; updatedAt?: string }>(table: EntityTable, projectId: string, entity: T): T {
    if (!entityTables.includes(table)) throw new Error('ENTITY_TABLE_INVALID')
    const timestamp = new Date().toISOString()
    const createdAt = entity.createdAt ?? timestamp
    const updatedAt = entity.updatedAt ?? timestamp
    this.raw.prepare(`INSERT INTO ${table}(id,project_id,payload,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(entity.id, projectId, JSON.stringify(entity), createdAt, updatedAt)
    return entity
  }

  putMany<T extends { id: string; createdAt?: string; updatedAt?: string }>(table: EntityTable, projectId: string, entities: T[]): void {
    const save = this.raw.transaction(() => { entities.forEach((entity) => this.put(table, projectId, entity)) })
    save()
  }

  get<T>(table: EntityTable, id: string): T | undefined {
    if (!entityTables.includes(table)) throw new Error('ENTITY_TABLE_INVALID')
    const row = this.raw.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(id) as EntityRow | undefined
    return row ? JSON.parse(row.payload) as T : undefined
  }

  list<T>(table: EntityTable, projectId: string): T[] {
    if (!entityTables.includes(table)) throw new Error('ENTITY_TABLE_INVALID')
    const rows = this.raw.prepare(`SELECT payload FROM ${table} WHERE project_id = ? ORDER BY created_at ASC`).all(projectId) as EntityRow[]
    return rows.map((row) => JSON.parse(row.payload) as T)
  }

  remove(table: EntityTable, id: string): boolean {
    if (!entityTables.includes(table)) throw new Error('ENTITY_TABLE_INVALID')
    return this.raw.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes === 1
  }

  putMemoryRecord(rawRecord: MemoryRecord): MemoryRecord {
    const record = MemoryRecordSchema.parse(rawRecord)
    this.raw.prepare(`INSERT INTO memory_documents(
      id,scope,scope_id,origin_project_id,source_type,source_key,source_revision,content_hash,payload,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      scope=excluded.scope,scope_id=excluded.scope_id,origin_project_id=excluded.origin_project_id,
      source_type=excluded.source_type,source_key=excluded.source_key,source_revision=excluded.source_revision,
      content_hash=excluded.content_hash,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(record.id, record.scope, record.scopeId, record.originProjectId ?? null, record.sourceType, record.sourceKey,
        record.sourceRevision, record.contentHash, JSON.stringify(record), record.createdAt, record.updatedAt)
    return record
  }

  getMemoryRecord(id: string): MemoryRecord | undefined {
    const row = this.raw.prepare('SELECT payload FROM memory_documents WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? MemoryRecordSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listMemoryRecords(scopes?: ReadonlyArray<{ scope: MemoryRecord['scope']; scopeId: string }>): MemoryRecord[] {
    if (scopes?.length === 0) return []
    const rows = scopes
      ? scopes.flatMap(({ scope, scopeId }) => this.raw.prepare('SELECT payload FROM memory_documents WHERE scope = ? AND scope_id = ? ORDER BY updated_at DESC').all(scope, scopeId) as PayloadRow[])
      : this.raw.prepare('SELECT payload FROM memory_documents ORDER BY updated_at DESC').all() as PayloadRow[]
    return rows.map((row) => MemoryRecordSchema.parse(JSON.parse(row.payload)))
  }

  replaceMemoryChunks(memoryId: string, rawChunks: MemoryChunk[]): MemoryChunk[] {
    const chunks = rawChunks.map((chunk) => MemoryChunkSchema.parse(chunk))
    if (chunks.some((chunk) => chunk.memoryId !== memoryId)) throw new Error('MEMORY_CHUNK_PARENT_MISMATCH')
    this.raw.prepare('DELETE FROM memory_chunks WHERE memory_id = ?').run(memoryId)
    const insert = this.raw.prepare('INSERT INTO memory_chunks(id,memory_id,ordinal,content_hash,payload,created_at) VALUES (?,?,?,?,?,?)')
    for (const chunk of chunks) insert.run(chunk.id, chunk.memoryId, chunk.ordinal, chunk.contentHash, JSON.stringify(chunk), chunk.createdAt)
    return chunks
  }

  listMemoryChunks(memoryId: string): MemoryChunk[] {
    const rows = this.raw.prepare('SELECT payload FROM memory_chunks WHERE memory_id = ? ORDER BY ordinal ASC').all(memoryId) as PayloadRow[]
    return rows.map((row) => MemoryChunkSchema.parse(JSON.parse(row.payload)))
  }

  deleteMemoryRecord(id: string): boolean {
    return this.raw.prepare('DELETE FROM memory_documents WHERE id = ?').run(id).changes === 1
  }

  putProviderConnection(rawConnection: ProviderConnection, expectedRevision: number): ProviderConnection {
    const connection = ProviderConnectionSchema.parse(rawConnection)
    const existing = this.getProviderConnection(connection.id)
    if (existing && existing.protocol !== connection.protocol) throw new Error('PROVIDER_CONNECTION_PROTOCOL_IMMUTABLE')
    if (existing ? existing.revision !== expectedRevision : expectedRevision !== 0) throw new Error('PROVIDER_CONNECTION_REVISION_CONFLICT')
    this.raw.prepare(`INSERT INTO provider_connections(id,protocol,state,revision,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      state=excluded.state,revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(connection.id, connection.protocol, connection.state, connection.revision, JSON.stringify(connection), connection.createdAt, connection.updatedAt)
    return connection
  }

  getProviderConnection(id: string): ProviderConnection | undefined {
    const row = this.raw.prepare('SELECT payload FROM provider_connections WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? ProviderConnectionSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listProviderConnections(): ProviderConnection[] {
    const rows = this.raw.prepare('SELECT payload FROM provider_connections ORDER BY updated_at DESC, id ASC').all() as PayloadRow[]
    return rows.map((row) => ProviderConnectionSchema.parse(JSON.parse(row.payload)))
  }

  putProviderRoutePolicy(rawPolicy: ProviderRoutePolicy, expectedRevision: number): ProviderRoutePolicy {
    const policy = ProviderRoutePolicySchema.parse(rawPolicy)
    const existing = this.getProviderRoutePolicy(policy.projectId)
    if (existing ? existing.revision !== expectedRevision : expectedRevision !== 0) throw new Error('PROVIDER_ROUTE_REVISION_CONFLICT')
    this.raw.prepare(`INSERT INTO provider_route_policies(project_id,revision,payload,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
      revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(policy.projectId, policy.revision, JSON.stringify(policy), policy.updatedAt)
    return policy
  }

  getProviderRoutePolicy(projectId: string): ProviderRoutePolicy | undefined {
    const row = this.raw.prepare('SELECT payload FROM provider_route_policies WHERE project_id = ?').get(projectId) as PayloadRow | undefined
    return row ? ProviderRoutePolicySchema.parse(JSON.parse(row.payload)) : undefined
  }

  appendProviderCost(rawEntry: ProviderCostLedgerEntry): ProviderCostLedgerEntry {
    const entry = ProviderCostLedgerEntrySchema.parse(rawEntry)
    const existing = this.raw.prepare('SELECT payload FROM provider_cost_ledger WHERE id = ?').get(entry.id) as PayloadRow | undefined
    if (existing) {
      const parsed = ProviderCostLedgerEntrySchema.parse(JSON.parse(existing.payload))
      if (JSON.stringify(parsed) !== JSON.stringify(entry)) throw new Error('PROVIDER_COST_ENTRY_IMMUTABLE')
      return parsed
    }
    this.raw.prepare(`INSERT INTO provider_cost_ledger(id,project_id,task_id,connection_id,amount_micros,currency,payload,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      entry.id, entry.projectId, entry.taskId, entry.connectionId, entry.amountMicros, entry.currency, JSON.stringify(entry), entry.createdAt,
    )
    return entry
  }

  listProviderCosts(projectId: string): ProviderCostLedgerEntry[] {
    const rows = this.raw.prepare('SELECT payload FROM provider_cost_ledger WHERE project_id = ? ORDER BY created_at DESC, id DESC').all(projectId) as PayloadRow[]
    return rows.map((row) => ProviderCostLedgerEntrySchema.parse(JSON.parse(row.payload)))
  }

  putAgentRunCheckpoint(rawCheckpoint: AgentRunCheckpoint): AgentRunCheckpoint {
    const checkpoint = AgentRunCheckpointSchema.parse(rawCheckpoint)
    const existing = this.getAgentRunCheckpoint(checkpoint.runId) ?? this.getAgentRunCheckpointByPlan(checkpoint.planId)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(checkpoint)) throw new Error('AGENT_CHECKPOINT_IMMUTABLE')
      return existing
    }
    this.raw.prepare(`INSERT INTO agent_run_checkpoints(
      id,project_id,run_id,plan_id,graph_revision,memory_context_hash,payload,created_at
    ) VALUES (?,?,?,?,?,?,?,?)`).run(
      checkpoint.id, checkpoint.projectId, checkpoint.runId, checkpoint.planId, checkpoint.graphRevision,
      checkpoint.memoryContextHash, JSON.stringify(checkpoint), checkpoint.createdAt,
    )
    return checkpoint
  }

  getAgentRunCheckpoint(runId: string): AgentRunCheckpoint | undefined {
    const row = this.raw.prepare('SELECT payload FROM agent_run_checkpoints WHERE run_id = ?').get(runId) as PayloadRow | undefined
    return row ? AgentRunCheckpointSchema.parse(JSON.parse(row.payload)) : undefined
  }

  getAgentRunCheckpointByPlan(planId: string): AgentRunCheckpoint | undefined {
    const row = this.raw.prepare('SELECT payload FROM agent_run_checkpoints WHERE plan_id = ?').get(planId) as PayloadRow | undefined
    return row ? AgentRunCheckpointSchema.parse(JSON.parse(row.payload)) : undefined
  }

  putProviderPlugin(rawRecord: ProviderPluginRecord, expectedRevision: number): ProviderPluginRecord {
    const record = ProviderPluginRecordSchema.parse(rawRecord)
    const existing = this.getProviderPlugin(record.id)
    if (existing && (existing.pluginId !== record.pluginId || existing.version !== record.version)) throw new Error('PROVIDER_PLUGIN_IDENTITY_IMMUTABLE')
    if (existing ? existing.revision !== expectedRevision : expectedRevision !== 0) throw new Error('PROVIDER_PLUGIN_REVISION_CONFLICT')
    this.raw.prepare(`INSERT INTO provider_plugin_versions(id,plugin_id,version,state,revision,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      state=excluded.state,revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(record.id, record.pluginId, record.version, record.state, record.revision, JSON.stringify(record), record.installedAt, record.updatedAt)
    return record
  }

  getProviderPlugin(id: string): ProviderPluginRecord | undefined {
    const row = this.raw.prepare('SELECT payload FROM provider_plugin_versions WHERE id = ?').get(id) as PayloadRow | undefined
    return row ? ProviderPluginRecordSchema.parse(JSON.parse(row.payload)) : undefined
  }

  getProviderPluginVersion(pluginId: string, version: string): ProviderPluginRecord | undefined {
    const row = this.raw.prepare('SELECT payload FROM provider_plugin_versions WHERE plugin_id = ? AND version = ?').get(pluginId, version) as PayloadRow | undefined
    return row ? ProviderPluginRecordSchema.parse(JSON.parse(row.payload)) : undefined
  }

  listProviderPlugins(): ProviderPluginRecord[] {
    const rows = this.raw.prepare('SELECT payload FROM provider_plugin_versions ORDER BY updated_at DESC').all() as PayloadRow[]
    return rows.map((row) => ProviderPluginRecordSchema.parse(JSON.parse(row.payload)))
  }

  putProviderPublisher(rawRecord: ProviderPublisherTrust, publicKeyPem: string, expectedRevision: number): ProviderPublisherTrust {
    const record = ProviderPublisherTrustSchema.parse(rawRecord)
    const existing = this.getProviderPublisher(record.id)
    if (existing && existing.record.keyId !== record.keyId) throw new Error('PROVIDER_PUBLISHER_IDENTITY_IMMUTABLE')
    if (existing ? existing.record.revision !== expectedRevision : expectedRevision !== 0) throw new Error('PROVIDER_PUBLISHER_REVISION_CONFLICT')
    this.raw.prepare(`INSERT INTO provider_publishers(id,key_id,state,revision,public_key_pem,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      state=excluded.state,revision=excluded.revision,public_key_pem=excluded.public_key_pem,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(record.id, record.keyId, record.state, record.revision, publicKeyPem, JSON.stringify(record), record.createdAt, record.updatedAt)
    return record
  }

  getProviderPublisher(id: string): { record: ProviderPublisherTrust; publicKeyPem: string } | undefined {
    const row = this.raw.prepare('SELECT payload,public_key_pem FROM provider_publishers WHERE id = ?').get(id) as ProviderPublisherRow | undefined
    return row ? { record: ProviderPublisherTrustSchema.parse(JSON.parse(row.payload)), publicKeyPem: row.public_key_pem } : undefined
  }

  getProviderPublisherByKeyId(keyId: string): { record: ProviderPublisherTrust; publicKeyPem: string } | undefined {
    const row = this.raw.prepare('SELECT payload,public_key_pem FROM provider_publishers WHERE key_id = ?').get(keyId) as ProviderPublisherRow | undefined
    return row ? { record: ProviderPublisherTrustSchema.parse(JSON.parse(row.payload)), publicKeyPem: row.public_key_pem } : undefined
  }

  listProviderPublishers(): ProviderPublisherTrust[] {
    const rows = this.raw.prepare('SELECT payload FROM provider_publishers ORDER BY updated_at DESC').all() as PayloadRow[]
    return rows.map((row) => ProviderPublisherTrustSchema.parse(JSON.parse(row.payload)))
  }

  trustedProviderPublisherKeys(): Record<string, string> {
    const rows = this.raw.prepare("SELECT key_id,public_key_pem FROM provider_publishers WHERE state = 'trusted'").all() as Array<{ key_id: string; public_key_pem: string }>
    return Object.fromEntries(rows.map((row) => [row.key_id, row.public_key_pem]))
  }

  importSnapshot(rawSnapshot: ProjectSnapshot): ProjectSnapshot {
    const snapshot = ProjectSnapshotSchema.parse(rawSnapshot)
    if (this.getProject(snapshot.project.id)) throw new Error('PROJECT_IMPORT_ID_CONFLICT')
    this.transaction(() => {
      const project = snapshot.project
      this.raw.prepare('INSERT INTO projects(id,name,description,status,graph_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(project.id, project.name, project.description, project.status, project.graphRevision, project.createdAt, project.updatedAt)
      this.insertEpisode(snapshot.episode
        ? EpisodeSchema.parse({ ...snapshot.episode, projectId: project.id })
        : this.createStandaloneEpisode(project))
      const collections: ReadonlyArray<readonly [EntityTable, ReadonlyArray<{ id: string }>]> = [
        ['source_documents', snapshot.sources], ['chapters', snapshot.chapters], ['story_events', snapshot.events],
        ['story_event_edges', snapshot.eventEdges], ['scenes', snapshot.scenes], ['shots', snapshot.shots],
        ['assets', snapshot.assets], ['asset_variants', snapshot.variants], ['media_references', snapshot.media],
        ['candidates', snapshot.candidates], ['generation_tasks', snapshot.tasks], ['execution_plans', snapshot.plans],
        ['prompt_runs', snapshot.promptRuns], ['task_attempts', snapshot.attempts],
        ['provider_receipts', snapshot.providerReceipts], ['review_decisions', snapshot.reviews],
        ['artifact_versions', snapshot.artifactVersions],
        ['candidate_batches', snapshot.candidateBatches], ['provider_media_receipts', snapshot.providerMediaReceipts],
      ]
      for (const [table, entities] of collections) {
        for (const entity of entities) this.put(table, project.id, entity)
      }
      for (const binding of snapshot.assetBindings) this.putAssetBinding({ ...binding, projectId: project.id })
    })
    return snapshot
  }

  deleteProject(projectId: string): boolean {
    return this.raw.prepare('DELETE FROM projects WHERE id = ?').run(projectId).changes === 1
  }

  getIdempotent<T>(key: string): T | undefined {
    const row = this.raw.prepare('SELECT response_json AS payload FROM idempotency_records WHERE key = ?').get(key) as EntityRow | undefined
    return row ? JSON.parse(row.payload) as T : undefined
  }

  saveIdempotent<T>(projectId: string, key: string, operation: string, response: T): void {
    this.raw.prepare('INSERT OR IGNORE INTO idempotency_records(key,project_id,operation,response_json,created_at) VALUES (?,?,?,?,?)')
      .run(key, projectId, operation, JSON.stringify(response), new Date().toISOString())
  }

  getLayout(projectId: string, view: 'story' | 'production' | 'delivery'): Record<string, { x: number; y: number }> {
    const row = this.raw.prepare('SELECT positions_json AS payload FROM graph_layouts WHERE project_id = ? AND view = ?').get(projectId, view) as EntityRow | undefined
    return row ? JSON.parse(row.payload) as Record<string, { x: number; y: number }> : {}
  }

  saveLayout(projectId: string, view: 'story' | 'production' | 'delivery', positions: Record<string, { x: number; y: number }>): void {
    this.raw.prepare('INSERT INTO graph_layouts(project_id,view,positions_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id,view) DO UPDATE SET positions_json=excluded.positions_json,updated_at=excluded.updated_at')
      .run(projectId, view, JSON.stringify(positions), new Date().toISOString())
  }

  snapshot(projectId: string): ProjectSnapshot {
    const project = this.getProject(projectId)
    if (!project) throw new Error('PROJECT_NOT_FOUND')
    return ProjectSnapshotSchema.parse({
      project,
      episode: this.getEpisodeByProject(projectId),
      series: this.getEpisodeByProject(projectId)?.seriesId ? this.getSeries(this.getEpisodeByProject(projectId)!.seriesId!) : undefined,
      sources: this.list<SourceDocument>('source_documents', projectId),
      chapters: this.list<Chapter>('chapters', projectId),
      events: this.list<StoryEvent>('story_events', projectId),
      eventEdges: this.list<StoryEventEdge>('story_event_edges', projectId),
      scenes: this.list<Scene>('scenes', projectId).sort((a, b) => a.ordinal - b.ordinal),
      shots: this.list<Shot>('shots', projectId).sort((a, b) => a.ordinal - b.ordinal),
      assets: this.list<AssetUnit>('assets', projectId),
      variants: this.list<AssetVariant>('asset_variants', projectId),
      assetBindings: this.listAssetBindings(projectId),
      resolvedAssets: this.resolveAssets(projectId),
      media: this.list('media_references', projectId),
      candidates: this.list<Candidate>('candidates', projectId),
      candidateBatches: this.list<CandidateBatch>('candidate_batches', projectId),
      providerMediaReceipts: this.list<ProviderMediaReceipt>('provider_media_receipts', projectId),
      tasks: this.list<GenerationTask>('generation_tasks', projectId),
      plans: this.list<ExecutionPlan>('execution_plans', projectId),
      promptRuns: this.list<PromptRun>('prompt_runs', projectId),
      attempts: this.list<TaskAttempt>('task_attempts', projectId),
      providerReceipts: this.list<ProviderReceiptRecord>('provider_receipts', projectId),
      reviews: this.list<ReviewDecision>('review_decisions', projectId),
      artifactVersions: this.list<ArtifactVersion>('artifact_versions', projectId),
    })
  }
}
