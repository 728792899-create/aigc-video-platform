'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const RELEASE_SOURCE_RE = /\.(?:[cm]?ts|tsx|map|tsbuildinfo)$/i;

function collectReleaseSources(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectReleaseSources(absolute, result);
    else if (RELEASE_SOURCE_RE.test(entry.name)) result.push(absolute);
  }
  return result;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // macOS may attach resource forks/Finder metadata to downloaded Electron
  // binaries. xattr -cr is insufficient for some provenance-protected files,
  // while ditto --norsrc --noextattr creates a byte-identical clean bundle.
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const cleanPath = path.join(context.appOutDir, `.${appName}.clean.app`);
  if (!fs.existsSync(appPath)) return;
  // package-preflight reuses npm's verified local Electron distribution. The
  // custom-distribution path intentionally skips electron-builder's default
  // cleanup, so remove Electron's sample app before signing our application.
  fs.rmSync(path.join(appPath, 'Contents', 'Resources', 'default_app.asar'), { force: true });
  fs.rmSync(path.join(context.appOutDir, 'version'), { force: true });
  const appAsar = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const forbidden = collectReleaseSources(appPath);
  if (fs.existsSync(appAsar)) {
    forbidden.push(...asar.listPackage(appAsar).filter((entry) => RELEASE_SOURCE_RE.test(entry)));
  }
  if (forbidden.length) {
    throw new Error(`签名前检查失败：发布包包含 TypeScript/sourcemap\n${forbidden.slice(0, 20).join('\n')}`);
  }
  fs.rmSync(cleanPath, { recursive: true, force: true });
  execFileSync('/usr/bin/ditto', ['--norsrc', '--noextattr', appPath, cleanPath], { stdio: 'inherit' });
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.renameSync(cleanPath, appPath);
  execFileSync('/usr/bin/xattr', ['-cr', appPath], { stdio: 'inherit' });
};
