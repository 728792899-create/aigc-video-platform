/**
 * Edge TTS 语音合成服务
 * 使用 node-edge-tts 进行语音合成
 * 注意：Edge TTS WebSocket 不支持并发请求，需要串行执行
 */

const { EdgeTTS } = require('node-edge-tts');
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
const config = require('./config');
const edgeTtsPro = require('./edgeTtsPro');
const { resolveFfmpegPath } = require('../utils/ffmpeg');

const UPLOAD_DIR = path.resolve(String(config.get('uploadDir')), 'audio');

interface WordTimestamp {
  part: string
  start: number
  end: number
}
export interface TtsResult {
  file_path: string
  file_url: string
  voice: string
  size: number
  words: WordTimestamp[]
  engine: string
  speakers?: Record<string, string>
}
interface TtsOptions {
  emotion?: string
  volume?: number
  saveTimestamps?: boolean
}
interface DialogSegment { speaker: string | null; text: string }
interface DialogTtsOptions {
  text?: string
  voiceMap?: Record<string, string>
  defaultVoice?: string
  speed?: number
  pitch?: number
  storyboardId?: string | number
  emotion?: string
  volume?: number
}
type JsonObject = Record<string, unknown>
function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 可用的中文音色（已校验：这些 ShortName 在 Edge 免费端点真实可用，2026-05 voices/list 核实）
export const VOICES: Record<string, string> = {
  'xiaoxiao': 'zh-CN-XiaoxiaoNeural', // 温柔女声
  'xiaoyi': 'zh-CN-XiaoyiNeural',     // 活泼女声
  'yunyang': 'zh-CN-YunyangNeural',   // 沉稳男声
  'yunxi': 'zh-CN-YunxiNeural',       // 阳光男声
  'yunjian': 'zh-CN-YunjianNeural',   // 浑厚男声
  'yunxia': 'zh-CN-YunxiaNeural',     // 青年男声
  // 向后兼容：已停用音色名 → 映射到可用音色，避免旧分镜合成挂起/报错
  'xiaomo': 'zh-CN-XiaoyiNeural',
  'xiaohan': 'zh-CN-XiaoxiaoNeural',
  'yunfeng': 'zh-CN-YunjianNeural',
};

/**
 * 剥离送去朗读的「说话人标记」，使配音不读出旁白/角色名等元信息。
 * 只清洗朗读文本，不改数据库原文（字幕仍可保留）。覆盖四类格式：
 *   1) 句首括号：（旁白）xxx  (小精灵) xxx  【画外音】xxx  [OS] xxx
 *   2) 句首冒号：旁白：xxx   小明: xxx     （向后兼容原逻辑）
 *   3) 句首独立词：旁白 / 画外音 / 独白 / 内心独白 / OS / V.O.
 * 「句首」= 文本开头，或紧跟换行 / 句末标点（。！？；.!?;）之后。
 */
export function stripSpeakerTags(text: unknown): string {
  let t = String(text || '');
  // 1) 句首的括号/方括号说话人标记（全角+半角），保留前导的分隔符
  t = t.replace(/(^|[\n。！？；.!?;])\s*[（(【\[][^）)】\]\n]{1,12}[）)】\]][:：]?\s*/g, '$1');
  // 2) 行首「说话人：」冒号格式（向后兼容）
  t = t.replace(/^[^：:\n]{1,8}\s*[：:]\s*/gm, '');
  // 3) 行首独立说话人词（无括号无冒号）
  t = t.replace(/^\s*(旁白|画外音|独白|内心独白|内心|OS|V\.?O\.?)\s+/gim, '');
  // 收尾：合并多余空白
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// 并发互斥锁（链式 Promise）
let ttsLock: Promise<void> = Promise.resolve();

export async function generateTTS(
  text: unknown,
  voice = 'xiaoxiao',
  speed = 1.0,
  pitch = 0,
  storyboardId?: string | number,
  opts: TtsOptions = {},
): Promise<TtsResult> {
  const { emotion = 'general', volume = 1.0, saveTimestamps = true } = opts;
  // 排队等待前一个 TTS 完成
  const myTurn = ttsLock;
  let release: () => void = () => {};
  ttsLock = new Promise<void>((resolve) => { release = resolve; });
  await myTurn;

  try {
    const voiceName = VOICES[voice] || VOICES.xiaoxiao || 'zh-CN-XiaoxiaoNeural';
    // 去掉说话人标记（旁白/角色名/括号标记等是元信息，不应被朗读，也保证音频与字幕词级对齐）
    const speakText = stripSpeakerTags(text);
    const filename = `tts_${storyboardId || uuidv4()}_${Date.now()}.mp3`;
    const outputPath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    // 情感预设：把情感映射成 语速/音调/音量 的相对偏移（免费 Edge 不支持 express-as）
    const preset = edgeTtsPro.EMOTION_PRESETS[emotion] || edgeTtsPro.EMOTION_PRESETS.general;
    const ratePct = Math.round((speed - 1) * 100 + preset.rate * 100);
    const pitchHz = Math.round(Number(pitch) + preset.pitch);
    const volFinal = Math.max(0, Math.min(2, Number(volume) * preset.volume));
    const rateStr = ratePct >= 0 ? `+${ratePct}%` : `${ratePct}%`;
    const pitchStr = pitchHz >= 0 ? `+${pitchHz}Hz` : `${pitchHz}Hz`;
    const volumeStr = edgeTtsPro.volumeStrOf(volFinal);

    // 优先走增强引擎：拿到音频 + 词级时间戳；带重试抗 Edge 偶发空响应/抖动，任何失败降级回 node-edge-tts 库
    const ssml = edgeTtsPro.buildSsml({ voice: voiceName, text: speakText, rate: rateStr, pitch: pitchStr, volume: volumeStr });
    let proErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { audioBuffer, words: rawWords } = await edgeTtsPro.synthViaWs(ssml, { timeout: 35000 });
        const words: WordTimestamp[] = Array.isArray(rawWords)
          ? rawWords.map((word: unknown) => {
            const item = asRecord(word);
            return { part: String(item.part || ''), start: Number(item.start) || 0, end: Number(item.end) || 0 };
          })
          : [];
        if (!audioBuffer || audioBuffer.length < 1024) throw new Error(`增强引擎输出过小（${audioBuffer ? audioBuffer.length : 0} bytes）`);
        fs.writeFileSync(outputPath, audioBuffer);
        if (saveTimestamps && words && words.length) {
          try { fs.writeFileSync(outputPath + '.words.json', JSON.stringify(words)); } catch {}
        }
        if (attempt > 1) console.log(`[tts] 增强引擎第 ${attempt} 次重试成功`);
        const fileUrl = `/uploads/audio/${filename}`;
        return { file_path: outputPath, file_url: fileUrl, voice: voiceName, size: audioBuffer.length, words: words || [], engine: 'pro' };
      } catch (e) {
        proErr = e;
        console.warn(`[tts] 增强引擎第 ${attempt}/3 次失败：${errorMessage(e)}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 800));
      }
    }
    {
      console.warn('[tts] 增强引擎失败，降级回 node-edge-tts 库:', errorMessage(proErr));
    }

    // 降级：原 node-edge-tts 库（无词级时间戳/无 volume，但保证可用）
    const tts = new EdgeTTS({
      voice: voiceName,
      rate: rateStr,
      pitch: pitchStr,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      timeout: 30000,
    });
    const TTS_HARD_TIMEOUT = 35000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`TTS 合成超时（>${TTS_HARD_TIMEOUT / 1000}s），已强制中断`)), TTS_HARD_TIMEOUT);
    });
    try {
      await Promise.race([tts.ttsPromise(speakText, outputPath), timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
    const stat = fs.statSync(outputPath);
    if (stat.size < 1024) throw new Error(`TTS 输出文件过小（${stat.size} bytes），可能合成失败`);
    const fileUrl = `/uploads/audio/${filename}`;
    return { file_path: outputPath, file_url: fileUrl, voice: voiceName, size: stat.size, words: [], engine: 'lib' };
  } finally {
    release();
  }
}

/**
 * 解析对话脚本为「说话人 → 台词」片段（功能⑤）。
 * 支持格式：「小明：你好」「A: 再见」「旁白：……」每行一句。
 * 无显式说话人的行归到上一个说话人（连续台词）；完全无说话人则返回单段。
 * @returns {Array<{speaker:string|null, text:string}>}
 */
export function parseDialog(text: unknown): DialogSegment[] {
  const lines = String(text || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
  const segs: DialogSegment[] = [];
  const reColon = /^([^：:（(【\[]{1,8})\s*[：:]\s*(.+)$/;       // 小明：你好
  const reBracket = /^[（(【\[]([^）)】\]]{1,12})[）)】\]][:：]?\s*(.*)$/; // （小精灵）谢谢你
  for (const line of lines) {
    const mb = line.match(reBracket);
    const mc = line.match(reColon);
    if (mb) {
      const body = (mb[2] || '').trim();
      const speaker = mb[1]?.trim() || null;
      if (body && speaker) segs.push({ speaker, text: body });
    } else if (mc) {
      const speaker = mc[1]?.trim() || null;
      const body = mc[2]?.trim() || '';
      if (speaker && body) segs.push({ speaker, text: body });
    } else if (segs.length) {
      const previous = segs.at(-1);
      if (previous) previous.text += line; // 续行拼到上一句
    } else {
      segs.push({ speaker: null, text: line });
    }
  }
  return segs;
}

/**
 * 多音色对话合成（功能⑤）。
 * 解析说话人 → 每个说话人分配不同音色 → 逐段合成 → ffmpeg concat 拼接 → 合并词级时间戳（带偏移）。
 * 若只有 0/1 个说话人，直接退化为 generateTTS（零额外开销）。
 * @param {object} o { text, voiceMap?, defaultVoice, speed, pitch, storyboardId, emotion, volume }
 */
export async function generateDialogTTS({ text = '', voiceMap = {}, defaultVoice = 'xiaoxiao', speed = 1.0, pitch = 0, storyboardId, emotion = 'general', volume = 1.0 }: DialogTtsOptions = {}): Promise<TtsResult> {
  const segs = parseDialog(text);
  const speakers = [...new Set(segs.map((segment) => segment.speaker).filter((speaker): speaker is string => Boolean(speaker)))];
  // 修复问题二（关键）：底层合成必须走 ttsProvider.synthesize 按当前 provider 路由，
  // 否则本地 generateTTS 写死 Edge（VOICES[voice] 找不到火山音色名→回退 xiaoxiao），
  // 导致选了火山音色池也全部降级成 Edge，多音色对话沦为「不同 Edge 音色」甚至单音色。
  const cfg = require('./config');
  const registry = require('./providers');
  const ttsProvider = require('./ttsProvider');
  const route = asRecord(cfg.get('stageModels.voice'));
  const prov = typeof route.provider === 'string' ? route.provider : 'edge';
  // 统一的逐段合成器：火山等云端 provider 走 synthesize 路由，Edge 走本地 generateTTS。
  const synthSeg = async (segText: string, segVoice: string, segId: string | number | undefined): Promise<TtsResult> => {
    if (prov && prov !== 'edge') {
      const result: unknown = await ttsProvider.synthesize({
        text: segText, voice: segVoice, speed, pitch, storyboardId: segId,
        provider: prov, model: segVoice, emotion, volume,
      });
      const item = asRecord(result);
      const rawWords = Array.isArray(item.words) ? item.words : [];
      return {
        file_path: String(item.file_path || ''),
        file_url: String(item.file_url || ''),
        voice: String(item.voice || segVoice),
        size: Number(item.size) || 0,
        words: rawWords.map((word) => {
          const value = asRecord(word);
          return { part: String(value.part || ''), start: Number(value.start) || 0, end: Number(value.end) || 0 };
        }),
        engine: String(item.engine || prov),
      };
    }
    return generateTTS(segText, segVoice, speed, pitch, segId, { emotion, volume, saveTimestamps: true });
  };

  // 0 或 1 个说话人：无需多音色，走普通合成（内部已 stripSpeakerTags）
  if (speakers.length <= 1) {
    return synthSeg(text, defaultVoice, storyboardId);
  }

  // 给说话人轮转分配音色（用户可通过 voiceMap 指定）
  let pool: string[];
  if (prov === 'volcano_tts_v3') {
    // 火山大模型音色池（10 个 _moon_bigtts 音色）
    pool = [
      'zh_female_wanqudashu_moon_bigtts', 'zh_female_daimengchuanmei_moon_bigtts',
      'zh_male_guozhoudege_moon_bigtts', 'zh_male_beijingxiaoye_moon_bigtts',
      'zh_male_shaonianzixin_moon_bigtts', 'zh_female_meilinvyou_moon_bigtts',
    ];
  } else {
    // Edge 音色池（默认）
    pool = ['xiaoxiao', 'yunyang', 'xiaoyi', 'yunxi', 'yunjian', 'yunxia'];
  }
  const assign: Record<string, string> = {};
  speakers.forEach((speaker, index) => {
    assign[speaker] = voiceMap[speaker] || pool[index % pool.length] || defaultVoice;
  });

  const FFMPEG = resolveFfmpegPath(config.get('ffmpegPath')).path;
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  // 逐段合成（generateTTS 内部已串行锁，安全）
  const parts: string[] = [];
  const allWords: WordTimestamp[] = [];
  let offsetMs = 0;
  for (const seg of segs) {
    const v = seg.speaker ? (assign[seg.speaker] || defaultVoice) : defaultVoice;
    const r = await synthSeg(seg.text, v, `${storyboardId || 'dlg'}_${parts.length}`);
    parts.push(r.file_path);
    r.words.forEach((word) => allWords.push({ part: word.part, start: word.start + offsetMs, end: word.end + offsetMs }));
    // 估算该段时长用于偏移（用最后一个词的 end，缺失则按文件大小粗估）
    const segEnd = r.words.at(-1)?.end || 0;
    offsetMs += segEnd || 1500;
  }

  // ffmpeg concat 拼接为一个 mp3
  const listFile = path.join(UPLOAD_DIR, `dlg_${storyboardId || uuidv4()}_${Date.now()}.txt`);
  fs.writeFileSync(listFile, parts.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf-8');
  const filename = `tts_${storyboardId || uuidv4()}_${Date.now()}_dialog.mp3`;
  const outputPath = path.join(UPLOAD_DIR, filename);
  await new Promise<void>((resolve, reject) => {
    execFile(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath], (err: Error | null) => {
      try { fs.unlinkSync(listFile); } catch {}
      err ? reject(err) : resolve();
    });
  });
  // 清理分段临时文件
  parts.forEach((part) => { try { fs.unlinkSync(part); fs.existsSync(part + '.words.json') && fs.unlinkSync(part + '.words.json'); } catch {} });

  const stat = fs.statSync(outputPath);
  if (allWords.length) { try { fs.writeFileSync(outputPath + '.words.json', JSON.stringify(allWords)); } catch {} }
  return { file_path: outputPath, file_url: `/uploads/audio/${filename}`, voice: 'multi', size: stat.size, words: allWords, engine: 'pro', speakers: assign };
}
