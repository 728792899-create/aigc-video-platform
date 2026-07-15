/**
 * 任务进度查询 + SSE 推送
 *
 * GET /api/tasks/:id          - 单个任务状态（轮询用）
 * GET /api/tasks/:id/stream   - SSE 流（实时推送）
 * GET /api/tasks?type=image   - 列表
 */
import express from 'express'
import type { TaskManager, TaskRecord } from '../services/taskManager'
import idempotency = require('../services/idempotency')
import { STAGES, transition } from '../services/workflowStateMachine'
import { asRecord, errorMessage, queryText } from './routeSupport'
const taskManager: TaskManager = require('../services/taskManager');
const router = express.Router();

const TERMINAL_STATUSES = new Set<TaskRecord['status']>([
  'success', 'failed', 'interrupted', 'orphaned', 'partial', 'canceled',
]);

// SSE 流端点：服务端推送任务进度
router.get('/:id/stream', (req, res) => {
  const { id } = req.params;
  const task = taskManager.get(id);

  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在' });
  }

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲
  res.flushHeaders();

  // 立刻发送当前状态
  const send = (t: TaskRecord) => {
    res.write(`data: ${JSON.stringify(t)}\n\n`);
  };
  send(task);

  // 终态直接关闭
  if (TERMINAL_STATUSES.has(task.status)) {
    res.end();
    return;
  }

  // 监听后续变化
  const listener = (t: TaskRecord) => {
    send(t);
    if (TERMINAL_STATUSES.has(t.status)) {
      taskManager.off(`change:${id}`, listener);
      clearInterval(heartbeat);
      res.end();
    }
  };
  taskManager.on(`change:${id}`, listener);

  // 心跳保活（防止代理超时）
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  // 客户端断开时清理
  req.on('close', () => {
    taskManager.off(`change:${id}`, listener);
    clearInterval(heartbeat);
  });
});

// 取消任务：排队中任务可直接取消；运行中一键成片会标记 cancel_requested
router.post('/:id/cancel', (req, res) => {
  const task = taskManager.get(req.params.id);
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在' });
  }
  if (task.type === 'auto-produce') {
    const queue = require('../services/autoProduceQueue');
    const result = queue.cancel(task.id);
    if (result.ok) {
      return res.json({
        code: 200,
        data: taskManager.get(task.id),
        message: result.queued ? '已取消排队任务' : '已请求取消，将在当前分镜结束后停止',
      });
    }
  }
  if (task.type === 'image-batch' && !TERMINAL_STATUSES.has(task.status)) {
    taskManager.update(task.id, { meta: { ...(task.meta || {}), cancel_requested: true } });
    return res.json({ code: 200, data: taskManager.get(task.id), message: '已请求取消批量生图' });
  }
  if (task.status === 'waiting' || task.status === 'pending') {
    taskManager.cancel(task.id);
    return res.json({ code: 200, data: taskManager.get(task.id), message: '已取消任务' });
  }
  res.status(400).json({ code: 400, message: '当前任务阶段暂不支持立即取消' });
});

// 只重试失败项：当前支持项目级批量生图任务。
router.post('/:id/retry-failed', idempotency(), (req, res) => {
  const prev = taskManager.get(req.params.id || '');
  if (!prev) return res.status(404).json({ code: 404, message: '任务不存在' });
  if (prev.type !== 'image-batch') {
    return res.status(400).json({ code: 400, message: '当前任务不支持只重试失败项' });
  }
  const result = asRecord(prev.result);
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const failedIds = failures.map((failure) => Number(asRecord(failure).storyboard_id)).filter(Boolean);
  const projectId = Number(prev.meta?.project_id || result.project_id);
  if (!projectId || failedIds.length === 0) {
    return res.status(400).json({ code: 400, message: '没有可重试的失败分镜' });
  }
  const payload = {
    ...(prev.meta?.payload || {}),
    ...(req.body || {}),
    mode: 'failed',
    failed_storyboard_ids: failedIds,
  };
  const task = taskManager.create('image-batch', {
    project_id: projectId,
    mode: 'failed',
    retry_of: prev.id,
    payload,
    target_storyboard_ids: failedIds,
    target_count: failedIds.length,
    attempt: Math.max(1, Number(prev.meta?.attempt) || 1) + 1,
    idempotency_key: req.idempotency?.key || null,
    input_hash: req.idempotency?.requestHash || null,
    demo_mode: ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase()),
    recovery: {
      kind: 'image-batch',
      mode: ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase()) ? 'safe-auto' : 'manual-reconcile',
      attempts: 0,
      max_attempts: 3,
    },
  });
  res.json({
    code: 200,
    data: { project_id: projectId, task_id: task.id, target_count: failedIds.length },
    message: '已开始重试失败分镜',
  });
  require('../services/workbench').runProjectImageBatch(task.id, projectId, payload)
    .catch((err: unknown) => {
      console.error('[image-batch retry] 启动失败:', err);
      try { taskManager.fail(task.id, err); } catch (_) {}
    });
});

// 单阶段重试：保留此前成功检查点，只把目标阶段及其下游置回待运行。
router.post('/:id/retry-stage', idempotency(), (req, res) => {
  const task = taskManager.get(req.params.id || '');
  if (!task) return res.status(404).json({ code: 404, message: '任务不存在' });
  if (task.type !== 'auto-produce' || !task.meta?.workflow) {
    return res.status(400).json({ code: 400, message: '当前任务不支持阶段级重试' });
  }
  const stage = String(req.body?.stage || asRecord(task.meta.workflow).current_stage || '');
  const selectedStage = STAGES.find((candidate) => candidate === stage);
  if (!selectedStage) return res.status(400).json({ code: 400, message: '未知工作流阶段' });
  const retryableStatuses = new Set<TaskRecord['status']>([
    'failed', 'partial', 'interrupted', 'orphaned', 'canceled',
  ]);
  if (!retryableStatuses.has(task.status)) {
    return res.status(409).json({ code: 409, message: `任务当前不可重试：${task.status}` });
  }
  if (task.status === 'orphaned' && req.body?.confirm_uncertain_outcome !== true) {
    return res.status(409).json({
      code: 409,
      message: '该任务的远端结果无法确认。请先核对任务和资产，再明确确认重试。',
    });
  }
  try {
    const workflow = transition(task.meta.workflow, {
      type: 'RETRY',
      stage: selectedStage,
      allowUncertain: task.status === 'orphaned',
    });
    const previousAttempt = Math.max(1, Number(task.meta?.attempt) || 1);
    const nextTask = taskManager.create('auto-produce', {
      ...(task.meta || {}),
      retry_of: task.id,
      attempt: previousAttempt + 1,
      workflow,
      cancel_requested: false,
      recovery: {
        ...(task.meta.recovery || {}),
        kind: 'auto-produce',
        attempts: 0,
        orphaned_at: null,
      },
    });
    taskManager.update(nextTask.id, { message: `准备重试阶段：${selectedStage}` });
    const queue = require('../services/autoProduceQueue');
    const aiRouter = require('./ai');
    const queued = queue.enqueue(nextTask, () => aiRouter.runAutoProduceTask(
      nextTask.id,
      Number(nextTask.meta.project_id),
      nextTask.meta.params || {},
    ));
    return res.json({
      code: 200,
      data: { task_id: nextTask.id, retry_of: task.id, attempt: previousAttempt + 1, stage: selectedStage, workflow, queue: queued },
      message: queued.status === 'waiting' ? '阶段重试已排队' : '阶段重试已开始',
    });
  } catch (error) {
    return res.status(409).json({ code: 409, message: errorMessage(error) });
  }
});

// 单任务查询
router.get('/:id', (req, res) => {
  const task = taskManager.get(req.params.id);
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在' });
  }
  res.json({ code: 200, data: task });
});

// 任务列表
router.get('/', (req, res) => {
  const type = queryText(req.query.type) || undefined;
  const status = queryText(req.query.status) || undefined;
  const list = taskManager.list({ type, status });
  // 按创建时间倒序
  list.sort((a, b) => b.created_at - a.created_at);
  res.json({ code: 200, data: list });
});

module.exports = router;
