import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const view = readFileSync(resolve(here, '..', 'views', 'DirectorStudio.vue'), 'utf8')
const router = readFileSync(resolve(here, '..', 'router', 'index.ts'), 'utf8')
const graph = readFileSync(resolve(here, '..', 'domain', 'studioGraph.ts'), 'utf8')

describe('原创 AI 导演工作室契约', () => {
  it('以画布作为默认入口，同时保留快速模式与旧阶段路由', () => {
    expect(router).toContain("{ path: '/', redirect: '/studio' }")
    expect(router).toContain("path: '/studio/:id?'")
    expect(view).toContain("router.push(`/projects/${encodeURIComponent(activeProjectId.value)}/script`)")
  })

  it('视觉资产节点进入独立的分层资产工作台', () => {
    expect(router).toContain("path: '/projects/:id/assets'")
    expect(graph).toContain('assets: `/projects/${projectId}/assets`')
  })

  it('新工作区使用原生自研控件，不依赖 Element Plus 组件', () => {
    expect(view).not.toContain('<el-')
    expect(view).toContain('<StudioButton')
    expect(view).toContain('<StudioInspector')
  })

  it('画布写操作受限，提供键盘与列表替代路径', () => {
    expect(view).toContain(':nodes-connectable="false"')
    expect(view).toContain("event.key.toLowerCase() === 'l'")
    expect(view).toContain("event.key === 'Enter'")
    expect(view).toContain('viewMode === \'list\'')
  })

  it('后端重启或弱网时显示可行动错误并自动退避重连', () => {
    expect(view).toContain("loadError.value = cause instanceof Error")
    expect(view).toContain('scheduleInitializeRetry()')
    expect(view).toContain('Math.min(10_000')
    expect(view).toContain('retryInitialize')
  })

  it('领域图保留稳定 ID、stale 和失败诊断，而不是把 Vue Flow JSON 当业务事实', () => {
    expect(graph).toContain('project:${projectId}:${kind}')
    expect(graph).toContain("status: 'failed'")
    expect(graph).toContain("state: sourceNode?.stale || targetNode?.stale")
  })
})
