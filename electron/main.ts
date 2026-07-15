// ============================================================
//  AIGC 视频工作台 - Electron 主进程
//  职责：拉起后端(Express) → 等健康检查通过 → 开窗口加载前端 → 退出时清理
// ============================================================
import {
  app, BrowserWindow, dialog, shell, Menu, ipcMain, safeStorage, session, crashReporter,
  type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type MessageBoxOptions,
} from 'electron'
import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import { DesktopLocaleSchema, type DesktopLocale } from '@aigc-video/contracts'
import * as telemetry from './telemetry'
import { DesktopUpdateService, type UpdateInfoLike } from './updateService'

type JsonObject = Record<string, unknown>
type SecretField = 'apiKey' | 'accessKey' | 'secretKey' | 'appId' | 'cluster' | 'resourceId'
type CredentialRecord = Partial<Record<SecretField, string>>
type CredentialVault = Record<string, CredentialRecord>

const SECRET_FIELDS: readonly SecretField[] = ['apiKey', 'accessKey', 'secretKey', 'appId', 'cluster', 'resourceId']
const LOG_SECRET_FIELDS: readonly Extract<SecretField, 'apiKey' | 'accessKey' | 'secretKey'>[] = ['apiKey', 'accessKey', 'secretKey']

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function parseCredentialVault(value: unknown): CredentialVault {
  if (!isJsonObject(value)) return {}
  const vault: CredentialVault = {}
  for (const [provider, rawCredential] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(provider) || !isJsonObject(rawCredential)) continue
    const credential: CredentialRecord = {}
    for (const field of SECRET_FIELDS) {
      const raw = rawCredential[field]
      if (typeof raw === 'string' && raw.trim() && raw.length <= 8192) credential[field] = raw.trim()
    }
    if (Object.keys(credential).length) vault[provider] = credential
  }
  return vault
}

const PRODUCT_NAME = 'AIGC 视频工作台';
app.setName(PRODUCT_NAME);

// 桌面冒烟/故障复现实验必须与真实用户数据完全隔离。仅在调用方同时提供
// 显式开关和绝对目录时覆盖 userData；常规启动不会读取该变量，也不会让
// 渲染进程通过 IPC 任意修改目录。
if (process.env.AIGC_STUDIO_ALLOW_USER_DATA_OVERRIDE === '1') {
  const requestedUserDataDir = String(process.env.AIGC_STUDIO_USER_DATA_DIR || '').trim();
  if (!requestedUserDataDir || !path.isAbsolute(requestedUserDataDir)) {
    throw new Error('AIGC_STUDIO_USER_DATA_DIR must be an absolute path when userData override is enabled');
  }
  app.setPath('userData', path.normalize(requestedUserDataDir));
}
crashReporter.start({ uploadToServer: false, compress: true });
telemetry.init({ appVersion: app.getVersion(), packaged: app.isPackaged });

// 后端端口：默认从 3000 起探测空闲端口，允许通过 AIGC_STUDIO_PORT 指定起始端口。
// 注意：这是“起始值”，若被占用会自动 +1 顺延，实际端口由 findFreePort 决定
let PORT = parseInt(String(process.env.AIGC_STUDIO_PORT || process.env.SNOOPY_PORT || ''), 10) || 3000;
const isPackaged = app.isPackaged;

// ---- 路径解析：开发模式用项目目录，打包后用 resources / userData ----
// 后端代码位置
const serverDir = isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..', '..', 'server', 'dist');
// 前端构建产物位置
const clientDist = isPackaged
  ? path.join(process.resourcesPath, 'client', 'dist')
  : path.join(__dirname, '..', '..', 'client', 'dist');

// 用户数据目录（可写）：由 Electron 按产品名放在系统 Application Support / AppData。
const userDataDir = app.getPath('userData');
function migrateLegacyUserData() {
  if (fs.existsSync(path.join(userDataDir, 'data'))) return;
  const appData = app.getPath('appData');
  for (const legacyName of ['史努比大王', 'snoopy-king']) {
    const legacy = path.join(appData, legacyName);
    if (path.resolve(legacy) === path.resolve(userDataDir) || !fs.existsSync(path.join(legacy, 'data'))) continue;
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.cpSync(path.join(legacy, 'data'), path.join(userDataDir, 'data'), { recursive: true, errorOnExist: false });
      console.log(`[main] 已从旧版数据目录迁移用户数据：${legacyName}`);
      break;
    } catch (error: unknown) {
      console.error('[main] 旧版用户数据迁移失败:', errorMessage(error));
    }
  }
}
migrateLegacyUserData();
const dataDir = path.join(userDataDir, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
// 日志目录（可写）：用户数据目录/logs/ —— 后端崩溃信息落盘到此，便于排查
const logsDir = path.join(userDataDir, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const backendLogPath = path.join(logsDir, 'backend.log');
const credentialVaultPath = path.join(dataDir, 'credentials.vault');
let credentialVault: CredentialVault = {};

function loadCredentialVault(): CredentialVault {
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('[main] 系统安全存储不可用，凭证将不会持久化');
    return {};
  }
  try {
    if (!fs.existsSync(credentialVaultPath)) return {};
    const encrypted = Buffer.from(fs.readFileSync(credentialVaultPath, 'utf8'), 'base64');
    const parsed: unknown = JSON.parse(safeStorage.decryptString(encrypted));
    return parseCredentialVault(parsed);
  } catch (error: unknown) {
    console.error('[main] 无法读取系统凭证库:', errorMessage(error));
    return {};
  }
}

function persistCredentialVault(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const encrypted = safeStorage.encryptString(JSON.stringify(credentialVault));
  const temp = `${credentialVaultPath}.tmp`;
  fs.writeFileSync(temp, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, credentialVaultPath);
  return true;
}

function migrateLegacyCredentials() {
  const settingsPath = path.join(dataDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) return;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const settings: JsonObject = isJsonObject(parsed) ? parsed : {};
    let changed = false;
    const credentials = isJsonObject(settings.credentials) ? settings.credentials : {};
    for (const [provider, value] of Object.entries(credentials)) {
      if (!isJsonObject(value)) continue;
      const secrets: CredentialRecord = {};
      for (const field of LOG_SECRET_FIELDS) {
        if (value[field]) secrets[field] = String(value[field]);
        if (field in value) { delete value[field]; changed = true; }
      }
      if (Object.keys(secrets).length) credentialVault[provider] = { ...(credentialVault[provider] || {}), ...secrets };
    }
    const legacyDeepseek = isJsonObject(settings.deepseek) ? settings.deepseek : null;
    if (legacyDeepseek?.apiKey) {
      credentialVault.deepseek = { ...(credentialVault.deepseek || {}), apiKey: String(legacyDeepseek.apiKey) };
      delete legacyDeepseek.apiKey;
      changed = true;
    }
    if (changed) {
      persistCredentialVault();
      const temp = `${settingsPath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, settingsPath);
      console.log('[main] 已把旧版明文凭证迁移到系统安全存储');
    }
  } catch (error: unknown) {
    console.error('[main] 旧版凭证迁移失败:', errorMessage(error));
  }
}

function handleCredentialMessage(message: unknown): void {
  if (!isJsonObject(message) || message.channel !== 'credential-vault' || message.action !== 'set') return;
  const provider = String(message.provider || '');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(provider)) return;
  const messageValue = isJsonObject(message.value) ? message.value : {};
  const next: CredentialRecord = {};
  for (const field of SECRET_FIELDS) {
    if (messageValue[field] === undefined) continue;
    const value = String(messageValue[field] || '').trim();
    if (value && value.length <= 8192) next[field] = value;
  }
  if (Object.keys(next).length) credentialVault[provider] = next;
  else delete credentialVault[provider];
  try { persistCredentialVault(); } catch (error: unknown) { console.error('[main] 保存系统凭证失败:', errorMessage(error)); }
}

function redactLogText(input: unknown): string {
  let text = String(input || '');
  for (const value of Object.values(credentialVault)) {
    for (const field of LOG_SECRET_FIELDS) {
      const secret = String(value?.[field] || '');
      if (secret.length >= 4) text = text.split(secret).join('[REDACTED]');
    }
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|key|token)-[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    // Electron persists backend stdout/stderr for offline diagnostics. Keep
    // stack line/column suffixes useful while removing private home paths.
    .replace(/\/Users\/[^/\s]+(?:\/[^\s:'"),]+)*/g, '[USER_PATH]')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s:'"),]+)*/g, '[USER_PATH]');
}

// FFmpeg 二进制路径（ffmpeg-static 提供，跨平台）
let ffmpegPath = '';
try {
  if (isPackaged) {
    // prepare:desktop 会把当前平台 FFmpeg 实体复制到后端 vendor。electron-builder
    // 会裁剪根 app.asar 中 ffmpeg-static 的可选二进制，因此发布态必须使用这个
    // 已由预检验证、并随 server extraResources 分发的可执行文件。
    ffmpegPath = path.join(serverDir, 'vendor', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (!fs.existsSync(ffmpegPath)) throw new Error(`打包 FFmpeg 不存在: ${ffmpegPath}`);
  } else {
    ffmpegPath = require('ffmpeg-static') || '';
  }
} catch (error: unknown) {
  console.error('[main] 无法解析 ffmpeg-static:', errorMessage(error));
}

let backendProc: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let backendReady = false;
// 后端守护：是否正在主动退出（用户关闭应用），避免崩溃重启逻辑误触发
let isQuitting = false;
// 后端崩溃自动重启的退避计数：连续崩溃则逐步拉长重启间隔，防止疯狂重启
let backendRestarts = 0;
let backendRestartTimer: NodeJS.Timeout | null = null;
let logStream: fs.WriteStream | null = null;

// ---- 探测一个真正空闲的端口：从 startPort 起逐个尝试 bind，成功即返回 ----
// 用 server.listen 实测能否绑定（比 connect 探测更可靠：避开 IPv6 残留监听误判）
function findFreePort(startPort: number, maxTries = 20): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let port = startPort;
    let tries = 0;
    const tryPort = () => {
      if (tries >= maxTries) {
        return reject(new Error(`从 ${startPort} 起连续 ${maxTries} 个端口都被占用`));
      }
      tries++;
      const tester = net.createServer();
      tester.once('error', (err) => {
        tester.close();
        const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
        if (code === 'EADDRINUSE' || code === 'EACCES') {
          port++;
          tryPort();
        } else {
          reject(err);
        }
      });
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      // 桌面后端只绑定 127.0.0.1，端口探测也必须使用同一地址。
      // 仅监听 IPv6 通配地址时，可能与已有的 IPv4 服务同时成功，从而误判端口空闲。
      tester.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

// ---- 启动后端：fork server/app.js，注入数据目录与 FFmpeg 路径 ----
function startBackend() {
  const entry = path.join(serverDir, 'app.js');
  if (!fs.existsSync(entry)) {
    dialog.showErrorBox('启动失败', `找不到后端入口:\n${entry}`);
    app.quit();
    return;
  }

  credentialVault = loadCredentialVault();
  migrateLegacyCredentials();
  const env = Object.assign({}, process.env, {
    // 让 fork 的子进程以纯 Node 运行，而不是再开一个 Electron 实例
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    // 后端监听端口（与主进程健康检查/窗口加载保持一致）
    PORT: String(PORT),
    HOST: '127.0.0.1',
    // 可写数据目录（安装目录通常只读，数据必须放这里）
    DB_PATH: path.join(dataDir, 'database.sqlite'),
    SETTINGS_FILE: path.join(dataDir, 'settings.json'),
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
    // 前端构建产物：由后端同源托管
    CLIENT_DIST: clientDist,
    // FFmpeg 二进制（打包进安装包，无需用户自装）
    FFMPEG_PATH: ffmpegPath || 'ffmpeg',
    // better-sqlite3 由 electron-builder 按 Electron ABI 重建并放在 app
    // node_modules；其他后端依赖继续来自受管 vendor。顺序不可交换，避免
    // 误加载 server 安装阶段为普通 Node ABI 编译的 native addon。
    NODE_PATH: [path.join(app.getAppPath(), 'node_modules'), path.join(serverDir, 'vendor')].join(path.delimiter),
    // 开发态保留 sql.js，避免普通 npm install 的 Node ABI 与 Electron ABI
    // 不同；发布包必须使用已重建的 better-sqlite3，加载失败时直接暴露问题。
    DB_DRIVER: isPackaged ? 'better-sqlite3' : 'sqljs',
    // 桌面应用同源，无跨域；放行本地
    CORS_ORIGIN: `http://localhost:${PORT},http://127.0.0.1:${PORT}`,
    // 仅通过子进程启动环境传递一次，服务读取后会立即删除；不会写日志或配置文件。
    AIGC_CREDENTIALS_B64: Buffer.from(JSON.stringify(credentialVault)).toString('base64'),
  });

  const child = fork(entry, [], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  backendProc = child;
  child.on('message', (message: unknown) => {
    handleCredentialMessage(message);
    if (isJsonObject(message) && message.type === 'server-ready' && Number(message.port) === PORT) handleBackendReady();
  });

  // 后端日志落盘：stdout/stderr 同时写控制台与用户数据目录/logs/backend.log，
  // 这样后端崩溃时的报错栈能保留下来，便于事后排查（否则崩溃信息随进程消失）。
  const writeLog = (prefix: 'OUT' | 'ERR', chunk: unknown): void => {
    const safeChunk = redactLogText(chunk);
    const line = `[${new Date().toISOString()}] ${prefix} ${safeChunk}`;
    process.stdout.write(`[backend] ${safeChunk}`);
    try { if (logStream) logStream.write(line); } catch (_) {}
  };
  child.stdout?.on('data', (data: Buffer) => writeLog('OUT', data));
  child.stderr?.on('data', (data: Buffer) => writeLog('ERR', data));

  child.on('exit', (code, signal) => {
    const msg = `[main] 后端进程退出 code=${code} signal=${signal}\n`;
    try { if (logStream) logStream.write(`[${new Date().toISOString()}] ${msg}`); } catch (_) {}
    console.log(msg.trim());
    if (!isQuitting) telemetry.captureException(new Error('Backend process exited unexpectedly'), { code, signal, restart: backendRestarts + 1 });
    backendProc = null;
    // 主动退出（用户关闭应用）不重启；否则视为崩溃，带退避自动拉起，避免软件假死。
    if (isQuitting) return;
    backendRestarts += 1;
    if (backendRestarts > 10) {
      try { if (logStream) logStream.write(`[${new Date().toISOString()}] [main] 后端连续崩溃超过 10 次，停止自动重启\n`); } catch (_) {}
      dialog.showErrorBox('后端服务异常', '后端服务多次崩溃，已停止自动重启。请重启应用，并将 logs/backend.log 反馈给开发者。');
      return;
    }
    // 退避：1s/2s/.../最多 10s，连续崩溃越多间隔越长
    const delay = Math.min(backendRestarts * 1000, 10000);
    console.log(`[main] ${delay}ms 后自动重启后端（第 ${backendRestarts} 次）`);
    backendRestartTimer = setTimeout(() => { if (!isQuitting) startBackend(); }, delay);
  });

  // 后端成功就绪一段时间后清零重启计数：把"偶发单次崩溃"与"启动即反复崩溃"区分开
  setTimeout(() => { if (backendProc) backendRestarts = 0; }, 60000).unref();
}

// ---- 健康检查：轮询 /api/health，就绪后回调 ----
function waitForBackend(onReady: () => void, attempt = 0): void {
  if (backendReady || didOpenMainWindow || isQuitting) return;
  const MAX = 60; // 最多等 ~30s
  const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
    res.resume();
    if (res.statusCode === 200) {
      backendReady = true;
      onReady();
    } else {
      retry();
    }
  });
  req.on('error', retry);
  req.setTimeout(1500, () => { req.destroy(); });

  function retry() {
    // IPC 就绪信号可能比本次 HTTP 请求先抵达；成功后必须停止旧计时链。
    if (backendReady || didOpenMainWindow || isQuitting) return;
    if (attempt >= MAX) {
      dialog.showErrorBox('启动超时', '后端服务未能在预期时间内就绪，请重启应用。');
      app.quit();
      return;
    }
    setTimeout(() => waitForBackend(onReady, attempt + 1), 500);
  }
}

let didOpenMainWindow = false;
function handleBackendReady() {
  if (didOpenMainWindow || isQuitting) return;
  didOpenMainWindow = true;
  backendReady = true;
  createWindow();
  if (splash) { splash.close(); splash = null; }
  configureAutoUpdates();
}

// ---- 应用菜单（中英双语，跟随界面语言切换） ----
// 默认中文；前端切换语言时通过 IPC 'app:set-locale' 通知主进程重建
let currentLocale: DesktopLocale = 'zh';
function buildMenu(locale: DesktopLocale): void {
  const zh = locale !== 'en';
  const t = (cn: string, en: string): string => (zh ? cn : en);
  const developerItems: MenuItemConstructorOptions[] = isPackaged
    ? []
    : [{ role: 'toggleDevTools', label: t('开发者工具', 'Developer Tools') }];
  const template: MenuItemConstructorOptions[] = [
    {
      label: t('文件', 'File'),
      submenu: [
        { role: 'quit', label: t('退出', 'Quit') },
      ],
    },
    {
      label: t('编辑', 'Edit'),
      submenu: [
        { role: 'undo', label: t('撤销', 'Undo') },
        { role: 'redo', label: t('重做', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: t('剪切', 'Cut') },
        { role: 'copy', label: t('复制', 'Copy') },
        { role: 'paste', label: t('粘贴', 'Paste') },
        { role: 'selectAll', label: t('全选', 'Select All') },
      ],
    },
    {
      label: t('视图', 'View'),
      submenu: [
        { role: 'reload', label: t('重新加载', 'Reload') },
        { role: 'forceReload', label: t('强制重新加载', 'Force Reload') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('实际大小', 'Actual Size') },
        { role: 'zoomIn', label: t('放大', 'Zoom In') },
        { role: 'zoomOut', label: t('缩小', 'Zoom Out') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('切换全屏', 'Toggle Fullscreen') },
        // 开发者工具仅在非打包（开发）环境暴露，生产环境隐藏以提高逆向门槛
        ...developerItems,
      ],
    },
    {
      label: t('帮助', 'Help'),
      submenu: [
        {
          label: t(`关于 ${PRODUCT_NAME}`, `About ${PRODUCT_NAME}`),
          click: () => {
            const options: MessageBoxOptions = {
              type: 'info',
              title: t('关于', 'About'),
              message: PRODUCT_NAME,
              detail: t(
                `AIGC 辅助的短视频创意生成与制作平台\n版本 ${app.getVersion()}\n作者：王从天降`,
                `AIGC-Assisted Short Video Creation Platform\nVersion ${app.getVersion()}\nAuthor: Wang Congtianjiang`
              ),
              buttons: [t('确定', 'OK')],
            };
            if (mainWindow) void dialog.showMessageBox(mainWindow, options);
            else void dialog.showMessageBox(options);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- 创建主窗口 ----
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: PRODUCT_NAME,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 外部链接用系统浏览器打开，不在应用内导航
  mainWindow = window;
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') shell.openExternal(parsed.toString()).catch(() => {});
    } catch (_) {}
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      if (target.hostname === '127.0.0.1' && Number(target.port) === PORT) return;
    } catch (_) {}
    event.preventDefault();
  });
  // 渲染层异常也要进入桌面日志，否则用户只能看到空白窗口。
  // 输出经过与后端相同的凭证脱敏，不记录 info/debug 级别。
  window.webContents.on('console-message', (details) => {
    const level = String(details.level ?? '').toLowerCase();
    if (!['warning', 'error'].includes(level)) return;
    const message = redactLogText(details.message || 'Renderer console error');
    console.error(`[renderer:${level}] ${message}`);
    try { if (logStream) logStream.write(`[${new Date().toISOString()}] RENDERER ${level} ${message}\n`); } catch (_) {}
  });
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    const error = new Error(`Renderer load failed (${code}): ${description} ${url}`);
    console.error('[renderer]', error.message);
    telemetry.captureException(error, { feature: 'renderer-load' });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    const error = new Error(`Renderer process gone: ${details?.reason || 'unknown'}`);
    console.error('[renderer]', error.message);
    telemetry.captureException(error, { feature: 'renderer-process', exitCode: details?.exitCode });
  });

  // 生产环境反调试：拦截 DevTools 快捷键（F12 / Ctrl+Shift+I/J/C），
  // 并在 DevTools 被以其他方式打开时立即关闭。开发环境完全不限制。
  if (isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      const key = (input.key || '').toLowerCase();
      const isF12 = key === 'f12';
      const isInspect = input.control && input.shift && ['i', 'j', 'c'].includes(key);
      if (isF12 || isInspect) event.preventDefault();
    });
    window.webContents.on('devtools-opened', () => {
      window.webContents.closeDevTools();
    });
  }

  void window.loadURL(`http://127.0.0.1:${PORT}`);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
}

function configureAutoUpdates(): void {
  const disabledByEnvironment = process.env.DISABLE_AUTO_UPDATE === '1'
    || process.env.AIGC_DISABLE_AUTO_UPDATE === '1';
  const configured = fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  const confirmDownload = async (info: UpdateInfoLike): Promise<boolean> => {
    const options: MessageBoxOptions = {
      type: 'info',
      title: '发现新版本',
      message: `AIGC 视频工作台 ${info.version} 已发布`,
      detail: '是否现在下载？下载不会中断当前创作任务。',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    return result.response === 0;
  };
  const confirmInstall = async (info: UpdateInfoLike): Promise<boolean> => {
    const options: MessageBoxOptions = {
      type: 'info',
      title: '更新已下载',
      message: `版本 ${info.version} 已准备完成`,
      detail: '立即重启会先关闭本地后端；选择稍后将在正常退出后安装。',
      buttons: ['重启并安装', '退出时安装'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    return result.response === 0;
  };
  try {
    const service = new DesktopUpdateService(autoUpdater, {
      enabled: isPackaged && !disabledByEnvironment,
      configured,
      confirmDownload,
      confirmInstall,
      log: (message) => console.log(message),
      onState: (state) => {
        if (state.status === 'unconfigured') console.log('[update] 当前构建未配置自动更新');
        if (state.status === 'downloading' && state.percent != null) {
          console.log(`[update] 下载进度 ${state.percent.toFixed(1)}%`);
        }
      },
      onError: (error, state) => {
        console.error(`[update] ${state.errorCode}:`, telemetry.redact(error.message));
        telemetry.captureException(error, { feature: 'auto-update', code: state.errorCode });
      },
    });
    service.start();
  } catch (error: unknown) {
    console.error('[update] 初始化失败:', telemetry.redact(errorMessage(error)));
  }
}

function createProductSplash(): void {
  splash = new BrowserWindow({
    width: 480,
    height: 360,
    frame: false,
    resizable: false,
    backgroundColor: '#101827',
    show: true,
    center: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
    *{box-sizing:border-box}body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#243761,#101827 65%);color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.wrap{text-align:center}.mark{width:112px;height:86px;margin:0 auto 26px;border:3px solid #72e4ff;border-radius:18px;padding:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;box-shadow:0 0 50px #3c82f655}.mark i{border-radius:6px;background:linear-gradient(145deg,#72e4ff,#8b5cf6);animation:pulse 1.4s ease-in-out infinite alternate}.mark i:nth-child(2),.mark i:nth-child(4){animation-delay:.25s}.mark i:nth-child(3),.mark i:nth-child(5){animation-delay:.5s}h1{font-size:27px;letter-spacing:2px;margin:0}.sub{margin-top:10px;color:#a8b5cc;font-size:13px}.bar{margin:24px auto 0;width:230px;height:5px;background:#ffffff18;border-radius:5px;overflow:hidden}.bar::after{content:'';display:block;width:42%;height:100%;background:linear-gradient(90deg,#72e4ff,#8b5cf6);animation:load 1.35s ease-in-out infinite}@keyframes pulse{to{opacity:.4;transform:scale(.88)}}@keyframes load{from{transform:translateX(-110%)}to{transform:translateX(350%)}}</style></head><body><main class="wrap"><div class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><h1>${PRODUCT_NAME}</h1><div class="sub">正在恢复创作空间与媒体任务…</div><div class="bar"></div></main></body></html>`;
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

let splash: BrowserWindow | null = null;
// ---- 退出清理：杀掉后端子进程 ----
function cleanup(): void {
  // 标记主动退出：阻止 backendProc.on('exit') 里的崩溃自动重启逻辑
  isQuitting = true;
  if (backendRestartTimer) { clearTimeout(backendRestartTimer); backendRestartTimer = null; }
  if (backendProc) {
    try { backendProc.kill('SIGTERM'); } catch (_) {}
    backendProc = null;
  }
  try { if (logStream) { logStream.end(); logStream = null; } } catch (_) {}
}

// 单实例锁：防止重复启动抢占 3000 端口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Electron does not always expose Chromium WebContents to macOS accessibility
    // clients until assistive technology has already connected. Keep the renderer
    // discoverable from first paint so keyboard users and desktop smoke tests can
    // navigate the actual Vue controls instead of only the native window chrome.
    app.setAccessibilitySupportEnabled(true);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // 初始菜单（中文）；前端加载后会通过 IPC 同步真实语言
    buildMenu(currentLocale);
    const isTrustedSender = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
      try {
        const source = new URL(event.senderFrame?.url || '');
        return source.protocol === 'http:' && source.hostname === '127.0.0.1' && Number(source.port) === PORT;
      } catch { return false; }
    };
    // 监听前端语言切换：重建菜单使其与界面语言一致
    ipcMain.on('app:set-locale', (event, locale: unknown) => {
      if (!isTrustedSender(event)) return;
      const parsed = DesktopLocaleSchema.safeParse(locale);
      if (!parsed.success) return;
      currentLocale = parsed.data;
      buildMenu(currentLocale);
    });
    ipcMain.handle('dialog:select-export-directory', async (event) => {
      if (!isTrustedSender(event)) throw new Error('非法 IPC 来源');
      const window = mainWindow;
      if (!window) throw new Error('主窗口未就绪');
      const result = await dialog.showOpenDialog(window, {
        title: currentLocale === 'en' ? 'Choose export folder' : '选择视频导出位置',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length !== 1) return null;
      const selectedPath = result.filePaths[0];
      return selectedPath ? path.resolve(selectedPath) : null;
    });
    createProductSplash();
    // 先探测空闲端口（3000 被占就顺延），再用最终端口拉起后端 + 加载窗口，三者一致
    try {
      const free = await findFreePort(PORT);
      if (free !== PORT) {
        console.log(`[main] 端口 ${PORT} 被占用，自动改用 ${free}`);
        PORT = free;
      }
    } catch (error: unknown) {
      dialog.showErrorBox('启动失败', `找不到可用端口：${errorMessage(error)}`);
      app.quit();
      return;
    }
    // 打开后端日志文件（追加模式）：记录后端 stdout/stderr 与崩溃/重启事件
    try {
      logStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
      logStream.write(`\n[${new Date().toISOString()}] ===== ${PRODUCT_NAME} 启动，PORT=${PORT} =====\n`);
    } catch (error: unknown) {
      console.error('[main] 无法打开后端日志文件:', errorMessage(error));
    }
    startBackend();
    // IPC 是主要就绪信号；HTTP 健康检查作为子进程消息丢失时的兜底。
    waitForBackend(handleBackendReady);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && backendReady) createWindow();
    });
  });

  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', cleanup);
  app.on('quit', cleanup);
  process.on('exit', cleanup);
}
