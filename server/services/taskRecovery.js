'use strict';

const RECOVERABLE_STATUSES = new Set(['pending', 'waiting', 'running', 'composing', 'interrupted']);

async function recoverTasks({ taskManager, runners = {}, awaitRunners = true } = {}) {
  if (!taskManager || typeof taskManager.list !== 'function') {
    throw new Error('taskManager 不可用');
  }
  const summary = { scanned: 0, resumed: 0, failed: 0, skipped: 0 };
  const pending = taskManager.list().filter((task) => RECOVERABLE_STATUSES.has(task.status));
  const started = [];

  for (const task of pending) {
    summary.scanned += 1;
    const recovery = task.meta?.recovery || {};
    const kind = recovery.kind || task.type;
    const attempts = Number(recovery.attempts) || 0;
    const maxAttempts = Math.max(1, Number(recovery.max_attempts) || 3);
    const runner = runners[kind];

    if (attempts >= maxAttempts) {
      taskManager.update(task.id, {
        status: 'failed',
        message: '任务自动恢复失败',
        error: `任务已达到自动恢复次数上限（${maxAttempts}）`,
      });
      summary.failed += 1;
      continue;
    }
    if (typeof runner !== 'function') {
      taskManager.update(task.id, {
        status: 'interrupted',
        message: '任务已中断，当前版本没有可用的恢复执行器',
        error: 'RECOVERY_RUNNER_MISSING',
      });
      summary.skipped += 1;
      continue;
    }

    const nextMeta = {
      ...(task.meta || {}),
      cancel_requested: false,
      recovery: {
        ...recovery,
        kind,
        attempts: attempts + 1,
        max_attempts: maxAttempts,
        resumed_at: Date.now(),
      },
    };
    const restored = taskManager.update(task.id, {
      status: 'waiting',
      message: `服务重启后正在恢复任务（${attempts + 1}/${maxAttempts}）`,
      meta: nextMeta,
    });
    summary.resumed += 1;
    const promise = Promise.resolve().then(() => runner(restored));
    if (awaitRunners) started.push(promise);
    else promise.catch((error) => {
      taskManager.update(task.id, {
        status: 'failed',
        message: '任务恢复执行失败',
        error: String(error?.message || error),
      });
    });
  }

  if (started.length) await Promise.all(started);
  return summary;
}

module.exports = { RECOVERABLE_STATUSES, recoverTasks };
