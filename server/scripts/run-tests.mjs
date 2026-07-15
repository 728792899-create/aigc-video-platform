import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SERVER_ENTRY = path.join(SERVER_ROOT, 'dist', 'app.js');
const TSX = path.join(SERVER_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-video-server-test-'));

async function reservePort() {
  if (process.env.TEST_PORT) return Number(process.env.TEST_PORT);
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

function childEnv(port) {
  const env = {
    ...process.env,
    DEMO_MODE: '1',
    LOG_HTTP: process.env.LOG_HTTP || '0',
    HOST: '127.0.0.1',
    PORT: String(port),
    BASE_URL: `http://127.0.0.1:${port}`,
    DB_PATH: path.join(tempRoot, 'database.sqlite'),
    SETTINGS_FILE: path.join(tempRoot, 'settings.json'),
    UPLOAD_DIR: path.join(tempRoot, 'uploads'),
    CORS_ORIGIN: 'http://127.0.0.1:5173,http://localhost:5173',
  };
  for (const key of [
    'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'GEMINI_API_KEY',
    'RUNWAY_API_KEY', 'KLING_API_KEY', 'ARK_API_KEY', 'VOLCANO_API_KEY',
    'AIGC_CREDENTIALS_B64',
  ]) delete env[key];
  return env;
}

async function waitForHealth(baseUrl, server, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`测试服务提前退出（code ${server.exitCode}）`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`测试服务未就绪：${lastError}`);
}

function run(command, args, options) {
  return spawn(command, args, {
    cwd: SERVER_ROOT,
    env: options.env,
    stdio: options.stdio || 'inherit',
    shell: process.platform === 'win32',
  });
}

async function waitForExit(child, label) {
  const { code, signal } = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  if (code !== 0) throw new Error(`${label}失败：${signal || `exit code ${code}`}`);
}

const port = await reservePort();
const env = childEnv(port);
if (!fs.existsSync(SERVER_ENTRY)) throw new Error('缺少 server/dist/app.js，请先运行 npm run build');
const server = run(process.execPath, [SERVER_ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

try {
  await waitForHealth(env.BASE_URL, server);
  // Migration tests can load a legacy .js module that already depends on a new
  // .ts domain module, so both groups use tsx. They remain separate processes:
  // this avoids the compiler/DB contention previously seen when every test file
  // ran in one large concurrent group.
  const javascriptTests = run(TSX, ['--test', 'test/**/*.test.js'], { env });
  await waitForExit(javascriptTests, '服务端 JavaScript 测试');

  const typescriptTests = run(TSX, ['--test', 'test/**/*.test.ts'], { env });
  await waitForExit(typescriptTests, '服务端 TypeScript 测试');
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
