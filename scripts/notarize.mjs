import { notarize } from '@electron/notarize'

export default async function notarizeBuild(context) {
  if (process.platform !== 'darwin' || process.env.SKIP_NOTARIZE === '1') return
  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`
  const appleApiKey = process.env.APPLE_API_KEY
  const appleApiKeyId = process.env.APPLE_API_KEY_ID
  const appleApiIssuer = process.env.APPLE_API_ISSUER
  if (!appleApiKey || !appleApiKeyId || !appleApiIssuer) throw new Error('MACOS_NOTARIZATION_CREDENTIALS_REQUIRED')
  await notarize({ appPath, appleApiKey, appleApiKeyId, appleApiIssuer })
}
