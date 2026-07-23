<template>
  <Teleport to="body">
    <section
      v-if="visible"
      ref="cardRef"
      class="onboarding-card"
      :class="`onboarding-card--${placement}`"
      :style="cardStyle"
      :data-placement="placement"
      role="dialog"
      aria-modal="false"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-description"
    >
      <span v-if="!targetMissing && placement !== 'fallback'" class="onboarding-card__arrow" aria-hidden="true" />
      <header>
        <span class="eyebrow">定向导览 · {{ stepIndex + 1 }}/{{ steps.length }}</span>
        <button class="icon-button" type="button" aria-label="暂停导览，稍后继续" @click="pause"><X :size="17" /></button>
      </header>
      <div class="onboarding-card__progress" role="progressbar" :aria-valuenow="stepIndex + 1" aria-valuemin="1" :aria-valuemax="steps.length"><i :style="{ width: `${((stepIndex + 1) / steps.length) * 100}%` }" /></div>
      <p class="onboarding-card__location"><MapPin :size="14" />{{ currentStep.location }}</p>
      <h2 id="onboarding-title">{{ currentStep.title }}</h2>
      <p id="onboarding-description">{{ currentStep.description }}</p>
      <p v-if="targetMissing" class="inline-alert"><Info :size="15" />目标控件当前不可见。你可以打开本阶段帮助，或继续下一步。</p>
      <div class="onboarding-card__actions">
        <button v-if="stepIndex > 0" class="secondary-button" type="button" @click="previous"><ArrowLeft :size="15" />上一步</button>
        <button class="secondary-button" type="button" @click="pause">稍后继续</button>
        <button v-if="workspaceMismatch" class="secondary-button" type="button" @click="openStepWorkspace">前往{{ currentStep.location }}</button>
        <button v-else-if="targetMissing" class="secondary-button" type="button" @click="$emit('openHelp')">打开阶段帮助</button>
        <button class="primary-button" type="button" @click="advance">{{ stepIndex === steps.length - 1 ? '完成并进入本地安全' : currentStep.action }}<ArrowRight :size="15" /></button>
      </div>
    </section>
    <button v-else-if="state.status === 'dismissed' && !guideSuppressed" class="onboarding-resume" type="button" @click="resume"><Play :size="15" />从第 {{ stepIndex + 1 }} 步继续导览</button>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import { ArrowLeft, ArrowRight, Info, MapPin, Play, X } from 'lucide-vue-next'
import {
  completeOnboardingStep, createOnboardingState, loadOnboardingState, pauseOnboarding,
  restartOnboarding, saveOnboardingState, startOnboarding, type OnboardingState,
} from '../onboarding.js'
import type { StudioWorkspaceId } from '../workspaces.js'

type GuideStep = {
  id: string
  target: string
  workspace?: StudioWorkspaceId
  location: string
  title: string
  description: string
  action: string
}
type Placement = 'left' | 'right' | 'top' | 'bottom' | 'fallback'

const props = defineProps<{ activeWorkspace: StudioWorkspaceId }>()
const emit = defineEmits<{ openHelp: []; navigate: [workspace: StudioWorkspaceId] }>()

const steps: GuideStep[] = [
  { id: 'project-switcher', target: 'project-switcher', workspace: 'project_center', location: '顶部项目入口', title: '先选择明确的本地起点', description: '创建空项目、打开原创零 Key Demo，或隔离导入项目包。这里不要求登录，也不连接云端数据库。', action: '查看八阶段路径' },
  { id: 'stage-navigation', target: 'stage-navigation', location: '顶部横向阶段栏', title: '按八个创作阶段推进', description: '简报到导出是唯一主路径；锁定阶段会说明缺少什么，并提供可执行的修复入口。', action: '查看当前任务' },
  { id: 'journey-guide', target: 'journey-guide', location: '工作区任务清单', title: '只关注此刻最重要的一步', description: '这里显示为什么现在做、完成条件和唯一主操作。进度由项目快照推导，不需要手工勾选。', action: '查看领域画布' },
  { id: 'canvas', target: 'canvas', workspace: 'canvas', location: '可视化制作画布', title: '用领域图追踪对象与依赖', description: '图谱解释 Story、Production、Delivery 的关系；列表模式提供键盘操作和大规模浏览替代。', action: '查看对象检查器' },
  { id: 'inspector', target: 'inspector', workspace: 'canvas', location: '画布右侧检查器', title: '选中对象后在这里修复', description: '来源、revision、候选、连续性和诊断操作都与当前对象绑定，不会在页面之间丢失事实上下文。', action: '查看任务恢复' },
  { id: 'task-center', target: 'task-center', workspace: 'tasks', location: '任务中心与诊断', title: '区分失败、部分成功和结果未知', description: '未知结果必须先对账；失败阶段可以创建新 Attempt；已经成功的候选不会被覆盖。', action: '查看快速跳转' },
  { id: 'command-palette', target: 'command-palette', location: '页头 ⌘K / Ctrl+K', title: '随时快速跳到 16 个 Workspace', description: '命令面板与主侧栏使用同一注册表，浏览器前进、后退和深链接保持一致。', action: '查看本地安全边界' },
  { id: 'systems', target: 'systems', workspace: 'local_governance', location: '本地安全、恢复与备份', title: '最后确认隐私与恢复边界', description: '凭证进入系统 Keychain 或 Docker Secret；诊断包不包含正文、路径、Prompt、凭证或 Provider payload。', action: '完成导览' },
]

const storage = typeof window === 'undefined' ? undefined : window.localStorage
const state = ref<OnboardingState>(createOnboardingState())
const targetMissing = ref(false)
const placement = ref<Placement>('fallback')
const cardStyle = ref<CSSProperties>({})
const cardRef = ref<HTMLElement>()
let highlighted: HTMLElement | undefined

const stepIndex = computed(() => {
  const index = steps.findIndex((step) => step.id === state.value.lastStepId)
  return index < 0 ? 0 : index
})
const currentStep = computed(() => steps[stepIndex.value]!)
const guideSuppressed = computed(() => props.activeWorkspace === 'brief' || props.activeWorkspace === 'script')
const visible = computed(() => state.value.status === 'in_progress' && !guideSuppressed.value)
const workspaceMismatch = computed(() => Boolean(currentStep.value.workspace && currentStep.value.workspace !== props.activeWorkspace))

function persist(next: OnboardingState): void { state.value = saveOnboardingState(storage, next) }
function clearHighlight(): void { highlighted?.removeAttribute('data-onboarding-active'); highlighted = undefined }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(Math.max(value, minimum), Math.max(minimum, maximum)) }
function fallbackPosition(): void {
  placement.value = 'fallback'
  cardStyle.value = window.innerWidth <= 768 ? { right: '10px', bottom: '174px' } : { right: '22px', bottom: '74px' }
}
function positionCard(target: HTMLElement): void {
  if (window.innerWidth <= 768 || !cardRef.value) { fallbackPosition(); return }
  const gap = 18
  const margin = 12
  const targetRect = target.getBoundingClientRect()
  const cardRect = cardRef.value.getBoundingClientRect()
  const width = cardRect.width || 390
  const height = cardRect.height || 260
  let left = margin
  let top = margin
  if (targetRect.right + gap + width <= window.innerWidth - margin) {
    placement.value = 'right'; left = targetRect.right + gap; top = clamp(targetRect.top + targetRect.height / 2 - height / 2, margin, window.innerHeight - height - margin)
  } else if (targetRect.left - gap - width >= margin) {
    placement.value = 'left'; left = targetRect.left - gap - width; top = clamp(targetRect.top + targetRect.height / 2 - height / 2, margin, window.innerHeight - height - margin)
  } else if (targetRect.bottom + gap + height <= window.innerHeight - margin) {
    placement.value = 'bottom'; left = clamp(targetRect.left + targetRect.width / 2 - width / 2, margin, window.innerWidth - width - margin); top = targetRect.bottom + gap
  } else {
    placement.value = 'top'; left = clamp(targetRect.left + targetRect.width / 2 - width / 2, margin, window.innerWidth - width - margin); top = Math.max(margin, targetRect.top - gap - height)
  }
  cardStyle.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, right: 'auto', bottom: 'auto' }
}
async function focusTarget(): Promise<void> {
  clearHighlight()
  if (!visible.value) return
  const step = currentStep.value
  if (step.workspace && step.workspace !== props.activeWorkspace) {
    targetMissing.value = true
    fallbackPosition()
    return
  }
  await nextTick()
  const target = document.querySelector<HTMLElement>(`[data-onboarding-target="${step.target}"]`)
  targetMissing.value = !target
  if (!target) { fallbackPosition(); return }
  highlighted = target
  target.setAttribute('data-onboarding-active', 'true')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  await nextTick()
  positionCard(target)
}
function advance(): void {
  const next = steps[stepIndex.value + 1]
  persist(completeOnboardingStep(state.value, currentStep.value.id, next?.id))
}
function openStepWorkspace(): void {
  const workspace = currentStep.value.workspace
  if (workspace) emit('navigate', workspace)
}
function previous(): void {
  const previousStep = steps[Math.max(0, stepIndex.value - 1)]!
  persist({ ...state.value, status: 'in_progress', lastStepId: previousStep.id })
}
function pause(): void { clearHighlight(); persist(pauseOnboarding(state.value)) }
function resume(): void { persist(startOnboarding(state.value, state.value.lastStepId ?? steps[0]!.id)) }
function restart(): void { persist(startOnboarding(restartOnboarding(), steps[0]!.id)) }
function reposition(): void { if (highlighted) positionCard(highlighted) }

watch([() => state.value.lastStepId, () => props.activeWorkspace, visible], () => { void focusTarget() })
onMounted(() => {
  state.value = loadOnboardingState(storage)
  if (state.value.status === 'not_started') persist(startOnboarding(state.value, steps[0]!.id))
  else void focusTarget()
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
})
onBeforeUnmount(() => {
  clearHighlight()
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition, true)
})
defineExpose({ restart, pause, resume })
</script>
