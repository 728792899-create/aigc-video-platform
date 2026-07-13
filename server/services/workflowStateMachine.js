'use strict';

const STAGES = Object.freeze([
  'topic',
  'script',
  'storyboard',
  'image',
  'voice',
  'subtitle',
  'timeline',
  'export',
]);

const TERMINAL = new Set(['succeeded', 'skipped', 'partial']);
const RESUMABLE = new Set(['ready', 'running', 'failed', 'partial', 'canceled']);

function now() {
  return Date.now();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stageRecord(status = 'pending') {
  return {
    status,
    attempts: 0,
    progress: status === 'succeeded' ? 100 : 0,
    output: null,
    error: null,
    started_at: null,
    completed_at: status === 'succeeded' ? now() : null,
    updated_at: now(),
  };
}

function createWorkflow({ projectId, topic = '', stages = STAGES } = {}) {
  const records = {};
  stages.forEach((stage, index) => {
    records[stage] = stageRecord(index === 0 ? 'succeeded' : index === 1 ? 'ready' : 'pending');
  });
  if (records.topic) records.topic.output = { topic };
  return {
    version: 1,
    project_id: Number(projectId) || null,
    current_stage: stages[1] || stages[0] || null,
    stages: records,
    created_at: now(),
    updated_at: now(),
  };
}

function normalizeWorkflow(input, options = {}) {
  const base = createWorkflow(options);
  if (!input || typeof input !== 'object') return base;
  const workflow = { ...base, ...clone(input), stages: { ...base.stages } };
  for (const stage of STAGES) {
    workflow.stages[stage] = { ...stageRecord(), ...(input.stages?.[stage] || {}) };
  }
  return workflow;
}

function previousStage(stage) {
  const index = STAGES.indexOf(stage);
  return index > 0 ? STAGES[index - 1] : null;
}

function assertStage(workflow, stage) {
  if (!STAGES.includes(stage) || !workflow.stages?.[stage]) {
    throw new Error(`未知工作流阶段 ${stage}`);
  }
}

function assertPrerequisite(workflow, stage) {
  const previous = previousStage(stage);
  if (!previous) return;
  const status = workflow.stages[previous]?.status;
  if (!TERMINAL.has(status)) {
    throw new Error(`前置阶段 ${previous} 尚未完成`);
  }
}

function makeReady(workflow, stage) {
  if (!stage || !workflow.stages[stage]) return;
  if (workflow.stages[stage].status === 'pending') {
    workflow.stages[stage].status = 'ready';
    workflow.stages[stage].updated_at = now();
  }
}

function transition(input, event) {
  const workflow = normalizeWorkflow(input, { projectId: input?.project_id });
  const stage = event?.stage;
  assertStage(workflow, stage);
  const record = workflow.stages[stage];
  const timestamp = now();

  switch (event.type) {
    case 'START':
      assertPrerequisite(workflow, stage);
      if (!RESUMABLE.has(record.status)) throw new Error(`阶段 ${stage} 当前不可启动：${record.status}`);
      record.status = 'running';
      record.attempts = record.attempts || 1;
      record.progress = Math.max(1, Number(event.progress) || 1);
      record.started_at = timestamp;
      record.error = null;
      break;
    case 'PROGRESS':
      if (record.status !== 'running') throw new Error(`阶段 ${stage} 未在运行`);
      record.progress = Math.max(0, Math.min(99, Math.round(Number(event.progress) || 0)));
      if (event.output !== undefined) record.output = clone(event.output);
      break;
    case 'SUCCEED':
    case 'SKIP': {
      if (!['running', 'ready', 'partial'].includes(record.status)) {
        throw new Error(`阶段 ${stage} 当前不可完成：${record.status}`);
      }
      record.status = event.type === 'SKIP' ? 'skipped' : 'succeeded';
      record.progress = 100;
      record.output = event.output === undefined ? record.output : clone(event.output);
      record.error = null;
      record.completed_at = timestamp;
      const next = STAGES[STAGES.indexOf(stage) + 1];
      makeReady(workflow, next);
      workflow.current_stage = next || stage;
      break;
    }
    case 'PARTIAL':
      record.status = 'partial';
      record.progress = Math.max(1, Math.min(99, Math.round(Number(event.progress) || record.progress || 1)));
      record.output = event.output === undefined ? record.output : clone(event.output);
      record.error = String(event.error || '阶段部分完成');
      record.completed_at = timestamp;
      makeReady(workflow, STAGES[STAGES.indexOf(stage) + 1]);
      workflow.current_stage = stage;
      break;
    case 'FAIL':
      record.status = 'failed';
      record.error = String(event.error || '阶段失败');
      record.completed_at = timestamp;
      workflow.current_stage = stage;
      break;
    case 'CANCEL':
      record.status = 'canceled';
      record.error = null;
      record.completed_at = timestamp;
      workflow.current_stage = stage;
      break;
    case 'RETRY':
      if (!['failed', 'partial', 'canceled'].includes(record.status)) {
        throw new Error(`阶段 ${stage} 当前不可重试：${record.status}`);
      }
      assertPrerequisite(workflow, stage);
      record.status = 'ready';
      record.attempts = (Number(record.attempts) || 0) + 1;
      record.progress = 0;
      record.error = null;
      record.completed_at = null;
      for (const downstream of STAGES.slice(STAGES.indexOf(stage) + 1)) {
        workflow.stages[downstream] = stageRecord('pending');
      }
      workflow.current_stage = stage;
      break;
    default:
      throw new Error(`未知工作流事件 ${event?.type}`);
  }

  record.updated_at = timestamp;
  workflow.updated_at = timestamp;
  return workflow;
}

function nextRunnableStage(input) {
  const workflow = normalizeWorkflow(input, { projectId: input?.project_id });
  return STAGES.find((stage) => RESUMABLE.has(workflow.stages[stage].status)) || null;
}

function canResume(workflow) {
  return Boolean(nextRunnableStage(workflow));
}

module.exports = {
  STAGES,
  createWorkflow,
  normalizeWorkflow,
  transition,
  nextRunnableStage,
  canResume,
};
