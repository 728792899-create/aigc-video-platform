<template>
  <section
    class="creative-brief"
    data-guide-target="creative-brief"
    data-figma-node="14:2"
    data-figma-spec="T/04-Brief"
    aria-labelledby="creative-brief-title"
    tabindex="-1"
  >
    <header class="creative-brief__page-heading">
      <h1 id="creative-brief-title">创作简报</h1>
      <p>把原始意图整理成可批准、可追溯的创作约束。</p>
    </header>

    <p v-if="state.invalidArtifactIds.length" class="creative-brief__warning" role="alert">
      已隔离 {{ state.invalidArtifactIds.length }} 个异常历史版本；它们不会覆盖当前批准稿。
    </p>

    <div class="creative-brief__decision-grid">
      <button class="creative-brief__intent" type="button" @click="openEditor('intent')">
        <span class="creative-brief__panel-title">原始意图</span>
        <span class="creative-brief__intent-copy">{{ state.brief.goal }}</span>
        <span class="creative-brief__locked-label">已锁定</span>
        <span class="creative-brief__locked-list">
          <span v-for="item in lockedSummary" :key="item"><Check :size="12" aria-hidden="true" />{{ item }}</span>
        </span>
        <span class="sr-only">打开完整创作约束编辑器</span>
      </button>

      <section class="creative-brief__candidates" aria-labelledby="brief-candidates-title">
        <button id="brief-candidates-title" class="creative-brief__section-action" type="button" @click="openEditor('candidates')">
          结构候选
          <span class="sr-only">打开候选生成与字段锁定设置</span>
        </button>
        <button
          v-for="candidate in displayCandidates"
          :key="candidate.id"
          class="creative-brief__candidate"
          :class="{ selected: selectedCandidateId === candidate.id, rejected: candidate.status === 'rejected' }"
          type="button"
          :aria-pressed="selectedCandidateId === candidate.id"
          :disabled="candidate.status === 'rejected'"
          @click="selectCandidate(candidate.id)"
        >
          <span><strong>{{ candidate.title }}</strong><small>{{ candidate.summary }}</small></span>
          <span v-if="selectedCandidateId === candidate.id" class="creative-brief__selection">
            <CircleDot :size="15" aria-hidden="true" />已选中
          </span>
          <Circle v-else :size="15" aria-hidden="true" />
        </button>
      </section>

      <aside class="creative-brief__inspector" aria-labelledby="brief-impact-title">
        <h2 id="brief-impact-title">批准与影响</h2>
        <div class="creative-brief__impact-copy">
          <p>批准后将创建：</p>
          <ul>
            <li>Episode 01</li>
            <li>{{ estimatedSceneCount }} 个 Scene 草案</li>
            <li>角色与场景占位资产</li>
          </ul>
          <p>修改锁定字段会使下游剧本、分镜标记为 stale。</p>
          <p v-if="state.staleSceneCount || state.staleShotCount" class="creative-brief__stale" role="status">
            当前已有 {{ state.staleSceneCount }} 个场景、{{ state.staleShotCount }} 个镜头等待局部修复。
          </p>
        </div>
        <button class="creative-brief__approve" type="button" :disabled="busy" @click="approveSelected">
          <LoaderCircle v-if="busy" class="spin" :size="16" aria-hidden="true" />
          <span>{{ approveArmed ? '再次确认批准并创建剧本' : '批准简报并创建剧本' }}</span>
        </button>
      </aside>
    </div>

    <div v-show="editorOpen" class="creative-brief__editor-backdrop" role="presentation" @mousedown.self="closeEditor">
      <section class="creative-brief__editor" role="dialog" aria-modal="true" :aria-labelledby="editorMode === 'intent' ? 'brief-editor-title' : 'brief-candidate-tools-title'">
        <header>
          <div>
            <h2 :id="editorMode === 'intent' ? 'brief-editor-title' : 'brief-candidate-tools-title'">
              {{ editorMode === 'intent' ? '编辑创作约束' : '生成与审阅候选' }}
            </h2>
            <p>{{ editorMode === 'intent' ? '保存会创建新 revision，历史版本不会被覆盖。' : 'Demo Provider 只追加候选，不会自动改变当前批准稿。' }}</p>
          </div>
          <button ref="closeButtonRef" class="icon-button" type="button" aria-label="关闭简报工作层" @click="closeEditor"><X :size="18" /></button>
        </header>

        <form v-show="editorMode === 'intent'" class="creative-brief__form" @submit.prevent="submit">
          <label>创作目标<textarea v-model.trim="draft.goal" required maxlength="2000" rows="3" /></label>
          <label>目标观众<input v-model.trim="draft.targetAudience" required maxlength="500" /></label>
          <div class="creative-brief__grid">
            <label>发布平台<select v-model="draft.platform"><option value="generic">通用</option><option value="douyin">抖音</option><option value="kuaishou">快手</option><option value="bilibili">Bilibili</option><option value="youtube">YouTube</option></select></label>
            <label>画幅<select v-model="draft.aspectRatio"><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option><option value="4:3">4:3</option></select></label>
            <label>类型<input v-model.trim="draft.genre" required maxlength="200" /></label>
            <label>目标时长（秒）<input v-model.number="draft.targetDurationSeconds" required type="number" min="5" max="3600" /></label>
          </div>
          <label>基调<textarea v-model.trim="draft.tone" required maxlength="500" rows="2" /></label>
          <label>语言<input v-model.trim="draft.language" required minlength="2" maxlength="16" /></label>
          <label>不可破坏的约束（每行一条）<textarea v-model="constraintsText" maxlength="15000" rows="4" /></label>
          <footer><button type="button" @click="closeEditor">取消</button><button class="primary-button" type="submit">保存新版本</button></footer>
        </form>

        <section v-show="editorMode === 'candidates'" class="creative-brief__review">
          <label>本轮反馈<textarea v-model.trim="candidateFeedback" maxlength="2000" rows="2" placeholder="例如：加强行动节奏，但保留原著结局" /></label>
          <fieldset class="creative-brief__locks">
            <legend>生成时锁定字段</legend>
            <label v-for="field in fieldOptions" :key="field.id"><input v-model="lockedFields" type="checkbox" :value="field.id" />{{ field.label }}</label>
          </fieldset>
          <button class="secondary-button" type="button" @click="generate">生成 3 个候选</button>
          <div v-if="state.candidates.length" class="creative-brief__review-list">
            <article v-for="candidate in state.candidates" :key="candidate.artifact.id" :class="`creative-brief__review-candidate creative-brief__review-candidate--${candidate.artifact.status}`">
              <header><strong>{{ candidate.label }}</strong><span class="status-pill">{{ candidateStatus(candidate.artifact.status) }}</span></header>
              <p>{{ candidate.brief.goal }}</p>
              <div class="creative-brief__candidate-actions">
                <button type="button" @click="loadCandidate(candidate.brief)">载入编辑对比</button>
                <template v-if="candidate.artifact.status === 'draft'">
                  <button class="primary-button" type="button" @click="review(candidate.artifact.id, 'approve')">{{ reviewArm === `${candidate.artifact.id}:approve` ? '再次确认采用' : '采用候选' }}</button>
                  <button type="button" @click="review(candidate.artifact.id, 'reject')">{{ reviewArm === `${candidate.artifact.id}:reject` ? '再次确认拒绝' : '拒绝' }}</button>
                </template>
              </div>
            </article>
          </div>
          <p v-else class="muted">尚未生成持久化候选。主界面的三个方向可直接批准，也可先在这里生成可追溯候选。</p>
        </section>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Check, Circle, CircleDot, LoaderCircle, X } from 'lucide-vue-next'
import type { ArtifactVersion, CreativeBrief, CreativeBriefField, CreativeBriefState } from '@aigc-director/contracts'

type DisplayCandidate = {
  id: string
  title: string
  summary: string
  brief: CreativeBrief
  status: ArtifactVersion['status'] | 'template'
  artifactId?: string
}

const props = withDefaults(defineProps<{ state: CreativeBriefState; busy?: boolean }>(), { busy: false })
const emit = defineEmits<{
  save: [brief: CreativeBrief]
  generate: [feedback: string, lockedFields: CreativeBriefField[]]
  review: [artifactId: string, decision: 'approve' | 'reject']
  approve: [payload: { brief: CreativeBrief; candidateId?: string }]
}>()

const draft = reactive<CreativeBrief>({ ...props.state.brief, constraints: [...props.state.brief.constraints] })
const constraintsText = ref(props.state.brief.constraints.join('\n'))
const candidateFeedback = ref('')
const lockedFields = ref<CreativeBriefField[]>([])
const reviewArm = ref('')
const approveArmed = ref(false)
const editorOpen = ref(false)
const editorMode = ref<'intent' | 'candidates'>('intent')
const closeButtonRef = ref<HTMLButtonElement>()
const selectedCandidateId = ref('template:b')

const fieldOptions: ReadonlyArray<{ id: CreativeBriefField; label: string }> = [
  { id: 'goal', label: '目标' }, { id: 'targetAudience', label: '观众' }, { id: 'genre', label: '类型' },
  { id: 'tone', label: '基调' }, { id: 'targetDurationSeconds', label: '时长' }, { id: 'aspectRatio', label: '画幅' },
  { id: 'language', label: '语言' }, { id: 'constraints', label: '约束' },
]

const displayCandidates = computed<DisplayCandidate[]>(() => {
  if (props.state.candidates.length) {
    return props.state.candidates.slice(0, 3).map((candidate, index) => ({
      id: candidate.artifact.id,
      title: `${String.fromCharCode(65 + index)} · ${candidate.label}`,
      summary: candidate.brief.tone,
      brief: candidate.brief,
      status: candidate.artifact.status,
      artifactId: candidate.artifact.id,
    }))
  }
  const brief = props.state.brief
  return [
    { id: 'template:a', title: 'A · 悬疑探索', summary: '强调档案谜题与世界观揭示', brief: { ...brief, tone: `悬疑探索、线索递进；${brief.tone}` }, status: 'template' },
    { id: 'template:b', title: 'B · 双主角冒险', summary: '兼顾角色关系、追逐与恢复线索', brief: { ...brief }, status: 'template' },
    { id: 'template:c', title: 'C · 单元任务', summary: '每集完成一次记忆修复任务', brief: { ...brief, genre: brief.genre.includes('单元') ? brief.genre : `${brief.genre}·单元任务` }, status: 'template' },
  ]
})

const selectedCandidate = computed(() => displayCandidates.value.find((candidate) => candidate.id === selectedCandidateId.value) ?? displayCandidates.value[0]!)
const lockedSummary = computed(() => {
  const brief = props.state.brief
  const portrait = brief.aspectRatio === '9:16' ? '竖屏漫剧' : `${brief.aspectRatio} 画幅`
  const minutes = brief.targetDurationSeconds >= 60 ? `${Math.max(1, Math.floor(brief.targetDurationSeconds / 60))}–${Math.max(2, Math.ceil(brief.targetDurationSeconds / 60))} 分钟` : `${brief.targetDurationSeconds} 秒`
  const storyConstraint = brief.constraints.find((item) => /(主角|人物|角色)/.test(item)) ?? brief.targetAudience
  return [brief.genre, portrait, storyConstraint, minutes]
})
const estimatedSceneCount = computed(() => Math.max(6, props.state.staleSceneCount || 0))

watch(() => props.state, (state) => {
  Object.assign(draft, state.brief, { constraints: [...state.brief.constraints] })
  constraintsText.value = state.brief.constraints.join('\n')
  reviewArm.value = ''
  approveArmed.value = false
  if (state.candidates.length && !state.candidates.some((candidate) => candidate.artifact.id === selectedCandidateId.value)) {
    selectedCandidateId.value = state.candidates.find((candidate) => candidate.artifact.status === 'draft')?.artifact.id ?? state.candidates[0]!.artifact.id
  }
}, { deep: true })

function selectCandidate(id: string): void { selectedCandidateId.value = id; approveArmed.value = false }

function approveSelected(): void {
  if (!approveArmed.value) { approveArmed.value = true; return }
  approveArmed.value = false
  const candidate = selectedCandidate.value
  emit('approve', { brief: candidate.brief, ...(candidate.artifactId && candidate.status === 'draft' ? { candidateId: candidate.artifactId } : {}) })
}

async function openEditor(mode: 'intent' | 'candidates'): Promise<void> {
  editorMode.value = mode
  editorOpen.value = true
  await nextTick()
  closeButtonRef.value?.focus()
}
function closeEditor(): void { editorOpen.value = false; reviewArm.value = '' }

function submit(): void {
  emit('save', { ...draft, constraints: constraintsText.value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 30) })
  closeEditor()
}
function generate(): void { emit('generate', candidateFeedback.value, [...lockedFields.value]) }
function loadCandidate(brief: CreativeBrief): void {
  Object.assign(draft, brief, { constraints: [...brief.constraints] })
  constraintsText.value = brief.constraints.join('\n')
  editorMode.value = 'intent'
}
function review(artifactId: string, decision: 'approve' | 'reject'): void {
  const key = `${artifactId}:${decision}`
  if (reviewArm.value !== key) { reviewArm.value = key; return }
  reviewArm.value = ''
  emit('review', artifactId, decision)
}
function candidateStatus(status: ArtifactVersion['status']): string {
  return status === 'approved' ? '已采用' : status === 'rejected' ? '已拒绝' : status === 'superseded' ? '已被新版本替代' : '待审阅'
}
</script>
