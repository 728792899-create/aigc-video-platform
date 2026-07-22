import { describe, expect, it } from 'vitest'
import type { SourceDocument, StoryEvent, StoryEventEdge } from '@aigc-director/contracts'
import { canTransitionTask, createAdaptationArtifacts, detectChapterHeadings, extractStoryDeterministically, linkPreviousEndFrame, normalizeShotBeats, propagateSceneStaleFields, propagateStaleFields, sha256, validateStoryGraph } from '../src/index.js'

const projectId = '11111111-1111-4111-8111-111111111111'
const source: SourceDocument = {
  id: '22222222-2222-4222-8222-222222222222', projectId, title: '试播集',
  content: '第一章 起点\n阿澈推开旧剧院的门。灯光突然亮起。她问：谁在那里？', language: 'zh-CN',
  contentHash: sha256('demo'), revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}

describe('2.0 领域契约', () => {
  it('Demo 事件提取保留原文范围并只建立顺序边', () => {
    const result = extractStoryDeterministically(source)
    expect(result.chapters).toHaveLength(1)
    expect(result.events.length).toBeGreaterThanOrEqual(2)
    expect(result.events.every((event) => source.content.slice(event.sourceStart, event.sourceEnd).includes(event.summary))).toBe(true)
    expect(result.edges.every((edge) => edge.type === 'follows')).toBe(true)
  })

  it('Markdown 标题成为章节但不污染章节名称', () => {
    const markdown = '# 第一章 起点\n灯光亮起。\n\n## 第二章 回声\n导演举起相机。'
    expect(detectChapterHeadings(markdown).map((heading) => heading.title)).toEqual(['第一章 起点', '第二章 回声'])
    const result = extractStoryDeterministically({ ...source, content: markdown, contentHash: sha256(markdown) })
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['第一章 起点', '第二章 回声'])
  })

  it('受约束关系拒绝循环', () => {
    const result = extractStoryDeterministically(source)
    const [first, second] = result.events as [StoryEvent, StoryEvent]
    const cycle: StoryEventEdge = { id: crypto.randomUUID(), projectId, sourceEventId: second.id, targetEventId: first.id, type: 'causes', createdAt: new Date().toISOString() }
    expect(validateStoryGraph(result.events, [...result.edges, cycle]).valid).toBe(false)
  })

  it('字段级 stale 与任务转换保持可诊断', () => {
    expect(propagateStaleFields(['dialogue'])).toEqual(['voice', 'subtitle', 'timeline', 'export'])
    expect(propagateStaleFields(['negativePrompt'])).toEqual(['image', 'video', 'timeline', 'export'])
    expect(propagateStaleFields(['beats'])).toEqual(['image', 'video', 'voice', 'subtitle', 'timeline', 'export'])
    expect(propagateSceneStaleFields(['synopsis'])).toEqual(['image', 'video', 'timeline', 'export'])
    expect(canTransitionTask('failed', 'retrying')).toBe(true)
    expect(canTransitionTask('succeeded', 'running')).toBe(false)
    expect(canTransitionTask('running', 'outcome_unknown')).toBe(true)
    expect(canTransitionTask('outcome_unknown', 'retrying')).toBe(false)
    expect(canTransitionTask('outcome_unknown', 'reconciling')).toBe(true)
    expect(canTransitionTask('reconciling', 'needs_attention')).toBe(true)
  })

  it('多 Beat 归一后精确覆盖镜头且保留稳定 ID', () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    const beats = normalizeShotBeats(5_000, [
      { id: ids[0]!, action: '起身', camera: '中景', weight: 1 },
      { id: ids[1]!, action: '转身', camera: '跟拍', weight: 2 },
      { id: ids[2]!, action: '停步', camera: '特写', weight: 1 },
    ])
    expect(beats.map((beat) => beat.id)).toEqual(ids)
    expect(beats.reduce((sum, beat) => sum + beat.durationMs, 0)).toBe(5_000)
    expect(beats.map((beat) => beat.startMs)).toEqual([0, 1_275, 3_725])
    for (let count = 1; count <= 8; count += 1) {
      const durationMs = count * 100 + 7_321
      const normalized = normalizeShotBeats(durationMs, Array.from({ length: count }, (_, index) => ({
        id: crypto.randomUUID(), action: `动作 ${index}`, camera: '跟拍', weight: index + 1,
      })))
      expect(normalized.reduce((sum, beat) => sum + beat.durationMs, 0)).toBe(durationMs)
      expect(normalized.every((beat) => beat.durationMs >= 100)).toBe(true)
      expect(normalized.map((beat) => beat.startMs)).toEqual(normalized.map((_, index) => normalized.slice(0, index).reduce((sum, beat) => sum + beat.durationMs, 0)))
    }
  })

  it('Demo 镜头默认包含可校验 Beat，并可从上一镜头尾帧建立独立快照', () => {
    const events = extractStoryDeterministically(source).events
    const { shots } = createAdaptationArtifacts(projectId, events)
    expect(shots.every((shot) => shot.beats.length >= 2 && shot.beats.reduce((sum, beat) => sum + beat.durationMs, 0) === shot.durationMs)).toBe(true)
    const previous = shots[0]!
    const current = shots[1]!
    const end = {
      id: crypto.randomUUID(), role: 'end' as const, mediaId: crypto.randomUUID(), mediaSha256: 'd'.repeat(64),
      sourceShotId: previous.id, sourceRevision: previous.revision, provenance: 'generated_candidate' as const, createdAt: new Date().toISOString(),
    }
    const linked = linkPreviousEndFrame(current, { ...previous, boundaryFrames: [end] })
    expect(linked.boundaryFrames.find((frame) => frame.role === 'start')).toMatchObject({
      mediaId: end.mediaId, mediaSha256: end.mediaSha256, sourceShotId: previous.id,
      sourceBoundaryFrameId: end.id, provenance: 'linked_previous_end',
    })
    expect(linked.boundaryFrames.find((frame) => frame.role === 'start')?.id).not.toBe(end.id)
  })
})
