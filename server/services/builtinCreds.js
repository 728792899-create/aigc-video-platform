/**
 * 内置兜底凭证（随安装包分发，开箱即用）
 *
 * 说明：这里存放经轻量混淆（XOR+Base64）的 DeepSeek 默认 Key，仅用于
 * 让未单独配置 Key 的机器（如答辩机、轻薄本）也能直接使用一键成片。
 * 优先级最低：任何机器只要自己在「系统设置→模型路由」配了 Key，就用自己的，
 * 不会读这里。混淆只是防止明文被直接 grep，并非强加密——请勿把安装包公开分发。
 */
const PASS = 'snoopy-king-2026-aigc-shipin-builtin-seed';

function deobf(b64) {
  try {
    const raw = Buffer.from(b64, 'base64');
    const out = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) {
      out[i] = raw[i] ^ PASS.charCodeAt(i % PASS.length);
    }
    return out.toString('utf-8');
  } catch (e) {
    return '';
  }
}

// 分片存储，运行时拼接还原
const _K = ['AAVCWUZNGlNRWAIZUABWAh4F', 'DwZbFBJZXEdeWR1bQwgORws='];
const _B = ['GxobHwNDAkQIHg4D', 'VlVXRl4EDAxNThwF'];

function builtinDeepSeek() {
  const apiKey = deobf(_K.join(''));
  const baseUrl = deobf(_B.join(''));
  return { apiKey, baseUrl };
}

// 内置智谱（BigModel）生图凭证：CogView-3-Flash 永久免费，开箱即用。
// 与 DeepSeek 同样为兜底，用户自配的智谱 Key 优先。
const _Z = ['RlYMW0RIHQlaX1dJBgIHA0wCUF9UHUMKDB', 'MNVklRRwxCTV0YZEYcLDwiPQolIE1AJQ=='];

function builtinZhipu() {
  const apiKey = deobf(_Z.join(''));
  // 仅到域名根；t2iProvider/genZhipuImage 会自行拼接 /api/paas/v4/images/generations
  const baseUrl = 'https://open.bigmodel.cn';
  return { apiKey, baseUrl };
}

module.exports = { builtinDeepSeek, builtinZhipu };
