const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const {
  assertSafeRemoteUrl,
  createRemoteMediaFetcher,
} = require('../services/remoteMedia');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test('远程媒体 URL 拒绝凭证、非 HTTP、回环与 metadata 地址', async () => {
  await rejectsCode(assertSafeRemoteUrl('file:///etc/passwd', { lookup: publicLookup }), 'MEDIA_URL_FORBIDDEN');
  await rejectsCode(assertSafeRemoteUrl('https://user:pass@example.com/a.png', { lookup: publicLookup }), 'MEDIA_URL_FORBIDDEN');
  await rejectsCode(assertSafeRemoteUrl('http://127.0.0.1/a.png', { lookup: publicLookup }), 'MEDIA_URL_FORBIDDEN');
  await rejectsCode(assertSafeRemoteUrl('http://169.254.169.254/latest/meta-data', { lookup: publicLookup }), 'MEDIA_URL_FORBIDDEN');
  await rejectsCode(assertSafeRemoteUrl('http://[::1]/a.png', { lookup: publicLookup }), 'MEDIA_URL_FORBIDDEN');
  await rejectsCode(assertSafeRemoteUrl('http://[::ffff:7f00:1]/a.png', { lookup: publicLookup }), 'MEDIA_URL_FORBIDDEN');
  await rejectsCode(assertSafeRemoteUrl('http://[64:ff9b::7f00:1]/a.png', { lookup: publicLookup }), 'MEDIA_URL_FORBIDDEN');
});

test('DNS 只要返回一个私网地址就拒绝，避免混合解析与重绑定', async () => {
  const lookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.8', family: 4 },
  ];
  await rejectsCode(assertSafeRemoteUrl('https://cdn.example.test/a.png', { lookup }), 'MEDIA_URL_FORBIDDEN');
});

test('每一次重定向都重新执行 URL 安全校验', async () => {
  let calls = 0;
  const fetcher = createRemoteMediaFetcher({
    lookup: publicLookup,
    open: async () => {
      calls += 1;
      return {
        statusCode: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
        stream: Readable.from([]),
        abort() {},
      };
    },
  });
  await rejectsCode(fetcher.download('https://safe.example.test/a.png', {
    destination: path.join(os.tmpdir(), 'must-not-exist.png'),
    kind: 'image',
  }), 'MEDIA_URL_FORBIDDEN');
  assert.equal(calls, 1);
});

test('显式禁用重定向时首个 302 即失败', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-media-redirect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const fetcher = createRemoteMediaFetcher({
    lookup: publicLookup,
    open: async () => {
      calls += 1;
      return {
        statusCode: 302,
        headers: { location: 'https://safe.example.test/next.png' },
        stream: Readable.from([]),
        abort() {},
      };
    },
  });
  await rejectsCode(fetcher.download('https://safe.example.test/start.png', {
    destination: path.join(dir, 'must-not-exist.png'),
    kind: 'image',
    maxRedirects: 0,
  }), 'MEDIA_REDIRECT_LIMIT');
  assert.equal(calls, 1);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('在写盘前拒绝 Content-Length 超限', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-media-size-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'image.png');
  const fetcher = createRemoteMediaFetcher({
    lookup: publicLookup,
    open: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/png', 'content-length': '999999' },
      stream: Readable.from([]),
      abort() {},
    }),
  });
  await rejectsCode(fetcher.download('https://safe.example.test/a.png', {
    destination,
    kind: 'image',
    maxBytes: 1024,
  }), 'MEDIA_TOO_LARGE');
  assert.equal(fs.existsSync(destination), false);
});

test('流式响应超限或 MIME/magic bytes 欺骗时清理临时文件', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-media-invalid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const open = async (_target, options) => ({
    statusCode: 200,
    headers: { 'content-type': options.headers?.['X-Test-Mime'] || 'image/png' },
    stream: Readable.from([Buffer.from(options.headers?.['X-Test-Body'] || 'not-a-png')]),
    abort() {},
  });
  const fetcher = createRemoteMediaFetcher({ lookup: publicLookup, open });

  const spoofed = path.join(dir, 'spoofed.png');
  await rejectsCode(fetcher.download('https://safe.example.test/spoofed.png', {
    destination: spoofed,
    kind: 'image',
  }), 'MEDIA_SIGNATURE_INVALID');

  const wrongMime = path.join(dir, 'wrong-mime.png');
  await rejectsCode(fetcher.download('https://safe.example.test/wrong.png', {
    destination: wrongMime,
    kind: 'image',
    headers: { 'X-Test-Mime': 'text/html' },
  }), 'MEDIA_MIME_INVALID');

  const mismatchedMagic = path.join(dir, 'mismatch.png');
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
  const mismatchFetcher = createRemoteMediaFetcher({
    lookup: publicLookup,
    open: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      stream: Readable.from([jpegBytes]),
      abort() {},
    }),
  });
  await rejectsCode(mismatchFetcher.download('https://safe.example.test/mismatch.png', {
    destination: mismatchedMagic,
    kind: 'image',
  }), 'MEDIA_SIGNATURE_INVALID');

  const tooLarge = path.join(dir, 'stream-too-large.png');
  await rejectsCode(fetcher.download('https://safe.example.test/large.png', {
    destination: tooLarge,
    kind: 'image',
    maxBytes: 4,
    headers: { 'X-Test-Body': '12345678' },
  }), 'MEDIA_TOO_LARGE');

  assert.deepEqual(fs.readdirSync(dir), []);
});

test('合法图片通过 MIME 与 magic bytes 后原子落盘', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigc-media-valid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'valid.png');
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]);
  const fetcher = createRemoteMediaFetcher({
    lookup: publicLookup,
    open: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
      stream: Readable.from([png.subarray(0, 10), png.subarray(10)]),
      abort() {},
    }),
  });

  const result = await fetcher.download('https://safe.example.test/valid.png', {
    destination,
    kind: 'image',
    maxBytes: 1024,
  });
  assert.equal(result.bytes, png.length);
  assert.equal(result.contentType, 'image/png');
  assert.deepEqual(fs.readFileSync(destination), png);
  assert.deepEqual(fs.readdirSync(dir), ['valid.png']);
});
