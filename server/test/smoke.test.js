/**
 * 后端接口冒烟测试套件 (smoke tests)
 * ---------------------------------------------------------------
 * 用 Node 内置 node:test + 原生 fetch，零额外依赖。
 * 针对一个【正在运行】的后端实例做黑盒 HTTP 测试，覆盖核心链路：
 *   健康检查 / 项目 CRUD 生命周期 / 分镜 / Provider / 封面 / 安全头 / 错误处理。
 *
 * 运行前提：后端已启动并监听 BASE_URL（默认 http://localhost:3000）。
 * 运行： cd server && npm test           （或 node --test test/）
 * 指定地址： BASE_URL=http://localhost:3000 npm test
 *
 * 设计原则：
 *  - 只读 + 自建自删，绝不污染真实数据（创建的测试项目在 after 钩子里硬删除）。
 *  - 不触发计费的 AI 生成（不测真实文生图/文生视频，只测接口契约与只读链路）。
 *  - 每个断言用中文描述，输出可直接作为论文“系统测试”章节的用例表素材。
 */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));

// 统一请求封装：返回 { status, body }
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

async function waitForTask(taskId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await req('GET', `/api/tasks/${taskId}`);
    assert.strictEqual(r.status, 200, '任务查询应成功');
    last = r.body.data;
    if (['success', 'failed', 'partial', 'canceled', 'interrupted'].includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`任务 ${taskId} 在 ${timeoutMs}ms 内未结束，最后状态：${last && last.status}`);
}

// 跨用例共享的测试项目 id（生命周期测试创建，after 清理）
let testProjectId = null;
let testTrashId = null; // 软删除后产生的回收站条目 id，收尾时彻底清除
let testStoryboardId = null;
let testImageId = null;
let testImageUrl = null;
let testImageTrashId = null;
let testGroupedTrashId = null;
let testCustomSkillId = null;
let reconcileProjectId = null;
let p2ProjectId = null;
let p2StoryboardId = null;
const reconcileFiles = [];

function uploadAbs(url) {
  const rel = String(url || '').replace(/^[\\/]+/, '').replace(/^uploads[\\/]+/i, '');
  return path.join(UPLOAD_DIR, rel);
}

// ── 0. 启动前置：确认后端在线，否则直接给出清晰提示 ──────────────
before(async () => {
  try {
    const { status } = await req('GET', '/api/health');
    assert.ok(status === 200, `后端 /api/health 返回 ${status}`);
  } catch (e) {
    throw new Error(
      `无法连接后端 ${BASE} —— 请先启动后端（cd server && npm start 或 pm2 start ecosystem.config.js）后再跑测试。原始错误：${e.message}`
    );
  }
});

// 清理：彻底清除测试中产生的所有残留（回收站条目优先，未删项目兜底硬删）
after(async () => {
  if (testCustomSkillId != null) {
    await req('DELETE', `/api/skills/${testCustomSkillId}`);
  }
  if (testImageTrashId != null) {
    await req('DELETE', `/api/trash/${testImageTrashId}`);
  }
  if (testGroupedTrashId != null) {
    await req('DELETE', `/api/trash/${testGroupedTrashId}`);
  }
  if (reconcileProjectId != null) {
    await req('DELETE', `/api/projects/${reconcileProjectId}?permanent=true`);
  }
  if (p2ProjectId != null) {
    await req('DELETE', `/api/projects/${p2ProjectId}?permanent=true`);
  }
  for (const file of reconcileFiles) {
    try { fs.rmSync(file, { force: true }); } catch (_) {}
  }
  if (testTrashId != null) {
    // 软删除已把项目移入回收站 → 彻底清除回收站条目（含 .trash 文件）
    await req('DELETE', `/api/trash/${testTrashId}`);
  } else if (testProjectId != null) {
    // 兜底：若生命周期未走到删除，直接 permanent 硬删项目
    await req('DELETE', `/api/projects/${testProjectId}?permanent=true`);
  }
});

// ── 1. 健康检查 ─────────────────────────────────────────────────
test('健康检查 /api/health 返回 overall + checks 数组', async () => {
  const { status, body } = await req('GET', '/api/health');
  assert.strictEqual(status, 200, 'HTTP 状态应为 200');
  assert.strictEqual(body.code, 200, '业务 code 应为 200');
  assert.ok(['ok', 'warn', 'error'].includes(body.data.overall), 'overall 应是 ok/warn/error');
  assert.ok(Array.isArray(body.data.checks) && body.data.checks.length > 0, 'checks 应为非空数组');
  // 关键检查项齐全：FFmpeg / 数据库 / 存储
  const keys = body.data.checks.map((c) => c.key);
  for (const k of ['ffmpeg', 'database', 'storage']) {
    assert.ok(keys.includes(k), `健康检查应包含 ${k} 项`);
  }
});

test('生图统计：返回真实出图与占位兜底的可审计口径', async () => {
  const { status, body } = await req('GET', '/api/system/image-success-rate');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.code, 200);
  for (const key of [
    'total', 'first_attempt_success', 'first_attempt_rate',
    'final_real_success', 'final_real_rate', 'placeholder_count', 'placeholder_rate',
  ]) {
    assert.strictEqual(typeof body.data[key], 'number', `${key} 应为数字`);
  }
  assert.ok(Array.isArray(body.data.by_model), 'by_model 应为数组');
  assert.ok(Array.isArray(body.data.by_provider), 'by_provider 应为数组');
});

// ── 2. 项目 CRUD 完整生命周期（创建→读取→更新→列表→封面派生→删除）──
test('项目创建：缺少 name 应返回 400', async () => {
  const { status, body } = await req('POST', '/api/projects', { theme: '无名' });
  assert.strictEqual(status, 400, '缺 name 应 400');
  assert.strictEqual(body.code, 400);
});

test('项目创建：合法请求返回新项目对象', async () => {
  const beforeCreate = Date.now();
  const { status, body } = await req('POST', '/api/projects', {
    name: '[smoke测试]自动化用例项目',
    theme: '城市夜景测试',
    style: '写实',
    duration_min: 30,
    duration_max: 60,
  });
  assert.strictEqual(status, 200, 'HTTP 应 200');
  assert.strictEqual(body.code, 200);
  assert.ok(body.data && body.data.id, '应返回带 id 的项目');
  assert.strictEqual(body.data.name, '[smoke测试]自动化用例项目', '名称应回显（验证中文无乱码）');
  assert.strictEqual(body.data.status, 'draft', '新项目默认 draft');
  assert.ok(Number.isFinite(body.data.created_at_ms), '新项目应返回 created_at_ms 毫秒时间戳');
  assert.ok(Number.isFinite(body.data.updated_at_ms), '新项目应返回 updated_at_ms 毫秒时间戳');
  assert.ok(Math.abs(body.data.created_at_ms - beforeCreate) < 120000, '新建项目时间应接近当前时间，避免 8 小时时差');
  assert.ok(body.data.asset_health && body.data.asset_health.status, '新项目应返回资产健康状态');
  testProjectId = body.data.id;
});

test('项目读取：GET /:id 返回项目并带 cover_url 派生字段', async () => {
  const { status, body } = await req('GET', `/api/projects/${testProjectId}`);
  assert.strictEqual(status, 200);
  assert.strictEqual(body.data.id, testProjectId);
  // cover_url 是 GET 时动态计算的派生字段（方案 D）：无图项目应为 null
  assert.ok('cover_url' in body.data, '响应应包含 cover_url 字段');
  assert.strictEqual(body.data.cover_url, null, '未配图项目 cover_url 应为 null（前端渐变兜底）');
  assert.ok('asset_health' in body.data, '项目详情应包含 asset_health 字段');
});

test('项目读取：不存在的 id 返回 404', async () => {
  const { status, body } = await req('GET', '/api/projects/99999999');
  assert.strictEqual(status, 404, '不存在的项目应 404');
  assert.strictEqual(body.code, 404);
});

test('项目更新：PUT 为 PATCH 语义，只改传入字段，其余保留', async () => {
  // 只更新 status，其余字段（name/theme）应保持不变
  const { status, body } = await req('PUT', `/api/projects/${testProjectId}`, { status: 'generating' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.data.status, 'generating', 'status 应被更新');
  assert.strictEqual(body.data.name, '[smoke测试]自动化用例项目', 'name 应保留（PATCH 语义）');
  assert.strictEqual(body.data.theme, '城市夜景测试', 'theme 应保留（PATCH 语义）');
});

test('项目更新：空 body 返回 400（没有可更新字段）', async () => {
  const { status } = await req('PUT', `/api/projects/${testProjectId}`, {});
  assert.strictEqual(status, 400, '无可更新字段应 400');
});

test('项目更新：不存在的 id 返回 404', async () => {
  const { status } = await req('PUT', '/api/projects/99999999', { status: 'draft' });
  assert.strictEqual(status, 404);
});

test('项目列表：GET / 返回数组且包含测试项目', async () => {
  const { status, body } = await req('GET', '/api/projects');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.data), 'data 应为数组');
  assert.ok(body.data.some((p) => p.id === testProjectId), '列表应包含刚创建的测试项目');
  assert.ok(body.data.every((p) => 'cover_url' in p), '列表每项都应带 cover_url 派生字段');
  assert.ok(body.data.every((p) => 'created_at_ms' in p && 'updated_at_ms' in p), '列表每项都应带毫秒时间戳');
  assert.ok(body.data.every((p) => 'asset_health' in p), '列表每项都应带资产健康状态');
});

test('项目列表：keyword 关键词搜索可命中测试项目', async () => {
  const { status, body } = await req('GET', '/api/projects?keyword=smoke测试');
  assert.strictEqual(status, 200);
  assert.ok(body.data.some((p) => p.id === testProjectId), '关键词搜索应命中测试项目');
});

// ── 3. 分镜：批量保存（事务）→ 读取 → 单条更新（PATCH 语义）──────
test('分镜批量保存：batch 写入 2 个分镜并返回结果', async () => {
  const { status, body } = await req('POST', '/api/storyboards/batch', {
    project_id: testProjectId,
    storyboards: [
      { scene_number: 1, description: '测试镜头一：城市夜景全景', dialog: '夜色降临', duration: 5 },
      { scene_number: 2, description: '测试镜头二：霓虹特写', dialog: '灯火璀璨', duration: 4 },
    ],
  });
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.data) && body.data.length === 2, '应返回 2 个分镜');
  assert.strictEqual(body.data[0].description, '测试镜头一：城市夜景全景', '中文描述无乱码');
});

test('分镜批量保存：缺参数返回 400', async () => {
  const { status } = await req('POST', '/api/storyboards/batch', { project_id: testProjectId });
  assert.strictEqual(status, 400, '缺 storyboards 应 400');
});

test('分镜读取：GET /project/:id 返回该项目分镜列表', async () => {
  const { status, body } = await req('GET', `/api/storyboards/project/${testProjectId}`);
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.data) && body.data.length === 2, '应读到 2 个分镜');
});

test('分镜更新：PUT 单条改 duration 为 PATCH 语义', async () => {
  const list = (await req('GET', `/api/storyboards/project/${testProjectId}`)).body.data;
  const sbId = list[0].id;
  testStoryboardId = sbId;
  const { status, body } = await req('PUT', `/api/storyboards/${sbId}`, { duration: 8 });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.data.duration, 8, 'duration 应更新为 8');
  assert.strictEqual(body.data.description, '测试镜头一：城市夜景全景', 'description 应保留');
});

test('分镜增量改稿：变化镜头旧素材标记 stale 且保留，未变化镜头不受影响', async () => {
  const createdProject = await req('POST', '/api/projects', {
    name: '[smoke测试]分镜增量改稿',
    theme: 'reconcile',
    style: '写实',
  });
  assert.strictEqual(createdProject.status, 200);
  reconcileProjectId = createdProject.body.data.id;

  const batch = await req('POST', '/api/storyboards/batch', {
    project_id: reconcileProjectId,
    storyboards: [
      { scene_number: 1, description: '镜头一保持', dialog: '对白一', duration: 5 },
      { scene_number: 2, description: '镜头二原稿', dialog: '对白二', duration: 5 },
      { scene_number: 3, description: '镜头三保持', dialog: '对白三', duration: 5 },
    ],
  });
  assert.strictEqual(batch.status, 200);
  const rows = batch.body.data;
  const imageByStoryboard = new Map();
  for (const row of rows) {
    const originalUrl = `/uploads/images/reconcile-${row.id}-${Date.now()}.png`;
    const originalAbs = uploadAbs(originalUrl);
    fs.mkdirSync(path.dirname(originalAbs), { recursive: true });
    fs.writeFileSync(originalAbs, Buffer.from(`reconcile-${row.id}`));
    const image = await req('POST', '/api/images', {
      storyboard_id: row.id,
      file_path: originalUrl,
      file_url: originalUrl,
      gen_status: 'success',
    });
    assert.strictEqual(image.status, 200);
    imageByStoryboard.set(row.id, image.body.data);
    reconcileFiles.push(uploadAbs(image.body.data.file_url));
    const selected = await req('PUT', `/api/storyboards/${row.id}`, {
      selected_image_id: image.body.data.id,
    });
    assert.strictEqual(selected.status, 200);
  }

  const changedAsset = uploadAbs(imageByStoryboard.get(rows[1].id).file_url);
  const reconcile = await req('POST', '/api/storyboards/reconcile', {
    project_id: reconcileProjectId,
    storyboards: [
      { ...rows[0], description: '镜头一保持' },
      { ...rows[1], description: '镜头二改稿后' },
      { ...rows[2], description: '镜头三保持' },
    ],
  });
  assert.strictEqual(reconcile.status, 200);
  assert.deepStrictEqual(reconcile.body.data.changed_ids, [rows[1].id], '仅第 2 镜应标记变化');
  assert.deepStrictEqual(reconcile.body.data.regenerate_ids, [rows[1].id], '仅第 2 镜需要重生成');
  assert.ok(reconcile.body.data.preserved_ids.includes(rows[0].id));
  assert.ok(reconcile.body.data.preserved_ids.includes(rows[2].id));

  const firstImages = (await req('GET', `/api/images/storyboard/${rows[0].id}`)).body.data;
  const secondImages = (await req('GET', `/api/images/storyboard/${rows[1].id}`)).body.data;
  const thirdImages = (await req('GET', `/api/images/storyboard/${rows[2].id}`)).body.data;
  assert.strictEqual(firstImages[0].id, imageByStoryboard.get(rows[0].id).id, '第 1 镜图片记录应保留');
  assert.strictEqual(secondImages[0].id, imageByStoryboard.get(rows[1].id).id, '第 2 镜旧图片记录应保留供比较');
  assert.strictEqual(secondImages[0].stale, 1, '第 2 镜旧图片应明确标记 stale');
  assert.strictEqual(secondImages[0].stale_reason, 'SCRIPT_CONTENT_CHANGED');
  assert.strictEqual(thirdImages[0].id, imageByStoryboard.get(rows[2].id).id, '第 3 镜图片记录应保留');
  assert.strictEqual(firstImages[0].stale, 0, '第 1 镜不应被误标 stale');
  assert.strictEqual(thirdImages[0].stale, 0, '第 3 镜不应被误标 stale');
  assert.strictEqual(fs.existsSync(changedAsset), true, '第 2 镜旧图片物理文件应保留');
  assert.strictEqual(fs.existsSync(uploadAbs(firstImages[0].file_url)), true, '第 1 镜物理文件应保留');
  assert.strictEqual(fs.existsSync(uploadAbs(thirdImages[0].file_url)), true, '第 3 镜物理文件应保留');

  const reconciledRows = (await req('GET', `/api/storyboards/project/${reconcileProjectId}`)).body.data;
  assert.strictEqual(reconciledRows[0].selected_image_id, imageByStoryboard.get(rows[0].id).id);
  assert.strictEqual(reconciledRows[1].selected_image_id, imageByStoryboard.get(rows[1].id).id, '变化镜头原选择应保留，交由用户决定');
  assert.strictEqual(reconciledRows[1].assets_stale, 1, '变化镜头应显示下游素材需复查');
  assert.strictEqual(reconciledRows[1].sync_status, 'stale');
  assert.strictEqual(reconciledRows[2].selected_image_id, imageByStoryboard.get(rows[2].id).id);

  const artifacts = await req('GET', `/api/projects/${reconcileProjectId}/artifacts`);
  assert.strictEqual(artifacts.status, 200);
  assert.ok(artifacts.body.data.current.some((item) => item.stage === 'script' && item.revision === 1));
  assert.ok(artifacts.body.data.current.some((item) => item.stage === 'storyboard' && item.revision === 1));
  const storyboardArtifact = artifacts.body.data.current.find((item) => item.stage === 'storyboard');
  assert.ok(storyboardArtifact.dependency_snapshot.script.artifact_id, '分镜产物应记录脚本 revision 依赖');

  const invalid = await req('POST', '/api/storyboards/reconcile', {
    project_id: reconcileProjectId,
    storyboards: [{ ...reconciledRows[0], description: { raw: 'sk-must-not-be-reflected' } }],
  });
  assert.strictEqual(invalid.status, 422, '异常可编辑脚本必须在写库前被拒绝');
  assert.strictEqual(invalid.body.data.code, 'SCRIPT_OUTPUT_INVALID');
  assert.match(invalid.body.data.diagnostic_ref, /^script_[a-f0-9]{16}$/);
  assert.strictEqual(JSON.stringify(invalid.body).includes('sk-must-not-be-reflected'), false, '响应不得回显原始 Provider/用户内容');
  const afterInvalid = (await req('GET', `/api/storyboards/project/${reconcileProjectId}`)).body.data;
  assert.strictEqual(afterInvalid.length, 3, '失败验证不能改写已有项目');
  assert.strictEqual(afterInvalid[0].description, reconciledRows[0].description);
});

test('资产健康检查：缺少分镜图片时返回可理解的 error 与建议', async () => {
  const { status, body } = await req('GET', `/api/projects/${testProjectId}/assets/health`);
  assert.strictEqual(status, 200, '资产健康检查接口应可读');
  assert.strictEqual(body.data.project_id, testProjectId, '应返回当前项目 id');
  assert.strictEqual(body.data.status, 'error', '有分镜但没有图片时应为 error');
  assert.strictEqual(body.data.can_compose, false, '缺图时不应允许成片');
  const missing = body.data.issues.find((i) => i.code === 'MISSING_IMAGES');
  assert.ok(missing, '应明确给出 MISSING_IMAGES 问题');
  assert.ok(Array.isArray(missing.suggestions) && missing.suggestions.length, '缺图问题应包含修正建议');
});

test('重复生图只把编译 Prompt 写入 Candidate，不污染用户可编辑的分镜 Prompt', async () => {
  let projectId = null;
  try {
    const project = await req('POST', '/api/projects', {
      name: '[smoke测试]Prompt 边界', theme: 'Prompt 不应递归膨胀', style: '写实',
    });
    projectId = project.body.data.id;
    const created = await req('POST', '/api/storyboards/batch', {
      project_id: projectId,
      storyboards: [{
        scene_number: 1,
        description: '创作者在工作台前操作',
        dialog: '保持输入可编辑。',
        duration: 5,
        prompt: '用户原始画面 Prompt',
      }],
    });
    const storyboardId = created.body.data[0].id;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const submission = await req('POST', '/api/ai/generate-image', {
        storyboard_id: storyboardId,
        prompt: '用户原始画面 Prompt',
        model: 'flux',
        ratio: '16:9',
        batch_size: 1,
        async: true,
      });
      assert.strictEqual(submission.status, 200);
      const task = await waitForTask(submission.body.data.task_id);
      assert.strictEqual(task.status, 'success');
    }

    const rows = (await req('GET', `/api/storyboards/project/${projectId}`)).body.data;
    assert.strictEqual(rows[0].prompt, '用户原始画面 Prompt', 'compiled prompt 不得覆盖用户输入');
    const candidates = (await req('GET', `/api/images/storyboard/${storyboardId}`)).body.data;
    assert.ok(candidates.length >= 2, '两次生成应分别保留 Candidate');
    assert.ok(candidates.every((item) => String(item.prompt).includes('当前镜头：用户原始画面 Prompt')),
      'Candidate 应保存实际发送的 compiled prompt');
  } finally {
    if (projectId != null) await req('DELETE', `/api/projects/${projectId}?permanent=true`);
  }
});

test('P2 多候选评审：切换使用稳定 ID，保留历史并保护当前选中项', async () => {
  const project = await req('POST', '/api/projects', {
    name: '[smoke测试]P2 资产与候选', theme: '隔离的本地候选评审', style: '写实',
  });
  assert.strictEqual(project.status, 200);
  p2ProjectId = project.body.data.id;
  const storyboards = await req('POST', '/api/storyboards/batch', {
    project_id: p2ProjectId,
    storyboards: [{ scene_number: 1, description: 'P2 镜头', dialog: '本地测试', duration: 5 }],
  });
  assert.strictEqual(storyboards.status, 200);
  p2StoryboardId = storyboards.body.data[0].id;
  const first = await req('POST', '/api/images', {
    storyboard_id: p2StoryboardId,
    prompt: '候选 A',
    file_url: '/uploads/images/candidate-a.png',
    file_path: '/uploads/images/candidate-a.png',
    gen_status: 'success',
    task_id: 'task-candidate-a',
    provider: 'demo',
    model: 'placeholder-v1',
  });
  const second = await req('POST', '/api/images', {
    storyboard_id: p2StoryboardId,
    prompt: '候选 B',
    file_url: '/uploads/images/candidate-b.png',
    file_path: '/uploads/images/candidate-b.png',
    gen_status: 'success',
    task_id: 'task-candidate-b',
    provider: 'demo',
    model: 'placeholder-v1',
    parent_image_id: first.body.data.id,
  });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.data.parent_image_id, first.body.data.id);
  assert.strictEqual(second.body.data.provider, 'demo');
  assert.ok(second.body.data.media_reference, '候选应返回受控 MediaReference');

  const selectFirst = await req('POST', `/api/images/${first.body.data.id}/select`, {
    storyboard_id: p2StoryboardId,
  });
  assert.strictEqual(selectFirst.status, 200);
  const favoriteSecond = await req('PUT', `/api/images/${second.body.data.id}/review`, { favorite: true });
  assert.strictEqual(favoriteSecond.status, 200);
  assert.strictEqual(favoriteSecond.body.data.favorite, true);

  const protectedArchive = await req('PUT', `/api/images/${first.body.data.id}/review`, { archived: true });
  assert.strictEqual(protectedArchive.status, 409, '正在使用的候选不能归档');
  const selectSecond = await req('POST', `/api/images/${second.body.data.id}/select`, {
    storyboard_id: p2StoryboardId,
  });
  assert.strictEqual(selectSecond.status, 200);
  const archiveFirst = await req('PUT', `/api/images/${first.body.data.id}/review`, { archived: true });
  assert.strictEqual(archiveFirst.status, 200);

  const visible = await req('GET', `/api/images/storyboard/${p2StoryboardId}`);
  assert.ok(visible.body.data.some((row) => row.id === second.body.data.id && row.selected && row.favorite));
  assert.ok(!visible.body.data.some((row) => row.id === first.body.data.id), '默认列表隐藏已归档候选');
  const history = await req('GET', `/api/images/storyboard/${p2StoryboardId}?include_archived=true`);
  assert.ok(history.body.data.some((row) => row.id === first.body.data.id && row.archived_at), '归档候选仍保留在历史中');
});

test('P2 资产 Variant：revision 递增、镜头绑定快照与引用保护可用', async () => {
  const extracted = await req('POST', `/api/projects/${p2ProjectId}/characters/extract`, {});
  assert.strictEqual(extracted.status, 200);
  assert.ok(extracted.body.data.length > 0);
  const character = extracted.body.data[0];
  const candidateList = await req('GET', `/api/images/storyboard/${p2StoryboardId}`);
  const candidate = candidateList.body.data.find((row) => row.selected) || candidateList.body.data[0];

  const first = await req('POST', `/api/assets/characters/${character.id}/variants`, {
    project_id: p2ProjectId,
    label: '系列定妆 v1',
    image_id: candidate.id,
    file_url: candidate.file_url,
    provider: 'demo',
    model: 'placeholder-v1',
  });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.data.revision, 1);
  assert.strictEqual(first.body.data.selected, 1);
  const second = await req('POST', `/api/assets/characters/${character.id}/variants`, {
    project_id: p2ProjectId,
    label: '系列定妆 v2',
    image_id: candidate.id,
    file_url: candidate.file_url,
    provider: 'demo',
    model: 'placeholder-v2',
    parent_variant_id: first.body.data.id,
  });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.data.revision, 2);
  assert.strictEqual(second.body.data.parent_variant_id, first.body.data.id);

  const selected = await req('POST', `/api/assets/characters/${character.id}/variants/${second.body.data.id}/select`, {});
  assert.strictEqual(selected.status, 200);
  const binding = await req('PUT', `/api/assets/storyboards/${p2StoryboardId}/bindings`, {
    project_id: p2ProjectId,
    asset_type: 'character',
    asset_id: character.id,
    variant_id: second.body.data.id,
    source_scope: 'series',
  });
  assert.strictEqual(binding.status, 200);
  assert.strictEqual(binding.body.data.snapshot.revision, 2);
  assert.strictEqual(binding.body.data.snapshot.model, 'placeholder-v2');
  const protectedArchive = await req('DELETE', `/api/assets/variants/${second.body.data.id}`);
  assert.strictEqual(protectedArchive.status, 409, '选中且绑定的 Variant 不能归档');

  const library = await req('GET', `/api/assets/projects/${p2ProjectId}`);
  assert.strictEqual(library.status, 200);
  const unit = library.body.data.units.find((item) => item.id === character.id);
  assert.deepStrictEqual(unit.variants.map((item) => item.revision), [1, 2]);
  assert.strictEqual(unit.selected_variant_id, second.body.data.id);
  assert.ok(library.body.data.bindings.some((item) => item.storyboard_id === p2StoryboardId && item.snapshot.revision === 2));

  const styleUnit = await req('POST', `/api/assets/projects/${p2ProjectId}/units`, {
    asset_type: 'style',
    name: '烟青水墨',
    scope: 'episode',
    metadata: { palette: 'cyan-ink' },
  });
  assert.strictEqual(styleUnit.status, 201, 'Style 应写入 v7 通用资产表');
  assert.strictEqual(styleUnit.body.data.scope, 'episode');
  const styleVariant = await req('POST', `/api/assets/units/${styleUnit.body.data.id}/variants`, {
    label: '水墨参考 v1',
    provider: 'demo',
    model: 'placeholder-v1',
    media_reference: { kind: 'project_media', media_id: candidate.id, url: candidate.file_url },
  });
  assert.strictEqual(styleVariant.status, 201);
  assert.strictEqual(styleVariant.body.data.asset_type, 'style');
  const styleBinding = await req('PUT', `/api/assets/storyboards/${p2StoryboardId}/bindings`, {
    project_id: p2ProjectId,
    asset_type: 'style',
    asset_id: styleUnit.body.data.id,
    variant_id: styleVariant.body.data.id,
    source_scope: 'episode',
  });
  assert.strictEqual(styleBinding.status, 200);
  assert.strictEqual(styleBinding.body.data.asset_unit_id, styleUnit.body.data.id);
  assert.strictEqual(styleBinding.body.data.snapshot.source_scope, 'episode');

  const genericLibrary = await req('GET', `/api/assets/projects/${p2ProjectId}`);
  assert.ok(genericLibrary.body.data.supported_asset_types.includes('style'));
  assert.ok(genericLibrary.body.data.units.some((item) => (
    item.id === styleUnit.body.data.id && item.variants[0]?.id === styleVariant.body.data.id
  )), '通用 Style 资产和 Variant 应可重新读取');
});

test('回收站：文件删除后可按分类查看详情，并只恢复指定图片内容', async () => {
  const originalImageUrl = `/uploads/images/smoke-trash-${Date.now()}.png`;
  const originalAbs = uploadAbs(originalImageUrl);
  fs.mkdirSync(path.dirname(originalAbs), { recursive: true });
  fs.writeFileSync(originalAbs, Buffer.from('smoke-image'));

  const created = await req('POST', '/api/images', {
    storyboard_id: testStoryboardId,
    prompt: '回收站分类恢复测试图',
    file_path: originalImageUrl,
    file_url: originalImageUrl,
    gen_status: 'success',
  });
  assert.strictEqual(created.status, 200, '创建图片记录应成功');
  testImageId = created.body.data.id;
  testImageUrl = created.body.data.file_url;
  const abs = uploadAbs(testImageUrl);
  assert.notStrictEqual(testImageUrl, originalImageUrl, '图片创建后应被真实重命名为可读文件名');
  assert.ok(testImageUrl.includes('_S001_图片01'), '规范图片名应包含场景顺序与图片序号');
  assert.ok(!fs.existsSync(originalAbs), '原随机文件名应已从磁盘消失');
  assert.ok(fs.existsSync(abs), '规范命名后的图片文件应存在');

  const filesAfterCreate = await req('GET', '/api/files?type=image');
  assert.strictEqual(filesAfterCreate.status, 200, '图片文件管理列表应可读');
  const fileRow = filesAfterCreate.body.data.list.find(f => f.url === testImageUrl);
  assert.ok(fileRow, '文件管理中应能找到规范命名后的图片');
  assert.strictEqual(fileRow.display_name, fileRow.name, '已规范文件主展示名应等于真实文件名');
  assert.strictEqual(fileRow.normalized, true, '文件管理应标记该图片已规范命名');
  assert.strictEqual(fileRow.scene_number, 1, '文件管理应返回场景顺序');

  const selected = await req('PUT', `/api/storyboards/${testStoryboardId}`, { selected_image_id: testImageId });
  assert.strictEqual(selected.status, 200, '设置分镜选中图片应成功');
  assert.strictEqual(selected.body.data.selected_image_id, testImageId, '选中图片应写入分镜');

  const deleted = await req('DELETE', '/api/files', { urls: [testImageUrl] });
  assert.strictEqual(deleted.status, 200, '文件软删除应成功');
  assert.strictEqual(deleted.body.data.deletedFiles, 1, '应移动 1 个文件到回收站');
  assert.ok(!fs.existsSync(abs), '软删除后原文件应被移入 .trash');

  const afterDelete = await req('GET', `/api/storyboards/${testStoryboardId}`);
  assert.strictEqual(afterDelete.status, 200);
  assert.strictEqual(afterDelete.body.data.selected_image_id, null, '删除图片后分镜选图应被清空');

  const trashList = await req('GET', '/api/trash?category=image');
  assert.strictEqual(trashList.status, 200, '图片分类回收站应可读');
  const row = trashList.body.data.find(item =>
    item.category === 'image' &&
    item.summary.includes('1 张') &&
    item.group_label &&
    item.group_label.includes('smoke测试')
  );
  assert.ok(row, '应能按图片分类找到刚删除的内容');
  assert.ok(row.group_key, '文件型回收站列表应返回项目/类型小组 key');
  assert.strictEqual(row.file_count, 1, '图片小组应只包含当前 1 张图片');
  testImageTrashId = row.id;

  const detail = await req('GET', `/api/trash/${row.id}?group_key=${encodeURIComponent(row.group_key)}`);
  assert.strictEqual(detail.status, 200, '回收站详情应可读');
  const item = detail.body.data.details.find(d => d.type === 'image' && d.path.endsWith(path.basename(testImageUrl)));
  assert.ok(item && item.key, '详情中应有可恢复的图片明细 key');
  assert.strictEqual(detail.body.data.details.length, 1, '按小组查看内容时不应展示同一批回收中的其他文件');

  const restored = await req('POST', `/api/trash/${row.id}/restore-items`, { keys: [item.key] });
  assert.strictEqual(restored.status, 200, '指定内容恢复应成功');
  assert.strictEqual(restored.body.data.restoredCount, 1, '应只恢复选中的 1 个明细');
  assert.strictEqual(restored.body.data.trashRemoved, true, '单文件条目恢复后应从回收站移除');
  testImageTrashId = null;
  assert.ok(fs.existsSync(abs), '恢复后文件应回到原 uploads 位置');

  const images = await req('GET', `/api/images/storyboard/${testStoryboardId}`);
  assert.strictEqual(images.status, 200);
  assert.ok(images.body.data.some(img => img.id === testImageId && img.file_url === testImageUrl), '恢复后图片 DB 行应重建');

  const afterRestore = await req('GET', `/api/storyboards/${testStoryboardId}`);
  assert.strictEqual(afterRestore.status, 200);
  assert.strictEqual(afterRestore.body.data.selected_image_id, testImageId, '恢复图片后分镜选图也应恢复');
});

test('文件管理：批量整理历史素材命名，并按项目/类型拆分回收站小组', async () => {
  const sbList = (await req('GET', `/api/storyboards/project/${testProjectId}`)).body.data;
  const secondStoryboardId = sbList[1].id;
  const rawImageUrl = `/uploads/images/history-random-${Date.now()}.jpg`;
  const rawImageAbs = uploadAbs(rawImageUrl);
  fs.mkdirSync(path.dirname(rawImageAbs), { recursive: true });
  fs.writeFileSync(rawImageAbs, Buffer.from('history-image'));

  const imageCreated = await req('POST', '/api/images', {
    storyboard_id: secondStoryboardId,
    prompt: '历史素材整理测试图',
    file_path: rawImageUrl,
    file_url: rawImageUrl,
    gen_status: 'success',
  });
  assert.strictEqual(imageCreated.status, 200, '创建历史图片记录应成功');
  let normalizedImageUrl = imageCreated.body.data.file_url;

  await req('PUT', `/api/storyboards/${secondStoryboardId}`, { selected_image_id: imageCreated.body.data.id });
  const subtitlePatch = await req('PUT', `/api/storyboards/${secondStoryboardId}`, { subtitle_text: '历史素材整理测试字幕' });
  assert.strictEqual(subtitlePatch.status, 200, '更新分镜字幕应成功');

  const subtitleUrl = `/uploads/subtitles/subtitle_project_${testProjectId}.srt`;
  const subtitleAbs = uploadAbs(subtitleUrl);
  fs.mkdirSync(path.dirname(subtitleAbs), { recursive: true });
  fs.writeFileSync(subtitleAbs, '1\n00:00:00,000 --> 00:00:01,000\n测试字幕\n', 'utf-8');

  const preview = await req('POST', '/api/files/normalize-names', { types: ['image', 'subtitle'], dry_run: true });
  assert.strictEqual(preview.status, 200, '历史素材整理预览应成功');
  assert.ok(preview.body.data.actions.some(a => a.type === 'subtitle' && a.to_name.includes('字幕_srt')), '字幕整理预览应给出项目名字幕文件');

  const normalized = await req('POST', '/api/files/normalize-names', { types: ['image', 'subtitle'], dry_run: false });
  assert.strictEqual(normalized.status, 200, '历史素材真实整理应成功');
  const images = await req('GET', `/api/images/storyboard/${secondStoryboardId}`);
  const imgRow = images.body.data.find(img => img.id === imageCreated.body.data.id);
  normalizedImageUrl = imgRow.file_url;
  assert.ok(normalizedImageUrl.includes('_S002_图片'), '第二个分镜图片应按 S002 命名');
  assert.ok(fs.existsSync(uploadAbs(normalizedImageUrl)), '真实整理后规范图片文件应存在');
  assert.ok(!fs.existsSync(uploadAbs(subtitleUrl)), '旧字幕文件名应被真实重命名');

  const subtitleList = await req('GET', '/api/files?type=subtitle');
  assert.strictEqual(subtitleList.status, 200, '字幕文件管理列表应可读');
  const subtitleRow = subtitleList.body.data.list.find(f => f.project_id === testProjectId && f.asset_role === 'subtitle_srt');
  assert.ok(subtitleRow && subtitleRow.display_name.includes('字幕_srt'), '字幕列表应显示项目名字幕文件');
  assert.strictEqual(subtitleRow.normalized, true, '字幕应标记为已规范');

  const deleted = await req('DELETE', '/api/files', { urls: [normalizedImageUrl, subtitleRow.url] });
  assert.strictEqual(deleted.status, 200, '批量文件软删除应成功');
  assert.strictEqual(deleted.body.data.deletedFiles, 2, '应移动图片和字幕两个文件到回收站');

  const imageTrash = await req('GET', '/api/trash?category=image');
  const subtitleTrash = await req('GET', '/api/trash?category=subtitle');
  const imageGroup = imageTrash.body.data.find(row => row.group_key && row.group_key.includes(`project-${testProjectId}`) && row.file_count === 1);
  const subtitleGroup = subtitleTrash.body.data.find(row => row.group_key && row.group_key.includes(`project-${testProjectId}`) && row.file_count === 1);
  assert.ok(imageGroup, '同一批删除中的图片应拆成项目/图片小组');
  assert.ok(subtitleGroup, '同一批删除中的字幕应拆成项目/字幕小组');
  assert.strictEqual(imageGroup.id, subtitleGroup.id, '图片和字幕小组应来自同一个底层 trash 批量条目');
  testGroupedTrashId = imageGroup.id;

  const imageDetail = await req('GET', `/api/trash/${imageGroup.id}?group_key=${encodeURIComponent(imageGroup.group_key)}`);
  assert.strictEqual(imageDetail.status, 200, '图片小组详情应可读');
  assert.strictEqual(imageDetail.body.data.details.length, 1, '图片小组详情只应包含图片');
  assert.strictEqual(imageDetail.body.data.details[0].type, 'image', '图片小组详情类型应为 image');

  const restored = await req('POST', `/api/trash/${imageGroup.id}/restore-items`, {
    keys: imageDetail.body.data.details.map(item => item.key),
  });
  assert.strictEqual(restored.status, 200, '只恢复图片小组应成功');
  assert.strictEqual(restored.body.data.restoredCount, 1, '只应恢复图片小组 1 项');
  assert.strictEqual(restored.body.data.trashRemoved, false, '字幕小组仍在时底层 trash 不应被移除');
  assert.ok(fs.existsSync(uploadAbs(normalizedImageUrl)), '图片小组恢复后图片文件应回到 uploads');

  const subtitleStillTrash = await req('GET', '/api/trash?category=subtitle');
  assert.ok(subtitleStillTrash.body.data.some(row => row.id === testGroupedTrashId), '恢复图片小组后字幕小组仍应留在回收站');
  await req('DELETE', `/api/trash/${testGroupedTrashId}`);
  testGroupedTrashId = null;
});

test('v2.2 项目闭环：无缺图时批量生图安全跳过，任务可查询且不可错误重试', async () => {
  const start = await req('POST', `/api/projects/${testProjectId}/images/generate-all`, {
    mode: 'missing',
    batchSize: 1,
  });
  assert.strictEqual(start.status, 200, '批量生图接口应可提交');
  assert.ok(start.body.data.task_id, '应返回任务 id');
  assert.strictEqual(start.body.data.target_count, 0, '已有可用图片时缺图补齐目标应为 0');

  const task = await waitForTask(start.body.data.task_id);
  assert.strictEqual(task.type, 'image-batch', '任务类型应为 image-batch');
  assert.strictEqual(task.status, 'success', '无目标分镜的批量生图应安全成功');
  assert.strictEqual(task.result.target_count, 0, '任务结果应记录目标数量为 0');

  const retry = await req('POST', `/api/tasks/${start.body.data.task_id}/retry-failed`);
  assert.strictEqual(retry.status, 400, '没有失败项时不应启动重试任务');
  assert.ok(/没有可重试/.test(retry.body.message), '重试失败提示应可理解');
});

test('v2.2 项目闭环：继续完成检查会刷新项目状态并返回健康信息', async () => {
  const checked = await req('POST', `/api/projects/${testProjectId}/complete-check`);
  assert.strictEqual(checked.status, 200, '继续完成检查接口应可用');
  assert.ok(['draft', 'partial', 'ready', 'completed'].includes(checked.body.data.status), '应返回规范生命周期状态');
  assert.strictEqual(checked.body.data.project_id, testProjectId, '应返回当前项目 id');
  assert.ok(checked.body.data.health && checked.body.data.health.counts.storyboards >= 2, '应返回资产健康详情');
  assert.ok(checked.body.data.project && checked.body.data.project.id === testProjectId, '应返回刷新后的项目卡片数据');
});

test('技能库：任意技能可删除、恢复内置技能，自建技能有版本记录并可回滚', async () => {
  const all = await req('GET', '/api/skills');
  assert.strictEqual(all.status, 200, '技能列表应可读');
  const builtin = all.body.data.find((s) => s.is_builtin);
  assert.ok(builtin, '应存在内置技能用于删除/恢复验证');

  const deleted = await req('DELETE', `/api/skills/${builtin.id}`);
  assert.strictEqual(deleted.status, 200, '内置技能也应允许删除');

  const afterDelete = await req('GET', '/api/skills');
  assert.strictEqual(afterDelete.status, 200);
  assert.ok(!afterDelete.body.data.some((s) => s.id === builtin.id), '删除后的内置技能应从列表隐藏');

  const restored = await req('POST', '/api/skills/restore-builtins');
  assert.strictEqual(restored.status, 200, '应能恢复默认内置技能');
  const afterRestore = await req('GET', '/api/skills');
  assert.ok(afterRestore.body.data.some((s) => s.name === builtin.name && s.is_builtin), '恢复后应重新出现内置技能');

  const created = await req('POST', '/api/skills', {
    name: `[smoke]版本技能${Date.now()}`,
    description: '版本记录测试',
    stage: 'script',
    prompt: '第一版提示词',
    icon: 'T',
  });
  assert.strictEqual(created.status, 200, '创建自建技能应成功');
  testCustomSkillId = created.body.data.id;

  const updated = await req('PUT', `/api/skills/${testCustomSkillId}`, {
    prompt: '第二版提示词',
    summary: 'smoke 修改为第二版',
  });
  assert.strictEqual(updated.status, 200, '更新自建技能应成功');
  assert.strictEqual(updated.body.data.prompt, '第二版提示词', '提示词应更新为第二版');

  const versions = await req('GET', `/api/skills/${testCustomSkillId}/versions`);
  assert.strictEqual(versions.status, 200, '版本记录应可读取');
  assert.ok(versions.body.data.length >= 1, '更新后应至少有 1 条历史版本');
  const firstVersion = versions.body.data.find((v) => v.snapshot && v.snapshot.prompt === '第一版提示词');
  assert.ok(firstVersion, '历史版本应保存修改前的提示词');

  const rollback = await req('POST', `/api/skills/${testCustomSkillId}/versions/${firstVersion.id}/restore`);
  assert.strictEqual(rollback.status, 200, '回滚版本应成功');
  assert.strictEqual(rollback.body.data.prompt, '第一版提示词', '回滚后应恢复第一版提示词');

  const removed = await req('DELETE', `/api/skills/${testCustomSkillId}`);
  assert.strictEqual(removed.status, 200, '自建技能删除应成功');
  testCustomSkillId = null;
});

// ── 4. Provider 多模型接入：分组列表 + 阶段路由 + 配音音色 ────────
test('Provider 列表：GET /api/providers 按 kind 分组（llm/t2i/t2v/tts）', async () => {
  const { status, body } = await req('GET', '/api/providers');
  assert.strictEqual(status, 200);
  for (const kind of ['llm', 't2i', 't2v', 'tts']) {
    assert.ok(Array.isArray(body.data[kind]), `应包含 ${kind} 分组数组`);
  }
  // DeepSeek 应在 llm 分组里
  assert.ok(body.data.llm.some((p) => p.key === 'deepseek'), 'llm 分组应含 deepseek');
});

test('Demo Mode：积分探测不启动外部 Dreamina CLI', async () => {
  const { status, body } = await req('GET', '/api/ai/dreamina-credit');
  assert.equal(status, 200);
  assert.equal(body.data.demo_mode, true);
  assert.equal(body.data.available, false);
  assert.match(body.message, /不探测外部 CLI/);
});

test('Provider 健康：GET /api/providers/health 返回启动自检快照与配置文件路径', async () => {
  const { status, body } = await req('GET', '/api/providers/health');
  assert.strictEqual(status, 200);
  assert.ok(['ok', 'warn'].includes(body.data.overall), 'overall 应为 ok/warn');
  assert.ok(Number.isFinite(body.data.checked_at), '应返回检查时间戳');
  assert.ok(body.data.config_file && body.data.config_file.endsWith('.json'), '应返回当前配置文件路径');
  assert.ok(Array.isArray(body.data.items) && body.data.items.length > 0, '应返回 provider 健康列表');
  assert.ok(body.data.items.every((item) => item.status && item.status_label), '每个 provider 应包含状态与中文标签');
});

test('阶段路由：GET /api/providers/stage-models 返回四阶段配置', async () => {
  const { status, body } = await req('GET', '/api/providers/stage-models');
  assert.strictEqual(status, 200);
  for (const stage of ['script', 'image', 'video', 'voice']) {
    assert.ok(body.data[stage] && body.data[stage].provider, `应含 ${stage} 阶段路由`);
  }
});

test('模型能力目录与阶段路由：静态能力独立返回，未知模型在保存前失败', async () => {
  const catalog = await req('GET', '/api/providers/catalog?modality=video');
  assert.strictEqual(catalog.status, 200);
  assert.ok(catalog.body.data.some((item) => item.id === 'cogvideo__cogvideox-flash'));
  assert.ok(catalog.body.data.every((item) => !Object.hasOwn(item, 'configured')), '能力目录不应混入运行时健康状态');

  const invalid = await req('POST', '/api/providers/stage-models', {
    image: { provider: 'cogview', model: 'not-a-real-model' },
  });
  assert.strictEqual(invalid.status, 400);
  assert.equal(invalid.body.data.error_code, 'MODEL_NOT_FOUND');
});

const settingsMutationTest = process.env.SETTINGS_FILE ? test : test.skip;
settingsMutationTest('系统设置：默认模型保存生效，空 Key 不覆盖旧 Key，显式清除才删除凭证', async () => {
  const savedCredential = await req('POST', '/api/providers/credentials', {
    provider: 'deepseek',
    apiKey: 'sk-smoke-secret-123456',
    baseUrl: 'https://api.deepseek.com',
  });
  assert.strictEqual(savedCredential.status, 200, 'DeepSeek 凭证保存应成功');
  assert.strictEqual(savedCredential.body.data.configured, true, '保存真实 Key 后应显示已配置');
  assert.strictEqual(savedCredential.body.data.userConfigured, true, '保存真实 Key 后应标记用户已配置');

  const blankCredential = await req('POST', '/api/providers/credentials', {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
  });
  assert.strictEqual(blankCredential.status, 200, '空 Key 保存不应报错');
  assert.strictEqual(blankCredential.body.data.configured, true, '空 Key 不应覆盖旧 Key');
  assert.strictEqual(blankCredential.body.data.userConfigured, true, '空 Key 不应清掉旧的用户 Key');

  const defaults = await req('PUT', '/api/settings/defaults', {
    defaultImageModel: 'cogview-3-flash',
    defaultStyle: '电影感',
    defaultVoice: 'xiaoyi',
    defaultDuration: '30-60',
  });
  assert.strictEqual(defaults.status, 200, '默认设置保存应成功');
  assert.strictEqual(defaults.body.data.defaultImageModel, 'cogview-3-flash', '默认生图模型应立即生效');
  assert.strictEqual(defaults.body.data.defaultStyle, '电影感', '默认风格应立即生效');
  assert.ok(defaults.body.data._runtime && defaults.body.data._runtime.settingsFile, '设置响应应带当前配置文件路径');

  const cleared = await req('POST', '/api/settings/keys/clear', { provider: 'deepseek' });
  assert.strictEqual(cleared.status, 200, '显式清除 Key 应成功');
  assert.strictEqual(cleared.body.data.userConfigured, false, '清除后用户 Key 应显示未配置');
  assert.strictEqual(typeof cleared.body.data.configured, 'boolean', '运行时可用性应保留为布尔值（可能仍有内置兜底）');
});

test('配音音色：GET /api/ai/voices 返回音色与情感列表', async () => {
  const { status, body } = await req('GET', '/api/ai/voices');
  assert.strictEqual(status, 200);
  // 升级后结构为 { voices, emotions }
  const voices = body.data.voices || body.data;
  assert.ok(Array.isArray(voices) && voices.length >= 6, '应至少 6 个可用音色');
});

// ── 5. 合成相关只读配置：画幅比例 / 字幕预设 / 运镜 ──────────────
test('合成配置：媒体比例/字幕预设/运镜接口均可读', async () => {
  const ratios = await req('GET', '/api/media/ratios');
  const subs = await req('GET', '/api/media/subtitle-presets');
  const motions = await req('GET', '/api/media/motions');
  assert.strictEqual(ratios.status, 200, '画幅比例应可读');
  assert.strictEqual(subs.status, 200, '字幕预设应可读');
  assert.strictEqual(motions.status, 200, '运镜预设应可读');
});

// ── 6. 安全加固：安全响应头 + CORS 跨域拒绝 + 404 处理 ───────────
test('安全头：响应包含 nosniff / SAMEORIGIN，且不暴露 X-Powered-By', async () => {
  const r = await fetch(BASE + '/api/health');
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff', '应有 X-Content-Type-Options: nosniff');
  assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN', '应有 X-Frame-Options: SAMEORIGIN');
  assert.strictEqual(r.headers.get('x-powered-by'), null, '不应暴露 X-Powered-By（已移除）');
});

test('CORS：非白名单 Origin 被拒绝（403）', async () => {
  const r = await fetch(BASE + '/api/health', { headers: { Origin: 'http://evil.example.com' } });
  assert.strictEqual(r.status, 403, '恶意跨域来源应 403');
});

test('404：未知 API 路由返回 404', async () => {
  const { status } = await req('GET', '/api/__nonexistent_route_xyz__');
  assert.strictEqual(status, 404, '未知路由应 404');
});

// ── 7. 生命周期收尾：删除测试项目（软删除→回收站）并验证已不可见 ──
test('项目删除：DELETE 默认软删除进回收站，列表中不再可见', async () => {
  const del = await req('DELETE', `/api/projects/${testProjectId}`);
  assert.strictEqual(del.status, 200, '删除应 200');
  // 记录回收站条目 id，供 after 钩子彻底清除（含 .trash 文件）
  if (del.body && del.body.data && del.body.data.trashId != null) {
    testTrashId = del.body.data.trashId;
  }
  const detail = await req('GET', `/api/trash/${testTrashId}`);
  assert.strictEqual(detail.status, 200, '项目回收详情应可读');
  assert.strictEqual(detail.body.data.category, 'mixed', '含剧本和素材的整项目删除应归入混合分类');
  assert.ok(detail.body.data.details.some((d) => d.type === 'script'), '整项目删除详情应包含剧本虚拟资产');
  const mixedList = await req('GET', '/api/trash?category=mixed');
  assert.ok(mixedList.body.data.some((r) => r.id === testTrashId), '混合分类应能筛到整项目删除条目');
  // 软删除后从项目列表消失
  const { body } = await req('GET', '/api/projects');
  assert.ok(!body.data.some((p) => p.id === testProjectId), '删除后列表不应再含该项目');
});
