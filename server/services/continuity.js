const { getDb } = require('../db');

function now() {
  return Date.now();
}

function cleanText(value, max = 4000) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function jsonText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((x) => cleanText(x, 800)).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/\n|;|；|、/).map((x) => cleanText(x, 800)).filter(Boolean);
  }
  return [];
}

function getProject(projectId) {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
}

function getSeries(seriesId) {
  if (!seriesId) return null;
  return getDb().prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
}

function inferEpisodeIndex(seriesId) {
  if (!seriesId) return 1;
  const row = getDb().prepare('SELECT COALESCE(MAX(episode_index), 0) AS n FROM projects WHERE series_id = ?').get(seriesId);
  return Number(row?.n || 0) + 1;
}

function ensureSeriesForProject(projectId) {
  const db = getDb();
  const project = getProject(projectId);
  if (!project) return null;
  let seriesId = project.series_id;
  let series = getSeries(seriesId);
  if (!series) {
    const title = cleanText(project.name || project.theme || `项目 ${project.id}`, 200) || `项目 ${project.id}`;
    const res = db.prepare(
      'INSERT INTO series (title, description, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(title, cleanText(project.theme || '', 1000), project.style || '写实', now(), now());
    seriesId = res.lastInsertRowid;
    db.prepare(
      "UPDATE projects SET series_id = ?, episode_index = COALESCE(episode_index, 1), continuity_status = COALESCE(NULLIF(continuity_status, ''), 'initialized') WHERE id = ?"
    ).run(seriesId, projectId);
    series = getSeries(seriesId);
  }
  ensureStoryBible(projectId, seriesId);
  return { ...project, series_id: seriesId, series };
}

function storyBibleRow(seriesId) {
  return getDb().prepare('SELECT * FROM story_bibles WHERE series_id = ? ORDER BY id ASC LIMIT 1').get(seriesId);
}

function defaultStoryBible(project) {
  const script = safeJsonParse(project.script_content, {});
  const summary = cleanText(script?.summary || project.theme || '', 1000);
  return {
    worldview: cleanText(script?.story_bible?.worldview || project.theme || '围绕项目主题展开的短视频故事世界。', 1500),
    mainline: cleanText(script?.story_bible?.mainline || summary || project.theme || '', 1500),
    timeline: jsonText(script?.story_bible?.timeline || []),
    previous_summary: cleanText(project.ending_summary || summary, 1500),
    open_threads: jsonText(script?.story_bible?.open_threads || []),
    locked_facts: jsonText(script?.story_bible?.locked_facts || []),
    relationships: jsonText(script?.story_bible?.relationships || []),
    scene_rules: cleanText(script?.story_bible?.scene_rules || '保持人物外貌、服装、标志道具、关系和世界观设定连续。', 1500),
    style_anchor: cleanText(script?.visual_anchor || project.visual_anchor || project.style || '', 2000),
  };
}

function ensureStoryBible(projectId, seriesId) {
  const db = getDb();
  const project = getProject(projectId);
  if (!project || !seriesId) return null;
  let row = storyBibleRow(seriesId);
  if (!row) {
    const b = defaultStoryBible(project);
    const res = db.prepare(
      `INSERT INTO story_bibles
       (series_id, project_id, worldview, mainline, timeline, previous_summary, open_threads, locked_facts, relationships, scene_rules, style_anchor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      seriesId, projectId, b.worldview, b.mainline, b.timeline, b.previous_summary,
      b.open_threads, b.locked_facts, b.relationships, b.scene_rules, b.style_anchor, now(), now()
    );
    row = db.prepare('SELECT * FROM story_bibles WHERE id = ?').get(res.lastInsertRowid);
  }
  return row;
}

function normalizeStoryBible(row) {
  if (!row) return null;
  return {
    ...row,
    timeline_items: safeJsonParse(row.timeline, normalizeList(row.timeline)),
    open_thread_items: safeJsonParse(row.open_threads, normalizeList(row.open_threads)),
    locked_fact_items: safeJsonParse(row.locked_facts, normalizeList(row.locked_facts)),
    relationship_items: safeJsonParse(row.relationships, normalizeList(row.relationships)),
  };
}

function getStoryBible(projectId) {
  const project = ensureSeriesForProject(projectId);
  if (!project) return null;
  return normalizeStoryBible(ensureStoryBible(projectId, project.series_id));
}

function updateStoryBible(projectId, payload = {}) {
  const project = ensureSeriesForProject(projectId);
  if (!project) return null;
  const current = ensureStoryBible(projectId, project.series_id);
  const fields = [
    'worldview', 'mainline', 'timeline', 'previous_summary',
    'open_threads', 'locked_facts', 'relationships', 'scene_rules', 'style_anchor',
  ];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (payload[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(['timeline', 'open_threads', 'locked_facts', 'relationships'].includes(field)
        ? jsonText(payload[field])
        : cleanText(payload[field], 4000));
    }
  }
  if (updates.length) {
    updates.push('updated_at = ?');
    values.push(now(), current.id);
    getDb().prepare(`UPDATE story_bibles SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  return getStoryBible(projectId);
}

function characterFromScriptItem(item, fallbackAnchor = '') {
  const name = cleanText(item.name || item.character_name || item.alias || '主角', 80) || '主角';
  const promptAnchor = cleanText(
    item.prompt_anchor || item.visual_anchor || item.appearance || item.description || fallbackAnchor,
    2000
  );
  return {
    name,
    alias: cleanText(item.alias || '', 200),
    role: cleanText(item.role || item.identity || '主角', 200),
    age: cleanText(item.age || item.age_range || '', 80),
    gender: cleanText(item.gender || '', 80),
    face: cleanText(item.face || item.face_features || '', 400),
    hair: cleanText(item.hair || item.hair_style || '', 400),
    clothing: cleanText(item.clothing || item.outfit || '', 500),
    signature_props: cleanText(item.signature_props || item.props || '', 500),
    personality: cleanText(item.personality || '', 500),
    voice: cleanText(item.voice || '', 200),
    negative_constraints: cleanText(item.negative_constraints || 'do not change face, hairstyle, age, outfit, signature props', 500),
    prompt_anchor: promptAnchor,
    locked: item.locked ? 1 : 0,
    is_primary: item.is_primary === false ? 0 : (item.is_primary || /主角|protagonist|hero/i.test(String(item.role || name)) ? 1 : 0),
  };
}

function extractScriptCharacters(project) {
  const script = safeJsonParse(project.script_content, {});
  const candidates = [];
  const sources = [
    script?.characters,
    script?.character_library,
    script?.story_bible?.characters,
  ];
  for (const src of sources) {
    if (Array.isArray(src)) candidates.push(...src);
  }
  if (candidates.length) {
    return candidates.map((item) => characterFromScriptItem(item, project.visual_anchor || script.visual_anchor || ''));
  }
  return [{
    name: '主角',
    alias: '',
    role: '主角',
    age: '',
    gender: '',
    face: '',
    hair: '',
    clothing: '',
    signature_props: '',
    personality: cleanText(project.theme || '', 500),
    voice: '',
    negative_constraints: 'do not change face, hairstyle, age, outfit, signature props',
    prompt_anchor: cleanText(project.visual_anchor || script.visual_anchor || project.theme || '', 2000),
    locked: 0,
    is_primary: 1,
  }];
}

function listCharacters(projectId, { includeDeleted = false } = {}) {
  const project = ensureSeriesForProject(projectId);
  if (!project) return [];
  const rows = getDb().prepare(
    `SELECT * FROM characters
     WHERE series_id = ? ${includeDeleted ? '' : 'AND COALESCE(deleted_at, 0) = 0'}
     ORDER BY is_primary DESC, id ASC`
  ).all(project.series_id);
  return rows.map((row) => ({
    ...row,
    locked: !!row.locked,
    is_primary: !!row.is_primary,
    assets: getDb().prepare('SELECT * FROM character_assets WHERE character_id = ? ORDER BY created_at DESC, id DESC').all(row.id),
  }));
}

function insertCharacter(seriesId, projectId, item) {
  const c = characterFromScriptItem(item);
  const res = getDb().prepare(
    `INSERT INTO characters
     (series_id, project_id, name, alias, role, age, gender, face, hair, clothing, signature_props, personality, voice,
      negative_constraints, prompt_anchor, locked, is_primary, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    seriesId, projectId, c.name, c.alias, c.role, c.age, c.gender, c.face, c.hair, c.clothing,
    c.signature_props, c.personality, c.voice, c.negative_constraints, c.prompt_anchor,
    c.locked ? 1 : 0, c.is_primary ? 1 : 0, now(), now()
  );
  return getDb().prepare('SELECT * FROM characters WHERE id = ?').get(res.lastInsertRowid);
}

function extractCharacters(projectId, { force = false, script = null } = {}) {
  const project = ensureSeriesForProject(projectId);
  if (!project) return [];
  const existing = listCharacters(projectId);
  if (existing.length && !force) {
    bindStoryboardsToPrimary(projectId, existing[0]?.id);
    return existing;
  }
  if (force && existing.length) {
    getDb().prepare('UPDATE characters SET deleted_at = ? WHERE series_id = ?').run(now(), project.series_id);
  }
  const sourceProject = script ? { ...project, script_content: JSON.stringify(script), visual_anchor: script.visual_anchor || project.visual_anchor } : project;
  const chars = extractScriptCharacters(sourceProject);
  chars.forEach((c, index) => insertCharacter(project.series_id, projectId, { ...c, is_primary: index === 0 ? 1 : c.is_primary }));
  const list = listCharacters(projectId);
  bindStoryboardsToPrimary(projectId, list[0]?.id);
  getDb().prepare("UPDATE projects SET continuity_status = ? WHERE id = ?").run('characters_ready', projectId);
  return list;
}

function bindStoryboardsToPrimary(projectId, primaryCharacterId) {
  if (!primaryCharacterId) return;
  const db = getDb();
  const storyboards = db.prepare('SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC').all(projectId);
  const existsStmt = db.prepare('SELECT id FROM storyboard_characters WHERE storyboard_id = ? AND character_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO storyboard_characters
     (storyboard_id, character_id, scene_role, action, emotion, wardrobe, location, state_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const sb of storyboards) {
    if (!existsStmt.get(sb.id, primaryCharacterId)) {
      insertStmt.run(
        sb.id, primaryCharacterId, '主角',
        cleanText(sb.description || '', 500), '', '', '', cleanText(sb.dialog || '', 500), now()
      );
    }
    const current = safeJsonParse(sb.characters_in_scene, null);
    if (!Array.isArray(current) || current.length === 0) {
      db.prepare('UPDATE storyboards SET characters_in_scene = ? WHERE id = ?')
        .run(JSON.stringify([{ character_id: primaryCharacterId, role: '主角', action: cleanText(sb.description || '', 500) }]), sb.id);
    }
  }
}

function saveStoryboardBindings(projectId, storyboards = []) {
  const chars = extractCharacters(projectId);
  const byName = new Map(chars.map((c) => [String(c.name).trim(), c]));
  const primary = chars[0];
  const saved = getDb().prepare('SELECT * FROM storyboards WHERE project_id = ? ORDER BY sort_order ASC').all(projectId);
  for (let i = 0; i < saved.length; i++) {
    const src = storyboards[i] || {};
    let sceneChars = Array.isArray(src.characters_in_scene) ? src.characters_in_scene : [];
    if (!sceneChars.length && primary) {
      sceneChars = [{ character_id: primary.id, role: '主角', action: src.description || saved[i].description || '' }];
    }
    const normalized = sceneChars.map((item) => {
      const found = item.character_id ? chars.find((c) => Number(c.id) === Number(item.character_id)) : byName.get(String(item.name || item.character_name || '').trim());
      return {
        character_id: found?.id || primary?.id || null,
        name: found?.name || item.name || item.character_name || primary?.name || '',
        role: item.role || item.scene_role || found?.role || '角色',
        action: item.action || src.description || saved[i].description || '',
        emotion: item.emotion || '',
        wardrobe: item.wardrobe || item.clothing || '',
        location: item.location || '',
        state_note: item.state_note || item.note || '',
      };
    }).filter((x) => x.character_id);
    getDb().prepare(
      'UPDATE storyboards SET characters_in_scene = ?, continuity_notes = ?, scene_state_before = ?, scene_state_after = ? WHERE id = ?'
    ).run(
      JSON.stringify(normalized),
      cleanText(src.continuity_notes || '', 1000),
      cleanText(src.scene_state_before || '', 1000),
      cleanText(src.scene_state_after || '', 1000),
      saved[i].id
    );
  }
  bindStoryboardsToPrimary(projectId, primary?.id);
}

function characterAnchor(character) {
  if (!character) return '';
  const parts = [
    `Character ${character.id} "${character.name}" must stay consistent`,
    character.prompt_anchor,
    character.gender && `gender: ${character.gender}`,
    character.age && `age: ${character.age}`,
    character.face && `face: ${character.face}`,
    character.hair && `hair: ${character.hair}`,
    character.clothing && `fixed outfit: ${character.clothing}`,
    character.signature_props && `signature props: ${character.signature_props}`,
    character.personality && `personality: ${character.personality}`,
    character.negative_constraints && `negative constraints: ${character.negative_constraints}`,
  ].filter(Boolean);
  return parts.join(', ');
}

function storyboardCharacterIds(storyboard) {
  const items = safeJsonParse(storyboard?.characters_in_scene, []);
  return Array.isArray(items) ? items.map((x) => Number(x.character_id)).filter(Boolean) : [];
}

function prepareImageContext({ projectId, storyboardId, characterIds = null, referenceImageIds = null, consistencyMode = 'standard', referenceStrength = 0.75 } = {}) {
  const project = ensureSeriesForProject(projectId);
  if (!project) return { promptAnchor: '', referenceImages: [], warnings: ['项目不存在'] };
  const bible = getStoryBible(projectId);
  const storyboard = storyboardId ? getDb().prepare('SELECT * FROM storyboards WHERE id = ?').get(storyboardId) : null;
  let ids = Array.isArray(characterIds) && characterIds.length ? characterIds.map(Number) : storyboardCharacterIds(storyboard);
  const allChars = listCharacters(projectId);
  if (!ids.length && allChars[0]) ids = [Number(allChars[0].id)];
  const chars = allChars.filter((c) => ids.includes(Number(c.id)));
  const references = chars.flatMap((c) => c.assets || []);
  const selectedRefs = Array.isArray(referenceImageIds) && referenceImageIds.length
    ? references.filter((a) => referenceImageIds.map(Number).includes(Number(a.id)) || referenceImageIds.map(Number).includes(Number(a.image_id)))
    : references;
  const warnings = [];
  const primary = chars.find((c) => c.is_primary) || chars[0];
  if (!chars.length) warnings.push('当前分镜还没有绑定角色，已退回项目视觉锚点');
  if (consistencyMode === 'strict') {
    if (!primary || !primary.locked) {
      const err = new Error('严格人物一致性需要先在角色库锁定主角');
      err.code = 'CONTINUITY_CHARACTER_UNLOCKED';
      err.advice = ['进入脚本页「故事设定」确认主角设定', '为主角添加或选择一张参考图', '点击锁定角色后重新生成画面'];
      throw err;
    }
    if (!selectedRefs.length) {
      const err = new Error('严格人物一致性需要至少一张角色参考图');
      err.code = 'CONTINUITY_REFERENCE_MISSING';
      err.advice = ['在图片页选一张稳定的人物图作为参考', '或在角色库上传/绑定定妆图', '暂时切换为标准一致性模式继续生成'];
      throw err;
    }
  }
  const bibleAnchor = [
    bible?.style_anchor,
    bible?.worldview && `Series worldview: ${bible.worldview}`,
    bible?.locked_facts && `Do not violate locked facts: ${bible.locked_facts}`,
    bible?.scene_rules && `Continuity rules: ${bible.scene_rules}`,
  ].filter(Boolean).join(', ');
  const refHint = selectedRefs.length
    ? `Use the same identity as reference images (${selectedRefs.map((a) => a.file_url || a.file_path).filter(Boolean).join(', ')}), reference strength ${referenceStrength}`
    : '';
  const promptAnchor = [bibleAnchor, ...chars.map(characterAnchor), refHint].filter(Boolean).join(', ');
  if (!selectedRefs.length) warnings.push('当前模型将使用文字锚点和 seed 维持一致性，参考图链路暂未命中');
  return {
    mode: consistencyMode,
    promptAnchor,
    referenceImages: selectedRefs,
    characters: chars,
    warnings,
  };
}

function evaluateStoryboard(projectId, storyboardId, imageId = null) {
  const project = ensureSeriesForProject(projectId);
  if (!project) return null;
  const storyboard = storyboardId ? getDb().prepare('SELECT * FROM storyboards WHERE id = ?').get(storyboardId) : null;
  const chars = listCharacters(projectId);
  const ids = storyboardCharacterIds(storyboard);
  const bound = chars.filter((c) => ids.includes(Number(c.id)));
  const issues = [];
  const suggestions = [];
  let score = 100;
  if (!getStoryBible(projectId)?.worldview) { score -= 15; issues.push('缺少故事圣经世界观'); suggestions.push('补充故事圣经，写清世界观和禁改事实'); }
  if (!bound.length) { score -= 25; issues.push('分镜未绑定角色'); suggestions.push('在脚本页提取角色并绑定分镜角色'); }
  for (const c of bound) {
    if (!c.locked) { score -= 12; issues.push(`角色「${c.name}」未锁定`); suggestions.push(`确认「${c.name}」外貌设定后点击锁定`); }
    if (!c.assets?.length) { score -= 10; issues.push(`角色「${c.name}」缺少参考图`); suggestions.push(`为「${c.name}」添加一张稳定定妆图`); }
  }
  score = Math.max(0, Math.min(100, score));
  const status = score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'risk';
  const res = getDb().prepare(
    'INSERT INTO continuity_checks (project_id, storyboard_id, image_id, score, status, issues, suggestions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(projectId, storyboardId || null, imageId || null, score, status, JSON.stringify(issues), JSON.stringify(suggestions), now());
  return {
    id: res.lastInsertRowid,
    project_id: Number(projectId),
    storyboard_id: storyboardId ? Number(storyboardId) : null,
    image_id: imageId ? Number(imageId) : null,
    score,
    status,
    issues,
    suggestions,
  };
}

function buildScriptContext(projectId) {
  const project = ensureSeriesForProject(projectId);
  if (!project) return '';
  const bible = getStoryBible(projectId);
  const chars = listCharacters(projectId);
  const lines = [];
  lines.push('【系列连续性要求】');
  if (project.episode_index) lines.push(`当前为第 ${project.episode_index} 集，必须承接同一系列设定。`);
  if (bible?.worldview) lines.push(`世界观：${bible.worldview}`);
  if (bible?.mainline) lines.push(`主线：${bible.mainline}`);
  if (bible?.previous_summary) lines.push(`上一集/已有内容摘要：${bible.previous_summary}`);
  if (bible?.open_threads) lines.push(`未解决伏笔：${bible.open_threads}`);
  if (bible?.locked_facts) lines.push(`禁止改写事实：${bible.locked_facts}`);
  if (bible?.relationships) lines.push(`人物关系：${bible.relationships}`);
  if (chars.length) {
    lines.push('角色库：');
    chars.forEach((c) => lines.push(`- 角色ID ${c.id}：${c.name}，${characterAnchor(c)}`));
  }
  lines.push('生成 storyboards 时，每个分镜必须返回 characters_in_scene，引用已有角色 name 或 character_id，只描述本镜动作/情绪/位置，不要重写固定外貌。');
  return lines.filter(Boolean).join('\n');
}

function continueProject(parentProjectId, payload = {}) {
  const parent = ensureSeriesForProject(parentProjectId);
  if (!parent) return null;
  extractCharacters(parentProjectId);
  const mode = cleanText(payload.continuation_mode || payload.mode || 'continue-ending', 80);
  const extraTheme = cleanText(payload.theme || payload.prompt || '', 1000);
  const parentBible = getStoryBible(parentProjectId);
  const episodeIndex = inferEpisodeIndex(parent.series_id);
  const titleSuffix = mode === 'side-story' ? '支线' : mode === 'new-arc' ? '新篇章' : '续集';
  const name = cleanText(payload.name || `${parent.name || '项目'} · ${titleSuffix}${String(episodeIndex).padStart(2, '0')}`, 200);
  const continuationTheme = [
    `续写「${parent.name}」第 ${episodeIndex} 集。`,
    parent.ending_summary || parentBible?.previous_summary ? `承接上一集：${parent.ending_summary || parentBible.previous_summary}` : '',
    parentBible?.open_threads ? `延续伏笔：${parentBible.open_threads}` : '',
    extraTheme ? `本集新增方向：${extraTheme}` : '',
    '必须保持角色外貌、关系、世界观和禁改事实连续。',
  ].filter(Boolean).join('\n');
  const res = getDb().prepare(
    `INSERT INTO projects
     (name, theme, style, duration_min, duration_max, status, series_id, episode_index, parent_project_id, continuation_mode, visual_anchor, image_seed, continuity_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name, continuationTheme, parent.style || '写实', parent.duration_min || 60, parent.duration_max || 180,
    'draft', parent.series_id, episodeIndex, parentProjectId, mode,
    parent.visual_anchor || parentBible?.style_anchor || '', parent.image_seed || Math.floor(Math.random() * 2147483647),
    'continued'
  );
  updateStoryBible(parentProjectId, {
    previous_summary: cleanText(parent.ending_summary || parentBible?.previous_summary || parent.theme || '', 1500),
  });
  return getProject(res.lastInsertRowid);
}

function lockCharacter(characterId, locked = true) {
  const row = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!row) return null;
  getDb().prepare('UPDATE characters SET locked = ?, updated_at = ? WHERE id = ?').run(locked ? 1 : 0, now(), characterId);
  return getDb().prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
}

function updateCharacter(characterId, payload = {}) {
  const row = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!row) return null;
  const fields = [
    'name', 'alias', 'role', 'age', 'gender', 'face', 'hair', 'clothing',
    'signature_props', 'personality', 'voice', 'negative_constraints', 'prompt_anchor', 'is_primary',
  ];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (payload[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(field === 'is_primary' ? (payload[field] ? 1 : 0) : cleanText(payload[field], 2000));
    }
  }
  if (updates.length) {
    updates.push('updated_at = ?');
    values.push(now(), characterId);
    getDb().prepare(`UPDATE characters SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  return getDb().prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
}

function addReferenceImage(characterId, payload = {}) {
  const c = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!c) return null;
  let image = null;
  if (payload.image_id) image = getDb().prepare('SELECT * FROM images WHERE id = ?').get(payload.image_id);
  const fileUrl = cleanText(payload.file_url || image?.file_url || image?.file_path || '', 1000);
  const filePath = cleanText(payload.file_path || image?.file_path || fileUrl, 1000);
  if (!fileUrl && !filePath) throw new Error('缺少参考图文件');
  const res = getDb().prepare(
    'INSERT INTO character_assets (character_id, project_id, image_id, file_url, file_path, kind, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(characterId, payload.project_id || c.project_id || null, payload.image_id || null, fileUrl, filePath, cleanText(payload.kind || 'reference', 80), cleanText(payload.label || '角色参考图', 200), now());
  return getDb().prepare('SELECT * FROM character_assets WHERE id = ?').get(res.lastInsertRowid);
}

module.exports = {
  ensureSeriesForProject,
  getStoryBible,
  updateStoryBible,
  listCharacters,
  extractCharacters,
  saveStoryboardBindings,
  prepareImageContext,
  evaluateStoryboard,
  buildScriptContext,
  continueProject,
  lockCharacter,
  updateCharacter,
  addReferenceImage,
  characterAnchor,
};
