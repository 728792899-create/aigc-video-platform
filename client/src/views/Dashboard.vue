<template>
  <div class="dashboard-view">
    <header class="dashboard-hero">
      <div>
        <p class="eyebrow">{{ $t('dashboard.title') }}</p>
        <h1>今天先把一条内容推进到可发布。</h1>
        <p class="hero-copy">{{ $t('dashboard.subtitle') }}</p>
      </div>
      <div class="hero-actions">
        <el-button type="primary" size="large" @click="scrollToTemplates">
          <el-icon><MagicStick /></el-icon>
          {{ $t('dashboard.primaryAction') }}
        </el-button>
        <el-button size="large" @click="router.push('/projects')">
          <el-icon><FolderOpened /></el-icon>
          {{ $t('dashboard.secondaryAction') }}
        </el-button>
        <el-button circle :loading="loading" :title="$t('dashboard.refresh')" @click="loadDashboard">
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>
    </header>

    <section class="metric-row" aria-label="workspace summary">
      <div class="metric-card">
        <span>{{ $t('dashboard.quickStatsProjects') }}</span>
        <strong>{{ projects.length }}</strong>
      </div>
      <div class="metric-card">
        <span>{{ $t('dashboard.quickStatsVideos') }}</span>
        <strong>{{ recentVideos.length }}</strong>
      </div>
      <div class="metric-card" :class="{ attention: repairItems.length }">
        <span>{{ $t('dashboard.quickStatsRepairs') }}</span>
        <strong>{{ repairItems.length + failedTasks.length }}</strong>
      </div>
      <div class="metric-card">
        <span>{{ $t('dashboard.quickStatsStorage') }}</span>
        <strong>{{ storageLabel }}</strong>
      </div>
    </section>

    <div v-if="loading && !projects.length" class="loading-panel">
      <el-icon class="spin"><Loading /></el-icon>
      <span>{{ $t('dashboard.loading') }}</span>
    </div>

    <section class="workspace-grid">
      <div class="main-column">
        <section class="section-block">
          <div class="section-head">
            <div>
              <h2>{{ $t('dashboard.continueTitle') }}</h2>
              <p>{{ $t('dashboard.projectProgress') }}</p>
            </div>
            <el-button text type="primary" @click="router.push('/projects')">
              {{ $t('dashboard.secondaryAction') }}
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>

          <div v-if="recentProjects.length" class="continue-list">
            <article
              v-for="project in recentProjects"
              :key="project.id"
              class="continue-card"
              @click="openProject(project)"
            >
              <div class="project-cover" :style="coverStyle(project)">
                <img
                  v-if="project.cover_url"
                  :src="mediaUrl(project.cover_url)"
                  :alt="project.name"
                  loading="lazy"
                  @error="project.cover_url = null"
                />
                <span v-else>{{ coverInitial(project.name) }}</span>
              </div>
              <div class="project-info">
                <div class="project-title-line">
                  <h3>{{ project.name }}</h3>
                  <span class="status-pill" :class="'status-' + project.status">{{ statusLabel(project.status) }}</span>
                </div>
                <p>{{ project.theme || $t('dashboard.noTheme') }}</p>
                <div class="project-meta">
                  <span>{{ relativeTime(project) }}</span>
                  <span class="asset-pill" :class="'asset-' + assetStatus(project)">
                    {{ assetLabel(project) }}
                  </span>
                </div>
              </div>
              <el-button class="continue-button" type="primary" plain @click.stop="openProject(project)">
                {{ $t('dashboard.continueButton') }}
              </el-button>
            </article>
          </div>

          <div v-else class="empty-panel">
            <h3>{{ $t('dashboard.continueEmptyTitle') }}</h3>
            <p>{{ $t('dashboard.continueEmptyDesc') }}</p>
            <el-button type="primary" @click="scrollToTemplates">{{ $t('dashboard.primaryAction') }}</el-button>
          </div>
        </section>

        <section ref="templateSection" class="section-block">
          <div class="section-head">
            <div>
              <h2>{{ $t('dashboard.templateTitle') }}</h2>
              <p>{{ $t('dashboard.templateSubtitle') }}</p>
            </div>
          </div>
          <div class="template-grid">
            <article v-for="tpl in templates" :key="tpl.id" class="template-card">
              <div class="template-top">
                <span>{{ tpl.category }}</span>
                <strong>{{ tpl.durationLabel }}</strong>
              </div>
              <h3>{{ tpl.name }}</h3>
              <p>{{ tpl.description }}</p>
              <div class="structure-line">
                <span v-for="step in tpl.structure" :key="step">{{ step }}</span>
              </div>
              <el-button type="primary" plain :loading="creatingId === tpl.id" @click="createFromTemplate(tpl)">
                {{ $t('dashboard.useTemplate') }}
              </el-button>
            </article>
          </div>
        </section>

        <section class="section-block">
          <div class="section-head">
            <div>
              <h2>{{ $t('dashboard.topicTitle') }}</h2>
              <p>{{ $t('dashboard.topicSubtitle') }}</p>
            </div>
          </div>
          <div class="topic-list">
            <article v-for="topic in dailyTopics" :key="topic.id" class="topic-row">
              <div class="topic-main">
                <span>{{ topic.platform }} / {{ topic.audience }}</span>
                <h3>{{ topic.title }}</h3>
                <p>{{ topic.hook }}</p>
              </div>
              <div class="topic-side">
                <strong>{{ topic.durationLabel }}</strong>
                <el-button :loading="creatingId === topic.id" @click="createFromTopic(topic)">
                  {{ $t('dashboard.useTopic') }}
                </el-button>
              </div>
            </article>
          </div>
        </section>
      </div>

      <aside class="side-column">
        <section class="section-block compact">
          <div class="section-head">
            <div>
              <h2>{{ $t('dashboard.repairTitle') }}</h2>
              <p>{{ $t('dashboard.repairSubtitle') }}</p>
            </div>
          </div>

          <div v-if="repairItems.length || failedTasks.length" class="repair-list">
            <article v-for="item in repairItems" :key="'asset-' + item.id" class="repair-item">
              <div>
                <span class="repair-kind">资产预检</span>
                <h3>{{ item.name }}</h3>
                <p>{{ repairSummary(item) }}</p>
              </div>
              <el-button size="small" type="primary" plain @click="openRepair(item)">
                {{ $t('dashboard.repairButton') }}
              </el-button>
            </article>

            <article v-for="task in failedTasks" :key="'task-' + task.id" class="repair-item">
              <div>
                <span class="repair-kind">生成失败</span>
                <h3>{{ task.project_name || task.theme || task.type }}</h3>
                <p>{{ diagnosisText(task) }}</p>
              </div>
              <el-button size="small" type="danger" plain @click="router.push('/history')">
                {{ $t('dashboard.historyButton') }}
              </el-button>
            </article>
          </div>

          <div v-else class="quiet-state">
            <el-icon><CircleCheck /></el-icon>
            <span>{{ $t('dashboard.repairEmpty') }}</span>
          </div>
        </section>

        <section class="section-block compact">
          <div class="section-head">
            <div>
              <h2>{{ $t('dashboard.recentTitle') }}</h2>
            </div>
            <el-button text type="primary" @click="router.push('/library')">
              {{ $t('dashboard.openLibrary') }}
            </el-button>
          </div>

          <div v-if="recentVideos.length" class="video-list">
            <article v-for="video in recentVideos" :key="video.id" class="video-item">
              <video v-if="video.file_exists !== false" :src="mediaUrl(video.file_url)" preload="metadata" />
              <div v-else class="video-missing">
                <el-icon><Warning /></el-icon>
              </div>
              <div>
                <h3>{{ video.project_name || '未命名项目' }}</h3>
                <p>{{ formatSize(video.file_size) }} · {{ formatDate(video.created_at) }}</p>
              </div>
              <el-button size="small" text type="primary" @click="router.push(`/projects/${video.project_id}/preview`)">
                {{ $t('dashboard.previewProject') }}
              </el-button>
            </article>
          </div>

          <div v-else class="quiet-state">
            <el-icon><VideoPlay /></el-icon>
            <span>{{ $t('dashboard.recentEmpty') }}</span>
          </div>
        </section>
      </aside>
    </section>
  </div>
</template>

<script setup lang="ts">
import { z } from 'zod'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import {
  ArrowRight,
  CircleCheck,
  FolderOpened,
  Loading,
  MagicStick,
  Refresh,
  VideoPlay,
  Warning,
} from '@element-plus/icons-vue'
import { listProjects, createProject } from '../api/projects'
import { getHistory, type HistoryRecord } from '../api/history'
import { listLibrary } from '../api/features'
import { getStorageStats, type StorageStats } from '../api/settings'
import { mediaUrl } from '../api/config'
import {
  projectCoverInitial,
  projectRelativeTime,
  type ProjectView,
} from '../domain/projects'

interface DashboardTemplate {
  id: string
  name: string
  category: string
  description: string
  duration: [number, number]
  durationLabel: string
  style: string
  structure: string[]
  sampleTheme: string
}

interface DailyTopic {
  id: string
  title: string
  hook: string
  platform: string
  audience: string
  templateId: string
  durationLabel: string
}

const LibraryVideoSchema = z.object({
  id: z.union([z.string(), z.number()]),
  project_id: z.union([z.string(), z.number()]),
  project_name: z.string().nullish(),
  file_url: z.string(),
  file_exists: z.boolean().optional(),
  file_size: z.number().nullish(),
  created_at: z.union([z.string(), z.number()]).nullish(),
}).passthrough()
type LibraryVideo = z.infer<typeof LibraryVideoSchema>

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const router = useRouter()
const { t } = useI18n()

const loading = ref(false)
const creatingId = ref('')
const projects = ref<ProjectView[]>([])
const failedTasks = ref<HistoryRecord[]>([])
const videos = ref<LibraryVideo[]>([])
const storage = ref<StorageStats | null>(null)
const templateSection = ref<HTMLElement | null>(null)

const templates: DashboardTemplate[] = [
  {
    id: 'knowledge_explainer',
    name: '知识科普短视频',
    category: '知识科普',
    description: '适合 AI 教程、行业知识和生活技巧，用清晰结构解释复杂问题。',
    duration: [60, 90],
    durationLabel: '60-90s',
    style: '写实',
    structure: ['痛点引入', '知识解释', '案例说明', '行动总结'],
    sampleTheme: '普通人如何用 AI 做一天的工作计划',
  },
  {
    id: 'product_seed',
    name: '产品种草脚本',
    category: '商业转化',
    description: '用痛点、场景和卖点串联，适合工具推荐、课程和服务介绍。',
    duration: [45, 75],
    durationLabel: '45-75s',
    style: '极简',
    structure: ['用户痛点', '产品出现', '核心卖点', '使用场景'],
    sampleTheme: '一款适合自媒体新手的 AI 视频工具',
  },
  {
    id: 'emotional_story',
    name: '情绪故事短片',
    category: '故事表达',
    description: '从场景、冲突到金句结尾，适合治愈、成长、反转类内容。',
    duration: [60, 100],
    durationLabel: '60-100s',
    style: '电影感',
    structure: ['场景铺垫', '冲突出现', '情绪转折', '金句结尾'],
    sampleTheme: '一个人真正开始变强的三个信号',
  },
  {
    id: 'city_promo',
    name: '城市宣传片',
    category: '文旅本地',
    description: '突出城市印象、街区场景和人文氛围，适合本地生活账号。',
    duration: [50, 90],
    durationLabel: '50-90s',
    style: '写实',
    structure: ['城市印象', '特色场景', '人文氛围', '行动召唤'],
    sampleTheme: '一条老街为什么值得被重新看见',
  },
  {
    id: 'ai_tutorial',
    name: 'AI 工具教程',
    category: '效率教程',
    description: '把工具使用流程讲得短、准、可复现，适合教程和口播。',
    duration: [45, 80],
    durationLabel: '45-80s',
    style: '蓝白科技感',
    structure: ['结果预览', '步骤拆解', '关键设置', '避坑提醒'],
    sampleTheme: '用 AI 三分钟生成短视频分镜脚本',
  },
  {
    id: 'brand_ad',
    name: '商业广告短片',
    category: '品牌表达',
    description: '从问题到解决方案再到品牌 CTA，适合官网、服务和案例展示。',
    duration: [30, 60],
    durationLabel: '30-60s',
    style: '极简',
    structure: ['品牌问题', '解决方案', '视觉冲击', '品牌 CTA'],
    sampleTheme: '面向小团队的本地 AI 内容生产工作台',
  },
]

const dailyTopics: DailyTopic[] = [
  {
    id: 'topic_ai_workday',
    title: '普通人如何用 AI 做一天的工作计划',
    hook: '从早上 9 点到下班前，把任务拆解、文案和复盘都交给 AI 协助。',
    platform: '抖音',
    audience: '职场效率',
    templateId: 'knowledge_explainer',
    durationLabel: '60s',
  },
  {
    id: 'topic_busy_no_output',
    title: '为什么你每天很忙却没有产出',
    hook: '用一个反常识观点切入，把忙碌和有效产出拆开讲清楚。',
    platform: '小红书',
    audience: '成长人群',
    templateId: 'emotional_story',
    durationLabel: '75s',
  },
  {
    id: 'topic_ai_pm',
    title: 'AI 产品经理和传统产品经理有什么不同',
    hook: '从工作流、模型能力边界和落地验证三个角度建立专业感。',
    platform: '视频号',
    audience: 'AI 从业者',
    templateId: 'knowledge_explainer',
    durationLabel: '90s',
  },
  {
    id: 'topic_local_street',
    title: '一条街区为什么值得被重新看见',
    hook: '把空间、商户、人流和城市记忆做成一条有温度的文旅短片。',
    platform: '抖音',
    audience: '本地生活',
    templateId: 'city_promo',
    durationLabel: '60s',
  },
  {
    id: 'topic_tool_beginner',
    title: '这款工具为什么适合自媒体新手',
    hook: '用新手痛点开场，强调低门槛、可复制流程和成片效率。',
    platform: '小红书',
    audience: '工具种草',
    templateId: 'product_seed',
    durationLabel: '45s',
  },
]

const recentProjects = computed(() => projects.value.slice(0, 4))
const recentVideos = computed(() => videos.value.slice(0, 3))
const repairItems = computed(() =>
  projects.value
    .filter((p) => ['failed', 'partial'].includes(p.status || '') || ['warn', 'error'].includes(assetStatus(p)))
    .slice(0, 5)
)
const storageLabel = computed(() => {
  const files = storage.value?.totalFiles || 0
  return files ? t('dashboard.filesCount', { n: files }) : '0'
})

async function loadDashboard() {
  loading.value = true
  try {
    const [projectList, failed, library, stats] = await Promise.allSettled([
      listProjects(),
      getHistory({ status: 'failed', page: 1, pageSize: 4 }),
      listLibrary(),
      getStorageStats(),
    ])
    if (projectList.status === 'fulfilled') projects.value = projectList.value || []
    if (failed.status === 'fulfilled') failedTasks.value = failed.value?.list || []
    if (library.status === 'fulfilled') videos.value = LibraryVideoSchema.array().parse(library.value)
    if (stats.status === 'fulfilled') storage.value = stats.value
    const rejected = [projectList, failed, library, stats].find((r) => r.status === 'rejected')
    if (rejected) throw rejected.reason
  } catch (cause) {
    ElMessage.warning(t('dashboard.loadFailed', { msg: errorMessage(cause) }))
  } finally {
    loading.value = false
  }
}

function scrollToTemplates() {
  templateSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function createFromTemplate(template: DashboardTemplate) {
  creatingId.value = template.id
  try {
    const theme = `${template.sampleTheme}。请按「${template.structure.join(' / ')}」结构生成，内容要有短视频开头钩子和明确结尾行动。`
    const project = await createProject({
      name: `${template.name}-${new Date().toLocaleDateString('zh-CN').replace(/\//g, '')}`,
      theme,
      style: template.style,
      duration_min: template.duration[0],
      duration_max: template.duration[1],
    })
    ElMessage.success(t('dashboard.createSuccess'))
    router.push(`/projects/${project.id}/script`)
  } catch (cause) {
    ElMessage.error(t('dashboard.createFailed', { msg: errorMessage(cause) }))
  } finally {
    creatingId.value = ''
  }
}

async function createFromTopic(topic: DailyTopic) {
  const template = templates.find((tpl) => tpl.id === topic.templateId) ?? templates[0]
  if (!template) return
  creatingId.value = topic.id
  try {
    const project = await createProject({
      name: topic.title.slice(0, 36),
      theme: `${topic.title}。爆点：${topic.hook}。适合平台：${topic.platform}。建议按「${template.structure.join(' / ')}」结构展开。`,
      style: template.style,
      duration_min: template.duration[0],
      duration_max: template.duration[1],
    })
    ElMessage.success(t('dashboard.createSuccess'))
    router.push(`/projects/${project.id}/script`)
  } catch (cause) {
    ElMessage.error(t('dashboard.createFailed', { msg: errorMessage(cause) }))
  } finally {
    creatingId.value = ''
  }
}

function openProject(project: ProjectView) {
  if (project.status === 'completed') router.push(`/projects/${project.id}/preview`)
  else if (assetStatus(project) === 'error') router.push(`/projects/${project.id}/images`)
  else router.push(`/projects/${project.id}/script`)
}

function openRepair(project: ProjectView) {
  const issues = project?.asset_health?.issues || []
  const primary = issues.find((i) => i.level === 'error') || issues[0]
  if (primary?.code === 'MISSING_IMAGES' || primary?.code === 'SELECTED_IMAGE_MISSING') {
    router.push(`/projects/${project.id}/images`)
  } else {
    router.push(`/projects/${project.id}/preview`)
  }
}

function statusLabel(status: string | null | undefined): string {
  const map: Record<string, string> = {
    draft: t('dashboard.statusDraft'),
    generating: t('dashboard.statusGenerating'),
    partial: t('dashboard.statusPartial'),
    failed: t('dashboard.statusFailed'),
    completed: t('dashboard.statusCompleted'),
  }
  return status ? map[status] || t('dashboard.statusDraft') : t('dashboard.statusDraft')
}

function assetStatus(project: ProjectView): 'ok' | 'warn' | 'error' | 'unknown' {
  const status = project?.asset_health?.status
  return status === 'ok' || status === 'warn' || status === 'error' ? status : 'unknown'
}

function assetLabel(project: ProjectView): string {
  const map: Record<'ok' | 'warn' | 'error' | 'unknown', string> = {
    ok: t('dashboard.assetOk'),
    warn: t('dashboard.assetWarn'),
    error: t('dashboard.assetError'),
    unknown: t('dashboard.assetUnknown'),
  }
  return map[assetStatus(project)] || map.unknown
}

function repairSummary(project: ProjectView): string {
  const issue = project?.asset_health?.issues?.[0]
  return issue?.message || project?.asset_health?.summary || assetLabel(project)
}

function diagnosisText(task: HistoryRecord): string {
  const diagnosis = task.diagnosis
  const reason = diagnosis && typeof diagnosis === 'object' && 'reason' in diagnosis && typeof diagnosis.reason === 'string'
    ? diagnosis.reason
    : ''
  return reason || task.error || task.message || '需要查看历史记录中的失败原因。'
}

const relativeTime = (project: ProjectView): string => projectRelativeTime(
  project,
  (key, values) => String(t(key.replace('projects.', 'dashboard.'), values ?? {})),
)
const coverInitial = projectCoverInitial

function hashString(str: unknown): number {
  let h = 0
  const s = String(str || '未命名')
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function coverStyle(project: ProjectView): { background: string } | null {
  if (project.cover_url) return null
  const h = hashString(project.name)
  const hue1 = 205 + (h % 32)
  const hue2 = 184 + (h % 44)
  return { background: `linear-gradient(135deg, hsl(${hue1} 78% 54%), hsl(${hue2} 62% 46%))` }
}

function formatSize(n: number | null | undefined): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = n
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx++
  }
  return `${value.toFixed(idx ? 1 : 0)} ${units[idx] ?? 'B'}`
}

function formatDate(value: string | number | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

onMounted(loadDashboard)
</script>

<style scoped>
.dashboard-view {
  max-width: 1440px;
  margin: 0 auto;
  padding: 4px 0 40px;
}

.dashboard-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  min-height: 210px;
  padding: 34px;
  border: 1px solid var(--separator);
  border-radius: 24px;
  background:
    linear-gradient(135deg, rgba(0, 122, 255, 0.13), rgba(90, 200, 250, 0.05) 44%, rgba(255, 255, 255, 0.54)),
    var(--bg-surface);
  box-shadow: var(--shadow-sm);
}

[data-theme="dark"] .dashboard-hero {
  background:
    linear-gradient(135deg, rgba(10, 132, 255, 0.24), rgba(90, 200, 250, 0.08) 48%, rgba(28, 28, 30, 0.66)),
    var(--bg-surface);
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}

.dashboard-hero h1 {
  max-width: 720px;
  margin: 0;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 42px;
  line-height: 1.08;
  letter-spacing: 0;
}

.hero-copy {
  max-width: 620px;
  margin: 16px 0 0;
  color: var(--text-second);
  font-size: 16px;
}

.hero-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.metric-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 18px 0;
}

.metric-card {
  min-height: 96px;
  padding: 18px;
  border: 1px solid var(--separator);
  border-radius: 18px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}

.metric-card span {
  display: block;
  color: var(--text-second);
  font-size: 13px;
}

.metric-card strong {
  display: block;
  margin-top: 10px;
  color: var(--text);
  font-size: 30px;
  line-height: 1;
}

.metric-card.attention {
  border-color: rgba(255, 159, 10, 0.38);
  background: linear-gradient(135deg, rgba(255, 159, 10, 0.12), var(--bg-surface));
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  gap: 18px;
  align-items: start;
}

.main-column,
.side-column {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.section-block {
  padding: 22px;
  border: 1px solid var(--separator);
  border-radius: 22px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}

.section-block.compact {
  padding: 18px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.section-head h2 {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  line-height: 1.2;
}

.section-head p {
  margin: 6px 0 0;
  color: var(--text-second);
  font-size: 13px;
}

.continue-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.continue-card {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--separator);
  border-radius: 16px;
  background: var(--bg-base);
  cursor: pointer;
  transition: transform 0.18s var(--ease-apple), border-color 0.18s var(--ease-apple), background 0.18s var(--ease-apple);
}

.continue-card:hover {
  transform: translateY(-2px);
  border-color: rgba(0, 122, 255, 0.28);
  background: var(--bg-surface);
}

.project-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 132px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 12px;
  color: #fff;
  font-size: 28px;
  font-weight: 700;
}

.project-cover img,
.video-item video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.project-title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.project-info h3,
.repair-item h3,
.video-item h3,
.template-card h3,
.topic-row h3 {
  margin: 0;
  color: var(--text);
  font-size: 15px;
  line-height: 1.35;
}

.project-title-line h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-info p,
.repair-item p,
.video-item p,
.template-card p,
.topic-row p {
  margin: 6px 0 0;
  color: var(--text-second);
  font-size: 13px;
  line-height: 1.5;
}

.project-info p {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.status-pill,
.asset-pill,
.repair-kind,
.template-top span,
.structure-line span {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.status-completed,
.asset-ok {
  background: rgba(52, 199, 89, 0.13);
  color: var(--success);
}

.status-failed,
.asset-error {
  background: rgba(255, 59, 48, 0.13);
  color: var(--danger);
}

.status-generating,
.status-partial,
.asset-warn {
  background: rgba(255, 159, 10, 0.14);
  color: var(--warning);
}

.asset-unknown {
  background: rgba(142, 142, 147, 0.12);
  color: var(--text-second);
}

.continue-button {
  min-width: 76px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.template-card {
  display: flex;
  flex-direction: column;
  min-height: 255px;
  padding: 18px;
  border: 1px solid var(--separator);
  border-radius: 16px;
  background: var(--bg-base);
}

.template-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.template-top strong {
  color: var(--text-muted);
  font-size: 12px;
}

.structure-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 14px 0 18px;
}

.structure-line span {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-second);
  font-weight: 500;
}

[data-theme="dark"] .structure-line span {
  background: rgba(255, 255, 255, 0.07);
}

.template-card .el-button {
  margin-top: auto;
}

.topic-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.topic-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px;
  gap: 16px;
  align-items: center;
  padding: 16px;
  border: 1px solid var(--separator);
  border-radius: 15px;
  background: var(--bg-base);
}

.topic-main span {
  display: block;
  margin-bottom: 6px;
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}

.topic-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.topic-side strong {
  color: var(--text-second);
  font-size: 13px;
}

.repair-list,
.video-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.repair-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--separator);
  border-radius: 15px;
  background: var(--bg-base);
}

.repair-kind {
  min-height: 22px;
  margin-bottom: 8px;
  background: rgba(255, 159, 10, 0.14);
  color: var(--warning);
}

.video-item {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--separator);
  border-radius: 15px;
  background: var(--bg-base);
}

.video-item video,
.video-missing {
  width: 86px;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  background: #000;
}

.video-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--warning);
}

.quiet-state,
.empty-panel,
.loading-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  gap: 10px;
  border: 1px dashed var(--border);
  border-radius: 16px;
  color: var(--text-second);
  background: var(--bg-base);
  text-align: center;
}

.empty-panel {
  flex-direction: column;
  padding: 24px;
}

.empty-panel h3 {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

.empty-panel p {
  margin: 0;
  color: var(--text-second);
}

.loading-panel {
  margin-bottom: 18px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1180px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .side-column {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 920px) {
  .dashboard-hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .dashboard-hero h1 {
    font-size: 32px;
  }

  .metric-row,
  .template-grid,
  .side-column {
    grid-template-columns: 1fr;
  }

  .continue-card,
  .topic-row,
  .repair-item,
  .video-item {
    grid-template-columns: 1fr;
  }

  .project-cover,
  .video-item video,
  .video-missing {
    width: 100%;
  }

  .topic-side {
    align-items: stretch;
  }
}
</style>
