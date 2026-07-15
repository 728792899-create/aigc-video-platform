const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');

function runDriver(driver, dbPath) {
  return spawnSync(process.execPath, ['-e', `
    (async () => {
      const store = require('./dist/db');
      await store.initDb();
      const db = store.getDb();
      const project = db.prepare('INSERT INTO projects (name, theme) VALUES (?, ?)').run('driver-project', 'parity');
      const projectId = Number(project.lastInsertRowid);
      db.prepare('INSERT INTO storyboards (project_id, scene_number, description) VALUES (?, ?, ?)')
        .run(projectId, 1, 'first shot');
      store.saveDb();

      const snapshot = store.exportRaw();
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run('mutated', projectId);
      store.restoreRaw(snapshot);

      const restoredDb = store.getDb();
      const restored = restoredDb.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
      restoredDb.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      const children = restoredDb.prepare('SELECT COUNT(*) AS count FROM storyboards WHERE project_id = ?').get(projectId);
      store.saveDb();
      console.log('RESULT:' + JSON.stringify({
        driver: store.getDatabaseDriver(),
        restored: restored?.name,
        childCount: Number(children?.count || 0),
        snapshotBytes: snapshot.length,
      }));
    })().catch((error) => {
      console.error(error.code || error.message);
      process.exit(2);
    });
  `], {
    cwd: SERVER_ROOT,
    env: { ...process.env, DB_PATH: dbPath, DB_DRIVER: driver },
    encoding: 'utf8',
  });
}

for (const driver of ['better-sqlite3', 'sqljs']) {
  test(`${driver} 保持读写、外键、原始备份和热恢复语义一致`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aigc-${driver}-`));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const dbPath = path.join(dir, 'database.sqlite');
    const child = runDriver(driver, dbPath);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(child.stdout.split('RESULT:').pop().trim());
    assert.equal(result.driver, driver);
    assert.equal(result.restored, 'driver-project');
    assert.equal(result.childCount, 0);
    assert.ok(result.snapshotBytes > 1_000);
    assert.ok(fs.statSync(dbPath).size > 1_000);
    assert.equal(fs.existsSync(`${dbPath}.restore.tmp`), false);
  });
}
