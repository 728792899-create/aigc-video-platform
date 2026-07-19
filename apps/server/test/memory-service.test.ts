import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StoryEvent } from '@aigc-director/contracts'
import { createDirectorApp } from '../src/http/app.js'

describe('分层 Agent 记忆', () => {
  let runtime: ReturnType<typeof createDirectorApp>

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aigc-memory-'))
    runtime = createDirectorApp({ databasePath: join(directory, 'director.sqlite'), dataDirectory: directory, sessionToken: 'memory-test-session-token-with-enough-entropy' })
  })

  afterEach(() => {
    runtime.io.disconnectSockets(true)
    runtime.io.removeAllListeners()
    runtime.httpServer.removeAllListeners()
    runtime.db.close()
  })

  it('按 Episode→Series→Global 检索并解释来源，旧 revision 只标记 stale', () => {
    const project = runtime.db.createProject({ name: '灯塔第一集' })
    const imported = runtime.service.importSource(project.id, { title: '灯塔来信', content: '第一章 来信\n林舟进入废弃灯塔，在灯室发现未署名的来信。' })
    const series = runtime.db.createSeries({ name: '灯塔系列', artDirection: '冷蓝海雾与暖色灯室形成对比' })
    runtime.db.attachEpisode(project.id, series.id)
    const globalAsset = runtime.db.createSharedAsset({ scope: 'global', type: 'prop', name: '铜制灯塔钥匙', description: '跨系列复用的旧铜钥匙' })
    runtime.db.createSharedAssetVariant(globalAsset.id, { label: '默认版本' })

    const first = runtime.memory.rebuild(project.id)
    expect(first.created).toBeGreaterThan(2)
    expect(first.skippedSensitive).toBe(0)
    const results = runtime.memory.search(project.id, '灯塔')
    expect(results.length).toBeGreaterThan(1)
    expect(results[0]?.record.scope).toBe('episode')
    expect(results[0]?.reasons).toContain('Episode 作用域优先')
    expect(results.some((result) => result.record.scope === 'series')).toBe(true)
    expect(results.some((result) => result.record.scope === 'global')).toBe(true)

    const event = imported.events[0]
    if (!event) throw new Error('MEMORY_EVENT_FIXTURE_MISSING')
    const updatedSummary = `${event.summary} 主角把来信锁进抽屉。`
    const revised: StoryEvent = {
      ...event, summary: updatedSummary, revision: event.revision + 1,
      contentHash: createHash('sha256').update(updatedSummary).digest('hex'), updatedAt: new Date().toISOString(),
    }
    runtime.db.put('story_events', project.id, revised)
    const second = runtime.memory.rebuild(project.id)
    expect(second.markedStale).toBeGreaterThan(0)
    const versions = runtime.db.listMemoryRecords(runtime.memory.contexts(project.id)).filter((record) => record.sourceKey === `event:${event.id}`)
    expect(versions).toHaveLength(2)
    expect(versions.filter((record) => record.stale)).toHaveLength(1)
    expect(runtime.memory.search(project.id, '抽屉').every((result) => !result.record.stale)).toBe(true)
  })

  it('排除密钥和私人路径，支持禁用、删除与纯关键词降级状态', () => {
    const project = runtime.db.createProject({ name: '敏感内容排除' })
    const privateFixturePath = ['', 'Users', 'fixture-user', 'secret.txt'].join('/')
    runtime.service.importSource(project.id, {
      title: '不得索引', content: `第一章 配置\n管理员说 api_key=sk-abcdefghijklmnop，并提到 ${privateFixturePath}。`,
    })
    const report = runtime.memory.rebuild(project.id)
    expect(report.skippedSensitive).toBeGreaterThan(0)
    const indexedMemory = JSON.stringify(runtime.db.listMemoryRecords(runtime.memory.contexts(project.id)))
    expect(indexedMemory).not.toContain('sk-abcdefghijklmnop')
    expect(indexedMemory).not.toContain(privateFixturePath)

    runtime.service.importSource(project.id, { title: '安全事件', content: '第二章 安全\n剪辑师确认只保存批准后的角色状态。' })
    runtime.memory.rebuild(project.id)
    const record = runtime.memory.search(project.id, '角色状态')[0]?.record
    if (!record) throw new Error('MEMORY_SAFE_FIXTURE_MISSING')
    expect(runtime.memory.setDisabled(record.id, true).disabled).toBe(true)
    expect(runtime.memory.search(project.id, '角色状态').some((result) => result.record.id === record.id)).toBe(false)
    runtime.memory.delete(record.id)
    expect(runtime.db.getMemoryRecord(record.id)).toBeUndefined()
    expect(runtime.memory.modelStatus()).toMatchObject({ mode: 'keyword', keywordReady: true, onnx: { enabled: false, installed: false, status: 'not-requested' } })
  })

  it('为 Agent 计划生成稳定的脱敏记忆引用快照', () => {
    const project = runtime.db.createProject({ name: '记忆 checkpoint' })
    runtime.service.importSource(project.id, { title: '灯塔来信', content: '第一章 来信\n林舟在灯室找到一封信。' })
    const first = runtime.memory.checkpointContext(project.id)
    const second = runtime.memory.checkpointContext(project.id)
    expect(first.memoryCitations.length).toBeGreaterThan(0)
    expect(second).toEqual(first)
    expect(JSON.stringify(first.memoryCitations)).not.toMatch(/"(?:content|summary|title)"/u)
    expect(first.memoryContextHash).toHaveLength(64)
    const disabled = first.memoryCitations[0]
    if (!disabled) throw new Error('MEMORY_CHECKPOINT_CITATION_MISSING')
    runtime.memory.setDisabled(disabled.memoryId, true)
    expect(runtime.memory.checkpointContext(project.id).memoryContextHash).not.toBe(first.memoryContextHash)
  })
})
