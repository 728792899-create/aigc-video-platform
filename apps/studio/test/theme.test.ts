import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = resolve(process.cwd(), 'src')

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (/\s\d+\.(?:css|vue)$/.test(entry.name)) return []
    return /\.(?:css|vue)$/.test(entry.name) ? [path] : []
  }))
  return nested.flat()
}

describe('Obsidian Atelier runtime contract', () => {
  it('locks the final Figma dark semantic tokens', async () => {
    const css = await readFile(resolve(srcRoot, 'theme.css'), 'utf8')
    const semantics = {
      'surface-canvas': '#0f1418', 'surface-chrome': '#141b21', 'surface-panel': '#1a232a',
      'surface-raised': '#212c34', 'border-default': '#34414a', 'text-primary': '#ece8df',
      'text-secondary': '#b7b8b2', 'text-muted': '#8e9595', 'accent-primary': '#78958a',
      'status-info': '#66848c', 'status-warning': '#b09662', 'status-success': '#78947d',
      'status-danger': '#a7666d', 'status-unknown': '#817a94', 'focus-ring': '#9bb0a8',
    }
    for (const [name, value] of Object.entries(semantics)) {
      expect(css).toContain(`--${name}: ${value};`)
    }
    expect(css).toContain('color-scheme: dark')
    expect(css).not.toContain('.surface-warm')
  })

  it('defines every custom property consumed by Studio CSS and Vue templates', async () => {
    const files = await sourceFiles(srcRoot)
    const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    const combined = contents.join('\n')
    const definitions = new Set([...combined.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]))
    const references = new Set([...combined.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]))
    expect([...references].filter((name) => !definitions.has(name))).toEqual([])
    expect(definitions).toContain('--mint')
  })

  it('keeps raw color literals inside theme.css only', async () => {
    const files = (await sourceFiles(srcRoot)).filter((file) => !file.endsWith('/theme.css'))
    const violations: string[] = []
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(content)) violations.push(file.replace(`${srcRoot}/`, ''))
    }
    expect(violations).toEqual([])
  })

  it('uses one dark product theme without a persisted theme setting', async () => {
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    const workspaceHost = await readFile(resolve(srcRoot, 'components/StudioWorkspaceHost.vue'), 'utf8')
    const media = await readFile(resolve(srcRoot, 'components/MediaPreview.vue'), 'utf8')
    expect(studio).toContain(':data-view="store.view"')
    expect(workspaceHost).toContain('class="graph-stage surface-cinema"')
    expect(media).toContain('media-preview surface-cinema')
    expect(studio).not.toMatch(/themeOpen|themePreference|localStorage/)
  })

  it('uses a dark document scheme and matching Electron startup surface', async () => {
    const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8')
    const desktop = await readFile(resolve(process.cwd(), '../desktop/src/main.ts'), 'utf8')
    expect(html).toContain('<meta name="color-scheme" content="dark" />')
    expect(html).toContain('<meta name="theme-color" content="#0F1418" />')
    expect(desktop).toContain("backgroundColor: '#0F1418'")
  })

  it('starts the Agent drawer collapsed on narrow screens and keeps Delivery above the task tray', async () => {
    const agent = await readFile(resolve(srcRoot, 'components/AgentPanel.vue'), 'utf8')
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(agent).toContain("matchMedia?.('(max-width: 768px)')")
    expect(styles).toMatch(/@media \(max-width: 768px\)[\s\S]*\.delivery-panel \{[^}]*bottom: 106px;/)
  })

  it('routes the export Workspace primary action to the real export panel', async () => {
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    expect(studio).toContain("else if (id === 'export_settings') await focusGuideTarget('delivery-export')")
    expect(studio).not.toContain("else { systemsOpen.value = true; await focusGuideTarget('delivery-export') }")
  })

  it('implements the v2 single-sidebar shell instead of the v1 double navigation', async () => {
    const sidebar = await readFile(resolve(srcRoot, 'components/StudioSidebar.vue'), 'utf8')
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    for (const label of ['项目', '创作', '审阅', '任务', 'Prompt / Skill', 'Provider', '治理']) {
      expect(sidebar).toContain(`label: '${label}'`)
    }
    expect(sidebar.match(/label: '/g)).toHaveLength(7)
    expect(sidebar).not.toContain('studio-rail')
    expect(studio).toContain('<TaskTray v-if="!isProjectArea && !isFigmaV2Workspace"')
    expect(studio).toContain('<StudioOnboarding v-if="!isProjectArea && !isFigmaV2Workspace"')
    expect(studio).toContain("['brief', 'script', 'assets', 'shots', 'continuity', 'generation', 'review', 'timeline', 'prompt_skill', 'provider_connections', 'local_governance', 'tasks', 'export_settings']")
  })

  it('keeps the v2 Project Hub Figma node as the implementation source', async () => {
    const projectCenter = await readFile(resolve(srcRoot, 'components/ProjectCenterWorkspace.vue'), 'utf8')
    const host = await readFile(resolve(srcRoot, 'components/StudioWorkspaceHost.vue'), 'utf8')
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(projectCenter).toContain('data-figma-node="13:20"')
    expect(projectCenter).toContain('<h1 id="project-center-title"')
    expect(projectCenter).toContain('<dt><BadgeDollarSign')
    expect(projectCenter).toContain('本月预算</dt>')
    expect(projectCenter).toContain("$emit('resumeProject', currentProject.id)")
    expect(projectCenter).toContain('return `处理 ${attentionTasks.value} 个异常任务`')
    expect(projectCenter).toContain('个任务需要处理')
    expect(host).toContain("@resume-project=\"$emit('resumeProject', $event)\"")
    expect(studio).toContain('@resume-project="resumeProjectById"')
    expect(studio).toContain("const destination: StudioWorkspaceId = hasAttentionTask ? 'tasks' : hasPendingReview ? 'review' : 'brief'")
    expect(styles).toContain('.studio-sidebar { width: 240px; flex: 0 0 240px;')
    expect(styles).toContain('.studio-topbar { min-width: 0; min-height: 64px;')
    expect(styles).toContain('grid-template-columns: minmax(0, 1.55fr) minmax(360px, .75fr);')
    expect(styles).toContain('grid-column: 2; grid-row: 3; grid-template-columns: repeat(2, minmax(0, 1fr));')
    expect(styles).not.toContain('grid-template-columns: repeat(4, 254px);')
  })

  it('supports the v2 single-sidebar compact mode without duplicating navigation', async () => {
    const sidebar = await readFile(resolve(srcRoot, 'components/StudioSidebar.vue'), 'utf8')
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(sidebar).toContain("collapsed ? '展开主导航' : '收起主导航'")
    expect(sidebar).toContain("@click=\"$emit('toggleCollapse')\"")
    expect(studio).toContain("'studio-shell--sidebar-collapsed': sidebarCollapsed")
    expect(styles).toContain('.studio-shell.studio-shell--sidebar-collapsed .studio-sidebar,')
    expect(styles).toContain('width: 72px;')
    expect(styles).toContain('.studio-shell--sidebar-collapsed .studio-sidebar__item-copy { display: none; }')
    expect(styles).toContain('.project-center-workspace__header { min-height: 0; display: grid; grid-template-columns: 1fr;')
    expect(styles).toContain('.studio-shell[data-workspace] .studio-sidebar__brand { display: none; }')
  })

  it('keeps partial-generation recovery visible without expanding the full page', async () => {
    const generation = await readFile(resolve(srcRoot, 'components/GenerationWorkspace.vue'), 'utf8')
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(generation).toContain('仅重试失败候选')
    expect(generation).toContain('确认仅重试 ${failedCount.value} 个失败候选')
    expect(styles).toContain('.generation-workspace__tasks { max-height: 358px;')
    expect(styles).toContain('overflow-y: auto; scrollbar-width: thin;')
    expect(styles).toContain('.generation-workspace__tasks { max-height: none; padding-right: 0; overflow: visible; }')
    expect(styles).toContain('.generation-workspace__batch-heading select { min-width: 190px; height: 44px;')
  })

  it('keeps the primary editing and export navigation targets at least 44px tall', async () => {
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(styles).toContain('.script-workspace__title-input { height: 44px;')
    expect(styles).toContain('.studio-shell[data-workspace="export_settings"] .studio-stagebar button { width: 100%; min-height: 44px;')
    expect(styles).toContain('.studio-shell[data-workspace="export_settings"] .studio-stagebar button { width: 84px; min-height: 44px;')
  })

  it('implements the v2 standalone new-project wizard from Figma node 13:70', async () => {
    const wizard = await readFile(resolve(srcRoot, 'components/NewProjectWorkspace.vue'), 'utf8')
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    const host = await readFile(resolve(srcRoot, 'components/StudioWorkspaceHost.vue'), 'utf8')
    expect(wizard).toContain('data-figma-node="13:70"')
    expect(wizard).toContain("const selectedOrigin = ref<ProjectOrigin>('demo')")
    expect(wizard).toContain("return '继续配置视觉'")
    expect(wizard).toContain('使用 Demo 内容创建')
    expect(wizard).toContain('不发送付费请求')
    expect(wizard).toContain(':disabled="submitting || sessionInvalid"')
    expect(wizard).toContain('会话恢复前不会创建项目或提交任何任务')
    expect(studio).toContain('<NewProjectWorkspace')
    expect(studio).toContain('v-else-if="isProjectSetup"')
    expect(studio).toContain('v-if="sessionExpired"')
    expect(studio).toContain('本地会话需要重新建立')
    expect(studio).toContain('<a :href="sessionRecoveryAction">')
    expect(studio).toContain('/?return=')
    expect(studio).toContain('重新建立本地会话')
    expect(host).not.toContain("workspaceId === 'project_setup'")
  })

  it('never lets onboarding redirect an active creation workspace without user intent', async () => {
    const onboarding = await readFile(resolve(srcRoot, 'components/StudioOnboarding.vue'), 'utf8')
    expect(onboarding).toContain('const workspaceMismatch = computed')
    expect(onboarding).toContain('function openStepWorkspace()')
    expect(onboarding).not.toContain("emit('navigate', step.workspace)")
  })

  it('implements the v2 task diagnostics contract from Figma node 23:2', async () => {
    const taskCenter = await readFile(resolve(srcRoot, 'components/TaskCenterWorkspace.vue'), 'utf8')
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(taskCenter).toContain('data-figma-node="23:2"')
    expect(taskCenter).toContain('查询远端并对账')
    expect(taskCenter).toContain('确认仅重试 ${selectedBatch.failedCount} 个失败候选')
    expect(taskCenter).toContain("['failed', 'timed_out', 'cancelled', 'needs_attention'].includes(task.status)")
    expect(taskCenter).not.toContain("['outcome_unknown', 'orphaned'].includes(task.status) && task.retryable")
    expect(studio).toContain('<StudioStageNavigation v-if="!isProjectArea && !isOperationsWorkspace')
    expect(styles).toContain('.task-diagnostics__actions button { min-width: max-content; min-height: 44px;')
    expect(styles).toContain('.studio-shell[data-workspace="tasks"] .studio-sidebar__brand { display: none; }')
  })

  it('implements the v2 Prompt and Skill Registry contract from Figma node 23:111', async () => {
    const registry = await readFile(resolve(srcRoot, 'components/PromptOperationsWorkspace.vue'), 'utf8')
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(registry).toContain('data-figma-node="23:111"')
    expect(registry).toContain('data-figma-spec="T/16-PromptSkill"')
    expect(registry).toContain('保存为不可变 revision')
    expect(registry).toContain('运行本机黄金样例')
    expect(registry).toContain('发布到本机生产')
    expect(registry).toContain('从稳定版创建恢复 revision')
    expect(registry).toContain('Canary 10% · Planned / API Gap')
    expect(registry).toContain('disabled title="需要团队级发布契约"')
    expect(registry).not.toContain('publishCanary')
    expect(studio).toContain("['tasks', 'prompt_skill', 'provider_connections', 'local_governance'].includes(currentWorkspaceId.value)")
    expect(studio).toContain("'timeline', 'prompt_skill', 'provider_connections', 'local_governance', 'tasks'")
    expect(styles).toContain('.prompt-registry__button { min-height: 44px;')
    expect(styles).toContain('.studio-shell[data-workspace="prompt_skill"] .studio-sidebar__brand { display: none; }')
  })

  it('implements the v2 Provider and model connections contract from Figma node 24:2', async () => {
    const provider = await readFile(resolve(srcRoot, 'components/ProviderConnectionsWorkspace.vue'), 'utf8')
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(provider).toContain('data-figma-node="24:2"')
    expect(provider).toContain('data-figma-spec="T/17-Provider"')
    expect(provider).toContain('凭证从不出现在前端响应、日志、项目包或诊断导出中')
    expect(provider).toContain('运行脱敏连通性检查')
    expect(provider).toContain("confirmation: 'CREATE_LOCAL_PROVIDER_CONNECTION'")
    expect(provider).toContain("confirmation: 'REPLACE_PROVIDER_CREDENTIAL'")
    expect(provider).toContain("confirmation: 'UPDATE_PROVIDER_ROUTE_POLICY'")
    expect(provider).toContain('Provider 网络门禁已关闭，本次检查未发起任何外部请求')
    expect(provider).not.toContain('v-html')
    expect(studio).toContain("currentWorkspace.id === 'provider_connections'")
    expect(styles).toContain('.studio-shell[data-workspace="provider_connections"] .studio-sidebar { width: 216px;')
  })

  it('implements the v2 local security and backup contract from Figma node 24:100', async () => {
    const governance = await readFile(resolve(srcRoot, 'components/LocalGovernanceWorkspace.vue'), 'utf8')
    const studio = await readFile(resolve(srcRoot, 'views/DirectorStudio.vue'), 'utf8')
    const styles = await readFile(resolve(srcRoot, 'styles.css'), 'utf8')
    expect(governance).toContain('data-figma-node="24:100"')
    expect(governance).toContain('data-figma-spec="T/18-Governance"')
    expect(governance).toContain('云端能力（当前不启用）')
    expect(governance).toContain('账号、组织、成员、RBAC、Presence 和远程协作均已移出 Local v1')
    expect(governance).toContain('系统 Keychain / Credential Manager')
    expect(governance).toContain('正文、路径、凭证和 payload 不入库')
    expect(governance).toContain('credentialsIncluded: false')
    expect(governance).toContain('rawUserContentIncluded: false')
    expect(governance).toContain('从验证点恢复演练')
    expect(governance).not.toContain('v-html')
    expect(studio).toContain("currentWorkspace.id === 'local_governance'")
    expect(studio).toContain("['tasks', 'prompt_skill', 'provider_connections', 'local_governance']")
    expect(styles).toContain('.studio-shell[data-workspace="local_governance"] .studio-sidebar { width: 216px;')
  })
})
