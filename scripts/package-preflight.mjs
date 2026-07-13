import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const executable = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', '.bin', 'electron-builder.cmd')
  : path.join(ROOT, 'node_modules', '.bin', 'electron-builder');

const args = ['--dir'];
let outputDirectory = null;
if (process.platform === 'darwin') {
  // Some synced/Documents folders attach immutable FinderInfo metadata to app
  // bundles, which macOS codesign correctly rejects. Build the verifiable
  // preflight package in a clean temporary location instead.
  outputDirectory = path.resolve(
    process.env.ELECTRON_PREFLIGHT_OUTPUT || path.join(os.tmpdir(), 'aigc-video-studio-pack'),
  );
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  args.push(
    '--mac',
    `-c.directories.output=${outputDirectory}`,
    '-c.mac.identity=-',
    '-c.mac.entitlements=resources/entitlements.adhoc.plist',
    '-c.mac.entitlementsInherit=resources/entitlements.adhoc.plist',
  );
} else if (process.platform === 'win32') {
  args.push('--win', '--x64', '-c.win.signAndEditExecutable=false');
}

const result = spawnSync(executable, args, {
  cwd: ROOT,
  env: { ...process.env, SKIP_NOTARIZE: '1' },
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status === 0 && outputDirectory) {
  console.log(`[pack] macOS ad-hoc 预检包：${outputDirectory}`);
}
process.exit(result.status ?? 1);
