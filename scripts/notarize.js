'use strict';

const path = require('path');

module.exports = async function notarizeHook(context) {
  if (process.platform !== 'darwin') return;
  if (process.env.SKIP_NOTARIZE === '1') {
    console.log('[notarize] 预检构建显式跳过公证。');
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const apiKeyMode = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
  const appleIdMode = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
  if (!apiKeyMode && !appleIdMode) {
    if (process.env.AIGC_RELEASE_SIGNING_REQUIRED === '1') {
      throw new Error('正式 macOS 发布缺少公证凭据，拒绝生成看似可发布的包。');
    }
    console.log('[notarize] 未配置 Apple 公证凭据，跳过；签名后的正式发布必须在 CI 中配置。');
    return;
  }
  const { notarize } = require('@electron/notarize');
  const options = apiKeyMode
    ? {
        appPath,
        tool: 'notarytool',
        appleApiKey: process.env.APPLE_API_KEY,
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        appleApiIssuer: process.env.APPLE_API_ISSUER,
      }
    : {
        appPath,
        tool: 'notarytool',
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      };
  await notarize(options);
  console.log(`[notarize] 已完成并装订公证票据：${appName}`);
};
