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

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
await run(npm, ['run', 'build:contracts']);
await run(npm, ['run', 'build:server']);
await run(npm, ['run', 'build:client']);
await run(npm, ['run', 'build:electron']);
const electron = require('electron');
await run(electron, ['scripts/compile-backend.js'], {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
  NODE_ENV: 'production',
  DEMO_MODE: '1',
});
