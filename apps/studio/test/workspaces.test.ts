import { describe, expect, it } from 'vitest'
import type { GraphProjection } from '@aigc-director/contracts'
import {
  STUDIO_WORKSPACES,
  deriveDefaultWorkspace,
  focusGraphForWorkspace,
  resolveStudioWorkspace,
  workspaceAvailability,
  workspaceById,
  workspaceForLegacyView,
  type StudioWorkspaceFacts,
} from '../src/workspaces.js'
import {
  ONBOARDING_GUIDE_VERSION,
  ONBOARDING_STORAGE_KEY,
  completeOnboardingStep,
  createOnboardingState,
  loadOnboardingState,
  pauseOnboarding,
  restartOnboarding,
  saveOnboardingState,
  startOnboarding,
} from '../src/onboarding.js'
import { PREVIEW_RECORDER_STORAGE_KEY, readPreviewEvents, recordPreviewEvent } from '../src/previewRecorder.js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const emptyFacts: StudioWorkspaceFacts = {
  hasProject: false,
  hasSource: false,
  hasPlan: false,
  hasShots: false,
  hasCandidates: false,
  hasApprovedCandidates: false,
}

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('Studio Workspace Registry', () => {
  it('定义 16 个唯一 Workspace，并只映射到三张领域图', () => {
    expect(STUDIO_WORKSPACES).toHaveLength(16)
    expect(new Set(STUDIO_WORKSPACES.map((item) => item.id)).size).toBe(16)
    expect(new Set(STUDIO_WORKSPACES.map((item) => item.domainView))).toEqual(new Set(['story', 'production', 'delivery']))
    expect(STUDIO_WORKSPACES.every((item) => item.primaryAction && item.helpTopic && item.completion)).toBe(true)
    expect(STUDIO_WORKSPACES.map((item) => item.id)).toContain('provider_connections')
    expect(STUDIO_WORKSPACES.map((item) => item.id)).toContain('local_governance')
  })

  it('使用一个全局侧栏和一个横向阶段栏，不再渲染领域 Rail', async () => {
    const studio = await readFile(resolve(process.cwd(), 'src/views/DirectorStudio.vue'), 'utf8')
    const stageNavigation = await readFile(resolve(process.cwd(), 'src/components/StudioStageNavigation.vue'), 'utf8')
    expect(studio).toContain('<StudioSidebar')
    expect(studio).not.toContain('class="studio-rail"')
    expect(stageNavigation).toContain('class="studio-stagebar"')
    expect(stageNavigation).not.toContain('v-for="group in groups"')
    expect(stageNavigation).toContain("props.currentId === 'continuity' ? 'shots' : props.currentId")
  })

  it('保持旧 view 链接兼容，并优先采用合法 workspace', () => {
    expect(workspaceForLegacyView('story')).toBe('canvas')
    expect(workspaceForLegacyView('production')).toBe('shots')
    expect(workspaceForLegacyView('delivery')).toBe('timeline')
    expect(resolveStudioWorkspace('review', 'story', emptyFacts)).toBe('review')
    expect(resolveStudioWorkspace('not-real', 'production', emptyFacts)).toBe('shots')
  })

  it('未知查询参数回退到 canonical snapshot 推导的首个未完成阶段', () => {
    expect(deriveDefaultWorkspace(emptyFacts)).toBe('project_center')
    expect(deriveDefaultWorkspace({ ...emptyFacts, hasProject: true })).toBe('script')
    expect(deriveDefaultWorkspace({ ...emptyFacts, hasProject: true, hasSource: true })).toBe('shots')
    expect(deriveDefaultWorkspace({ ...emptyFacts, hasProject: true, hasSource: true, hasPlan: true, hasShots: true })).toBe('generation')
    expect(deriveDefaultWorkspace({ ...emptyFacts, hasProject: true, hasSource: true, hasPlan: true, hasShots: true, hasCandidates: true })).toBe('review')
  })

  it('锁定缺少前置条件的 Workspace 并提供真实替代路径', () => {
    expect(workspaceAvailability(workspaceById('review'), emptyFacts)).toMatchObject({ available: false, alternativeWorkspace: 'shots' })
    const withCandidates = { ...emptyFacts, hasProject: true, hasSource: true, hasPlan: true, hasShots: true, hasCandidates: true }
    expect(workspaceAvailability(workspaceById('review'), withCandidates).available).toBe(true)
    expect(workspaceAvailability(workspaceById('timeline'), withCandidates)).toMatchObject({ available: false, alternativeWorkspace: 'review' })
  })

  it('按 Workspace 聚焦领域对象，并删除失去端点的边', () => {
    const projectId = crypto.randomUUID()
    const graph: GraphProjection = {
      projectId, view: 'production', revision: 1, generatedAt: new Date().toISOString(),
      nodes: [
        { id: 'scene:a', entityId: crypto.randomUUID(), type: 'scene', label: '场景', subtitle: '', status: 'ready', position: { x: 0, y: 0 }, metadata: {} },
        { id: 'shot:a', entityId: crypto.randomUUID(), type: 'shot', label: '镜头', subtitle: '', status: 'ready', position: { x: 100, y: 0 }, metadata: {} },
        { id: 'candidate:a', entityId: crypto.randomUUID(), type: 'candidate', label: '候选', subtitle: '', status: 'ready', position: { x: 200, y: 0 }, metadata: {} },
        { id: 'task:a', entityId: crypto.randomUUID(), type: 'task', label: '任务', subtitle: '', status: 'running', position: { x: 300, y: 0 }, metadata: {} },
      ],
      edges: [
        { id: 'scene-shot', source: 'scene:a', target: 'shot:a', type: 'contains', animated: false },
        { id: 'shot-candidate', source: 'shot:a', target: 'candidate:a', type: 'produces', animated: false },
        { id: 'candidate-task', source: 'candidate:a', target: 'task:a', type: 'evidence', animated: false },
      ],
    }
    expect(focusGraphForWorkspace(graph, 'review').nodes.map((node) => node.type)).toEqual(['shot', 'candidate'])
    expect(focusGraphForWorkspace(graph, 'review').edges.map((edge) => edge.id)).toEqual(['shot-candidate'])
    expect(focusGraphForWorkspace(graph, 'canvas')).toBe(graph)
  })
})

describe('本地用户引导偏好', () => {
  it('支持开始、暂停、恢复、完成与 guideVersion 升级', () => {
    const storage = new MemoryStorage()
    let state = startOnboarding(createOnboardingState(), 'project-switcher')
    state = completeOnboardingStep(state, 'project-switcher', 'stage-navigation')
    state = pauseOnboarding(state)
    saveOnboardingState(storage, state)
    expect(loadOnboardingState(storage)).toMatchObject({ status: 'dismissed', lastStepId: 'stage-navigation' })

    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ ...state, guideVersion: 'outdated' }))
    expect(loadOnboardingState(storage)).toEqual(createOnboardingState())
    expect(restartOnboarding().guideVersion).toBe(ONBOARDING_GUIDE_VERSION)
  })
})

describe('开发预览记录器', () => {
  it('默认关闭，只保存允许字段且不接收项目正文、路径或凭证', () => {
    const storage = new MemoryStorage()
    expect(recordPreviewEvent(false, storage, { workspace: 'script', action: 'import source', durationMs: 22, result: 'succeeded' })).toBeUndefined()
    expect(storage.getItem(PREVIEW_RECORDER_STORAGE_KEY)).toBeNull()

    recordPreviewEvent(true, storage, {
      workspace: 'tasks', action: 'reconcile unknown', durationMs: 12.4, result: 'failed', errorCode: 'provider timeout / secret',
    })
    const [event] = readPreviewEvents(storage)
    expect(event).toMatchObject({ workspace: 'tasks', action: 'reconcile_unknown', durationMs: 12, result: 'failed' })
    expect(Object.keys(event!)).toEqual(['workspace', 'action', 'durationMs', 'result', 'errorCode', 'timestamp'])
    expect(JSON.stringify(event)).not.toContain('secret')
  })
})
