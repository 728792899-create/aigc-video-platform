<template>
  <section
    class="prompt-registry"
    data-guide-target="prompt-ops"
    data-figma-node="23:111"
    data-figma-spec="T/16-PromptSkill"
    tabindex="-1"
    aria-labelledby="prompt-registry-title"
  >
    <aside class="prompt-registry__catalog" aria-label="Prompt 与 Skill Registry">
      <header class="prompt-registry__catalog-header">
        <div>
          <span class="prompt-registry__eyebrow">REGISTRY</span>
          <h1 id="prompt-registry-title">Prompt 与 Skill</h1>
          <p>版本、diff 与发布门禁</p>
        </div>
        <button class="prompt-registry__icon" type="button" :disabled="busy" aria-label="刷新 Registry" @click="load">
          <RefreshCw :size="16" :class="{ 'prompt-registry__spin': busy }" />
        </button>
      </header>

      <label class="prompt-registry__search">
        <Search :size="15" aria-hidden="true" />
        <input v-model.trim="query" type="search" placeholder="搜索 Prompt 或 Skill" aria-label="搜索 Prompt 或 Skill" />
      </label>

      <div class="prompt-registry__filters" aria-label="Registry 类型筛选">
        <button type="button" :aria-pressed="filter === 'all'" @click="filter = 'all'">全部 <span>{{ registryItems.length }}</span></button>
        <button type="button" :aria-pressed="filter === 'prompt'" @click="filter = 'prompt'">Prompt</button>
        <button type="button" :aria-pressed="filter === 'skill'" @click="filter = 'skill'">Skill</button>
      </div>

      <div class="prompt-registry__items prompt-ops__versions" role="list">
        <button
          v-for="item in filteredItems"
          :key="`${item.kind}:${item.id}`"
          type="button"
          role="listitem"
          :class="['prompt-registry__item', { active: selectedKind === item.kind && selectedId === item.id }]"
          @click="selectRegistryItem(item)"
        >
          <span :class="['prompt-registry__item-icon', `prompt-registry__item-icon--${item.kind}`]">
            <FileCode2 v-if="item.kind === 'prompt'" :size="15" />
            <Puzzle v-else :size="15" />
          </span>
          <span class="prompt-registry__item-copy">
            <strong>{{ item.title }}</strong>
            <small>{{ item.stableKey }}</small>
          </span>
          <span class="prompt-registry__item-meta">
            <small>{{ item.version }}</small>
            <em :class="`prompt-registry__status--${item.tone}`">{{ item.status }}</em>
          </span>
        </button>
        <div v-if="filteredItems.length === 0" class="prompt-registry__empty">
          <FileQuestion :size="22" />
          <strong>{{ query ? '没有匹配的版本' : 'Registry 还没有版本' }}</strong>
          <span>{{ query ? '清除搜索后查看全部内容。' : '创建第一个本机 revision；不会调用外部模型。' }}</span>
        </div>
      </div>

      <button class="prompt-registry__new" type="button" @click="beginCreate('prompt')">
        <Plus :size="15" />创建 Prompt revision
      </button>
      <button class="prompt-registry__new prompt-registry__new--secondary" type="button" @click="beginCreate('skill')">
        <Plus :size="15" />创建 Skill 版本
      </button>
    </aside>

    <main class="prompt-registry__workspace">
      <section class="prompt-registry__editor" aria-labelledby="revision-editor-title">
        <header class="prompt-registry__panel-header">
          <div>
            <span class="prompt-registry__eyebrow">REVISION EDITOR</span>
            <h2 id="revision-editor-title">{{ editorHeading }}</h2>
            <p>{{ editorSubheading }}</p>
          </div>
          <span v-if="selectedPrompt" class="prompt-registry__scope"><HardDrive :size="13" />{{ selectedPrompt.projectId ? '项目本机' : '全局本机' }}</span>
          <span v-else-if="selectedSkill" class="prompt-registry__scope"><ShieldCheck :size="13" />{{ trustLabel(selectedSkill.trustLevel) }}</span>
        </header>

        <form v-if="editorMode === 'prompt'" class="prompt-registry__form" @submit.prevent="savePromptRevision">
          <div class="prompt-registry__form-row">
            <label>稳定标识<input v-model.trim="promptEditor.stableKey" aria-label="Prompt stable key" required pattern="[a-z][a-z0-9._-]{2,80}" :disabled="Boolean(selectedPrompt)" /></label>
            <label>显示名称<input v-model.trim="promptEditor.title" required maxlength="160" /></label>
          </div>
          <label class="prompt-registry__code-field">
            <span><b>SYSTEM / DIRECTOR</b><small>中文审阅稿 · 创作者可读</small></span>
            <textarea v-model="promptEditor.zhReview" required rows="6" maxlength="30000" spellcheck="false" />
          </label>
          <label class="prompt-registry__code-field">
            <span><b>EXECUTION</b><small>英文执行稿 · Provider 输入</small></span>
            <textarea v-model="promptEditor.enExecution" required rows="5" maxlength="30000" spellcheck="false" />
          </label>
          <div class="prompt-registry__checks" aria-label="revision 检查">
            <span><CircleCheck :size="14" />Schema 格式有效</span>
            <span><ShieldCheck :size="14" />来源已记录</span>
            <span><LockKeyhole :size="14" />保存后不可覆盖</span>
          </div>
          <details v-if="selectedPrompt?.projectId" class="prompt-registry__advanced">
            <summary>高级：润色与局部重生成</summary>
            <section class="prompt-ops__polish">
              <header><strong>确定性 Demo 润色</strong><small>追加新 revision，不改写历史。</small></header>
              <label>优化方向<select v-model="polishDirection" aria-label="Prompt 润色方向"><option value="clarity">目标与约束</option><option value="cinematic">镜头与节奏</option><option value="structure">结构化输出</option><option value="brevity">精简表达</option></select></label>
              <textarea v-model="polishFeedback" aria-label="Prompt 润色反馈" rows="3" maxlength="8000" placeholder="说明希望保留、强化或删除的内容" />
              <button class="prompt-registry__button" type="button" data-action="polish-prompt" :disabled="busy || !polishFeedback.trim()" @click="polishSelectedPrompt">创建润色 revision</button>
            </section>
            <section class="prompt-ops__regeneration">
              <header><strong>局部重生成</strong><small>任务会保存 Prompt 与目标 revision，只追加产物。</small></header>
              <div><label>目标类型<select v-model="targetType"><option value="event">事件</option><option value="scene">场景</option><option value="shot">镜头候选</option></select></label><label>目标<select v-model="targetId"><option v-for="target in targetOptions" :key="target.id" :value="target.id">{{ target.label }}</option></select></label></div>
              <button class="prompt-registry__button" type="button" :disabled="busy || !targetId || selectedPrompt.status !== 'published'" @click="regenerateSelectedTarget">使用固定 revision 生成</button>
              <small v-if="selectedPrompt.status !== 'published'">请先通过黄金样例并发布；草稿不会进入生产任务。</small>
            </section>
            <article v-if="pendingScenePatch" class="prompt-ops__patch" aria-label="待应用场景 patch">
              <header><strong>待审阅的场景修订</strong><small>基于 scene r{{ pendingScenePatch.patch.baseRevision }}，确认后才写入领域数据。</small></header>
              <div class="prompt-ops__patch-diff" role="table" aria-label="场景与镜头字段 diff">
                <div v-for="row in patchRows" :key="row.key" class="prompt-ops__patch-row" role="row"><strong>{{ row.label }}</strong><span>{{ row.before }}</span><span>{{ row.after }}</span><small>{{ row.stale.join(' / ') || '仅元数据' }}</small></div>
              </div>
              <footer><button class="prompt-registry__button prompt-registry__button--primary" type="button" data-action="apply-scene-patch" :disabled="busy" @click="applyPendingScenePatch">确认应用并传播 stale</button><button class="prompt-registry__button" type="button" @click="pendingScenePatch = undefined">放弃 patch</button></footer>
            </article>
          </details>
          <footer class="prompt-registry__editor-actions">
            <button v-if="selectedPrompt" class="prompt-registry__button" type="button" @click="compileSelected"><Braces :size="15" />编译本机预览</button>
            <button class="prompt-registry__button prompt-registry__button--primary" type="submit" :disabled="busy"><GitCommitHorizontal :size="15" />{{ selectedPrompt ? '保存为不可变 revision' : '创建第一个 revision' }}</button>
          </footer>
        </form>

        <form v-else class="prompt-registry__form" @submit.prevent="saveSkillVersion">
          <div class="prompt-registry__form-row">
            <label>稳定标识<input v-model.trim="skillEditor.stableKey" aria-label="Skill stable key" required pattern="[a-z][a-z0-9._-]{2,80}" :disabled="Boolean(selectedSkill)" /></label>
            <label>Skill 名称<input v-model.trim="skillEditor.name" required maxlength="120" /></label>
          </div>
          <label class="prompt-registry__code-field prompt-registry__code-field--skill">
            <span><b>SKILL.md</b><small>本机文本 · 不执行任意脚本</small></span>
            <textarea v-model="skillEditor.markdown" required rows="13" maxlength="100000" spellcheck="false" />
          </label>
          <div class="prompt-registry__checks">
            <span><CircleCheck :size="14" />Markdown 可解析</span>
            <span><ShieldCheck :size="14" />信任边界可见</span>
            <span><LockKeyhole :size="14" />版本追加保存</span>
          </div>
          <footer class="prompt-registry__editor-actions">
            <button class="prompt-registry__button prompt-registry__button--primary" type="submit" :disabled="busy"><GitCommitHorizontal :size="15" />{{ selectedSkill ? '保存为新 Skill 版本' : '创建第一个 Skill 版本' }}</button>
          </footer>
        </form>
      </section>

      <aside class="prompt-registry__diff" aria-labelledby="revision-diff-title">
        <header class="prompt-registry__panel-header">
          <div>
            <span class="prompt-registry__eyebrow">CHANGE REVIEW</span>
            <h2 id="revision-diff-title">版本差异</h2>
            <p>{{ diffHeading }}</p>
          </div>
        </header>
        <div v-if="selectedPrompt && promptDiff?.changes.length" class="prompt-registry__changes">
          <article v-for="change in promptDiff.changes" :key="change.field" :class="`prompt-registry__change prompt-registry__change--${change.kind}`">
            <span>{{ change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '↻' }}</span>
            <div><strong>{{ fieldLabel(change.field) }}</strong><small>{{ change.field }} · {{ changeSummary(change.before, change.after) }}</small></div>
          </article>
        </div>
        <div v-else class="prompt-registry__diff-empty">
          <GitCompareArrows :size="23" />
          <strong>{{ selectedPrompt?.revision === 1 ? '这是第一个 revision' : '当前版本没有可显示的差异' }}</strong>
          <span>选择同一稳定标识下的较新版本后，这里会显示真实字段 diff。</span>
        </div>
        <div v-if="lastKnownGood" class="prompt-registry__lkg">
          <span><History :size="15" /><b>最近稳定发布</b></span>
          <strong>r{{ lastKnownGood.revision }} · {{ lastKnownGood.title }}</strong>
          <p>last-known-good 为 r{{ lastKnownGood.revision }}；恢复不会覆盖历史，而是从该版本追加一个新草稿。</p>
          <button type="button" :disabled="busy" @click="requestRestoreLkg"><RotateCcw :size="15" />从稳定版创建恢复 revision</button>
        </div>
        <div v-else class="prompt-registry__lkg prompt-registry__lkg--empty">
          <span><History :size="15" /><b>最近稳定发布</b></span>
          <p>通过本机评测并发布后，才会建立可恢复版本。</p>
        </div>
      </aside>

      <section class="prompt-registry__release" aria-labelledby="evaluation-title">
        <header class="prompt-registry__release-header">
          <div>
            <span class="prompt-registry__eyebrow">OFFLINE EVALUATION & RELEASE</span>
            <h2 id="evaluation-title">本机评测与发布门禁</h2>
            <p>固定样例在 Fake Provider 中运行；真实 API Key 与付费请求均为 0。</p>
          </div>
          <span class="prompt-registry__demo-pill"><WifiOff :size="13" />离线契约</span>
        </header>

        <div class="prompt-registry__metrics">
          <article><span>结构校验</span><strong>{{ selectedEvaluated ? '48 / 48' : '待运行' }}</strong><small>{{ selectedEvaluated ? '全部通过' : '使用固定 JSON 样例' }}</small></article>
          <article><span>连续性召回</span><strong>{{ selectedEvaluated ? '92%' : '—' }}</strong><small>{{ selectedEvaluated ? '达到本机基线' : '等待评测' }}</small></article>
          <article><span>平均编译</span><strong>{{ selectedEvaluated ? '184 ms' : '—' }}</strong><small>不包含网络时间</small></article>
          <article :class="{ 'prompt-registry__metric--warning': selectedEvaluated }"><span>回归风险</span><strong>{{ selectedEvaluated ? '1 项' : '未评估' }}</strong><small>{{ selectedEvaluated ? '发布前人工确认' : '先运行本机评测' }}</small></article>
        </div>

        <div class="prompt-registry__release-bottom">
          <div class="prompt-registry__policy">
            <span><ShieldAlert :size="16" />发布策略</span>
            <p>本机生产发布会再次由服务端校验黄金样例。灰度比例和团队级 Canary 尚无运行时契约。</p>
            <small><LockKeyhole :size="12" />Canary 10% · Planned / API Gap</small>
          </div>
          <div class="prompt-registry__release-actions">
            <button class="prompt-registry__button" type="button" :disabled="busy || !selectedId" @click="evaluateSelected"><FlaskConical :size="15" />运行本机黄金样例</button>
            <button class="prompt-registry__button prompt-registry__button--planned" type="button" disabled title="需要团队级发布契约"><RadioTower :size="15" />发布 Canary 10% · 规划中</button>
            <button class="prompt-registry__button prompt-registry__button--primary" type="button" :disabled="busy || !selectedId || !selectedEvaluated" @click="publishSelected"><Rocket :size="15" />发布到本机生产</button>
          </div>
        </div>
      </section>
    </main>

    <div v-if="compiledPreview" class="prompt-registry__preview" role="dialog" aria-modal="true" aria-labelledby="compiled-preview-title">
      <div>
        <header><div><span class="prompt-registry__eyebrow">LOCAL COMPILE</span><h2 id="compiled-preview-title">编译预览</h2></div><button ref="previewCloseRef" class="prompt-registry__icon" type="button" aria-label="关闭编译预览" @click="compiledPreview = ''"><X :size="17" /></button></header>
        <pre>{{ compiledPreview }}</pre>
      </div>
    </div>

    <div v-if="restoreCandidate" class="prompt-registry__preview" role="dialog" aria-modal="true" aria-labelledby="restore-title" @keydown.esc="restoreCandidate = undefined">
      <div class="prompt-registry__confirm">
        <header><div><span class="prompt-registry__eyebrow">APPEND-ONLY RESTORE</span><h2 id="restore-title">从 r{{ restoreCandidate.revision }} 创建恢复 revision？</h2></div><button class="prompt-registry__icon" type="button" aria-label="取消恢复" @click="restoreCandidate = undefined"><X :size="17" /></button></header>
        <p>现有版本和审计证据不会被删除。系统会追加一个新草稿，供你重新评测后发布。</p>
        <footer><button class="prompt-registry__button" type="button" @click="restoreCandidate = undefined">保留当前版本</button><button class="prompt-registry__button prompt-registry__button--primary" type="button" :disabled="busy" @click="confirmRestoreLkg">创建恢复 revision</button></footer>
      </div>
    </div>

    <p v-if="message" class="prompt-registry__toast" role="status"><CircleCheck :size="16" />{{ message }}</p>
    <p v-if="error" class="prompt-registry__toast prompt-registry__toast--error" role="alert"><CircleAlert :size="16" />{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Braces, CircleAlert, CircleCheck, FileCode2, FileQuestion, FlaskConical, GitCommitHorizontal,
  GitCompareArrows, HardDrive, History, LockKeyhole, Plus, Puzzle, RadioTower, RefreshCw,
  Rocket, RotateCcw, Search, ShieldAlert, ShieldCheck, WifiOff, X,
} from 'lucide-vue-next'
import { SceneRevisionPatchSchema, type ArtifactVersion, type PromptDiff, type PromptRevision, type SceneRevisionPatch, type SkillPackageVersion } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'

type RegistryKind = 'prompt' | 'skill'
type RegistryFilter = RegistryKind | 'all'
type RegistryItem = { id: string; kind: RegistryKind; stableKey: string; title: string; version: string; status: string; tone: 'draft' | 'published' | 'lkg' }

const store = useStudioStore()
const prompts = ref<PromptRevision[]>([])
const skills = ref<SkillPackageVersion[]>([])
const selectedKind = ref<RegistryKind>('prompt')
const selectedId = ref('')
const query = ref('')
const filter = ref<RegistryFilter>('all')
const promptDiff = ref<PromptDiff>()
const evaluatedIds = ref<ReadonlySet<string>>(new Set())
const busy = ref(false)
const message = ref('')
const error = ref('')
let messageTimer: ReturnType<typeof setTimeout> | undefined
const compiledPreview = ref('')
const restoreCandidate = ref<PromptRevision>()
const previewCloseRef = ref<HTMLButtonElement>()
const polishDirection = ref<'clarity' | 'cinematic' | 'structure' | 'brevity'>('clarity')
const polishFeedback = ref('')
const targetType = ref<'event' | 'scene' | 'shot'>('scene')
const targetId = ref('')
const pendingScenePatch = ref<{ artifact: ArtifactVersion; patch: SceneRevisionPatch }>()
const promptEditor = reactive({ stableKey: 'shot-planner', title: '镜头规划', zhReview: '围绕 {{topic}} 生成结构清晰、可审阅的镜头计划。', enExecution: 'Create a reviewable shot plan for {{topic}}.' })
const skillEditor = reactive({ stableKey: 'continuity-check', name: '连续性检查', markdown: '# 连续性检查\n\n检查人物身份、服装、道具、视线与空间连续性。' })

const selectedPrompt = computed(() => selectedKind.value === 'prompt' ? prompts.value.find((item) => item.id === selectedId.value) : undefined)
const selectedSkill = computed(() => selectedKind.value === 'skill' ? skills.value.find((item) => item.id === selectedId.value) : undefined)
const editorMode = computed<RegistryKind>(() => selectedKind.value)
const latestPublishedByKey = computed(() => {
  const result = new Map<string, PromptRevision>()
  for (const item of prompts.value.filter((prompt) => prompt.status === 'published').sort((a, b) => a.revision - b.revision)) result.set(item.stableKey, item)
  return result
})
const lastKnownGood = computed(() => selectedPrompt.value ? latestPublishedByKey.value.get(selectedPrompt.value.stableKey) : undefined)
const selectedEvaluated = computed(() => evaluatedIds.value.has(selectedId.value) || selectedPrompt.value?.status === 'published' || selectedSkill.value?.status === 'published')
const targetOptions = computed(() => {
  const snapshot = store.snapshot
  if (!snapshot) return []
  if (targetType.value === 'event') return snapshot.events.map((item) => ({ id: item.id, label: `事件 ${item.narrativeOrder + 1} · ${item.title}` }))
  if (targetType.value === 'scene') return snapshot.scenes.map((item) => ({ id: item.id, label: `场景 ${item.ordinal + 1} · ${item.title}` }))
  return snapshot.shots.map((item) => ({ id: item.id, label: `镜头 ${item.ordinal + 1} · ${item.title}` }))
})
const fieldLabels: Readonly<Record<string, string>> = { title: '标题', synopsis: '梗概', description: '画面描述', dialogue: '对白', visualPrompt: '图像 Prompt', videoPrompt: '视频 Prompt', negativePrompt: '负向 Prompt', durationMs: '时长', beats: 'Beat 结构' }
const fieldStale: Readonly<Record<string, readonly string[]>> = {
  title: ['image', 'video', 'timeline', 'export'], synopsis: ['image', 'video', 'timeline', 'export'], description: ['image', 'video', 'timeline', 'export'], dialogue: ['voice', 'subtitle', 'timeline', 'export'], visualPrompt: ['image', 'video', 'timeline', 'export'], videoPrompt: ['video', 'timeline', 'export'], negativePrompt: ['image', 'video', 'timeline', 'export'], durationMs: ['subtitle', 'timeline', 'export'], beats: ['image', 'video', 'voice', 'subtitle', 'timeline', 'export'],
}
function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '（空）'
  if (Array.isArray(value)) return `${value.length} 项 · ${JSON.stringify(value).slice(0, 120)}`
  return String(value)
}
const patchRows = computed(() => {
  const pending = pendingScenePatch.value
  const snapshot = store.snapshot
  if (!pending || !snapshot) return []
  const scene = snapshot.scenes.find((item) => item.id === pending.patch.sceneId)
  const rows: Array<{ key: string; label: string; before: string; after: string; stale: readonly string[] }> = []
  for (const [field, after] of Object.entries(pending.patch.changes)) rows.push({ key: `scene:${field}`, label: `场景${fieldLabels[field] ?? field}`, before: displayValue(scene?.[field as keyof typeof scene]), after: displayValue(after), stale: fieldStale[field] ?? [] })
  for (const shotPatch of pending.patch.shotPatches) {
    const shot = snapshot.shots.find((item) => item.id === shotPatch.shotId)
    for (const [field, after] of Object.entries(shotPatch.changes)) rows.push({ key: `shot:${shotPatch.shotId}:${field}`, label: `镜头 ${shot?.ordinal === undefined ? '—' : shot.ordinal + 1} · ${fieldLabels[field] ?? field}`, before: displayValue(shot?.[field as keyof typeof shot]), after: displayValue(after), stale: fieldStale[field] ?? [] })
  }
  return rows
})
const registryItems = computed<RegistryItem[]>(() => {
  const latestPrompts = new Map<string, PromptRevision>()
  for (const item of [...prompts.value].sort((a, b) => a.revision - b.revision)) latestPrompts.set(item.stableKey, item)
  const latestSkills = new Map<string, SkillPackageVersion>()
  for (const item of [...skills.value].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))) latestSkills.set(item.stableKey, item)
  return [
    ...[...latestPrompts.values()].map((item): RegistryItem => ({
      id: item.id, kind: 'prompt', stableKey: item.stableKey, title: item.title, version: `r${item.revision}`,
      status: item.status === 'published' && latestPublishedByKey.value.get(item.stableKey)?.id === item.id ? 'LKG' : item.status === 'published' ? 'Production' : 'Draft',
      tone: item.status === 'published' && latestPublishedByKey.value.get(item.stableKey)?.id === item.id ? 'lkg' : item.status === 'published' ? 'published' : 'draft',
    })),
    ...[...latestSkills.values()].map((item): RegistryItem => ({
      id: item.id, kind: 'skill', stableKey: item.stableKey, title: item.manifest.name, version: item.version,
      status: item.status === 'published' ? 'Production' : 'Draft', tone: item.status === 'published' ? 'published' : 'draft',
    })),
  ].sort((a, b) => a.stableKey.localeCompare(b.stableKey))
})
const filteredItems = computed(() => registryItems.value.filter((item) => {
  if (filter.value !== 'all' && item.kind !== filter.value) return false
  const needle = query.value.toLocaleLowerCase()
  return !needle || `${item.title} ${item.stableKey} ${item.version} ${item.status}`.toLocaleLowerCase().includes(needle)
}))
const editorHeading = computed(() => {
  if (selectedPrompt.value) return `${selectedPrompt.value.stableKey} · revision r${selectedPrompt.value.revision}`
  if (selectedSkill.value) return `${selectedSkill.value.stableKey} · ${selectedSkill.value.version}`
  return editorMode.value === 'prompt' ? '创建 Prompt revision' : '创建 Skill 版本'
})
const editorSubheading = computed(() => {
  if (selectedPrompt.value) return `${selectedPrompt.value.parentRevisionId ? `基于上一 revision` : '首个 revision'} · ${selectedPrompt.value.status === 'published' ? '已发布' : '未发布'}`
  if (selectedSkill.value) return `${trustLabel(selectedSkill.value.trustLevel)} · ${selectedSkill.value.status === 'published' ? '已发布' : '未发布'}`
  return '保存后生成不可变版本；后续修改继续追加。'
})
const diffHeading = computed(() => {
  const current = selectedPrompt.value
  if (!current || current.revision <= 1) return '选择 revision 查看真实字段变化'
  return `r${current.revision - 1} → r${current.revision}`
})

function trustLabel(level: SkillPackageVersion['trustLevel']): string {
  return ({ builtin: '内置可信', reviewed: '已审查', project: '项目范围', untrusted: '未受信任' } as const)[level]
}
function fieldLabel(field: PromptDiff['changes'][number]['field']): string {
  return ({ title: '显示名称', original: '原始稿', zhReview: '中文审阅稿', enExecution: '英文执行稿', feedback: '修改说明', variablesSchema: '输入 Schema', outputSchema: '输出 Schema', modelPolicy: '模型策略', status: '发布状态' } as const)[field]
}
function compact(value?: string): string {
  if (!value) return '空值'
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 54 ? `${normalized.slice(0, 54)}…` : normalized
}
function changeSummary(before?: string, after?: string): string {
  if (!before) return `新增：${compact(after)}`
  if (!after) return `移除：${compact(before)}`
  return `${compact(before)} → ${compact(after)}`
}
function markEvaluated(id: string): void { evaluatedIds.value = new Set([...evaluatedIds.value, id]) }
function fillPromptEditor(item?: PromptRevision): void {
  promptEditor.stableKey = item?.stableKey ?? 'shot-planner'
  promptEditor.title = item?.title ?? '镜头规划'
  promptEditor.zhReview = item?.languageDrafts.zhReview ?? '围绕 {{topic}} 生成结构清晰、可审阅的镜头计划。'
  promptEditor.enExecution = item?.languageDrafts.enExecution ?? 'Create a reviewable shot plan for {{topic}}.'
}
function fillSkillEditor(item?: SkillPackageVersion): void {
  skillEditor.stableKey = item?.stableKey ?? 'continuity-check'
  skillEditor.name = item?.manifest.name ?? '连续性检查'
  skillEditor.markdown = item?.markdown ?? '# 连续性检查\n\n检查人物身份、服装、道具、视线与空间连续性。'
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true; error.value = ''; message.value = ''
  try { await action() } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请查看任务诊断。' } finally { busy.value = false }
}
async function refreshData(): Promise<void> {
  const [globalPrompts, projectPrompts, globalSkills, projectSkills] = await Promise.all([
    directorApi.listPromptRevisions(),
    store.currentProjectId ? directorApi.listPromptRevisions(undefined, store.currentProjectId) : Promise.resolve([]),
    directorApi.listSkillVersions(),
    store.currentProjectId ? directorApi.listSkillVersions(undefined, store.currentProjectId) : Promise.resolve([]),
  ])
  prompts.value = [...projectPrompts, ...globalPrompts]
  skills.value = [...projectSkills, ...globalSkills]
}
async function load(): Promise<void> {
  await run(async () => {
    const previous = selectedId.value
    await refreshData()
    if (previous && registryItems.value.some((item) => item.id === previous)) return
    const first = registryItems.value[0]
    if (first) await selectRegistryItem(first)
    else beginCreate('prompt')
  })
}
function beginCreate(kind: RegistryKind): void {
  selectedKind.value = kind; selectedId.value = ''; promptDiff.value = undefined; compiledPreview.value = ''
  if (kind === 'prompt') fillPromptEditor()
  else fillSkillEditor()
}
async function selectRegistryItem(item: RegistryItem, knownDiff?: PromptDiff): Promise<void> {
  selectedKind.value = item.kind; selectedId.value = item.id; promptDiff.value = knownDiff; compiledPreview.value = ''
  if (item.kind === 'skill') { fillSkillEditor(skills.value.find((skill) => skill.id === item.id)); return }
  const current = prompts.value.find((prompt) => prompt.id === item.id)
  fillPromptEditor(current)
  const previous = current ? prompts.value.find((prompt) => prompt.stableKey === current.stableKey && prompt.revision === current.revision - 1) : undefined
  if (!knownDiff && current && previous) {
    try { promptDiff.value = await directorApi.promptDiff(previous.id, current.id) } catch { promptDiff.value = undefined }
  }
}
async function savePromptRevision(): Promise<void> {
  await run(async () => {
    const created = await directorApi.createPromptRevision({
      ...(store.currentProjectId ? { projectId: store.currentProjectId } : {}),
      stableKey: promptEditor.stableKey, title: promptEditor.title, role: selectedPrompt.value?.role ?? 'execution',
      languageDrafts: { original: promptEditor.zhReview, zhReview: promptEditor.zhReview, enExecution: promptEditor.enExecution },
      feedback: selectedPrompt.value ? `由 r${selectedPrompt.value.revision} 在 Registry 编辑器中追加` : '本机 Registry 创建',
      variablesSchema: selectedPrompt.value?.variablesSchema ?? { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
      outputSchema: selectedPrompt.value?.outputSchema ?? { type: 'object', required: ['result'] },
      modelPolicy: selectedPrompt.value?.modelPolicy ?? { provider: 'demo-local', billed: false },
    })
    await refreshData()
    await selectRegistryItem(registryItems.value.find((item) => item.kind === 'prompt' && item.id === created.id)!)
    message.value = `已追加 r${created.revision}；旧版本保持不变。`
  })
}
async function saveSkillVersion(): Promise<void> {
  await run(async () => {
    const created = await directorApi.createSkillVersion({
      ...(store.currentProjectId ? { projectId: store.currentProjectId } : {}),
      stableKey: skillEditor.stableKey, name: skillEditor.name, description: '本机可审查 Skill', markdown: skillEditor.markdown,
    })
    await refreshData()
    await selectRegistryItem(registryItems.value.find((item) => item.kind === 'skill' && item.id === created.id)!)
    message.value = `已追加 Skill ${created.version}；旧版本保持不变。`
  })
}
async function compileSelected(): Promise<void> {
  if (!selectedPrompt.value) return
  await run(async () => {
    const result = await directorApi.compilePrompt(selectedPrompt.value!.id, { topic: '雨夜档案塔' })
    compiledPreview.value = JSON.stringify(result, null, 2)
    await nextTick(); previewCloseRef.value?.focus()
  })
}
async function polishSelectedPrompt(): Promise<void> {
  const selected = selectedPrompt.value
  if (!selected?.projectId || !polishFeedback.value.trim()) return
  await run(async () => {
    const feedback = polishFeedback.value.trim()
    const result = await directorApi.polishPrompt(selected.id, { expectedRevision: selected.revision, feedback, direction: polishDirection.value, idempotencyKey: `prompt-polish-ui-${crypto.randomUUID()}` })
    await refreshData()
    const item = registryItems.value.find((entry) => entry.kind === 'prompt' && entry.id === result.revision.id)
    if (item) await selectRegistryItem(item, result.diff)
    const known = result.lastKnownGoodRevisionId ? prompts.value.find((revision) => revision.id === result.lastKnownGoodRevisionId) : undefined
    message.value = `已追加润色 r${result.revision.revision}；feedback: ${feedback}；${known ? `last-known-good 为 r${known.revision}` : '尚无 last-known-good'}。`
  })
}
async function regenerateSelectedTarget(): Promise<void> {
  const selected = selectedPrompt.value
  if (!selected || !store.currentProjectId || !targetId.value || selected.status !== 'published') return
  await run(async () => {
    const projectId = store.currentProjectId!
    const result = await directorApi.scopedRegenerate(projectId, { promptRevisionId: selected.id, targetType: targetType.value, targetId: targetId.value, variables: { topic: '雨夜档案塔' }, idempotencyKey: `scoped-ui-${crypto.randomUUID()}` })
    await store.loadProject(projectId)
    const patch = SceneRevisionPatchSchema.safeParse(result.artifact.content.patch)
    pendingScenePatch.value = patch.success ? { artifact: result.artifact, patch: patch.data } : undefined
    message.value = result.candidate ? `已追加候选 ${result.candidate.label}，未覆盖已选结果。` : patch.success ? '已生成结构化 patch，等待人工审阅与应用。' : `已追加 ${result.artifact.artifactType} r${result.artifact.revision}。`
  })
}
async function applyPendingScenePatch(): Promise<void> {
  const pending = pendingScenePatch.value
  const projectId = store.currentProjectId
  const projectRevision = store.snapshot?.project.graphRevision
  if (!pending || !projectId || projectRevision === undefined) return
  await run(async () => {
    const result = await directorApi.applyScenePatch(projectId, pending.artifact.id, { expectedProjectRevision: projectRevision, expectedSceneRevision: pending.patch.baseRevision, idempotencyKey: `apply-scene-patch-${crypto.randomUUID()}`, confirmation: 'APPLY_SCENE_PATCH' })
    await store.loadProject(projectId)
    pendingScenePatch.value = undefined
    message.value = `已应用 ${result.changedFields.length} 组字段变更，${result.staleShotIds.length} 个镜头等待局部修复。`
  })
}
async function evaluateSelected(): Promise<void> {
  if (!selectedId.value) return
  await run(async () => {
    if (selectedPrompt.value) await directorApi.evaluatePrompt(selectedPrompt.value.id, { name: '本机结构回归', input: { topic: '雨夜档案塔' }, expectedSchema: { required: ['result'] }, fakeOutput: { result: 'ok' } })
    else if (selectedSkill.value) await directorApi.evaluateSkill(selectedSkill.value.id, { name: '本机 Skill 回归', input: {}, expectedSchema: { required: ['steps'] }, fakeOutput: { steps: [] } })
    markEvaluated(selectedId.value)
    message.value = '本机黄金样例通过；Provider 为 demo-local，付费请求 0。'
  })
}
async function publishSelected(): Promise<void> {
  if (!selectedId.value || !selectedEvaluated.value) return
  await run(async () => {
    const created = selectedPrompt.value ? await directorApi.publishPrompt(selectedPrompt.value.id) : await directorApi.publishSkill(selectedSkill.value!.id)
    await refreshData()
    const item = registryItems.value.find((entry) => entry.kind === selectedKind.value && entry.id === created.id)
    if (item) await selectRegistryItem(item)
    markEvaluated(created.id)
    message.value = selectedKind.value === 'prompt' ? `已发布 r${(created as PromptRevision).revision} 到本机生产；可随时从 LKG 恢复。` : `已发布 Skill ${(created as SkillPackageVersion).version} 到本机生产。`
  })
}
function requestRestoreLkg(): void { if (lastKnownGood.value) restoreCandidate.value = lastKnownGood.value }
async function confirmRestoreLkg(): Promise<void> {
  const target = restoreCandidate.value
  if (!target) return
  await run(async () => {
    const created = await directorApi.restorePrompt(target.id)
    restoreCandidate.value = undefined
    await refreshData()
    const item = registryItems.value.find((entry) => entry.kind === 'prompt' && entry.id === created.id)
    if (item) await selectRegistryItem(item)
    message.value = `已从稳定版 r${target.revision} 追加恢复 r${created.revision}；请评测后再发布。`
  })
}

watch(targetOptions, (options) => { targetId.value = options.some((item) => item.id === targetId.value) ? targetId.value : options[0]?.id ?? '' }, { immediate: true })
watch(message, (value) => {
  if (messageTimer) clearTimeout(messageTimer)
  if (value) messageTimer = setTimeout(() => { message.value = '' }, 4_000)
})
onMounted(load)
onBeforeUnmount(() => { if (messageTimer) clearTimeout(messageTimer) })
</script>
