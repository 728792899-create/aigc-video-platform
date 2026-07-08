/**
 * 文件魔数（magic number）校验工具
 * ------------------------------------------------------------------
 * 约束依据：企业级 AI 约束文档 §6 安全 ——「上传文件必须校验大小、MIME、扩展名、
 * 魔数、病毒扫描和存储路径」。仅信任客户端传来的 mimetype 是不够的（可伪造），
 * 必须读取文件头部字节核对真实类型，防止把可执行文件/脚本伪装成图片/音频上传。
 *
 * 设计：纯本地、零依赖、同步读取前 16 字节即可判定。校验失败抛 Error，
 * 由上传路由的回调统一转成 400，绝不静默放行。
 */
const fs = require('fs');

// 各类型的文件头特征字节（十六进制）。null 占位表示该位任意。
const SIGNATURES = {
  // 图片
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]], // GIF8
  'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]], // RIFF....WEBP
  // 音频
  'audio/mpeg': [[0x49, 0x44, 0x33], [0xff, 0xfb], [0xff, 0xf3], [0xff, 0xf2]], // ID3 或 MPEG 帧同步
  'audio/wav': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x41, 0x56, 0x45]], // RIFF....WAVE
  // mp4/m4a/aac 容器：ftyp 盒子在第 4~8 字节
  'audio/mp4': [[null, null, null, null, 0x66, 0x74, 0x79, 0x70]], // ....ftyp
  'audio/aac': [[0xff, 0xf1], [0xff, 0xf9], [0x49, 0x44, 0x33]],   // ADTS 同步字 或 ID3
};

// MIME 同义词归一（客户端可能传 audio/mp3、audio/x-wav 等变体）
const MIME_ALIAS = {
  'image/jpg': 'image/jpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
};

function matchSig(head, sig) {
  if (head.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] === null) continue;
    if (head[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * 读取文件头并核对是否匹配 allowedMimes 中任一类型的真实魔数。
 * @param {string} filePath 已落盘的临时文件路径
 * @param {string[]} allowedMimes 业务允许的 MIME 白名单
 * @returns {boolean} true=魔数匹配白名单内某类型
 */
function verifyFileSignature(filePath, allowedMimes) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    const head = buf.subarray(0, bytesRead);
    // 把白名单里的别名归一后去重，逐一比对其魔数集合
    const canonical = new Set(allowedMimes.map((m) => MIME_ALIAS[m] || m));
    for (const mime of canonical) {
      const sigs = SIGNATURES[mime];
      if (!sigs) continue;
      if (sigs.some((sig) => matchSig(head, sig))) return true;
    }
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

module.exports = { verifyFileSignature, MIME_ALIAS };
