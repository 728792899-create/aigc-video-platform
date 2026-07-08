const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { BUILTIN_SKILLS } = require('../services/builtinSkills');

// 创作技能库（功能⑦，v1.6.15 增强）
//   skill = { name, description, stage, prompt, icon, is_builtin, enabled, auto_apply, source }
//   stage: 'script'(文案) | 'image'(图片) | 'voice'(配音) | 'all'(通用)
//   auto_apply: 1=必用技能（生成时自动注入，无需手动勾选）；0=可选技能（用户勾选才生效）
//   source: 'builtin'(平台内置) | 'skillhub'(技能市场) | 'custom'(用户自建)
//   AI 生成阶段：必用技能自动注入 + 用户额外勾选的可选技能，prompt 一起拼进 system prompt 增强生成。

const VALID_STAGES = ['script', 'image', 'voice', 'all'];

function ensureBuiltins() {
  const db = getDb();
  const existing = new Set(
    db.prepare("SELECT name FROM skills WHERE is_builtin=1").all().map((r) => r.name)
  );
  const missing = BUILTIN_SKILLS.filter((s) => !existing.has(s.name));
  if (missing.length === 0) return;
  const now = Date.now();
  const stmt = db.prepare(
    'INSERT INTO skills (name, description, stage, prompt, icon, is_builtin, enabled, auto_apply, source, created_at, updated_at) VALUES (?,?,?,?,?,1,1,?,?,?,?)'
  );
  const run = db.transaction((list) => {
    for (const s of list) {
      stmt.run(
        s.name, s.description || '', s.stage || 'all', s.prompt,
        s.icon || '✨', s.auto_apply ? 1 : 0, s.source || 'builtin', now, now
      );
    }
  });
  run(missing);
}

function parseRow(r) {
  return { ...r, is_builtin: !!r.is_builtin, enabled: !!r.enabled, auto_apply: !!r.auto_apply };
}

function isDeletedWhere(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `COALESCE(${p}deleted_at, 0) = 0`;
}

function snapshotSkill(row) {
  if (!row) return null;
  const { id, ...rest } = row;
  return rest;
}

function saveVersion(skillId, row, summary = '迭代修改') {
  if (!row) return;
  getDb().prepare('INSERT INTO skill_versions (skill_id, snapshot, summary, created_at) VALUES (?,?,?,?)')
    .run(skillId, JSON.stringify(snapshotSkill(row)), summary, Date.now());
}

// 列出技能（可按 stage 过滤；stage=script 时同时返回 all 通用技能）
router.get('/', (req, res) => {
  try {
    ensureBuiltins();
    const { stage, enabled_only } = req.query;
    let rows;
    if (stage && VALID_STAGES.includes(stage) && stage !== 'all') {
      rows = getDb().prepare(
        `SELECT * FROM skills WHERE (${isDeletedWhere()}) AND (stage=? OR stage='all') ORDER BY is_builtin DESC, updated_at DESC`
      ).all(stage);
    } else {
      rows = getDb().prepare(
        `SELECT * FROM skills WHERE ${isDeletedWhere()} ORDER BY is_builtin DESC, updated_at DESC`
      ).all();
    }
    if (String(enabled_only) === '1') rows = rows.filter((r) => r.enabled);
    res.json({ code: 200, data: rows.map(parseRow), message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取技能失败: ${err.message}` });
  }
});

// 取「当前会自动生效的必用技能」清单（供创作页透明展示给用户：哪些技能正在自动增强）。
// 可按 stage 过滤；不传则返回全部阶段的必用技能。注意：必须放在 /:id 之前注册，否则会被 /:id 捕获。
router.get('/active', (req, res) => {
  try {
    ensureBuiltins();
    const { stage } = req.query;
    let rows;
    if (stage && VALID_STAGES.includes(stage) && stage !== 'all') {
      rows = getDb().prepare(
        `SELECT * FROM skills WHERE ${isDeletedWhere()} AND auto_apply=1 AND enabled=1 AND (stage=? OR stage='all') ORDER BY is_builtin DESC, id ASC`
      ).all(stage);
    } else {
      rows = getDb().prepare(
        `SELECT * FROM skills WHERE ${isDeletedWhere()} AND auto_apply=1 AND enabled=1 ORDER BY stage ASC, is_builtin DESC, id ASC`
      ).all();
    }
    res.json({ code: 200, data: rows.map(parseRow), message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取生效技能失败: ${err.message}` });
  }
});

// 取单个技能
router.get('/:id', (req, res) => {
  try {
    const row = getDb().prepare(`SELECT * FROM skills WHERE id=? AND ${isDeletedWhere()}`).get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, data: null, message: '技能不存在' });
    res.json({ code: 200, data: parseRow(row), message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

// 创建技能（用户自建，source=custom）
router.post('/', (req, res) => {
  try {
    const { name, description = '', stage = 'all', prompt, icon = '✨', auto_apply = 0 } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ code: 400, data: null, message: '技能名称不能为空' });
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ code: 400, data: null, message: '技能提示词不能为空' });
    const st = VALID_STAGES.includes(stage) ? stage : 'all';
    const now = Date.now();
    const r = getDb().prepare(
      'INSERT INTO skills (name, description, stage, prompt, icon, is_builtin, enabled, auto_apply, source, created_at, updated_at) VALUES (?,?,?,?,?,0,1,?,?,?,?)'
    ).run(String(name).trim(), String(description).trim(), st, String(prompt).trim(), String(icon || '✨'), auto_apply ? 1 : 0, 'custom', now, now);
    const row = getDb().prepare('SELECT * FROM skills WHERE id=?').get(r.lastInsertRowid);
    res.json({ code: 200, data: parseRow(row), message: '创建成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

// 更新技能（内置技能仅允许改 enabled / auto_apply；自建技能可改全部）
router.put('/:id', (req, res) => {
  try {
    const row = getDb().prepare(`SELECT * FROM skills WHERE id=? AND ${isDeletedWhere()}`).get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, data: null, message: '技能不存在' });
    const b = req.body || {};

    const coreFields = ['name', 'description', 'stage', 'prompt', 'icon'];
    if (row.is_builtin && coreFields.some(k => b[k] !== undefined)) {
      const st = b.stage && VALID_STAGES.includes(b.stage) ? b.stage : row.stage;
      const now = Date.now();
      const r = getDb().prepare(
        'INSERT INTO skills (name, description, stage, prompt, icon, is_builtin, enabled, auto_apply, source, created_at, updated_at) VALUES (?,?,?,?,?,0,1,?,?,?,?)'
      ).run(
        String(b.name ?? `${row.name}（我的版本）`).trim(),
        String(b.description ?? row.description ?? '').trim(),
        st,
        String(b.prompt ?? row.prompt).trim(),
        String(b.icon ?? row.icon ?? '✨'),
        b.auto_apply !== undefined ? (b.auto_apply ? 1 : 0) : (row.auto_apply ? 1 : 0),
        'custom',
        now,
        now
      );
      const created = getDb().prepare('SELECT * FROM skills WHERE id=?').get(r.lastInsertRowid);
      saveVersion(created.id, row, '从内置技能创建我的版本');
      return res.json({ code: 200, data: parseRow(created), message: '已基于内置技能创建我的版本' });
    }

    const fields = [], vals = [];
    // 内置技能保护：不能改名称/提示词等核心定义，但允许用户开关启用和「必用」状态，
    // 让用户能自主决定平台内置技能是否参与自动注入。
    const allow = row.is_builtin
      ? ['enabled', 'auto_apply']
      : ['name', 'description', 'stage', 'prompt', 'icon', 'enabled', 'auto_apply'];
    for (const k of allow) {
      if (b[k] === undefined) continue;
      if (k === 'stage' && !VALID_STAGES.includes(b[k])) continue;
      fields.push(`${k}=?`);
      vals.push((k === 'enabled' || k === 'auto_apply') ? (b[k] ? 1 : 0) : String(b[k]));
    }
    if (fields.length === 0) return res.json({ code: 200, data: parseRow(row), message: '无变更' });
    if (!row.is_builtin) saveVersion(row.id, row, b.summary || '迭代修改');
    fields.push('updated_at=?'); vals.push(Date.now()); vals.push(req.params.id);
    getDb().prepare(`UPDATE skills SET ${fields.join(', ')} WHERE id=?`).run(...vals);
    const updated = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
    res.json({ code: 200, data: parseRow(updated), message: '更新成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

// 删除技能（所有技能均可删除；内置技能软删除，便于恢复默认）
router.delete('/:id', (req, res) => {
  try {
    const row = getDb().prepare(`SELECT * FROM skills WHERE id=? AND ${isDeletedWhere()}`).get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, data: null, message: '技能不存在' });
    saveVersion(row.id, row, '删除前备份');
    getDb().prepare('UPDATE skills SET deleted_at=?, enabled=0, updated_at=? WHERE id=?').run(Date.now(), Date.now(), req.params.id);
    res.json({ code: 200, data: null, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

// 恢复内置默认技能
router.post('/restore-builtins', (req, res) => {
  try {
    ensureBuiltins();
    const db = getDb();
    const now = Date.now();
    let restored = 0;
    const run = db.transaction((list) => {
      for (const s of list) {
        const row = db.prepare('SELECT * FROM skills WHERE is_builtin=1 AND name=?').get(s.name);
        if (row) {
          db.prepare(
            'UPDATE skills SET description=?, stage=?, prompt=?, icon=?, enabled=1, auto_apply=?, source=?, deleted_at=0, updated_at=? WHERE id=?'
          ).run(s.description || '', s.stage || 'all', s.prompt, s.icon || '✨', s.auto_apply ? 1 : 0, s.source || 'builtin', now, row.id);
          restored++;
        }
      }
    });
    run(BUILTIN_SKILLS);
    res.json({ code: 200, data: { restored }, message: `已恢复 ${restored} 个内置技能` });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

// 技能版本记录
router.get('/:id/versions', (req, res) => {
  try {
    const row = getDb().prepare(`SELECT * FROM skills WHERE id=? AND ${isDeletedWhere()}`).get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, data: null, message: '技能不存在' });
    const versions = getDb().prepare('SELECT * FROM skill_versions WHERE skill_id=? ORDER BY created_at DESC, id DESC').all(req.params.id)
      .map(v => ({ ...v, snapshot: JSON.parse(v.snapshot || '{}') }));
    res.json({ code: 200, data: versions, message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

// 回滚到指定版本
router.post('/:id/versions/:versionId/restore', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM skills WHERE id=? AND ${isDeletedWhere()}`).get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, data: null, message: '技能不存在' });
    const version = db.prepare('SELECT * FROM skill_versions WHERE id=? AND skill_id=?').get(req.params.versionId, req.params.id);
    if (!version) return res.status(404).json({ code: 404, data: null, message: '版本不存在' });
    const snap = JSON.parse(version.snapshot || '{}');
    saveVersion(row.id, row, '回滚前备份');
    const st = VALID_STAGES.includes(snap.stage) ? snap.stage : 'all';
    db.prepare(
      `UPDATE skills SET name=?, description=?, stage=?, prompt=?, icon=?, enabled=?, auto_apply=?, source=?, deleted_at=0, updated_at=? WHERE id=?`
    ).run(
      snap.name || row.name,
      snap.description || '',
      st,
      snap.prompt || row.prompt,
      snap.icon || '✨',
      snap.enabled ? 1 : 0,
      snap.auto_apply ? 1 : 0,
      snap.source || row.source || 'custom',
      Date.now(),
      req.params.id
    );
    const updated = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
    res.json({ code: 200, data: parseRow(updated), message: '已恢复到该版本' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

// 导入技能（批量，JSON 数组）— 用于第三方技能分享
router.post('/import', (req, res) => {
  try {
    const list = Array.isArray(req.body) ? req.body : (req.body && req.body.skills) || [];
    if (!Array.isArray(list) || list.length === 0) return res.status(400).json({ code: 400, data: null, message: '导入数据为空或格式错误' });
    const now = Date.now();
    const stmt = getDb().prepare(
      'INSERT INTO skills (name, description, stage, prompt, icon, is_builtin, enabled, auto_apply, source, created_at, updated_at) VALUES (?,?,?,?,?,0,1,?,?,?,?)'
    );
    let n = 0;
    const run = getDb().transaction((arr) => {
      for (const s of arr) {
        if (!s || !s.name || !s.prompt) continue;
        const st = VALID_STAGES.includes(s.stage) ? s.stage : 'all';
        // 导入的技能默认标记来源 skillhub（技能市场分享），可在 body 显式覆盖
        const src = (s.source && ['builtin', 'skillhub', 'custom'].includes(s.source)) ? s.source : 'skillhub';
        stmt.run(String(s.name).trim(), String(s.description || '').trim(), st, String(s.prompt).trim(), String(s.icon || '✨'), s.auto_apply ? 1 : 0, src, now, now);
        n++;
      }
    });
    run(list);
    res.json({ code: 200, data: { imported: n }, message: `成功导入 ${n} 个技能` });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: err.message });
  }
});

// ============ 供后端其它服务调用的内部函数（技能 prompt 取用）============

// 取单个技能的 prompt（仅在该技能 enabled 时返回）。保留旧签名，向后兼容。
function getSkillPrompt(skillId) {
  if (!skillId) return '';
  try {
    const row = getDb().prepare(`SELECT prompt, enabled FROM skills WHERE id=? AND ${isDeletedWhere()}`).get(skillId);
    return row && row.enabled ? (row.prompt || '') : '';
  } catch { return ''; }
}

// 取多个技能 id 对应的 prompt 列表（去重、保序、只取 enabled）。用于「用户手动勾选的可选技能」。
function getSkillPromptsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    const p = getSkillPrompt(id);
    if (p && p.trim()) out.push(p.trim());
  }
  return out;
}

// 取某阶段所有「必用技能」(auto_apply=1 且 enabled=1) 的 prompt 列表。
// stage 传 'script'|'image'|'voice' 时，同时纳入 stage='all' 的通用必用技能。
function getAutoSkillPrompts(stage) {
  try {
    let rows;
    if (stage && VALID_STAGES.includes(stage) && stage !== 'all') {
      rows = getDb().prepare(
        `SELECT prompt FROM skills WHERE ${isDeletedWhere()} AND auto_apply=1 AND enabled=1 AND (stage=? OR stage='all') ORDER BY is_builtin DESC, id ASC`
      ).all(stage);
    } else {
      rows = getDb().prepare(
        `SELECT prompt FROM skills WHERE ${isDeletedWhere()} AND auto_apply=1 AND enabled=1 ORDER BY is_builtin DESC, id ASC`
      ).all();
    }
    return rows.map((r) => (r.prompt || '').trim()).filter(Boolean);
  } catch { return []; }
}

/**
 * 计算某生成阶段最终生效的技能增强提示词（合并文本）。
 *   = 该阶段所有「必用技能」(auto_apply) 自动注入
 *   + 用户本次手动勾选的「可选技能」(manualIds)
 * 多条 prompt 用换行拼接，去重避免必用技能被手动重复勾选时叠加两遍。
 * @param {string} stage  'script' | 'image' | 'voice'
 * @param {Array<number>|number} [manualIds] 用户手动勾选的技能 id（兼容单个 id）
 * @returns {{ text: string, autoCount: number, manualCount: number }}
 */
function getEffectiveSkillPrompt(stage, manualIds) {
  const ids = Array.isArray(manualIds) ? manualIds : (manualIds != null ? [manualIds] : []);
  const autoPrompts = getAutoSkillPrompts(stage);
  const manualPrompts = getSkillPromptsByIds(ids);
  // 合并去重（必用技能优先在前）
  const merged = [];
  const seen = new Set();
  for (const p of [...autoPrompts, ...manualPrompts]) {
    const key = p.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  return {
    text: merged.join('\n'),
    autoCount: autoPrompts.length,
    manualCount: manualPrompts.filter((p) => !autoPrompts.includes(p)).length,
  };
}

module.exports = router;
module.exports.getSkillPrompt = getSkillPrompt;
module.exports.getSkillPromptsByIds = getSkillPromptsByIds;
module.exports.getAutoSkillPrompts = getAutoSkillPrompts;
module.exports.getEffectiveSkillPrompt = getEffectiveSkillPrompt;
