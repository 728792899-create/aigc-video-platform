/**
 * 安全加固回归测试（黑盒 HTTP）
 *
 * 覆盖本轮按《企业级 AI 辅助全栈开发约束与规范文档 v2.0.0》补齐的三项：
 *   §6  上传必须校验文件魔数（仅信客户端 MIME 可被伪造）
 *   §10 API 必须有请求关联 ID（X-Request-Id）
 *   §10 对不存在对象的写操作应返回 404，不得 500/泄露堆栈
 *
 * 运行前提：后端已启动并监听 BASE_URL（默认 http://127.0.0.1:3000）。
 *   cd server && npm test
 *   指定地址：BASE_URL=http://127.0.0.1:3015 npm test
 */
const { test, before } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, opts);
  let parsed = null;
  const text = await r.text();
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
  return { status: r.status, body: parsed, raw: r };
}

// 上传 multipart：以指定字节内容 + 伪造 MIME 发起上传
async function upload(bytes, mime, filename, fields = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime }), filename);
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  const r = await fetch(BASE + '/api/images/upload', { method: 'POST', body: fd });
  let body = null;
  const text = await r.text();
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { status: r.status, body, raw: r };
}

before(async () => {
  try {
    const { status } = await req('GET', '/api/health');
    assert.ok(status === 200, `后端 /api/health 返回 ${status}`);
  } catch (e) {
    throw new Error(
      `无法连接后端 ${BASE} —— 请先启动后端后再跑测试。原始错误：${e.message}`
    );
  }
});

// ── §6 上传魔数校验 ─────────────────────────────────────────────
test('上传魔数：EXE 字节伪装成 image/png 应被拒绝（400）', async () => {
  // MZ 开头是 Windows PE 可执行文件头，绝非图片
  const fakeExe = Buffer.from('MZ\x90\x00\x00\x00\x00\x00fake exe payload', 'binary');
  const { status, body } = await upload(fakeExe, 'image/png', 'evil.png', { storyboard_id: 1 });
  assert.strictEqual(status, 400, '内容与声明格式不符应 400');
  assert.match(body.message || '', /格式不符|拒绝/, '应给出格式不符的拒绝信息');
});

test('上传魔数：纯文本伪装成 image/jpeg 应被拒绝（400）', async () => {
  const fakeText = Buffer.from('this is just plain text, not a jpeg at all', 'utf8');
  const { status } = await upload(fakeText, 'image/jpeg', 'note.jpg', { storyboard_id: 1 });
  assert.strictEqual(status, 400, '纯文本伪装图片应 400');
});

test('上传魔数：真实 PNG 文件头通过后，不存在分镜应返回 404 而非 500', async () => {
  // 合法 PNG 8 字节签名 + 最小 IHDR 片段
  const realPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const { status, body } = await upload(realPng, 'image/png', 'real.png', { storyboard_id: 999999 });
  assert.strictEqual(status, 404, '真实 PNG 通过魔数后，应由业务校验返回分镜不存在');
  assert.match(body.message || '', /分镜不存在/, '应给出明确业务错误，而不是数据库 500');
});

// ── §10 请求关联 ID ─────────────────────────────────────────────
test('请求ID：响应头包含 X-Request-Id', async () => {
  const r = await fetch(BASE + '/api/health');
  const rid = r.headers.get('x-request-id');
  assert.ok(rid && rid.length > 0, '响应应带 X-Request-Id 头');
});

test('请求ID：透传客户端传入的 X-Request-Id', async () => {
  const custom = 'test-rid-abcdef-123456';
  const r = await fetch(BASE + '/api/health', { headers: { 'X-Request-Id': custom } });
  assert.strictEqual(r.headers.get('x-request-id'), custom, '应原样透传客户端请求 ID');
});

test('请求ID：业务错误响应也带 X-Request-Id 头（日志可关联）', async () => {
  // 缺 name 触发 400 业务错误；X-Request-Id 头由中间件对所有响应设置，
  // 是 §10 要求的关联机制（响应体 requestId 字段仅由全局错误处理器对
  // 抛出型错误/500 补充，校验类 400 由路由直接返回，不强制带 body 字段）。
  const r = await fetch(BASE + '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: '无名' }),
  });
  assert.strictEqual(r.status, 400, '缺 name 应 400');
  const rid = r.headers.get('x-request-id');
  assert.ok(rid && rid.length > 0, '业务错误响应也应带 X-Request-Id 头');
});

// ── §10 不存在对象的写操作 → 404（不 500、不泄露堆栈）──────────────
test('对象不存在：PUT 不存在的图片返回 404', async () => {
  const { status, body } = await req('PUT', '/api/images/999999999', { gen_status: 'done' });
  assert.strictEqual(status, 404, '更新不存在图片应 404');
  assert.ok(!/Error:|at Object|at Function|\.js:\d+/.test(JSON.stringify(body)), '不应泄露堆栈');
});
