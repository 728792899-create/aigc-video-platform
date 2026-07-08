const fs = require('fs');

function resolveStaticFfmpeg() {
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) {
      return staticPath;
    }
  } catch {
    // ffmpeg-static is optional in older installs; fall back to PATH below.
  }
  return null;
}

function resolveFfmpegPath(configuredPath) {
  const configured = String(configuredPath || '').trim();
  if (configured && configured !== 'ffmpeg') {
    return {
      path: configured,
      source: '配置路径',
    };
  }

  const staticPath = resolveStaticFfmpeg();
  if (staticPath) {
    return {
      path: staticPath,
      source: 'ffmpeg-static',
    };
  }

  return {
    path: configured || 'ffmpeg',
    source: '系统 PATH',
  };
}

function resolveFfprobePath(ffmpegPath) {
  if (ffmpegPath && /ffmpeg(\.exe)?$/i.test(ffmpegPath)) {
    return ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (match) => match.replace(/ffmpeg/i, 'ffprobe'));
  }
  return 'ffprobe';
}

module.exports = {
  resolveFfmpegPath,
  resolveFfprobePath,
};
