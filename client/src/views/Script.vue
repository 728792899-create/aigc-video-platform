<template>
  <div class="script-page">
    <div class="page-header">
      <h1 class="text-gradient">{{ $t('script.title') }}</h1>
      <p v-if="project">{{ $t('script.projectLabel') }}: {{ project.name }}</p>
      <el-button class="continuity-btn" type="primary" plain @click="openContinuityDrawer">
        {{ $t('script.storySettings') }}
      </el-button>
    </div>

    <WorkbenchGuide
      :guide="workbenchStatus"
      :repairing="repairingWorkbench"
      title="剧本工作台"
      @refresh="loadWorkbenchStatus"
      @repair="handleWorkbenchRepair"
      @primary="handleGuidePrimary"
    />

    <div v-if="chapterSummary.length" class="chapter-summary">
      <div class="chapter-summary-head">
        <strong>章节结构</strong>
        <span>{{ chapterSummary.length }} 章 · 预计 {{ Math.round(totalStoryboardDuration / 60) }} 分钟</span>
      </div>
      <div class="chapter-list">
        <div v-for="chapter in chapterSummary" :key="chapter.index" class="chapter-chip">
          <span>{{ chapter.title }}</span>
          <small>{{ chapter.count }} 镜 · {{ Math.round(chapter.duration / 60) }} 分钟</small>
        </div>
      </div>
    </div>

    <div class="generation-section">
      <div class="form-group">
        <label style="display:flex;align-items:center;justify-content:space-between">
          <span>{{ $t('script.themeLabel') }}</span>
          <el-button size="small" text type="primary" :loading="optimizing" @click="optimizeTheme" :disabled="!theme || !theme.trim()">
            ✨ {{ $t('script.optimizeTheme') }}
          </el-button>
        </label>
        <el-input
          v-model="theme"
          type="textarea"
          :rows="4"
          :placeholder="$t('script.themePlaceholder')"
        />
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label>视频长度预设</label>
          <el-select v-model="durationPreset" style="width:100%; margin-bottom: 10px" @change="applyDurationPreset">
            <el-option v-for="item in durationPresetOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <label>时长范围：{{ durationRangeText }}</label>
          <el-slider
            v-model="duration"
            range
            :min="30"
            :max="durationSliderMax"
            :step="durationSliderStep"
            :format-tooltip="formatDuration"
            @change="markDurationCustom"
          />
          <div class="duration-meta">目标约 {{ durationTargetText }}，生成时会尽量落在该范围内。该设置只影响下一次生成，不会自动修改已保存分镜。</div>
          <div v-if="isLongDuration" class="long-video-hint">
            长视频模式：系统会按章节生成分镜，并在导出时自动分段合成，适合 10 分钟以上内容。
          </div>
        </div>

        <div class="form-group" style="min-width: 200px">
          <label>{{ $t('script.visualStyle') }}</label>
          <el-select v-model="style" :placeholder="$t('script.selectStyle')">
            <el-option
              v-for="item in styleOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
      </div>

      <el-collapse class="advanced-collapse">
        <el-collapse-item title="高级设置" name="advanced">
          <div class="form-row">
            <div class="form-group flex-1">
              <label>{{ $t('script.scriptModelLabel') }}</label>
              <el-select v-model="scriptProvider" :placeholder="$t('script.selectProvider')" style="width:100%" @change="onScriptProviderChange">
                <el-option
                  v-for="p in llmProviders"
                  :key="p.key"
                  :label="p.label + (p.configured ? '' : $t('script.notConfigured'))"
                  :value="p.key"
                  :disabled="!p.configured"
                />
              </el-select>
            </div>
            <div class="form-group flex-1">
              <label>{{ $t('script.specificModel') }}</label>
              <el-select v-model="scriptModel" :placeholder="$t('script.selectModel')" style="width:100%">
                <el-option v-for="m in scriptModelOptions" :key="m" :label="m" :value="m" />
              </el-select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group flex-1">
              <label>{{ $t('script.detailLevel') }}</label>
              <el-select v-model="detailLevel" style="width:100%">
                <el-option v-for="item in detailLevelOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
              <p class="detail-hint">当前时长下，{{ currentDetailHint }}。长视频会按章节保持同样的朗读密度。</p>
            </div>
            <div class="form-group flex-1">
              <label>{{ $t('script.skill') }}</label>
              <el-select ref="skillSelectRef" v-model="skillIds" multiple collapse-tags collapse-tags-tooltip
                :placeholder="$t('script.skillNone')" clearable style="width:100%"
                @change="closeSkillSelect">
                <el-option v-for="s in scriptSkills" :key="s.id" :label="`${s.icon} ${s.name}`" :value="s.id" />
              </el-select>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <div v-if="autoSkills.length" class="auto-skills-bar">
        <span class="auto-skills-label">⚡ {{ $t('script.autoSkillsLabel') }}</span>
        <el-tag v-for="s in autoSkills" :key="s.id" size="small" type="danger" effect="plain" class="auto-skill-tag">{{ s.icon }} {{ s.name }}</el-tag>
        <el-tooltip :content="$t('script.autoSkillsHint')" placement="top">
          <span class="auto-skills-help">?</span>
        </el-tooltip>
      </div>

      <el-button
        type="primary"
        size="large"
        class="generate-btn"
        :loading="generating"
        @click="generateScript"
      >
        <span v-if="!generating">✨ {{ $t('script.generateBtn') }}</span>
        <span v-else>{{ $t('script.generating') }}</span>
      </el-button>
    </div>

    <div v-if="scriptResult" class="result-section">
      <div class="result-header">
        <div>
          <h2>{{ scriptResult.title }}</h2>
          <p class="summary">{{ scriptResult.summary }}</p>
        </div>
        <el-button type="success" @click="saveStoryboards" :loading="saving">
          {{ $t('script.saveStoryboards') }}
        </el-button>
      </div>

      <div class="duration-status" :class="{ 'is-mismatch': durationMismatch, 'is-ok': !durationMismatch }">
        <div class="duration-status-main">
          <strong>{{ durationMismatch ? '当前分镜与目标时长不匹配' : '当前分镜时长' }}</strong>
          <span>当前 {{ totalStoryboardDurationText }} · 目标 {{ durationRangeText }}</span>
        </div>
        <p v-if="durationMismatch">
          切换视频长度不会自动改写旧分镜。请按当前时长重新生成脚本，确认后再保存分镜替换旧内容。
        </p>
        <el-button
          v-if="durationMismatch"
          type="warning"
          plain
          :loading="generating"
          @click="generateScript"
        >
          按当前时长重新生成脚本
        </el-button>
      </div>

      <div v-if="isLongDuration && storyboards.length" class="narration-quality" :class="{ 'is-warning': narrationTooShort }">
        <div class="narration-quality-head">
          <strong>对白时长质量</strong>
          <el-tag size="small" :type="narrationTooShort ? 'warning' : 'success'">
            覆盖率 {{ narrationCoveragePercent }}%
          </el-tag>
        </div>
        <div class="narration-metrics">
          <span>目标 {{ durationRangeText }}</span>
          <span>分镜 {{ totalStoryboardDurationText }}</span>
          <span>预计旁白 {{ formatDuration(narrationStats.estimatedNarrationSec) }}</span>
          <span>{{ narrationStats.charCount }} 字</span>
        </div>
        <p v-if="qualityWarnings.length">{{ qualityWarnings.join('；') }}</p>
        <el-button
          v-if="narrationTooShort"
          type="warning"
          plain
          :disabled="generating || saving"
          @click="expandNarrationToTarget"
        >
          扩写对白至目标时长
        </el-button>
      </div>

      <StoryboardEditor :scenes="storyboards" :active="activeScenes" @update:active="activeScenes = $event" @expand="expandSceneDialog" />
    </div>

    <ProjectStageFooter
      current-stage="文案创作"
      next-stage="画面生成"
      :ready="scriptStageReady"
      :blocked-reason="scriptStageBlockedReason"
      action-label="进入画面生成"
      ready-hint="分镜已准备好，可以继续生成每一镜画面。"
      @go-next="goNextStage"
    />

    <el-drawer v-model="continuityVisible" :title="$t('script.storySettings')" size="520px">
      <div class="continuity-panel">
        <h3>{{ $t('script.storyBible') }}</h3>
        <el-form label-position="top">
          <el-form-item :label="$t('script.worldview')">
            <el-input v-model="storyBible.worldview" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item :label="$t('script.mainline')">
            <el-input v-model="storyBible.mainline" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item :label="$t('script.previousSummary')">
            <el-input v-model="storyBible.previous_summary" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item :label="$t('script.lockedFacts')">
            <el-input v-model="storyBible.locked_facts" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item :label="$t('script.sceneRules')">
            <el-input v-model="storyBible.scene_rules" type="textarea" :rows="3" />
          </el-form-item>
        </el-form>
        <div class="drawer-actions">
          <el-button type="primary" :loading="savingBible" @click="saveStoryBible">{{ $t('common.save') }}</el-button>
          <el-button :loading="extractingCharacters" @click="handleExtractCharacters">{{ $t('script.extractCharacters') }}</el-button>
        </div>

        <h3 class="characters-title">{{ $t('script.characterLibrary') }}</h3>
        <div v-if="characters.length" class="character-list">
          <div v-for="c in characters" :key="c.id" class="character-card">
            <div class="character-head">
              <div class="character-avatar">
                <img v-if="c.assets?.[0]?.file_url" :src="mediaUrl(c.assets[0].file_url)" :alt="c.name" />
                <span v-else>{{ c.name?.slice(0, 1) || '角' }}</span>
              </div>
              <div class="character-name">
                <strong>{{ c.name }}</strong>
                <small>{{ c.role || '角色' }} · {{ c.assets?.length || 0 }} 张参考图</small>
              </div>
              <el-tag size="small" :type="c.locked ? 'success' : 'warning'">
                {{ c.locked ? $t('script.locked') : $t('script.unlocked') }}
              </el-tag>
            </div>
            <el-input v-model="c.prompt_anchor" type="textarea" :rows="3" :placeholder="$t('script.characterAnchorPlaceholder')" />
            <div class="character-meta">
              <span>{{ $t('script.role') }}：{{ c.role || '-' }}</span>
              <span>{{ $t('script.references') }}：{{ c.assets?.length || 0 }}</span>
            </div>
            <div class="character-actions">
              <el-button size="small" @click="saveCharacter(c)">{{ $t('common.save') }}</el-button>
              <el-button size="small" :type="c.locked ? 'warning' : 'success'" @click="toggleCharacterLock(c)">
                {{ c.locked ? $t('script.unlockCharacter') : $t('script.lockCharacter') }}
              </el-button>
            </div>
          </div>
        </div>
        <el-empty v-else :description="$t('script.noCharacters')" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { getProviders } from '../api/providers'
import { listSkills, listActiveSkills } from '../api/skills'
import { mediaUrl } from '../api/config'
import { getWorkbenchStatus, repairWorkbench } from '../api/projects'
import WorkbenchGuide from '../components/WorkbenchGuide.vue'
import ProjectStageFooter from '../components/ProjectStageFooter.vue'
import StoryboardEditor from '../components/StoryboardEditor.vue'
import {
  DURATION_PRESET_OPTIONS,
  DEFAULT_DURATION_PRESET,
  DEFAULT_DURATION_RANGE,
  detailOptionLabel,
  durationPayload,
  formatDuration,
  formatDurationRange,
  inferDurationPreset,
  isLongDurationRange,
  normalizeDurationRange,
  rangeForPreset,
  sliderMaxForDuration,
  sliderStepForDuration,
  targetDurationSec,
} from '../utils/durationPresets'
import {
  getStoryBible,
  updateStoryBible,
  listCharacters,
  extractCharacters,
  updateCharacter,
  lockCharacter,
} from '../api/continuity'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = route.params.id

const project = ref(null)
const theme = ref('')
const duration = ref([...DEFAULT_DURATION_RANGE])
const durationPreset = ref(DEFAULT_DURATION_PRESET)
const style = ref('写实')
const generating = ref(false)
const saving = ref(false)
const optimizing = ref(false)
const scriptResult = ref(null)
const storyboards = ref([])
const savedStoryboardIds = ref([])
const activeScenes = ref([])
// ⑥⑦ 台词详细程度 + 创作技能
const detailLevel = ref('standard')
const skillIds = ref([])
const scriptSkills = ref([])
const autoSkills = ref([])
const skillSelectRef = ref(null)
const continuityVisible = ref(false)
const savingBible = ref(false)
const extractingCharacters = ref(false)
const storyBible = ref({})
const characters = ref([])
const workbenchStatus = ref(null)
const repairingWorkbench = ref(false)
const durationPresetOptions = DURATION_PRESET_OPTIONS

const llmProviders = ref([])
const scriptProvider = ref('deepseek')
const scriptModel = ref('')

function closeSelectAfterChange(selectRef) {
  nextTick(() => selectRef.value?.blur?.())
}

function closeSkillSelect() {
  closeSelectAfterChange(skillSelectRef)
}
const scriptModelOptions = computed(() => {
  const p = llmProviders.value.find((x) => x.key === scriptProvider.value)
  return p ? p.models : []
})
const durationRangeText = computed(() => formatDurationRange(duration.value))
const durationTargetText = computed(() => formatDuration(targetDurationSec(duration.value)))
const isLongDuration = computed(() => isLongDurationRange(duration.value))
const durationSliderMax = computed(() => sliderMaxForDuration(duration.value, durationPreset.value))
const durationSliderStep = computed(() => sliderStepForDuration(duration.value, durationPreset.value))
const detailLevelOptions = computed(() => [
  { value: 'concise', label: detailOptionLabel('精简', 'concise', duration.value) },
  { value: 'standard', label: detailOptionLabel('标准', 'standard', duration.value) },
  { value: 'rich', label: detailOptionLabel('丰富', 'rich', duration.value) },
])
const currentDetailHint = computed(() => {
  const item = detailLevelOptions.value.find((x) => x.value === detailLevel.value)
  return item ? item.label : detailLevelOptions.value[1].label
})
const scriptStageReady = computed(() => storyboards.value.some((s) => s.id))
const totalStoryboardDuration = computed(() => storyboards.value.reduce((sum, s) => sum + (Number(s.duration) || 5), 0))
const totalStoryboardDurationText = computed(() => formatDuration(totalStoryboardDuration.value))
const durationMismatch = computed(() => {
  if (!storyboards.value.length) return false
  const [min, max] = normalizeDurationRange(duration.value, DEFAULT_DURATION_RANGE)
  const total = totalStoryboardDuration.value
  return total < min || total > max
})
const narrationCps = computed(() => {
  if (detailLevel.value === 'concise') return 3.5
  if (detailLevel.value === 'rich') return 5.1
  return 4.25
})
function countNarrationChars(text) {
  return String(text || '')
    .replace(/(^|[\n。！？；.!?;])\s*[（(【[][^）)】\]\n]{1,12}[）)】\]][:：]?\s*/g, '$1')
    .replace(/^[^：:\n]{1,8}\s*[：:]\s*/gm, '')
    .replace(/[\s"'“”‘’《》〈〉「」『』【】（）()[\]{}、，。！？；：,.!?;:—…·-]/g, '')
    .length
}
const narrationStats = computed(() => {
  const charCount = storyboards.value.reduce((sum, s) => sum + countNarrationChars(s.dialog || s.subtitle_text || ''), 0)
  const estimatedNarrationSec = Math.round(charCount / narrationCps.value)
  const target = targetDurationSec(duration.value)
  return {
    charCount,
    estimatedNarrationSec,
    targetDurationSec: target,
    coverage: target ? estimatedNarrationSec / target : 0,
  }
})
const narrationCoveragePercent = computed(() => Math.round((narrationStats.value.coverage || 0) * 100))
const narrationTooShort = computed(() => {
  if (!isLongDuration.value || !storyboards.value.length) return false
  const [min] = normalizeDurationRange(duration.value, DEFAULT_DURATION_RANGE)
  return narrationStats.value.estimatedNarrationSec < min * 0.85
})
const qualityWarnings = computed(() => {
  const warnings = [...(scriptResult.value?.quality_warnings || scriptResult.value?._warnings || [])]
  if (narrationTooShort.value) {
    warnings.push(`对白预计只能朗读 ${formatDuration(narrationStats.value.estimatedNarrationSec)}，低于目标下限，导出后可能出现停顿或实际成片偏短`)
  }
  return [...new Set(warnings)]
})
const chapterSummary = computed(() => {
  const map = new Map()
  for (const sb of storyboards.value) {
    const index = Number(sb.chapter_index || 0)
    if (!index || storyboards.value.length < 20) continue
    if (!map.has(index)) map.set(index, {
      index,
      title: sb.chapter_title || `第 ${index} 章`,
      count: 0,
      duration: 0,
    })
    const item = map.get(index)
    item.count += 1
    item.duration += Number(sb.duration) || 5
  }
  return [...map.values()].sort((a, b) => a.index - b.index)
})
const scriptStageBlockedReason = computed(() => {
  if (generating.value) return '正在生成文案和分镜，请稍等。'
  if (saving.value) return '正在保存分镜，请稍等。'
  return '请先生成并保存分镜，再进入画面生成。'
})

function goNextStage() {
  router.push(`/projects/${projectId}/images`)
}

function applyDurationPreset(value) {
  if (value === 'custom') return
  duration.value = rangeForPreset(value, duration.value)
}

function markDurationCustom() {
  durationPreset.value = 'custom'
}

function expandDialogLocally(scene, targetExtraChars, index) {
  const chapter = scene.chapter_title || '当前章节'
  const topic = theme.value || project.value?.theme || '这个主题'
  const sentences = [
    `这一段可以继续把「${topic}」放进更具体的画面里，让观众看到问题是怎样发生的，而不是只听到一个抽象判断。`,
    `为了让节奏更自然，旁白需要补足原因、过程和结果三个层次，这样画面停留时仍然有新的信息进入。`,
    `如果这里只靠画面静止等待，观众会感觉内容被拉长；但把这个细节讲透，镜头就有了存在的理由。`,
    `回到「${chapter}」，这一镜应该承接上一段，同时把下一步要看的重点提前说清楚。`,
    `这里不需要堆概念，而是用一句清楚的话解释它为什么重要，再用一个具体场景说明它会带来什么变化。`,
    `这样处理以后，配音、字幕和画面会沿着同一条逻辑往前走，最终视频也不会像是被硬补出来的时长。`,
  ]
  const original = String(scene.dialog || '').trim()
  let text = original
  let guard = 0
  const target = countNarrationChars(original) + targetExtraChars
  while (countNarrationChars(text) < target && guard < sentences.length * 3) {
    const sentence = sentences[(index + guard) % sentences.length]
    text += sentence
    guard++
  }
  scene.dialog = text
  scene.duration = Math.max(8, Math.min(60, Math.round(countNarrationChars(text) / narrationCps.value + 0.8)))
}

function refreshNarrationMeta() {
  if (!scriptResult.value) return
  scriptResult.value.narration_stats = {
    char_count: narrationStats.value.charCount,
    chars_per_second: narrationCps.value,
    storyboard_duration_sec: Math.round(totalStoryboardDuration.value),
    estimated_narration_sec: narrationStats.value.estimatedNarrationSec,
    target_duration_sec: narrationStats.value.targetDurationSec,
    narration_coverage: Math.round(narrationStats.value.coverage * 1000) / 1000,
  }
  scriptResult.value.quality_warnings = qualityWarnings.value.filter((item) => !item.includes('低于目标下限'))
}

function expandNarrationToTarget() {
  if (!storyboards.value.length) return
  const targetSec = targetDurationSec(duration.value)
  const missingChars = Math.max(0, Math.ceil((targetSec - narrationStats.value.estimatedNarrationSec) * narrationCps.value))
  if (!missingChars) return
  const perScene = Math.ceil(missingChars / storyboards.value.length)
  storyboards.value.forEach((scene, index) => expandDialogLocally(scene, perScene, index))
  refreshNarrationMeta()
  ElMessage.success('已扩写当前生成结果的对白。确认效果后再保存分镜，旧分镜不会被自动覆盖。')
}

function onScriptProviderChange() {
  const models = scriptModelOptions.value
  if (models.length && !models.includes(scriptModel.value)) {
    scriptModel.value = models[0]
  }
}

const loadLlmProviders = async () => {
  try {
    const grouped = await getProviders()
    llmProviders.value = (grouped && grouped.llm) || []
    const configured = llmProviders.value.filter((p) => p.configured)
    if (configured.length && !configured.find((p) => p.key === scriptProvider.value)) {
      scriptProvider.value = configured[0].key
    }
    onScriptProviderChange()
  } catch (e) {
    // 拉取失败则保持默认 deepseek，generateScript 不传 provider 即走后端默认
  }
}

const styleOptions = computed(() => [
  { value: '写实', label: t('script.styleRealistic') },
  { value: '赛博朋克', label: t('script.styleCyberpunk') },
  { value: '水墨画', label: t('script.styleInkWash') },
  { value: '动漫', label: t('script.styleAnime') },
  { value: '油画', label: t('script.styleOil') },
  { value: '像素风', label: t('script.stylePixel') },
])

const loadProject = async () => {
  try {
    const res = await api.get(`/projects/${projectId}`)
    project.value = res.data.data || res.data
    if (project.value?.theme && !theme.value) theme.value = project.value.theme
    if (project.value?.style && !style.value) style.value = project.value.style
    const savedMin = Number(project.value?.duration_min)
    const savedMax = Number(project.value?.duration_max)
    const savedRange = Number.isFinite(savedMin) && Number.isFinite(savedMax) && savedMin > 0 && savedMax >= savedMin
      ? [savedMin, savedMax]
      : null
    if (savedRange && !(savedRange[0] === 60 && savedRange[1] === 180)) {
      duration.value = savedRange
      durationPreset.value = inferDurationPreset(savedRange)
    }
  } catch (e) {
    ElMessage.error(t('script.loadProjectFailed'))
  }
}

const loadWorkbenchStatus = async () => {
  try {
    workbenchStatus.value = await getWorkbenchStatus(projectId)
  } catch {
    workbenchStatus.value = null
  }
}

const handleWorkbenchRepair = async (type = 'auto') => {
  repairingWorkbench.value = true
  try {
    await repairWorkbench(projectId, { type })
    ElMessage.success('工作台已完成修复')
    await Promise.all([loadContinuity(), loadWorkbenchStatus(), loadStoryboards()])
  } catch (e) {
    ElMessage.error(e.message || '修复失败')
  } finally {
    repairingWorkbench.value = false
  }
}

const handleGuidePrimary = async (action) => {
  if (!action) return
  if (action.type === 'repair_characters') {
    await handleExtractCharacters()
    return
  }
  if (action.type === 'generate_script') {
    await generateScript()
    return
  }
  if (action.type === 'auto_lock') {
    await handleWorkbenchRepair('auto_lock')
  }
}

const loadStoryboards = async () => {
  try {
    const res = await api.get(`/storyboards/project/${projectId}`)
    const list = res.data.data || res.data || []
    if (list.length) {
      storyboards.value = list
      savedStoryboardIds.value = list.map((item) => item.id).filter(Boolean)
      scriptResult.value = { title: t('script.savedStoryboards'), summary: '' }
      activeScenes.value = [0]
    } else {
      savedStoryboardIds.value = []
    }
  } catch (e) {
    // No existing storyboards
  }
}

// ✨ 主题 AI 优化（问题7）：润色后弹对比框，用户可一键采用
const optimizeTheme = async () => {
  if (!theme.value.trim()) {
    ElMessage.warning(t('script.themeRequired'))
    return
  }
  optimizing.value = true
  try {
    const res = await api.post('/ai/optimize-theme', {
      theme: theme.value,
      style: style.value,
      scriptProvider: scriptProvider.value || undefined,
      scriptModel: scriptModel.value || undefined,
    })
    const data = res.data.data || res.data
    const optimized = data.theme
    if (!optimized) throw new Error('empty')
    await ElMessageBox.confirm(
      `<div style="margin-bottom:10px;line-height:1.6"><b>${t('script.optimizeOriginal')}</b><br/>${escapeHtml(data.original || theme.value)}</div>` +
      `<div style="line-height:1.6"><b style="color:var(--el-color-primary)">${t('script.optimizeResult')}</b><br/>${escapeHtml(optimized)}</div>`,
      t('script.optimizeTitle'),
      { confirmButtonText: t('script.optimizeApply'), cancelButtonText: t('script.optimizeKeep'), dangerouslyUseHTMLString: true }
    )
    theme.value = optimized
    ElMessage.success(t('script.optimizeApplied'))
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(t('script.optimizeFailed'))
  } finally {
    optimizing.value = false
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

const generateScript = async () => {
  if (!theme.value.trim()) {
    ElMessage.warning(t('script.themeRequired'))
    return
  }
  generating.value = true
  try {
    const res = await api.post('/ai/generate-script', {
      theme: theme.value,
      duration: durationPayload(duration.value),
      durationPreset: durationPreset.value,
      durationMode: 'tolerance',
      targetDurationSec: targetDurationSec(duration.value),
      style: style.value,
      scriptProvider: scriptProvider.value || undefined,
      scriptModel: scriptModel.value || undefined,
      detailLevel: detailLevel.value,
      skill_ids: skillIds.value?.length ? skillIds.value : undefined,
      project_id: projectId,
    })
    const data = res.data.data || res.data
    scriptResult.value = data
    storyboards.value = data.storyboards || []
    activeScenes.value = storyboards.value.map((_, i) => i)
    ElMessage.success(t('script.generateSuccess'))
    await loadWorkbenchStatus()
  } catch (e) {
    ElMessage.error(t('script.generateFailed'))
  } finally {
    generating.value = false
  }
}

// ⑥ 单镜台词 AI 扩写
const expandSceneDialog = async (scene) => {
  if (!scene.dialog || !scene.dialog.trim()) {
    ElMessage.warning(t('script.dialogEmpty'))
    return
  }
  scene._expanding = true
  try {
    const res = await api.post('/ai/expand-dialog', {
      dialog: scene.dialog,
      storyboard_id: scene.id || undefined,
      detailLevel: 'rich',
      skill_ids: skillIds.value?.length ? skillIds.value : undefined,
    })
    const data = res.data.data || res.data
    if (data && data.dialog) {
      scene.dialog = data.dialog
      ElMessage.success(t('script.expandSuccess'))
    } else {
      ElMessage.warning(t('script.expandFailed'))
    }
  } catch (e) {
    ElMessage.error(t('script.expandFailed'))
  } finally {
    scene._expanding = false
  }
}

const saveStoryboards = async () => {
  saving.value = true
  try {
    const hadSavedStoryboards = savedStoryboardIds.value.length > 0
    const response = await api.post('/storyboards/reconcile', {
      project_id: projectId,
      storyboards: storyboards.value,
      visual_anchor: (scriptResult.value && scriptResult.value.visual_anchor) || undefined,
      script_result: scriptResult.value || undefined,
      duration_min: duration.value[0],
      duration_max: duration.value[1],
      targetDurationSec: targetDurationSec(duration.value),
      durationPreset: durationPreset.value,
      durationMode: 'tolerance',
    })
    const detail = response.data.data || {}
    const regenerateIds = detail.regenerate_ids || []
    ElMessage.success(regenerateIds.length
      ? `分镜保存成功，${regenerateIds.length} 个镜头的旧素材已失效`
      : t('script.saveStoryboardsSuccess'))

    // 已有项目改稿时给用户明确选择；确认后只重生成后端 diff 返回的受影响镜头。
    // 首次保存不会自动调用模型，保持既有“先存脚本、再进入素材阶段”的行为。
    if (hadSavedStoryboards && regenerateIds.length) {
      try {
        await ElMessageBox.confirm(
          `检测到 ${regenerateIds.length} 个新增或内容变化的分镜。是否立即仅为这些分镜重新生成配图和配音？此操作会调用已配置的模型。`,
          '局部重生成',
          { confirmButtonText: '仅重生成变化镜头', cancelButtonText: '稍后手动生成', type: 'warning' }
        )
        await regenerateStoryboardAssets(regenerateIds, detail.storyboards || [])
      } catch (e) {
        if (e !== 'cancel' && e !== 'close') throw e
      }
    }
    await Promise.all([loadContinuity(), loadWorkbenchStatus(), loadStoryboards()])
  } catch (e) {
    ElMessage.error(t('script.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function regenerateStoryboardAssets(ids, rows) {
  let submitted = 0
  let failed = 0
  for (const id of ids) {
    const scene = rows.find((item) => Number(item.id) === Number(id))
    if (!scene) continue
    const jobs = [api.post('/ai/generate-image', {
      storyboard_id: id,
      async: true,
      batch_size: 1,
      repair_mode: true,
      auto_select_best: true,
      reuse_cache: false,
    })]
    if (String(scene.dialog || '').trim() && !scene.no_voice) {
      jobs.push(api.post('/ai/generate-tts', {
        text: scene.dialog,
        storyboard_id: id,
        voice: scene.voice || undefined,
      }))
    }
    const results = await Promise.allSettled(jobs)
    if (results.some((item) => item.status === 'rejected')) failed++
    else submitted++
  }
  if (failed) ElMessage.warning(`已提交 ${submitted} 个镜头，另有 ${failed} 个镜头需稍后手动重试`)
  else ElMessage.success(`已仅为 ${submitted} 个变化镜头提交素材重生成`)
}

const loadContinuity = async () => {
  try {
    storyBible.value = await getStoryBible(projectId) || {}
  } catch {
    storyBible.value = {}
  }
  try {
    characters.value = await listCharacters(projectId) || []
  } catch {
    characters.value = []
  }
}

const openContinuityDrawer = async () => {
  continuityVisible.value = true
  await loadContinuity()
}

const saveStoryBible = async () => {
  savingBible.value = true
  try {
    storyBible.value = await updateStoryBible(projectId, storyBible.value)
    ElMessage.success(t('script.storyBibleSaved'))
  } catch (e) {
    ElMessage.error(e.message || t('script.storyBibleSaveFailed'))
  } finally {
    savingBible.value = false
  }
}

const handleExtractCharacters = async () => {
  extractingCharacters.value = true
  try {
    characters.value = await extractCharacters(projectId, false)
    ElMessage.success(t('script.charactersExtracted'))
    await loadWorkbenchStatus()
  } catch (e) {
    ElMessage.error(e.message || t('script.charactersExtractFailed'))
  } finally {
    extractingCharacters.value = false
  }
}

const saveCharacter = async (character) => {
  try {
    await updateCharacter(character.id, character)
    ElMessage.success(t('script.characterSaved'))
    await loadContinuity()
    await loadWorkbenchStatus()
  } catch (e) {
    ElMessage.error(e.message || t('script.characterSaveFailed'))
  }
}

const toggleCharacterLock = async (character) => {
  try {
    await lockCharacter(character.id, !character.locked)
    ElMessage.success(!character.locked ? t('script.characterLocked') : t('script.characterUnlocked'))
    await loadContinuity()
    await loadWorkbenchStatus()
  } catch (e) {
    ElMessage.error(e.message || t('script.characterLockFailed'))
  }
}

onMounted(() => {
  loadProject()
  loadStoryboards()
  loadLlmProviders()
  loadContinuity()
  loadWorkbenchStatus()
  // 加载可选技能(供手动勾选),只显示 enabled 且非自动应用的技能(避免重复)
  listSkills('script', true).then((list) => { 
    scriptSkills.value = list.filter(s => !s.auto_apply) 
  }).catch(() => {})
  // 加载必用技能(自动生效),在界面透明展示
  listActiveSkills('script').then((list) => { autoSkills.value = list }).catch(() => {})
})
</script>

<style scoped src="../styles/script.css"></style>
