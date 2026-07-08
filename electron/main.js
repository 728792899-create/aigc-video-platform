// ============================================================
//  史努比大王 - Electron 主进程
//  职责：拉起后端(Express) → 等健康检查通过 → 开窗口加载前端 → 退出时清理
// ============================================================
const { app, BrowserWindow, dialog, shell, Menu, ipcMain } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

// 后端端口：默认从 3000 起探测空闲端口，允许通过 SNOOPY_PORT 指定起始端口
// 注意：这是“起始值”，若被占用会自动 +1 顺延，实际端口由 findFreePort 决定
let PORT = parseInt(process.env.SNOOPY_PORT, 10) || 3000;
const isPackaged = app.isPackaged;

// ---- 路径解析：开发模式用项目目录，打包后用 resources / userData ----
// 后端代码位置
const serverDir = isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..', 'server');
// 前端构建产物位置
const clientDist = isPackaged
  ? path.join(process.resourcesPath, 'client', 'dist')
  : path.join(__dirname, '..', 'client', 'dist');

// 用户数据目录（可写）：%APPDATA%/史努比大王/
const userDataDir = app.getPath('userData');
const dataDir = path.join(userDataDir, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
// 日志目录（可写）：%APPDATA%/史努比大王/logs/ —— 后端崩溃信息落盘到此，便于排查
const logsDir = path.join(userDataDir, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const backendLogPath = path.join(logsDir, 'backend.log');

// FFmpeg 二进制路径（ffmpeg-static 提供，跨平台）
let ffmpegPath = '';
try {
  ffmpegPath = require('ffmpeg-static') || '';
  // asar:true 时 ffmpeg-static 返回的路径指向 app.asar 内部，但二进制实际被
  // asarUnpack 解包到 app.asar.unpacked。必须把路径重定向到 unpacked，否则
  // fork 的后端子进程拿到 asar 内路径无法作为外部进程执行 FFmpeg。
  if (ffmpegPath && ffmpegPath.includes('app.asar') && !ffmpegPath.includes('app.asar.unpacked')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
} catch (e) {
  console.error('[main] 无法解析 ffmpeg-static:', e.message);
}

let backendProc = null;
let mainWindow = null;
let backendReady = false;
// 后端守护：是否正在主动退出（用户关闭应用），避免崩溃重启逻辑误触发
let isQuitting = false;
// 后端崩溃自动重启的退避计数：连续崩溃则逐步拉长重启间隔，防止疯狂重启
let backendRestarts = 0;
let backendRestartTimer = null;
let logStream = null;

// ---- 探测一个真正空闲的端口：从 startPort 起逐个尝试 bind，成功即返回 ----
// 用 server.listen 实测能否绑定（比 connect 探测更可靠：避开 IPv6 残留监听误判）
function findFreePort(startPort, maxTries = 20) {
  return new Promise((resolve, reject) => {
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
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          port++;
          tryPort();
        } else {
          reject(err);
        }
      });
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      // 不指定 host：与后端 app.listen(PORT) 一致（默认绑定通配 ::），
      // 否则绑 127.0.0.1 时探不出 0.0.0.0/[::] 上的占用，导致误判可用
      tester.listen(port);
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

  const env = Object.assign({}, process.env, {
    // 让 fork 的子进程以纯 Node 运行，而不是再开一个 Electron 实例
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    // 后端监听端口（与主进程健康检查/窗口加载保持一致）
    PORT: String(PORT),
    // 可写数据目录（安装目录通常只读，数据必须放这里）
    DB_PATH: path.join(dataDir, 'database.sqlite'),
    SETTINGS_FILE: path.join(dataDir, 'settings.json'),
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
    // 前端构建产物：由后端同源托管
    CLIENT_DIST: clientDist,
    // FFmpeg 二进制（打包进安装包，无需用户自装）
    FFMPEG_PATH: ffmpegPath || 'ffmpeg',
    // 桌面应用同源，无跨域；放行本地
    CORS_ORIGIN: `http://localhost:${PORT},http://127.0.0.1:${PORT}`,
  });

  backendProc = fork(entry, [], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  // 后端日志落盘：stdout/stderr 同时写控制台与 %APPDATA%/史努比大王/logs/backend.log，
  // 这样后端崩溃时的报错栈能保留下来，便于事后排查（否则崩溃信息随进程消失）。
  const writeLog = (prefix, chunk) => {
    const line = `[${new Date().toISOString()}] ${prefix} ${chunk}`;
    process.stdout.write(`[backend] ${chunk}`);
    try { if (logStream) logStream.write(line); } catch (_) {}
  };
  backendProc.stdout.on('data', d => writeLog('OUT', d));
  backendProc.stderr.on('data', d => writeLog('ERR', d));

  backendProc.on('exit', (code, signal) => {
    const msg = `[main] 后端进程退出 code=${code} signal=${signal}\n`;
    try { if (logStream) logStream.write(`[${new Date().toISOString()}] ${msg}`); } catch (_) {}
    console.log(msg.trim());
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
function waitForBackend(onReady, attempt = 0) {
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
    if (attempt >= MAX) {
      dialog.showErrorBox('启动超时', '后端服务未能在预期时间内就绪，请重启应用。');
      app.quit();
      return;
    }
    setTimeout(() => waitForBackend(onReady, attempt + 1), 500);
  }
}

// ---- 应用菜单（中英双语，跟随界面语言切换） ----
// 默认中文；前端切换语言时通过 IPC 'app:set-locale' 通知主进程重建
let currentLocale = 'zh';
function buildMenu(locale) {
  const zh = locale !== 'en';
  const t = (cn, en) => (zh ? cn : en);
  const template = [
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
        ...(isPackaged ? [] : [{ role: 'toggleDevTools', label: t('开发者工具', 'Developer Tools') }]),
      ],
    },
    {
      label: t('帮助', 'Help'),
      submenu: [
        {
          label: t('关于 史努比大王', 'About 史努比大王'),
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: t('关于', 'About'),
              message: '史努比大王',
              detail: t(
                `AIGC 辅助的短视频创意生成与制作平台\n版本 ${app.getVersion()}\n作者：王从天降`,
                `AIGC-Assisted Short Video Creation Platform\nVersion ${app.getVersion()}\nAuthor: Wang Congtianjiang`
              ),
              buttons: [t('确定', 'OK')],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- 创建主窗口 ----
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: '史努比大王',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 外部链接用系统浏览器打开，不在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 生产环境反调试：拦截 DevTools 快捷键（F12 / Ctrl+Shift+I/J/C），
  // 并在 DevTools 被以其他方式打开时立即关闭。开发环境完全不限制。
  if (isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = (input.key || '').toLowerCase();
      const isF12 = key === 'f12';
      const isInspect = input.control && input.shift && ['i', 'j', 'c'].includes(key);
      if (isF12 || isInspect) event.preventDefault();
    });
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---- 启动期加载窗口（绚丽启动画面：极光背景+动态小狗+光效） ----
let splash = null;
function createSplash() {
  splash = new BrowserWindow({
    width: 480, height: 420, frame: false, resizable: false,
    backgroundColor: '#1a0b3b', show: true, center: true, transparent: false,
  });
  const html = `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;overflow:hidden;font-family:'Microsoft YaHei',sans-serif}body{display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(125deg,#1a0b3b,#3b0a5e,#7209b7,#3a0ca3,#4361ee,#1a0b3b);background-size:400% 400%;animation:aurora 12s ease infinite;position:relative}@keyframes aurora{0%{background-position:0 50%}50%{background-position:100% 50%}100%{background-position:0 50%}}.glow{position:absolute;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(247,37,133,.45),rgba(114,9,183,.25)40%,transparent 70%);filter:blur(20px);animation:spin 9s linear infinite;z-index:0}.glow2{position:absolute;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(76,201,240,.4),rgba(67,97,238,.2)45%,transparent 70%);filter:blur(24px);animation:spin 14s linear infinite reverse;z-index:0}@keyframes spin{from{transform:rotate(0)scale(1)}50%{transform:rotate(180deg)scale(1.15)}to{transform:rotate(360deg)scale(1)}}.particles{position:absolute;inset:0;z-index:1;pointer-events:none}.p{position:absolute;border-radius:50%;opacity:0;animation:float 6s ease-in infinite}@keyframes float{0%{transform:translateY(40px)scale(.3);opacity:0}20%{opacity:1}100%{transform:translateY(-220px)scale(1);opacity:0}}.stage{position:relative;z-index:3;display:flex;flex-direction:column;align-items:center}.ring{position:absolute;top:-26px;width:210px;height:210px;border-radius:50%;border:3px dashed rgba(76,201,240,.55);animation:spin2 8s linear infinite;z-index:2}.ring::before{content:'';position:absolute;inset:14px;border-radius:50%;border:2px dotted rgba(247,37,133,.5)}@keyframes spin2{to{transform:rotate(360deg)}}.dog{animation:hop .9s ease-in-out infinite;transform-origin:50% 92%;filter:drop-shadow(0 8px 16px rgba(0,0,0,.45))}@keyframes hop{0%,100%{transform:translateY(0)scaleY(1)}30%{transform:translateY(-16px)scaleY(1.05)}55%{transform:translateY(0)scaleY(.95)}70%{transform:translateY(-5px)}}.tail{transform-origin:88px 78px;animation:wag .3s ease-in-out infinite}@keyframes wag{0%,100%{transform:rotate(-20deg)}50%{transform:rotate(22deg)}}.ear-l{transform-origin:52px 40px;animation:flop .9s ease-in-out infinite}.ear-r{transform-origin:76px 40px;animation:flop .9s ease-in-out infinite}@keyframes flop{0%,100%{transform:rotate(0)}30%{transform:rotate(-9deg)}60%{transform:rotate(6deg)}}.shadow{transform-origin:center;animation:sh .9s ease-in-out infinite}@keyframes sh{0%,100%{transform:scaleX(1);opacity:.4}30%{transform:scaleX(.65);opacity:.2}}.title{margin-top:30px;font-size:30px;font-weight:800;letter-spacing:4px;background:linear-gradient(90deg,#f72585,#ff9e00,#4cc9f0,#b5179e,#f72585);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 3s linear infinite;text-shadow:0 2px 20px rgba(247,37,133,.3)}@keyframes shine{to{background-position:200% center}}.slogan{margin-top:6px;font-size:12px;letter-spacing:6px;color:rgba(255,255,255,.55)}.bar{margin-top:22px;width:240px;height:6px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden}.bar i{display:block;height:100%;width:40%;border-radius:6px;background:linear-gradient(90deg,#4cc9f0,#f72585,#ff9e00);animation:load 1.6s ease-in-out infinite}@keyframes load{0%{margin-left:-40%}100%{margin-left:100%}}.sub{margin-top:14px;font-size:13px;color:rgba(255,255,255,.7)}.dots span{animation:blink 1.2s infinite both}.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}</style><body><div class="glow"></div><div class="glow2"></div><div class="particles"id="ps"></div><div class="stage"><div class="ring"></div><svg width="170"height="140"viewBox="0 0 140 120"class="dog"><ellipse class="shadow"cx="70"cy="112"rx="36"ry="6"fill="#000"/><g><path class="tail"d="M86 76 q18 -6 22 -20 q4 10 -4 20 q-8 8 -18 6 z"fill="#fff"/><ellipse cx="60"cy="74"rx="34"ry="24"fill="#fff"/><ellipse cx="60"cy="80"rx="20"ry="12"fill="#ffe5f1"/><rect x="40"y="88"width="9"height="16"rx="4"fill="#fff"/><rect x="66"y="88"width="9"height="16"rx="4"fill="#fff"/><circle cx="64"cy="44"r="26"fill="#fff"/><ellipse class="ear-l"cx="46"cy="42"rx="9"ry="20"fill="#222"/><ellipse class="ear-r"cx="82"cy="42"rx="9"ry="20"fill="#222"/><circle cx="56"cy="40"r="3.6"fill="#111"/><circle cx="72"cy="40"r="3.6"fill="#111"/><circle cx="57"cy="39"r="1"fill="#fff"/><circle cx="73"cy="39"r="1"fill="#fff"/><ellipse cx="64"cy="52"rx="5"ry="4"fill="#111"/><path d="M64 56 q-6 7 -12 3 M64 56 q6 7 12 3"stroke="#111"stroke-width="1.6"fill="none"stroke-linecap="round"/><ellipse cx="50"cy="50"rx="4"ry="2.5"fill="#ffb3c8"opacity=".7"/><ellipse cx="78"cy="50"rx="4"ry="2.5"fill="#ffb3c8"opacity=".7"/></g></svg><div class="title">史努比大王</div><div class="slogan">AIGC 短视频创意工坊</div><div class="bar"><i></i></div><div class="sub">正在启动服务，请稍候<span class="dots"><span>.</span><span>.</span><span>.</span></span></div></div><script>var colors=['#f72585','#4cc9f0','#ff9e00','#b5179e','#4361ee','#fff'],box=document.getElementById('ps');for(var i=0;i<26;i++){var d=document.createElement('div');d.className='p';var s=3+Math.random()*5;d.style.width=s+'px';d.style.height=s+'px';d.style.left=Math.random()*100+'%';d.style.bottom='-10px';d.style.background=colors[i%colors.length];d.style.boxShadow='0 0 8px '+colors[i%colors.length];d.style.animationDelay=Math.random()*6+'s';d.style.animationDuration=4+Math.random()*4+'s';box.appendChild(d)}</script></body>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// ---- 退出清理：杀掉后端子进程 ----
function cleanup() {
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
    // 初始菜单（中文）；前端加载后会通过 IPC 同步真实语言
    buildMenu(currentLocale);
    // 监听前端语言切换：重建菜单使其与界面语言一致
    ipcMain.on('app:set-locale', (_e, locale) => {
      currentLocale = locale === 'en' ? 'en' : 'zh';
      buildMenu(currentLocale);
    });
    createSplash();
    // 先探测空闲端口（3000 被占就顺延），再用最终端口拉起后端 + 加载窗口，三者一致
    try {
      const free = await findFreePort(PORT);
      if (free !== PORT) {
        console.log(`[main] 端口 ${PORT} 被占用，自动改用 ${free}`);
        PORT = free;
      }
    } catch (e) {
      dialog.showErrorBox('启动失败', `找不到可用端口：${e.message}`);
      app.quit();
      return;
    }
    // 打开后端日志文件（追加模式）：记录后端 stdout/stderr 与崩溃/重启事件
    try {
      logStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
      logStream.write(`\n[${new Date().toISOString()}] ===== 史努比大王 启动，PORT=${PORT} =====\n`);
    } catch (e) {
      console.error('[main] 无法打开后端日志文件:', e.message);
    }
    startBackend();
    waitForBackend(() => {
      createWindow();
      if (splash) { splash.close(); splash = null; }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && backendReady) createWindow();
    });
  });

  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', cleanup);
  app.on('quit', cleanup);
  process.on('exit', cleanup);
}
