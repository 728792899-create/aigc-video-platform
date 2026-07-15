const required = process.env.AIGC_RELEASE_SIGNING_REQUIRED === '1'
if (!required) {
  console.log('[release] 当前为 unsigned/ad-hoc 预检，不要求正式签名凭据')
  process.exit(0)
}

function requireAll(names, label) {
  const missing = names.filter((name) => !String(process.env[name] || '').trim())
  if (missing.length) throw new Error(`${label}缺少正式发布凭据：${missing.join(', ')}`)
}

if (process.platform === 'darwin') {
  requireAll(['CSC_LINK', 'CSC_KEY_PASSWORD'], 'macOS ')
  const apiKeyMode = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER
  const appleIdMode = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
  if (!apiKeyMode && !appleIdMode) {
    throw new Error('macOS 正式发布必须配置 App Store Connect API Key 或 Apple ID 公证凭据')
  }
} else if (process.platform === 'win32') {
  requireAll(['CSC_LINK', 'CSC_KEY_PASSWORD'], 'Windows ')
} else {
  throw new Error(`正式桌面签名不支持当前平台：${process.platform}`)
}

console.log(`[release] ${process.platform} 正式签名与公证凭据门禁通过`)
