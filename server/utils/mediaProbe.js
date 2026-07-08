const { spawn } = require('child_process');
const config = require('../services/config');
const { resolveFfmpegPath, resolveFfprobePath } = require('./ffmpeg');

// ffmpeg 路径（打包后指向 app.asar.unpacked 里的 ffmpeg-static，必定存在）。
function ffmpegBin() {
  try { return resolveFfmpegPath(config.get('ffmpegPath')).path; } catch { /* 用默认 */ }
  return resolveFfmpegPath('ffmpeg').path;
}

// ffprobe 路径：仅当与 ffmpeg 同目录确有 ffprobe 时才用；打包的 ffmpeg-static
// 只带 ffmpeg.exe 没有 ffprobe.exe，所以这是「可选优选」，拿不到就回退 ffmpeg 解析。
function ffprobeBin() {
  return resolveFfprobePath(ffmpegBin());
}

// 用 ffprobe 读时长（精确）。失败 resolve(null)。
function viaFfprobe(filePath) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn(ffprobeBin(), [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', filePath,
      ], { windowsHide: true });
      const timer = setTimeout(() => { try { p.kill(); } catch {} finish(null); }, 15000);
      p.stdout.on('data', (d) => { out += d.toString(); });
      p.on('close', () => { clearTimeout(timer); const n = parseFloat(String(out).trim()); finish(Number.isFinite(n) && n > 0 ? n : null); });
      p.on('error', () => { clearTimeout(timer); finish(null); });
    } catch { finish(null); }
  });
}

// 用 ffmpeg 读时长（兜底）。ffmpeg -i 会在 stderr 打印 "Duration: HH:MM:SS.xx"。
// 打包的 ffmpeg-static 只带 ffmpeg.exe（无 ffprobe.exe），所以这是安装版的主力路径。
function viaFfmpeg(filePath) {
  return new Promise((resolve) => {
    let err = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn(ffmpegBin(), ['-i', filePath], { windowsHide: true });
      const timer = setTimeout(() => { try { p.kill(); } catch {} finish(null); }, 15000);
      p.stderr.on('data', (d) => { err += d.toString(); });
      p.on('close', () => {
        clearTimeout(timer);
        const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          finish(Number.isFinite(sec) && sec > 0 ? sec : null);
        } else finish(null);
      });
      p.on('error', () => { clearTimeout(timer); finish(null); });
    } catch { finish(null); }
  });
}

/**
 * 读取音/视频文件的真实时长（秒）。先试 ffprobe（精确），拿不到再用 ffmpeg 解析 stderr
 * （打包版只有 ffmpeg.exe 没有 ffprobe.exe，这一步是安装版能正常工作的关键）。
 * 全部失败返回 null（调用方自行降级），绝不抛错阻断主流程。
 */
async function probeDuration(filePath) {
  if (!filePath) return null;
  const a = await viaFfprobe(filePath);
  if (a && a > 0) return a;
  const b = await viaFfmpeg(filePath);
  return (b && b > 0) ? b : null;
}

module.exports = { probeDuration };
