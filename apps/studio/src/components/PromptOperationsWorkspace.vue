<template>
  <section class="prompt-ops" aria-label="Prompt 与 Skill 运营工作区">
    <header><div><span class="eyebrow">PROMPT / SKILL OPS</span><h3>版本、diff 与发布门禁</h3></div><button class="secondary-button" type="button" :disabled="busy" @click="load">刷新</button></header>
    <p class="muted">所有恢复与发布都会创建新 revision；黄金样例只运行 Fake Provider 契约，不发起付费请求。</p>

    <div class="prompt-ops__columns">
      <section>
        <h4>Prompt revision</h4>
        <form class="prompt-ops__form" @submit.prevent="createPrompt">
          <input v-model="promptDraft.stableKey" aria-label="Prompt stable key" required pattern="[a-z][a-z0-9._-]{2,80}" />
          <input v-model="promptDraft.title" aria-label="Prompt 标题" required />
          <textarea v-model="promptDraft.zhReview" aria-label="中文审阅稿" required rows="3" />
          <textarea v-model="promptDraft.enExecution" aria-label="英文执行稿" required rows="3" />
          <button class="primary-button" type="submit" :disabled="busy">创建 revision</button>
        </form>
        <div class="prompt-ops__versions" role="list" aria-label="Prompt 版本列表">
          <button v-for="revision in prompts" :key="revision.id" type="button" :class="{ active: revision.id === selectedPromptId }" @click="selectPrompt(revision.id)">
            <strong>{{ revision.title }}</strong><small>{{ revision.stableKey }} · r{{ revision.revision }} · {{ revision.status }}</small>
          </button>
          <p v-if="prompts.length === 0" class="muted">尚无用户 Prompt revision。</p>
        </div>
        <div v-if="selectedPrompt" class="prompt-ops__actions">
          <input v-model="previewTopic" aria-label="编译预览 topic" />
          <button type="button" @click="compileSelected">编译预览</button>
          <button type="button" @click="evaluateSelectedPrompt">运行黄金样例</button>
          <button type="button" @click="publishSelectedPrompt">发布新 revision</button>
          <button type="button" @click="restoreSelectedPrompt">恢复为新 revision</button>
        </div>
        <fieldset v-if="selectedPrompt" class="prompt-ops__regeneration">
          <legend>局部重生成</legend>
          <label>目标类型<select v-model="targetType"><option value="event">事件</option><option value="scene">场景</option><option value="shot">镜头候选</option></select></label>
          <label>目标<select v-model="targetId"><option v-for="target in targetOptions" :key="target.id" :value="target.id">{{ target.label }}</option></select></label>
          <button type="button" :disabled="busy || !targetId || selectedPrompt.status !== 'published'" @click="regenerateSelectedTarget">使用固定 revision 生成</button>
          <small v-if="selectedPrompt.status !== 'published'">请先通过黄金样例并发布；草稿不会进入生产任务。</small>
          <small v-else>任务会保存 Prompt 与目标 revision；新结果只追加 Artifact/Candidate。</small>
        </fieldset>
        <pre v-if="compiledPreview" class="prompt-ops__preview">{{ compiledPreview }}</pre>
        <ul v-if="promptDiff"><li v-for="change in promptDiff.changes" :key="change.field"><strong>{{ change.field }}</strong>：{{ change.before }} → {{ change.after }}</li></ul>
      </section>

      <section>
        <h4>Skill package</h4>
        <form class="prompt-ops__form" @submit.prevent="createSkill">
          <input v-model="skillDraft.stableKey" aria-label="Skill stable key" required pattern="[a-z][a-z0-9._-]{2,80}" />
          <input v-model="skillDraft.name" aria-label="Skill 名称" required />
          <textarea v-model="skillDraft.markdown" aria-label="Skill Markdown" required rows="6" />
          <button class="primary-button" type="submit" :disabled="busy">创建 Skill fork</button>
        </form>
        <div class="prompt-ops__versions" role="list" aria-label="Skill 版本列表">
          <button v-for="skill in skills" :key="skill.id" type="button" :class="{ active: skill.id === selectedSkillId }" @click="selectedSkillId = skill.id">
            <strong>{{ skill.manifest.name }}</strong><small>{{ skill.stableKey }} · {{ skill.version }} · {{ skill.status }}</small>
          </button>
          <p v-if="skills.length === 0" class="muted">尚无用户 Skill version。</p>
        </div>
        <div v-if="selectedSkill" class="prompt-ops__actions">
          <button type="button" @click="evaluateSelectedSkill">运行黄金样例</button>
          <button type="button" @click="publishSelectedSkill">发布新版本</button>
          <button type="button" @click="rollbackSelectedSkill">以此版本创建 rollback</button>
        </div>
      </section>
    </div>
    <p v-if="message" role="status" class="prompt-ops__status">{{ message }}</p>
    <p v-if="error" role="alert" class="prompt-ops__error">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { PromptDiff, PromptRevision, SkillPackageVersion } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'
import { useStudioStore } from '../stores/studio.js'

const store = useStudioStore()
const prompts = ref<PromptRevision[]>([])
const skills = ref<SkillPackageVersion[]>([])
const selectedPromptId = ref('')
const selectedSkillId = ref('')
const promptDiff = ref<PromptDiff>()
const compiledPreview = ref('')
const previewTopic = ref('雨夜车站')
const targetType = ref<'event' | 'scene' | 'shot'>('scene')
const targetId = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')
const promptDraft = reactive({ stableKey: 'script.scene-polish', title: '场景 Prompt 润色', zhReview: '围绕 {{topic}} 生成可拍摄场景。', enExecution: 'Create a filmable scene about {{topic}}.' })
const skillDraft = reactive({ stableKey: 'skill.scene-continuity', name: '场景连续性', markdown: '# 场景连续性\n\n检查人物、空间和道具状态。' })

const selectedPrompt = computed(() => prompts.value.find((item) => item.id === selectedPromptId.value))
const selectedSkill = computed(() => skills.value.find((item) => item.id === selectedSkillId.value))
const targetOptions = computed(() => {
  const snapshot = store.snapshot
  if (!snapshot) return []
  if (targetType.value === 'event') return snapshot.events.map((item) => ({ id: item.id, label: `事件 ${item.narrativeOrder + 1} · ${item.title}` }))
  if (targetType.value === 'scene') return snapshot.scenes.map((item) => ({ id: item.id, label: `场景 ${item.ordinal + 1} · ${item.title}` }))
  return snapshot.shots.map((item) => ({ id: item.id, label: `镜头 ${item.ordinal + 1} · ${item.title}` }))
})

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true; error.value = ''; message.value = ''
  try { await action() } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' } finally { busy.value = false }
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
  await run(refreshData)
}

async function createPrompt(): Promise<void> {
  await run(async () => {
    const created = await directorApi.createPromptRevision({
      ...(store.currentProjectId ? { projectId: store.currentProjectId } : {}), stableKey: promptDraft.stableKey, title: promptDraft.title,
      role: 'execution', languageDrafts: { original: promptDraft.zhReview, zhReview: promptDraft.zhReview, enExecution: promptDraft.enExecution },
      variablesSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] }, outputSchema: { type: 'object', required: ['result'] },
    })
    await refreshData(); selectedPromptId.value = created.id; message.value = `已创建 r${created.revision}`
  })
}

async function selectPrompt(id: string): Promise<void> {
  selectedPromptId.value = id; compiledPreview.value = ''; promptDiff.value = undefined
  const current = prompts.value.find((item) => item.id === id)
  const previous = current ? prompts.value.find((item) => item.stableKey === current.stableKey && item.revision === current.revision - 1) : undefined
  if (current && previous) promptDiff.value = await directorApi.promptDiff(previous.id, current.id)
}

async function compileSelected(): Promise<void> {
  if (!selectedPrompt.value) return
  await run(async () => { compiledPreview.value = JSON.stringify(await directorApi.compilePrompt(selectedPrompt.value!.id, { topic: previewTopic.value }), null, 2) })
}

async function evaluateSelectedPrompt(): Promise<void> {
  if (!selectedPrompt.value) return
  await run(async () => { await directorApi.evaluatePrompt(selectedPrompt.value!.id, { name: 'Fake Provider 结构回归', input: { topic: previewTopic.value }, expectedSchema: { required: ['result'] }, fakeOutput: { result: 'ok' } }); message.value = '黄金样例通过，付费请求 0。' })
}

async function publishSelectedPrompt(): Promise<void> {
  if (!selectedPrompt.value) return
  await run(async () => { const created = await directorApi.publishPrompt(selectedPrompt.value!.id); await refreshData(); selectedPromptId.value = created.id; message.value = `已发布 r${created.revision}` })
}

async function restoreSelectedPrompt(): Promise<void> {
  if (!selectedPrompt.value) return
  await run(async () => { const created = await directorApi.restorePrompt(selectedPrompt.value!.id); await refreshData(); selectedPromptId.value = created.id; message.value = `已追加恢复 r${created.revision}` })
}

async function regenerateSelectedTarget(): Promise<void> {
  if (!selectedPrompt.value || !store.currentProjectId || !targetId.value || selectedPrompt.value.status !== 'published') return
  await run(async () => {
    const projectId = store.currentProjectId!
    const result = await directorApi.scopedRegenerate(projectId, {
      promptRevisionId: selectedPrompt.value!.id,
      targetType: targetType.value,
      targetId: targetId.value,
      variables: { topic: previewTopic.value },
      idempotencyKey: `scoped-ui-${crypto.randomUUID()}`,
    })
    await store.loadProject(projectId)
    message.value = result.candidate
      ? `已追加候选 ${result.candidate.label}，未覆盖已选结果。`
      : `已追加 ${result.artifact.artifactType} r${result.artifact.revision}。`
  })
}

async function createSkill(): Promise<void> {
  await run(async () => {
    const created = await directorApi.createSkillVersion({ ...(store.currentProjectId ? { projectId: store.currentProjectId } : {}), ...skillDraft })
    await refreshData(); selectedSkillId.value = created.id; message.value = `已创建 Skill ${created.version}`
  })
}

async function evaluateSelectedSkill(): Promise<void> {
  if (!selectedSkill.value) return
  await run(async () => { await directorApi.evaluateSkill(selectedSkill.value!.id, { name: 'Fake Skill 回归', input: {}, expectedSchema: { required: ['steps'] }, fakeOutput: { steps: [] } }); message.value = 'Skill 黄金样例通过。' })
}

async function publishSelectedSkill(): Promise<void> {
  if (!selectedSkill.value) return
  await run(async () => { const created = await directorApi.publishSkill(selectedSkill.value!.id); await refreshData(); selectedSkillId.value = created.id; message.value = `已发布 ${created.version}` })
}

async function rollbackSelectedSkill(): Promise<void> {
  if (!selectedSkill.value) return
  await run(async () => { const created = await directorApi.rollbackSkill(selectedSkill.value!.id); await refreshData(); selectedSkillId.value = created.id; message.value = `已追加 rollback ${created.version}` })
}

watch(targetOptions, (options) => { targetId.value = options.some((item) => item.id === targetId.value) ? targetId.value : options[0]?.id ?? '' }, { immediate: true })
onMounted(load)
</script>

<style scoped>
.prompt-ops{margin-top:18px;border-top:1px solid var(--line);padding-top:16px}.prompt-ops>header{display:flex;justify-content:space-between;gap:16px;align-items:center}.prompt-ops h3,.prompt-ops h4{margin:4px 0}.prompt-ops__columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.prompt-ops__columns>section{min-width:0;border:1px solid var(--line);border-radius:14px;padding:14px;background:#0b1421}.prompt-ops__form{display:grid;gap:8px}.prompt-ops__form input,.prompt-ops__form textarea,.prompt-ops__actions input{box-sizing:border-box;width:100%}.prompt-ops__versions{display:grid;gap:6px;margin-top:12px;max-height:210px;overflow:auto}.prompt-ops__versions>button{display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:9px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}.prompt-ops__versions>button.active{border-color:var(--accent);background:var(--accent-soft)}.prompt-ops__versions small{color:var(--muted)}.prompt-ops__actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.prompt-ops__actions button{border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:transparent;color:inherit}.prompt-ops__regeneration{display:grid;gap:8px;margin-top:12px;border:1px solid var(--line);border-radius:10px}.prompt-ops__regeneration label{display:grid;gap:4px;font-size:10px;color:var(--muted)}.prompt-ops__regeneration select{width:100%}.prompt-ops__regeneration small{color:var(--muted)}.prompt-ops__preview{max-height:180px;overflow:auto;white-space:pre-wrap}.prompt-ops__status{color:var(--success)}.prompt-ops__error{color:var(--danger)}@media(max-width:760px){.prompt-ops__columns{grid-template-columns:1fr}}
</style>
