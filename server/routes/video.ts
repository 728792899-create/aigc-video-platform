import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const router = express.Router();
const { getDb } = require('../db');
const subtitleService = require('../services/subtitle');
const taskManager = require('../services/taskManager');
const { resolveUploadPath, toRelative } = require('../utils/fileCleanup');
const { probeDuration } = require('../utils/mediaProbe');
const config = require('../services/config');
const assetNaming = require('../services/assetNaming');
const timelineService = require('../services/timeline');
const { mediaAdapter } = require('../services/mediaAdapter');
const {
  exportLocationInfo,
  preflightExternalExportDirectory,
  copyExportToExternal,
} = require('../services/exportStorage');
const {
  ffmpeg,
  setEncodePreset,
  timeoutForSeconds,
  withFfmpegTimeout,
} = require('../services/ffmpegRunner');

type EntityId = string | number
type ProgressCallback = (progress: number, message: string) => void
type Resolution = { w: number; h: number }
type JsonObject = Record<string, unknown>

interface TimelineScene extends JsonObject {
  storyboard_id: EntityId
  original_duration_ms: number
  duration_ms?: number
}

interface ProjectTimeline extends JsonObject {
  project_id?: EntityId
  total_duration: number
  original_total_duration: number
  scenes: TimelineScene[]
}

interface StoryboardRow extends JsonObject {
  id: EntityId
  scene_number?: number
  sort_order?: number
  description?: string
  dialog?: string
  prompt?: string
  duration?: number
  image_path?: string
  selected_image_id?: EntityId | null
  audio_url?: string
  no_voice?: boolean | number
  transition?: string
  motion?: string
  subtitle_text?: string
  subtitle_style?: string
  chapter_index?: number
  chapter_title?: string
}

interface ComposeOptions extends JsonObject {
  quality?: string
  format?: string
  ratio?: string
  resolution?: string | Resolution
  fps?: number
  motion?: string
  transitionDuration?: number
  duration?: number
  videoSpeed?: number
  video_speed?: number
  preview?: boolean
  burnSubtitle?: boolean
  karaoke?: boolean
  subtitleEffect?: string
  subtitleStyle?: JsonObject
  videoProvider?: string
  videoModel?: string
  i2v?: boolean
  aiVideoMode?: string
  ai_video_mode?: string
  longMode?: boolean
  long_video_mode?: boolean
  keyframeEvery?: number
  taskId?: string
  bgm?: unknown
  bgmVolume?: number
  chapterDurationSec?: number
  timeline?: ProjectTimeline
}

interface T2vTarget { provider: string; model: string | null }
interface GenerationTaskRef {
  id: string
  status: string
  provider_task_id?: string | null
}
interface SegmentResult { segments: string[]; transitions: string[] }
interface SubtitleMetadata extends JsonObject {
  has_subtitle: 0 | 1
  burn_subtitle: 0 | 1
  srt_url: string | null
  vtt_url: string | null
  subtitle_status: string
  subtitle_error: string | null
}
interface LongVideoGroup {
  chapterIndex: number
  title: string
  storyboards: StoryboardRow[]
}
interface ComposeResult extends JsonObject {
  file_path: string
  file_url: string
  video_speed: number
  duration: number
  original_duration: number
}
interface ExportRow extends JsonObject {
  id?: EntityId
  file_path?: string
  file_url?: string
  external_file_path?: string
  srt_url?: string
  vtt_url?: string
  has_subtitle?: number
  burn_subtitle?: number
  subtitle_status?: string
  file_size?: number
  file_exists?: boolean
  external_file_exists?: boolean
}

const ComposeOptionsSchema = z.object({
  quality: z.string().optional(), format: z.string().optional(), ratio: z.string().optional(),
  resolution: z.string().optional(), fps: z.number().positive().optional(), motion: z.string().optional(),
  transitionDuration: z.number().min(0).max(10).optional(), videoSpeed: z.number().positive().optional(),
  video_speed: z.number().positive().optional(), burnSubtitle: z.boolean().optional(), karaoke: z.boolean().optional(),
  subtitleEffect: z.string().optional(), subtitleStyle: z.record(z.string(), z.unknown()).optional(),
  videoProvider: z.string().optional(), videoModel: z.string().optional(), i2v: z.boolean().optional(),
  aiVideoMode: z.string().optional(), ai_video_mode: z.string().optional(), longMode: z.boolean().optional(),
  long_video_mode: z.boolean().optional(), keyframeEvery: z.number().int().positive().optional(),
  bgm: z.unknown().optional(), bgmVolume: z.number().min(0).max(1).optional(),
  chapterDurationSec: z.number().int().positive().optional(),
}).passthrough()
const ProjectIdSchema = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)])
const ComposeRequestSchema = z.object({
  project_id: ProjectIdSchema,
  options: ComposeOptionsSchema.default({}),
  async: z.boolean().optional(),
})
const PreviewRequestSchema = z.object({
  project_id: ProjectIdSchema,
  options: ComposeOptionsSchema.default({}),
  limit: z.coerce.number().int().min(1).max(6).default(3),
})

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

// ============ 并发锁：同一时间只允许一个合成任务 ============
let composeLock = false;
const composeQueue: Array<() => void> = [];

function acquireComposeLock(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!composeLock) {
      composeLock = true;
      resolve();
    } else {
      composeQueue.push(resolve);
    }
  });
}

function releaseComposeLock(): void {
  if (composeQueue.length > 0) {
    const next = composeQueue.shift();
    next?.();
  } else {
    composeLock = false;
  }
}

function clampVideoSpeed(value: unknown): number {
  return timelineService.normalizeVideoSpeed(value);
}

function atempoChain(speed: unknown): string {
  let v = Number(speed) || 1;
  const filters: string[] = [];
  while (v > 2) { filters.push('atempo=2'); v /= 2; }
  while (v < 0.5) { filters.push('atempo=0.5'); v /= 0.5; }
  filters.push(`atempo=${Math.round(v * 1000) / 1000}`);
  return filters.join(',');
}

/**
 * 画幅比例 → 输出分辨率映射。短视频常用竖屏 9:16。
 * 兼容多种写法（'9:16'、'9_16'、'portrait' 等）。
 */
const RATIO_PRESETS: Record<string, Resolution> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '4:3': { w: 1440, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
};
function resolveResolution(ratioOrOptions?: string | ComposeOptions): Resolution {
  // 新用法（v1.7 导出设置）：传 options 对象（带 resolution 档位 + ratio 比例）。
  // 旧用法：直接传 ratio 字符串，行为完全不变（向后兼容现有所有调用）。
  if (ratioOrOptions && typeof ratioOrOptions === 'object') {
    const { resolution, ratio } = ratioOrOptions;
    if (resolution && typeof resolution === 'object') return resolution
    if (resolution && ['720p', '1080p', '2k', '4k'].includes(resolution)) {
      return resolveResolutionByTier(resolution, ratio);
    }
    return resolveResolution(ratio); // 无档位 → 回退现有 ratio 死锁逻辑
  }
  const ratio = ratioOrOptions;
  if (!ratio) return RATIO_PRESETS['16:9'] || { w: 1920, h: 1080 };
  const key = String(ratio).replace(/[_x]/g, ':').trim();
  const alias: Record<string, string> = { portrait: '9:16', vertical: '9:16', landscape: '16:9', square: '1:1' };
  return RATIO_PRESETS[alias[key] || key] || RATIO_PRESETS['16:9'] || { w: 1920, h: 1080 };
}

/**
 * 分辨率档位 → 实际像素（基于 ratio 动态缩放，不再死锁 5 档）。
 * 720p/1080p/2k/4k 各档以「横屏长边」为基准，按真实宽高比缩放出竖屏/方形尺寸。
 * 偶数对齐（libx264 要求宽高为偶数）。
 * @param {string} resolution '720p'|'1080p'|'2k'|'4k'
 * @param {string} ratio '16:9'|'9:16'|'1:1'|'4:3'|'4:5' 等
 * @returns {{w:number, h:number}}
 */
function resolveResolutionByTier(resolution: string, ratio?: string): Resolution {
  const TIER_BASE: Record<string, number> = { '720p': 1280, '1080p': 1920, '2k': 2560, '4k': 3840 };
  const base = TIER_BASE[resolution] || 1920;
  const key = String(ratio || '16:9').replace(/[_x]/g, ':').trim();
  const alias: Record<string, string> = { portrait: '9:16', vertical: '9:16', landscape: '16:9', square: '1:1' };
  const normalized = alias[key] || key;
  const parts = normalized.split(':');
  const wr = parseFloat(parts[0] ?? '') || 16;
  const hr = parseFloat(parts[1] ?? '') || 9;
  const even = (n: number): number => { n = Math.round(n); return n % 2 === 0 ? n : n + 1; };
  // 方形：对齐 1080p 基准（1920*0.5625=1080）
  if (Math.abs(wr - hr) < 0.01) {
    const square = even(base * 0.5625);
    return { w: square, h: square };
  }
  // 横屏（宽>高）：宽=base；竖屏（高>宽）：高=base
  if (wr > hr) return { w: even(base), h: even(base * (hr / wr)) };
  return { w: even(base * (wr / hr)), h: even(base) };
}

/**
 * 格式 → ffmpeg 编码参数。本期支持 mp4/mov/webm；gif 暂回退 mp4（后续单独两阶段实现）。
 * @param {string} format 'mp4'|'mov'|'webm'|'gif'
 * @returns {{ext:string, container:string, vcodec:string, acodec:string|null}}
 */
function resolveOutputFormat(format: unknown): { ext: string; container: string; vcodec: string; acodec: string | null } {
  const FORMAT_MAP: Record<string, { ext: string; container: string; vcodec: string; acodec: string | null }> = {
    mp4:  { ext: '.mp4',  container: 'mp4',  vcodec: 'libx264',    acodec: 'aac' },
    mov:  { ext: '.mov',  container: 'mov',  vcodec: 'libx264',    acodec: 'aac' },
    webm: { ext: '.webm', container: 'webm', vcodec: 'libvpx-vp9', acodec: 'libopus' },
  };
  return FORMAT_MAP[String(format)] || FORMAT_MAP.mp4 || { ext: '.mp4', container: 'mp4', vcodec: 'libx264', acodec: 'aac' };
}

/**
 * 画质 → CRF 值。CRF 越低画质越高、文件越大。libx264/vp9 通用区间。
 * @param {string} quality 'standard'|'high'|'ultra'
 * @returns {number}
 */
function resolveCRF(quality: unknown): number {
  const CRF_MAP: Record<string, number> = { standard: 28, high: 23, ultra: 18 };
  return CRF_MAP[String(quality)] || 23;
}

/**
 * 统一构造「内部工作流」的视频/音频编码参数（始终 h264 + aac，仅 CRF 受 quality 影响）。
 * 设计要点：分段/拼接/字幕全程保持 h264/mp4 内部格式不变（零破坏），
 * 目标容器/编码（mov/webm）只在最后一步 transcodeToFormat 转换，隔离风险。
 * @param {object} options {quality}
 * @param {object} extra {tune:'stillimage'} 静图段额外参数
 * @returns {{vArgs:string[], aArgs:string[]}}
 */
function buildEncodeArgs(options: ComposeOptions = {}, extra: { tune?: string } = {}): { vArgs: string[]; aArgs: string[] } {
  const crf = resolveCRF(options.quality || 'high');
  const vArgs = ['-c:v', 'libx264', '-crf', String(crf)];
  if (extra.tune) vArgs.push('-tune', extra.tune);
  const aArgs = ['-c:a', 'aac', '-b:a', '192k'];
  return { vArgs, aArgs };
}

/**
 * 最终格式转换：把内部 h264/mp4 成片转成目标容器/编码。
 * - mp4：原样（调用方不应调用本函数）
 * - mov：仅换容器（-c copy，h264/aac 在 mov 容器合法，无损极快）
 * - webm：真转码到 vp9/opus（CRF 控质）
 * @param {string} inputPath 内部 h264/mp4 成片
 * @param {string} outputPath 目标路径（扩展名已是目标格式）
 * @param {object} options {format, quality}
 */
async function transcodeToFormat(inputPath: string, outputPath: string, options: ComposeOptions = {}): Promise<void> {
  const fmt = resolveOutputFormat(options.format || 'mp4');
  const crf = resolveCRF(options.quality || 'high');
  if (fmt.vcodec === 'libvpx-vp9') {
    // webm：vp9 + opus 真转码
    await ffmpeg('-y', '-i', inputPath,
      '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0',
      '-c:a', 'libopus', '-b:a', '128k', outputPath);
  } else {
    // mov（及未知格式兜底）：h264/aac 直接换容器
    await ffmpeg('-y', '-i', inputPath, '-c', 'copy', outputPath);
  }
}

/**
 * 运镜（Ken Burns）预设：让静态图片产生缓慢的推拉/平移，告别"PPT 感"。
 * 用 ffmpeg zoompan 实现，纯滤镜不依赖额外库。
 */
const MOTION_PRESETS: Record<string, { label: string; desc: string }> = {
  none: { label: '静止', desc: '不加运镜' },
  'zoom-in': { label: '缓慢推近', desc: '画面由远及近推入' },
  'zoom-out': { label: '缓慢拉远', desc: '画面由近及远拉出' },
  'pan-right': { label: '向右平移', desc: '镜头从左向右移动' },
  'pan-left': { label: '向左平移', desc: '镜头从右向左移动' },
};

function normalizeMotion(motion: unknown): string {
  if (!motion) return 'none';
  const key = String(motion).replace(/[_\s]/g, '-').trim().toLowerCase();
  const alias: Record<string, string> = { in: 'zoom-in', out: 'zoom-out', zoomin: 'zoom-in', zoomout: 'zoom-out',
    panright: 'pan-right', panleft: 'pan-left', kenburns: 'zoom-in' };
  return MOTION_PRESETS[alias[key] || key] ? (alias[key] || key) : 'none';
}

/**
 * 构造 Ken Burns 的 zoompan 滤镜串；motion='none' 返回 null（走原静态 scale+pad）。
 * 先把图放大到画布 2 倍再 zoompan，给平移留余量并抑制整数像素抖动。
 */
function buildMotionFilter(motion: unknown, w: number, h: number, fps: number, duration: number): string | null {
  const m = normalizeMotion(motion);
  if (m === 'none') return null;
  const frames = Math.max(1, Math.round((duration || 5) * fps));
  const UP = 2; // 上采样倍数，留出平移空间并减少抖动
  const sw = w * UP, sh = h * UP;
  const pre = `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh}`;
  const cx = `iw/2-(iw/zoom/2)`;
  const cy = `ih/2-(ih/zoom/2)`;
  let z: string, x: string, y: string;
  switch (m) {
    case 'zoom-in':  z = `1+0.18*on/${frames}`;       x = cx; y = cy; break;
    case 'zoom-out': z = `1.18-0.18*on/${frames}`;    x = cx; y = cy; break;
    case 'pan-right': z = `1.1`; x = `(iw-iw/zoom)*on/${frames}`;       y = cy; break;
    case 'pan-left':  z = `1.1`; x = `(iw-iw/zoom)*(1-on/${frames})`;   y = cy; break;
    default: return null;
  }
  const zp = `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${w}x${h}:fps=${fps}`;
  return `${pre},${zp},format=yuv420p`;
}

/**
 * 把单张图片 + 单个音频 → 单段 mp4
 */
async function imageAudioToSegment(
  imagePath: string,
  audioPath: string | null,
  duration: number,
  outputPath: string,
  options: ComposeOptions = {},
): Promise<string> {
  const fps = options.fps || 30;
  const { w, h } = typeof options.resolution === 'object' ? options.resolution : resolveResolution(options);

  // ④ 音画对齐核心：有配音且非「不读」时，画面时长 = 音频真实时长 + 尾镜留白，
  //    紧跟音频，不再取「设定时长」与音频的较大值——否则旧的按字数估算的偏大
  //    duration（如 6.8s）会让画面在配音（4.8s）结束后空放 2s 静音，正是用户看到的
  //    「音频比视频短 / 音画不匹配」。音频用 apad 补静音到画面时长，绝不被截断。
  //    无配音的分镜（旁白/标记不读）才回退用设定时长。
  // v1.6.5：尾镜留白改为可配（config.pacing）。紧凑节奏默认 0.12s，消除多段累积的
  //    "每句话之间都明显停顿"；旧固定 0.3s 行为可通过关闭 tightPace 恢复。
  const pacing = config.get('pacing') || {};
  const TAIL = pacing.tightPace === false
    ? (Number(pacing.standardTail) || 0.3)
    : (Number(pacing.tightTail) || 0.12);
  let frameDur = Number(duration) || 5;
  let audioDur: number | null = null;
  const hasAudio = audioPath && fs.existsSync(audioPath);
  if (hasAudio) {
    audioDur = await probeDuration(audioPath);
    if (audioDur && audioDur > 0) frameDur = audioDur + TAIL;
  }
  frameDur = Math.round(frameDur * 100) / 100;

  // 有运镜则用 Ken Burns（zoompan）滤镜，否则走原静态 scale+pad
  const motionFilter = buildMotionFilter(options.motion, w, h, fps, frameDur);
  const vfilter = motionFilter
    || `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=${fps}`;

  // 编码参数（v1.7 导出设置：format/quality 可控，未传则 mp4/high 与原行为一致）
  const { vArgs, aArgs } = buildEncodeArgs(options, { tune: 'stillimage' });

  let args: string[];
  if (hasAudio) {
    // 音频补静音到画面时长；输出 -t 锁定为画面时长，音画严格等长
    args = ['-y', '-loop', '1', '-t', String(frameDur), '-i', imagePath,
            '-i', audioPath, '-vf', vfilter, '-af', 'apad',
            ...vArgs, ...aArgs,
            '-pix_fmt', 'yuv420p', '-t', String(frameDur), '-r', String(fps), outputPath];
  } else {
    args = ['-y', '-loop', '1', '-t', String(frameDur), '-i', imagePath,
            '-f', 'lavfi', '-t', String(frameDur), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-vf', vfilter,
            ...vArgs, ...aArgs,
            '-pix_fmt', 'yuv420p', '-shortest', '-r', String(fps), outputPath];
  }
  await ffmpeg(...args);
  return outputPath;
}

/**
 * 把一段 AI 生成的视频片段 → 规整成与静态分段相同契约的 segment：
 *   缩放/补边到目标分辨率、统一 fps、并用 TTS 旁白替换原片音轨（无旁白则补静音轨，
 *   保证后续 xfade/concat 各段都有音轨不报错）。
 * 这样「AI 视频」轨与「静图运镜」轨产出格式一致，下游串联/字幕/配乐零改动。
 */
async function videoToSegment(
  videoPath: string,
  audioPath: string | null,
  outputPath: string,
  options: ComposeOptions = {},
): Promise<string> {
  const fps = options.fps || 30;
  const { w, h } = typeof options.resolution === 'object' ? options.resolution : resolveResolution(options);
  const targetDuration = Number(options.duration) || null;
  const videoDuration = await probeDuration(videoPath);
  const baseVf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps=${fps}`;
  const tailPad = targetDuration && videoDuration && videoDuration < targetDuration
    ? `,tpad=stop_mode=clone:stop_duration=${Math.max(0, targetDuration - videoDuration).toFixed(3)}`
    : '';
  const vf = `${baseVf}${tailPad}`;
  // 编码参数（v1.7 导出设置：format/quality 可控，未传则 mp4/high 与原行为一致）
  const { vArgs, aArgs } = buildEncodeArgs(options);
  let args: string[];
  if (audioPath && fs.existsSync(audioPath)) {
    args = ['-y', '-i', videoPath, '-i', audioPath, '-vf', vf,
            '-map', '0:v:0', '-map', '1:a:0',
            '-af', 'apad',
            ...vArgs, ...aArgs,
            '-pix_fmt', 'yuv420p', '-r', String(fps)];
    if (targetDuration) args.push('-t', String(targetDuration));
    args.push(outputPath);
  } else {
    args = ['-y', '-i', videoPath,
            '-f', 'lavfi', '-t', String(targetDuration || videoDuration || 5), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-vf', vf, '-map', '0:v:0', '-map', '1:a:0',
            ...vArgs, ...aArgs,
            '-pix_fmt', 'yuv420p', '-r', String(fps)];
    if (targetDuration) args.push('-t', String(targetDuration));
    args.push(outputPath);
  }
  await ffmpeg(...args);
  return outputPath;
}

/**
 * 用 xfade 拼接多段视频（带转场）
 */
/**
 * 构建 xfade filter_complex 字符串（多段拼接 + 转场效果）
 * @returns {string} ffmpeg filter_complex
 */
function buildXfadeFilterComplex(
  segments: string[],
  durations: number[],
  transitions: string[],
  transitionDuration: number,
): { filterComplex: string; lastV: string; lastA: string } {
  const TRANSITION_MAP: Record<string, string | null> = {
    none: null, fade: 'fade', slide: 'slideleft',
    zoom: 'zoomin', wipe: 'wipeleft', dissolve: 'dissolve',
  };

  let filterComplex = '';
  let lastV = '0:v';
  let lastA = '0:a';
  let cumulativeOffset = 0;

  for (let i = 1; i < segments.length; i++) {
    const transition = TRANSITION_MAP[transitions[i - 1] || 'none'] || 'fade';
    cumulativeOffset += (durations[i - 1] || 0) - transitionDuration;
    const vTag = `v${i}`;
    const aTag = `a${i}`;

    filterComplex += `[${lastV}][${i}:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${cumulativeOffset.toFixed(3)}[${vTag}];`;
    filterComplex += `[${lastA}][${i}:a]acrossfade=d=${transitionDuration}[${aTag}];`;

    lastV = vTag;
    lastA = aTag;
  }

  return { filterComplex: filterComplex.replace(/;$/, ''), lastV, lastA };
}

async function concatWithTransitions(
  segments: string[],
  transitions: string[],
  outputPath: string,
  options: ComposeOptions = {},
): Promise<void> {
  if (segments.length === 0) throw new Error('无分段');
  if (segments.length === 1) {
    const onlySegment = segments[0]
    if (!onlySegment) throw new Error('无分段')
    fs.copyFileSync(onlySegment, outputPath);
    return;
  }

  const transitionDuration = options.transitionDuration || 0.5;

  // 获取每段时长。probeDuration 内部先试 ffprobe（精确），失败自动回退 ffmpeg 解析
  // （打包版 ffmpeg-static 只带 ffmpeg.exe 没有 ffprobe.exe，这一步是全新安装机器能正常合成的关键）。
  // 任何一段都拿不到时，用一个安全的默认时长兜底，绝不让 spawn 失败冒泡阻断整个合成。
  const durations: number[] = [];
  for (const seg of segments) {
    let d = await probeDuration(seg);
    if (!Number.isFinite(d) || d <= 0) {
      console.warn('[video] 无法探测分段时长，使用默认值 3s:', seg);
      d = 3;
    }
    durations.push(d);
  }

  // 所有转场都是 none → concat demuxer 更快
  const allNone = transitions.every(t => !t || t === 'none');
  if (allNone) {
    const listFile = path.join(path.dirname(outputPath), `_list_${Date.now()}.txt`);
    fs.writeFileSync(listFile, segments.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
    await ffmpeg('-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath);
    try { fs.unlinkSync(listFile); } catch {}
    return;
  }

  // 构建 xfade filter_complex
  const inputs: string[] = [];
  for (const seg of segments) { inputs.push('-i', seg); }

  const { filterComplex, lastV, lastA } = buildXfadeFilterComplex(
    segments, durations, transitions, transitionDuration
  );

  const args = ['-y', ...inputs, '-filter_complex', filterComplex,
                '-map', `[${lastV}]`, '-map', `[${lastA}]`,
                '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '192k', '-pix_fmt', 'yuv420p', outputPath];
  await ffmpeg(...args);
}

/**
 * 给视频烧入字幕
 */
async function burnSubtitles(inputPath: string, outputPath: string, srtPath: string, style: JsonObject): Promise<void> {
  const subtitleFilter = subtitleService.buildSubtitleFilter(srtPath, style || {});
  await ffmpeg('-y', '-i', inputPath, '-vf', subtitleFilter,
               '-c:v', 'libx264', '-c:a', 'copy', '-pix_fmt', 'yuv420p', outputPath);
}

/**
 * 烧入卡拉OK逐词高亮 ASS 字幕（功能⑦）
 */
async function burnAss(inputPath: string, outputPath: string, assPath: string): Promise<void> {
  const assFilter = subtitleService.buildAssFilter(assPath);
  await ffmpeg('-y', '-i', inputPath, '-vf', assFilter,
               '-c:v', 'libx264', '-c:a', 'copy', '-pix_fmt', 'yuv420p', outputPath);
}

async function applyVideoSpeed(inputPath: string, outputPath: string, speed: number): Promise<string> {
  const s = clampVideoSpeed(speed);
  if (Math.abs(s - 1) < 0.001) {
    fs.renameSync(inputPath, outputPath);
    return outputPath;
  }
  const vf = `setpts=PTS/${s}`;
  const af = atempoChain(s);
  await ffmpeg('-y', '-i', inputPath,
               '-filter_complex', `[0:v]${vf}[v];[0:a]${af}[a]`,
               '-map', '[v]', '-map', '[a]',
               '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '192k',
               '-pix_fmt', 'yuv420p', outputPath);
  if (fs.existsSync(inputPath)) try { fs.unlinkSync(inputPath); } catch {}
  return outputPath;
}

/**
 * 混入背景音乐（BGM）
 * - 人声为主，BGM 压低（默认 0.25），用 amix 混合
 * - BGM 比视频短则循环（aloop），比视频长则截断（amix duration=first）
 * - 原视频若无人声轨也能正常加 BGM
 * @param {string} inputPath 已合成好的视频（含人声）
 * @param {string} bgmPath 背景音乐文件绝对路径
 * @param {string} outputPath 输出
 * @param {number} bgmVolume BGM 音量增益 0~1，默认 0.25
 */
async function mixBgm(inputPath: string, bgmPath: string, outputPath: string, bgmVolume = 0.25): Promise<void> {
  const vol = Math.max(0, Math.min(1, Number(bgmVolume) || 0.25));
  // [1:a] = BGM：无限循环后压低音量；[0:a] = 原视频人声
  // amix duration=first 以视频（第一路）时长为准，BGM 多余部分截断
  const filter =
    `[1:a]aloop=loop=-1:size=2e9,volume=${vol}[bg];` +
    `[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;
  await ffmpeg('-y', '-i', inputPath, '-i', bgmPath,
               '-filter_complex', filter,
               '-map', '0:v', '-map', '[aout]',
               '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', outputPath);
}

/**
 * 解析 BGM 选项为绝对路径。支持：
 * - 内置 BGM key（uploads/bgm/<key>.mp3）
 * - 用户上传的相对 url（/uploads/bgm/xxx）
 * 返回 null 表示无 BGM 或文件不存在（安全降级，不阻断合成）
 */
function resolveBgmPath(bgm: unknown): string | null {
  if (!bgm) return null;
  const bgmDir = path.resolve(config.get('uploadDir'), 'bgm');
  // 相对 url 形式
  if (typeof bgm === 'string' && bgm.startsWith('/uploads/')) {
    const abs = resolveUploadPath(bgm);
    return abs && fs.existsSync(abs) ? abs : null;
  }
  // 内置 key（防穿越：只取 basename）
  const safe = path.basename(String(bgm));
  for (const ext of ['', '.mp3', '.m4a', '.wav']) {
    const cand = path.join(bgmDir, safe + ext);
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

// ============================================================
// 主合成接口
// ============================================================

router.get('/export-location', (req, res) => {
  res.json({ code: 200, data: exportLocationInfo(), message: 'success' });
});

router.post('/compose', async (req, res) => {
  try {
    const parsed = ComposeRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ code: 400, data: null, message: '缺少或非法的 project_id' });
    }
    const { project_id, async: asyncMode } = parsed.data
    const options: ComposeOptions = { ...parsed.data.options }
    const project = getDb().prepare('SELECT * FROM projects WHERE id=?').get(project_id);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });

    try {
      preflightExternalExportDirectory(options);
    } catch (e: unknown) {
      return res.status(400).json({ code: 400, data: { export_location: exportLocationInfo() }, message: `导出目录不可用: ${errorMessage(e)}` });
    }

    const storyboards: StoryboardRow[] = getDb().prepare(
      `SELECT s.*, i.file_path as image_path 
       FROM storyboards s 
       LEFT JOIN images i ON s.selected_image_id = i.id 
       WHERE s.project_id=? ORDER BY s.sort_order ASC`
    ).all(project_id);

    // 把存储路径（相对/绝对都兼容）解析为运行时绝对路径，供 ffmpeg 使用
    for (const sb of storyboards) {
      if (sb.image_path) sb.image_path = resolveUploadPath(sb.image_path) || sb.image_path;
    }

    if (storyboards.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '没有分镜数据' });
    }

    // ① 导出兜底自动选图：凡是「生成过图但没选中（或选中的图文件已丢失）」的分镜，
    //    自动选用最新一张「文件确实存在」的图，避免用户明明生成了图、却报「没有可用的图片」。
    for (const sb of storyboards) {
      if (sb.image_path && fs.existsSync(sb.image_path)) continue;
      const imgs: Array<{ id: EntityId; file_path?: string }> = getDb().prepare(
        'SELECT id, file_path FROM images WHERE storyboard_id=? ORDER BY created_at DESC, id DESC'
      ).all(sb.id);
      const usable = imgs.find((im) => {
        const abs = resolveUploadPath(im.file_path);
        return abs && fs.existsSync(abs);
      });
      if (usable) {
        try { getDb().prepare('UPDATE storyboards SET selected_image_id=? WHERE id=?').run(usable.id, sb.id); } catch {}
        sb.selected_image_id = usable.id;
        sb.image_path = resolveUploadPath(usable.file_path) || usable.file_path;
      }
    }

    const valid = storyboards.filter((sb): sb is StoryboardRow & { image_path: string } => Boolean(sb.image_path && fs.existsSync(sb.image_path)));
    if (valid.length === 0) {
      // 明确告知是哪些分镜缺图，前端可据此引导一键补图
      const missing = storyboards.map((sb) => ({ id: sb.id, scene_number: sb.scene_number }));
      return res.status(400).json({
        code: 400,
        data: { missing_scenes: missing },
        message: `还没有可用的图片：共 ${missing.length} 个分镜缺少图片，请先生成或选择图片后再导出`,
      });
    }
    // 部分分镜缺图：可继续导出，但回传缺图清单供前端提示
    const missingScenes = storyboards
      .filter((sb) => !(sb.image_path && fs.existsSync(sb.image_path)))
      .map((sb) => ({ id: sb.id, scene_number: sb.scene_number }));

    // 异步模式：立即返回 task_id
    if (asyncMode) {
      let taskMeta: JsonObject = { project_id, total_segments: valid.length };
      try {
        const timeline = await timelineService.buildProjectTimeline(project_id, { storyboards: valid, videoSpeed: options.videoSpeed || options.video_speed || 1 });
        const chapters = buildLongVideoGroups(valid, timeline, Number(options.chapterDurationSec) || 300);
        taskMeta = {
          ...taskMeta,
          estimatedDuration: timeline.total_duration,
          originalDuration: timeline.original_total_duration,
          chapterCount: chapters.length,
          longVideoMode: options.longMode === true || timeline.original_total_duration >= 600 || valid.length >= 80,
        };
      } catch {}
      const task = taskManager.create('video', taskMeta);
      res.json({ code: 200, data: { task_id: task.id, missing_scenes: missingScenes }, message: missingScenes.length ? `已开始合成（${missingScenes.length} 个分镜无图将被跳过）` : '合成任务已提交' });
      // fire-and-forget：兜底 catch 防止 doVideoCompose 在 acquireComposeLock 之前抛错时
      // 变成 unhandledRejection（此时任务还没进 try，需手动置失败态）。
      doVideoCompose(task.id, project_id, valid, { ...options, taskId: task.id }).catch((e: unknown) => {
        console.error('doVideoCompose 启动失败:', e);
        try { taskManager.fail(task.id, e); } catch {}
      });
      return;
    }

    // 同步模式
    const result = await composeVideo(project_id, valid, options);
    res.json({ code: 200, data: { ...result, missing_scenes: missingScenes }, message: '合成成功' });
  } catch (err: unknown) {
    console.error('compose error:', err);
    res.status(500).json({ code: 500, data: null, message: `合成失败: ${errorMessage(err)}` });
  }
});

// ============================================================
// 快速预览：取前 N 镜用 ultrafast 真合成（含真实转场/字幕/运镜/配音），
// 所见即所得，不落成片库 exports。解决「预览是 canvas 模拟、导出才是 FFmpeg 真合成」的割裂。
// ============================================================
router.post('/preview-compose', async (req, res) => {
  try {
    const parsed = PreviewRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ code: 400, data: null, message: '缺少或非法的 project_id' });
    }
    const { project_id, limit } = parsed.data
    const options: ComposeOptions = { ...parsed.data.options }
    const project = getDb().prepare('SELECT * FROM projects WHERE id=?').get(project_id);
    if (!project) return res.status(404).json({ code: 404, data: null, message: '项目不存在' });

    const storyboards: StoryboardRow[] = getDb().prepare(
      `SELECT s.*, i.file_path as image_path
       FROM storyboards s
       LEFT JOIN images i ON s.selected_image_id = i.id
       WHERE s.project_id=? ORDER BY s.sort_order ASC`
    ).all(project_id);
    for (const sb of storyboards) {
      if (sb.image_path) sb.image_path = resolveUploadPath(sb.image_path) || sb.image_path;
    }
    // 兜底自动选图（与 compose 同逻辑：有图未选则取最新存在的图）
    for (const sb of storyboards) {
      if (sb.image_path && fs.existsSync(sb.image_path)) continue;
      const imgs: Array<{ id: EntityId; file_path?: string }> = getDb().prepare(
        'SELECT id, file_path FROM images WHERE storyboard_id=? ORDER BY created_at DESC, id DESC'
      ).all(sb.id);
      const usable = imgs.find((im) => { const abs = resolveUploadPath(im.file_path); return abs && fs.existsSync(abs); });
      if (usable) sb.image_path = resolveUploadPath(usable.file_path) || usable.file_path;
    }
    const allValid = storyboards.filter((sb): sb is StoryboardRow & { image_path: string } => Boolean(sb.image_path && fs.existsSync(sb.image_path)));
    if (allValid.length === 0) {
      return res.status(400).json({ code: 400, data: null, message: '还没有可用的图片，请先生成或选择图片后再预览' });
    }
    // 只取前 limit 镜（1~6），快速出片。传非法/0 值时回退默认 3。
    const ln = Number(limit);
    const n = Math.max(1, Math.min(6, Number.isFinite(ln) && ln >= 1 ? Math.floor(ln) : 3));
    const valid = allValid.slice(0, n);

    await acquireComposeLock();
    let result: ComposeResult;
    try {
      result = await composeVideo(project_id, valid, { ...options, preview: true });
    } finally {
      releaseComposeLock();
    }
    res.json({
      code: 200,
      data: { ...result, preview_scenes: valid.length, total_scenes: allValid.length },
      message: `已生成前 ${valid.length} 个分镜的快速预览`,
    });
  } catch (err: unknown) {
    console.error('preview-compose error:', err);
    res.status(500).json({ code: 500, data: null, message: `快速预览失败: ${errorMessage(err)}` });
  }
});

// 后台异步合成
async function doVideoCompose(
  taskId: string,
  projectId: EntityId,
  valid: StoryboardRow[],
  options: ComposeOptions,
): Promise<void> {
  // 先拿锁（在 try 之外）：保证 finally 的 releaseComposeLock 只在本次确实持锁时调用，
  // 否则若 acquireComposeLock 之前的任何调用抛错，finally 会误释放他人持有的锁 → 并发合成。
  taskManager.start(taskId, '等待合成锁…');
  await acquireComposeLock();
  try {
    taskManager.progress(taskId, 5, '初始化合成…');
    const result = await composeVideo(projectId, valid, options, (progress, message) => {
      taskManager.progress(taskId, progress, message);
    });
    taskManager.succeed(taskId, result, '视频合成完成');
  } catch (err) {
    console.error('async compose error:', err);
    taskManager.fail(taskId, err);
  } finally {
    releaseComposeLock();
  }
}

// 核心合成逻辑
/**
 * 解析 AI 视频轨（T2V）目标 provider/model。
 * options.videoProvider 形如 'cogvideo' 或 'cogvideo__cogvideox-flash'；
 * 未显式传入则回退到模型路由 stageModels.video（provider='static' 表示不走 T2V）。
 * 预览模式强制返回 null（静图轨）：T2V 真生成单镜要数分钟，与「快速预览」相悖。
 * @returns {{provider:string, model:string|null}|null}
 */
function resolveT2vTarget(options: ComposeOptions, isPreview: boolean): T2vTarget | null {
  if (isPreview) return null;
  let videoSel = options.videoProvider;
  let videoSelModel = options.videoModel;
  if (!videoSel) {
    try {
      const sv = config.get('stageModels.video') || {};
      if (sv.provider && sv.provider !== 'static') { videoSel = sv.provider; videoSelModel = sv.model; }
    } catch { /* 无配置则静图轨 */ }
  }
  if (videoSel && videoSel !== 'static') {
    const raw = String(videoSel);
    const [prov = raw, mdl] = raw.includes('__') ? raw.split('__') : [raw, videoSelModel];
    return { provider: prov, model: mdl || null };
  }
  return null;
}

/**
 * 生成所有分镜的分段视频（核心循环）。
 * 逐个分镜：① 解析配音路径（跳过标记「不读」的分镜）
 *           ② 尝试 T2V（AI 视频生成）→ 失败自动降级静图运镜
 *           ③ 收集 segments + transitions
 * @returns {{segments: string[], transitions: string[]}}
 */
async function generateSegments(
  projectId: EntityId,
  valid: StoryboardRow[],
  t2vTarget: T2vTarget | null,
  options: ComposeOptions,
  resolution: Resolution,
  tempDir: string,
  timestamp: string | number,
  onProgress: ProgressCallback,
): Promise<SegmentResult> {
  const segments: string[] = [];
  const transitions: string[] = [];
  const t2v = t2vTarget ? require('../services/t2vProvider') : null;
  const timelineMap = timelineService.sceneMap(options.timeline);

  for (let i = 0; i < valid.length; i++) {
    const sb = valid[i];
    if (!sb) continue
    const sceneTimeline = timelineMap.get(Number(sb.id));
    const targetDuration = sceneTimeline ? sceneTimeline.original_duration_ms / 1000 : (sb.duration || 5);
    const segPath = path.join(tempDir, `seg_${projectId}_${i}_${timestamp}.mp4`);

    let audioPath: string | null = null;
    // ① 旁白/标记「不读」的分镜跳过配音（即使存在旧的 audio_url 也不混入）
    if (sb.audio_url && !sb.no_voice) {
      const audioRel = sb.audio_url.replace(/^\/uploads/, '');
      const candidate = path.resolve(config.get('uploadDir'), '.' + audioRel);
      if (fs.existsSync(candidate)) audioPath = candidate;
    }

    onProgress(
      Math.round(10 + (50 * i) / valid.length),
      `${t2vTarget ? 'AI 生成视频' : '合成'}第 ${i + 1}/${valid.length} 个分镜…`
    );

    let segDone = false;
    const aiVideoMode = options.aiVideoMode || options.ai_video_mode || (options.longMode ? 'keyframes' : 'all');
    const shouldUseAiVideo = t2vTarget && (
      aiVideoMode === 'all' ||
      (aiVideoMode === 'keyframes' && (i === 0 || i % Math.max(1, Number(options.keyframeEvery) || 8) === 0))
    );
    if (shouldUseAiVideo) {
      // —— AI 视频轨：T2V 真生成 → 规整成统一 segment ——
      let generationTask: GenerationTaskRef | null = null;
      try {
        const prompt = (sb.prompt || sb.description || sb.dialog || '').trim() || '一个电影感的画面';
        const seconds = Math.min(10, Math.max(4, Math.round(sb.duration || 5)));
        // i2v（图生视频）：默认用分镜已选定的图作首帧引导，让 AI 视频延续既有画风/构图，
        // 保持与静图轨一致的视觉风格（画风一致性核心）。options.i2v===false 时退回纯文生视频。
        let imageUrl: string | undefined;
        let mediaSnapshot: unknown[] = [];
        if (options.i2v !== false && sb.image_path && fs.existsSync(sb.image_path)) {
          const resolvedInput = await mediaAdapter.resolveForModel({
            provider: t2vTarget.provider,
            model: t2vTarget.model,
            reference: {
              kind: 'project_media',
              media_id: sb.selected_image_id || null,
              url: toRelative(sb.image_path),
            },
          });
          imageUrl = resolvedInput.transient_value;
          mediaSnapshot = resolvedInput.snapshot ? [resolvedInput.snapshot] : [];
        }
        const idempotencyKey = `video-generation:${crypto.createHash('sha256').update(JSON.stringify({
          projectId,
          storyboardId: sb.id,
          provider: t2vTarget.provider,
          model: t2vTarget.model,
          prompt,
          ratio: options.ratio || '16:9',
          seconds,
          selectedImageId: sb.selected_image_id || null,
        })).digest('hex')}`;
        const previous = taskManager.findByIdempotency(idempotencyKey, 'video-generation');
        let gen = null;

        // 已成功的生成结果按稳定幂等键复用；刷新、重试或父任务恢复都不会再次计费。
        if (previous?.status === 'success' && previous.result?.file_url) {
          const localPath = resolveUploadPath(previous.result.file_url);
          if (localPath && fs.existsSync(localPath)) {
            gen = { ...previous.result, local_path: localPath };
          }
        }
        if (!gen && previous && ['pending', 'waiting', 'running', 'composing'].includes(previous.status)) {
          throw new Error('相同镜头的 Provider 任务仍在运行，已阻止重复提交');
        }

        if (!gen) {
          const createdTask: GenerationTaskRef = taskManager.create('video-generation', {
            project_id: projectId,
            storyboard_id: sb.id,
            provider: t2vTarget.provider,
            model: t2vTarget.model,
            parent_task_id: options.taskId || null,
            attempt: Math.max(1, Number(previous?.attempt) || 0) + (previous ? 1 : 0),
            retry_of: previous?.id || null,
            idempotency_key: idempotencyKey,
            input_snapshot: { prompt, ratio: options.ratio || '16:9', seconds },
            media_snapshot: mediaSnapshot,
            timeout_at: Date.now() + 6 * 60 * 1000,
            recovery: { kind: 'provider-reconcile', mode: 'manual-reconcile' },
          });
          generationTask = createdTask
          taskManager.start(createdTask.id, '已持久化生成意图，正在提交 Provider…');
          gen = await t2v.generate({
            provider: t2vTarget.provider, model: t2vTarget.model,
            prompt, ratio: options.ratio || '16:9', seconds, imageUrl,
            onSubmitted: (providerTaskId: string) => {
              taskManager.update(createdTask.id, {
                provider_task_id: providerTaskId,
                message: 'Provider 已受理，正在等待生成结果',
              });
            },
          });
        }
        if (gen?.local_path && fs.existsSync(gen.local_path)) {
          await withFfmpegTimeout(timeoutForSeconds(targetDuration, 'segment'), () => videoToSegment(gen.local_path, audioPath, segPath, {
            fps: options.fps || 30, resolution, duration: targetDuration,
          }));
          // v1.6.8：t2v 生成的原始视频持久化到 uploads/videos/，路径存进分镜表，让预览页能播放真实动效。
          // 不再 unlinkSync 即删，而是移动到持久化目录（按分镜 id 命名避免冲突）。
          try {
            const db = getDb();
            // 先删除该分镜上一次合成留下的旧视频文件，避免重复合成堆积孤儿文件
            const prev = db.prepare('SELECT video_path FROM storyboards WHERE id = ?').get(sb.id);
            if (prev?.video_path) {
              try {
                const prevAbs = path.resolve(config.get('uploadDir'), '.' + prev.video_path.replace(/^\/uploads/, ''));
                if (fs.existsSync(prevAbs)) fs.unlinkSync(prevAbs);
              } catch {}
            }
            const videosDir = path.resolve(config.get('uploadDir'), 'videos');
            if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
            const persistName = `sb_${sb.id}_${Date.now()}.mp4`;
            const persistPath = path.join(videosDir, persistName);
            fs.renameSync(gen.local_path, persistPath);
            const videoUrl = `/uploads/videos/${persistName}`;
            db.prepare('UPDATE storyboards SET video_path = ? WHERE id = ?').run(videoUrl, sb.id);
            try { assetNaming.normalizeStoryboardVideo(sb.id); } catch (e: unknown) { console.warn('[assetNaming] 分镜视频命名整理失败:', errorMessage(e)); }
            if (generationTask) {
              taskManager.succeed(generationTask.id, {
                submit_id: gen.submit_id || generationTask.provider_task_id,
                file_url: videoUrl,
                storyboard_id: sb.id,
              }, '镜头视频生成并持久化完成');
            }
          } catch (e: unknown) {
            console.error(`[compose] 分镜 ${sb.id} 视频持久化失败:`, errorMessage(e));
            try { fs.unlinkSync(gen.local_path); } catch {}
            if (generationTask) taskManager.fail(generationTask.id, e);
          }
          segDone = true;
        } else if (generationTask) {
          taskManager.fail(generationTask.id, Object.assign(new Error('Provider 返回结果缺少可用的本地视频'), { code: 'INVALID_RESPONSE' }));
        }
      } catch (e: unknown) {
        if (generationTask && !['failed', 'success'].includes(generationTask.status)) taskManager.fail(generationTask.id, e);
        console.error(`[compose] 分镜 ${sb.id} AI 视频生成失败，降级静图:`, errorMessage(e));
      }
    }

    if (!segDone) {
      // —— 静图运镜轨（默认 / T2V 降级兜底）——
      const imagePath = sb.image_path
      if (!imagePath) throw new Error(`分镜 ${sb.id} 缺少可用图片路径`)
      await withFfmpegTimeout(timeoutForSeconds(targetDuration, 'segment'), () => imageAudioToSegment(imagePath, audioPath, targetDuration, segPath, {
        fps: options.fps || 30,
        resolution,
        motion: sb.motion || options.motion,
      }));
    }
    segments.push(segPath);
    if (i > 0) transitions.push(sb.transition || 'none');
  }

  return { segments, transitions };
}

function hasSubtitleText(storyboards: StoryboardRow[] = []): boolean {
  return storyboards.some(sb => String(sb.subtitle_text || sb.dialog || '').trim());
}

function subtitleStyleFrom(valid: StoryboardRow[], options: ComposeOptions = {}): JsonObject {
  if (options.subtitleStyle && typeof options.subtitleStyle === 'object') return options.subtitleStyle;
  try { return JSON.parse(valid?.[0]?.subtitle_style || '{}') || {}; } catch { return {}; }
}

function moveVideoOutput(inputPath: string, outputPath: string): void {
  if (path.resolve(inputPath) === path.resolve(outputPath)) return;
  if (fs.existsSync(outputPath)) try { fs.unlinkSync(outputPath); } catch {}
  fs.renameSync(inputPath, outputPath);
}

function subtitleMetadata({
  hasSubtitle = false,
  burnSubtitle = false,
  srtUrl = null,
  vttUrl = null,
  status = null,
  error = null,
}: {
  hasSubtitle?: boolean
  burnSubtitle?: boolean
  srtUrl?: string | null
  vttUrl?: string | null
  status?: string | null
  error?: string | null
} = {}): SubtitleMetadata {
  return {
    has_subtitle: hasSubtitle ? 1 : 0,
    burn_subtitle: burnSubtitle ? 1 : 0,
    srt_url: srtUrl || null,
    vtt_url: vttUrl || null,
    subtitle_status: status || (hasSubtitle ? (burnSubtitle ? 'burned' : 'soft') : 'no_text'),
    subtitle_error: error || null,
  };
}

function generateSubtitleFiles(valid: StoryboardRow[], projectId: EntityId, timeline: ProjectTimeline): {
  srtPath: string; srtUrl: string; vttPath: string; vttUrl: string
} {
  const srtGen = subtitleService.generateSrt(valid, projectId, { timeline });
  const vttGen = subtitleService.generateVtt(valid, projectId, { timeline });
  return {
    srtPath: srtGen.filePath,
    srtUrl: srtGen.fileUrl,
    vttPath: vttGen.filePath,
    vttUrl: vttGen.fileUrl,
  };
}

async function burnSubtitleTrack(
  valid: StoryboardRow[], projectId: EntityId, inputPath: string, outputPath: string,
  options: ComposeOptions, timeline: ProjectTimeline,
): Promise<{ srtPath: string; srtUrl: string; vttPath: string; vttUrl: string }> {
  const style = subtitleStyleFrom(valid, options);
  const files = generateSubtitleFiles(valid, projectId, timeline);
  if (options.karaoke) {
    const assGen = subtitleService.generateKaraokeAss(valid, projectId, { ...style, timeline });
    await burnAss(inputPath, outputPath, assGen.filePath);
  } else if (options.subtitleEffect && options.subtitleEffect !== 'none') {
    const fxGen = subtitleService.generateEffectAss(valid, projectId, options.subtitleEffect, { ...style, timeline });
    await burnAss(inputPath, outputPath, fxGen.filePath);
  } else {
    await burnSubtitles(inputPath, outputPath, files.srtPath, style);
  }
  if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  return files;
}

/**
 * 应用字幕到成片。
 * 硬字幕开启时采用“失败即失败”策略，避免生成无字幕 success 成片。
 * 软字幕模式下输出 MP4，并提供 SRT/WebVTT 给成片库播放器挂载。
 */
async function applySubtitles(
  valid: StoryboardRow[], projectId: EntityId, stageVideo: string, finalOutput: string,
  options: ComposeOptions, onProgress: ProgressCallback, timeline: ProjectTimeline,
): Promise<SubtitleMetadata> {
  const hasSubtitle = hasSubtitleText(valid);
  const burnSubtitle = hasSubtitle && options.burnSubtitle !== false;

  if (!hasSubtitle) {
    moveVideoOutput(stageVideo, finalOutput);
    return subtitleMetadata({ hasSubtitle: false, burnSubtitle: false, status: 'no_text' });
  }

  try {
    if (burnSubtitle) {
      onProgress(85, options.longMode ? '烧入章节字幕…' : '烧入字幕…');
      const burnedFiles = await burnSubtitleTrack(valid, projectId, stageVideo, finalOutput, options, timeline);
      return subtitleMetadata({
        hasSubtitle: true,
        burnSubtitle: true,
        srtUrl: burnedFiles.srtUrl,
        vttUrl: burnedFiles.vttUrl,
        status: 'burned',
      });
    }

    const files = generateSubtitleFiles(valid, projectId, timeline);
    moveVideoOutput(stageVideo, finalOutput);
    return subtitleMetadata({
      hasSubtitle: true,
      burnSubtitle: false,
      srtUrl: files.srtUrl,
      vttUrl: files.vttUrl,
      status: 'soft',
    });
  } catch (e: unknown) {
    const meta = subtitleMetadata({
      hasSubtitle: true,
      burnSubtitle,
      status: 'error',
      error: errorMessage(e),
    });
    if (burnSubtitle) {
      const err = Object.assign(new Error(`字幕烧录失败: ${errorMessage(e)}`), { subtitleMetadata: meta });
      throw err;
    }
    console.error('[compose] 软字幕生成失败，输出无外挂字幕版本:', errorMessage(e));
    moveVideoOutput(stageVideo, finalOutput);
    return meta;
  }
}

/**
 * 混入背景音乐（可选）。
 * 失败不中断：降级返回无 BGM 版本。
 * @returns {string} 返回下一阶段输入视频路径（混音成功 = bgmOut，失败 = 原 videoIn）
 */
async function applyBgm(
  videoIn: string, bgmPath: string | null, projectId: EntityId, tempDir: string,
  timestamp: string | number, options: ComposeOptions, onProgress: ProgressCallback,
): Promise<string> {
  if (!bgmPath) return videoIn;

  onProgress(75, '混入背景音乐…');
  const bgmOut = path.join(tempDir, `bgm_${projectId}_${timestamp}.mp4`);
  try {
    await mixBgm(videoIn, bgmPath, bgmOut, options.bgmVolume);
    if (fs.existsSync(videoIn)) fs.unlinkSync(videoIn);
    return bgmOut;
  } catch (e: unknown) {
    // BGM 混音失败不阻断主流程，退回无 BGM 版本
    console.error('[compose] BGM 混音失败，跳过:', errorMessage(e));
    if (fs.existsSync(bgmOut)) try { fs.unlinkSync(bgmOut); } catch {}
    return videoIn;
  }
}

function timelineDurationForStoryboard(timeline: ProjectTimeline, storyboardId: EntityId, fallback = 5): number {
  const scene = (timeline?.scenes || []).find((s) => Number(s.storyboard_id) === Number(storyboardId));
  return scene ? scene.original_duration_ms / 1000 : (Number(fallback) || 5);
}

function buildLongVideoGroups(valid: StoryboardRow[], timeline: ProjectTimeline, targetSec = 300): LongVideoGroup[] {
  const hasChapter = valid.some((sb) => Number(sb.chapter_index || 0) > 0);
  if (hasChapter) {
    const map = new Map<number, StoryboardRow[]>();
    for (const sb of valid) {
      const idx = Number(sb.chapter_index || 1) || 1;
      if (!map.has(idx)) map.set(idx, []);
      map.get(idx)?.push(sb);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([chapterIndex, storyboards]) => ({
        chapterIndex,
        title: storyboards[0]?.chapter_title || `第 ${chapterIndex} 章`,
        storyboards,
      }));
  }

  const groups: LongVideoGroup[] = [];
  let current: StoryboardRow[] = [];
  let seconds = 0;
  for (const sb of valid) {
    const dur = timelineDurationForStoryboard(timeline, sb.id, sb.duration);
    if (current.length && seconds + dur > targetSec) {
      groups.push({ chapterIndex: groups.length + 1, title: `第 ${groups.length + 1} 章`, storyboards: current });
      current = [];
      seconds = 0;
    }
    current.push(sb);
    seconds += dur;
  }
  if (current.length) groups.push({ chapterIndex: groups.length + 1, title: `第 ${groups.length + 1} 章`, storyboards: current });
  return groups;
}

function buildChapterTimeline(timeline: ProjectTimeline, storyboards: StoryboardRow[] = []): ProjectTimeline {
  const sourceMap = timelineService.sceneMap(timeline);
  let cursorMs = 0;
  const scenes: TimelineScene[] = [];
  const subtitles: JsonObject[] = [];
  for (const sb of storyboards) {
    const source = sourceMap.get(Number(sb.id));
    const durationMs = Math.max(1, Math.round(
      source?.original_duration_ms || (Number(sb.duration || 5) * 1000)
    ));
    const subtitleText = String(sb.subtitle_text || sb.dialog || '').trim();
    const scene = {
      ...(source || {}),
      id: sb.id,
      storyboard_id: sb.id,
      scene_number: sb.scene_number,
      sort_order: sb.sort_order,
      start_ms: cursorMs,
      end_ms: cursorMs + durationMs,
      duration_ms: durationMs,
      scaled_duration_ms: durationMs,
      original_start_ms: cursorMs,
      original_end_ms: cursorMs + durationMs,
      original_duration_ms: durationMs,
      effective_duration_ms: durationMs,
      has_dialog: !!String(sb.dialog || '').trim(),
      has_subtitle: !!String(sb.subtitle_text || '').trim(),
      subtitle_text: subtitleText,
      subtitle_source: String(sb.subtitle_text || '').trim() ? 'subtitle_text' : (subtitleText ? 'dialog' : 'empty'),
    };
    scenes.push(scene);
    if (subtitleText) {
      subtitles.push({
        storyboard_id: sb.id,
        scene_number: sb.scene_number,
        start_ms: scene.start_ms,
        end_ms: scene.end_ms,
        duration_ms: scene.duration_ms,
        text: subtitleText,
        source: scene.subtitle_source,
      });
    }
    cursorMs += durationMs;
  }
  return {
    project_id: timeline?.project_id,
    video_speed: 1,
    scene_count: scenes.length,
    total_duration_ms: cursorMs,
    original_total_duration_ms: cursorMs,
    total_duration: Math.round((cursorMs / 1000) * 100) / 100,
    original_total_duration: Math.round((cursorMs / 1000) * 100) / 100,
    subtitles,
    scenes,
  };
}

async function concatCopyVideos(files: string[], outputPath: string, totalDurationSec: number): Promise<string> {
  if (files.length === 0) throw new Error('没有可拼接的视频片段');
  if (files.length === 1) {
    const onlyFile = files[0]
    if (!onlyFile) throw new Error('没有可拼接的视频片段')
    fs.copyFileSync(onlyFile, outputPath);
    return outputPath;
  }
  const listFile = path.join(path.dirname(outputPath), `_chapters_${Date.now()}.txt`);
  fs.writeFileSync(listFile, files.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
  try {
    await withFfmpegTimeout(timeoutForSeconds(totalDurationSec, 'final'), () => ffmpeg('-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath));
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
  return outputPath;
}

async function composeLongVideo(
  projectId: EntityId,
  valid: StoryboardRow[],
  options: ComposeOptions = {},
  onProgress: ProgressCallback = () => {},
): Promise<ComposeResult> {
  const outputDir = path.resolve(config.get('uploadDir'), 'videos');
  const tempDir = path.resolve(config.get('uploadDir'), 'temp');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const timestamp = Date.now();
  const finalOutput = path.join(outputDir, `project_${projectId}_${timestamp}.mp4`);
  const tempVideo = path.join(tempDir, `long_${projectId}_${timestamp}.mp4`);
  const speedVideo = path.join(tempDir, `long_speed_${projectId}_${timestamp}.mp4`);
  const originalTimeline: ProjectTimeline = await timelineService.buildProjectTimeline(projectId, { storyboards: valid, videoSpeed: 1 });
  const videoSpeed = clampVideoSpeed(options.videoSpeed || options.video_speed || 1);
  const outputTimeline: ProjectTimeline = await timelineService.buildProjectTimeline(projectId, { storyboards: valid, videoSpeed });
  const longOptions = {
    ...options,
    longMode: true,
    videoSpeed,
    timeline: originalTimeline,
    burnSubtitle: options.burnSubtitle !== false,
    transitionDuration: 0,
  };
  const resolution = resolveResolution(longOptions);
  const t2vTarget = resolveT2vTarget(longOptions, false);
  const groups = buildLongVideoGroups(valid, originalTimeline, Number(options.chapterDurationSec) || 300);
  const chapterVideos: string[] = [];
  setEncodePreset(null);

  try {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (!group) continue
      onProgress(Math.round(8 + (52 * i) / groups.length), `合成章节 ${i + 1}/${groups.length}：${group.title}…`);
      const chapterStamp = `${timestamp}_${i}`;
      const result = await generateSegments(projectId, group.storyboards, t2vTarget, longOptions, resolution, tempDir, chapterStamp, (p, msg) => {
        const local = 8 + (52 * (i + (p || 0) / 100)) / groups.length;
        onProgress(Math.min(64, Math.round(local)), msg);
      });
      const chapterPath = path.join(tempDir, `chapter_${projectId}_${i}_${timestamp}.mp4`);
      const chapterDuration = group.storyboards.reduce((sum, sb) => sum + timelineDurationForStoryboard(originalTimeline, sb.id, sb.duration), 0);
      await withFfmpegTimeout(timeoutForSeconds(chapterDuration, 'chapter'), () => concatWithTransitions(
        result.segments,
        result.transitions.map(() => 'none'),
        chapterPath,
        { transitionDuration: 0 }
      ));
      cleanupSegments(result.segments);
      let chapterOutputPath = chapterPath;
      if (longOptions.burnSubtitle !== false && hasSubtitleText(group.storyboards)) {
        chapterOutputPath = path.join(tempDir, `chapter_sub_${projectId}_${i}_${timestamp}.mp4`);
        const chapterTimeline = buildChapterTimeline(originalTimeline, group.storyboards);
        try {
          await applySubtitles(
            group.storyboards,
            projectId,
            chapterPath,
            chapterOutputPath,
            longOptions,
            (p, msg) => onProgress(Math.min(67, Math.round(60 + (7 * (i + 1)) / groups.length)), msg),
            chapterTimeline
          );
        } catch (e) {
          cleanupSegments([chapterPath, chapterOutputPath]);
          throw e;
        }
      }
      chapterVideos.push(chapterOutputPath);
      try {
        const chapterRow = getDb().prepare('SELECT id FROM chapters WHERE project_id = ? AND chapter_index = ?').get(projectId, group.chapterIndex);
        if (chapterRow) {
          getDb().prepare('UPDATE chapters SET status = ?, video_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('composed', `/uploads/temp/${path.basename(chapterOutputPath)}`, chapterRow.id);
        }
      } catch {}
    }

    onProgress(68, `拼接 ${chapterVideos.length} 个章节视频…`);
    await concatCopyVideos(chapterVideos, tempVideo, originalTimeline.original_total_duration);

    const bgmPath = resolveBgmPath(longOptions.bgm);
    const bgmStageVideo = await applyBgm(tempVideo, bgmPath, projectId, tempDir, timestamp, longOptions, onProgress);
    onProgress(videoSpeed === 1 ? 80 : 82, videoSpeed === 1 ? '生成字幕文件…' : `应用视频倍速 ${videoSpeed}x…`);
    const stageVideo = await applyVideoSpeed(bgmStageVideo, speedVideo, videoSpeed);
    const hasSubtitle = valid.some(sb => (sb.subtitle_text && sb.subtitle_text.trim()) || (sb.dialog && sb.dialog.trim()));
    let subtitleMeta;
    if (longOptions.burnSubtitle !== false && hasSubtitle) {
      onProgress(88, '生成成片字幕索引…');
      const files = generateSubtitleFiles(valid, projectId, outputTimeline);
      moveVideoOutput(stageVideo, finalOutput);
      subtitleMeta = subtitleMetadata({
        hasSubtitle: true,
        burnSubtitle: true,
        srtUrl: files.srtUrl,
        vttUrl: files.vttUrl,
        status: 'burned',
      });
    } else {
      subtitleMeta = await applySubtitles(valid, projectId, stageVideo, finalOutput, longOptions, onProgress, outputTimeline);
    }

    let deliverOutput = finalOutput;
    const targetFmt = resolveOutputFormat(longOptions.format || 'mp4');
    if (targetFmt.ext !== '.mp4') {
      try {
        onProgress(96, `转换为 ${targetFmt.container.toUpperCase()} 格式…`);
        const converted = finalOutput.replace(/\.mp4$/i, targetFmt.ext);
        await withFfmpegTimeout(timeoutForSeconds(outputTimeline.total_duration, 'final'), () => transcodeToFormat(finalOutput, converted, longOptions));
        if (fs.existsSync(converted)) {
          try { fs.unlinkSync(finalOutput); } catch {}
          deliverOutput = converted;
        }
      } catch (e: unknown) {
        console.error(`[compose-long] 格式转换失败，退回 mp4:`, errorMessage(e));
      }
    }

    onProgress(95, '清理长视频临时文件…');
    cleanupSegments(chapterVideos);
    const relPath = `/uploads/videos/${path.basename(deliverOutput)}`;
    const exportRes = getDb().prepare(
      `INSERT INTO exports
       (project_id, file_path, file_url, status, duration, chapter_count, long_video_mode,
        has_subtitle, burn_subtitle, srt_url, vtt_url, subtitle_status, subtitle_error, video_speed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      projectId, relPath, relPath, 'success', outputTimeline.total_duration, groups.length, 1,
      subtitleMeta.has_subtitle, subtitleMeta.burn_subtitle, subtitleMeta.srt_url, subtitleMeta.vtt_url,
      subtitleMeta.subtitle_status, subtitleMeta.subtitle_error, videoSpeed
    );
    const normalizedExportUrl = (() => {
      try { return assetNaming.normalizeExport(exportRes.lastInsertRowid); } catch (e: unknown) {
        console.warn('[assetNaming] 长视频命名整理失败:', errorMessage(e));
        return relPath;
      }
    })();
    const finalUrl = normalizedExportUrl || relPath;
    const exportCopy = copyExportToExternal({
      exportId: exportRes.lastInsertRowid,
      fileUrl: finalUrl,
      options: longOptions,
    });
    return {
      export_id: exportRes.lastInsertRowid,
      file_path: finalUrl,
      file_url: finalUrl,
      ...exportCopy,
      segments_count: valid.length,
      chapter_count: groups.length,
      long_video_mode: true,
      ...subtitleMeta,
      video_speed: videoSpeed,
      duration: outputTimeline.total_duration,
      original_duration: outputTimeline.original_total_duration,
    };
  } catch (err) {
    cleanupSegments(chapterVideos);
    if (fs.existsSync(tempVideo)) try { fs.unlinkSync(tempVideo); } catch {}
    if (fs.existsSync(speedVideo)) try { fs.unlinkSync(speedVideo); } catch {}
    throw err;
  } finally {
    setEncodePreset(null);
  }
}

async function composeVideo(
  projectId: EntityId,
  valid: StoryboardRow[],
  options: ComposeOptions = {},
  onProgress: ProgressCallback = () => {},
): Promise<ComposeResult> {
  // 预览模式：用 ultrafast 编码加速，输出到独立 preview 目录，不落成片库 exports。
  const isPreview = options.preview === true;
  const outputDir = isPreview
    ? path.resolve(config.get('uploadDir'), 'videos', 'preview')
    : path.resolve(config.get('uploadDir'), 'videos');
  const tempDir = path.resolve(config.get('uploadDir'), 'temp');
  if (isPreview && !fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = Date.now();
  const finalOutput = path.join(outputDir, `${isPreview ? 'preview' : 'project'}_${projectId}_${timestamp}.mp4`);
  const tempVideo = path.join(tempDir, `temp_${projectId}_${timestamp}.mp4`);
  const speedVideo = path.join(tempDir, `speed_${projectId}_${timestamp}.mp4`);
  setEncodePreset(isPreview ? 'ultrafast' : null);
  const videoSpeed = clampVideoSpeed(options.videoSpeed || options.video_speed || 1);
  const originalTimeline: ProjectTimeline = await timelineService.buildProjectTimeline(projectId, { storyboards: valid, videoSpeed: 1 });
  const outputTimeline: ProjectTimeline = await timelineService.buildProjectTimeline(projectId, { storyboards: valid, videoSpeed });
  options.timeline = originalTimeline;
  options.videoSpeed = videoSpeed;

  const shouldUseLongPipeline = !isPreview && (
    options.longMode === true ||
    options.long_video_mode === true ||
    originalTimeline.original_total_duration >= 600 ||
    valid.length >= 80
  );
  if (shouldUseLongPipeline) {
    return composeLongVideo(projectId, valid, options, onProgress);
  }

  // 解析输出分辨率（v1.7：支持 resolution 档位 720p/1080p/2k/4k + ratio 比例；
  // 旧调用只传 ratio 时行为不变）。传整个 options，内部自动识别档位。
  const resolution = resolveResolution(options);

  // AI 视频轨：设置则逐分镜走 T2V 真生成；任一分镜失败自动降级到静图+运镜，不中断整条合成。
  const t2vTarget = resolveT2vTarget(options, isPreview);

  let segments: string[] = [];
  try {
    // 1. 生成每个分镜的分段视频（T2V 真生成 / 静图运镜，自动降级）
    const result = await generateSegments(
      projectId, valid, t2vTarget, options, resolution, tempDir, timestamp, onProgress
    );
    segments = result.segments;
    const transitions = result.transitions;

    // 2. xfade 拼接
    onProgress(65, '拼接视频与转场…');
    await concatWithTransitions(segments, transitions, tempVideo, {
      transitionDuration: options.transitionDuration || 0.5,
    });

    // 2.5 混入背景音乐（可选，失败降级无 BGM 版本）
    const bgmPath = resolveBgmPath(options.bgm);
    const bgmStageVideo = await applyBgm(tempVideo, bgmPath, projectId, tempDir, timestamp, options, onProgress);

    // 2.8 全片倍速：字幕烧录前完成音视频同步变速；字幕随后按缩放后的时间轴生成。
    onProgress(videoSpeed === 1 ? 80 : 82, videoSpeed === 1 ? '准备字幕…' : `应用视频倍速 ${videoSpeed}x…`);
    const stageVideo = await applyVideoSpeed(bgmStageVideo, speedVideo, videoSpeed);

    // 3. 字幕（生成 SRT + 可选烧录，失败降级无字幕版本）
    // 注：全程内部保持 h264/mp4 工作流（finalOutput 为 .mp4），便于零破坏地复用既有
    //    拼接/字幕/混音链路。目标格式（mov/webm）只在第 3.5 步最后统一转换。
    const subtitleMeta = await applySubtitles(valid, projectId, stageVideo, finalOutput, options, onProgress, outputTimeline);

    // 3.5 最终格式转换（v1.7 导出设置）：预览模式跳过；mp4 原样；mov/webm 转换后替换。
    let deliverOutput = finalOutput;
    const targetFmt = resolveOutputFormat(options.format || 'mp4');
    if (!isPreview && targetFmt.ext !== '.mp4') {
      try {
        onProgress(96, `转换为 ${targetFmt.container.toUpperCase()} 格式…`);
        const converted = finalOutput.replace(/\.mp4$/i, targetFmt.ext);
        await transcodeToFormat(finalOutput, converted, options);
        if (fs.existsSync(converted)) {
          try { fs.unlinkSync(finalOutput); } catch {}
          deliverOutput = converted;
        }
      } catch (e: unknown) {
        // 转换失败不阻断：退回 mp4 成片，保证用户至少拿到一个可用文件
        console.error(`[compose] 格式转换为 ${targetFmt.ext} 失败，退回 mp4:`, errorMessage(e));
      }
    }

    // 4. 清理临时文件
    onProgress(95, '清理临时文件…');
    cleanupSegments(segments);

    const relPath = `/uploads/videos/${isPreview ? 'preview/' : ''}${path.basename(deliverOutput)}`;

    // 预览模式：不落成片库 exports，直接返回临时预览文件 url（前端就地播放，不进「我的作品」）。
    if (isPreview) {
      setEncodePreset(null);
      return {
        preview: true,
        file_path: relPath,
        file_url: relPath,
        segments_count: segments.length,
        ...subtitleMeta,
        video_speed: videoSpeed,
        duration: outputTimeline.total_duration,
        original_duration: outputTimeline.original_total_duration,
      };
    }

    // 5. 落库（file_path 存相对路径，可移植）
    const exportRes = getDb().prepare(
      `INSERT INTO exports
       (project_id, file_path, file_url, status, duration,
        has_subtitle, burn_subtitle, srt_url, vtt_url, subtitle_status, subtitle_error, video_speed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      projectId, relPath, relPath, 'success', outputTimeline.total_duration,
      subtitleMeta.has_subtitle, subtitleMeta.burn_subtitle, subtitleMeta.srt_url, subtitleMeta.vtt_url,
      subtitleMeta.subtitle_status, subtitleMeta.subtitle_error, videoSpeed
    );
    const normalizedExportUrl = (() => {
      try { return assetNaming.normalizeExport(exportRes.lastInsertRowid); } catch (e: unknown) {
        console.warn('[assetNaming] 成片命名整理失败:', errorMessage(e));
        return relPath;
      }
    })();
    const finalUrl = normalizedExportUrl || relPath;
    const exportCopy = copyExportToExternal({
      exportId: exportRes.lastInsertRowid,
      fileUrl: finalUrl,
      options,
    });

    return {
      export_id: exportRes.lastInsertRowid,
      file_path: finalUrl,
      file_url: finalUrl,
      ...exportCopy,
      segments_count: segments.length,
      ...subtitleMeta,
      video_speed: videoSpeed,
      duration: outputTimeline.total_duration,
      original_duration: outputTimeline.original_total_duration,
    };
  } catch (err) {
    // 合成失败时也要清理临时文件，防止磁盘泄漏
    setEncodePreset(null);
    cleanupSegments(segments);
    if (fs.existsSync(tempVideo)) try { fs.unlinkSync(tempVideo); } catch {}
    if (fs.existsSync(speedVideo)) try { fs.unlinkSync(speedVideo); } catch {}
    throw err;
  }
}

/**
 * 清理临时分段文件
 */
function cleanupSegments(segments: string[]): void {
  for (const seg of segments) {
    if (fs.existsSync(seg)) try { fs.unlinkSync(seg); } catch {}
  }
}

/**
 * 高层封装：根据 project_id 查分镜→解析图片路径→过滤有效→加锁→合成→释放锁。
 * 供 compose 路由和「一键成片」流水线复用，避免重复构建逻辑。
 */
async function composeProjectVideo(
  projectId: EntityId,
  options: ComposeOptions = {},
  onProgress: ProgressCallback = () => {},
): Promise<ComposeResult> {
  const storyboards: StoryboardRow[] = getDb().prepare(
    `SELECT s.*, i.file_path as image_path
     FROM storyboards s
     LEFT JOIN images i ON s.selected_image_id = i.id
     WHERE s.project_id=? ORDER BY s.sort_order ASC`
  ).all(projectId);

  for (const sb of storyboards) {
    if (sb.image_path) sb.image_path = resolveUploadPath(sb.image_path) || sb.image_path;
  }
  const valid = storyboards.filter((sb): sb is StoryboardRow & { image_path: string } => Boolean(sb.image_path && fs.existsSync(sb.image_path)));
  if (valid.length === 0) {
    throw new Error('没有可用的图片（请先为分镜选中图片）');
  }

  await acquireComposeLock();
  try {
    return await composeVideo(projectId, valid, options, onProgress);
  } finally {
    releaseComposeLock();
  }
}

function normalizeExportSubtitleState(row: ExportRow): ExportRow {
  const r = { ...row };
  const hasSubtitle = Number(r.has_subtitle || 0) === 1;
  const burnSubtitle = Number(r.burn_subtitle || 0) === 1;
  if (!r.subtitle_status) {
    if (hasSubtitle && burnSubtitle) r.subtitle_status = 'burned';
    else if (hasSubtitle && r.vtt_url) r.subtitle_status = 'soft';
    else if (hasSubtitle && r.srt_url) r.subtitle_status = 'soft_missing_vtt';
    else r.subtitle_status = 'legacy';
  }
  r.has_subtitle = hasSubtitle ? 1 : 0;
  r.burn_subtitle = burnSubtitle ? 1 : 0;
  return r;
}

// 获取项目的导出历史
router.get('/exports/:projectId', (req, res) => {
  const exports = getDb().prepare(
    'SELECT * FROM exports WHERE project_id=? ORDER BY created_at DESC'
  ).all(req.params.projectId).map(normalizeExportSubtitleState);
  res.json({ code: 200, data: exports, message: 'success' });
});

// 成片库：全局列出所有项目的成片（带项目名 + 文件大小），供「我的作品」页浏览
router.get('/library', (req, res) => {
  try {
    const rows = getDb().prepare(
      `SELECT e.*, p.name AS project_name
       FROM exports e LEFT JOIN projects p ON e.project_id = p.id
       WHERE e.status = 'success'
       ORDER BY e.created_at DESC`
    ).all();
    // 补充运行时文件大小（DB 不存大小，避免迁移）
    for (let i = 0; i < rows.length; i++) {
      rows[i] = normalizeExportSubtitleState(rows[i]);
      const r = rows[i];
      try {
        const abs = path.resolve(config.get('uploadDir'), '.' + String(r.file_path || '').replace(/^\/uploads/, ''));
        r.file_size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
        r.file_exists = r.file_size > 0;
      } catch { r.file_size = 0; r.file_exists = false; }
      try {
        r.external_file_exists = !!(r.external_file_path && fs.existsSync(r.external_file_path));
      } catch { r.external_file_exists = false; }
    }
    res.json({ code: 200, data: rows, message: 'success' });
  } catch (err: unknown) {
    res.status(500).json({ code: 500, data: null, message: `读取成片库失败: ${errorMessage(err)}` });
  }
});

// 删除单条成片（删 DB 行 + 物理文件 + 关联 SRT）
router.delete('/exports/:id', (req, res) => {
  try {
    const row = getDb().prepare('SELECT * FROM exports WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ code: 404, data: null, message: '成片不存在' });
    // 删物理视频文件
    try {
      const abs = path.resolve(config.get('uploadDir'), '.' + String(row.file_path || '').replace(/^\/uploads/, ''));
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (e: unknown) { console.error('[exports delete] 删文件失败:', errorMessage(e)); }
    for (const subtitleUrl of [row.srt_url, row.vtt_url]) {
      try {
        const abs = resolveUploadPath(subtitleUrl);
        if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (e: unknown) { console.error('[exports delete] 删字幕失败:', errorMessage(e)); }
    }
    getDb().prepare('DELETE FROM exports WHERE id=?').run(req.params.id);
    res.json({ code: 200, data: { id: Number(req.params.id) }, message: '已删除' });
  } catch (err: unknown) {
    res.status(500).json({ code: 500, data: null, message: `删除失败: ${errorMessage(err)}` });
  }
});

// 列出可用转场
router.get('/transitions', (req, res) => {
  res.json({
    code: 200,
    data: [
      { key: 'none', label: '无转场（直切）' },
      { key: 'fade', label: '淡入淡出' },
      { key: 'slide', label: '左滑切换' },
      { key: 'zoom', label: '缩放进入' },
      { key: 'wipe', label: '左擦除' },
      { key: 'dissolve', label: '溶解' },
    ],
    message: 'success',
  });
});

// 导出 router（保持原有 CommonJS 挂载方式不变），并附带高层合成函数供流水线复用。
const videoRouter = Object.assign(router, { composeProjectVideo, MOTION_PRESETS, RATIO_PRESETS })
export = videoRouter
