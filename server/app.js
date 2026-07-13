require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { initDb } = require('./db');
const config = require('./services/config');
const { securityHeaders, rateLimit } = require('./middleware/security');

// 全局未捕获异常保护，防止进程崩溃
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const app = express();
// 端口：默认 3000；允许通过环境变量 PORT 覆盖（Electron 打包时若 3000 被占可换端口）。
const PORT = parseInt(process.env.PORT, 10) || 3000;
// 监听地址：默认仅绑回环 127.0.0.1（单机桌面应用，无需对局域网暴露 API）。
// 如需远程分离部署，可通过 HOST=0.0.0.0 显式放开。绑回环可避免无鉴权接口被同网他人访问。
const HOST = process.env.HOST || '127.0.0.1';

// 确保上传目录存在（路径来自配置服务：用户配置 → env → 默认 ./uploads）
const uploadDir = path.resolve(config.get('uploadDir'));
const dirs = ['images', 'audio', 'videos', 'temp', 'subtitles'];
dirs.forEach(dir => {
  const dirPath = path.join(uploadDir, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// 全局中间件
// CORS 白名单：从 env CORS_ORIGIN 读取（逗号分隔），未配置时默认放行本地开发端口
const defaultOrigins = [
  'http://localhost:5173', 'http://127.0.0.1:5173', // Vite dev
  'http://localhost:4173', 'http://127.0.0.1:4173', // Vite preview
];
const allowedOrigins = (process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : defaultOrigins);
app.use(cors({
  origin: (origin, callback) => {
    // 无 origin（同源请求、curl、服务端调用）放行
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // 跨域来源不在白名单：标记为 403（禁止），而非落到全局 500
    const corsErr = new Error(`CORS 拒绝来源: ${origin}`);
    corsErr.status = 403;
    return callback(corsErr);
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use(securityHeaders);
// 请求关联 ID：为每个请求生成/透传 X-Request-Id，写入响应头并挂到 req 上，
// 便于错误日志与前端排障关联（约束文档 §10：API 必须有请求 ID/日志关联 ID）。
app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const rid = (typeof incoming === 'string' && incoming.length <= 100 && incoming) || randomUUID();
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use('/uploads', express.static(uploadDir));

// 前端静态托管（Electron 打包 / 生产模式）：
// 若设置了 CLIENT_DIST 环境变量且目录存在，则由后端直接托管前端构建产物。
// 这样桌面应用走同源（localhost:3000），无需 CORS、无需单独的前端 dev 服务。
// 开发模式不设此变量，前端仍由 Vite dev server 提供，行为不变。
const clientDist = process.env.CLIENT_DIST;
if (clientDist && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  console.log(`[static] 托管前端构建产物: ${clientDist}`);
}

// 可选远程部署保护：API_TOKEN 未配置时维持本地单机行为；配置后保护所有 /api/*。
// 健康检查、静态资源与 CORS 预检由中间件显式放行。
app.use(require('./middleware/auth').optionalAuth);

// AI 生成类接口限流：保护高成本的文案/图片/语音/视频生成被刷。
// 只拦截以 generate / auto-produce / voice-preview 开头的写操作，
// 只读端点（/voices /image-models /dreamina-credit）不受限。
const aiLimiter = rateLimit({ windowMs: 60000, max: 60 });
const aiGenerateOnly = (req, res, next) => {
  if (/^\/(generate|auto-produce|voice-preview)/.test(req.path)) return aiLimiter(req, res, next);
  next();
};

// API路由
app.use('/api/projects', require('./routes/projects'));
app.use('/api/storyboards', require('./routes/storyboards'));
app.use('/api/images', require('./routes/images'));
app.use('/api/audio', require('./routes/audio'));
app.use('/api/video', require('./routes/video'));
app.use('/api/ai', aiGenerateOnly, require('./routes/ai'));
app.use('/api/subtitle', require('./routes/subtitle'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/history', require('./routes/history'));
app.use('/api/files', require('./routes/files'));
app.use('/api/trash', require('./routes/trash'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/media', require('./routes/media'));
app.use('/api/providers', require('./routes/providers'));
app.use('/api/health', require('./routes/health'));
app.use('/api/presets', require('./routes/presets'));
app.use('/api/skills', require('./routes/skills'));
app.use('/api/characters', require('./routes/characters'));
app.use('/api/snapshots', require('./routes/snapshots'));
app.use('/api/system', require('./routes/system'));

// SPA history 路由回退：非 /api、非 /uploads 的 GET 请求统一返回前端 index.html，
// 让 Vue Router 接管前端路由（刷新 /projects 等深层路由不会 404）。
// 仅在托管了前端构建产物时启用（CLIENT_DIST 已设置），开发模式不影响。
if (clientDist && fs.existsSync(clientDist)) {
  const indexHtml = path.join(clientDist, 'index.html');
  app.get(/^(?!\/api|\/uploads).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(indexHtml);
  });
}

// 全局错误处理
app.use((err, req, res, next) => {
  // 客户端错误（畸形 JSON、请求体过大、CORS 拒绝等）属于预期输入问题，
  // 只记一行简讯，不打完整堆栈，避免污染错误日志、掩盖真正的服务端 bug。
  const isClientError =
    err.type === 'entity.parse.failed' ||      // body-parser 畸形 JSON
    err.type === 'entity.too.large' ||          // 请求体超限
    err instanceof SyntaxError ||               // JSON 解析异常
    /^CORS/.test(err.message || '');            // CORS 拒绝
  const status = err.status || err.statusCode || (isClientError ? 400 : 500);
  if (isClientError) {
    console.warn(`[client-error ${status}] [rid:${req.requestId}] ${req.method} ${req.originalUrl}: ${err.message}`);
  } else {
    console.error(`[rid:${req.requestId}]`, err.stack);
  }
  if (res.headersSent) return next(err);
  res.status(status).json({
    code: status,
    data: null,
    message: err.message || '服务器内部错误',
    requestId: req.requestId,
  });
});

// 启动服务器（先初始化数据库）
async function start() {
  await initDb();
  // DB 就绪后恢复历史任务（pending/running 已在 initDb 中标记为 interrupted）
  try {
    require('./services/taskManager').loadFromDb();
  } catch (e) {
    console.error('[startup] 任务恢复失败:', e.message);
  }
  // 回收站自动清理：启动清一次 + 每 6 小时清一次超过保留期(7天)的条目
  try {
    const trash = require('./services/trash');
    const n = trash.autoClean();
    if (n) console.log(`[startup] 回收站自动清理 ${n} 个过期条目`);
    setInterval(() => {
      try { trash.autoClean(); } catch (e) { console.error('[trash] 自动清理失败:', e.message); }
    }, 6 * 60 * 60 * 1000);
  } catch (e) {
    console.error('[startup] 回收站清理初始化失败:', e.message);
  }
  const server = app.listen(PORT, HOST, () => {
    console.log(`服务器运行在 http://${HOST}:${PORT}`);
  });

  // 优雅关闭：收到终止信号时停止接收新连接，待现有请求结束再退出，
  // 给 DB 写盘留出时间，避免 PM2 重启时丢数据/损坏。
  const shutdown = (sig) => {
    console.log(`[shutdown] 收到 ${sig}，正在优雅关闭...`);
    server.close(() => {
      try { require('./db').saveDb?.(); } catch (_) {}
      console.log('[shutdown] HTTP 服务已关闭，进程退出');
      process.exit(0);
    });
    // 兜底：5s 内未关完则强制退出
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});

module.exports = app;
