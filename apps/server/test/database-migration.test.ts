import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DirectorDatabase, LATEST_SCHEMA_VERSION } from '../src/db/database.js'
import { DatabaseRuntime } from '../src/runtimeModules.js'

describe('数据库 schema v12 迁移', () => {
  it('从 v1 顺序幂等增加运行证据、Series、Episode 与共享资产表', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-migration-'))
    const path = join(directory, 'director.sqlite')
    const legacy = new DatabaseRuntime(path)
    legacy.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version','1');")
    legacy.close()

    const migrated = new DirectorDatabase(path)
    expect(migrated.schemaVersion()).toBe(LATEST_SCHEMA_VERSION)
    const tables = migrated.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      'prompt_runs', 'task_attempts', 'provider_receipts', 'artifact_versions', 'review_decisions',
      'series', 'episodes', 'shared_assets', 'shared_asset_variants', 'shared_media_references',
      'asset_bindings', 'asset_reference_index', 'reconcile_operations',
      'prompt_revisions', 'artifact_heads', 'skill_package_versions', 'golden_evaluations',
      'candidate_batches', 'provider_media_receipts',
      'memory_documents', 'memory_chunks',
      'provider_plugin_versions', 'provider_publishers', 'agent_run_checkpoints', 'project_generation_policies',
      'security_audit_events', 'provider_connections', 'provider_route_policies', 'provider_cost_ledger',
    ]))
    migrated.close()

    const repeated = new DirectorDatabase(path)
    expect(repeated.schemaVersion()).toBe(LATEST_SCHEMA_VERSION)
    repeated.close()
  })

  it('从 v2 为已有 Project 建立 standalone Episode，重复打开不重复创建', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-v2-episode-'))
    const path = join(directory, 'director.sqlite')
    const legacy = new DatabaseRuntime(path)
    legacy.exec(`
      CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT INTO schema_meta VALUES ('schema_version','2');
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL, graph_revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `)
    const projectId = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    legacy.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?)').run(projectId, '旧项目', '', 'active', 0, timestamp, timestamp)
    legacy.close()

    const migrated = new DirectorDatabase(path)
    const episode = migrated.getEpisodeByProject(projectId)
    expect(episode).toMatchObject({ projectId, title: '旧项目', ordinal: 0, revision: 1 })
    expect(episode?.seriesId).toBeUndefined()
    await expect(access(`${path}.schema-v2.restore.sqlite`)).resolves.toBeUndefined()
    migrated.close()

    const repeated = new DirectorDatabase(path)
    expect(repeated.listEpisodes().filter((item) => item.projectId === projectId)).toHaveLength(1)
    expect(repeated.schemaVersion()).toBe(12)
    repeated.close()
  })

  it('从 v7 事务增加可撤销发布者信任表并保留 restore point', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-v7-publisher-'))
    const path = join(directory, 'director.sqlite')
    const legacy = new DatabaseRuntime(path)
    legacy.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version','7');")
    legacy.close()

    const migrated = new DirectorDatabase(path)
    expect(migrated.schemaVersion()).toBe(12)
    const publisherTable = migrated.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_publishers'").get()
    expect(publisherTable).toEqual({ name: 'provider_publishers' })
    await expect(access(`${path}.schema-v7.restore.sqlite`)).resolves.toBeUndefined()
    migrated.close()
  })

  it('从 v8 事务增加 Agent 记忆 checkpoint 并保留 restore point', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-v8-agent-checkpoint-'))
    const path = join(directory, 'director.sqlite')
    const legacy = new DatabaseRuntime(path)
    legacy.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version','8');")
    legacy.close()

    const migrated = new DirectorDatabase(path)
    expect(migrated.schemaVersion()).toBe(12)
    const checkpointTable = migrated.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_run_checkpoints'").get()
    expect(checkpointTable).toEqual({ name: 'agent_run_checkpoints' })
    await expect(access(`${path}.schema-v8.restore.sqlite`)).resolves.toBeUndefined()
    migrated.close()
  })

  it('从 v9 事务增加项目生成策略表并保留 restore point', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-v9-generation-policy-'))
    const path = join(directory, 'director.sqlite')
    const legacy = new DatabaseRuntime(path)
    legacy.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version','9');")
    legacy.close()

    const migrated = new DirectorDatabase(path)
    expect(migrated.schemaVersion()).toBe(12)
    const policyTable = migrated.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_generation_policies'").get()
    expect(policyTable).toEqual({ name: 'project_generation_policies' })
    await expect(access(`${path}.schema-v9.restore.sqlite`)).resolves.toBeUndefined()
    migrated.close()
  })

  it('从 v10 追加不可变安全审计事件表并保留 restore point', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-v10-security-audit-'))
    const path = join(directory, 'director.sqlite')
    const legacy = new DatabaseRuntime(path)
    legacy.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version','10');")
    legacy.close()

    const migrated = new DirectorDatabase(path)
    expect(migrated.schemaVersion()).toBe(12)
    const auditTable = migrated.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='security_audit_events'").get()
    expect(auditTable).toEqual({ name: 'security_audit_events' })
    await expect(access(`${path}.schema-v10.restore.sqlite`)).resolves.toBeUndefined()
    migrated.close()
  })

  it('从 v11 事务增加 Provider 连接、路由和成本账本并保留 restore point', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-v11-provider-routing-'))
    const path = join(directory, 'director.sqlite')
    const legacy = new DatabaseRuntime(path)
    legacy.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version','11');")
    legacy.close()

    const migrated = new DirectorDatabase(path)
    expect(migrated.schemaVersion()).toBe(12)
    const tables = migrated.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('provider_connections','provider_route_policies','provider_cost_ledger') ORDER BY name").all()
    expect(tables).toEqual([{ name: 'provider_connections' }, { name: 'provider_cost_ledger' }, { name: 'provider_route_policies' }])
    await expect(access(`${path}.schema-v11.restore.sqlite`)).resolves.toBeUndefined()
    migrated.close()
  })

  it('未来版本在创建产品表前安全拒绝', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-director-future-schema-'))
    const path = join(directory, 'director.sqlite')
    const future = new DatabaseRuntime(path)
    future.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version','99');")
    future.close()

    expect(() => new DirectorDatabase(path)).toThrow('UNSUPPORTED_SCHEMA_VERSION:99')
    const reopened = new DatabaseRuntime(path)
    const names = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    expect(names.map((table) => table.name)).not.toContain('projects')
    reopened.close()
  })
})
