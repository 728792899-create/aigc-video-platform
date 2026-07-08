const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// 获取项目的配音列表
router.get('/project/:projectId', (req, res) => {
  const storyboards = getDb().prepare(
    'SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(req.params.projectId);
  res.json({ code: 200, data: storyboards, message: 'success' });
});

module.exports = router;
