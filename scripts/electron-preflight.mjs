import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const errors = [];
const checks = [];
const check = (condition, message) => (condition ? checks : errors).push(message);

const main = fs.readFileSync(path.join(ROOT, 'electron/main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.ts'), 'utf8');
check(pkg.build?.asar === true, 'Electron 使用 ASAR');
check((pkg.build?.asarUnpack || []).some((item) => item.includes('ffmpeg-static')), 'FFmpeg 二进制配置为 ASAR 解包');
check(/contextIsolation:\s*true/.test(main), 'contextIsolation=true');
check(/nodeIntegration:\s*false/.test(main), 'nodeIntegration=false');
check(/setAccessibilitySupportEnabled\(true\)/.test(main), 'Electron WebContents 启用辅助功能支持');
check(/sandbox:\s*true/.test(main), 'renderer sandbox=true');
check(/setPermissionRequestHandler/.test(main), '权限请求有默认拒绝策略');
check(!/ipcRenderer\.invoke\([^'"`]/.test(preload), 'preload IPC 通道为静态白名单');
check(fs.existsSync(path.join(ROOT, 'electron/dist/main.js')), 'Electron 主进程已编译');
check(fs.existsSync(path.join(ROOT, 'electron/dist/preload.js')), 'Electron preload 已编译');
check(!fs.existsSync(path.join(ROOT, 'electron/dist/main.js.map')), 'Electron 产物不含 sourcemap');
check(fs.existsSync(path.join(ROOT, 'client/dist/index.html')), '客户端生产构建存在');
check(fs.existsSync(path.join(ROOT, 'dist-server-jsc/app.js')), '后端桌面产物存在');
check(fs.existsSync(path.join(ROOT, 'dist-server-jsc/vendor/bytenode')), 'bytenode 运行时已打包');
check(fs.existsSync(path.join(ROOT, 'dist-server-jsc/vendor/express')), 'Express 运行时已打包');
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
