/**
 * 统一配音（TTS）适配器（升级方案 v3 第四期）
 *
 * 给 TTS 增加 provider 维度（保留 Edge 默认，可选云端 TTS）。
 * 协议：
 *  - 'edge'        本地 Edge TTS（默认、免费、免 key），复用现有 services/tts.js
 *  - 'openai-tts'  OpenAI 兼容 /v1/audio/speech（model+voice+input → mp3 二进制）
 *
 * 设计铁律（沿用本项目）：
 *  - 降级不中断：云端 TTS 失败 → 自动降级到 Edge，主流程不崩。
 *  - 纯增量：provider 未配 / 选 edge 时，行为与改造前完全一致。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const registry = require('./providers');
const edge = require('./tts'); // 现有 Edge 引擎：generateTTS + VOICES
const { resolveFfmpegPath } = require('../utils/ffmpeg');

const UPLOAD_DIR = path.resolve(config.get('uploadDir'), 'audio');
const HANDLED = new Set(['openai-tts', 'volcano-tts', 'volcano-tts-v3']); // edge 单独走 edge.generateTTS

function canHandle(protocol) {
  return HANDLED.has(protocol);
}

function isDemoMode() {
  return process.env.DEMO_MODE === '1' || process.env.DEMO_MODE === 'true';
}

function generateSilentDemoTts(storyboardId) {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `demo_tts_${storyboardId || uuidv4()}_${Date.now()}.mp3`;
  const outputPath = path.join(UPLOAD_DIR, filename);
  const ffmpeg = resolveFfmpegPath(config.get('ffmpegPath')).path;
  const result = spawnSync(ffmpeg, [
    '-y',
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=mono:sample_rate=24000',
    '-t', '1.2',
    '-q:a', '9',
    '-acodec', 'libmp3lame',
    outputPath,
  ], { stdio: 'ignore', windowsHide: true });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, Buffer.alloc(2048));
  }
  return {
    file_path: outputPath,
    file_url: `/uploads/audio/${filename}`,
    voice: 'demo-silence',
    size: fs.statSync(outputPath).size,
    words: [],
    engine: 'demo',
  };
}

function demoVoiceName(voice) {
  // Last-resort demo fallback when the project's built-in Edge TTS is
  // unavailable. These macOS voices keep switching audible without API keys.
  const preferred = {
    xiaoxiao: 'Tingting',
    xiaoyi: 'Flo (中文（中国大陆）)',
    yunyang: 'Eddy (中文（中国大陆）)',
    yunxi: 'Reed (中文（中国大陆）)',
    yunjian: 'Rocko (中文（中国大陆）)',
    yunxia: 'Grandpa (中文（中国大陆）)',
  };
  return preferred[voice] || 'Tingting';
}

function generateMacosDemoTts(text, voice, speed, storyboardId) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS say is unavailable on this platform');
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const id = storyboardId || uuidv4();
  const filename = `demo_tts_${id}_${Date.now()}.mp3`;
  const outputPath = path.join(UPLOAD_DIR, filename);
  const aiffPath = outputPath.replace(/\.mp3$/i, '.aiff');
  const speakText = edge.stripSpeakerTags ? edge.stripSpeakerTags(text) : String(text || '').trim();
  if (!speakText) throw new Error('demo TTS text is empty');
  const sayRate = String(Math.round(175 * Math.max(0.5, Math.min(2, Number(speed) || 1))));
  const sayResult = spawnSync('/usr/bin/say', [
    '-v', demoVoiceName(voice),
    '-r', sayRate,
    '-o', aiffPath,
    speakText,
  ], { stdio: 'ignore', windowsHide: true });
  if (sayResult.status !== 0 || !fs.existsSync(aiffPath)) {
    throw new Error('macOS say failed');
  }
  const ffmpeg = resolveFfmpegPath(config.get('ffmpegPath')).path;
  const convert = spawnSync(ffmpeg, [
    '-y',
    '-i', aiffPath,
    '-acodec', 'libmp3lame',
    '-ar', '24000',
    '-ac', '1',
    outputPath,
  ], { stdio: 'ignore', windowsHide: true });
  try { fs.unlinkSync(aiffPath); } catch { /* ignore */ }
  if (convert.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error('demo TTS ffmpeg conversion failed');
  }
  const size = fs.statSync(outputPath).size;
  if (size < 1024) throw new Error(`demo TTS output too small (${size} bytes)`);
  return {
    file_path: outputPath,
    file_url: `/uploads/audio/${filename}`,
    voice: demoVoiceName(voice),
    size,
    words: [],
    engine: 'macos-say',
  };
}

async function generateDemoTts(text, voice, speed, pitch, storyboardId, ttsOpts) {
  try {
    return await edge.generateTTS(text, voice, speed, pitch, storyboardId, ttsOpts);
  } catch (edgeErr) {
    try {
      return generateMacosDemoTts(text, voice, speed, storyboardId);
    } catch (macErr) {
      console.warn('[ttsProvider] demo TTS fell back to silent placeholder:', `${edgeErr.message}; ${macErr.message}`);
      return generateSilentDemoTts(storyboardId);
    }
  }
}

// OpenAI TTS 默认音色（云端不认 Edge 的 zh-CN-XiaoxiaoNeural，用通用音色兜底）
const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
function mapOpenAiVoice(voice) {
  return OPENAI_VOICES.includes(voice) ? voice : 'nova';
}

// 调云端 OpenAI 兼容 TTS：POST {baseUrl}/v1/audio/speech，拿 mp3 二进制落盘
async function genOpenAiTts(cred, model, text, voice, storyboardId) {
  const base = (cred.baseUrl || '').replace(/\/+$/, '');
  const url = `${base}/v1/audio/speech`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cred.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'tts-1',
        input: text,
        voice: mapOpenAiVoice(voice),
        response_format: 'mp3',
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`云端 TTS ${resp.status}: ${errText.slice(0, 160)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 1024) throw new Error(`云端 TTS 输出过小（${buf.length} bytes）`);
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `tts_${storyboardId || uuidv4()}_${Date.now()}.mp3`;
  const outputPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(outputPath, buf);
  return {
    file_path: outputPath,
    file_url: `/uploads/audio/${filename}`,
    voice: mapOpenAiVoice(voice),
    size: buf.length,
  };
}

// ===== 火山豆包语音（volcano-tts） =====
// 项目内部情感取值（见 edgeTtsPro.EMOTION_PRESETS）→ 火山 emotion 字段映射。
// 火山支持的情感视音色而定；不认的情感会被忽略而非报错，这里取交集近似。
const VOLCANO_EMOTION = {
  general: 'neutral', cheerful: 'happy', gentle: 'gentle', serious: 'serious',
  newscast: 'neutral', affectionate: 'gentle', lyrical: 'gentle',
  energetic: 'excited', sad: 'sad',
};
// 火山默认音色（用户未选/选了 Edge 音色名时兜底到一个通用女声）
function mapVolcanoVoice(voice, model) {
  // 已是火山音色码（BV/zh_ 开头）直接用；否则用注册表 model 或默认音色
  if (voice && /^(BV|zh_|en_|ICL_)/i.test(voice)) return voice;
  return model || 'BV700_streaming';
}

/**
 * 调火山引擎 HTTP TTS：POST {baseUrl}/api/v1/tts。
 * 鉴权：Header `Authorization: Bearer;<accessToken>`（分号是火山特有写法）。
 * 响应 JSON：{ code:3000, data:<base64 mp3> }。情感由支持的音色生效。
 */
async function genVolcanoTts(cred, model, text, voice, storyboardId, { emotion = 'general', speed = 1.0, volume = 1.0 } = {}) {
  const base = (cred.baseUrl || 'https://openspeech.bytedance.com').replace(/\/+$/, '');
  const url = `${base}/api/v1/tts`;
  const voiceType = mapVolcanoVoice(voice, model);
  const body = {
    app: { appid: cred.appId, token: cred.apiKey, cluster: cred.cluster || 'volcano_tts' },
    user: { uid: 'snoopy-king' },
    audio: {
      voice_type: voiceType,
      encoding: 'mp3',
      speed_ratio: Math.max(0.2, Math.min(3, speed || 1.0)),
      volume_ratio: Math.max(0.1, Math.min(3, volume || 1.0)),
      emotion: VOLCANO_EMOTION[emotion] || 'neutral',
    },
    request: { reqid: uuidv4(), text, operation: 'query' },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer;${cred.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.code !== 3000 || !json.data) {
    const msg = json.message || json.Message || `HTTP ${resp.status}`;
    throw new Error(`火山 TTS 失败（code=${json.code}）: ${String(msg).slice(0, 160)}`);
  }
  const buf = Buffer.from(json.data, 'base64');
  if (buf.length < 1024) throw new Error(`火山 TTS 输出过小（${buf.length} bytes）`);
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `tts_${storyboardId || uuidv4()}_${Date.now()}.mp3`;
  const outputPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(outputPath, buf);
  return {
    file_path: outputPath,
    file_url: `/uploads/audio/${filename}`,
    voice: voiceType,
    size: buf.length,
  };
}

// ===== 火山豆包语音2.0 大模型（volcano-tts-v3） =====
// V3 大模型音色映射：_moon_bigtts 系列直接用；非火山音色码兜底到一个通用女声。
function mapVolcanoVoiceV3(voice, model) {
  if (voice && /_bigtts$/i.test(voice)) return voice;
  if (voice && /^(zh_|en_|multi_)/i.test(voice)) return voice;
  return model || 'zh_female_meilinvyou_moon_bigtts';
}

/**
 * 调火山 V3 大模型 HTTP TTS：POST {baseUrl}/api/v3/tts/unidirectional。
 * 鉴权（完全不同于 V1）：Header
 *   X-Api-App-Id: <appId>
 *   X-Api-Access-Key: <accessToken>
 *   X-Api-Resource-Id: <resourceId, 默认 volc.service_type.10029>
 * 响应为「单向流式」：多个 JSON 对象顺序拼接，每块含 { code, data:<base64 音频片段> }，
 * 结束块 code=20000000。需逐块解析并拼接所有 data 才是完整 MP3。
 */
async function genVolcanoTtsV3(cred, model, text, voice, storyboardId, { speed = 1.0 } = {}) {
  const base = (cred.baseUrl || 'https://openspeech.bytedance.com').replace(/\/+$/, '');
  const url = `${base}/api/v3/tts/unidirectional`;
  const resourceId = cred.resourceId || 'volc.service_type.10029';
  const speaker = mapVolcanoVoiceV3(voice, model);
  const body = {
    user: { uid: 'snoopy-king' },
    req_params: {
      text,
      speaker,
      audio_params: {
        format: 'mp3',
        sample_rate: 24000,
        speech_rate: Math.round((Math.max(0.2, Math.min(3, speed || 1.0)) - 1) * 100), // V3 语速：-50~100，1.0→0
      },
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Api-App-Id': String(cred.appId),
        'X-Api-Access-Key': String(cred.apiKey),
        'X-Api-Resource-Id': resourceId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const txt = await resp.text();
  // 单向流式：多个顶层 JSON 对象顺序拼接，按花括号配对切分
  const buffers = [];
  let depth = 0, start = -1, errMsg = '';
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = txt.slice(start, i + 1);
        start = -1;
        try {
          const j = JSON.parse(slice);
          if (j.data) buffers.push(Buffer.from(j.data, 'base64'));
          // 错误码：非 0 且非 20000000(结束) 视为失败
          if (j.code !== undefined && j.code !== 0 && j.code !== 20000000) {
            errMsg = `code=${j.code} ${j.message || ''}`;
          }
          // V3 也可能用 header.code 包裹错误
          if (j.header && j.header.code !== undefined && j.header.code !== 0 && j.header.code !== 20000000) {
            errMsg = `code=${j.header.code} ${(j.header.message) || ''}`;
          }
        } catch (_) { /* 跳过无法解析的片段 */ }
      }
    }
  }
  const buf = Buffer.concat(buffers);
  if (!resp.ok || buf.length < 1024) {
    throw new Error(`火山 V3 大模型 TTS 失败（HTTP ${resp.status}${errMsg ? ', ' + errMsg : ''}）: ${txt.slice(0, 160)}`);
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `tts_${storyboardId || uuidv4()}_${Date.now()}.mp3`;
  const outputPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(outputPath, buf);
  return {
    file_path: outputPath,
    file_url: `/uploads/audio/${filename}`,
    voice: speaker,
    size: buf.length,
  };
}

/**
 * 统一入口：按 stageModels.voice 路由配音 provider。
 * provider='edge'（或未配）→ 本地 Edge TTS；云端 → genOpenAiTts。
 * 任何云端失败 → 自动降级到 Edge（降级不中断）。
 * 返回与 edge.generateTTS 同契约 {file_path,file_url,voice,size}。
 */
async function synthesize({ text, voice, speed = 1.0, pitch = 0, storyboardId, provider, model, noFallback = false, emotion = 'general', volume = 1.0 } = {}) {
  const ttsOpts = { emotion, volume };
  if (isDemoMode()) return generateDemoTts(text, voice, speed, pitch, storyboardId, ttsOpts);
  // 未显式传 provider 则读阶段路由；默认 edge
  let prov = provider;
  let useModel = model;
  if (!prov) {
    const route = config.get('stageModels.voice') || {};
    prov = route.provider || 'edge';
    useModel = useModel || route.model;
  }

  // 本地 Edge（默认）
  if (!prov || prov === 'edge') {
    return edge.generateTTS(text, voice, speed, pitch, storyboardId, ttsOpts);
  }

  // 云端：按注册表协议分发，失败降级 Edge（noFallback=true 时如实抛错，用于连通性测试）
  const def = registry.getProvider(prov);
  const cred = registry.resolveCredentials(prov);
  try {
    if (def && def.protocol === 'openai-tts' && cred && cred.apiKey) {
      return await genOpenAiTts(cred, useModel || (def.models && def.models[0]), text, voice, storyboardId);
    }
    if (def && def.protocol === 'volcano-tts' && cred && cred.apiKey && cred.appId) {
      return await genVolcanoTts(cred, useModel || (def.models && def.models[0]), text, voice, storyboardId, { emotion, speed, volume });
    }
    if (def && def.protocol === 'volcano-tts-v3' && cred && cred.apiKey && cred.appId) {
      return await genVolcanoTtsV3(cred, useModel || (def.models && def.models[0]), text, voice, storyboardId, { speed });
    }
    // 未知协议或未配密钥：降级
    throw new Error(`配音 provider「${prov}」不可用，降级 Edge`);
  } catch (e) {
    if (noFallback) throw e;
    console.error(`[ttsProvider] 云端配音失败（${prov}），降级 Edge:`, e.message);
    return edge.generateTTS(text, voice, speed, pitch, storyboardId, ttsOpts);
  }
}

module.exports = { synthesize, canHandle, VOICES: edge.VOICES, OPENAI_VOICES };
