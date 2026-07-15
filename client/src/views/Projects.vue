<template>
  <div class="projects-container">
    <div class="projects-header">
      <h1 class="page-title text-gradient">{{ $t('projects.title') }}</h1>
      <div class="header-actions">
        <el-input
          v-model="searchKeyword"
          :placeholder="$t('projects.searchPlaceholder')"
          prefix-icon="Search"
          clearable
          class="search-input"
          @input="handleSearch"
        />
        <el-button class="cta-button" @click="openAutoDialog">
          <el-icon><MagicStick /></el-icon>{{ $t('projects.oneClick') }}
        </el-button>
        <el-button type="primary" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>{{ $t('projects.newProject') }}
        </el-button>
      </div>
    </div>

    <div class="projects-grid">
      <!-- 加载骨架屏：感知更快，替代转圈遮罩 -->
      <template v-if="loading">
        <div v-for="n in 6" :key="'sk-' + n" class="project-card skeleton-card">
          <el-skeleton animated>
            <template #template>
              <el-skeleton-item variant="image" class="sk-thumb" />
              <div class="sk-body">
                <el-skeleton-item variant="h3" style="width: 60%" />
                <el-skeleton-item variant="text" style="width: 80%; margin-top: 12px" />
                <el-skeleton-item variant="text" style="width: 50%" />
                <el-skeleton-item variant="text" style="width: 40%; margin-top: 16px" />
              </div>
            </template>
          </el-skeleton>
        </div>
      </template>
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        :cover-style="coverGradient(project.name)"
        :initial="coverInitial(project.name)"
        :cover-loading="!!coverGenerating[project.id]"
        :status-text="statusLabel(project.status)"
        :duration-text="formatDurationRange([project.duration_min, project.duration_max])"
        :relative-time="formatRelativeTime(project)"
        :health-status="assetHealthStatus(project)"
        :health-text="assetHealthLabel(project)"
        :health-title="assetHealthTitle(project)"
        @open="goToScript(project.id)"
        @cover-error="onCoverError(project)"
        @generate-cover="generateCover(project)"
        @edit="openEditDialog(project)"
        @complete-check="refreshProjectCompletion(project)"
        @continue="handleContinueProject(project)"
        @series="openSeriesDialog(project)"
        @delete="confirmDelete(project)"
      />

      <div v-if="!loading && projects.length === 0" class="empty-state">
        <el-empty :description="$t('projects.emptyHint')">
          <el-button class="cta-button" @click="openAutoDialog">
            <el-icon><MagicStick /></el-icon>{{ $t('projects.oneClick') }}
          </el-button>
        </el-empty>
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? $t('projects.editProject') : $t('projects.newProject')"
      width="500px"
      class="project-dialog"
    >
      <el-form :model="form" label-width="80px">
        <el-form-item :label="$t('projects.projectName')">
          <el-input v-model="form.name" :placeholder="$t('projects.projectNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('projects.theme')">
          <el-input v-model="form.theme" :placeholder="$t('projects.themePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('projects.style')">
          <el-select v-model="form.style" :placeholder="$t('projects.stylePlaceholder')" style="width:100%">
            <el-option :label="$t('projects.styleRealistic')" value="realistic" />
            <el-option :label="$t('projects.styleAnimation')" value="animation" />
            <el-option :label="$t('projects.styleCyberpunk')" value="cyberpunk" />
            <el-option :label="$t('projects.styleInkWash')" value="ink-wash" />
            <el-option :label="$t('projects.styleMinimal')" value="minimal" />
            <el-option :label="$t('projects.styleRetro')" value="retro" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('projects.durationSec')">
          <el-select v-model="durationPreset" style="width:100%; margin-bottom: 10px" @change="applyProjectDurationPreset">
            <el-option v-for="item in durationPresetOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-slider
            v-model="durationRange"
            range
            :min="30"
            :max="projectDurationSliderMax"
            :step="projectDurationSliderStep"
            :format-tooltip="formatDuration"
            show-stops
            @change="markProjectDurationCustom"
          />
          <div class="duration-hint">{{ formatDurationRange(durationRange) }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ isEdit ? $t('common.save') : $t('projects.submitCreate') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 一键成片 Dialog -->
    <el-dialog
      v-model="autoVisible"
      :title="$t('projects.autoTitle')"
      width="520px"
      class="project-dialog"
      :close-on-click-modal="!autoRunning"
      :show-close="!autoRunning"
    >
      <!-- 输入态 -->
      <div v-if="!autoRunning && !autoDone && !autoFailed">
        <el-form :model="autoForm" label-width="80px">
          <el-form-item :label="$t('projects.autoTheme')">
            <el-input
              v-model="autoForm.theme"
              type="textarea"
              :rows="2"
              :placeholder="$t('projects.autoThemePlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="$t('projects.style')">
            <el-select v-model="autoForm.style" style="width:100%">
              <el-option :label="$t('projects.styleRealistic')" value="realistic" />
              <el-option :label="$t('projects.styleAnimation')" value="animation" />
              <el-option :label="$t('projects.styleCyberpunk')" value="cyberpunk" />
              <el-option :label="$t('projects.styleInkWash')" value="ink-wash" />
              <el-option :label="$t('projects.styleMinimal')" value="minimal" />
              <el-option :label="$t('projects.styleRetro')" value="retro" />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('projects.durationSec')">
            <el-select v-model="autoDurationPreset" style="width:100%; margin-bottom: 10px" @change="applyAutoDurationPreset">
              <el-option v-for="item in durationPresetOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-slider
              v-model="autoDuration"
              range
              :min="30"
              :max="autoDurationSliderMax"
              :step="autoDurationSliderStep"
              :format-tooltip="formatDuration"
              show-stops
              @change="markAutoDurationCustom"
            />
            <div class="duration-hint">{{ formatDurationRange(autoDuration) }}</div>
          </el-form-item>
          <el-form-item :label="$t('projects.ratio')">
            <el-select v-model="autoForm.ratio" style="width:100%">
              <el-option v-for="r in ratioOptionsI18n" :key="r.key" :label="r.label" :value="r.key" />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('projects.consistencyMode')">
            <el-segmented
              v-model="autoForm.consistencyMode"
              :options="consistencyOptions"
            />
            <div class="duration-hint">{{ autoForm.consistencyMode === 'strict' ? $t('projects.consistencyStrictHint') : $t('projects.consistencyStandardHint') }}</div>
          </el-form-item>
          <el-collapse class="advanced-collapse">
            <el-collapse-item title="高级设置" name="advanced">
              <el-form-item :label="$t('projects.scriptModel')">
                <el-select v-model="autoForm.scriptProvider" style="width:100%" @change="onScriptProviderChange">
                  <el-option v-for="p in llmProviders" :key="p.key"
                    :label="p.label + (p.configured ? '' : $t('projects.notConfigured'))" :value="p.key" :disabled="!p.configured" />
                </el-select>
                <div class="duration-hint">{{ $t('projects.scriptModelHint') }}</div>
              </el-form-item>
              <el-form-item :label="$t('projects.imageModel')">
                <el-select v-model="autoForm.imageModel" style="width:100%">
                  <el-option :label="$t('projects.imageFollowSettings')" value="auto" />
                  <el-option v-for="m in imageModelOptions" :key="m.key" :label="m.label" :value="m.key" />
                </el-select>
                <div class="duration-hint">{{ $t('projects.imageModelHint') }}</div>
              </el-form-item>
              <el-form-item :label="$t('projects.scriptSkills') || '文案技能'">
                <el-select ref="scriptSkillSelectRef" v-model="autoForm.scriptSkillIds" multiple collapse-tags collapse-tags-tooltip
                  :placeholder="$t('projects.skillNone') || '不使用可选技能'" clearable style="width:100%"
                  @change="closeScriptSkillSelect">
                  <el-option v-for="s in scriptSkillOptions" :key="s.id" :label="`${s.icon} ${s.name}`" :value="s.id" />
                </el-select>
                <div v-if="autoScriptSkills.length" class="duration-hint">
                  ⚡ {{ $t('projects.autoSkillsLabel') || '必用技能已自动生效' }}：{{ autoScriptSkills.map(s => `${s.icon}${s.name}`).join(' ') }}
                </div>
              </el-form-item>
              <el-form-item :label="$t('projects.imageSkills') || '画面技能'">
                <el-select ref="imageSkillSelectRef" v-model="autoForm.imageSkillIds" multiple collapse-tags collapse-tags-tooltip
                  :placeholder="$t('projects.skillNone') || '不使用可选技能'" clearable style="width:100%"
                  @change="closeImageSkillSelect">
                  <el-option v-for="s in imageSkillOptions" :key="s.id" :label="`${s.icon} ${s.name}`" :value="s.id" />
                </el-select>
                <div v-if="autoImageSkills.length" class="duration-hint">
                  ⚡ {{ $t('projects.autoSkillsLabel') || '必用技能已自动生效' }}：{{ autoImageSkills.map(s => `${s.icon}${s.name}`).join(' ') }}
                </div>
              </el-form-item>
              <el-form-item :label="$t('projects.voice')">
                <el-select v-model="autoForm.voice" style="width:100%">
                  <el-option :label="$t('projects.voiceXiaoxiao')" value="xiaoxiao" />
                  <el-option :label="$t('projects.voiceYunyang')" value="yunyang" />
                  <el-option :label="$t('projects.voiceYunxi')" value="yunxi" />
                  <el-option :label="$t('projects.voiceXiaomo')" value="xiaomo" />
                </el-select>
              </el-form-item>
              <el-form-item :label="$t('projects.motion')">
                <el-select v-model="autoForm.motion" style="width:100%">
                  <el-option v-for="m in motionOptionsI18n" :key="m.key" :label="m.label" :value="m.key" />
                </el-select>
                <div class="duration-hint">{{ $t('projects.motionHint') }}</div>
              </el-form-item>
              <el-form-item :label="$t('projects.videoGen')">
                <el-select v-model="autoForm.videoMode" style="width:100%">
                  <el-option :label="$t('projects.videoStatic')" value="static" />
                  <el-option v-for="v in videoModelOptions" :key="v.key" :label="v.label" :value="v.key" />
                </el-select>
                <div class="duration-hint">{{ $t('projects.videoModeHint') }}</div>
              </el-form-item>
              <el-form-item v-if="autoForm.videoMode && autoForm.videoMode !== 'static'" :label="$t('projects.i2vLabel')">
                <el-switch v-model="autoForm.i2v" :active-text="$t('projects.i2vOn')" :inactive-text="$t('projects.i2vOff')" />
                <div class="duration-hint">{{ $t('projects.i2vHint') }}</div>
              </el-form-item>
              <el-form-item :label="$t('projects.bgm')">
                <div style="display:flex;gap:8px;width:100%">
                  <el-select v-model="autoForm.bgm" clearable :placeholder="$t('projects.bgmPlaceholder')" style="flex:1">
                    <el-option v-for="b in bgmList" :key="b.key" :label="b.name || b.key" :value="b.key" />
                  </el-select>
                  <el-upload :show-file-list="false" :http-request="uploadBgm" accept="audio/*">
                    <el-button>{{ $t('common.upload') }}</el-button>
                  </el-upload>
                </div>
                <el-slider v-if="autoForm.bgm" v-model="autoForm.bgmVolume" :min="0" :max="1" :step="0.05"
                           :format-tooltip="formatVolume" style="margin-top:6px" />
              </el-form-item>
              <el-form-item :label="$t('projects.subtitleStyle')">
                <el-select v-model="autoForm.subtitlePreset" style="width:100%">
                  <el-option v-for="s in subtitlePresets" :key="s.key" :label="s.label" :value="s.key" />
                </el-select>
              </el-form-item>
              <el-form-item :label="$t('projects.generateMode')">
                <el-switch
                  v-model="autoForm.background"
                  :active-text="$t('projects.backgroundMode')"
                  :inactive-text="$t('projects.visibleMode')"
                />
                <div class="duration-hint">{{ autoForm.background ? $t('projects.backgroundHint') : $t('projects.visibleHint') }}</div>
              </el-form-item>
            </el-collapse-item>
          </el-collapse>
        </el-form>
        <p class="auto-hint">{{ $t('projects.autoHint') }}</p>
      </div>

      <!-- 进度态 -->
      <div v-else class="auto-progress">
        <el-progress
          :percentage="autoProgress"
          :status="autoDone ? 'success' : (autoFailed ? 'exception' : '')"
          :stroke-width="14"
        />
        <p class="auto-msg">{{ autoMessage }}</p>
        <el-button v-if="autoFailed && autoDiagnosis" plain @click="showDiagnosis(autoDiagnosis)">
          {{ $t('task.viewReason') }}
        </el-button>
        <div v-if="autoDone" class="auto-result">
          <video v-if="autoVideoUrl" :src="autoVideoUrl" controls class="auto-video" />
          <p class="auto-success-text">{{ $t('projects.autoSuccessText', { title: (autoResult?.title || ''), ok: (autoResult?.real_image_ok ?? autoResult?.image_ok ?? 0), total: autoResult?.storyboard_count }) }}</p>
        </div>
      </div>

      <template #footer>
        <template v-if="!autoRunning && !autoDone">
          <el-button @click="autoVisible = false">{{ $t('common.cancel') }}</el-button>
          <el-button type="success" @click="startAutoProduce">{{ $t('projects.startGen') }}</el-button>
        </template>
        <template v-else-if="autoDone">
          <el-button @click="autoVisible = false">{{ $t('common.close') }}</el-button>
          <el-button type="primary" @click="goToProjectResult">{{ $t('projects.viewProject') }}</el-button>
        </template>
        <template v-else-if="autoFailed">
          <el-button @click="autoVisible = false">{{ $t('common.close') }}</el-button>
          <el-button v-if="autoDiagnosis" plain @click="showDiagnosis(autoDiagnosis)">{{ $t('task.viewReason') }}</el-button>
          <el-button type="primary" @click="startAutoProduce">{{ $t('common.regenerate') }}</el-button>
        </template>
        <template v-else>
          <span class="auto-running-tip">{{ $t('projects.runningTip') }}</span>
        </template>
      </template>
    </el-dialog>

    <el-dialog v-model="seriesVisible" title="系列故事" width="720px" class="project-dialog">
      <div v-if="seriesLoading" class="series-loading">
        <el-skeleton :rows="4" animated />
      </div>
      <div v-else-if="seriesData" class="series-panel">
        <div class="series-hero">
          <div>
            <h3>{{ seriesData.series?.title || '未命名系列' }}</h3>
            <p>{{ seriesData.story_bible?.mainline || seriesData.story_bible?.worldview || '这个系列还没有主线摘要。' }}</p>
          </div>
          <el-button type="primary" plain @click="handleContinueProject(seriesCurrentProject)">继续下一集</el-button>
        </div>
        <div class="series-episodes">
          <div v-for="ep in seriesData.episodes" :key="ep.id" class="series-episode" @click="router.push(`/studio/${ep.id}`)">
            <div class="episode-index">{{ String(ep.episode_index || 1).padStart(3, '0') }}</div>
            <div class="episode-main">
              <strong>{{ ep.name }}</strong>
              <span>{{ ep.ending_summary || ep.theme || '暂无剧情摘要' }}</span>
            </div>
            <el-tag size="small" :type="ep.export_count ? 'success' : 'info'" effect="plain">
              {{ ep.export_count ? '已成片' : `${ep.storyboard_count || 0} 镜` }}
            </el-tag>
          </div>
        </div>
        <div class="series-characters">
          <h4>角色状态</h4>
          <el-tag v-for="c in seriesData.characters" :key="c.id" class="series-character" :type="c.locked ? 'success' : 'warning'" effect="plain">
            {{ c.name }} · {{ c.locked ? '已锁定' : '待确认' }} · {{ c.assets?.length || 0 }} 图
          </el-tag>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="continueVisible"
      :title="$t('projects.continueTitle', { name: continueProjectSource?.name || '' })"
      width="520px"
      class="project-dialog"
    >
      <div class="continue-dialog">
        <el-segmented v-model="continueForm.mode" :options="continueModeOptions" />
        <p class="duration-hint">{{ continueModeHint }}</p>
        <el-input
          v-model="continueForm.theme"
          type="textarea"
          :rows="4"
          :placeholder="$t('projects.continuePlaceholder')"
        />
      </div>
      <template #footer>
        <el-button @click="continueVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="continueSubmitting" @click="submitContinueProject">
          {{ $t('projects.continueCreate') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import type { ApiEnvelope } from '@aigc-video/contracts'
import { z } from 'zod'
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { Plus, Search, MagicStick } from '@element-plus/icons-vue'
import api, { unwrap } from '../api'
import ProjectCard from '../components/ProjectCard.vue'
import { trackTask } from '../api/tasks'
import { mediaUrl } from '../api/config'
import { getSettings } from '../api/settings'
import { listSkills, listActiveSkills, type CreativeSkill } from '../api/skills'
import { continueProject } from '../api/continuity'
import { completeProjectCheck, getProjectSeries, listProjects } from '../api/projects'
import {
  projectAssetHealthLabel,
  projectAssetHealthStatus,
  projectAssetHealthTitle,
  projectCoverGradient,
  projectCoverInitial,
  projectRelativeTime,
  projectStatusLabel,
  type EntityId,
  ProjectViewSchema,
  type ProjectView,
} from '../domain/projects'
import {
  DURATION_PRESET_OPTIONS,
  DEFAULT_DURATION_PRESET,
  DEFAULT_DURATION_RANGE,
  durationPayload,
  formatDuration,
  formatDurationRange,
  inferDurationPreset,
  normalizeDurationRange,
  rangeForPreset,
  sliderMaxForDuration,
  sliderStepForDuration,
  targetDurationSec,
  type DurationPresetValue,
  type DurationRange,
} from '../utils/durationPresets'

type JsonObject = Record<string, unknown>
type ContinueMode = 'continue-ending' | 'new-arc' | 'side-story'

interface ContinueForm {
  mode: ContinueMode
  theme: string
}

interface AutoProduceForm {
  theme: string
  style: string
  voice: string
  ratio: string
  motion: string
  bgm: string
  bgmVolume: number
  subtitlePreset: string
  scriptProvider: string
  scriptModel: string
  imageModel: string
  videoMode: string
  i2v: boolean
  scriptSkillIds: EntityId[]
  imageSkillIds: EntityId[]
  background: boolean
  consistencyMode: 'standard' | 'strict'
}

interface AutoProduceResult extends JsonObject {
  project_id?: EntityId
  title?: string
  file_url?: string
  real_image_ok?: number
  image_ok?: number
  storyboard_count?: number
  diagnosis?: Diagnosis
}

interface Diagnosis extends JsonObject {
  title?: string
  reason?: string
  rawError?: string
  advice?: string[]
  partialResult?: {
    storyboard_count?: number
    image_count?: number
    selected_image_count?: number
    audio_count?: number
  }
  assetHealth?: { issues?: Array<{ message: string }> }
}

interface SelectControl {
  blur?(): void
}

const KeyLabelSchema = z.object({
  key: z.string(),
  label: z.string().default(''),
  name: z.string().optional(),
}).passthrough()
type KeyLabelOption = z.infer<typeof KeyLabelSchema>

const ProviderOptionSchema = KeyLabelSchema.extend({
  configured: z.boolean().default(false),
  models: z.array(z.string()).default([]),
  free: z.boolean().optional(),
})
type ProviderOption = z.infer<typeof ProviderOptionSchema>

const ImageModelOptionSchema = KeyLabelSchema.extend({
  cloud: z.boolean().optional(),
  configured: z.boolean().optional(),
})

const SubtitlePresetSchema = KeyLabelSchema.extend({
  style: z.record(z.string(), z.unknown()).optional(),
})

const ProviderGroupsSchema = z.object({
  llm: z.array(ProviderOptionSchema).default([]),
  t2v: z.array(ProviderOptionSchema).default([]),
})

const SeriesDataSchema = z.object({
  series: z.object({ title: z.string().optional() }).passthrough().nullish(),
  story_bible: z.object({
    mainline: z.string().optional(),
    worldview: z.string().optional(),
  }).passthrough().nullish(),
  episodes: z.array(z.object({
    id: z.number(),
    name: z.string(),
    episode_index: z.number().nullish(),
    ending_summary: z.string().nullish(),
    theme: z.string().nullish(),
    export_count: z.number().optional(),
    storyboard_count: z.number().optional(),
  }).passthrough()).default([]),
  characters: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    locked: z.boolean().optional(),
    assets: z.array(z.unknown()).default([]),
  }).passthrough()).default([]),
})
type SeriesData = z.infer<typeof SeriesDataSchema>

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function stringField(record: JsonObject, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] : undefined
}

function autoResultFrom(value: unknown): AutoProduceResult {
  return isJsonObject(value) ? value : {}
}

function diagnosisFrom(value: unknown): Diagnosis | null {
  return isJsonObject(value) ? value : null
}

function normalizeSkill(skill: CreativeSkill): CreativeSkill & { id: EntityId; name: string; icon: string; auto_apply: boolean } | null {
  if ((typeof skill.id !== 'string' && typeof skill.id !== 'number') || typeof skill.name !== 'string') return null
  return {
    ...skill,
    id: skill.id,
    name: skill.name,
    icon: typeof skill.icon === 'string' ? skill.icon : '',
    auto_apply: skill.auto_apply === true,
  }
}

function normalizeSkills(skills: CreativeSkill[]): NormalizedSkill[] {
  return skills.map(normalizeSkill).filter((skill): skill is NormalizedSkill => skill !== null)
}

const { t } = useI18n()
const router = useRouter()
const projects = ref<ProjectView[]>([])
const loading = ref(false)
const searchKeyword = ref('')
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const editingId = ref<EntityId | null>(null)
const coverGenerating = ref<Record<EntityId, boolean>>({})
const seriesVisible = ref(false)
const seriesLoading = ref(false)
const seriesData = ref<SeriesData | null>(null)
const seriesCurrentProject = ref<ProjectView | null>(null)
const continueVisible = ref(false)
const continueSubmitting = ref(false)
const continueProjectSource = ref<ProjectView | null>(null)
const continueForm = ref<ContinueForm>({ mode: 'continue-ending', theme: '' })
const continueModeOptions = computed(() => [
  { label: t('projects.continueModeEnding'), value: 'continue-ending' },
  { label: t('projects.continueModeNewArc'), value: 'new-arc' },
  { label: t('projects.continueModeSideStory'), value: 'side-story' },
])
const continueModeHint = computed(() => ({
  'continue-ending': t('projects.continueModeEndingHint'),
  'new-arc': t('projects.continueModeNewArcHint'),
  'side-story': t('projects.continueModeSideStoryHint'),
}[continueForm.value.mode] || t('projects.continueModeEndingHint')))

const form = ref({
  name: '',
  theme: '',
  style: '',
})
const durationPresetOptions = DURATION_PRESET_OPTIONS
const durationPreset = ref<DurationPresetValue>(DEFAULT_DURATION_PRESET)
const durationRange = ref<DurationRange>([DEFAULT_DURATION_RANGE[0], DEFAULT_DURATION_RANGE[1]])
const projectDurationSliderMax = computed(() => sliderMaxForDuration(durationRange.value, durationPreset.value))
const projectDurationSliderStep = computed(() => sliderStepForDuration(durationRange.value, durationPreset.value))

const translate = (key: string, values?: Record<string, unknown>): string => String(t(key, values ?? {}))
const statusLabel = (status: string | null | undefined): string => projectStatusLabel(status, translate)
const assetHealthStatus = (project: ProjectView) => projectAssetHealthStatus(project)
const assetHealthLabel = (project: ProjectView): string => projectAssetHealthLabel(project, translate)
const assetHealthTitle = (project: ProjectView): string => projectAssetHealthTitle(project, translate)
const formatRelativeTime = (project: ProjectView): string => projectRelativeTime(project, translate)
const coverGradient = projectCoverGradient
const coverInitial = projectCoverInitial

// API calls
let searchTimer: ReturnType<typeof setTimeout> | null = null
async function fetchProjects() {
  loading.value = true
  try {
    projects.value = await listProjects({ keyword: searchKeyword.value })
  } catch {
    ElMessage.error(t('projects.fetchFailed'))
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void fetchProjects(), 300)
}

// 方案 B：调后端用 Pollinations 按名称/主题生成 AI 封面
async function generateCover(project: ProjectView) {
  if (coverGenerating.value[project.id]) return
  coverGenerating.value = { ...coverGenerating.value, [project.id]: true }
  try {
    const response = await api.post<ApiEnvelope<Partial<ProjectView>>>(`/projects/${project.id}/cover`)
    const data = unwrap(response)
    if (response.data.code === 200 && data.cover_url) {
      // 局部更新该卡片，避免整列表刷新闪烁
      const idx = projects.value.findIndex(p => p.id === project.id)
      const current = projects.value[idx]
      if (current) projects.value[idx] = { ...current, ...data }
      ElMessage.success(t('projects.coverSuccess'))
    } else {
      ElMessage.error(response.data.message || t('projects.coverFailed'))
    }
  } catch (cause) {
    ElMessage.error(errorMessage(cause, t('projects.coverFailedRetry')))
  } finally {
    const next = { ...coverGenerating.value }
    delete next[project.id]
    coverGenerating.value = next
  }
}

// 封面真图加载失败时回退到渐变色卡（清空 cover_url 触发 v-else）
function onCoverError(project: ProjectView) {
  const idx = projects.value.findIndex(p => p.id === project.id)
  const current = projects.value[idx]
  if (current) projects.value[idx] = { ...current, cover_url: null }
}

function goToScript(id: EntityId) {
  router.push(`/studio/${id}`)
}

function applyProjectDurationPreset(value: DurationPresetValue) {
  if (value === 'custom') return
  durationRange.value = rangeForPreset(value, durationRange.value)
}

function markProjectDurationCustom() {
  durationPreset.value = 'custom'
}

function resetForm() {
  form.value = { name: '', theme: '', style: '' }
  durationPreset.value = DEFAULT_DURATION_PRESET
  durationRange.value = [DEFAULT_DURATION_RANGE[0], DEFAULT_DURATION_RANGE[1]]
}

function openCreateDialog() {
  isEdit.value = false
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function openEditDialog(project: ProjectView) {
  isEdit.value = true
  editingId.value = project.id
  form.value = {
    name: project.name,
    theme: project.theme || '',
    style: project.style || '',
  }
  durationRange.value = normalizeDurationRange([project.duration_min, project.duration_max], DEFAULT_DURATION_RANGE)
  durationPreset.value = inferDurationPreset(durationRange.value)
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!form.value.name.trim()) {
    ElMessage.warning(t('projects.nameRequired'))
    return
  }
  submitting.value = true
  try {
    const payload = {
      ...form.value,
      duration_min: durationRange.value[0],
      duration_max: durationRange.value[1]
    }
    let res
    if (isEdit.value) {
      // 编辑时保留原 status / script_content（PUT 是全字段更新）
      const original = projects.value.find(p => p.id === editingId.value)
      res = await api.put(`/projects/${editingId.value}`, {
        ...payload,
        status: original?.status || 'draft',
        script_content: original?.script_content || ''
      })
    } else {
      res = await api.post('/projects', payload)
    }
    if (res.data.code === 200) {
      ElMessage.success(isEdit.value ? t('common.saveSuccess') : t('projects.createSuccess'))
      dialogVisible.value = false
      fetchProjects()
    } else {
      ElMessage.error(res.data.message || t('common.operationFailed'))
    }
  } catch (e) {
    ElMessage.error(t('common.operationFailed'))
  } finally {
    submitting.value = false
  }
}

function confirmDelete(project: ProjectView) {
  ElMessageBox.confirm(t('projects.deleteConfirm', { name: project.name }), t('projects.deleteConfirmTitle'), {
    confirmButtonText: t('projects.moveToTrash'),
    cancelButtonText: t('common.cancel'),
    type: 'warning'
  }).then(async () => {
    try {
      const res = await api.delete(`/projects/${project.id}`)
      if (res.data.code === 200) {
        ElMessage.success(res.data.message || t('projects.movedToTrash'))
        fetchProjects()
      } else {
        ElMessage.error(res.data.message || t('projects.deleteFailed'))
      }
    } catch (e) {
      ElMessage.error(t('projects.deleteFailed'))
    }
  }).catch(() => {})
}

// ============ 一键成片 ============
const autoVisible = ref(false)
const autoRunning = ref(false)
const autoDone = ref(false)
const autoFailed = ref(false)
const autoProgress = ref(0)
const autoMessage = ref('')
const DEFAULT_AUTO_FORM: AutoProduceForm = {
  theme: '',
  style: 'realistic',
  voice: 'xiaoxiao',
  ratio: '16:9',
  motion: 'none',
  bgm: '',
  bgmVolume: 0.25,
  subtitlePreset: 'default',
  scriptProvider: 'deepseek',
  scriptModel: '',
  imageModel: 'auto',
  videoMode: 'static',
  i2v: true,
  scriptSkillIds: [],
  imageSkillIds: [],
  background: true,
  consistencyMode: 'standard',
}
const autoForm = ref<AutoProduceForm>({ ...DEFAULT_AUTO_FORM })
const autoDurationPreset = ref<DurationPresetValue>(DEFAULT_DURATION_PRESET)
const autoDuration = ref<DurationRange>([DEFAULT_DURATION_RANGE[0], DEFAULT_DURATION_RANGE[1]])
const autoDurationSliderMax = computed(() => sliderMaxForDuration(autoDuration.value, autoDurationPreset.value))
const autoDurationSliderStep = computed(() => sliderStepForDuration(autoDuration.value, autoDurationPreset.value))
const autoResult = ref<AutoProduceResult | null>(null)
const autoDiagnosis = ref<Diagnosis | null>(null)
const autoVideoUrl = ref('')
const ratioOptions = ref<KeyLabelOption[]>([])
const motionOptions = ref<KeyLabelOption[]>([])
const bgmList = ref<KeyLabelOption[]>([])
const subtitlePresets = ref<z.infer<typeof SubtitlePresetSchema>[]>([])
const llmProviders = ref<ProviderOption[]>([])
const imageModelOptions = ref<KeyLabelOption[]>([])
const videoModelOptions = ref<KeyLabelOption[]>([])
const consistencyOptions = computed(() => [
  { label: t('projects.consistencyStandard'), value: 'standard' },
  { label: t('projects.consistencyStrict'), value: 'strict' },
])
// 一键成片技能选择（手动可选 + 必用自动生效，与 Script/Images 页一致）
type NormalizedSkill = CreativeSkill & { id: EntityId; name: string; icon: string; auto_apply: boolean }
const scriptSkillOptions = ref<NormalizedSkill[]>([])
const imageSkillOptions = ref<NormalizedSkill[]>([])
const autoScriptSkills = ref<NormalizedSkill[]>([])
const autoImageSkills = ref<NormalizedSkill[]>([])
const scriptSkillSelectRef = ref<SelectControl | null>(null)
const imageSkillSelectRef = ref<SelectControl | null>(null)
let autoStop: (() => void) | null = null

function closeSelectAfterChange(selectRef: { value: SelectControl | null }) {
  nextTick(() => selectRef.value?.blur?.())
}

function closeScriptSkillSelect() {
  closeSelectAfterChange(scriptSkillSelectRef)
}

function closeImageSkillSelect() {
  closeSelectAfterChange(imageSkillSelectRef)
}

function applyAutoDurationPreset(value: DurationPresetValue) {
  if (value === 'custom') return
  autoDuration.value = rangeForPreset(value, autoDuration.value)
}

function markAutoDurationCustom() {
  autoDurationPreset.value = 'custom'
}

// 比例/运镜下拉的多语言标签：后端按 key 返回，前端按 key 映射 i18n（缺失则回退后端 label）
const RATIO_KEY: Record<string, string> = { '16:9': 'ratio169', '9:16': 'ratio916', '1:1': 'ratio11', '4:5': 'ratio45', '4:3': 'ratio43' }
const MOTION_KEY: Record<string, string> = { none: 'motionNone', 'zoom-in': 'motionZoomIn', 'zoom-out': 'motionZoomOut', 'pan-right': 'motionPanRight', 'pan-left': 'motionPanLeft' }
const ratioOptionsI18n = computed(() => ratioOptions.value.map((r) => ({
  key: r.key, label: RATIO_KEY[r.key] ? t(`projects.${RATIO_KEY[r.key]}`) : r.label,
})))
const motionOptionsI18n = computed(() => motionOptions.value.map((m) => ({
  key: m.key, label: MOTION_KEY[m.key] ? t(`projects.${MOTION_KEY[m.key]}`) : m.label,
})))

function formatVolume(value: number): string {
  return t('projects.volumeTip', { v: Math.round(value * 100) })
}

async function loadComposeOptions() {
  try {
    const [r, b, s, mo, pv, im] = await Promise.all([
      api.get<ApiEnvelope<unknown>>('/media/ratios'),
      api.get<ApiEnvelope<unknown>>('/media/bgm'),
      api.get<ApiEnvelope<unknown>>('/media/subtitle-presets'),
      api.get<ApiEnvelope<unknown>>('/media/motions'),
      api.get<ApiEnvelope<unknown>>('/providers'),
      api.get<ApiEnvelope<unknown>>('/ai/image-models'),
    ])
    ratioOptions.value = KeyLabelSchema.array().parse(unwrap(r))
    bgmList.value = KeyLabelSchema.array().parse(unwrap(b))
    subtitlePresets.value = SubtitlePresetSchema.array().parse(unwrap(s))
    motionOptions.value = KeyLabelSchema.array().parse(unwrap(mo))
    const providerGroups = ProviderGroupsSchema.parse(unwrap(pv))
    llmProviders.value = providerGroups.llm
    // 配图模型：本地全部 + 云端已配置（未配置的过滤掉，避免选了报错）
    imageModelOptions.value = ImageModelOptionSchema.array().parse(unwrap(im))
      .filter((model) => model.cloud !== true || model.configured)
      .map((model) => ({ key: model.key, label: model.label, name: model.name }))
    // 视频生成方式：已配置的 t2v provider 展开为 provider__model（未配置的过滤掉）
    videoModelOptions.value = providerGroups.t2v
      .filter((provider) => provider.configured)
      .flatMap((provider) => provider.models.map((model) => ({
        key: `${provider.key}__${model}`,
        label: `${t('projects.aiVideoLabel')} · ${provider.label} · ${model}${provider.free ? t('projects.freeTier') : t('projects.paidTier')}`,
      })))
    // 默认选中已配置的 provider（优先当前 stageModels.script，否则第一个已配置项）
    const configured = llmProviders.value.filter(p => p.configured)
    if (configured.length && !configured.find(p => p.key === autoForm.value.scriptProvider)) {
      autoForm.value.scriptProvider = configured[0]?.key ?? autoForm.value.scriptProvider
    }
    onScriptProviderChange()
  } catch (e) { /* 选项加载失败不阻断，用默认 */ }
}

// 加载一键成片的技能选项：可选技能（手动勾选）+ 必用技能（自动生效，仅展示）
function loadAutoSkills() {
  listSkills('script', true).then((list) => { scriptSkillOptions.value = normalizeSkills(list).filter((skill) => !skill.auto_apply) }).catch(() => {})
  listSkills('image', true).then((list) => { imageSkillOptions.value = normalizeSkills(list).filter((skill) => !skill.auto_apply) }).catch(() => {})
  listActiveSkills('script').then((list) => { autoScriptSkills.value = normalizeSkills(list) }).catch(() => {})
  listActiveSkills('image').then((list) => { autoImageSkills.value = normalizeSkills(list) }).catch(() => {})
}

function onScriptProviderChange() {
  const p = llmProviders.value.find(x => x.key === autoForm.value.scriptProvider)
  const models = p ? p.models : []
  if (models.length && !models.includes(autoForm.value.scriptModel)) {
    autoForm.value.scriptModel = models[0] ?? ''
  }
}

async function uploadBgm(opt: { file: File }) {
  const fd = new FormData()
  fd.append('file', opt.file)
  try {
    const res = await api.post<ApiEnvelope<{ key: string }>>('/media/bgm', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    if (res.data.code === 200) {
      ElMessage.success(t('projects.bgmUploaded'))
      await loadComposeOptions()
      autoForm.value.bgm = res.data.data.key
    } else {
      ElMessage.error(res.data.message || t('projects.uploadFailed'))
    }
  } catch (cause) {
    ElMessage.error(t('projects.uploadFailedDetail', { msg: errorMessage(cause, t('projects.uploadFailed')) }))
  }
}

// 常规设置默认值 → 一键成片表单的值域映射。
// 兼容旧 settings.json 里存的中文 style 值，统一为对话框 el-select 的英文 key。
const STYLE_VALUE_MAP: Record<string, string> = { '写实': 'realistic', '动漫': 'animation', '动画': 'animation' }
function normalizeStyleValue(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'realistic'
  return STYLE_VALUE_MAP[value] || value
}
async function openAutoDialog() {
  autoRunning.value = false
  autoDone.value = false
  autoFailed.value = false
  autoProgress.value = 0
  autoMessage.value = ''
  autoResult.value = null
  autoDiagnosis.value = null
  autoVideoUrl.value = ''
  // 默认值（用户未在常规设置里配置时的兜底）
  autoForm.value = { ...DEFAULT_AUTO_FORM, scriptSkillIds: [], imageSkillIds: [] }
  autoDurationPreset.value = DEFAULT_DURATION_PRESET
  autoDuration.value = [DEFAULT_DURATION_RANGE[0], DEFAULT_DURATION_RANGE[1]]
  autoVisible.value = true
  loadComposeOptions()
  loadAutoSkills()
  // 读取常规设置作为新建项目的默认值（让"常规设置"真正生效）。失败不阻塞，用兜底默认值。
  try {
    const cfg = await getSettings()
    if (cfg) {
      const defaultVoice = stringField(cfg, 'defaultVoice')
      const defaultImageModel = stringField(cfg, 'defaultImageModel')
      const defaultDuration = stringField(cfg, 'defaultDuration')
      autoForm.value.style = normalizeStyleValue(cfg.defaultStyle)
      if (defaultVoice) autoForm.value.voice = defaultVoice
      if (defaultImageModel) autoForm.value.imageModel = defaultImageModel
      if (defaultDuration && defaultDuration !== '60-180') {
        autoDuration.value = normalizeDurationRange(defaultDuration, autoDuration.value)
        autoDurationPreset.value = inferDurationPreset(autoDuration.value)
      }
    }
  } catch { /* 设置读取失败用兜底默认值，不打断新建流程 */ }
}

async function startAutoProduce() {
  if (autoRunning.value) return // 防双击：已在运行则忽略后续点击
  if (!autoForm.value.theme.trim()) {
    ElMessage.warning(t('projects.themeRequired'))
    return
  }
  autoRunning.value = true
  autoFailed.value = false
  autoDiagnosis.value = null
  autoProgress.value = 0
  autoMessage.value = t('projects.starting')
  try {
    const preset = subtitlePresets.value.find(s => s.key === autoForm.value.subtitlePreset)
    const res = await api.post<ApiEnvelope<{ task_id: string }>>('/ai/auto-produce', {
      theme: autoForm.value.theme.trim(),
      style: autoForm.value.style,
      voice: autoForm.value.voice,
      duration: durationPayload(autoDuration.value),
      durationPreset: autoDurationPreset.value,
      durationMode: 'tolerance',
      targetDurationSec: targetDurationSec(autoDuration.value),
      ratio: autoForm.value.ratio,
      motion: autoForm.value.motion || undefined,
      bgm: autoForm.value.bgm || undefined,
      bgmVolume: autoForm.value.bgmVolume,
      subtitleStyle: preset ? preset.style : undefined,
      scriptProvider: autoForm.value.scriptProvider || undefined,
      scriptModel: autoForm.value.scriptModel || undefined,
      model: autoForm.value.imageModel || 'auto',
      videoProvider: (autoForm.value.videoMode && autoForm.value.videoMode !== 'static') ? autoForm.value.videoMode : undefined,
      i2v: autoForm.value.i2v,
      scriptSkillIds: autoForm.value.scriptSkillIds?.length ? autoForm.value.scriptSkillIds : undefined,
      imageSkillIds: autoForm.value.imageSkillIds?.length ? autoForm.value.imageSkillIds : undefined,
      background: autoForm.value.background,
      showProcess: !autoForm.value.background,
      workflow_mode: autoForm.value.background ? 'background' : 'guided',
      notifyOnComplete: true,
      consistencyMode: autoForm.value.consistencyMode || 'standard',
    })
    if (res.data.code !== 200) {
      throw new Error(res.data.message || t('projects.startFailed'))
    }
    const taskId = res.data.data.task_id
    if (autoForm.value.background) {
      autoRunning.value = false
      autoVisible.value = false
      ElMessage.success(res.data.message || t('projects.backgroundSubmitted'))
      fetchProjects()
      return
    }
    autoStop = trackTask(taskId, {
      onProgress: (task) => {
        autoProgress.value = task.progress || 0
        autoMessage.value = task.message || t('projects.processing')
      },
      onSuccess: (task) => {
        autoRunning.value = false
        autoDone.value = true
        autoProgress.value = 100
        autoMessage.value = t('projects.completed')
        const result = autoResultFrom(task.result)
        autoResult.value = result
        autoVideoUrl.value = mediaUrl(result.file_url)
        fetchProjects()
      },
      onError: (err) => {
        autoRunning.value = false
        autoFailed.value = true
        const taskResult = autoResultFrom(err.task?.result)
        const diagnosis = diagnosisFrom(err.diagnosis) || diagnosisFrom(taskResult.diagnosis)
        autoDiagnosis.value = diagnosis
        autoMessage.value = diagnosis?.reason || err.message || t('projects.genFailed')
        ElMessage.error(t('projects.autoFailed', { msg: (diagnosis?.reason || err.message || t('projects.unknownError')) }))
        fetchProjects()
      },
    })
  } catch (cause) {
    autoRunning.value = false
    autoFailed.value = true
    autoDiagnosis.value = null
    autoMessage.value = errorMessage(cause, t('projects.startFailed'))
    ElMessage.error(autoMessage.value)
  }
}

async function handleContinueProject(project: ProjectView | null) {
  if (!project) return
  continueProjectSource.value = project
  continueForm.value = { mode: 'continue-ending', theme: '' }
  continueVisible.value = true
}

async function submitContinueProject() {
  const project = continueProjectSource.value
  if (!project) return
  continueSubmitting.value = true
  try {
    const next = await continueProject(project.id, {
      continuation_mode: continueForm.value.mode,
      theme: continueForm.value.theme || '',
    })
    ElMessage.success(t('projects.continueCreated'))
    continueVisible.value = false
    await fetchProjects()
    const nextId = next.id
    if (typeof nextId === 'string' || typeof nextId === 'number') router.push(`/studio/${nextId}`)
  } catch (cause) {
    ElMessage.error(errorMessage(cause, t('projects.continueFailed')))
  } finally {
    continueSubmitting.value = false
  }
}

async function refreshProjectCompletion(project: ProjectView) {
  if (!project) return
  try {
    const data = await completeProjectCheck(project.id)
    const idx = projects.value.findIndex((p) => Number(p.id) === Number(project.id))
    const parsedProject = ProjectViewSchema.safeParse(data.project)
    if (idx !== -1 && parsedProject.success) projects.value[idx] = parsedProject.data
    const statusLabelValue = stringField(data, 'status_label')
    ElMessage.success(statusLabelValue ? t('projects.completeCheckDone', { status: statusLabelValue }) : t('projects.completeCheckSaved'))
  } catch (cause) {
    ElMessage.error(errorMessage(cause, t('projects.completeCheckFailed')))
  }
}

async function openSeriesDialog(project: ProjectView) {
  seriesCurrentProject.value = project
  seriesVisible.value = true
  seriesLoading.value = true
  seriesData.value = null
  try {
    seriesData.value = SeriesDataSchema.parse(await getProjectSeries(project.id))
  } catch (cause) {
    ElMessage.error(errorMessage(cause, '读取系列失败'))
  } finally {
    seriesLoading.value = false
  }
}

function showDiagnosis(d: Diagnosis | null) {
  if (!d) return
  const partial = d.partialResult
  const partialText = partial
    ? `<p><strong>${t('task.partialResult')}</strong>${t('task.partialStats', {
        sb: partial.storyboard_count || 0,
        img: partial.image_count || 0,
        sel: partial.selected_image_count || 0,
        aud: partial.audio_count || 0,
      })}</p>`
    : ''
  const assetIssues = Array.isArray(d.assetHealth?.issues) && d.assetHealth.issues.length
    ? `<p><strong>${t('projects.assetIssues')}</strong></p><ul>${d.assetHealth.issues.map((x) => `<li>${escapeHtml(x.message)}</li>`).join('')}</ul>`
    : ''
  const advice = Array.isArray(d.advice) && d.advice.length
    ? `<ol>${d.advice.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`
    : `<p>${escapeHtml(d.reason || t('task.unknownError'))}</p>`
  const raw = d.rawError ? `<details><summary>${t('task.rawError')}</summary><pre>${escapeHtml(d.rawError)}</pre></details>` : ''
  ElMessageBox.alert(
    `<p><strong>${escapeHtml(d.reason || '')}</strong></p>${partialText}${assetIssues}<p>${t('task.advice')}</p>${advice}${raw}`,
    d.title || t('task.failureDiagnosis'),
    { dangerouslyUseHTMLString: true, confirmButtonText: t('common.close') }
  )
}

function escapeHtml(s: unknown): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function goToProjectResult() {
  const pid = autoResult.value?.project_id
  autoVisible.value = false
  if (pid) router.push(`/projects/${pid}/preview`)
}

onUnmounted(() => { if (autoStop) autoStop() })

onMounted(() => fetchProjects())
</script>

<style scoped src="../styles/projects.css"></style>
