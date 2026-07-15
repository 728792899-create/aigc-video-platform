import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${command} 失败：${signal || `exit code ${code}`}`)));
  });
}

// Windows cannot reliably spawn npm.cmd with shell=false (Node reports EINVAL).
// npm exposes the exact CLI entrypoint to lifecycle scripts, so execute that
// JavaScript file with the current Node binary on every platform.
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('缺少 npm_execpath；请通过 npm run prepare:desktop 执行桌面准备');
}
const runNpm = (args) => run(process.execPath, [npmCli, ...args]);

await runNpm(['run', 'build:contracts']);
await runNpm(['run', 'build:server']);
await runNpm(['run', 'build:client']);
await runNpm(['run', 'build:electron']);
const electron = require('electron');
await run(electron, ['scripts/compile-backend.js'], {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
  NODE_ENV: 'production',
  DEMO_MODE: '1',
});
