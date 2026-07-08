const crypto = require('crypto');
const { getDb } = require('../db');
const continuity = require('./continuity');

function cleanText(value, max = 1200) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function uniqueParts(parts) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const text = cleanText(part, 1800);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function storyboardCharacters(storyboard, characters) {
  const refs = safeJsonParse(storyboard?.characters_in_scene, []);
  const ids = Array.isArray(refs) ? refs.map((x) => Number(x.character_id)).filter(Boolean) : [];
  if (!ids.length && characters[0]) return [characters[0]];
  return characters.filter((c) => ids.includes(Number(c.id)));
}

function characterLine(character) {
  if (!character) return '';
  return uniqueParts([
    `角色ID ${character.id}「${character.name}」必须保持一致`,
    character.prompt_anchor,
    character.gender && `性别 ${character.gender}`,
    character.age && `年龄段 ${character.age}`,
    character.face && `脸型/五官 ${character.face}`,
    character.hair && `发型 ${character.hair}`,
    character.clothing && `固定服装 ${character.clothing}`,
    character.signature_props && `标志道具 ${character.signature_props}`,
  ]).join('，');
}

function qualityPrefix(style) {
  const s = String(style || '').toLowerCase();
  if (/动漫|动画|anime|animation/.test(s)) return 'masterpiece, clean animation frame, consistent character design, high detail';
  if (/水墨|国风|ink/.test(s)) return 'masterpiece, refined Chinese ink-wash composition, consistent character design';
  if (/极简|minimal/.test(s)) return 'masterpiece, minimal cinematic composition, consistent subject identity';
  return 'masterpiece, best quality, cinematic lighting, highly detailed, consistent character identity';
}

function compileImagePrompt({
  project,
  storyboard,
  userPrompt = '',
  style = '',
  visualAnchor = '',
  continuityContext = null,
} = {}) {
  const projectId = project?.id || storyboard?.project_id;
  let bible = null;
  let characters = [];
  try { bible = projectId ? continuity.getStoryBible(projectId) : null; } catch (_) {}
  try { characters = projectId ? continuity.listCharacters(projectId) : []; } catch (_) {}
  const sceneCharacters = storyboardCharacters(storyboard, characters);
  const baseScene = cleanText(userPrompt || storyboard?.prompt || storyboard?.description || storyboard?.dialog || '', 2200);
  const charLines = sceneCharacters.map(characterLine).filter(Boolean);
  const storyRules = uniqueParts([
    bible?.style_anchor,
    bible?.worldview && `系列世界观：${bible.worldview}`,
    bible?.locked_facts && `禁止改写事实：${bible.locked_facts}`,
    bible?.scene_rules && `连续性规则：${bible.scene_rules}`,
  ]);
  const negativeRules = uniqueParts([
    '不要改变主角身份、脸型、发型、年龄段、固定服装和标志道具',
    ...sceneCharacters.map((c) => c.negative_constraints),
    'no watermark, no logo, no text, no extra fingers, no distorted face, no inconsistent outfit',
  ]);
  const blocks = [
    qualityPrefix(style || project?.style),
    visualAnchor,
    ...storyRules,
    ...charLines,
    continuityContext?.promptAnchor,
    `当前镜头：${baseScene}`,
  ];
  const prompt = uniqueParts(blocks).join(', ');
  const negativePrompt = uniqueParts(negativeRules).join(', ');
  const context = {
    project_id: projectId ? Number(projectId) : null,
    storyboard_id: storyboard?.id ? Number(storyboard.id) : null,
    character_ids: sceneCharacters.map((c) => Number(c.id)),
    reference_count: continuityContext?.referenceImages?.length || 0,
    story_bible_id: bible?.id || null,
    strict: continuityContext?.mode === 'strict',
  };
  return {
    prompt: prompt.slice(0, 6000),
    negativePrompt: negativePrompt.slice(0, 1800),
    context,
    promptHash: hashText(prompt),
    contextHash: hashText(JSON.stringify(context)),
  };
}

function cacheKey({ kind = 'image', model = 'auto', promptHash, contextHash, storyboardId = '' }) {
  return hashText([kind, model || 'auto', storyboardId || '', promptHash, contextHash].join('|'));
}

function getCachedGeneration({ kind = 'image', model = 'auto', promptHash, contextHash, storyboardId = '' } = {}) {
  const key = cacheKey({ kind, model, promptHash, contextHash, storyboardId });
  const row = getDb().prepare('SELECT * FROM generation_cache WHERE cache_key = ?').get(key);
  if (!row) return null;
  let result = null;
  try { result = JSON.parse(row.result || 'null'); } catch { result = null; }
  getDb().prepare('UPDATE generation_cache SET hit_count = COALESCE(hit_count, 0) + 1, updated_at = ? WHERE id = ?')
    .run(Date.now(), row.id);
  return { ...row, result, cache_key: key };
}

function saveGenerationCache({
  kind = 'image',
  model = 'auto',
  provider = '',
  projectId = null,
  storyboardId = null,
  prompt = '',
  promptHash,
  contextHash,
  result,
} = {}) {
  if (!promptHash || !contextHash || !result) return null;
  const key = cacheKey({ kind, model, promptHash, contextHash, storyboardId });
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO generation_cache
     (cache_key, project_id, storyboard_id, kind, provider, model, prompt_hash, prompt, context_hash, result, hit_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       provider=excluded.provider, model=excluded.model, prompt=excluded.prompt,
       result=excluded.result, updated_at=excluded.updated_at`
  ).run(
    key, projectId || null, storyboardId || null, kind, provider || '', model || 'auto',
    promptHash, prompt.slice(0, 6000), contextHash, JSON.stringify(result), now, now
  );
  return key;
}

function scoreImageCandidate({ image = {}, continuityCheck = null, index = 0 } = {}) {
  let score = 100 - index;
  const status = String(image.gen_status || '').toLowerCase();
  const path = image.file_url || image.file_path || '';
  if (/placeholder/.test(status) || /placeholder/i.test(path)) score -= 45;
  if (!path) score -= 30;
  if (continuityCheck?.score != null) score += Math.round((Number(continuityCheck.score) - 80) / 2);
  if (continuityCheck?.status === 'risk') score -= 20;
  if (continuityCheck?.status === 'warn') score -= 8;
  return Math.max(0, Math.min(120, score));
}

function rankImageCandidates(images = [], checks = []) {
  const checkByImage = new Map(checks.map((c) => [Number(c.image_id), c]));
  return images.map((image, index) => ({
    image,
    score: scoreImageCandidate({ image, continuityCheck: checkByImage.get(Number(image.id)), index }),
    continuity: checkByImage.get(Number(image.id)) || null,
  })).sort((a, b) => b.score - a.score);
}

module.exports = {
  compileImagePrompt,
  getCachedGeneration,
  saveGenerationCache,
  rankImageCandidates,
  hashText,
};
