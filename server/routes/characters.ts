import express from 'express'
import { errorMessage } from './routeSupport'
const router = express.Router();
const continuity = require('../services/continuity');

router.put('/:characterId', (req, res) => {
  try {
    const character = continuity.updateCharacter(req.params.characterId, req.body || {});
    if (!character) return res.status(404).json({ code: 404, data: null, message: '角色不存在' });
    res.json({ code: 200, data: character, message: '角色已保存' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `保存角色失败: ${errorMessage(err)}` });
  }
});

router.post('/:characterId/reference-images', (req, res) => {
  try {
    const asset = continuity.addReferenceImage(req.params.characterId, req.body || {});
    if (!asset) return res.status(404).json({ code: 404, data: null, message: '角色不存在' });
    res.json({ code: 200, data: asset, message: '参考图已添加' });
  } catch (err) {
    res.status(400).json({ code: 400, data: null, message: `添加参考图失败: ${errorMessage(err)}` });
  }
});

router.post('/:characterId/lock', (req, res) => {
  try {
    const character = continuity.lockCharacter(req.params.characterId, req.body?.locked !== false);
    if (!character) return res.status(404).json({ code: 404, data: null, message: '角色不存在' });
    res.json({ code: 200, data: character, message: character.locked ? '角色已锁定' : '角色已解锁' });
  } catch (err) {
    res.status(500).json({ code: 500, data: null, message: `锁定角色失败: ${errorMessage(err)}` });
  }
});

module.exports = router;
