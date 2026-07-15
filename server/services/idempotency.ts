/**
 * 幂等性中间件（SQLite 持久化）
 * ------------------------------------------------------------------
 * 约束依据：企业级 AI 约束文档 4.1 —— 涉及核心资产变更的接口必须实现幂等性，
 * 防止用户重复提交 / 网络重放导致重复消耗 AI 配额、生成重复项目。
 *
 * 适用场景：一键成片、生图等"提交即扣资源"的写接口。
 * 工作方式：
 *   1. 客户端在 Header `Idempotency-Key` 或 body.idempotencyKey 传入唯一 token（建议 UUID v4）。
 *   2. 首次请求：放行 handler，并缓存其 JSON 响应。
 *   3. TTL 内携带相同 key 和请求体的重复请求：直接回放首次响应，不再执行 handler。
 *   4. 缺少 key 时：放行但不做幂等保护（向后兼容旧前端，不破坏现有功能）。
 *
 * pending 记录在执行 handler 前强制落盘。这是计费安全边界：进程崩溃后宁可把
 * 结果标成“待核对”，也不能因为内存 Map 丢失而重复调用 Provider。
 */
import { createHash } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import { getDb, saveDb } from '../db'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type JsonObject = Record<string, unknown>

interface IdempotencyOptions {
  ttlMs?: number
  scope?: string
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => key !== 'idempotencyKey')
    .map((key) => [key, stableValue(value[key])]));
}

function requestHash(req: Request, scope: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ method: req.method, scope, body: stableValue(req.body || {}) }))
    .digest('hex');
}

/**
 * 从请求中提取幂等 key（Header 优先，其次 body）。
 */
function extractKey(req: Request): string | null {
  const headerKey = req.get && req.get('Idempotency-Key');
  const bodyKey = req.body && req.body.idempotencyKey;
  const key = (headerKey || bodyKey || '').toString().trim();
  return key || null;
}

function validKey(key: string): boolean {
  return key.length <= 200 && !/[\u0000-\u001f\u007f]/.test(key);
}

function scopeFor(req: Request, configured?: string): string {
  const value = configured || `${req.method}:${req.baseUrl || ''}${req.path || ''}`;
  return String(value).slice(0, 200);
}

/**
 * 幂等中间件工厂。
 * @param {object} opts
 * @param {number} opts.ttlMs 缓存有效期（默认 5 分钟）
 * @returns {import('express').RequestHandler}
 */
function idempotency(opts: IdempotencyOptions = {}): RequestHandler {
  const ttlMs = opts.ttlMs || DEFAULT_TTL_MS;

  return function idempotencyMiddleware(req, res, next) {
    const key = extractKey(req);
    // 无 key：不做幂等保护，向后兼容放行
    if (!key) return next();

    if (!validKey(key)) {
      return res.status(400).json({ code: 400, data: null, message: 'Idempotency-Key 格式无效' });
    }

    let db;
    try { db = getDb(); } catch {
      return res.status(503).json({
        code: 503,
        data: null,
        message: '幂等存储暂不可用，请求尚未提交，请稍后重试',
      });
    }
    const now = Date.now();
    const scope = scopeFor(req, opts.scope);
    const fingerprint = requestHash(req, scope);
    try {
      db.prepare('DELETE FROM idempotency_records WHERE expires_at <= ?').run(now);
      const existing = db.prepare(
        'SELECT * FROM idempotency_records WHERE scope = ? AND key = ?'
      ).get(scope, key);
      if (existing) {
        if (existing.request_hash !== fingerprint) {
          return res.status(409).json({
            code: 409,
            data: null,
            message: '同一 Idempotency-Key 不能用于不同请求',
          });
        }
        if (existing.status === 'pending') {
          return res.status(409).json({
            code: 409,
            data: null,
            message: '该请求已提交但结果尚未确认。为避免重复计费，系统不会自动重放；请先核对任务与资产记录。',
          });
        }
        let body;
        try { body = JSON.parse(String(existing.response_body)); } catch { body = null; }
        if (body != null) {
          res.setHeader('Idempotency-Replayed', 'true');
          return res.status(Number(existing.response_code) || 200).json(body);
        }
        return res.status(409).json({
          code: 409,
          data: null,
          message: '幂等记录存在但响应不可恢复。为避免重复提交，请核对任务记录后使用新的操作。',
        });
      }

      db.prepare(
        `INSERT INTO idempotency_records
         (scope, key, request_hash, status, response_code, response_body, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, 'pending', NULL, NULL, ?, ?, ?)`
      ).run(scope, key, fingerprint, now, now, now + ttlMs);
      // 不能等待 500ms 节流：必须在任何 Provider 调用之前把任务意图落盘。
      saveDb();
    } catch (error) {
      return next(error);
    }

    req.idempotency = { key, scope, requestHash: fingerprint };

    // 劫持 res.json，在 handler 返回时缓存响应
    const originalJson = res.json.bind(res);
    const replayJson: typeof res.json = (body) => {
      const code = res.statusCode || 200;
      // 仅缓存成功响应（2xx）；失败响应不缓存，允许用户用同 key 重试
      try {
        if (code >= 200 && code < 300) {
          const completedAt = Date.now();
          db.prepare(
            `UPDATE idempotency_records
             SET status = 'done', response_code = ?, response_body = ?, updated_at = ?, expires_at = ?
             WHERE scope = ? AND key = ? AND request_hash = ?`
          ).run(code, JSON.stringify(body), completedAt, completedAt + ttlMs, scope, key, fingerprint);
        } else {
          db.prepare('DELETE FROM idempotency_records WHERE scope = ? AND key = ?').run(scope, key);
        }
        saveDb();
      } catch (error: unknown) {
        // 请求已经执行，但无法可靠保存回放结果。失败关闭连接比返回成功后允许重放更安全。
        console.error('[idempotency] 持久化响应失败:', error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
          res.status(500);
          return originalJson({
            code: 500,
            data: null,
            message: '请求结果无法安全保存，请核对任务记录后再操作',
          });
        }
      }
      return originalJson(body);
    };
    res.json = replayJson;

    next();
  };
}

const exportedIdempotency = Object.assign(idempotency, { idempotency, requestHash })
export = exportedIdempotency
