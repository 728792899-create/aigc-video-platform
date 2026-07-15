import { describe, expect, it } from 'vitest'

import {
  buildStudioGraph,
  findNextStudioNode,
  type StudioGraphSnapshot,
} from './studioGraph'
import { mergeStudioTaskSummaries } from '../api/studio'

function snapshot(overrides: Partial<StudioGraphSnapshot> = {}): StudioGraphSnapshot {
  return {
    project: {
      id: 42,
      name: '海边信号',
      theme: '失联摄影师在旧灯塔发现一段未来录像',
      status: 'partial',
      scriptContent: '第一幕：抵达灯塔。',
    },
    storyboards: [
      {
        id: 101,
        sceneNumber: 1,
        description: '摄影师走近灯塔',
        hasSelectedImage: true,
        hasVoice: true,
        hasSubtitle: true,
        stale: false,
      },
      {
        id: 102,
        sceneNumber: 2,
        description: '录像开始播放',
        hasSelectedImage: false,
        hasVoice: false,
        hasSubtitle: true,
        stale: true,
      },
    ],
    assetUnitCount: 3,
    bindingCount: 2,
    successfulExportCount: 0,
    staleStages: ['storyboard'],
    tasks: [],
    ...overrides,
  }
}

describe('AI 导演画布领域投影', () => {
  it('实时事件按稳定 task ID 合并，不丢失未进入内存 store 的失败证据', () => {
    const merged = mergeStudioTaskSummaries(
      [
        { id: 'failed-history', type: 'image', status: 'failed', error: '限流', retryable: true },
        { id: 'active-task', type: 'voice', status: 'running', retryable: false },
      ],
      [{ id: 'active-task', type: 'voice', status: 'success', retryable: false }],
    )

    expect(merged).toEqual([
      { id: 'failed-history', type: 'image', status: 'failed', error: '限流', retryable: true },
      { id: 'active-task', type: 'voice', status: 'success', retryable: false },
    ])
  })

  it('使用稳定领域 ID 构建九阶段节点和非线性资产依赖', () => {
    const graph = buildStudioGraph(snapshot())

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'project:42:topic',
      'project:42:script',
      'project:42:assets',
      'project:42:storyboard',
      'project:42:visuals',
      'project:42:voice',
      'project:42:subtitle',
      'project:42:timeline',
      'project:42:export',
    ])
    expect(graph.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain(
      'project:42:assets->project:42:visuals',
    )
    expect(graph.edges.map((edge) => `${edge.source}->${edge.target}`)).toContain(
      'project:42:storyboard->project:42:visuals',
    )
  })

  it('保留部分成功、stale 和失败诊断，不把下游误报为完成', () => {
    const graph = buildStudioGraph(snapshot({
      tasks: [{
        id: 'task-image-1',
        type: 'image-batch',
        status: 'failed',
        error: '上游限流，可重试',
        retryable: true,
      }],
    }))

    const storyboard = graph.nodes.find((node) => node.kind === 'storyboard')
    const visuals = graph.nodes.find((node) => node.kind === 'visuals')
    const timeline = graph.nodes.find((node) => node.kind === 'timeline')

    expect(storyboard).toMatchObject({ status: 'attention', stale: true })
    expect(visuals).toMatchObject({ status: 'failed', completed: 1, total: 2 })
    expect(visuals?.diagnosis).toContain('上游限流')
    expect(timeline?.status).toBe('blocked')
  })

  it('运行中任务只影响对应节点，并给出可执行的下一阶段', () => {
    const graph = buildStudioGraph(snapshot({
      staleStages: [],
      storyboards: snapshot().storyboards.map((shot) => ({ ...shot, stale: false })),
      tasks: [{ id: 'task-voice-1', type: 'voice-batch', status: 'running', retryable: false }],
    }))

    expect(graph.nodes.find((node) => node.kind === 'voice')?.status).toBe('running')
    expect(findNextStudioNode(graph)?.kind).toBe('visuals')
  })

  it('成功导出后仍保留完整上游证据并将导出标为完成', () => {
    const complete = snapshot({
      project: {
        id: 42,
        name: '海边信号',
        theme: '主题',
        status: 'completed',
        scriptContent: '剧本',
      },
      storyboards: snapshot().storyboards.map((shot) => ({
        ...shot,
        hasSelectedImage: true,
        hasVoice: true,
        hasSubtitle: true,
        stale: false,
      })),
      staleStages: [],
      successfulExportCount: 1,
    })
    const graph = buildStudioGraph(complete)

    expect(graph.nodes.find((node) => node.kind === 'export')).toMatchObject({
      status: 'complete',
      completed: 1,
    })
    expect(findNextStudioNode(graph)).toBeNull()
  })
})
