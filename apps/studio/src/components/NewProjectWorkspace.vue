<template>
  <section
    class="new-project-workspace"
    aria-labelledby="new-project-title"
    data-figma-node="13:70"
    data-figma-spec="T/03-ProjectSetup"
  >
    <header class="new-project-workspace__topbar">
      <div class="new-project-workspace__brand"><Sparkles :size="18" aria-hidden="true" /><strong>新建项目</strong></div>
      <button type="button" :disabled="submitting" @click="cancelSetup">保存草稿并退出</button>
    </header>

    <div class="new-project-workspace__content">
      <ol class="new-project-workspace__steps" aria-label="新建项目步骤">
        <li :class="{ active: step === 1, completed: step > 1 }" :aria-current="step === 1 ? 'step' : undefined"><span>1</span><strong>内容</strong></li>
        <li :class="{ active: step === 2, completed: step > 2 }" :aria-current="step === 2 ? 'step' : undefined"><span>2</span><strong>视觉</strong></li>
        <li :class="{ active: step === 3 }" :aria-current="step === 3 ? 'step' : undefined"><span>3</span><strong>生成策略</strong></li>
      </ol>

      <form class="new-project-workspace__card" @submit.prevent="createSelectedProject">
        <header>
          <h1 id="new-project-title">{{ stepContent.title }}</h1>
          <p>{{ stepContent.description }}</p>
        </header>

        <fieldset :disabled="submitting || sessionInvalid">
          <legend class="sr-only">{{ stepContent.legend }}</legend>
          <label
            v-for="option in options"
            :key="option.id"
            class="new-project-workspace__option"
            :class="{ selected: currentSelection === option.id }"
          >
            <input v-model="currentSelection" type="radio" :name="`project-step-${step}`" :value="option.id" />
            <span><strong>{{ option.title }}</strong><small>{{ option.description }}</small></span>
            <span v-if="currentSelection !== option.id" class="new-project-workspace__radio" aria-hidden="true" />
            <span v-else class="new-project-workspace__selected" aria-hidden="true"><i />已<br />选择</span>
          </label>
        </fieldset>

        <p v-if="store.error" class="new-project-workspace__error" role="alert">
          <TriangleAlert :size="17" aria-hidden="true" />
          <span>
            <strong>{{ store.error.message }}</strong>
            <small>{{ sessionInvalid ? '会话恢复前不会创建项目或提交任何任务' : `${store.error.code} · 可以修正后再次提交` }}</small>
          </span>
        </p>

        <footer>
          <button v-if="step > 1" class="new-project-workspace__back" type="button" :disabled="submitting" @click="step -= 1">返回上一步</button>
          <span v-else />
          <button class="new-project-workspace__primary" type="submit" :disabled="submitting || sessionInvalid">
            <LoaderCircle v-if="submitting" class="spin" :size="18" aria-hidden="true" />
            <span>{{ submitting ? '正在创建本地项目' : actionLabel }}</span>
          </button>
        </footer>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { LoaderCircle, Sparkles, TriangleAlert } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { workspaceById, type StudioWorkspaceId } from '../workspaces.js'
import { useStudioStore } from '../stores/studio.js'

type ProjectOrigin = 'idea' | 'import' | 'demo'
type VisualDirection = 'cinematic' | 'motion_comic' | 'storyboard'
type GenerationStrategy = 'demo_local' | 'manual_provider' | 'configure_later'

const store = useStudioStore()
const route = useRoute()
const router = useRouter()
const step = ref<1 | 2 | 3>(1)
const selectedOrigin = ref<ProjectOrigin>('demo')
const selectedVisual = ref<VisualDirection>('cinematic')
const selectedStrategy = ref<GenerationStrategy>('demo_local')
const submitting = ref(false)
const sessionInvalid = computed(() => store.error?.code === 'UNAUTHORIZED')

const originOptions: ReadonlyArray<{ id: ProjectOrigin; title: string; description: string }> = [
  { id: 'idea', title: '从一句话开始', description: '创建创作简报并生成三个结构候选' },
  { id: 'import', title: '导入原著', description: '在隔离区预览 TXT、Markdown 或项目包' },
  { id: 'demo', title: '打开零 Key Demo', description: '加载《星阙回声》完整安全演示数据' },
]
const visualOptions: ReadonlyArray<{ id: VisualDirection; title: string; description: string }> = [
  { id: 'cinematic', title: '电影感漫剧', description: '低饱和光影、稳定角色身份与连续镜头语言' },
  { id: 'motion_comic', title: '动态漫画', description: '强化构图、对白节奏与轻量镜头运动' },
  { id: 'storyboard', title: '分镜预演', description: '优先验证叙事、节拍与镜头连续性' },
]
const strategyOptions: ReadonlyArray<{ id: GenerationStrategy; title: string; description: string }> = [
  { id: 'demo_local', title: '零 Key 本地演示', description: '使用确定性占位素材，不连接付费 Provider' },
  { id: 'manual_provider', title: '稍后连接 Provider', description: '先创建项目，生成前再配置系统凭证库' },
  { id: 'configure_later', title: '仅创建内容工作区', description: '暂不生成媒体，只进行简报、剧本与分镜' },
]

const stepContent = computed(() => {
  if (step.value === 2) return { title: '选择视觉方向', description: '先设置项目的视觉基线；人物、场景和镜头仍可在资产圣经中逐项调整。', legend: '项目视觉方向' }
  if (step.value === 3) return { title: '选择生成策略', description: '确定项目的默认执行边界。任何付费提交都需要再次确认。', legend: '项目生成策略' }
  return { title: '你想从哪里开始？', description: '内容来源决定初始化工作区，之后仍可导入或替换。', legend: '项目内容起点' }
})
const options = computed(() => step.value === 1 ? originOptions : step.value === 2 ? visualOptions : strategyOptions)
const currentSelection = computed({
  get: () => step.value === 1 ? selectedOrigin.value : step.value === 2 ? selectedVisual.value : selectedStrategy.value,
  set: (value: string) => {
    if (step.value === 1) selectedOrigin.value = value as ProjectOrigin
    else if (step.value === 2) selectedVisual.value = value as VisualDirection
    else selectedStrategy.value = value as GenerationStrategy
  },
})

const actionLabel = computed(() => {
  if (step.value === 1) return '继续配置视觉'
  if (step.value === 2) return '继续配置生成策略'
  return selectedOrigin.value === 'demo' ? '使用 Demo 内容创建' : '创建本地项目'
})

async function createSelectedProject(): Promise<void> {
  if (step.value < 3) {
    step.value = (step.value + 1) as 2 | 3
    return
  }
  if (submitting.value) return
  submitting.value = true
  store.error = undefined
  try {
    let project = selectedOrigin.value === 'demo'
      ? [...store.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find((item) => item.name === '星阙回声')
      : undefined
    if (project) await store.loadProject(project.id)
    else project = await store.createProject(
        selectedOrigin.value === 'import' ? '待导入原著' : selectedOrigin.value === 'idea' ? '未命名创作' : '星阙回声',
        selectedOrigin.value === 'demo'
          ? '本地确定性零 Key Demo：原创国风科幻漫剧素材，不需要 API Key，不发送付费请求。'
          : '本地优先项目：项目文件、媒体与任务快照仅保存在本机。',
      )
    if (!project || store.error) return

    if (selectedOrigin.value === 'demo') {
      if (!store.snapshot?.sources.length) await store.importSource(
          '星阙回声',
          '第一章 云海序幕\n苏绫乘坐档案艇穿过云海，停摆百年的星阙档案塔突然重新亮起。\n\n第二章 档案塔内\n苏绫与守卫玄戈进入塔厅，灵体零尾投射出残缺的星图坐标。\n\n第三章 星核显现\n苏绫在断裂的星图中发现一枚来自未来的司南星核，它记录着尚未发生的失踪事件。\n\n第四章 云市追逐\n失控的星核穿过云海机巧市，苏绫与玄戈沿着它留下的回声追逐。\n\n第五章 塔门开启\n司南星核嵌入塔门，失踪档案的封印在黎明前开始松动。\n\n第六章 星图回声\n第一束晨光穿过星图，新的未来坐标仍在继续闪烁。',
        )
      if (store.error) return
      if (!store.creativeBrief?.artifact) await store.saveCreativeBrief({
        goal: '一个守护失落记忆的机械人，陪同星图修复师穿过云上城市，寻找被隐藏的星阙档案。',
        targetAudience: '国风科幻漫剧观众',
        platform: 'generic',
        genre: '国风科幻',
        tone: '悬疑、克制、电影化，兼顾双主角关系与冒险节奏',
        targetDurationSeconds: 540,
        aspectRatio: '9:16',
        language: 'zh-CN',
        constraints: ['竖屏漫剧', '两位主角', '保留司南星核与星阙档案的因果线'],
      })
      if (store.error) return
      if (!store.snapshot?.plans.length) await store.createPlan()
      if (store.error) return
      await finishSetup(project.id, 'brief')
      return
    }

    await finishSetup(project.id, selectedOrigin.value === 'import' ? 'script' : 'brief')
  } finally {
    submitting.value = false
  }
}

async function finishSetup(projectId: string, destination: StudioWorkspaceId): Promise<void> {
  const definition = workspaceById(destination)
  await router.replace({
    name: 'studio',
    params: { projectId },
    query: { ...route.query, workspace: destination, view: definition.domainView },
  })
}

async function cancelSetup(): Promise<void> {
  await router.replace({
    name: 'studio',
    params: { projectId: store.currentProjectId },
    query: { ...route.query, workspace: 'project_center', view: 'story' },
  })
}
</script>
