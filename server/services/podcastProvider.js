/**
 * 火山豆包语音播客大模型 WebSocket 客户端
 * 
 * 协议：WebSocket 二进制协议（V3），event-driven 状态机
 * 功能：输入文本/话题/文件 → 自动生成双人播客音频（带对话稿）
 * 
 * 事件流程：
 *   StartConnection(1) → ConnectionStarted(50)
 *   → StartSession(100,带播客参数) → SessionStarted(150)
 *   → PodcastRoundStart(360,文本) → PodcastAudio(361,音频流) → PodcastRoundEnd(362,时长)
 *   → ... 多轮 ...
 *   → PodcastEnd(363,完整URL) → FinishConnection(2) → ConnectionFinished(52)
 */
const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';
const RESOURCE_ID = 'volc.service_type.10050';
const APP_KEY = 'aGjiRDfUWi'; // 火山固定值

/**
 * 构造 Connect 类事件帧（StartConnection/FinishConnection）
 * 帧结构：[header 4B][event 4B][payload_size 4B][payload]
 */
function buildConnectFrame(eventNum, payloadObj) {
  const header = Buffer.from([0x11, 0x14, 0x10, 0x00]); // v1 | FullClientRequest flags=0b0100 | JSON no-compress | reserved
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(eventNum, 0);
  const payloadBuf = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(payloadBuf.length, 0);
  return Buffer.concat([header, eventBuf, sizeBuf, payloadBuf]);
}

/**
 * 构造 Session 类事件帧（StartSession/FinishSession）
 * 帧结构：[header 4B][event 4B][session_id_size 4B][session_id][payload_size 4B][payload]
 */
function buildSessionFrame(eventNum, sessionId, payloadObj) {
  const header = Buffer.from([0x11, 0x14, 0x10, 0x00]);
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(eventNum, 0);
  const sidBuf = Buffer.from(sessionId, 'utf8');
  const sidSizeBuf = Buffer.alloc(4);
  sidSizeBuf.writeUInt32BE(sidBuf.length, 0);
  const payloadBuf = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(payloadBuf.length, 0);
  return Buffer.concat([header, eventBuf, sidSizeBuf, sidBuf, sizeBuf, payloadBuf]);
}

/**
 * 解析服务端响应帧
 */
function parseFrame(buf) {
  if (buf.length < 8) return { error: 'frame too short' };
  const msgType = buf[1] >> 4;
  const flags = buf[1] & 0x0f;
  let offset = 4; // after header
  let eventNum = null, sessionId = null;

  if (flags & 0b0100) {
    eventNum = buf.readInt32BE(offset);
    offset += 4;
  }

  // Session类下行事件带 session_id（150,152,350-363）
  const sessionEvents = [150, 151, 152, 153, 350, 351, 352, 353, 359, 360, 361, 362, 363];
  if (eventNum && sessionEvents.includes(eventNum)) {
    const sidSize = buf.readUInt32BE(offset);
    offset += 4;
    sessionId = buf.slice(offset, offset + sidSize).toString('utf8');
    offset += sidSize;
  }

  // Error frame 0b1111
  if (msgType === 0b1111) {
    const errCode = buf.readUInt32BE(offset);
    offset += 4;
    const sz = buf.readUInt32BE(offset);
    offset += 4;
    const msg = buf.slice(offset, offset + sz).toString('utf8');
    return { kind: 'error', event: eventNum, code: errCode, msg };
  }

  // Audio frame 0b1011
  if (msgType === 0b1011) {
    const sz = buf.readUInt32BE(offset);
    offset += 4;
    const audio = buf.slice(offset, offset + sz);
    return { kind: 'audio', event: eventNum, data: audio };
  }

  // JSON frame 0b1001
  const sz = buf.readUInt32BE(offset);
  offset += 4;
  const payload = buf.slice(offset, offset + sz).toString('utf8');
  try {
    return { kind: 'json', event: eventNum, data: JSON.parse(payload) };
  } catch (err) {
    return { kind: 'json', event: eventNum, raw: payload };
  }
}

/**
 * 生成播客音频
 * @param {object} options
 * @param {object} options.credentials { appId, apiKey } 火山凭证
 * @param {number} options.action 0=总结长文, 3=直接合成对话文本, 4=联网生成
 * @param {string} options.inputText action=0 时的输入文本
 * @param {string} options.promptText action=4 时的话题（如"火山引擎"）
 * @param {array} options.nlpTexts action=3 时的对话列表 [{speaker, text}, ...]
 * @param {array} options.speakers 播客发音人（最多2个），如 ['zh_male_dayixiansheng_v2_saturn_bigtts', 'zh_female_mizaitongxue_v2_saturn_bigtts']
 * @param {boolean} options.useHeadMusic 是否使用开头音效（默认 false）
 * @param {string} options.format 音频格式 mp3/ogg_opus/pcm (默认 mp3)
 * @param {number} options.sampleRate 采样率 16000/24000/48000 (默认 24000)
 * @param {number} options.timeout 超时秒数（默认 120）
 * @returns {Promise<{audioBuffer, rounds, totalDuration}>}
 */
async function generatePodcast(options) {
  const {
    credentials,
    action = 0,
    inputText = '',
    promptText = '',
    nlpTexts = [],
    speakers = ['zh_male_dayixiansheng_v2_saturn_bigtts', 'zh_female_mizaitongxue_v2_saturn_bigtts'],
    useHeadMusic = false,
    format = 'mp3',
    sampleRate = 24000,
    timeout = 120,
  } = options;

  if (!credentials || !credentials.appId || !credentials.apiKey) {
    throw new Error('[Podcast] Missing volcano_tts credentials (appId/apiKey)');
  }

  const sessionId = crypto.randomUUID();
  const audioChunks = [];
  const rounds = []; // [{round_id, speaker, text, audio_duration, start_time, end_time}, ...]
  let totalDuration = 0;
  let connectId = null;
  let sessionStarted = false;
  let finished = false;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`[Podcast] Timeout after ${timeout}s`));
    }, timeout * 1000);

    const ws = new WebSocket(WS_URL, {
      headers: {
        'X-Api-App-Id': credentials.appId,
        'X-Api-Access-Key': credentials.apiKey,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-App-Key': APP_KEY,
      },
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`[Podcast] WebSocket error: ${err.message}`));
    });

    ws.on('open', () => {
      // 1. StartConnection
      ws.send(buildConnectFrame(1, {}));
    });

    ws.on('message', (data) => {
      const frame = parseFrame(data);

      if (frame.kind === 'error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`[Podcast] Error ${frame.code}: ${frame.msg}`));
        return;
      }

      if (frame.kind === 'audio') {
        // event 361 PodcastAudio
        audioChunks.push(frame.data);
        return;
      }

      if (frame.kind === 'json') {
        const { event, data: payload } = frame;

        if (event === 50) {
          // ConnectionStarted
          connectId = payload;
          // 2. StartSession with podcast params
          const req = {
            input_id: sessionId,
            action,
            use_head_music: useHeadMusic,
            audio_config: { format, sample_rate: sampleRate, speech_rate: 0 },
          };
          if (action === 0) req.input_text = inputText;
          else if (action === 3) req.nlp_texts = nlpTexts;
          else if (action === 4) req.prompt_text = promptText;

          if (speakers && speakers.length > 0) {
            req.speaker_info = {
              random_order: true,
              speakers: speakers.slice(0, 2),
            };
          }

          ws.send(buildSessionFrame(100, sessionId, req));
        } else if (event === 150) {
          // SessionStarted
          sessionStarted = true;
        } else if (event === 360) {
          // PodcastRoundStart：记录轮次信息
          rounds.push({
            round_id: payload.round_id,
            speaker: payload.speaker,
            text: payload.text,
            round_type: payload.round_type || '',
          });
        } else if (event === 362) {
          // PodcastRoundEnd：记录时长
          const lastRound = rounds[rounds.length - 1];
          if (lastRound) {
            lastRound.audio_duration = payload.audio_duration;
            lastRound.start_time = payload.start_time;
            lastRound.end_time = payload.end_time;
            totalDuration = payload.end_time;
          }
        } else if (event === 363) {
          // PodcastEnd：播客生成完毕（可选 audio_url）
          finished = true;
          // 3. FinishConnection
          ws.send(buildConnectFrame(2, {}));
          setTimeout(() => ws.close(), 300);
        } else if (event === 52) {
          // ConnectionFinished：正常结束
          clearTimeout(timer);
          ws.close();
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!finished && !sessionStarted) {
        return reject(new Error('[Podcast] Connection closed before session started'));
      }
      if (audioChunks.length === 0) {
        return reject(new Error('[Podcast] No audio received'));
      }
      resolve({
        audioBuffer: Buffer.concat(audioChunks),
        rounds,
        totalDuration,
      });
    });
  });
}

module.exports = { generatePodcast };
