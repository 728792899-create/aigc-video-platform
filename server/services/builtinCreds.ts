export interface BuiltinCredential {
  apiKey: string
  baseUrl: string
}

function allowBuiltinKeys(): boolean {
  return process.env.ALLOW_BUILTIN_KEYS === '1'
}

export function builtinDeepSeek(): BuiltinCredential {
  return {
    apiKey: allowBuiltinKeys() ? (process.env.BUILTIN_DEEPSEEK_KEY || '') : '',
    baseUrl: process.env.BUILTIN_DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  }
}

export function builtinZhipu(): BuiltinCredential {
  return {
    apiKey: allowBuiltinKeys() ? (process.env.BUILTIN_ZHIPU_KEY || '') : '',
    baseUrl: process.env.BUILTIN_ZHIPU_BASE_URL || 'https://open.bigmodel.cn',
  }
}
