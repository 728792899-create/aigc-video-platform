'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCRIPT_SCHEMA_VERSION,
  SCRIPT_PROMPT_VERSION,
  validateStructuredScript,
} = require('../services/scriptContract');

function validScript() {
  return {
    title: '契约测试短片',
    summary: '验证结构化脚本不会把异常 Provider 输出直接写入核心状态。',
    visual_anchor: 'consistent cinematic studio',
    story_bible: { worldview: '测试世界', locked_facts: ['角色身份固定'] },
    characters: [{ name: '创作者', role: '主角', prompt_anchor: 'same creator', is_primary: true }],
    storyboards: [{
      scene_number: 1,
      description: '创作者在工作台前检查分镜。',
      dialog: '每一个阶段都需要可验证的产物。',
      duration: 6,
      prompt: '用户手工画面提示词',
      video_prompt: '缓慢推进镜头',
      negative_prompt: '不要改变角色身份',
      source_range: { start: 0, end: 12 },
      characters_in_scene: [{ name: '创作者', action: '检查分镜' }],
    }],
  };
}

test('结构化脚本契约保留手工 Prompt，并记录可追溯生成元数据', () => {
  const result = validateStructuredScript(validScript(), {
    theme: '可恢复创作', duration: '30-60', style: '写实', detailLevel: 'standard',
    provider: 'demo', model: 'local-template', language: 'zh-CN',
  });
  assert.equal(result.schema_version, SCRIPT_SCHEMA_VERSION);
  assert.equal(result.prompt_version, SCRIPT_PROMPT_VERSION);
  assert.equal(result.language, 'zh-CN');
  assert.equal(result.style, '写实');
  assert.match(result.input_hash, /^[a-f0-9]{64}$/);
  assert.equal(result.generation.provider, 'demo');
  assert.equal(result.generation.model, 'local-template');
  assert.equal(result.storyboards[0].prompt, '用户手工画面提示词');
  assert.equal(result.storyboards[0].video_prompt, '缓慢推进镜头');
  assert.deepEqual(result.storyboards[0].source_range, { start: 0, end: 12 });
});

test('输入 hash 稳定且会随上游主题变化', () => {
  const a = validateStructuredScript(validScript(), { theme: '主题 A', duration: '30', style: '写实' });
  const same = validateStructuredScript(validScript(), { style: '写实', duration: '30', theme: '主题 A' });
  const changed = validateStructuredScript(validScript(), { theme: '主题 B', duration: '30', style: '写实' });
  assert.equal(a.input_hash, same.input_hash);
  assert.notEqual(a.input_hash, changed.input_hash);
});

test('异常 Provider 结构被拒绝，诊断只包含路径与摘要 hash，不回显原始内容', () => {
  const secretLikeRaw = {
    title: '坏结果',
    storyboards: [{ description: { unexpected: 'sk-secret-must-not-leak' }, duration: -2 }],
  };
  assert.throws(
    () => validateStructuredScript(secretLikeRaw, { theme: '坏输入' }),
    (error) => {
      assert.equal(error.code, 'SCRIPT_OUTPUT_INVALID');
      assert.equal(error.retryable, true);
      assert.match(error.diagnosticRef, /^script_[a-f0-9]{16}$/);
      assert.ok(error.issues.some((issue) => issue.path.includes('description')));
      assert.equal(JSON.stringify(error).includes('sk-secret-must-not-leak'), false);
      assert.equal(error.message.includes('sk-secret-must-not-leak'), false);
      return true;
    }
  );
});

test('空分镜数组不能进入项目核心状态', () => {
  assert.throws(
    () => validateStructuredScript({ title: '空脚本', storyboards: [] }, { theme: '空脚本' }),
    (error) => error.code === 'SCRIPT_OUTPUT_INVALID'
  );
});

test('Demo 生成入口也必须经过相同结构化契约', async () => {
  const previous = process.env.DEMO_MODE;
  process.env.DEMO_MODE = '1';
  try {
    const { generateScript } = require('../services/deepseek');
    const result = await generateScript('无 Key 契约演示', '30-45', '写实');
    assert.equal(result.schema_version, SCRIPT_SCHEMA_VERSION);
    assert.equal(result.generation.provider, 'demo');
    assert.equal(result.generation.model, 'local-template');
    assert.ok(result.storyboards.length > 0);
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;
  }
});
