import express from 'express'
const router = express.Router();
const opLog = require('../services/opLog');

// 操作日志路由（挂 /api/logs）
router.get('/', (req, res) => {
  const limit = req.query.limit || 100;
  res.json({ code: 200, data: opLog.recent(limit), message: 'success' });
});

module.exports = router;
