import type { ProjectView } from '../domain/projects'
import type { StudioLayout } from '@aigc-video/contracts'
import type {
  StudioGraphSnapshot,
  StudioShotSummary,
  StudioTaskSummary,
} from '../domain/studioGraph'
import { getAssetLibrary } from './assets'
import { projectExports } from './features'
import { getHistory } from './history'
import { getStudioLayout, listProjects, type ProjectId } from './projects'
import {
  getArtifactState,
  getScriptWorkbenchStatus,
  listStoryboards,
  type EditableStoryboard,
  type WorkbenchStatus,
} from './script'

export interface StudioWorkspaceData {
  projects: ProjectView[]
  snapshot: StudioGraphSnapshot
  workbenchStatus: WorkbenchStatus | null
  layout: StudioLayout | null
  warnings: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function projectMatches(value: unknown, projectId: ProjectId): boolean {
  return value != null && String(value) === String(projectId)
}

function shotSummary(shot: EditableStoryboard): StudioShotSummary {
  const row = record(shot)
  return {
    id: shot.id ?? `scene-${shot.scene_number}`,
    sceneNumber: shot.scene_number,
    description: shot.description,
    hasSelectedImage: Boolean(shot.selected_image_id || shot.selected_image_url),
    hasVoice: Boolean(shot.no_voice || text(row.audio_url)),
    hasSubtitle: Boolean(shot.subtitle_text?.trim()),
    stale: Boolean(shot.assets_stale),
  }
}

export function toStudioTaskSummary(value: unknown): StudioTaskSummary {
  const task = record(value)
  const result = record(task.result)
  const diagnosis = record(task.diagnosis)
  const status = text(task.status)
  return {
    id: text(task.id),
    type: text(task.type),
    status,
    error: text(task.error) || text(task.message) || text(diagnosis.reason),
    retryable: status === 'failed' || status === 'partial' || diagnosis.retryable === true,
    currentStage: text(result.current_stage) || null,
  }
}

export function mergeStudioTaskSummaries(
  snapshot: StudioTaskSummary[],
  realtime: StudioTaskSummary[],
): StudioTaskSummary[] {
  const merged = new Map(snapshot.map((task) => [task.id, task]))
  for (const task of realtime) {
    if (task.id) merged.set(task.id, task)
  }
  return [...merged.values()]
}

function warningFor(name: string, result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled') return null
  const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
  return `${name}：${message}`
}

export async function loadStudioWorkspace(projectId: ProjectId): Promise<StudioWorkspaceData> {
  const [projectsResult, shotsResult, assetsResult, exportsResult, artifactsResult, historyResult, statusResult, layoutResult] = await Promise.allSettled([
    listProjects(),
    listStoryboards(projectId),
    getAssetLibrary(projectId),
    projectExports(projectId),
    getArtifactState(projectId),
    getHistory({ page: 1, pageSize: 100 }),
    getScriptWorkbenchStatus(projectId),
    getStudioLayout(projectId),
  ])

  if (projectsResult.status === 'rejected') throw projectsResult.reason
  const projects = projectsResult.value
  const project = projects.find((candidate) => projectMatches(candidate.id, projectId))
  if (!project) throw new Error('项目不存在或已移入回收站')

  const shots = shotsResult.status === 'fulfilled' ? shotsResult.value : []
  const assets = assetsResult.status === 'fulfilled' ? assetsResult.value : null
  const exports = exportsResult.status === 'fulfilled' ? exportsResult.value : []
  const artifacts = artifactsResult.status === 'fulfilled' ? artifactsResult.value : null
  const history = historyResult.status === 'fulfilled'
    ? historyResult.value.list.filter((task) => projectMatches(task.project_id, projectId))
    : []

  const warnings = [
    warningFor('分镜', shotsResult),
    warningFor('资产', assetsResult),
    warningFor('导出', exportsResult),
    warningFor('阶段产物', artifactsResult),
    warningFor('任务', historyResult),
    warningFor('工作台状态', statusResult),
    warningFor('画布布局', layoutResult),
  ].filter((value): value is string => Boolean(value))

  return {
    projects,
    snapshot: {
      project: {
        id: project.id,
        name: project.name,
        theme: project.theme,
        status: project.status,
        scriptContent: project.script_content,
      },
      storyboards: shots.map(shotSummary),
      assetUnitCount: assets?.units.length ?? 0,
      bindingCount: assets?.bindings.length ?? 0,
      successfulExportCount: exports.filter((item) => (
        ['success', 'completed', 'ready'].includes(item.status) && Boolean(item.file_url || item.file_path)
      )).length,
      staleStages: artifacts?.stale.map((artifact) => artifact.stage) ?? [],
      tasks: history.map(toStudioTaskSummary).filter((task) => Boolean(task.id)),
    },
    workbenchStatus: statusResult.status === 'fulfilled' ? statusResult.value : null,
    layout: layoutResult.status === 'fulfilled' ? layoutResult.value : null,
    warnings,
  }
}
