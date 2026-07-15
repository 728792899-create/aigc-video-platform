import express from 'express'
const router = express.Router();
const trash = require('../services/trash');
const opLog = require('../services/opLog');

// 回收站 + 操作日志路由（挂 /api/trash）

// 回收站列表
router.get('/', (req, res) => {
  res.json({ code: 200, data: trash.listTrash(req.query.category || 'all'), message: 'success' });
});

// 回收站条目详情
router.get('/:id', (req, res) => {
  const detail = trash.getTrashDetail(req.params.id, req.query.group_key || req.query.groupKey || null);
  if (!detail) return res.status(404).json({ code: 404, data: null, message: '回收站条目不存在' });
  res.json({ code: 200, data: detail, message: 'success' });
});

// 还原一个条目
router.post('/:id/restore', (req, res) => {
  const ok = trash.restoreTrash(req.params.id);
  if (!ok) return res.status(404).json({ code: 404, data: null, message: '回收站条目不存在或快照损坏' });
  res.json({ code: 200, data: null, message: '已还原' });
});

// 还原文件型回收条目中的指定内容
router.post('/:id/restore-items', (req, res) => {
  const result = trash.restoreTrashItems(req.params.id, req.body && req.body.keys);
  if (!result.ok) {
    return res.status(result.status || 400).json({ code: result.status || 400, data: null, message: result.message || '还原失败' });
  }
  res.json({ code: 200, data: result, message: `已还原 ${result.restoredCount} 项内容` });
});

// 彻底删除文件型回收条目中的指定内容
router.delete('/:id/items', (req, res) => {
  const result = trash.purgeTrashItems(req.params.id, req.body && req.body.keys);
  if (!result.ok) {
    return res.status(result.status || 400).json({ code: result.status || 400, data: null, message: result.message || '彻底删除失败' });
  }
  res.json({ code: 200, data: result, message: `已彻底删除 ${result.purgedCount} 项内容` });
});

// 彻底删除一个条目
router.delete('/:id', (req, res) => {
  const ok = trash.purgeTrash(req.params.id);
  if (!ok) return res.status(404).json({ code: 404, data: null, message: '回收站条目不存在' });
  res.json({ code: 200, data: null, message: '已彻底删除' });
});

// 清空回收站
router.delete('/', (req, res) => {
  const n = trash.emptyTrash();
  res.json({ code: 200, data: { removed: n }, message: `已清空回收站（${n} 项）` });
});

module.exports = router;
