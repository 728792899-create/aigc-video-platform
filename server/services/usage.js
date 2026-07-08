/**
 * Provider 用量/失败统计（升级方案 v3 第四期）
 *
 * 轻量计数器：每次调用某 provider 成功/失败各记一次，持久化到 db/usage.json。
 * 设计原则：
 *  - 纯旁路：记账失败绝不影响主流程（全部 try/catch 吞掉）。
 *  - 节流写盘：内存累加 + 1s debounce 落盘，避免高频 IO。
 *  - 维度：key = `${kind}:${provider}`，记 ok/fail/last_ms/last_error/last_at。
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

const USAGE_FILE = path.join(path.dirname(config.SETTINGS_FILE), 'usage.json');

let stats = {};       // { "llm:deepseek": { ok, fail, last_ms, last_error, last_at } }
let dirty = false;
let timer = null;

function load() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      stats = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')) || {};
    }
  } catch (e) {
    console.error('[usage] 读取 usage.json 失败:', e.message);
    stats = {};
  }
}
load();

function scheduleFlush() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try {
      const dir = path.dirname(USAGE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = USAGE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(stats, null, 2), 'utf-8');
      fs.renameSync(tmp, USAGE_FILE);
    } catch (e) {
      console.error('[usage] 写入 usage.json 失败:', e.message);
    }
  }, 1000);
  if (timer.unref) timer.unref();
}

function bucket(kind, provider) {
  const k = `${kind || '?'}:${provider || '?'}`;
  if (!stats[k]) stats[k] = { ok: 0, fail: 0, last_ms: 0, last_error: '', last_at: 0 };
  return { k, b: stats[k] };
}

/** 记一次成功调用 */
function recordOk(kind, provider, ms) {
  try {
    const { b } = bucket(kind, provider);
    b.ok += 1;
    if (typeof ms === 'number') b.last_ms = Math.round(ms);
    b.last_at = Date.now();
    b.last_error = '';
    scheduleFlush();
  } catch { /* 记账失败不影响主流程 */ }
}

/** 记一次失败调用 */
function recordFail(kind, provider, err, ms) {
  try {
    const { b } = bucket(kind, provider);
    b.fail += 1;
    if (typeof ms === 'number') b.last_ms = Math.round(ms);
    b.last_at = Date.now();
    b.last_error = (err && err.message ? err.message : String(err || '')).slice(0, 200);
    scheduleFlush();
  } catch { /* 记账失败不影响主流程 */ }
}

/**
 * 包装一个 async 函数，自动计时 + 记 ok/fail（成功返回原值，失败原样抛出）。
 * 用法：await usage.track('llm', 'deepseek', () => llm.chat(...))
 */
async function track(kind, provider, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    recordOk(kind, provider, Date.now() - t0);
    return r;
  } catch (e) {
    recordFail(kind, provider, e, Date.now() - t0);
    throw e;
  }
}

/** 取全部统计（拷贝，附带派生字段） */
function getAll() {
  const out = {};
  for (const [k, b] of Object.entries(stats)) {
    const total = b.ok + b.fail;
    out[k] = {
      ...b,
      total,
      success_rate: total ? +((b.ok / total) * 100).toFixed(1) : null,
    };
  }
  return out;
}

/** 清空统计 */
function reset() {
  stats = {};
  scheduleFlush();
}

module.exports = { recordOk, recordFail, track, getAll, reset };
