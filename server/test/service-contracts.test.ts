import assert from 'node:assert/strict'
import test from 'node:test'

import { builtinDeepSeek, builtinZhipu } from '../services/builtinCreds'
import { BUILTIN_SKILLS } from '../services/builtinSkills'
import { insertRow } from '../services/trash'

test('内置技能名称唯一且阶段、自动应用标记符合契约', () => {
  const names = BUILTIN_SKILLS.map((skill) => skill.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(BUILTIN_SKILLS.length >= 10)
  for (const skill of BUILTIN_SKILLS) {
    assert.ok(['script', 'image', 'voice', 'all'].includes(skill.stage))
    assert.ok(skill.auto_apply === 0 || skill.auto_apply === 1)
    assert.equal(skill.source, 'builtin')
    assert.ok(skill.prompt.length > 20)
  }
})

test('共享内置密钥默认禁用，只有显式开关才读取环境变量', (context) => {
  const previous = {
    allow: process.env.ALLOW_BUILTIN_KEYS,
    deepseek: process.env.BUILTIN_DEEPSEEK_KEY,
    zhipu: process.env.BUILTIN_ZHIPU_KEY,
  }
  context.after(() => {
    if (previous.allow === undefined) delete process.env.ALLOW_BUILTIN_KEYS
    else process.env.ALLOW_BUILTIN_KEYS = previous.allow
    if (previous.deepseek === undefined) delete process.env.BUILTIN_DEEPSEEK_KEY
    else process.env.BUILTIN_DEEPSEEK_KEY = previous.deepseek
    if (previous.zhipu === undefined) delete process.env.BUILTIN_ZHIPU_KEY
    else process.env.BUILTIN_ZHIPU_KEY = previous.zhipu
  })

  process.env.BUILTIN_DEEPSEEK_KEY = 'test-deepseek-secret'
  process.env.BUILTIN_ZHIPU_KEY = 'test-zhipu-secret'
  delete process.env.ALLOW_BUILTIN_KEYS
  assert.equal(builtinDeepSeek().apiKey, '')
  assert.equal(builtinZhipu().apiKey, '')

  process.env.ALLOW_BUILTIN_KEYS = '1'
  assert.equal(builtinDeepSeek().apiKey, 'test-deepseek-secret')
  assert.equal(builtinZhipu().apiKey, 'test-zhipu-secret')
})

test('回收站动态恢复拒绝不可信表名和字段名', () => {
  const runtimeInsert = insertRow as (table: string, row: Record<string, unknown>) => void
  assert.throws(() => runtimeInsert('images; DROP TABLE projects', { id: 1 }), /无效数据表/)
  assert.throws(() => insertRow('images', { 'id) VALUES (1); --': 1 }), /无效字段/)
})
