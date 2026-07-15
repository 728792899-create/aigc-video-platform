import crypto from 'node:crypto'
import { getDb } from '../db'
const continuity = require('./continuity');

type JsonObject = Record<string, unknown>
function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function cleanText(value: unknown, max = 1200): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeJsonParse(value: unknown, fallback: unknown = null): unknown {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

export function hashText(value: unknown): string {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function uniqueParts(parts: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
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

function storyboardCharacters(storyboard: JsonObject, characters: JsonObject[]): JsonObject[] {
  const refs = safeJsonParse(storyboard.characters_in_scene, []);
  const ids = Array.isArray(refs) ? refs.map((value) => Number(asRecord(value).character_id)).filter(Boolean) : [];
  if (!ids.length && characters[0]) return [characters[0]];
  return characters.filter((c) => ids.includes(Number(c.id)));
}

function characterLine(character: JsonObject): string {
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

function qualityPrefix(style: unknown): string {
  const s = String(style || '').toLowerCase();
  if (/动漫|动画|anime|animation/.test(s)) return 'masterpiece, clean animation frame, consistent character design, high detail';
  if (/水墨|国风|ink/.test(s)) return 'masterpiece, refined Chinese ink-wash composition, consistent character design';
  if (/极简|minimal/.test(s)) return 'masterpiece, minimal cinematic composition, consistent subject identity';
  return 'masterpiece, best quality, cinematic lighting, highly detailed, consistent character identity';
}

export function compileImagePrompt({
  project: projectValue,
  storyboard: storyboardValue,
  userPrompt = '',
  style = '',
  visualAnchor = '',
  continuityContext: continuityValue = null,
}: {
  project?: unknown
  storyboard?: unknown
  userPrompt?: string
  style?: string
  visualAnchor?: string
  continuityContext?: unknown
} = {}) {
  const project = asRecord(projectValue);
  const storyboard = asRecord(storyboardValue);
  const continuityContext = asRecord(continuityValue);
  const projectId = project.id || storyboard.project_id;
  let bible: JsonObject = {};
  let characters: JsonObject[] = [];
  try { bible = projectId ? asRecord(continuity.getStoryBible(projectId)) : {}; } catch (_) {}
  try {
    const listed: unknown = projectId ? continuity.listCharacters(projectId) : [];
    characters = Array.isArray(listed) ? listed.map(asRecord) : [];
  } catch (_) {}
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
    ...sceneCharacters.map((character) => character.negative_constraints),
    'no watermark, no logo, no text, no extra fingers, no distorted face, no inconsistent outfit',
  ]);
  const blocks = [
    qualityPrefix(style || project?.style),
    visualAnchor,
    ...storyRules,
    ...charLines,
    continuityContext.promptAnchor,
    `当前镜头：${baseScene}`,
  ];
  const prompt = uniqueParts(blocks).join(', ');
  const negativePrompt = uniqueParts(negativeRules).join(', ');
  const context = {
    project_id: projectId ? Number(projectId) : null,
    storyboard_id: storyboard?.id ? Number(storyboard.id) : null,
    character_ids: sceneCharacters.map((character) => Number(character.id)),
    reference_count: Array.isArray(continuityContext.referenceImages) ? continuityContext.referenceImages.length : 0,
    story_bible_id: bible.id || null,
    strict: continuityContext.mode === 'strict',
  };
  return {
    prompt: prompt.slice(0, 6000),
    negativePrompt: negativePrompt.slice(0, 1800),
    context,
    promptHash: hashText(prompt),
    contextHash: hashText(JSON.stringify(context)),
  };
}

interface CacheKeyInput {
  kind?: string
  model?: string
  promptHash?: string
  contextHash?: string
  storyboardId?: string | number | null
}

function cacheKey({ kind = 'image', model = 'auto', promptHash = '', contextHash = '', storyboardId = '' }: CacheKeyInput): string {
  return hashText([kind, model || 'auto', storyboardId || '', promptHash, contextHash].join('|'));
}

export function getCachedGeneration({ kind = 'image', model = 'auto', promptHash = '', contextHash = '', storyboardId = '' }: CacheKeyInput = {}) {
  const key = cacheKey({ kind, model, promptHash, contextHash, storyboardId });
  const row = getDb().prepare('SELECT * FROM generation_cache WHERE cache_key = ?').get(key);
  if (!row) return null;
  let result = null;
  try { result = JSON.parse(String(row.result || 'null')); } catch { result = null; }
  getDb().prepare('UPDATE generation_cache SET hit_count = COALESCE(hit_count, 0) + 1, updated_at = ? WHERE id = ?')
    .run(Date.now(), row.id);
  return { ...row, result, cache_key: key };
}

export function saveGenerationCache({
  kind = 'image',
  model = 'auto',
  provider = '',
  projectId = null,
  storyboardId = null,
  prompt = '',
  promptHash,
  contextHash,
  result,
}: CacheKeyInput & {
  provider?: string
  projectId?: string | number | null
  prompt?: string
  result?: unknown
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

function scoreImageCandidate({ image: imageValue = {}, continuityCheck: checkValue = null, index = 0 }: {
  image?: unknown
  continuityCheck?: unknown
  index?: number
} = {}): number {
  const image = asRecord(imageValue);
  const continuityCheck = asRecord(checkValue);
  let score = 100 - index;
  const status = String(image.gen_status || '').toLowerCase();
  const path = String(image.file_url || image.file_path || '');
  if (/placeholder/.test(status) || /placeholder/i.test(path)) score -= 45;
  if (!path) score -= 30;
  if (continuityCheck.score != null) score += Math.round((Number(continuityCheck.score) - 80) / 2);
  if (continuityCheck.status === 'risk') score -= 20;
  if (continuityCheck.status === 'warn') score -= 8;
  return Math.max(0, Math.min(120, score));
}

export function rankImageCandidates(images: unknown[] = [], checks: unknown[] = []) {
  const normalizedChecks = checks.map(asRecord);
  const checkByImage = new Map(normalizedChecks.map((check) => [Number(check.image_id), check]));
  return images.map((value, index) => {
    const image = asRecord(value);
    return {
    image,
    score: scoreImageCandidate({ image, continuityCheck: checkByImage.get(Number(image.id)), index }),
    continuity: checkByImage.get(Number(image.id)) || null,
    };
  }).sort((a, b) => b.score - a.score);
}
