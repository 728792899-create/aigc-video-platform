<template>
  <section class="project-center-workspace" aria-labelledby="project-center-title" data-figma-node="13:20">
    <header class="project-center-workspace__header">
      <div>
        <span class="eyebrow">LOCAL PRODUCTION</span>
        <h1 id="project-center-title">项目中心</h1>
        <p>恢复最近现场，或开始一个新的本地项目。</p>
      </div>
      <button class="project-center-workspace__new" type="button" :disabled="store.loading" @click="$emit('startSetup')"><Plus :size="17" />新建项目</button>
    </header>

    <section v-if="currentProject" class="project-center-workspace__resume" aria-label="恢复最近现场">
      <div>
        <span class="project-center-workspace__resume-label"><Activity :size="14" />恢复现场</span>
        <strong>继续《{{ currentProject.name }}》· 上次制作现场</strong>
        <p>最近保存 {{ formatUpdatedAt(currentProject.updatedAt) }} · {{ pendingReviewCount }} 个镜头待审阅 · {{ attentionTasks }} 个任务需要处理</p>
      </div>
      <button type="button" :disabled="store.loading" @click="$emit('resumeProject', currentProject.id)">{{ resumeLabel }} <ArrowRight :size="16" aria-hidden="true" /></button>
    </section>

    <section class="project-center-workspace__recent" aria-labelledby="recent-projects-title">
      <h2 id="recent-projects-title">全部项目</h2>
      <div v-if="store.projects.length" class="project-center-workspace__grid">
        <button
          v-for="project in sortedProjects"
          :key="project.id"
          type="button"
          :disabled="store.loading"
          :class="{ active: project.id === store.currentProjectId }"
          @click="$emit('selectProject', project.id)"
        >
          <span class="project-center-workspace__project-icon"><FolderKanban :size="18" /></span>
          <span><strong>《{{ project.name }}》</strong><small>{{ project.description || `本地项目 · ${formatUpdatedAt(project.updatedAt)}更新` }}</small></span>
          <ArrowUpRight :size="16" aria-hidden="true" />
        </button>
      </div>
      <div v-else class="workspace-empty-state">
        <h3>还没有本地项目</h3>
        <p>创建空项目，或打开零 Key Demo 验证完整流程。</p>
        <button class="project-center-workspace__new" type="button" :disabled="store.loading" @click="$emit('startSetup')">创建项目或打开 Demo</button>
      </div>
    </section>

    <dl class="project-center-workspace__metrics">
      <div><dt><LoaderCircle :size="14" />运行任务</dt><dd>{{ runningTasks }}</dd><small>实时任务状态</small></div>
      <div><dt><ClipboardCheck :size="14" />待审阅</dt><dd>{{ pendingReviewCount }}</dd><small>需要选择候选</small></div>
      <div><dt><BadgeDollarSign :size="14" />本月预算</dt><dd class="project-center-workspace__metric-warning">{{ store.generationPolicy?.billingMode === 'user-funded' ? '按调用' : '¥ 0' }}</dd><small>零 Key Demo</small></div>
      <div><dt><HardDrive :size="14" />本地空间</dt><dd>本机</dd><small>数据不上传</small></div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Activity, ArrowRight, ArrowUpRight, BadgeDollarSign, ClipboardCheck, FolderKanban, HardDrive, LoaderCircle, Plus } from 'lucide-vue-next'
import { useStudioStore } from '../stores/studio.js'

defineEmits<{ startSetup: []; selectProject: [projectId: string]; resumeProject: [projectId: string] }>()
const store = useStudioStore()
const attentionTasks = computed(() => store.tasks.filter((task) => ['failed', 'timed_out', 'orphaned', 'outcome_unknown', 'needs_attention'].includes(task.status)).length)
const runningTasks = computed(() => store.tasks.filter((task) => ['queued', 'running', 'reconciling'].includes(task.status)).length)
const pendingReviewCount = computed(() => store.snapshot?.shots.filter((shot) => !shot.selectedCandidateId).length ?? 0)
const resumeLabel = computed(() => {
  if (attentionTasks.value > 0) return `处理 ${attentionTasks.value} 个异常任务`
  if (pendingReviewCount.value > 0) return `继续审阅 ${pendingReviewCount.value} 个镜头`
  return '恢复创作现场'
})
const sortedProjects = computed(() => [...store.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
const currentProject = computed(() => store.currentProject ?? sortedProjects.value[0])
function formatUpdatedAt(value: string): string {
  const minutes = Math.round((Date.parse(value) - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(hours, 'hour')
  return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(Math.round(hours / 24), 'day')
}
</script>
