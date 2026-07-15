import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PromptHistoryPanel from '../components/script/PromptHistoryPanel.vue'

const promptMocks = vi.hoisted(() => {
  const revisions = [{
    id: '10000000-0000-4000-8000-000000000002', project_id: 7, storyboard_id: 11,
    kind: 'image' as const, content: '雨夜\n青色霓虹', negative_content: '', source: 'manual' as const,
    prompt_version: 'ui-v1', provider: '', model: '', parent_revision_id: '10000000-0000-4000-8000-000000000001',
    revision: 2, content_hash: 'b'.repeat(64), created_at: 2,
  }]
  return {
    revisions,
    listPromptRevisions: vi.fn(async (_projectId: string | number, _storyboardId: string | number, _kind: string) => revisions),
    createPromptRevision: vi.fn(async (_projectId: string | number, _payload: object) => ({ ...revisions[0]!, id: '10000000-0000-4000-8000-000000000003', revision: 3 })),
    diffPromptRevision: vi.fn(async (_id: string) => ({
      current: revisions[0], against: { ...revisions[0], revision: 1, content: '雨夜' },
      lines: [{ type: 'same' as const, line: '雨夜' }, { type: 'added' as const, line: '青色霓虹' }],
    })),
    restorePromptRevision: vi.fn(async (_id: string) => ({ ...revisions[0]!, id: '10000000-0000-4000-8000-000000000004', revision: 3 })),
    regenerateStoryboard: vi.fn(async (_storyboardId: string | number, _payload: object) => ({ task_id: 'task-1', storyboard_id: 11, stages: ['image' as const] })),
  }
})
const { revisions, listPromptRevisions, createPromptRevision, diffPromptRevision, restorePromptRevision, regenerateStoryboard } = promptMocks

vi.mock('../api/prompts', () => promptMocks)

describe('PromptHistoryPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  async function wrapper() {
    const view = mount(PromptHistoryPanel, {
      props: {
        projectId: 7,
        storyboards: [{ id: 11, scene_number: 1, description: '车站远景', dialog: '旁白', duration: 5 }],
      },
    })
    await vi.waitFor(() => expect(listPromptRevisions).toHaveBeenCalled())
    await view.vm.$nextTick()
    return view
  }

  it('显示不可变版本并呈现行级 diff', async () => {
    const view = await wrapper()
    expect(view.text()).toContain('R2')
    await view.findAll('button').find((button) => button.text().includes('查看 diff'))!.trigger('click')
    await vi.waitFor(() => expect(diffPromptRevision).toHaveBeenCalledWith(revisions[0]!.id))
    expect(view.text()).toContain('青色霓虹')
  })

  it('恢复创建新 revision，局部重生成只提交所选分镜', async () => {
    const view = await wrapper()
    await view.findAll('button').find((button) => button.text().includes('以此版本'))!.trigger('click')
    await vi.waitFor(() => expect(restorePromptRevision).toHaveBeenCalledWith(revisions[0]!.id))
    await view.findAll('button').find((button) => button.text().includes('创建局部任务'))!.trigger('click')
    await vi.waitFor(() => expect(regenerateStoryboard).toHaveBeenCalled())
    expect(regenerateStoryboard.mock.calls[0]?.[0]).toBe(11)
    expect(view.emitted('taskCreated')?.[0]?.[0]).toMatchObject({ task_id: 'task-1' })
  })
})
