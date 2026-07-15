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
import express from 'express'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { getDb } from '../db'
import { asRecord, errorMessage, sqlNumber, type JsonRecord } from './routeSupport'
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('../services/config');
const registry = require('../services/providers');
const usage = require('../services/usage');
const { resolveFfmpegPath } = require('../utils/ffmpeg');
const credentialStore = require('../services/credentialStore');

// 执行命令拿首行输出，带超时（用于 ffmpeg -version 探测）
interface ProbeResult { ok: boolean; detail: string }
type HealthStatus = 'ok' | 'warn' | 'error'
interface HealthCheck extends JsonRecord {
  key: string
  label: string
  status: HealthStatus
  message: string
  metrics: JsonRecord
  needs_setup?: boolean
  setup_message?: string
}
interface ProviderHealthItem extends JsonRecord {
  kind: string
  configured: boolean
  needs_setup?: boolean
  setup_message?: string
}

function probeCommand(cmd: string, args: string[], timeoutMs = 4000): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let done = false;
    let out = '';
    let proc: ChildProcessWithoutNullStreams | undefined;
    const finish = (ok: boolean, detail: string) => {
      if (done) return;
      done = true;
      try { if (proc && !proc.killed) proc.kill(); } catch {}
      resolve({ ok, detail });
    };
    try {
      proc = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return finish(false, errorMessage(e));
    }
    const timer = setTimeout(() => finish(false, '探测超时'), timeoutMs);
    proc.stdout.on('data', (data: Buffer) => { out += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { out += data.toString(); });
    proc.on('error', (error: Error) => { clearTimeout(timer); finish(false, errorMessage(error)); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0, (out.split('\n')[0] || '').trim());
    });
  });
}

// 递归统计目录大小与文件数（上限保护，避免超大目录卡死）
function dirStats(dir: string, cap = 200000) {
  let bytes = 0, files = 0, truncated = false;
  const stack: string[] = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    if (!cur) continue;
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

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// 各子系统探测函数返回 { key, label, status, message, metrics }
async function checkFfmpeg(): Promise<HealthCheck> {
  const { path: bin, source } = resolveFfmpegPath(config.get('ffmpegPath'));
  const r = await probeCommand(bin, ['-version']);
  if (r.ok) {
    const ver = r.detail.match(/ffmpeg version (\S+)/)?.[1] || r.detail;
    return { key: 'ffmpeg', label: '视频合成引擎 (FFmpeg)', status: 'ok',
      message: `可用：${ver}`, metrics: { bin, version: ver, source } };
  }
  return { key: 'ffmpeg', label: '视频合成引擎 (FFmpeg)', status: 'error',
    message: `不可用：${r.detail || '未找到 ffmpeg 可执行文件'}`, metrics: { bin, source } };
}

function checkDatabase(): HealthCheck {
  try {
    const db = getDb();
    const projects = sqlNumber(db.prepare('SELECT COUNT(*) AS c FROM projects').get()?.c);
    const storyboards = sqlNumber(db.prepare('SELECT COUNT(*) AS c FROM storyboards').get()?.c);
    const exportsN = sqlNumber(db.prepare('SELECT COUNT(*) AS c FROM exports').get()?.c);
    // 顺手做一次孤儿外键自检
    const orphan = db.prepare(
      'SELECT COUNT(*) AS c FROM storyboards WHERE project_id NOT IN (SELECT id FROM projects)'
    ).get()?.c;
    const orphanCount = sqlNumber(orphan);
    return { key: 'database', label: '数据库 (SQLite)',
      status: orphanCount > 0 ? 'warn' : 'ok',
      message: orphanCount > 0 ? `连接正常，但检测到 ${orphanCount} 条孤儿分镜` : '连接正常，外键一致',
      metrics: { projects, storyboards, exports: exportsN, orphan: orphanCount } };
  } catch (e) {
    return { key: 'database', label: '数据库 (SQLite)', status: 'error',
      message: `查询失败：${errorMessage(e)}`, metrics: {} };
  }
}

function checkDeepseek(): HealthCheck {
  const key = registry.hasCredentials('deepseek');
  const baseUrl = config.get('deepseek.baseUrl');
  if (!key) {
    return { key: 'deepseek', label: 'AI 文案 (DeepSeek)', status: 'warn',
      message: '未配置 API Key，无法生成分镜脚本', metrics: { baseUrl } };
  }
  return { key: 'deepseek', label: 'AI 文案 (DeepSeek)', status: 'ok',
    message: `已配置（${baseUrl}）`, metrics: { baseUrl, model: config.get('deepseek.model') } };
}

function checkStorage(): HealthCheck {
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
      message: `统计失败：${errorMessage(e)}`, metrics: {} };
  }
}

const RANK: Record<HealthStatus, number> = { ok: 0, warn: 1, error: 2 };

// 各 AI provider 配置/用量概览（第四期）：只读，不发真实 API 请求（避免慢/计费）。
// 当前状态只看「是否被路由选中且缺少凭证」。历史失败仅作为明细展示，不再把健康总览染黄。
function checkProviders(): HealthCheck {
  const usageAll = usage.getAll();
  const stageModels = asRecord(config.get('stageModels'));
  const KIND_LABEL: Record<string, string> = { llm: '文案', t2i: '文生图', t2v: '文生视频', tts: '配音' };
  const items: ProviderHealthItem[] = [];
  let worst: HealthStatus = 'ok';
  for (const kind of ['llm', 't2i', 't2v', 'tts']) {
    for (const p of registry.listByKind(kind)) {
      const configured = registry.hasCredentials(p.key);
      const userConfigured = registry.hasUserCredentials(p.key);
      const u = usageAll[`${kind}:${p.key}`];
      // 是否被某阶段路由选中
      const routedStage = Object.entries(stageModels).find(([, selection]) => asRecord(selection).provider === p.key);
      let status: HealthStatus = 'ok';
      let msg = configured ? '已配置' : '未配置';
      if (!configured && routedStage) { status = 'warn'; msg = `当前阶段「${routedStage[0]}」指向但未配密钥`; }
      else if (!configured) { status = 'ok'; msg = '未配置（未使用）'; }
      if (RANK[status] > RANK[worst]) worst = status;
      const lastError = u && u.last_error ? credentialStore.redact(u.last_error).slice(0, 120) : '';
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
    last_error: edgeU && edgeU.last_error ? credentialStore.redact(edgeU.last_error).slice(0, 120) : '',
    last_error_at: edgeU && edgeU.last_error ? edgeU.last_at : 0,
    usage: edgeU ? { ok: edgeU.ok, fail: edgeU.fail, success_rate: edgeU.success_rate, last_ms: edgeU.last_ms } : null,
  });
  const demoMode = ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase());
  const hasLlm = items.some((item) => item.kind === 'llm' && item.configured);
  const hasImage = items.some((item) => item.kind === 't2i' && item.configured);
  const needsSetup = !demoMode && (!hasLlm || !hasImage);
  const setupMessage = '首次使用请在「设置 → 模型路由」配置至少一个文案模型和一个生图模型的 API Key。';
  if (needsSetup) {
    for (const item of items) {
      const missingKind = (item.kind === 'llm' && !hasLlm) || (item.kind === 't2i' && !hasImage);
      if (missingKind && !item.configured) {
        item.needs_setup = true;
        item.setup_message = setupMessage;
      }
    }
  }
  return {
    key: 'providers', label: 'AI 服务接入', status: worst,
    message: worst === 'ok'
      ? `${items.filter((i) => i.configured).length}/${items.length} 个已配置，当前路由可用`
      : `${items.filter((i) => i.configured).length}/${items.length} 个已配置，当前路由存在缺失凭证`,
    metrics: { items, needs_setup: needsSetup, setup_message: needsSetup ? setupMessage : '' },
    needs_setup: needsSetup,
    setup_message: needsSetup ? setupMessage : '',
  };
}

router.get('/', async (req, res) => {
  const checks: HealthCheck[] = [];
  // 并行做能并行的探测
  const [ffmpeg] = await Promise.all([checkFfmpeg()]);
  const providerCheck = checkProviders();
  checks.push(ffmpeg, checkDatabase(), checkDeepseek(), checkStorage(), providerCheck);

  // 进程运行时信息
  const mem = process.memoryUsage();
  const runtime: HealthCheck = {
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

  const overall = checks.reduce<HealthStatus>((acc, check) => (
    RANK[check.status] > RANK[acc] ? check.status : acc
  ), 'ok');
  res.json({
    code: 200,
    data: {
      overall,
      checked_at: Date.now(),
      checks,
      needs_setup: !!providerCheck.needs_setup,
      setup_message: providerCheck.setup_message || '',
    },
  });
});

module.exports = router;
