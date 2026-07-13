'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // macOS may attach resource forks/Finder metadata to downloaded Electron
  // binaries. xattr -cr is insufficient for some provenance-protected files,
  // while ditto --norsrc --noextattr creates a byte-identical clean bundle.
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const cleanPath = path.join(context.appOutDir, `.${appName}.clean.app`);
  if (!fs.existsSync(appPath)) return;
  fs.rmSync(cleanPath, { recursive: true, force: true });
  execFileSync('/usr/bin/ditto', ['--norsrc', '--noextattr', appPath, cleanPath], { stdio: 'inherit' });
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.renameSync(cleanPath, appPath);
  execFileSync('/usr/bin/xattr', ['-cr', appPath], { stdio: 'inherit' });
};
