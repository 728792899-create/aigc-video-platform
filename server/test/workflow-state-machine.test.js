const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STAGES,
  createWorkflow,
  transition,
  canResume,
  nextRunnableStage,
} = require('../services/workflowStateMachine');

test('工作流固定覆盖主题到导出的八个可恢复阶段', () => {
  const workflow = createWorkflow({ projectId: 42 });
  assert.deepEqual(STAGES, [
    'topic', 'script', 'storyboard', 'image',
    'voice', 'subtitle', 'timeline', 'export',
  ]);
  assert.equal(workflow.version, 1);
  assert.equal(workflow.project_id, 42);
  assert.equal(workflow.stages.topic.status, 'succeeded');
  assert.equal(workflow.stages.script.status, 'ready');
  assert.equal(nextRunnableStage(workflow), 'script');
});

test('阶段支持保存、失败、重试、部分成功、取消并保持已完成检查点', () => {
  let workflow = createWorkflow({ projectId: 7, topic: '离线演示' });
  workflow = transition(workflow, { type: 'START', stage: 'script' });
  workflow = transition(workflow, {
    type: 'SUCCEED',
    stage: 'script',
    output: { title: '离线演示', storyboard_count: 3 },
  });
  workflow = transition(workflow, { type: 'START', stage: 'storyboard' });
  workflow = transition(workflow, {
    type: 'PARTIAL',
    stage: 'storyboard',
    output: { completed: 2, failed: 1 },
    error: '第 3 镜格式异常',
  });

  assert.equal(workflow.stages.script.status, 'succeeded');
  assert.equal(workflow.stages.storyboard.status, 'partial');
  assert.equal(canResume(workflow), true);
  assert.equal(nextRunnableStage(workflow), 'storyboard');

  workflow = transition(workflow, { type: 'RETRY', stage: 'storyboard' });
  assert.equal(workflow.stages.storyboard.status, 'ready');
  assert.equal(workflow.stages.storyboard.attempts, 2);
  assert.deepEqual(workflow.stages.script.output, { title: '离线演示', storyboard_count: 3 });

  workflow = transition(workflow, { type: 'START', stage: 'storyboard' });
  workflow = transition(workflow, { type: 'CANCEL', stage: 'storyboard' });
  assert.equal(workflow.stages.storyboard.status, 'canceled');
  assert.equal(canResume(workflow), true);
});

test('非法越级会被拒绝，避免资产与任务状态不一致', () => {
  const workflow = createWorkflow({ projectId: 9 });
  assert.throws(
    () => transition(workflow, { type: 'START', stage: 'image' }),
    /前置阶段 storyboard 尚未完成/,
  );
});
