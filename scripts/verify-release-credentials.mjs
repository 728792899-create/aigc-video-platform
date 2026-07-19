const required = process.platform === 'darwin'
  ? ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
  : process.platform === 'win32'
    ? ['CSC_LINK', 'CSC_KEY_PASSWORD']
    : []

const missing = required.filter((name) => !process.env[name]?.trim())
if (missing.length > 0) throw new Error(`RELEASE_CREDENTIALS_MISSING:${missing.join(',')}`)
console.log(`Release credential gate passed for ${process.platform}`)
