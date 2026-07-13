'use strict';

const { spawn, execFile } = require('child_process');
const config = require('./config');
const { resolveFfmpegPath } = require('../utils/ffmpeg');

const activeProcesses = new Set();
let encodePreset = null;
let ffmpegTimeout = 300000;

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch {}
}

function spawnAsync(cmd, args, options = {}) {
  const timeout = options.timeout || 300000;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    activeProcesses.add(child);
    let stdout = '';
    const stderrLines = [];
    let settled = false;
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderrLines.push(chunk.toString()); if (stderrLines.length > 50) stderrLines.shift(); });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      reject(new Error(`FFmpeg 超时 (${timeout / 1000}s)，已强制终止`));
    }, timeout);
    child.on('close', (code) => {
      clearTimeout(timer); activeProcesses.delete(child);
      if (settled) return; settled = true;
      const stderr = stderrLines.join('');
      if (code !== 0) reject(new Error(stderr.slice(-500).trim() || `exit code ${code}`));
      else resolve({ stdout, stderr });
    });
    child.on('error', (error) => { clearTimeout(timer); activeProcesses.delete(child); if (!settled) { settled = true; reject(error); } });
  });
}

function ffmpeg(...args) {
  const executable = resolveFfmpegPath(config.get('ffmpegPath')).path;
  const finalArgs = encodePreset && args.length >= 2 ? [...args.slice(0, -1), '-preset', encodePreset, args.at(-1)] : args;
  return spawnAsync(executable, finalArgs, { timeout: ffmpegTimeout || 300000 });
}

function setEncodePreset(value) { encodePreset = value || null; }
function timeoutForSeconds(seconds, stage = 'encode') {
  const sec = Math.max(1, Number(seconds) || 60);
  const multipliers = { segment: 45, chapter: 24, final: 12, encode: 30 };
  const minMs = stage === 'final' ? 600000 : 300000;
  const maxMs = stage === 'final' ? 6 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
  return Math.max(minMs, Math.min(maxMs, Math.round(sec * (multipliers[stage] || 30) * 1000)));
}
async function withFfmpegTimeout(ms, fn) { const previous = ffmpegTimeout; ffmpegTimeout = ms; try { return await fn(); } finally { ffmpegTimeout = previous; } }
function killAll() { for (const child of activeProcesses) killProcessTree(child.pid); activeProcesses.clear(); }
process.once('exit', killAll);

module.exports = { ffmpeg, spawnAsync, setEncodePreset, timeoutForSeconds, withFfmpegTimeout, killAll };
