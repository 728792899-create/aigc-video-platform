'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStageArtifactService,
} = require('../services/stageArtifacts');

function memoryRepository() {
  const rows = [];
  return {
    rows,
    list(projectId) {
      return rows.filter((row) => row.project_id === projectId)
        .sort((a, b) => a.stage.localeCompare(b.stage) || b.revision - a.revision);
    },
    latest(projectId, stage) {
      return rows.filter((row) => row.project_id === projectId && row.stage === stage)
        .sort((a, b) => b.revision - a.revision)[0] || null;
    },
    insert(row) { rows.push({ ...row }); return row; },
    updateStatus(id, status, staleReason, updatedAt) {
      const row = rows.find((item) => item.id === id);
      row.status = status;
      row.stale_reason = staleReason || '';
      row.updated_at = updatedAt;
    },
    transaction(fn) { return fn(); },
  };
}

test('相同阶段输入幂等复用 revision，上游变化只标记下游 stale 并保留历史', () => {
  const repository = memoryRepository();
  let tick = 1000;
  const service = createStageArtifactService({ repository, now: () => ++tick, idFactory: () => `artifact-${tick}` });

  const scriptV1 = service.publish({ projectId: 7, stage: 'script', payload: { title: 'v1' }, inputHash: 'script-v1' });
  const same = service.publish({ projectId: 7, stage: 'script', payload: { title: 'v1' }, inputHash: 'script-v1' });
  assert.equal(same.id, scriptV1.id);
  assert.equal(same.revision, 1);

  const storyboard = service.publish({
    projectId: 7,
    stage: 'storyboard',
    payload: { ids: [11] },
    dependencySnapshot: { script: { artifact_id: scriptV1.id, revision: 1, input_hash: 'script-v1' } },
  });
  const image = service.publish({
    projectId: 7,
    stage: 'image',
    payload: { candidate_ids: [21] },
    dependencySnapshot: { storyboard: { artifact_id: storyboard.id, revision: 1 } },
  });

  const scriptV2 = service.publish({ projectId: 7, stage: 'script', payload: { title: 'v2' }, inputHash: 'script-v2' });
  assert.equal(scriptV2.revision, 2);
  assert.equal(service.latest(7, 'script').status, 'current');
  assert.equal(service.get(scriptV1.id).status, 'superseded');
  assert.equal(service.get(storyboard.id).status, 'stale');
  assert.equal(service.get(image.id).status, 'stale');
  assert.match(service.get(image.id).stale_reason, /script/);
  assert.equal(service.list(7).length, 4, '所有历史 revision 都必须保留');
});

test('只污染下游阶段，不把上游或同阶段新 revision 标记 stale', () => {
  const service = createStageArtifactService({ repository: memoryRepository(), now: () => Date.now() });
  const script = service.publish({ projectId: 9, stage: 'script', payload: { ok: true } });
  service.publish({ projectId: 9, stage: 'storyboard', payload: { version: 1 } });
  const storyboardV2 = service.publish({ projectId: 9, stage: 'storyboard', payload: { version: 2 } });
  assert.equal(service.get(script.id).status, 'current');
  assert.equal(storyboardV2.status, 'current');
  assert.equal(service.list(9).filter((row) => row.stage === 'storyboard' && row.status === 'superseded').length, 1);
});
