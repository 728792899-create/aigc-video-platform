/**
 * 系统健康检查（进阶档 F）
 *
 * GET /api/health        - 一次性返回各子系统状态（ffmpeg / 数据库 / AI 文案 / 图片 / 磁盘）
 *
 * 设计原则：
 *  - 只读探测，绝不修改任何数据；单项失败不影响其它项（各自 try/catch）。
 *  - 每项给出 status: ok | warn | error + 人类可读 message + 关键指标。
 *  - 整体 overall 取最差项：有 error → error，有 warn → warn，否则 ok。
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../services/config');
const { getDb } = require('../db');
const registry = require('../services/providers');
const usage = require('../services/usage');
const { resolveFfmpegPath } = require('../utils/ffmpeg');

// 执行命令拿首行输出，带超时（用于 ffmpeg -version 探测）
function probeCommand(cmd, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    let out = '';
    let proc;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      try { if (proc && !proc.killed) proc.kill(); } catch {}
      resolve({ ok, detail });
    };
    try {
      proc = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return finish(false, e.message);
    }
    const timer = setTimeout(() => finish(false, '探测超时'), timeoutMs);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); finish(false, e.message); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0, (out.split('\n')[0] || '').trim());
    });
  });
}

// 递归统计目录大小与文件数（上限保护，避免超大目录卡死）
function dirStats(dir, cap = 200000) {
  let bytes = 0, files = 0, truncated = false;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (files >= cap) { truncated = true; break; }
      const full = path.join(cur, ent.name);
      try {
        if (ent.isDirectory()) stack.push(full);
        else { const st = fs.statSync(full); bytes += st.size; files++; }
      } catch { /* 跳过不可读项 */ }
    }
    if (truncated) break;
  }
  return { bytes, files, truncated };
}

function fmtMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// 各子系统探测函数返回 { key, label, status, message, metrics }
async function checkFfmpeg() {
  const { path: bin, source } = resolveFfmpegPath(config.get('ffmpegPath'));
  const r = await probeCommand(bin, ['-version']);
  if (r.ok) {
    const ver = (r.detail.match(/ffmpeg version (\S+)/) || [])[1] || r.detail;
    return { key: 'ffmpeg', label: '视频合成引擎 (FFmpeg)', status: 'ok',
      message: `可用：${ver}`, metrics: { bin, version: ver, source } };
  }
  return { key: 'ffmpeg', label: '视频合成引擎 (FFmpeg)', status: 'error',
    message: `不可用：${r.detail || '未找到 ffmpeg 可执行文件'}`, metrics: { bin, source } };
}

function checkDatabase() {
  try {
    const db = getDb();
    const projects = db.prepare('SELECT COUNT(*) AS c FROM projects').get().c;
    const storyboards = db.prepare('SELECT COUNT(*) AS c FROM storyboards').get().c;
    const exportsN = db.prepare('SELECT COUNT(*) AS c FROM exports').get().c;
    // 顺手做一次孤儿外键自检
    const orphan = db.prepare(
      'SELECT COUNT(*) AS c FROM storyboards WHERE project_id NOT IN (SELECT id FROM projects)'
    ).get().c;
    return { key: 'database', label: '数据库 (SQLite)',
      status: orphan > 0 ? 'warn' : 'ok',
      message: orphan > 0 ? `连接正常，但检测到 ${orphan} 条孤儿分镜` : '连接正常，外键一致',
      metrics: { projects, storyboards, exports: exportsN, orphan } };
  } catch (e) {
    return { key: 'database', label: '数据库 (SQLite)', status: 'error',
      message: `查询失败：${e.message}`, metrics: {} };
  }
}

function checkDeepseek() {
  const key = config.get('deepseek.apiKey');
  const baseUrl = config.get('deepseek.baseUrl');
  if (!key) {
    return { key: 'deepseek', label: 'AI 文案 (DeepSeek)', status: 'warn',
      message: '未配置 API Key，无法生成分镜脚本', metrics: { baseUrl } };
  }
  return { key: 'deepseek', label: 'AI 文案 (DeepSeek)', status: 'ok',
    message: `已配置（${baseUrl}）`, metrics: { baseUrl, model: config.get('deepseek.model') } };
}

function checkStorage() {
  try {
    const uploadDir = path.resolve(config.get('uploadDir'));
    if (!fs.existsSync(uploadDir)) {
      return { key: 'storage', label: '素材存储', status: 'warn',
        message: '上传目录尚未创建', metrics: { uploadDir } };
    }
    const stats = dirStats(uploadDir);
    return { key: 'storage', label: '素材存储', status: 'ok',
      message: `${fmtMB(stats.bytes)} / ${stats.files} 个文件${stats.truncated ? '（已截断统计）' : ''}`,
      metrics: { uploadDir, bytes: stats.bytes, files: stats.files } };
  } catch (e) {
    return { key: 'storage', label: '素材存储', status: 'error',
      message: `统计失败：${e.message}`, metrics: {} };
  }
}

const RANK = { ok: 0, warn: 1, error: 2 };

// 各 AI provider 配置/用量概览（第四期）：只读，不发真实 API 请求（避免慢/计费）。
// 当前状态只看「是否被路由选中且缺少凭证」。历史失败仅作为明细展示，不再把健康总览染黄。
function checkProviders() {
  const usageAll = usage.getAll();
  const stageModels = config.get('stageModels') || {};
  const KIND_LABEL = { llm: '文案', t2i: '文生图', t2v: '文生视频', tts: '配音' };
  const items = [];
  let worst = 'ok';
  for (const kind of ['llm', 't2i', 't2v', 'tts']) {
    for (const p of registry.listByKind(kind)) {
      const configured = registry.hasCredentials(p.key);
      const userConfigured = registry.hasUserCredentials(p.key);
      const u = usageAll[`${kind}:${p.key}`];
      // 是否被某阶段路由选中
      const routedStage = Object.entries(stageModels).find(([, sel]) => sel && sel.provider === p.key);
      let status = 'ok';
      let msg = configured ? '已配置' : '未配置';
      if (!configured && routedStage) { status = 'error'; msg = `当前阶段「${routedStage[0]}」指向但未配密钥`; }
      else if (!configured) { status = 'ok'; msg = '未配置（未使用）'; }
      if (RANK[status] > RANK[worst]) worst = status;
      const lastError = u && u.last_error ? u.last_error.slice(0, 120) : '';
      items.push({
        key: p.key, label: p.label, kind, kindLabel: KIND_LABEL[kind] || kind,
        configured, userConfigured, free: !!p.free, status, message: msg,
        last_error: lastError,
        last_error_at: lastError ? u.last_at : 0,
        usage: u ? { ok: u.ok, fail: u.fail, success_rate: u.success_rate, last_ms: u.last_ms } : null,
      });
    }
  }
  // edge TTS 本地引擎（不在注册表，单列）
  const edgeU = usageAll['tts:edge'];
  items.push({
    key: 'edge', label: 'Edge TTS（本地·免费）', kind: 'tts', kindLabel: '配音',
    configured: true, free: true, status: 'ok', message: '本地引擎，默认配音',
    last_error: edgeU && edgeU.last_error ? edgeU.last_error.slice(0, 120) : '',
    last_error_at: edgeU && edgeU.last_error ? edgeU.last_at : 0,
    usage: edgeU ? { ok: edgeU.ok, fail: edgeU.fail, success_rate: edgeU.success_rate, last_ms: edgeU.last_ms } : null,
  });
  return {
    key: 'providers', label: 'AI 服务接入', status: worst,
    message: worst === 'ok'
      ? `${items.filter((i) => i.configured).length}/${items.length} 个已配置，当前路由可用`
      : `${items.filter((i) => i.configured).length}/${items.length} 个已配置，当前路由存在缺失凭证`,
    metrics: { items },
  };
}

router.get('/', async (req, res) => {
  const checks = [];
  // 并行做能并行的探测
  const [ffmpeg] = await Promise.all([checkFfmpeg()]);
  checks.push(ffmpeg, checkDatabase(), checkDeepseek(), checkStorage(), checkProviders());

  // 进程运行时信息
  const mem = process.memoryUsage();
  const runtime = {
    status: 'ok', key: 'runtime', label: '后端进程',
    message: `已运行 ${Math.floor(process.uptime() / 60)} 分钟`,
    metrics: {
      uptime_sec: Math.round(process.uptime()),
      rss_mb: +(mem.rss / 1024 / 1024).toFixed(1),
      node: process.version,
      pid: process.pid,
    },
  };
  checks.push(runtime);

  const overall = checks.reduce((acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc), 'ok');
  res.json({ code: 200, data: { overall, checked_at: Date.now(), checks } });
});

module.exports = router;
