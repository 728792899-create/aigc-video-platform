import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
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
  console.log(`FFmpeg smoke passed: ${fs.statSync(out).size} bytes`);
} finally {
  try { fs.unlinkSync(out); } catch {}
}
