'use strict';
/**
 * LLM 重试/退避单元测试（P2-2）
 *
 * 验证 llmProvider.chat 的重试语义：
 *  1) 瞬时 5xx 错误 → 自动重试，最终成功
 *  2) 超时（AbortError）→ 自动重试
 *  3) 4xx 客户端错误 → 立即抛出，不重试（不浪费时间）
 *  4) 持续失败 → 重试到上限后抛出最后一次错误
 *
 * 通过 mock global.fetch 注入可控的响应序列，无需真实网络/计费。
 * 用临时 SETTINGS_FILE 提供假凭证，跑完即删，不污染真实配置。
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let tmpSettings;
let llm;
let originalFetch;

before(() => {
  // 临时 settings.json：给 deepseek 一个假 key/baseUrl，让 resolveCredentials 通过
  tmpSettings = path.join(os.tmpdir(), `llm-retry-test-${Date.now()}.json`);
  fs.writeFileSync(tmpSettings, JSON.stringify({
    credentials: { deepseek: { apiKey: 'sk-test-fake', baseUrl: 'https://fake.test' } },
  }), 'utf-8');
  process.env.SETTINGS_FILE = tmpSettings;
  // 必须在设置 env 之后再 require（config 在加载时读取 SETTINGS_FILE）
  llm = require('../services/providers/llmProvider');
  originalFetch = global.fetch;
});

after(() => {
  global.fetch = originalFetch;
  try { fs.unlinkSync(tmpSettings); } catch (_) {}
});

// 构造一个成功的 SSE 流式响应（llmProvider 默认 stream:true）
function okResponse(content) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n`;
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

function errResponse(status, msg = 'server error') {
  return {
    ok: false,
    status,
    text: async () => msg,
  };
}

const baseArgs = { provider: 'deepseek', model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] };

test('5xx 瞬时错误：自动重试后成功', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls < 2) return errResponse(503, 'upstream busy');
    return okResponse('你好世界');
  };
  const out = await llm.chat(baseArgs);
  assert.strictEqual(out, '你好世界');
  assert.strictEqual(calls, 2, '应在第 2 次成功（第 1 次 503 触发重试）');
});

test('超时（AbortError）：自动重试后成功', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls < 2) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    return okResponse('重试成功');
  };
  const out = await llm.chat(baseArgs);
  assert.strictEqual(out, '重试成功');
  assert.strictEqual(calls, 2);
});

test('4xx 客户端错误：立即抛出，不重试', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return errResponse(401, 'invalid api key');
  };
  await assert.rejects(() => llm.chat(baseArgs), /401/);
  assert.strictEqual(calls, 1, '4xx 不应重试，只调用 1 次');
});

test('持续 5xx：重试到上限后抛出', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return errResponse(500, 'always down');
  };
  await assert.rejects(() => llm.chat(baseArgs), /500/);
  assert.strictEqual(calls, 3, '应重试到 MAX_RETRIES=3 次上限');
});
