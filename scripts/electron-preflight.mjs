import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const errors = [];
const checks = [];
const check = (condition, message) => (condition ? checks : errors).push(message);

const main = fs.readFileSync(path.join(ROOT, 'electron/main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.ts'), 'utf8');
const packagePreflight = fs.readFileSync(path.join(ROOT, 'scripts/package-preflight.mjs'), 'utf8');
const afterPack = fs.readFileSync(path.join(ROOT, 'scripts/after-pack.js'), 'utf8');
check(pkg.build?.asar === true, 'Electron 使用 ASAR');
check((pkg.build?.asarUnpack || []).some((item) => item.includes('ffmpeg-static')), 'FFmpeg 二进制配置为 ASAR 解包');
check((pkg.build?.asarUnpack || []).some((item) => item.includes('better-sqlite3')), 'better-sqlite3 原生模块配置为 ASAR 解包');
check(/contextIsolation:\s*true/.test(main), 'contextIsolation=true');
check(/nodeIntegration:\s*false/.test(main), 'nodeIntegration=false');
check(/setAccessibilitySupportEnabled\(true\)/.test(main), 'Electron WebContents 启用辅助功能支持');
check(/sandbox:\s*true/.test(main), 'renderer sandbox=true');
check(/DB_DRIVER:\s*isPackaged\s*\?\s*'better-sqlite3'\s*:\s*'sqljs'/.test(main), '发布包强制 better-sqlite3，开发态保留 sql.js 回退');
check(/setPermissionRequestHandler/.test(main), '权限请求有默认拒绝策略');
check(/\[USER_PATH\]/.test(main) && /\\\/Users\\\//.test(main), 'Electron 持久化日志会脱敏用户主目录路径');
check(/AIGC_DISABLE_AUTO_UPDATE/.test(main) && /app-update\.yml/.test(main), 'ad-hoc/离线构建不会误启动自动更新');
check(/electronDist/.test(packagePreflight) && /node_modules.*electron.*dist/.test(packagePreflight), 'Electron 预检包复用 lockfile 安装的本地运行时');
check(/default_app\.asar/.test(afterPack), 'Electron 本地 distribution 的示例应用会在签名前移除');
check(!/ipcRenderer\.invoke\([^'"`]/.test(preload), 'preload IPC 通道为静态白名单');
check(fs.existsSync(path.join(ROOT, 'electron/dist/main.js')), 'Electron 主进程已编译');
check(fs.existsSync(path.join(ROOT, 'electron/dist/preload.js')), 'Electron preload 已编译');
check(!fs.existsSync(path.join(ROOT, 'electron/dist/main.js.map')), 'Electron 产物不含 sourcemap');
check(fs.existsSync(path.join(ROOT, 'client/dist/index.html')), '客户端生产构建存在');
check(fs.existsSync(path.join(ROOT, 'dist-server-jsc/app.js')), '后端桌面产物存在');
check(fs.existsSync(path.join(ROOT, 'dist-server-jsc/vendor/bytenode')), 'bytenode 运行时已打包');
check(fs.existsSync(path.join(ROOT, 'dist-server-jsc/vendor/express')), 'Express 运行时已打包');
check(fs.existsSync(path.join(ROOT, 'dist-server-jsc/vendor/socket.io')), 'Socket.IO 运行时已打包');
const bundledFfmpeg = path.join(ROOT, 'dist-server-jsc/vendor/ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
check(fs.existsSync(bundledFfmpeg), '发布态 FFmpeg 实体已进入后端 vendor');
check(/serverDir,\s*'vendor',\s*'ffmpeg-static'/.test(main), 'Electron 发布态从 server vendor 注入 FFmpeg 路径');
check(fs.existsSync(path.join(ROOT, 'dist-server-jsc/vendor/sharp')), 'Sharp 运行时已打包');
const nativeImagePackages = path.join(ROOT, 'dist-server-jsc/vendor/@img');
const hasSharpNativePackage = fs.existsSync(nativeImagePackages)
  && fs.readdirSync(nativeImagePackages).some((name) => /^sharp-(?:libvips-)?/.test(name));
check(hasSharpNativePackage, 'Sharp 当前平台原生依赖已打包');
const bundledContracts = path.join(ROOT, 'dist-server-jsc/vendor/@aigc-video/contracts');
check(
  fs.existsSync(path.join(bundledContracts, 'package.json'))
    && fs.existsSync(path.join(bundledContracts, 'dist/index.cjs'))
    && !fs.lstatSync(bundledContracts).isSymbolicLink(),
  '共享 contracts 以实体运行时文件打包，不依赖仓库符号链接',
);

function danglingLinks(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      try { fs.realpathSync(absolute); } catch { result.push(path.relative(ROOT, absolute)); }
    } else if (entry.isDirectory()) danglingLinks(absolute, result);
  }
  return result;
}
const brokenVendorLinks = danglingLinks(path.join(ROOT, 'dist-server-jsc/vendor'));
check(brokenVendorLinks.length === 0, `后端 vendor 不含悬空符号链接（${brokenVendorLinks.join(', ') || 'clean'}）`);
const electronBinary = require('electron');
const runtimeProbe = spawnSync(electronBinary, ['-e', [
  "const sharp = require('sharp')",
  "const socket = require('socket.io')",
  "if (!sharp.versions?.sharp || typeof socket.Server !== 'function') process.exit(2)",
].join(';')], {
  cwd: path.join(ROOT, 'dist-server-jsc'),
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_PATH: path.join(ROOT, 'dist-server-jsc/vendor'),
  },
  encoding: 'utf8',
});
check(
  runtimeProbe.status === 0,
  `Electron 内置 Node 可加载 Sharp/Socket.IO（${runtimeProbe.status === 0 ? 'ok' : String(runtimeProbe.stderr || runtimeProbe.error || 'unknown').trim().slice(0, 240)}）`,
);
check(fs.existsSync(path.join(ROOT, 'resources/entitlements.mac.plist')), 'macOS 权限清单存在');
check(fs.existsSync(path.join(ROOT, 'resources/entitlements.adhoc.plist')), 'macOS ad-hoc 预检权限清单存在');
check(fs.existsSync(path.join(ROOT, 'scripts/after-pack.js')), 'macOS 签名前扩展属性清理钩子存在');
check(fs.existsSync(path.join(ROOT, 'resources/icon.png')), '原创应用图标 PNG 存在');
check(fs.existsSync(path.join(ROOT, 'resources/icon.icns')), 'macOS ICNS 图标存在');
check(fs.existsSync(path.join(ROOT, 'resources/icon.ico')), 'Windows ICO 图标存在');

const forbidden = [
  'dist-server-jsc/db/database.sqlite',
  'dist-server-jsc/db/settings.json',
  'dist-server-jsc/uploads',
  'dist-server-jsc/logs',
].filter((item) => fs.existsSync(path.join(ROOT, item)));
check(forbidden.length === 0, `桌面产物不含数据库、设置、上传或日志（${forbidden.join(', ') || 'clean'}）`);

for (const message of checks) console.log(`✓ ${message}`);
for (const message of errors) console.error(`✗ ${message}`);
if (errors.length) process.exitCode = 1;
