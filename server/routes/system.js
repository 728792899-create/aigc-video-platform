const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// 系统信息路由（挂 /api/system）：版本、诊断日志、检查更新

// 读取应用版本（打包后真值在 resources/app/package.json，开发期在仓库根 package.json）
// 注意：不要用 server 自己的 package.json（resources/server/package.json），它的 version 不随发布更新。
function readVersion() {
  const candidates = [
    path.resolve(process.resourcesPath || '', 'app', 'package.json'),
    path.resolve(process.resourcesPath || '', 'app.asar', 'package.json'),
    path.resolve(__dirname, '../../package.json'),
    path.resolve(__dirname, '../../../app/package.json'),
    path.resolve(__dirname, '../package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg && pkg.version) return pkg.version;
    } catch (e) { /* 继续尝试下一个候选路径 */ }
  }
  return '1.0.0';
}

const APP_VERSION = readVersion();

// 读取文件末尾 N 行（诊断日志用，避免把几百 KB 全读进内存）
function tailFile(filePath, maxLines = 200) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
  } catch (e) {
    return [];
  }
}

// GET /api/system/version —— 当前版本
router.get('/version', (req, res) => {
  res.json({ code: 200, data: { version: APP_VERSION, node: process.version }, message: 'success' });
});

// GET /api/system/diagnostics —— 诊断日志（最近运行日志 + 操作日志）
router.get('/diagnostics', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const logDir = path.resolve(__dirname, '../logs');
  let opLog = [];
  try { opLog = require('../services/opLog').recent(50); } catch (e) { /* 操作日志不可用时返回空 */ }
  res.json({
    code: 200,
    data: {
      version: APP_VERSION,
      node: process.version,
      platform: process.platform,
      uptime_sec: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      generated_at: new Date().toISOString(),
      out_log: tailFile(path.join(logDir, 'out.log'), limit),
      error_log: tailFile(path.join(logDir, 'error.log'), limit),
      op_log: opLog,
    },
    message: 'success',
  });
});

// GET /api/system/check-update —— 检查更新（暂无更新服务器，返回当前已最新）
router.get('/check-update', (req, res) => {
  res.json({
    code: 200,
    data: {
      current: APP_VERSION,
      latest: APP_VERSION,
      has_update: false,
      download_url: '',
      notes: '当前已是最新版本',
    },
    message: 'success',
  });
});

module.exports = router;
