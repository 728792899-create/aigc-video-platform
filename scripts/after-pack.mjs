import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const output = resolve(context.appOutDir)
  const appBundle = resolve(output, `${context.packager.appInfo.productFilename}.app`)
  const relativeBundle = relative(output, appBundle)
  if (relativeBundle.startsWith('..') || relativeBundle === '') throw new Error('AFTER_PACK_PATH_REJECTED')

  for (const target of [
    join(appBundle, 'Contents', 'Resources', 'default_app.asar'),
    join(output, 'version'),
  ]) {
    if (existsSync(target)) rmSync(target, { force: true })
  }

  const infoPlist = join(appBundle, 'Contents', 'Info.plist')
  const ats = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Set :NSAppTransportSecurity:NSAllowsArbitraryLoads false', infoPlist], { encoding: 'utf8' })
  if (ats.status !== 0) throw new Error(`AFTER_PACK_ATS_FAILED:${String(ats.stderr).trim().slice(-300)}`)

  const attributes = spawnSync('/usr/bin/xattr', ['-cr', appBundle], { encoding: 'utf8' })
  if (attributes.status !== 0) throw new Error(`AFTER_PACK_XATTR_FAILED:${String(attributes.stderr).trim().slice(-300)}`)
}
