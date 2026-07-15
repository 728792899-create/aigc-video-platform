import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
const electronVersionFile = path.join(electronDist, 'version');
if (!fs.existsSync(electronVersionFile)) {
  throw new Error('Electron 本地运行时不完整，请先执行 npm ci');
}
const installedElectronVersion = fs.readFileSync(electronVersionFile, 'utf8').trim();
const expectedElectronVersion = String(pkg.devDependencies?.electron || '').replace(/^[~^]/, '');
if (installedElectronVersion !== expectedElectronVersion) {
  throw new Error(`Electron 运行时版本不匹配：${installedElectronVersion} != ${expectedElectronVersion}`);
}
const buildEnv = { ...process.env, SKIP_NOTARIZE: '1' };
// node-gyp's Undici downloader only accepts HTTP(S) proxy URLs. Some desktop
// environments expose a SOCKS or application-specific ALL_PROXY; passing it
// through makes an otherwise valid native rebuild fail before any download.
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  const value = buildEnv[key];
  if (value && !/^https?:\/\//i.test(value)) delete buildEnv[key];
}
const executable = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', '.bin', 'electron-builder.cmd')
  : path.join(ROOT, 'node_modules', '.bin', 'electron-builder');

// npm 安装阶段已按 lockfile 下载并校验 Electron。显式复用本地
// distribution，避免预检打包在弱网/离线环境中再次访问 GitHub。
const args = ['--dir', `-c.electronDist=${electronDist}`];
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
  env: buildEnv,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status === 0) {
  const packageRoot = outputDirectory || path.join(ROOT, pkg.build?.directories?.output || 'dist-electron');
  const releaseSourcePattern = /\.(?:[cm]?ts|tsx|map|tsbuildinfo)$/i;
  const foundAsars = [];
  const looseSources = [];
  function inspect(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(absolute);
      else if (entry.name === 'app.asar') foundAsars.push(absolute);
      else if (releaseSourcePattern.test(entry.name)) looseSources.push(absolute);
    }
  }
  inspect(packageRoot);
  const appAsar = foundAsars.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
  if (!appAsar) throw new Error('打包成功但未找到 app.asar');
  const archivedSources = asar.listPackage(appAsar).filter((entry) => releaseSourcePattern.test(entry));
  const defaultApp = path.join(path.dirname(appAsar), 'default_app.asar');
  if (looseSources.length || archivedSources.length || fs.existsSync(defaultApp)) {
    const sample = [...looseSources, ...archivedSources].slice(0, 20).join('\n');
    throw new Error(`发布包仍包含 TypeScript/sourcemap 或 Electron 示例应用：\n${sample}`);
  }
  console.log('[pack] 最终包不含 TypeScript、sourcemap 或 Electron 示例应用');
  if (outputDirectory) console.log(`[pack] macOS ad-hoc 预检包：${outputDirectory}`);
}
process.exit(result.status ?? 1);
