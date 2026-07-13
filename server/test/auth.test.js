const test = require('node:test');
const assert = require('node:assert/strict');
const { optionalAuth } = require('../middleware/auth');

function invoke({ token, path = '/api/projects', method = 'GET', headers = {} }) {
  const previous = process.env.API_TOKEN;
  if (token == null) delete process.env.API_TOKEN;
  else process.env.API_TOKEN = token;
  let nextCalled = false;
  let responseStatus = 200;
  let responseBody = null;
  const req = { path, method, headers };
  const res = {
    status(code) { responseStatus = code; return this; },
    json(body) { responseBody = body; return this; },
  };
  try {
    optionalAuth(req, res, () => { nextCalled = true; });
    return { nextCalled, status: responseStatus, body: responseBody };
  } finally {
    if (previous == null) delete process.env.API_TOKEN;
    else process.env.API_TOKEN = previous;
  }
}

test('未配置 API_TOKEN 时维持向后兼容并放行', () => {
  assert.equal(invoke({ token: null }).nextCalled, true);
});

test('配置 API_TOKEN 后拒绝缺失或错误令牌', () => {
  assert.equal(invoke({ token: 'secret' }).status, 401);
  assert.equal(invoke({ token: 'secret', headers: { authorization: 'Bearer wrong' } }).status, 401);
});

test('Bearer 与 X-API-Token 均可通过，健康检查和 OPTIONS 豁免', () => {
  assert.equal(invoke({ token: 'secret', headers: { authorization: 'Bearer secret' } }).nextCalled, true);
  assert.equal(invoke({ token: 'secret', headers: { 'x-api-token': 'secret' } }).nextCalled, true);
  assert.equal(invoke({ token: 'secret', path: '/api/health' }).nextCalled, true);
  assert.equal(invoke({ token: 'secret', method: 'OPTIONS' }).nextCalled, true);
  assert.equal(invoke({ token: 'secret', path: '/projects' }).nextCalled, true);
});
