/**
 * 一键成片队列
 *
 * 支持多个任务同时提交；超过并行上限时进入 waiting 状态，而不是直接 429。
 * 合成阶段仍由 video.js 的 composeLock 保护，本队列只负责整条一键成片流水线并行数。
 */
const config = require('./config');
const taskManager = require('./taskManager');

const queue = [];
const running = new Set();

function maxParallel() {
  const fromConfig = Number(config.get('autoProduce.maxParallel'));
  const fromEnv = Number(process.env.MAX_CONCURRENT_AUTO_PRODUCE);
  const n = Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : (fromEnv || 2);
  return Math.max(1, Math.min(3, n));
}

function queuePosition(taskId) {
  const idx = queue.findIndex((item) => item.taskId === taskId);
  return idx >= 0 ? idx + 1 : null;
}

function refreshWaitingMeta() {
  queue.forEach((item, index) => {
    const task = taskManager.get(item.taskId);
    if (!task) return;
    taskManager.update(item.taskId, {
      status: 'waiting',
      progress: 0,
      message: `已加入后台生成队列，前方还有 ${index} 个任务`,
      meta: { ...(task.meta || {}), queue_position: index + 1 },
    });
  });
}

function enqueue(task, runner) {
  const item = { taskId: task.id, runner };
  if (running.size < maxParallel()) {
    start(item);
    return { status: 'running', queue_position: null };
  }

  queue.push(item);
  taskManager.update(task.id, {
    status: 'waiting',
    progress: 0,
    message: `已加入后台生成队列，前方还有 ${queue.length - 1} 个任务`,
    meta: { ...(task.meta || {}), queue_position: queue.length },
  });
  return { status: 'waiting', queue_position: queue.length };
}

function start(item) {
  running.add(item.taskId);
  const task = taskManager.get(item.taskId);
  if (task) {
    taskManager.update(item.taskId, {
      status: 'running',
      progress: Math.max(1, task.progress || 0),
      message: task.message && task.message !== '任务已创建' ? task.message : '准备中...',
      meta: { ...(task.meta || {}), queue_position: null },
    });
  }

  Promise.resolve()
    .then(() => item.runner())
    .catch((err) => {
      // 调用方通常会自行 fail；这里兜底防止漏网的未处理异常。
      const current = taskManager.get(item.taskId);
      if (current && !['success', 'failed', 'partial', 'canceled'].includes(current.status)) {
        taskManager.fail(item.taskId, err);
      }
    })
    .finally(() => {
      running.delete(item.taskId);
      startNext();
    });
}

function startNext() {
  while (running.size < maxParallel() && queue.length > 0) {
    const next = queue.shift();
    refreshWaitingMeta();
    start(next);
  }
}

function cancel(taskId) {
  const idx = queue.findIndex((item) => item.taskId === taskId);
  if (idx >= 0) {
    queue.splice(idx, 1);
    taskManager.update(taskId, {
      status: 'canceled',
      progress: 0,
      message: '已取消排队任务',
    });
    refreshWaitingMeta();
    return { ok: true, queued: true };
  }
  const task = taskManager.get(taskId);
  if (task && running.has(taskId)) {
    taskManager.update(taskId, {
      meta: { ...(task.meta || {}), cancel_requested: true },
      message: '已收到取消请求，当前阶段结束后停止后续流程',
    });
    return { ok: true, queued: false };
  }
  return { ok: false };
}

function stats() {
  return {
    maxParallel: maxParallel(),
    running: running.size,
    waiting: queue.length,
  };
}

module.exports = { enqueue, cancel, stats, queuePosition };
