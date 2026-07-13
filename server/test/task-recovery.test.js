const test = require('node:test');
const assert = require('node:assert/strict');

const { recoverTasks } = require('../services/taskRecovery');

test('服务重启后可恢复任务重新排队，并保留阶段检查点', async () => {
  const task = {
    id: 'task-1',
    type: 'auto-produce',
    status: 'running',
    progress: 47,
    meta: {
      project_id: 5,
      recovery: { kind: 'auto-produce', attempts: 0, max_attempts: 3 },
      workflow: { current_stage: 'image', stages: { script: { status: 'succeeded' } } },
    },
  };
  const updates = [];
  const manager = {
    list: () => [task],
    update: (_id, patch) => { Object.assign(task, patch); updates.push(patch); return task; },
  };
  let resumed = null;
  const result = await recoverTasks({
    taskManager: manager,
    runners: {
      'auto-produce': async (restored) => { resumed = restored; },
    },
  });

  assert.equal(result.resumed, 1);
  assert.equal(task.status, 'waiting');
  assert.equal(task.meta.recovery.attempts, 1);
  assert.equal(task.meta.workflow.current_stage, 'image');
  assert.equal(resumed.id, 'task-1');
  assert.match(updates[0].message, /恢复/);
});

test('超过恢复上限的任务进入失败终态并给出诊断', async () => {
  const task = {
    id: 'task-2', type: 'auto-produce', status: 'running', progress: 20,
    meta: { recovery: { kind: 'auto-produce', attempts: 3, max_attempts: 3 } },
  };
  const manager = {
    list: () => [task],
    update: (_id, patch) => Object.assign(task, patch),
  };
  const result = await recoverTasks({ taskManager: manager, runners: {} });
  assert.equal(result.failed, 1);
  assert.equal(task.status, 'failed');
  assert.match(task.error, /恢复次数上限/);
});
