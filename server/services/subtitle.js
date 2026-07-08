/**
 * 字幕服务
 * - 根据分镜 dialog + audio 时长生成 SRT 文件
 * - 支持自定义字幕样式（字体/字号/颜色/位置）
 * - 为 FFmpeg 合成提供 subtitles filter 参数
 */

const path = require('path');
const fs = require('fs');
const config = require('./config');
const assetNaming = require('./assetNaming');
const timelineService = require('./timeline');

// 复用 TTS 的说话人标记剥离逻辑：字幕显示也不应出现 （旁白）/（小精灵）/【画外音】 等说话人提示
let stripSpeakerTags = (t) => String(t || '');
try { stripSpeakerTags = require('./tts').stripSpeakerTags || stripSpeakerTags; } catch { /* tts 未就绪时降级为原文 */ }

const UPLOAD_DIR = path.resolve(config.get('uploadDir'), 'subtitles');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MOVIE_SUBTITLE = {
  fontSize: 24,
  marginV: 52,
  outline: 1.4,
  shadow: 0.7,
};

/**
 * 将秒数转为 SRT 时间格式 HH:MM:SS,mmm
 */
function secondsToSrt(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * 将秒数转为 WebVTT 时间格式 HH:MM:SS.mmm
 */
function secondsToVtt(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * 智能断句分行（功能②）：按标点切分，超长句再按最大字数软换行。
 * @param {string} text
 * @param {number} maxLen 单行最大字数（中文按字计）
 * @returns {string[]} 分好的短句数组
 */
function splitIntoSegments(text, maxLen = 15) {
  if (!text) return [];
  // 去掉行首"说话人："前缀（字幕只显示台词内容，不显示角色名）
  const noSpeaker = String(text).replace(/^[^：:\n]{1,8}\s*[：:]\s*/gm, '');
  // 先按强标点切（，。！？；、,!?; + 换行），保留可读语义单元
  const rough = noSpeaker.replace(/\s+/g, ' ').trim()
    .split(/(?<=[，。！？；、,.!?;\n])/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let seg of rough) {
    // 去掉行尾标点（字幕不显示句读更干净），但保留问号/感叹号语气
    const clean = seg.replace(/[，。；、,;]\s*$/, '');
    if (clean.length <= maxLen) { if (clean) out.push(clean); continue; }
    // 仍超长：按 maxLen 硬切
    for (let i = 0; i < clean.length; i += maxLen) out.push(clean.slice(i, i + maxLen));
  }
  return out;
}

/**
 * 为单个分镜生成字幕条目
 * @param {string} text 字幕文本
 * @param {number} startTime 开始时间（秒）
 * @param {number} duration 持续时间（秒）
 * @param {number} index 序号（从 1 开始）
 */
function buildSrtEntry(text, startTime, duration, index) {
  if (!text || !text.trim()) return '';
  const end = startTime + duration;
  return `${index}\n${secondsToSrt(startTime)} --> ${secondsToSrt(end)}\n${text.trim()}\n`;
}

/**
 * 把一个分镜的文本切成短句，并为每个短句分配时间区间。
 * 优先用真实词级时间戳（words）卡点（功能①）；无时间戳时按字数比例均分（功能②）。
 * @returns {Array<{text,start,end}>} 时间为绝对秒
 */
function segmentsWithTiming(sb, sceneStart, sceneDuration, maxLen = 15, timingScale = 1) {
  const text = stripSpeakerTags(sb.subtitle_text || sb.dialog || '');
  const segs = splitIntoSegments(text, maxLen);
  if (!segs.length) return [];
  const scale = Number.isFinite(Number(timingScale)) && Number(timingScale) > 0 ? Number(timingScale) : 1;

  // 解析词级时间戳
  let words = null;
  if (sb.audio_words) {
    try { words = typeof sb.audio_words === 'string' ? JSON.parse(sb.audio_words) : sb.audio_words; } catch { words = null; }
  }

  if (words && words.length) {
    // 词级时间戳卡点：把 words 顺序消费到各短句（按短句去标点后的字符长度分配词数）
    const result = [];
    let wi = 0;
    for (const seg of segs) {
      const segChars = seg.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length || seg.length;
      let acc = 0; const startWi = wi;
      while (wi < words.length && acc < segChars) { acc += (words[wi].part || '').length; wi++; }
      const slice = words.slice(startWi, Math.max(wi, startWi + 1));
      if (slice.length) {
        result.push({
          text: seg,
          start: sceneStart + (slice[0].start / 1000) * scale,
          end: sceneStart + (slice[slice.length - 1].end / 1000) * scale,
        });
      }
    }
    if (result.length) return result;
  }

  // 兜底：按短句字数比例在分镜时长内均分（功能②）
  const totalChars = segs.reduce((a, s) => a + s.length, 0) || 1;
  let t = sceneStart;
  return segs.map(seg => {
    const d = (seg.length / totalChars) * sceneDuration;
    const entry = { text: seg, start: t, end: t + d };
    t += d;
    return entry;
  });
}

/**
 * 为整个项目生成 SRT 文件（功能①②：真实词级时间戳卡点 + 智能断句分行）
 * @param {Array} storyboards 分镜列表（按 sort_order 排序）
 * @param {number} projectId
 * @param {object} opts { maxLen }
 */
function generateSrt(storyboards, projectId, opts = {}) {
  const maxLen = opts.maxLen || 15;
  let index = 1;
  const entries = [];
  const timelineMap = timelineService.sceneMap(opts.timeline);

  for (const sb of storyboards) {
    const scene = timelineMap.get(Number(sb.id));
    const currentTime = scene ? scene.start_ms / 1000 : ((opts._cursorMs || 0) / 1000);
    const duration = scene ? scene.duration_ms / 1000 : (sb.duration || 5);
    const timingScale = scene && scene.original_duration_ms
      ? scene.duration_ms / scene.original_duration_ms
      : 1;
    const segs = segmentsWithTiming(sb, currentTime, duration, maxLen, timingScale);
    for (const s of segs) {
      const entry = buildSrtEntry(s.text, s.start, s.end - s.start, index);
      if (entry) { entries.push(entry); index++; }
    }
    opts._cursorMs = scene ? scene.end_ms : ((opts._cursorMs || 0) + Math.round(duration * 1000));
  }

  const srtContent = entries.join('\n');
  const filename = assetNaming.subtitleFilename(projectId, 'srt', '.srt');
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, srtContent, 'utf-8');

  return {
    filePath,
    fileUrl: `/uploads/subtitles/${filename}`,
    content: srtContent,
    totalDuration: opts.timeline ? opts.timeline.total_duration : ((opts._cursorMs || 0) / 1000),
  };
}

/**
 * 为浏览器 <track> 生成 WebVTT 字幕。浏览器不能直接加载 SRT，
 * 因此软字幕导出时同时提供 VTT 兜底播放。
 */
function generateVtt(storyboards, projectId, opts = {}) {
  const maxLen = opts.maxLen || 15;
  const entries = ['WEBVTT', ''];
  const timelineMap = timelineService.sceneMap(opts.timeline);

  for (const sb of storyboards) {
    const scene = timelineMap.get(Number(sb.id));
    const currentTime = scene ? scene.start_ms / 1000 : ((opts._cursorMs || 0) / 1000);
    const duration = scene ? scene.duration_ms / 1000 : (sb.duration || 5);
    const timingScale = scene && scene.original_duration_ms
      ? scene.duration_ms / scene.original_duration_ms
      : 1;
    const segs = segmentsWithTiming(sb, currentTime, duration, maxLen, timingScale);
    for (const seg of segs) {
      const text = String(seg.text || '').trim();
      if (!text) continue;
      entries.push(`${secondsToVtt(seg.start)} --> ${secondsToVtt(seg.end)}`);
      entries.push(text);
      entries.push('');
    }
    opts._cursorMs = scene ? scene.end_ms : ((opts._cursorMs || 0) + Math.round(duration * 1000));
  }

  const content = `${entries.join('\n').trim()}\n`;
  const filename = assetNaming.subtitleFilename(projectId, 'vtt', '.vtt');
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf-8');

  return {
    filePath,
    fileUrl: `/uploads/subtitles/${filename}`,
    content,
    totalDuration: opts.timeline ? opts.timeline.total_duration : ((opts._cursorMs || 0) / 1000),
  };
}

/**
 * 解析字幕样式 JSON → FFmpeg force_style 字符串
 * @param {object} style { fontSize, fontColor, bgColor, position, fontFamily }
 */
function buildForceStyle(style = {}) {
  const fontSize = Number(style.fontSize) || MOVIE_SUBTITLE.fontSize;
  const fontFamily = style.fontFamily || 'Microsoft YaHei';
  const bold = style.bold ? 1 : 0;
  const outlineWidth = Number(style.outline ?? style.outlineWidth) || MOVIE_SUBTITLE.outline;
  const shadow = Number(style.shadow) || MOVIE_SUBTITLE.shadow;

  // ASS 颜色格式：&HBBGGRR（BGR 顺序）
  const hexToAss = (hex) => {
    const clean = hex.replace('#', '');
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return `&H00${b}${g}${r}`;
  };

  const primaryColor = hexToAss(style.fontColor || '#FFFFFF');
  const outlineColor = hexToAss(style.outlineColor || '#000000');

  // 位置映射：bottom=2, top=8, middle=5
  const alignMap = { bottom: 2, top: 8, middle: 5 };
  const alignment = alignMap[style.position] || 2;

  const marginV = Number(style.marginV) || (style.position === 'middle' ? 0 : MOVIE_SUBTITLE.marginV);

  return `FontName=${fontFamily},FontSize=${fontSize},PrimaryColour=${primaryColor},OutlineColour=${outlineColor},Bold=${bold},Alignment=${alignment},MarginV=${marginV},Outline=${outlineWidth},Shadow=${shadow}`;
}

/**
 * 构建 FFmpeg subtitles filter 参数
 * @param {string} srtPath SRT 文件路径
 * @param {object} style 字幕样式
 * @returns {string} FFmpeg filter 字符串
 */
function buildSubtitleFilter(srtPath, style = {}) {
  const forceStyle = buildForceStyle(style);
  // Windows 路径需要转义冒号和反斜杠
  const escapedPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  return `subtitles='${escapedPath}':force_style='${forceStyle}'`;
}

/**
 * 把秒转为 ASS 时间格式 H:MM:SS.cc（厘秒）
 */
function secondsToAss(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * 生成卡拉OK逐词高亮 ASS 字幕（功能⑦）。
 * 基于词级时间戳，用 \k 标签实现逐词点亮。无词级时间戳的分镜降级为整句显示。
 * @param {Array} storyboards 分镜列表
 * @param {number} projectId
 * @param {object} style 字幕样式
 */
function generateKaraokeAss(storyboards, projectId, style = {}) {
  const fontName = style.fontFamily || 'Microsoft YaHei';
  const fontSize = Number(style.fontSize) || MOVIE_SUBTITLE.fontSize;
  const marginV = Number(style.marginV) || MOVIE_SUBTITLE.marginV;
  const outlineWidth = Number(style.outline ?? style.outlineWidth) || MOVIE_SUBTITLE.outline;
  const shadow = Number(style.shadow) || MOVIE_SUBTITLE.shadow;
  const primary = (() => { const c = (style.fontColor || '#FFFFFF').replace('#', ''); return `&H00${c.slice(4,6)}${c.slice(2,4)}${c.slice(0,2)}`; })();
  const highlight = (() => { const c = (style.karaokeColor || '#FFD400').replace('#', ''); return `&H00${c.slice(4,6)}${c.slice(2,4)}${c.slice(0,2)}`; })();
  const alignMap = { bottom: 2, top: 8, middle: 5 };
  const align = alignMap[style.position] || 2;

  const header = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1280', 'PlayResY: 720', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // SecondaryColour = 未唱到的底色；PrimaryColour = 已唱到的高亮色（\k 从 Secondary 渐变到 Primary）
    `Style: Default,${fontName},${fontSize},${highlight},${primary},&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,${outlineWidth},${shadow},${align},20,20,${marginV},1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const lines = [];
  const timelineMap = timelineService.sceneMap(style.timeline);
  let cursorMs = 0;
  for (const sb of storyboards) {
    const scene = timelineMap.get(Number(sb.id));
    const currentTime = scene ? scene.start_ms / 1000 : cursorMs / 1000;
    const duration = scene ? scene.duration_ms / 1000 : (sb.duration || 5);
    const timingScale = scene && scene.original_duration_ms
      ? scene.duration_ms / scene.original_duration_ms
      : 1;
    let words = null;
    if (sb.audio_words) { try { words = typeof sb.audio_words === 'string' ? JSON.parse(sb.audio_words) : sb.audio_words; } catch {} }
    const segs = segmentsWithTiming(sb, currentTime, duration, 15, timingScale);
    if (words && words.length) {
      // 逐短句生成 \k：把落在该短句时间窗内的词组装为 {\kNN}词
      let wi = 0;
      for (const seg of segs) {
        const segWords = [];
        while (wi < words.length && (currentTime + (words[wi].start / 1000) * timingScale) < seg.end - 0.001) {
          segWords.push(words[wi]); wi++;
        }
        if (!segWords.length) { lines.push(`Dialogue: 0,${secondsToAss(seg.start)},${secondsToAss(seg.end)},Default,,0,0,0,,${seg.text}`); continue; }
        let kara = '';
        for (const w of segWords) { const cs = Math.max(1, Math.round(((w.end - w.start) / 10) * timingScale)); kara += `{\\k${cs}}${w.part}`; }
        lines.push(`Dialogue: 0,${secondsToAss(seg.start)},${secondsToAss(seg.end)},Default,,0,0,0,,${kara}`);
      }
    } else {
      for (const seg of segs) lines.push(`Dialogue: 0,${secondsToAss(seg.start)},${secondsToAss(seg.end)},Default,,0,0,0,,${seg.text}`);
    }
    cursorMs = scene ? scene.end_ms : cursorMs + Math.round(duration * 1000);
  }

  const content = header.concat(lines).join('\n');
  const filename = assetNaming.subtitleFilename(projectId, 'karaoke', '.ass');
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return {
    filePath,
    fileUrl: `/uploads/subtitles/${filename}`,
    content,
    totalDuration: style.timeline ? style.timeline.total_duration : cursorMs / 1000,
  };
}

/**
 * 卡拉OK ASS 的 FFmpeg filter（ASS 自带样式，无需 force_style）
 */
function buildAssFilter(assPath) {
  const escapedPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  return `ass='${escapedPath}'`;
}

/**
 * 字幕浮动/消失特效预设（功能：字幕动画特效）。
 * 每个预设返回一个函数：(seg, ctx) => ASS 行内动画标签字符串（拼在 Text 最前面）。
 * 利用 ASS override tags：
 *   \fad(in,out)  淡入淡出（毫秒）
 *   \move(x1,y1,x2,y2[,t1,t2])  位移动画（浮入/滑入）
 *   \t([t1,t2,]style)  时间渐变（缩放、透明度）
 *   \an  对齐锚点（2=底中）；\pos 绝对定位
 * ctx: { w, h, durMs, marginV }  画布宽高、该句持续毫秒、底边距
 */
const SUB_EFFECTS = {
  none: () => '',
  // 淡入淡出：最常用，入出各 350ms
  fade: () => `{\\fad(350,350)}`,
  // 上浮淡入 + 末尾淡出：从底边下方 40px 上浮到位
  floatup: (seg, ctx) => {
    const x = Math.round(ctx.w / 2);
    const yEnd = ctx.h - ctx.marginV;
    const yStart = yEnd + 40;
    const t = Math.min(500, Math.round(ctx.durMs * 0.4));
    return `{\\an5\\fad(300,300)\\move(${x},${yStart},${x},${yEnd},0,${t})}`;
  },
  // 左滑入
  slidein: (seg, ctx) => {
    const xEnd = Math.round(ctx.w / 2);
    const xStart = xEnd - 220;
    const y = ctx.h - ctx.marginV;
    const t = Math.min(500, Math.round(ctx.durMs * 0.4));
    return `{\\an5\\fad(200,250)\\move(${xStart},${y},${xEnd},${y},0,${t})}`;
  },
  // 放大弹出：从 60% 缩放弹到 100% + 淡入淡出
  popzoom: (seg, ctx) => {
    const t = Math.min(400, Math.round(ctx.durMs * 0.35));
    return `{\\fad(150,300)\\fscx60\\fscy60\\t(0,${t},\\fscx100\\fscy100)}`;
  },
  // 打字机式：整句淡入（轻量，靠 \fad）+ 末尾快速淡出消失
  typewriter: () => `{\\fad(120,200)}`,
};

const SUB_EFFECT_KEYS = Object.keys(SUB_EFFECTS);

/**
 * 生成带动画特效的整句 ASS 字幕（功能：字幕浮动消失特效）。
 * 与卡拉OK互斥：用户选了特效就走这里，按句子加 \fad/\move/\t 等出入场动画。
 * @param {Array} storyboards 分镜列表
 * @param {number} projectId
 * @param {string} effect 特效名（见 SUB_EFFECTS）
 * @param {object} style 字幕样式 { fontFamily, fontSize, fontColor, outlineColor, position }
 */
function generateEffectAss(storyboards, projectId, effect = 'fade', style = {}) {
  const fontName = style.fontFamily || 'Microsoft YaHei';
  const fontSize = Number(style.fontSize) || MOVIE_SUBTITLE.fontSize;
  const W = 1280, H = 720;
  const marginV = Number(style.marginV) || MOVIE_SUBTITLE.marginV;
  const outlineWidth = Number(style.outline ?? style.outlineWidth) || MOVIE_SUBTITLE.outline;
  const shadow = Number(style.shadow) || MOVIE_SUBTITLE.shadow;
  const toAss = (hex, fb) => { const c = (hex || fb).replace('#', ''); return `&H00${c.slice(4,6)}${c.slice(2,4)}${c.slice(0,2)}`; };
  const primary = toAss(style.fontColor, '#FFFFFF');
  const outline = toAss(style.outlineColor, '#000000');
  const alignMap = { bottom: 2, top: 8, middle: 5 };
  const align = alignMap[style.position] || 2;
  const fx = SUB_EFFECTS[effect] || SUB_EFFECTS.fade;

  const header = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${primary},${primary},${outline},&H64000000,1,0,0,0,100,100,0,0,1,${outlineWidth},${shadow},${align},20,20,${marginV},1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const lines = [];
  const timelineMap = timelineService.sceneMap(style.timeline);
  let cursorMs = 0;
  for (const sb of storyboards) {
    const scene = timelineMap.get(Number(sb.id));
    const currentTime = scene ? scene.start_ms / 1000 : cursorMs / 1000;
    const duration = scene ? scene.duration_ms / 1000 : (sb.duration || 5);
    const timingScale = scene && scene.original_duration_ms
      ? scene.duration_ms / scene.original_duration_ms
      : 1;
    const segs = segmentsWithTiming(sb, currentTime, duration, 15, timingScale);
    for (const seg of segs) {
      const durMs = Math.max(1, Math.round((seg.end - seg.start) * 1000));
      const tag = fx(seg, { w: W, h: H, durMs, marginV });
      lines.push(`Dialogue: 0,${secondsToAss(seg.start)},${secondsToAss(seg.end)},Default,,0,0,0,,${tag}${seg.text}`);
    }
    cursorMs = scene ? scene.end_ms : cursorMs + Math.round(duration * 1000);
  }

  const content = header.concat(lines).join('\n');
  const filename = assetNaming.subtitleFilename(projectId, 'effect', '.ass');
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return {
    filePath,
    fileUrl: `/uploads/subtitles/${filename}`,
    content,
    totalDuration: style.timeline ? style.timeline.total_duration : cursorMs / 1000,
  };
}

module.exports = { generateSrt, generateVtt, buildForceStyle, buildSubtitleFilter, secondsToSrt, secondsToVtt, splitIntoSegments, segmentsWithTiming, generateKaraokeAss, buildAssFilter, secondsToAss, generateEffectAss, SUB_EFFECT_KEYS };
