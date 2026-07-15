/**
 * 系统设置接口
 *
 * GET  /api/settings           - 取全部配置（密钥脱敏）
 * POST /api/settings           - 批量更新配置（patch 语义）
 * GET  /api/settings/presets   - API 预设档（官方/中转站等）
 * POST /api/settings/test-api  - 测试 API 连通性（文案/图片）
 */
import express from 'express'
import { execFile } from 'node:child_process'
import { exportRaw, restoreRaw } from '../db'
import { asRecord, errorMessage, type JsonRecord } from './routeSupport'
const router = express.Router();
const config = require('../services/config');
const fs = require('fs');
const path = require('path');
const os = require('os');
const opLog = require('../services/opLog');
const credentialStore = require('../services/credentialStore');
const safeError = (error: unknown): string => credentialStore.redact(errorMessage(error));

// 文案 API 预设档（前端下拉选择自动填 baseUrl）
const DEEPSEEK_PRESETS = [
  { label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'apikey.fun 中转', baseUrl: 'https://api.apikey.fun', model: 'deepseek-chat' },
  { label: '自定义', baseUrl: '', model: 'deepseek-chat' },
];

function maskedSettingsWithRuntime() {
  return { ...credentialStore.applyMasked(config.getAllMasked()), _runtime: { settingsFile: config.SETTINGS_FILE } };
}

function expandUserPath(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

// 取全部配置（脱敏）
router.get('/', (req, res) => {
  res.json({ code: 200, data: maskedSettingsWithRuntime() });
});

// 预设档
router.get('/presets', (req, res) => {
  res.json({ code: 200, data: { deepseek: DEEPSEEK_PRESETS } });
});

// 运行时配置路径（只返回路径，不返回密钥内容）
router.get('/runtime', (req, res) => {
  res.json({ code: 200, data: { settingsFile: config.SETTINGS_FILE } });
});

// 更新配置（patch 语义）
// 注意：值为脱敏占位（以 **** 开头）的字段会被忽略，避免把脱敏串写回覆盖真实密钥
router.post('/', (req, res) => {
  const patch = req.body || {};
  const credentialStore = require('../services/credentialStore');
  const extracted = credentialStore.extractFromConfig(stripMaskedSecrets(config.stripMasked(patch)));
  const cleaned = extracted.clean;
  config.setMany(cleaned);
  // 哪些改动需要重启才能完全生效（已落盘文件路径相关）
  const needRestart = 'uploadDir' in cleaned;
  res.json({
    code: 200,
    data: maskedSettingsWithRuntime(),
    message: needRestart ? '已保存，存储目录变更需重启后端生效' : '已保存',
    needRestart,
  });
});

// 保存默认创作参数：给前端一个稳定的默认值入口，避免散落在多个设置提交里。
router.put('/defaults', (req, res) => {
  const allow = ['defaultImageModel', 'defaultStyle', 'defaultVoice', 'defaultDuration'];
  const patch: JsonRecord = {};
  for (const key of allow) {
    if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ code: 400, data: null, message: '没有可保存的默认设置' });
  }
  config.setMany(patch);
  opLog.log('settings.defaults.update', 'config', null, { fields: Object.keys(patch) });
  res.json({ code: 200, data: maskedSettingsWithRuntime(), message: '默认设置已保存' });
});

// 明确清除某个 Provider 的密钥；普通保存时空 Key 不覆盖旧 Key。
router.post('/keys/clear', (req, res) => {
  const provider = req.body?.provider;
  if (!provider) return res.status(400).json({ code: 400, data: null, message: '缺少 provider' });
  const registry = require('../services/providers');
  const def = registry.getProvider(provider);
  if (!def) return res.status(400).json({ code: 400, data: null, message: `未知 provider：${provider}` });
  const credentialStore = require('../services/credentialStore');
  const existing = config.get(`credentials.${provider}`) || {};
  const next = { ...existing };
  if (def.auth === 'access_secret') {
    next.accessKey = '';
    next.secretKey = '';
  } else {
    next.apiKey = '';
  }
  credentialStore.clear(provider);
  config.setMany({ credentials: { [provider]: next } });
  opLog.log('settings.key.clear', 'provider', provider, null);
  res.json({
    code: 200,
    data: {
      provider,
      configured: registry.hasCredentials(provider),
      userConfigured: registry.hasUserCredentials(provider),
    },
    message: '密钥已清除',
  });
});

// 去掉值为脱敏占位（**** 开头）的密钥字段，避免覆盖真实值
function stripMaskedSecrets(obj: unknown): JsonRecord {
  const clone = structuredClone(asRecord(obj));
  for (const sk of config.SECRET_KEYS) {
    const keys = sk.split('.');
    let cur: JsonRecord | undefined = clone;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur == null) break;
      const next: unknown = cur[keys[i] || ''];
      cur = next && typeof next === 'object' && !Array.isArray(next) ? asRecord(next) : undefined;
    }
    const last = keys[keys.length - 1] || '';
    if (cur && typeof cur[last] === 'string' && cur[last].startsWith('****')) {
      delete cur[last];
    }
  }
  return clone;
}

// 测试 API 连通性
router.post('/test-api', async (req, res) => {
  const { type } = req.body || {};
  const started = Date.now();
  try {
    if (type === 'deepseek') {
      // 优先用请求体里临时传入的配置测（还没保存时也能测），否则用已保存的
      const credentialStore = require('../services/credentialStore');
      const apiKey = req.body.apiKey && !req.body.apiKey.startsWith('****')
        ? req.body.apiKey : credentialStore.get('deepseek').apiKey || config.get('deepseek.apiKey');
      const baseUrl = req.body.baseUrl || config.get('deepseek.baseUrl');
      const model = req.body.model || config.get('deepseek.model');
      if (!apiKey) {
        return res.json({ code: 200, data: { ok: false, message: '未配置 API Key' } });
      }
      const r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(12000),
      });
      const latency = Date.now() - started;
      if (r.ok) {
        return res.json({ code: 200, data: { ok: true, latency, message: `连接成功 (${latency}ms)` } });
      }
      const txt = await r.text();
      return res.json({
        code: 200,
        data: { ok: false, latency, message: require('../services/credentialStore').redact(`HTTP ${r.status}: ${txt.slice(0, 120)}`) },
      });
    }

    if (type === 'pollinations') {
      // ping 一张极小图，验证图片源可达
      const r = await fetch('https://image.pollinations.ai/prompt/ping?width=64&height=64&nologo=true', {
        method: 'GET',
        signal: AbortSignal.timeout(15000),
      });
      const latency = Date.now() - started;
      return res.json({
        code: 200,
        data: { ok: r.ok, latency, message: r.ok ? `连接成功 (${latency}ms)` : `HTTP ${r.status}` },
      });
    }

    return res.status(400).json({ code: 400, message: '未知的测试类型' });
  } catch (e: unknown) {
    const latency = Date.now() - started;
    const details = asRecord(e);
    const message = errorMessage(e);
    const msg = details.name === 'TimeoutError' || /abort/i.test(message) ? '连接超时' : safeError(e);
    return res.json({ code: 200, data: { ok: false, latency, message: msg } });
  }
});

// 校验存储目录是否可用（存在/可写），create=true 时不存在则创建
router.post('/check-dir', (req, res) => {
  const { dir, create } = req.body || {};
  if (!dir || typeof dir !== 'string') {
    return res.status(400).json({ code: 400, message: '缺少目录路径' });
  }
  const target = path.resolve(expandUserPath(dir));
  try {
    if (!fs.existsSync(target)) {
      if (create) {
        fs.mkdirSync(target, { recursive: true });
      } else {
        return res.json({ code: 200, data: { ok: false, exists: false, message: '目录不存在' } });
      }
    }
    // 可写测试
    fs.accessSync(target, fs.constants.W_OK);
    return res.json({ code: 200, data: { ok: true, exists: true, path: target, message: '目录可用' } });
  } catch (e) {
    return res.json({ code: 200, data: { ok: false, message: `不可用: ${safeError(e)}` } });
  }
});

function pickDirectoryNative(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = 120000;
    if (process.platform === 'darwin') {
      execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择视频导出位置")'], { timeout }, (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout || '').trim());
      });
      return;
    }
    if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$dialog.Description = "选择视频导出位置"',
        '$dialog.ShowNewFolderButton = $true',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }',
      ].join('; ');
      execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout, windowsHide: true }, (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout || '').trim());
      });
      return;
    }
    execFile('zenity', ['--file-selection', '--directory', '--title=选择视频导出位置'], { timeout }, (err, stdout) => {
      if (err) return reject(new Error('当前系统未找到可用的目录选择器，请手动输入目录路径'));
      resolve(String(stdout || '').trim());
    });
  });
}

// 打开本机目录选择器。浏览器出于安全限制拿不到绝对路径，所以由本地后端弹系统选择框。
router.post('/pick-dir', async (req, res) => {
  try {
    const selected = await pickDirectoryNative();
    if (!selected) return res.status(400).json({ code: 400, data: null, message: '未选择目录' });
    const target = path.resolve(selected);
    fs.accessSync(target, fs.constants.W_OK);
    res.json({ code: 200, data: { path: target }, message: '目录已选择' });
  } catch (e) {
    const canceled = /User canceled|用户已取消|cancel/i.test(errorMessage(e));
    res.status(canceled ? 400 : 500).json({
      code: canceled ? 400 : 500,
      data: null,
      message: canceled ? '已取消选择目录' : `选择目录失败: ${safeError(e)}`,
    });
  }
});

// 存储空间统计：各类素材目录占用大小和文件数
router.get('/storage-stats', (req, res) => {
  const root = path.resolve(config.get('uploadDir'));
  const subdirs = ['images', 'audio', 'videos', 'subtitles', 'temp'];
  const stats: Record<string, { size: number; count: number }> = {};
  let totalSize = 0;
  let totalFiles = 0;
  for (const sub of subdirs) {
    const dir = path.join(root, sub);
    let size = 0;
    let count = 0;
    try {
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          try {
            const st = fs.statSync(path.join(dir, f));
            if (st.isFile()) { size += st.size; count++; }
          } catch {}
        }
      }
    } catch {}
    stats[sub] = { size, count };
    totalSize += size;
    totalFiles += count;
  }
  res.json({ code: 200, data: { root, totalSize, totalFiles, breakdown: stats } });
});

// 清理临时分段目录（temp）
router.post('/clean-temp', (req, res) => {
  const tempDir = path.join(path.resolve(config.get('uploadDir')), 'temp');
  let removed = 0;
  try {
    if (fs.existsSync(tempDir)) {
      for (const f of fs.readdirSync(tempDir)) {
        try { fs.unlinkSync(path.join(tempDir, f)); removed++; } catch {}
      }
    }
    res.json({ code: 200, data: { removed }, message: `已清理 ${removed} 个临时文件` });
  } catch (e) {
    res.status(500).json({ code: 500, message: safeError(e) });
  }
});

// ============ F8 配置导入导出 / 备份还原 ============

// 导出配置永远脱敏。系统凭证库中的密钥不属于可导出配置。
router.get('/export-config', (req, res) => {
  try {
    const data = maskedSettingsWithRuntime();
    delete data._runtime;
    opLog.log('settings.update', 'config', null, { action: 'export', masked: true });
    res.json({ code: 200, data: { version: 2, exportedAt: Date.now(), secretsIncluded: false, config: data }, message: 'success' });
  } catch (e) {
    res.status(500).json({ code: 500, message: safeError(e) });
  }
});

// 导入配置：body { config: {...} }，合并写入（patch 语义）。脱敏值(****)不覆盖。
router.post('/import-config', (req, res) => {
  try {
    const incoming = (req.body && req.body.config) || req.body;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ code: 400, message: '无效的配置数据' });
    }
    const credentialStore = require('../services/credentialStore');
    const extracted = credentialStore.extractFromConfig(stripMasked(incoming));
    config.setMany(extracted.clean);
    opLog.log('settings.import', 'config', null, { keys: Object.keys(extracted.clean), credentialsMigrated: extracted.extracted });
    res.json({ code: 200, data: config.getAllMasked(), message: '配置已导入' });
  } catch (e) {
    res.status(500).json({ code: 500, message: safeError(e) });
  }
});

// 备份：打包 DB(base64) + 配置 为单个 JSON 信封，前端存为 .aigcbak 文件
router.get('/backup', (req, res) => {
  try {
    const dbBuf = exportRaw();
    const envelope = {
      magic: 'AIGC_BACKUP',
      version: 1,
      createdAt: Date.now(),
      config: config.getAllMasked(),
      secretsIncluded: false,
      db: dbBuf.toString('base64'),
    };
    opLog.log('settings.update', 'backup', null, { action: 'backup', dbBytes: dbBuf.length });
    res.json({ code: 200, data: envelope, message: 'success' });
  } catch (e) {
    res.status(500).json({ code: 500, message: safeError(e) });
  }
});

// 还原：body 为 backup 信封。热替换内存库（免重启）+ 恢复配置。高危操作！
router.post('/restore', (req, res) => {
  try {
    // 容错：接受裸信封，或被 {code,data,message} 包裹的信封
    let env = req.body || {};
    if (env.data && env.data.magic === 'AIGC_BACKUP') env = env.data;
    if (env.magic !== 'AIGC_BACKUP' || !env.db) {
      return res.status(400).json({ code: 400, message: '不是有效的备份文件' });
    }
    const dbBuf = Buffer.from(env.db, 'base64');
    restoreRaw(dbBuf); // 内含完整性校验，失败会抛错
    if (env.config && typeof env.config === 'object') {
      const credentialStore = require('../services/credentialStore');
      const extracted = credentialStore.extractFromConfig(stripMasked(env.config));
      config.setMany(extracted.clean);
    }
    opLog.log('backup.restore', 'backup', null, { dbBytes: dbBuf.length });
    res.json({ code: 200, data: null, message: '备份已还原，数据库已热加载' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '还原失败：' + safeError(e) });
  }
});

// 剥掉脱敏占位值（****开头），避免把掩码写回真实配置
function stripMasked(obj: unknown, prefix = ''): JsonRecord {
  const out: JsonRecord = {};
  for (const [k, v] of Object.entries(asRecord(obj))) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = stripMasked(v, prefix + k + '.');
      if (Object.keys(nested).length) out[k] = nested;
    } else if (typeof v === 'string' && v.startsWith('****')) {
      continue; // 跳过脱敏占位
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = router;
