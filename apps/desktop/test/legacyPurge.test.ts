import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGACY_CONFIRMATION, purgeLegacyData, scanLegacyData } from '../src/legacyPurge.js'

describe('旧数据一次性清理门禁', () => {
  it('要求精确确认并只删除 appData 内白名单目录', async () => {
    const appData = await mkdtemp(join(tmpdir(), 'director-purge-'))
    const legacy = join(appData, 'aigc-video-studio')
    const current = join(appData, 'AIGC Director Studio')
    await mkdir(legacy)
    await writeFile(join(legacy, 'project.sqlite'), 'fixture')
    const summary = await scanLegacyData(appData, current)
    expect(summary.totalFiles).toBe(1)
    await expect(purgeLegacyData(appData, summary, '错误确认', join(current, 'tombstone.json'))).rejects.toThrow('LEGACY_CONFIRMATION_INVALID')
    await purgeLegacyData(appData, summary, LEGACY_CONFIRMATION, join(current, 'tombstone.json'))
    expect(JSON.parse(await readFile(join(current, 'tombstone.json'), 'utf8'))).toHaveProperty('completedAt')
    expect((await scanLegacyData(appData, current)).totalFiles).toBe(0)
  })

  it('拒绝跟随符号链接', async () => {
    const appData = await mkdtemp(join(tmpdir(), 'director-purge-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'director-outside-'))
    await symlink(outside, join(appData, 'aigc-video-studio'))
    await expect(scanLegacyData(appData, join(appData, 'current'))).rejects.toThrow('LEGACY_PATH_SYMLINK_REJECTED')
  })
})
