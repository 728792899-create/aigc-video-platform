#!/usr/bin/env node
/**
 * 启动自检脚本 (preflight)
 * ---------------------------------------------------------------
 * 在启动服务 / 答辩演示前运行，一眼确认运行环境就绪：
 *   ① Node 版本   ② FFmpeg 可用   ③ 端口占用   ④ 上传目录可写
 *   ⑤ 数据库可加载   ⑥ AI Provider 凭证配置概览
 *
 * 运行： cd server && npm run preflight   （或 node scripts/preflight.js）
 * 退出码：全部通过=0；有 error 级问题=1（可用于 CI / 启动门禁）。
 *
 * 全程只读、零副作用，不发会计费的真实 AI 请求。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveFfmpegPath } = require('../utils/ffmpeg');

function resolvePort() {
  const envPort = parseInt(process.env.PORT, 10);
  if (Number.isInteger(envPort) && envPort > 0) return envPort;
  if (process.env.BASE_URL) {
    try {
      const url = new URL(process.env.BASE_URL);
      const basePort = parseInt(url.port, 10);
      if (Number.isInteger(basePort) && basePort > 0) return basePort;
    } catch {
      // Ignore malformed BASE_URL and use the app default.
    }
  }
  return 3000;
}

const PORT = resolvePort();
const results = []; // { level: ok|warn|error, label, detail }
function ok(label, detail) { results.push({ level: 'ok', label, detail }); }
function warn(label, detail) { results.push({ level: 'warn', label, detail }); }
function err(label, detail) { results.push({ level: 'error', label, detail }); }

// ① Node 版本（项目用到原生 fetch / node:test，需 ≥18，推荐 ≥20）
function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 18) ok('Node 运行时', `v${process.versions.node}`);
  else err('Node 运行时', `v${process.versions.node}（需 ≥18，请升级 Node）`);
}

// ② FFmpeg：用配置里的路径或 PATH 中的 ffmpeg 跑 -version
function checkFfmpeg() {
  let configured = 'ffmpeg';
  try { configured = require('../services/config').get('ffmpegPath') || 'ffmpeg'; } catch (_) {}
  const { path: bin, source } = resolveFfmpegPath(configured);
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    err('FFmpeg 合成引擎', `无法执行 "${bin}"（来源：${source}；视频合成将失败，请安装依赖或在设置中指定路径）`);
  } else {
    const ver = (r.stdout.split('\n')[0] || '').trim();
    ok('FFmpeg 合成引擎', `${ver || '可用'}（来源：${source}）`);
  }
}

// ③ 后端端口/服务状态：用 HTTP 探活更可靠（Windows 下 IPv4/IPv6 双栈使 bind 探测易误报）。
//    后端响应 → 已在运行；连接被拒 → 端口空闲可启动；其他 → 警告。
function checkPort() {
  return new Promise((resolve) => {
    const http = require('http');
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 3000 }, (res) => {
      res.resume();
      if (res.statusCode === 200) ok(`后端服务 (端口 ${PORT})`, '已在运行，/api/health 正常');
      else warn(`后端服务 (端口 ${PORT})`, `端口有响应但 /api/health 返回 ${res.statusCode}`);
      resolve();
    });
    r.on('timeout', () => { r.destroy(); warn(`后端服务 (端口 ${PORT})`, '连接超时'); resolve(); });
    r.on('error', (e) => {
      if (e.code === 'ECONNREFUSED') ok(`后端服务 (端口 ${PORT})`, '端口空闲（后端未启动，可启动）');
      else warn(`后端服务 (端口 ${PORT})`, `检测异常：${e.code || e.message}`);
      resolve();
    });
  });
}

// ④ 上传目录：存在且可写（试写一个临时文件再删）
function checkUploadDir() {
  let dir;
  try { dir = require('../services/config').get('uploadDir'); } catch (_) {}
  if (!dir) dir = path.join(__dirname, '..', 'uploads');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.preflight_${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    ok('上传目录', `${dir}（可写）`);
  } catch (e) {
    err('上传目录', `${dir} 不可写：${e.message}`);
  }
}

// ⑤ 数据库：纯只读校验 DB 文件可被 sql.js 加载（绝不调项目 initDb——它会写盘+注册退出钩子，
//    与正在运行的 PM2 进程抢同一个 DB 文件有覆盖风险）。这里只读取磁盘字节、独立实例加载、只查不写。
async function checkDatabase() {
  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', 'db', 'database.sqlite');
  if (!fs.existsSync(dbPath)) {
    warn('数据库 (SQLite)', `${dbPath} 尚不存在（首次启动后端会自动创建）`);
    return;
  }
  try {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const buf = fs.readFileSync(dbPath);
    const db = new SQL.Database(buf); // 只读内存副本，不回写磁盘
    const res = db.exec('SELECT COUNT(*) AS n FROM projects');
    const n = res.length ? res[0].values[0][0] : 0;
    db.close();
    ok('数据库 (SQLite)', `加载成功，现有 ${n} 个项目（只读校验，未改动磁盘）`);
  } catch (e) {
    err('数据库 (SQLite)', `加载失败：${e.message}`);
  }
}

// ⑥ AI Provider 凭证概览：按阶段路由检查所配 provider 是否有凭证（只读配置，不发请求）
function checkProviders() {
  let providers, config;
  try {
    providers = require('../services/providers');
    config = require('../services/config');
  } catch (e) {
    warn('AI 服务接入', `无法读取 Provider 配置：${e.message}`);
    return;
  }
  // 本地免费 provider 无需凭证
  const LOCAL_FREE = new Set(['pollinations', 'dreamina', 'edge', 'static']);
  const stages = config.get('stageModels') || {};
  const stageLabel = { script: '文案', image: '配图', video: '视频', voice: '配音' };
  const lines = [];
  let hasError = false;
  for (const [stage, label] of Object.entries(stageLabel)) {
    const prov = stages[stage] && stages[stage].provider;
    if (!prov) { lines.push(`${label}: 未配置(走默认)`); continue; }
    if (LOCAL_FREE.has(prov)) { lines.push(`${label}: ${prov} ✓(本地免费)`); continue; }
    const configured = providers.hasCredentials(prov);
    lines.push(`${label}: ${prov} ${configured ? '✓已配密钥' : '✗缺密钥'}`);
    if (!configured) hasError = true;
  }
  if (hasError) warn('AI 服务接入（按阶段路由）', lines.join(' | ') + '（缺密钥的阶段会自动降级到免费 provider）');
  else ok('AI 服务接入（按阶段路由）', lines.join(' | '));
}

// ── 报告输出 + 退出码 ───────────────────────────────────────────
const ICON = { ok: '✓', warn: '!', error: '✗' };
function report() {
  console.log('\n========== 启动自检 (preflight) ==========\n');
  for (const r of results) {
    console.log(`  [${ICON[r.level]}] ${r.label}：${r.detail}`);
  }
  const errs = results.filter((r) => r.level === 'error').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  console.log('\n------------------------------------------');
  if (errs > 0) {
    console.log(`  结果：✗ ${errs} 项错误、${warns} 项警告 —— 请先解决错误项再启动。\n`);
    process.exitCode = 1;
  } else {
    console.log(`  结果：✓ 环境就绪${warns ? `（${warns} 项警告，可正常运行）` : ''}。\n`);
    process.exitCode = 0;
  }
  // 不调用 process.exit()：让 sql.js / http handle 自然关闭，避免 Windows 下 UV_HANDLE 断言。
}

(async function main() {
  checkNode();
  checkFfmpeg();
  await checkPort();
  checkUploadDir();
  await checkDatabase();
  checkProviders();
  report();
})();
