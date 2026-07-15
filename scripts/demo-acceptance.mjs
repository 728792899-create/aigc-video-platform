import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-video-demo-acceptance-'));

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = Number(process.env.DEMO_ACCEPTANCE_PORT) || await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const cleanEnv = {
  ...process.env,
  DEMO_MODE: '1',
  DEMO_SILENT_TTS: '1',
  LOG_HTTP: '0',
  HOST: '127.0.0.1',
  PORT: String(port),
  DB_PATH: path.join(tempRoot, 'database.sqlite'),
  SETTINGS_FILE: path.join(tempRoot, 'settings.json'),
  UPLOAD_DIR: path.join(tempRoot, 'uploads'),
  CORS_ORIGIN: 'http://127.0.0.1:5173,http://localhost:5173',
};
for (const key of [
  'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'GEMINI_API_KEY',
  'RUNWAY_API_KEY', 'KLING_API_KEY', 'ARK_API_KEY', 'VOLCANO_API_KEY',
  'AIGC_CREDENTIALS_B64',
]) delete cleanEnv[key];

function launchServer() {
  const child = spawn(process.execPath, ['dist/app.js'], {
    cwd: path.join(ROOT, 'server'),
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[demo-server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[demo-server] ${chunk}`));
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Demo 服务停止超时')), 8_000)),
  ]);
}

async function waitForHealth(child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Demo 服务提前退出（${child.exitCode}）`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Demo 服务未就绪：${last}`);
}

async function request(method, urlPath, body, headers = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${urlPath}: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 400)}`);
  return payload.data;
}

async function waitForTask(taskId, predicate, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let task;
  while (Date.now() < deadline) {
    task = await request('GET', `/api/tasks/${taskId}`);
    if (predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`任务 ${taskId} 等待超时，最后状态：${JSON.stringify(task).slice(0, 800)}`);
}

function terminal(task) {
  return ['success', 'failed', 'partial', 'canceled', 'interrupted'].includes(task?.status);
}

async function assertPlayableExport(task, label) {
  if (task.status !== 'success') throw new Error(`${label} 未成功：${task.status} ${task.error || task.message}`);
  const fileUrl = task.result?.file_url;
  if (!fileUrl) throw new Error(`${label} 没有返回 file_url`);
  const response = await fetch(`${baseUrl}${fileUrl}`);
  if (!response.ok) throw new Error(`${label} 成片不可访问：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 2_000 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
    throw new Error(`${label} 不是有效 MP4（${bytes.length} bytes）`);
  }
}

async function assertStageArtifacts(projectId, label) {
  const artifacts = await request('GET', `/api/projects/${projectId}/artifacts`);
  const stages = new Set((artifacts.current || []).map((item) => item.stage));
  for (const stage of ['script', 'storyboard', 'image', 'voice', 'subtitle', 'timeline', 'export']) {
    if (!stages.has(stage)) throw new Error(`${label} 缺少 current ${stage} artifact`);
  }
  const project = await request('GET', `/api/projects/${projectId}`);
  const script = JSON.parse(project.script_content || '{}');
  if (script.schema_version !== '1.0.0' || !script.prompt_version || !script.input_hash) {
    throw new Error(`${label} 未持久化结构化脚本契约元数据`);
  }
}

let server = launchServer();
try {
  await waitForHealth(server);

  // 1) 在 image 检查点暂停并强制停止进程，随后用同一 DB 重启。
  const recoveryKey = 'demo-restart-idempotency-00000001';
  const recoveryBody = {
    theme: 'Demo 重启恢复验收',
    duration: '8-12',
    ratio: '16:9',
    motion: 'none',
    demoStageDelayMs: 6_000,
    demoDelayStage: 'image',
  };
  const recoveryStart = await request('POST', '/api/ai/auto-produce', recoveryBody, {
    'Idempotency-Key': recoveryKey,
  });
  const interrupted = await waitForTask(
    recoveryStart.task_id,
    (task) => task.meta?.workflow?.stages?.image?.status === 'running' && /恢复检查点/.test(task.message || ''),
    30_000,
  );
  if (interrupted.meta.workflow.stages.script.status !== 'succeeded') throw new Error('重启前脚本检查点未保存');
  await stopServer(server);

  server = launchServer();
  await waitForHealth(server);
  const replayed = await request('POST', '/api/ai/auto-produce', recoveryBody, {
    'Idempotency-Key': recoveryKey,
  });
  if (replayed.task_id !== recoveryStart.task_id || replayed.project_id !== recoveryStart.project_id) {
    throw new Error('服务重启后幂等响应未回放原任务，可能造成重复提交');
  }
  const recovered = await waitForTask(recoveryStart.task_id, terminal);
  await assertPlayableExport(recovered, '重启恢复任务');
  await assertStageArtifacts(recoveryStart.project_id, '重启恢复任务');
  if ((recovered.meta?.recovery?.attempts || 0) < 1) throw new Error('任务未记录自动恢复次数');
  if (recovered.meta?.workflow?.stages?.export?.status !== 'succeeded') throw new Error('恢复后导出阶段未成功');
  console.log(`Demo restart recovery passed: task=${recoveryStart.task_id}`);

  // 2) 在 export 阶段注入一次可诊断失败，只重试该阶段并复用上游资产。
  const retryStart = await request('POST', '/api/ai/auto-produce', {
    theme: 'Demo 单阶段重试验收',
    duration: '8-12',
    ratio: '16:9',
    motion: 'none',
    demoFailStageOnce: 'export',
  });
  const failedOnce = await waitForTask(retryStart.task_id, terminal);
  if (!['partial', 'failed'].includes(failedOnce.status)) throw new Error(`预期注入失败，实际为 ${failedOnce.status}`);
  if (failedOnce.meta?.workflow?.stages?.export?.status !== 'failed') throw new Error('注入失败没有落到 export 检查点');
  const storyboardAttempts = failedOnce.meta.workflow.stages.storyboard.attempts;

  const retryAttempt = await request('POST', `/api/tasks/${retryStart.task_id}/retry-stage`, { stage: 'export' });
  if (!retryAttempt.task_id || retryAttempt.task_id === retryStart.task_id) {
    throw new Error('阶段重试必须创建新 attempt，不能覆盖原失败任务');
  }
  const preservedFailure = await request('GET', `/api/tasks/${retryStart.task_id}`);
  if (!['partial', 'failed'].includes(preservedFailure.status) || !preservedFailure.error) {
    throw new Error('阶段重试覆盖了原任务失败证据');
  }
  const retried = await waitForTask(retryAttempt.task_id, terminal);
  await assertPlayableExport(retried, '单阶段重试任务');
  await assertStageArtifacts(retryStart.project_id, '单阶段重试任务');
  if (retried.meta?.retry_of !== retryStart.task_id || retried.meta?.attempt !== 2) {
    throw new Error('阶段重试没有保存 retry_of / attempt 血缘');
  }
  if (retried.meta.workflow.stages.storyboard.attempts !== storyboardAttempts) throw new Error('阶段重试错误地重跑了分镜阶段');
  console.log(`Demo stage retry passed: task=${retryAttempt.task_id}, retry_of=${retryStart.task_id}`);
} finally {
  await stopServer(server).catch((error) => console.error(error.message));
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
