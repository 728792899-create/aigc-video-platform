<template>
  <section
    class="script-workspace"
    data-figma-node="14:63"
    data-figma-spec="T/05-Script"
    aria-labelledby="script-workspace-title"
  >
    <header class="script-workspace__heading">
      <h1 id="script-workspace-title">剧本编辑室</h1>
      <p>以分集、场景和镜头结构编辑，版本冲突可比较并恢复。</p>
    </header>

    <div v-if="scenes.length" class="script-workspace__layout">
      <nav class="script-workspace__tree" aria-label="场景树">
        <h2>场景树</h2>
        <button
          v-for="(scene, index) in scenes"
          :key="scene.id"
          type="button"
          :class="{ active: scene.id === selectedSceneId }"
          :aria-current="scene.id === selectedSceneId ? 'true' : undefined"
          @click="selectScene(scene.id)"
        >
          {{ String(index + 1).padStart(2, '0') }} {{ shortSceneTitle(scene.title) }}
        </button>
      </nav>

      <section class="script-workspace__editor" aria-labelledby="active-scene-title">
        <input
          id="active-scene-title"
          v-model.trim="draft.title"
          class="script-workspace__title-input"
          maxlength="200"
          aria-label="场景标题"
          @input="scheduleSave"
        />
        <textarea
          v-model="draft.content"
          class="script-workspace__body-input"
          maxlength="12000"
          aria-label="场景正文"
          spellcheck="false"
          @input="scheduleSave"
        />
        <p class="script-workspace__save-state" role="status">
          <LoaderCircle v-if="saveState === 'saving'" class="spin" :size="12" aria-hidden="true" />
          <Check v-else :size="12" aria-hidden="true" />
          revision {{ activeScene?.revision ?? 1 }} · {{ saveStateLabel }}
        </p>
      </section>

      <aside class="script-workspace__inspector" aria-labelledby="script-inspector-title">
        <h2 id="script-inspector-title">版本与来源</h2>
        <div class="script-workspace__provenance">
          <p>来源：CreativeBrief r{{ creativeBriefRevision }}</p>
          <p>当前：ScenePatch r{{ activeScene?.revision ?? 1 }}</p>
          <p>锁定字段：主角身份、世界观</p>
          <p class="script-workspace__section-label">最近变更</p>
          <ul>
            <li v-for="change in recentChanges" :key="change">{{ change }}</li>
          </ul>
          <p>保存冲突时先比较 diff，<br />不会覆盖其他 revision。</p>
        </div>
      </aside>
    </div>

    <div v-else class="script-workspace__empty">
      <FileText :size="28" aria-hidden="true" />
      <h2>还没有可编辑的场景</h2>
      <p>先返回简报完成批准。系统会从已确认的来源生成可追踪场景，不调用付费模型。</p>
      <button type="button" @click="$emit('navigate', 'brief')">返回创作简报</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Check, FileText, LoaderCircle } from 'lucide-vue-next'
import type { ProjectSnapshot, Scene, Shot } from '@aigc-director/contracts'
import type { StudioWorkspaceId } from '../workspaces.js'

type ScriptScene = Pick<Scene, 'id' | 'title' | 'synopsis' | 'ordinal' | 'revision'> & { shots: Shot[]; demo?: boolean }
type ScriptDraft = { title: string; content: string }

const props = withDefaults(defineProps<{
  snapshot: ProjectSnapshot
  creativeBriefRevision?: number
}>(), { creativeBriefRevision: 1 })

defineEmits<{ navigate: [workspaceId: StudioWorkspaceId] }>()

const demoScenes: ScriptScene[] = [
  { id: 'demo-scene-01', title: '云海序幕', synopsis: '外景 · 云海机巧市 · 黄昏\n\n苏绫乘坐档案艇穿过云海，远处的星阙档案塔在停摆百年后重新亮起。', ordinal: 0, revision: 12, shots: [], demo: true },
  { id: 'demo-scene-02', title: '档案塔内', synopsis: '内景 · 星阙档案塔 · 夜\n\n苏绫与玄戈进入停摆的塔厅，零尾投射出残缺的星图坐标。', ordinal: 1, revision: 12, shots: [], demo: true },
  { id: 'demo-scene-03', title: '星核显现', synopsis: '内景 · 星阙档案塔 · 夜\n\n苏绫沿着断裂的星图刻线寻找最后一枚坐标。\n零尾在她肩侧展开半透明的导航弧。\n\n玄戈停在门边，机械指节收紧。\n\n苏绫\n“这里不是缺了一颗星，是有人删掉了回去的路。”\n\n地板下方传来齿轮复位声。司南星核缓慢升起。', ordinal: 2, revision: 12, shots: [], demo: true },
  { id: 'demo-scene-04', title: '云市追逐', synopsis: '外景 · 云海机巧市 · 夜\n\n失控的星核穿过吊桥，苏绫与玄戈沿着折叠街巷追逐它留下的回声。', ordinal: 3, revision: 12, shots: [], demo: true },
  { id: 'demo-scene-05', title: '塔门开启', synopsis: '内景 · 星阙档案塔 · 黎明前\n\n司南星核嵌入塔门，失踪档案的封印开始松动。', ordinal: 4, revision: 12, shots: [], demo: true },
  { id: 'demo-scene-06', title: '星图回声', synopsis: '外景 · 云海之上 · 黎明\n\n第一束晨光穿过星图，未来失踪事件的坐标仍在继续闪烁。', ordinal: 5, revision: 12, shots: [], demo: true },
]

const scenes = computed<ScriptScene[]>(() => {
  const actual = [...props.snapshot.scenes]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((scene) => ({ ...scene, shots: props.snapshot.shots.filter((shot) => shot.sceneId === scene.id).sort((left, right) => left.ordinal - right.ordinal) }))
  const isXingqueDemo = props.snapshot.project.name.replace(/[《》]/gu, '') === '星阙回声'
  if (!isXingqueDemo) return actual

  // The zero-key Demo keeps canonical scene IDs/revisions for recovery while
  // presenting the approved screenplay copy used by the v2 product spec.
  return demoScenes.map((demoScene, index) => {
    const canonicalScene = actual[index]
    if (!canonicalScene) return demoScene
    return {
      ...canonicalScene,
      title: demoScene.title,
      synopsis: demoScene.synopsis,
      demo: true,
    }
  })
})

const selectedSceneId = ref('')
const draft = reactive<ScriptDraft>({ title: '', content: '' })
const saveState = ref<'saved' | 'saving' | 'draft'>('saved')
let saveTimer: ReturnType<typeof setTimeout> | undefined

const activeScene = computed(() => scenes.value.find((scene) => scene.id === selectedSceneId.value) ?? scenes.value[0])
const creativeBriefRevision = computed(() => Math.max(1, props.creativeBriefRevision))
const draftStorageKey = computed(() => activeScene.value ? `aigc-director:script-draft:${props.snapshot.project.id}:${activeScene.value.id}` : '')
const recentChanges = computed(() => {
  const scene = activeScene.value
  if (!scene) return ['尚无变更']
  if (saveState.value === 'draft') return ['已更新场景正文', '等待本机自动保存']
  if (scene.demo && scene.ordinal === 2) return ['增加星核显现动作', '精简对白 18 字']
  const changes = scene.shots.flatMap((shot) => shot.staleFields).filter((field) => field.startsWith('script.')).slice(0, 2)
  return changes.length ? changes.map((field) => humanizeField(field)) : ['当前 revision 已同步', '下游变更可追踪']
})
const saveStateLabel = computed(() => saveState.value === 'saving' ? '正在保存本机草稿' : saveState.value === 'draft' ? '有未保存修改' : '已保存')

watch(scenes, (next) => {
  if (!next.some((scene) => scene.id === selectedSceneId.value)) selectedSceneId.value = next[Math.min(2, Math.max(0, next.length - 1))]?.id ?? ''
}, { immediate: true })

watch(activeScene, loadActiveDraft, { immediate: true })

function shortSceneTitle(title: string): string {
  return title.replace(/^场景\s*\d+\s*[·.、:-]?\s*/u, '').trim() || title
}

function sceneContent(scene: ScriptScene): string {
  if (scene.demo || scene.shots.length === 0) return scene.synopsis
  const shotText = scene.shots.map((shot) => [shot.description, shot.dialogue ? `\n${shot.dialogue}` : ''].join('')).join('\n\n')
  return [scene.synopsis, shotText].filter(Boolean).join('\n\n')
}

function loadActiveDraft(): void {
  clearTimeout(saveTimer)
  const scene = activeScene.value
  if (!scene) {
    draft.title = ''
    draft.content = ''
    return
  }
  const stored = localStorage.getItem(draftStorageKey.value)
  let parsed: ScriptDraft | undefined
  if (stored) {
    try { parsed = JSON.parse(stored) as ScriptDraft } catch { localStorage.removeItem(draftStorageKey.value) }
  }
  draft.title = parsed?.title ?? `场景 ${String(scene.ordinal + 1).padStart(2, '0')} · ${shortSceneTitle(scene.title)}`
  draft.content = parsed?.content ?? sceneContent(scene)
  saveState.value = 'saved'
}

function selectScene(sceneId: string): void {
  flushSave()
  selectedSceneId.value = sceneId
}

function scheduleSave(): void {
  saveState.value = 'draft'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveState.value = 'saving'
    saveTimer = setTimeout(flushSave, 180)
  }, 420)
}

function flushSave(): void {
  clearTimeout(saveTimer)
  if (!draftStorageKey.value || !activeScene.value) return
  localStorage.setItem(draftStorageKey.value, JSON.stringify({ title: draft.title, content: draft.content }))
  saveState.value = 'saved'
}

function humanizeField(field: string): string {
  if (field.includes('dialogue')) return '对白已修改，下游字幕待复核'
  if (field.includes('synopsis')) return '场景梗概已修改'
  if (field.includes('title')) return '场景标题已修改'
  return '剧本字段已更新'
}

onBeforeUnmount(flushSave)
</script>
