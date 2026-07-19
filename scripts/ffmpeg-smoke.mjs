import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const out = path.join(os.tmpdir(), `aigc-ffmpeg-smoke-${process.pid}.mp4`);
const result = spawnSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'color=c=0x18233b:s=320x180:d=1',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out,
], { encoding: 'utf8', windowsHide: true });
try {
  if (result.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 2_000) {
    throw new Error((result.stderr || result.error?.message || 'FFmpeg smoke failed').slice(-1_000));
  }
  const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out], { encoding: 'utf8', windowsHide: true });
  const duration = Number(probe.stdout?.trim());
  if (probe.status !== 0 || !Number.isFinite(duration) || duration < 0.9) {
    throw new Error((probe.stderr || probe.error?.message || 'FFprobe validation failed').slice(-1_000));
  }
  console.log(`FFmpeg smoke passed: ${fs.statSync(out).size} bytes, ${duration.toFixed(3)} seconds`);
} finally {
  try { fs.unlinkSync(out); } catch {}
}
