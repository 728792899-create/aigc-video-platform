const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const initSqlJs = require('sql.js');

const SERVER_ROOT = path.resolve(__dirname, '..');

async function writeDatabase(file, version) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  db.run('CREATE TABLE storyboards (id INTEGER PRIMARY KEY, project_id INTEGER)');
  db.run('CREATE TABLE tasks (id TEXT PRIMARY KEY, type TEXT, status TEXT, progress INTEGER, message TEXT, meta TEXT, result TEXT, error TEXT, created_at INTEGER, updated_at INTEGER)');
  db.run("INSERT INTO projects (id, name) VALUES (1, 'legacy-project')");
  db.run(`PRAGMA user_version = ${version}`);
  fs.writeFileSync(file, Buffer.from(db.export()));
  db.close();
}

async function writeLegacyV5Database(file) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  db.run('CREATE TABLE storyboards (id INTEGER PRIMARY KEY, project_id INTEGER, selected_image_id INTEGER)');
  db.run(`CREATE TABLE images (
    id INTEGER PRIMARY KEY, storyboard_id INTEGER NOT NULL, prompt TEXT, file_path TEXT, file_url TEXT,
    submit_id TEXT, gen_status TEXT, width INTEGER, height INTEGER, stale INTEGER DEFAULT 0,
    stale_reason TEXT, created_at INTEGER
  )`);
  db.run(`CREATE TABLE characters (
    id INTEGER PRIMARY KEY, series_id INTEGER, project_id INTEGER, name TEXT, deleted_at INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER
  )`);
  db.run(`CREATE TABLE character_assets (
    id INTEGER PRIMARY KEY, character_id INTEGER NOT NULL, project_id INTEGER, image_id INTEGER,
    file_url TEXT, file_path TEXT, kind TEXT, label TEXT, created_at INTEGER
  )`);
  db.run("INSERT INTO projects (id, name) VALUES (1, 'legacy-v5')");
  db.run('INSERT INTO storyboards (id, project_id, selected_image_id) VALUES (11, 1, 21)');
  db.run("INSERT INTO images (id, storyboard_id, prompt, file_path, file_url, gen_status, created_at) VALUES (21, 11, 'legacy prompt', '/uploads/images/legacy.png', '/uploads/images/legacy.png?token=must-strip', 'success', 1000)");
  db.run("INSERT INTO characters (id, series_id, project_id, name, created_at) VALUES (31, 1, 1, 'legacy character', 1000)");
  db.run("INSERT INTO character_assets (id, character_id, project_id, image_id, file_url, file_path, kind, label, created_at) VALUES (41, 31, 1, 21, '/uploads/images/legacy.png?token=must-strip', '/uploads/images/legacy.png', 'reference', 'v1', 1000)");
  db.run("INSERT INTO character_assets (id, character_id, project_id, image_id, file_url, file_path, kind, label, created_at) VALUES (42, 31, 1, 21, '/uploads/images/legacy.png', '/uploads/images/legacy.png', 'reference', 'v2', 2000)");
  db.run('PRAGMA user_version = 5');
  fs.writeFileSync(file, Buffer.from(db.export()));
  db.close();
}

function runInit(dbPath) {
  return spawnSync(process.execPath, ['-e', `
    (async () => {
      // 迁移以生产编译产物为验收对象，避免 Node 绕过 TypeScript 构建边界。
      const store = require('./dist/db');
      await store.initDb();
      const db = store.getDb();
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const recordTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_records'").get();
      const artifactTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stage_artifacts'").get();
      const bindingTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='storyboard_asset_bindings'").get();
      const assetUnitTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='asset_units'").get();
      const assetVariantTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='asset_variants'").get();
      const studioStateTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_view_states'").get();
      const promptRevisionTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_revisions'").get();
      const storyboardRevisionTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='storyboard_field_revisions'").get();
      const imageColumns = db.prepare('PRAGMA table_info(images)').all().map((row) => row.name);
      const storyboardColumns = db.prepare('PRAGMA table_info(storyboards)').all().map((row) => row.name);
      const artifactColumns = db.prepare('PRAGMA table_info(stage_artifacts)').all().map((row) => row.name);
      const bindingColumns = db.prepare('PRAGMA table_info(storyboard_asset_bindings)').all().map((row) => row.name);
      const assetUnitColumns = db.prepare('PRAGMA table_info(asset_units)').all().map((row) => row.name);
      const variantColumns = db.prepare('PRAGMA table_info(character_assets)').all().map((row) => row.name);
      const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map((row) => row.name);
      const legacyVariants = db.prepare('SELECT id, variant_key, revision, selected, media_reference FROM character_assets ORDER BY id').all();
      const genericUnits = db.prepare('SELECT id, asset_type, legacy_entity_id, scope, selected_variant_id FROM asset_units ORDER BY id').all();
      const genericVariants = db.prepare('SELECT id, asset_unit_id, revision, selected, media_reference FROM asset_variants ORDER BY revision').all();
      const legacyCandidate = db.prepare('SELECT id, media_reference, selected_at FROM images ORDER BY id LIMIT 1').get();
      const project = db.prepare('SELECT name FROM projects WHERE id = 1').get();
      store.saveDb();
      console.log('RESULT:' + JSON.stringify({ version, recordTable: recordTable?.name, artifactTable: artifactTable?.name,
        bindingTable: bindingTable?.name, assetUnitTable: assetUnitTable?.name, assetVariantTable: assetVariantTable?.name,
        studioStateTable: studioStateTable?.name, promptRevisionTable: promptRevisionTable?.name,
        storyboardRevisionTable: storyboardRevisionTable?.name,
        imageColumns, storyboardColumns, artifactColumns, bindingColumns, assetUnitColumns,
        variantColumns, taskColumns, legacyVariants, legacyCandidate, genericUnits, genericVariants,
        project: project?.name }));
    })().catch((error) => {
      console.error(error.code || error.message);
      process.exit(2);
    });
  `], {
    cwd: SERVER_ROOT,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8',
  });
}

test('schema v3 可幂等升级到 v9，并在迁移前保留原数据备份', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-db-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'database.sqlite');
  await writeDatabase(file, 3);

  const first = runInit(file);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const result = JSON.parse(first.stdout.split('RESULT:').pop().trim());
  assert.equal(result.version, 9);
  assert.equal(result.recordTable, 'idempotency_records');
  assert.equal(result.artifactTable, 'stage_artifacts');
  assert.equal(result.bindingTable, 'storyboard_asset_bindings');
  assert.equal(result.assetUnitTable, 'asset_units');
  assert.equal(result.assetVariantTable, 'asset_variants');
  assert.equal(result.studioStateTable, 'project_view_states');
  assert.equal(result.promptRevisionTable, 'prompt_revisions');
  assert.equal(result.storyboardRevisionTable, 'storyboard_field_revisions');
  assert.equal(result.project, 'legacy-project');
  assert.ok(result.imageColumns.includes('media_reference'));
  assert.ok(result.imageColumns.includes('favorite'));
  for (const column of ['stale_fields', 'stale_sources']) assert.ok(result.imageColumns.includes(column));
  for (const column of ['stale_fields', 'stale_sources']) assert.ok(result.storyboardColumns.includes(column));
  for (const column of ['stale_fields', 'stale_sources']) assert.ok(result.artifactColumns.includes(column));
  for (const column of ['stale_fields', 'stale_sources']) assert.ok(result.bindingColumns.includes(column));
  for (const column of ['forked_from_unit_id', 'forked_from_variant_id']) assert.ok(result.assetUnitColumns.includes(column));
  assert.ok(result.variantColumns.includes('variant_key'));
  assert.ok(result.variantColumns.includes('revision'));
  for (const column of ['provider', 'model', 'provider_task_id', 'attempt', 'parent_task_id', 'idempotency_key',
    'started_at', 'finished_at', 'timeout_at', 'retryable', 'cancel_state', 'input_snapshot', 'media_snapshot', 'correlation_id']) {
    assert.ok(result.taskColumns.includes(column), `tasks 缺少 ${column}`);
  }
  const backups = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^database-v3-\d+\.sqlite$/);

  const second = runInit(file);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1, '重复初始化不应重复迁移或备份');
});

test('遇到未来 schema 时安全拒绝，且不改写原数据库', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-db-future-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'database.sqlite');
  await writeDatabase(file, 99);
  const before = fs.readFileSync(file);

  const result = runInit(file);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /DB_SCHEMA_TOO_NEW/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('schema v5 角色参考图幂等升级为通用 AssetUnit/Variant，不泄漏 URL 查询参数', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-db-v6-assets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'database.sqlite');
  await writeLegacyV5Database(file);

  const first = runInit(file);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const result = JSON.parse(first.stdout.split('RESULT:').pop().trim());
  assert.equal(result.version, 9);
  assert.deepEqual(result.legacyVariants.map((row) => row.revision), [1, 2]);
  assert.deepEqual(result.legacyVariants.map((row) => row.selected), [0, 1], '最新旧参考图成为默认 Variant');
  assert.match(result.legacyVariants[0].variant_key, /^legacy-character-31-asset-41$/);
  assert.equal(JSON.parse(result.legacyVariants[0].media_reference).url, '/uploads/images/legacy.png');
  assert.equal(JSON.parse(result.legacyCandidate.media_reference).url, '/uploads/images/legacy.png');
  assert.ok(result.legacyCandidate.selected_at > 0, '已选候选应回填 selected_at');
  assert.deepEqual(result.genericUnits, [{
    id: 'legacy-character-31',
    asset_type: 'character',
    legacy_entity_id: 31,
    scope: 'episode',
    selected_variant_id: 'legacy-character-31-asset-42',
  }]);
  assert.deepEqual(result.genericVariants.map((row) => ({ id: row.id, revision: row.revision, selected: row.selected })), [
    { id: 'legacy-character-31-asset-41', revision: 1, selected: 0 },
    { id: 'legacy-character-31-asset-42', revision: 2, selected: 1 },
  ]);
  assert.equal(JSON.parse(result.genericVariants[0].media_reference).url, '/uploads/images/legacy.png');

  const second = runInit(file);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const repeated = JSON.parse(second.stdout.split('RESULT:').pop().trim());
  assert.deepEqual(repeated.legacyVariants, result.legacyVariants, '重复初始化不应改变 revision 或引用');
  assert.deepEqual(repeated.legacyCandidate, result.legacyCandidate);
  assert.deepEqual(repeated.genericUnits, result.genericUnits);
  assert.deepEqual(repeated.genericVariants, result.genericVariants);
});
