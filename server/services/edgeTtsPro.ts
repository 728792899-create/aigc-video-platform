/**
 * 增强版 Edge TTS 引擎（配音/字幕升级三档共用底座）
 *
 * 相比 services/tts.js（基于 node-edge-tts 库）多出的能力：
 *  - 音量控制（volume），库支持但项目原先没用
 *  - 词级时间戳（WordBoundary metadata，毫秒级），用于字幕真实卡点 + 卡拉OK逐词高亮
 *
 * 情感说明：免费 Edge readaloud 端点不支持 mstts:express-as（实测 code=1007 SSML invalid，
 * 那是 Azure 付费认知服务端点的能力）。本项目用"情感预设"把情感映射到 rate/pitch/volume/音色
 * 组合来近似（见 EMOTION_PRESETS），完全免费、零依赖。
 *
 * 设计：自建一个最小 Edge WebSocket 客户端，复用 node-edge-tts 的 DRM token（Sec-MS-GEC），
 * 不重复造 token 算法。任何失败由【调用方】降级回 services/tts.js（零回归）。
 */
import crypto from 'node:crypto'
import path from 'node:path'
import WebSocket, { type RawData } from 'ws'
import * as config from './config'
const drm = require('node-edge-tts/dist/drm');

type JsonObject = Record<string, unknown>
interface SsmlOptions { voice: string; text: string; rate?: string; pitch?: string; volume?: string; lang?: string }
interface WordTiming { part: string; start: number; end: number }
interface SynthesisOptions { outputFormat?: string; timeout?: number }
interface EmotionPreset { label: string; rate: number; pitch: number; volume: number; voice: string | null }

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data))
  return Buffer.from(data)
}

const UPLOAD_DIR = path.resolve(String(config.get('uploadDir')), 'audio');
const TRUSTED_TOKEN = drm.TRUSTED_CLIENT_TOKEN;
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

export function escapeXml(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// 情感预设：免费 Edge 不支持 express-as，用 语速/音调/音量/推荐音色 的组合"伪情感"近似。
// rate/pitch/volume 为相对系数（叠加在用户 speed/pitch 之上）；voice 为该情感推荐的默认音色（用户已选音色时不强制覆盖）。
export const EMOTION_PRESETS: Record<string, EmotionPreset> = {
  general:      { label: '默认',     rate: 0,    pitch: 0,   volume: 1.0, voice: null },
  cheerful:     { label: '欢快',     rate: 0.08, pitch: 18,  volume: 1.1, voice: 'xiaoyi' },
  gentle:       { label: '温柔',     rate: -0.08,pitch: 6,   volume: 0.92,voice: 'xiaoxiao' },
  serious:      { label: '严肃',     rate: -0.05,pitch: -10, volume: 1.0, voice: 'yunyang' },
  newscast:     { label: '新闻播报', rate: -0.02,pitch: -4,  volume: 1.05,voice: 'yunyang' },
  affectionate: { label: '亲切',     rate: -0.05,pitch: 8,   volume: 0.95,voice: 'xiaoxiao' },
  lyrical:      { label: '抒情',     rate: -0.12,pitch: 4,   volume: 0.9, voice: 'xiaoxiao' },
  energetic:    { label: '激情',     rate: 0.12, pitch: 22,  volume: 1.15,voice: 'yunxi' },
  sad:          { label: '低沉',     rate: -0.15,pitch: -14, volume: 0.85,voice: 'yunjian' },
};

/**
 * 构造 SSML（免费 Edge readaloud 端点，仅支持 prosody，不支持 mstts:express-as）。
 * 情感不在此处用 SSML 实现，而是由调用方通过"情感预设"映射到 rate/pitch/volume/voice 组合（见 EMOTION_PRESETS）。
 * @param {object} o { voice, text, rate, pitch, volume }
 */
export function buildSsml({ voice, text, rate = 'default', pitch = 'default', volume = 'default', lang = 'zh-CN' }: SsmlOptions): string {
  const safe = escapeXml(text);
  const prosody = `<prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${safe}</prosody>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">`
    + `<voice name="${voice}">${prosody}</voice></speak>`;
}

export function rateStrOf(speed: number): string {
  if (speed >= 1) return `+${Math.round((speed - 1) * 100)}%`;
  return `-${Math.round((1 - speed) * 100)}%`;
}
export function pitchStrOf(pitch: number): string {
  return pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;
}
export function volumeStrOf(vol: number | null | undefined): string {
  // vol: 0.0~2.0（1.0=原始），映射到 Edge 的 -100%~+100%
  if (vol == null) return 'default';
  const v = Math.round((Math.max(0, Math.min(2, vol)) - 1) * 100);
  return v >= 0 ? `+${v}%` : `${v}%`;
}

/**
 * 通过 Edge WebSocket 合成语音 + 收集词级时间戳。
 * @returns {Promise<{audioBuffer:Buffer, words:Array<{part,start,end}>}>}
 * start/end 单位毫秒。失败 reject，由调用方降级。
 */
export function synthViaWs(ssml: string, { outputFormat = 'audio-24khz-48kbitrate-mono-mp3', timeout = 35000 }: SynthesisOptions = {}): Promise<{ audioBuffer: Buffer; words: WordTiming[] }> {
  return new Promise<{ audioBuffer: Buffer; words: WordTiming[] }>((resolve, reject) => {
    const secMsGec = drm.generateSecMsGecToken();
    const major = String(drm.CHROMIUM_FULL_VERSION).split('.')[0];
    const url = `${WSS_BASE}?TrustedClientToken=${TRUSTED_TOKEN}`
      + `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-${drm.CHROMIUM_FULL_VERSION}`;
    const ws = new WebSocket(url, {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const chunks: Buffer[] = [];
    const words: WordTiming[] = [];
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; try { ws.close(); } catch {} reject(new Error(`edgeTtsPro 合成超时（>${timeout / 1000}s）`)); }
    }, timeout);
    const finish = (error?: Error): void => {
      if (done) return; done = true;
      clearTimeout(timer); try { ws.close(); } catch {}
      error ? reject(error) : resolve({ audioBuffer: Buffer.concat(chunks), words });
    };
    ws.on('open', () => {
      const cfg = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
        + JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' }, outputFormat } } } });
      ws.send(cfg);
      const reqId = crypto.randomBytes(16).toString('hex');
      ws.send(`X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`);
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
      const buffer = rawDataBuffer(data);
      if (isBinary) {
        const sep = Buffer.from('Path:audio\r\n');
        const idx = buffer.indexOf(sep);
        if (idx >= 0) chunks.push(buffer.subarray(idx + sep.length));
      } else {
        const msg = buffer.toString();
        if (msg.includes('Path:turn.end')) return finish();
        if (msg.includes('Path:audio.metadata')) {
          try {
            const meta = asRecord(JSON.parse(msg.split('\r\n').pop() || '{}'));
            const metadata = Array.isArray(meta.Metadata) ? meta.Metadata : [];
            metadata.forEach((value: unknown) => {
              const element = asRecord(value);
              const data = asRecord(element.Data);
              const text = asRecord(data.text);
              if (element.Type === 'WordBoundary' && text.Text) {
                words.push({
                  part: String(text.Text),
                  start: Math.floor(Number(data.Offset) / 10000),
                  end: Math.floor((Number(data.Offset) + Number(data.Duration)) / 10000),
                });
              }
            });
          } catch {}
        }
      }
    });
    ws.on('error', (error: Error) => finish(error));
    ws.on('close', (code: number, reason: Buffer) => { if (!done) finish(new Error(`edgeTtsPro WebSocket 关闭 code=${code} reason=${reason.toString().slice(0, 80)}`)); });
  });
}
