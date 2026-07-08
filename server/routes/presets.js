const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// 成片模板/预设（功能⑤）
// config 形如 { style, ratio, fps, voice, bgm, bgmVolume, subtitleStyle, motion, transition, burnSubtitle }
// 内置预设在首次访问时按需插入（is_builtin=1），用户预设 is_builtin=0。

const BUILTIN_PRESETS = [
  {
    name: '知识口播',
    description: '横屏 16:9 · 沉稳男声 · 底部字幕 · 轻缓运镜',
    config: { ratio: '16:9', fps: 30, voice: 'yunyang', motion: 'kenburns_in', transition: 'fade',
      burnSubtitle: true, subtitleStyle: { fontSize: 24, fontColor: '#FFFFFF', position: 'bottom' }, bgmVolume: 0.15 },
  },
  {
    name: '旅行 Vlog',
    description: '竖屏 9:16 · 温柔女声 · 缩放运镜 · 溶解转场',
    config: { ratio: '9:16', fps: 30, voice: 'xiaoxiao', motion: 'zoom_in', transition: 'dissolve',
      burnSubtitle: true, subtitleStyle: { fontSize: 28, fontColor: '#FFFFFF', position: 'bottom' }, bgmVolume: 0.25 },
  },
  {
    name: '产品种草',
    description: '竖屏 9:16 · 活力女声 · 快节奏 · 左滑转场',
    config: { ratio: '9:16', fps: 30, voice: 'xiaomo', motion: 'kenburns_out', transition: 'slide',
      burnSubtitle: true, subtitleStyle: { fontSize: 30, fontColor: '#FFEE00', position: 'bottom' }, bgmVolume: 0.3 },
  },
  {
    name: '剧情短片',
    description: '横屏 16:9 · 磁性男声 · 电影感运镜 · 溶解转场',
    config: { ratio: '16:9', fps: 30, voice: 'yunxi', motion: 'kenburns_in', transition: 'dissolve',
      burnSubtitle: true, subtitleStyle: { fontSize: 26, fontColor: '#FFFFFF', position: 'bottom' }, bgmVolume: 0.2 },
  },
  {
    name: '新闻资讯',
    description: '横屏 16:9 · 标准播报女声 · 静稳画面 · 硬切',
    config: { ratio: '16:9', fps: 30, voice: 'xiaoxiao', motion: 'none', transition: 'none',
      burnSubtitle: true, subtitleStyle: { fontSize: 24, fontColor: '#FFFFFF', position: 'bottom' }, bgmVolume: 0.1 },
  },
  {
    name: '美食探店',
    description: '竖屏 9:16 · 甜美女声 · 推近运镜 · 溶解转场',
    config: { ratio: '9:16', fps: 30, voice: 'xiaoyi', motion: 'zoom_in', transition: 'dissolve',
      burnSubtitle: true, subtitleStyle: { fontSize: 30, fontColor: '#FFD700', position: 'bottom' }, bgmVolume: 0.3 },
  },
  {
    name: '情感语录',
    description: '竖屏 9:16 · 温柔女声 · 缓推运镜 · 淡入淡出',
    config: { ratio: '9:16', fps: 30, voice: 'xiaoxiao', motion: 'kenburns_in', transition: 'fade',
      burnSubtitle: true, subtitleStyle: { fontSize: 32, fontColor: '#FFFFFF', position: 'center' }, bgmVolume: 0.35 },
  },
  {
    name: '科技数码',
    description: '横屏 16:9 · 清朗男声 · 平移运镜 · 左滑转场',
    config: { ratio: '16:9', fps: 30, voice: 'yunjian', motion: 'pan_right', transition: 'slide',
      burnSubtitle: true, subtitleStyle: { fontSize: 26, fontColor: '#00E5FF', position: 'bottom' }, bgmVolume: 0.2 },
  },
  {
    name: '儿童故事',
    description: '横屏 16:9 · 活泼女声 · 缩放运镜 · 溶解转场',
    config: { ratio: '16:9', fps: 30, voice: 'xiaoyi', motion: 'zoom_in', transition: 'dissolve',
      burnSubtitle: true, subtitleStyle: { fontSize: 30, fontColor: '#FFEB3B', position: 'bottom' }, bgmVolume: 0.3 },
  },
  {
    name: '健身运动',
    description: '竖屏 9:16 · 力量男声 · 快节奏推拉 · 硬切',
    config: { ratio: '9:16', fps: 30, voice: 'yunjian', motion: 'kenburns_out', transition: 'none',
      burnSubtitle: true, subtitleStyle: { fontSize: 30, fontColor: '#FF5722', position: 'bottom' }, bgmVolume: 0.4 },
  },
  {
    name: '电影预告',
    description: '横屏 16:9 · 低沉男声 · 史诗运镜 · 黑场过渡',
    config: { ratio: '16:9', fps: 30, voice: 'yunxi', motion: 'kenburns_in', transition: 'fade',
      burnSubtitle: true, subtitleStyle: { fontSize: 28, fontColor: '#FFFFFF', position: 'center' }, bgmVolume: 0.45 },
  },
  {
    name: '方形资讯',
    description: '方形 1:1 · 标准女声 · 静稳画面 · 溶解转场',
    config: { ratio: '1:1', fps: 30, voice: 'xiaoxiao', motion: 'none', transition: 'dissolve',
      burnSubtitle: true, subtitleStyle: { fontSize: 26, fontColor: '#FFFFFF', position: 'bottom' }, bgmVolume: 0.2 },
  },
];

function ensureBuiltins() {
  const db = getDb();
  // 按 name 补缺：已存在的内置预设不动，仅插入缺失的（支持后续版本扩充预设）
  const existing = new Set(
    db.prepare("SELECT name FROM presets WHERE is_builtin=1").all().map((r) => r.name)
  );
  const missing = BUILTIN_PRESETS.filter((p) => !existing.has(p.name));
  if (missing.length === 0) return;
  const now = Date.now();
  const stmt = db.prepare(
    'INSERT INTO presets (name, description, config, is_builtin, created_at, updated_at) VALUES (?,?,?,1,?,?)'
  );
  const run = db.transaction((list) => {
    for (const p of list) stmt.run(p.name, p.description, JSON.stringify(p.config), now, now);
  });
  run(missing);
}

function parseRow(r) {
  let cfg = {};
  try { cfg = JSON.parse(r.config || '{}'); } catch {}
  return { ...r, config: cfg, is_builtin: !!r.is_builtin };
}

// 列出所有预设（内置在前）
router.get('/', (req, res) => {
  try {
    ensureBuiltins();
    const rows = getDb().prepare(
      'SELECT * FROM presets ORDER BY is_builtin DESC, updated_at DESC'
    ).all();
    res.json({ code: 200, data: rows.map(parseRow), message: 'success' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `读取预设失败: ${err.message}` });
  }
});

// 新建用户预设  body: { name, description, config }
router.post('/', (req, res) => {
  try {
    const { name, description, config } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ code: 400, data: null, message: '请输入预设名称' });
    const now = Date.now();
    const r = getDb().prepare(
      'INSERT INTO presets (name, description, config, is_builtin, created_at, updated_at) VALUES (?,?,?,0,?,?)'
    ).run(name.trim(), description || '', JSON.stringify(config || {}), now, now);
    const row = getDb().prepare('SELECT * FROM presets WHERE id=?').get(r.lastInsertRowid);
    res.json({ code: 200, data: parseRow(row), message: '预设已保存' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `保存预设失败: ${err.message}` });
  }
});

// 更新用户预设（内置不可改）
router.put('/:id', (req, res) => {
  try {
    const row = getDb().prepare('SELECT * FROM presets WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, data: null, message: '预设不存在' });
    if (row.is_builtin) return res.status(403).json({ code: 403, data: null, message: '内置预设不可修改' });
    const { name, description, config } = req.body;
    getDb().prepare('UPDATE presets SET name=?, description=?, config=?, updated_at=? WHERE id=?')
      .run(name || row.name, description !== undefined ? description : row.description,
        JSON.stringify(config || {}), Date.now(), req.params.id);
    const updated = getDb().prepare('SELECT * FROM presets WHERE id=?').get(req.params.id);
    res.json({ code: 200, data: parseRow(updated), message: '已更新' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `更新预设失败: ${err.message}` });
  }
});

// 删除用户预设（内置不可删）
router.delete('/:id', (req, res) => {
  try {
    const row = getDb().prepare('SELECT * FROM presets WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, data: null, message: '预设不存在' });
    if (row.is_builtin) return res.status(403).json({ code: 403, data: null, message: '内置预设不可删除' });
    getDb().prepare('DELETE FROM presets WHERE id=?').run(req.params.id);
    res.json({ code: 200, data: { id: Number(req.params.id) }, message: '已删除' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `删除预设失败: ${err.message}` });
  }
});

module.exports = router;
