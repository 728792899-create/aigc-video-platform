/**
 * 可选的本地/答辩环境凭证入口。
 *
 * 公开源码和默认安装包不携带任何共享密钥。只有显式设置
 * ALLOW_BUILTIN_KEYS=1 且在运行环境提供对应 BUILTIN_*_KEY 时才启用；
 * 密钥始终来自环境变量，不写入源码、构建产物或版本库。
 */

function allowBuiltinKeys() {
  return process.env.ALLOW_BUILTIN_KEYS === '1';
}

function builtinDeepSeek() {
  return {
    apiKey: allowBuiltinKeys() ? (process.env.BUILTIN_DEEPSEEK_KEY || '') : '',
    baseUrl: process.env.BUILTIN_DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  };
}

function builtinZhipu() {
  return {
    apiKey: allowBuiltinKeys() ? (process.env.BUILTIN_ZHIPU_KEY || '') : '',
    baseUrl: process.env.BUILTIN_ZHIPU_BASE_URL || 'https://open.bigmodel.cn',
  };
}

module.exports = { builtinDeepSeek, builtinZhipu };
