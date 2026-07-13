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
      <div
        v-for="project in projects"
        :key="project.id"
        class="project-card"
        @click="goToScript(project.id)"
      >
        <div class="card-thumb" :class="'thumb-' + project.status" :style="!project.cover_url ? coverGradient(project.name) : null">
          <img
            v-if="project.cover_url"
            :src="mediaUrl(project.cover_url)"
            class="cover-img"
            loading="lazy"
            :alt="$t('projects.cover')"
            @error="onCoverError(project)"
          />
          <span v-else class="cover-initial">{{ coverInitial(project.name) }}</span>
          <button
            class="cover-gen-btn"
            :class="{ 'is-loading': coverGenerating[project.id] }"
            :title="$t('projects.genCoverTip')"
            @click.stop="generateCover(project)"
          >
            <el-icon v-if="coverGenerating[project.id]" class="spin"><Loading /></el-icon>
            <el-icon v-else><MagicStick /></el-icon>
            {{ coverGenerating[project.id] ? $t('projects.coverGenerating') : (project.cover_url ? $t('projects.changeCover') : $t('projects.genCover')) }}
          </button>
        </div>
        <div class="card-header">
          <span class="project-name">{{ project.name }}</span>
          <span class="status-badge" :class="'badge-' + project.status">
            <span class="badge-dot"></span>{{ statusLabel(project.status) }}
          </span>
        </div>
        <div class="card-body">
          <p class="project-theme">{{ $t('projects.theme') }}: {{ project.theme || $t('projects.notSet') }}</p>
          <p class="project-style">{{ $t('projects.style') }}: {{ project.style || $t('projects.notSet') }}</p>
          <p class="project-duration">{{ $t('projects.duration') }}: {{ formatDurationRange([project.duration_min, project.duration_max]) }}</p>
          <div v-if="project.series_id" class="continuity-chip">
            <span class="asset-dot"></span>
            <span>{{ $t('projects.seriesEpisode', { n: project.episode_index || 1 }) }}</span>
          </div>
          <div
            v-if="project.asset_health"
            class="asset-health"
            :class="'asset-' + assetHealthStatus(project)"
            :title="assetHealthTitle(project)"
          >
            <span class="asset-dot"></span>
            <span>{{ assetHealthLabel(project) }}</span>
          </div>
        </div>
        <div class="card-footer">
          <span class="time-info">{{ formatRelativeTime(project) }}</span>
          <div class="card-actions" @click.stop>
            <el-button size="small" text @click="openEditDialog(project)">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-button size="small" text type="success" @click="refreshProjectCompletion(project)">
              {{ $t('projects.completeCheck') }}
            </el-button>
            <el-button size="small" text type="primary" @click="handleContinueProject(project)">
              {{ $t('projects.continueStory') }}
            </el-button>
            <el-button size="small" text @click="openSeriesDialog(project)">
              系列
            </el-button>
            <el-button size="small" text type="danger" @click="confirmDelete(project)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </div>
      </div>

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
                           :format-tooltip="v => $t('projects.volumeTip', { v: Math.round(v*100) })" style="margin-top:6px" />
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
          <div v-for="ep in seriesData.episodes" :key="ep.id" class="series-episode" @click="router.push(`/projects/${ep.id}/script`)">
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

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, Search, MagicStick, Loading } from '@element-plus/icons-vue'
import api from '../api'
import { trackTask } from '../api/tasks'
import { mediaUrl } from '../api/config'
import { getSettings } from '../api/settings'
import { listSkills, listActiveSkills } from '../api/skills'
import { continueProject } from '../api/continuity'
import { completeProjectCheck, getProjectSeries } from '../api/projects'
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
} from '../utils/durationPresets'

const { t } = useI18n()
const router = useRouter()
const projects = ref([])
const loading = ref(false)
const searchKeyword = ref('')
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const editingId = ref(null)
const coverGenerating = ref({})  // { [projectId]: true } 封面生成中状态
const seriesVisible = ref(false)
const seriesLoading = ref(false)
const seriesData = ref(null)
const seriesCurrentProject = ref(null)
const continueVisible = ref(false)
const continueSubmitting = ref(false)
const continueProjectSource = ref(null)
const continueForm = ref({ mode: 'continue-ending', theme: '' })
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
const durationPreset = ref(DEFAULT_DURATION_PRESET)
const durationRange = ref([...DEFAULT_DURATION_RANGE])
const projectDurationSliderMax = computed(() => sliderMaxForDuration(durationRange.value, durationPreset.value))
const projectDurationSliderStep = computed(() => sliderStepForDuration(durationRange.value, durationPreset.value))

// Status helpers
function statusType(status) {
  const map = { draft: 'info', generating: 'warning', partial: 'warning', ready: 'success', failed: 'danger', completed: 'success' }
  return map[status] || 'info'
}

function statusLabel(status) {
  const map = {
    draft: t('projects.statusDraft'),
    generating: t('projects.statusGenerating'),
    partial: t('projects.statusPartial'),
    ready: t('projects.statusReady'),
    failed: t('projects.statusFailed'),
    completed: t('projects.statusCompleted'),
  }
  return map[status] || t('projects.statusDraft')
}

function assetHealthStatus(project) {
  const status = project?.asset_health?.status
  return ['ok', 'warn', 'error'].includes(status) ? status : 'unknown'
}

function assetHealthLabel(project) {
  const health = project?.asset_health
  if (!health) return t('projects.assetUnknown')
  if (health.status === 'ok') return t('projects.assetOk')
  if (health.status === 'warn') return health.summary || t('projects.assetWarn')
  if (health.status === 'error') {
    const issue = (health.issues || []).find(i => i.level === 'error')
    if (issue?.code === 'MISSING_IMAGES') return t('projects.assetMissingImages')
    if (issue?.code === 'FFMPEG_UNAVAILABLE') return t('projects.assetFfmpegMissing')
    return health.summary || t('projects.assetError')
  }
  return t('projects.assetUnknown')
}

function assetHealthTitle(project) {
  const issues = project?.asset_health?.issues || []
  if (!issues.length) return assetHealthLabel(project)
  return issues.map(i => i.message).join('\n')
}

// Relative time formatting
function parseDbTimeMs(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value
  if (/^\d+$/.test(String(value))) return Number(value)
  const raw = String(value).trim()
  const sqlite = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if (sqlite) {
    const [, y, mo, d, h, mi, s] = sqlite
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

function projectTimeMs(project) {
  return Number(project?.updated_at_ms || 0) || parseDbTimeMs(project?.updated_at) || parseDbTimeMs(project?.created_at)
}

function formatRelativeTime(project) {
  const timeMs = projectTimeMs(project)
  if (!timeMs) return ''
  const now = Date.now()
  const diff = Math.max(0, now - timeMs)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return t('projects.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('projects.minutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('projects.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('projects.daysAgo', { n: days })
  const months = Math.floor(days / 30)
  return t('projects.monthsAgo', { n: months })
}

// ===== 封面（方案 A 渐变色卡 + 方案 B AI 生成）=====
// 方案 A：根据项目名稳定哈希出一组品牌渐变色，名字相同则色卡相同，永不失败、零成本
function hashString(str) {
  let h = 0
  const s = String(str || '未命名')
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0 }
  return Math.abs(h)
}
function coverGradient(name) {
  const h = hashString(name)
  const hue1 = h % 360
  const hue2 = (hue1 + 40 + (h % 60)) % 360
  return { background: `linear-gradient(135deg, hsl(${hue1} 70% 58%), hsl(${hue2} 72% 46%))` }
}
function coverInitial(name) {
  const s = String(name || '').trim()
  return s ? s.slice(0, 1).toUpperCase() : '?'
}

// API calls
let searchTimer = null
async function fetchProjects() {
  loading.value = true
  try {
    const res = await api.get('/projects', { params: { keyword: searchKeyword.value } })
    if (res.data?.code === 200) {
      projects.value = res.data.data || []
    } else if (Array.isArray(res.data)) {
      projects.value = res.data
    } else if (Array.isArray(res.data?.data)) {
      projects.value = res.data.data
    }
  } catch (e) {
    ElMessage.error(t('projects.fetchFailed'))
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => fetchProjects(), 300)
}

// 方案 B：调后端用 Pollinations 按名称/主题生成 AI 封面
async function generateCover(project) {
  if (coverGenerating.value[project.id]) return
  coverGenerating.value = { ...coverGenerating.value, [project.id]: true }
  try {
    const res = await api.post(`/projects/${project.id}/cover`)
    const data = res.data?.data
    if (res.data?.code === 200 && data?.cover_url) {
      // 局部更新该卡片，避免整列表刷新闪烁
      const idx = projects.value.findIndex(p => p.id === project.id)
      if (idx !== -1) projects.value[idx] = { ...projects.value[idx], ...data }
      ElMessage.success(t('projects.coverSuccess'))
    } else {
      ElMessage.error(res.data?.message || t('projects.coverFailed'))
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('projects.coverFailedRetry'))
  } finally {
    const next = { ...coverGenerating.value }
    delete next[project.id]
    coverGenerating.value = next
  }
}

// 封面真图加载失败时回退到渐变色卡（清空 cover_url 触发 v-else）
function onCoverError(project) {
  const idx = projects.value.findIndex(p => p.id === project.id)
  if (idx !== -1) projects.value[idx] = { ...projects.value[idx], cover_url: null }
}

function goToScript(id) {
  router.push(`/projects/${id}/script`)
}

function applyProjectDurationPreset(value) {
  if (value === 'custom') return
  durationRange.value = rangeForPreset(value, durationRange.value)
}

function markProjectDurationCustom() {
  durationPreset.value = 'custom'
}

function resetForm() {
  form.value = { name: '', theme: '', style: '' }
  durationPreset.value = DEFAULT_DURATION_PRESET
  durationRange.value = [...DEFAULT_DURATION_RANGE]
}

function openCreateDialog() {
  isEdit.value = false
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function openEditDialog(project) {
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
      const original = projects.value.find(p => p.id === editingId.value) || {}
      res = await api.put(`/projects/${editingId.value}`, {
        ...payload,
        status: original.status || 'draft',
        script_content: original.script_content || ''
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

function confirmDelete(project) {
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
const DEFAULT_AUTO_FORM = {
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
const autoForm = ref({ ...DEFAULT_AUTO_FORM })
const autoDurationPreset = ref(DEFAULT_DURATION_PRESET)
const autoDuration = ref([...DEFAULT_DURATION_RANGE])
const autoDurationSliderMax = computed(() => sliderMaxForDuration(autoDuration.value, autoDurationPreset.value))
const autoDurationSliderStep = computed(() => sliderStepForDuration(autoDuration.value, autoDurationPreset.value))
const autoResult = ref(null)
const autoDiagnosis = ref(null)
const autoVideoUrl = ref('')
const ratioOptions = ref([])
const motionOptions = ref([])
const bgmList = ref([])
const subtitlePresets = ref([])
const llmProviders = ref([])
const imageModelOptions = ref([])
const videoModelOptions = ref([])
const consistencyOptions = computed(() => [
  { label: t('projects.consistencyStandard'), value: 'standard' },
  { label: t('projects.consistencyStrict'), value: 'strict' },
])
// 一键成片技能选择（手动可选 + 必用自动生效，与 Script/Images 页一致）
const scriptSkillOptions = ref([])
const imageSkillOptions = ref([])
const autoScriptSkills = ref([])
const autoImageSkills = ref([])
const scriptSkillSelectRef = ref(null)
const imageSkillSelectRef = ref(null)
let autoStop = null

function closeSelectAfterChange(selectRef) {
  nextTick(() => selectRef.value?.blur?.())
}

function closeScriptSkillSelect() {
  closeSelectAfterChange(scriptSkillSelectRef)
}

function closeImageSkillSelect() {
  closeSelectAfterChange(imageSkillSelectRef)
}

function applyAutoDurationPreset(value) {
  if (value === 'custom') return
  autoDuration.value = rangeForPreset(value, autoDuration.value)
}

function markAutoDurationCustom() {
  autoDurationPreset.value = 'custom'
}

// 比例/运镜下拉的多语言标签：后端按 key 返回，前端按 key 映射 i18n（缺失则回退后端 label）
const RATIO_KEY = { '16:9': 'ratio169', '9:16': 'ratio916', '1:1': 'ratio11', '4:5': 'ratio45', '4:3': 'ratio43' }
const MOTION_KEY = { none: 'motionNone', 'zoom-in': 'motionZoomIn', 'zoom-out': 'motionZoomOut', 'pan-right': 'motionPanRight', 'pan-left': 'motionPanLeft' }
const ratioOptionsI18n = computed(() => ratioOptions.value.map((r) => ({
  key: r.key, label: RATIO_KEY[r.key] ? t('projects.' + RATIO_KEY[r.key]) : r.label,
})))
const motionOptionsI18n = computed(() => motionOptions.value.map((m) => ({
  key: m.key, label: MOTION_KEY[m.key] ? t('projects.' + MOTION_KEY[m.key]) : m.label,
})))

async function loadComposeOptions() {
  try {
    const [r, b, s, mo, pv, im] = await Promise.all([
      api.get('/media/ratios'),
      api.get('/media/bgm'),
      api.get('/media/subtitle-presets'),
      api.get('/media/motions'),
      api.get('/providers'),
      api.get('/ai/image-models'),
    ])
    ratioOptions.value = r.data.data || []
    bgmList.value = b.data.data || []
    subtitlePresets.value = s.data.data || []
    motionOptions.value = mo.data.data || []
    llmProviders.value = (pv.data.data && pv.data.data.llm) || []
    // 配图模型：本地全部 + 云端已配置（未配置的过滤掉，避免选了报错）
    imageModelOptions.value = (im.data.data || [])
      .filter(m => m.cloud !== true || m.configured)
      .map(m => ({ key: m.key, label: m.label }))
    // 视频生成方式：已配置的 t2v provider 展开为 provider__model（未配置的过滤掉）
    const t2vList = (pv.data.data && pv.data.data.t2v) || []
    videoModelOptions.value = t2vList
      .filter(p => p.configured)
      .flatMap(p => (p.models || []).map(m => ({
        key: `${p.key}__${m}`,
        label: `${t('projects.aiVideoLabel')} · ${p.label} · ${m}${p.free ? t('projects.freeTier') : t('projects.paidTier')}`,
      })))
    // 默认选中已配置的 provider（优先当前 stageModels.script，否则第一个已配置项）
    const configured = llmProviders.value.filter(p => p.configured)
    if (configured.length && !configured.find(p => p.key === autoForm.value.scriptProvider)) {
      autoForm.value.scriptProvider = configured[0].key
    }
    onScriptProviderChange()
  } catch (e) { /* 选项加载失败不阻断，用默认 */ }
}

// 加载一键成片的技能选项：可选技能（手动勾选）+ 必用技能（自动生效，仅展示）
function loadAutoSkills() {
  listSkills('script', true).then((list) => { scriptSkillOptions.value = (list || []).filter(s => !s.auto_apply) }).catch(() => {})
  listSkills('image', true).then((list) => { imageSkillOptions.value = (list || []).filter(s => !s.auto_apply) }).catch(() => {})
  listActiveSkills('script').then((list) => { autoScriptSkills.value = list || [] }).catch(() => {})
  listActiveSkills('image').then((list) => { autoImageSkills.value = list || [] }).catch(() => {})
}

function onScriptProviderChange() {
  const p = llmProviders.value.find(x => x.key === autoForm.value.scriptProvider)
  const models = p ? p.models : []
  if (models.length && !models.includes(autoForm.value.scriptModel)) {
    autoForm.value.scriptModel = models[0]
  }
}

async function uploadBgm(opt) {
  const fd = new FormData()
  fd.append('file', opt.file)
  try {
    const res = await api.post('/media/bgm', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    if (res.data.code === 200) {
      ElMessage.success(t('projects.bgmUploaded'))
      await loadComposeOptions()
      autoForm.value.bgm = res.data.data.key
    } else {
      ElMessage.error(res.data.message || t('projects.uploadFailed'))
    }
  } catch (e) {
    ElMessage.error(t('projects.uploadFailedDetail', { msg: (e.response?.data?.message || e.message) }))
  }
}

// 常规设置默认值 → 一键成片表单的值域映射。
// 兼容旧 settings.json 里存的中文 style 值，统一为对话框 el-select 的英文 key。
const STYLE_VALUE_MAP = { '写实': 'realistic', '动漫': 'animation', '动画': 'animation' }
function normalizeStyleValue(v) {
  if (!v) return 'realistic'
  return STYLE_VALUE_MAP[v] || v
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
  autoDuration.value = [...DEFAULT_DURATION_RANGE]
  autoVisible.value = true
  loadComposeOptions()
  loadAutoSkills()
  // 读取常规设置作为新建项目的默认值（让"常规设置"真正生效）。失败不阻塞，用兜底默认值。
  try {
    const cfg = await getSettings()
    if (cfg) {
      if (cfg.defaultStyle) autoForm.value.style = normalizeStyleValue(cfg.defaultStyle)
      if (cfg.defaultVoice) autoForm.value.voice = cfg.defaultVoice
      if (cfg.defaultImageModel) autoForm.value.imageModel = cfg.defaultImageModel
      if (cfg.defaultDuration && cfg.defaultDuration !== '60-180') {
        autoDuration.value = normalizeDurationRange(cfg.defaultDuration, autoDuration.value)
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
    const res = await api.post('/ai/auto-produce', {
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
        autoResult.value = task.result || {}
        autoVideoUrl.value = mediaUrl(task.result?.file_url || '')
        fetchProjects()
      },
      onError: (err) => {
        autoRunning.value = false
        autoFailed.value = true
        const diagnosis = err.diagnosis || err.task?.diagnosis || err.task?.result?.diagnosis
        autoDiagnosis.value = diagnosis || null
        autoMessage.value = diagnosis?.reason || err.message || t('projects.genFailed')
        ElMessage.error(t('projects.autoFailed', { msg: (diagnosis?.reason || err.message || t('projects.unknownError')) }))
        fetchProjects()
      },
    })
  } catch (e) {
    autoRunning.value = false
    autoFailed.value = true
    autoDiagnosis.value = e?.response?.data?.diagnosis || null
    autoMessage.value = e?.response?.data?.message || e.message || t('projects.startFailed')
    ElMessage.error(e.message || t('projects.startFailed'))
  }
}

async function handleContinueProject(project) {
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
    if (next?.id) router.push(`/projects/${next.id}/script`)
  } catch (e) {
    ElMessage.error(e.message || t('projects.continueFailed'))
  } finally {
    continueSubmitting.value = false
  }
}

async function refreshProjectCompletion(project) {
  if (!project) return
  try {
    const data = await completeProjectCheck(project.id)
    const idx = projects.value.findIndex((p) => Number(p.id) === Number(project.id))
    if (idx !== -1 && data?.project) projects.value[idx] = { ...projects.value[idx], ...data.project }
    ElMessage.success(data?.status_label ? t('projects.completeCheckDone', { status: data.status_label }) : t('projects.completeCheckSaved'))
  } catch (e) {
    ElMessage.error(e?.message || t('projects.completeCheckFailed'))
  }
}

async function openSeriesDialog(project) {
  seriesCurrentProject.value = project
  seriesVisible.value = true
  seriesLoading.value = true
  seriesData.value = null
  try {
    seriesData.value = await getProjectSeries(project.id)
  } catch (e) {
    ElMessage.error(e.message || '读取系列失败')
  } finally {
    seriesLoading.value = false
  }
}

function showDiagnosis(d) {
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

function escapeHtml(s) {
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

<style scoped>
.projects-container {
  padding: 24px;
  min-height: 100vh;
  background: var(--bg-base);
  color: var(--text);
}

.projects-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-input {
  width: 240px;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

/* —— 加载骨架卡 —— */
.skeleton-card {
  cursor: default;
}
.skeleton-card:hover {
  transform: none;
  box-shadow: var(--shadow-sm);
}
.sk-thumb {
  height: 110px;
  width: 100%;
  border-radius: var(--radius-md);
  margin-bottom: 14px;
}
.sk-body {
  padding: 0 2px;
}

.project-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 16px;
  cursor: pointer;
  transition: transform 0.28s cubic-bezier(0.34, 1.4, 0.64, 1), box-shadow 0.28s var(--ease-apple);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-sm);
}

.project-card:hover {
  transform: translateY(-4px) scale(1.012);
  box-shadow: var(--shadow-lg);
}
.project-card .card-thumb .el-icon {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.project-card:hover .card-thumb .el-icon {
  transform: scale(1.15);
}

.card-thumb {
  position: relative;
  overflow: hidden;
  height: 110px;
  border-radius: var(--radius-md);
  margin-bottom: 14px;
  display: grid;
  place-items: center;
  font-size: 30px;
  color: var(--primary);
  background: linear-gradient(135deg, #e3effe, #f3e8ff);
}
.card-thumb.thumb-draft {
  background: linear-gradient(135deg, #fef3e8, #fde8e8);
  color: var(--warning);
}
.card-thumb.thumb-generating {
  background: linear-gradient(135deg, #e6f2ff, #e3effe);
  color: var(--primary);
}
.card-thumb.thumb-completed {
  background: linear-gradient(135deg, #e8f8ee, #e3effe);
  color: var(--success);
}
/* 暗色下缩略图用深色调渐变，避免浅色块突兀 */
:global([data-theme="dark"]) .card-thumb {
  background: linear-gradient(135deg, #1c3050, #2a2140);
}
:global([data-theme="dark"]) .card-thumb.thumb-draft {
  background: linear-gradient(135deg, #3a2c18, #3a1f1f);
}
:global([data-theme="dark"]) .card-thumb.thumb-generating {
  background: linear-gradient(135deg, #16314d, #1c3050);
}
:global([data-theme="dark"]) .card-thumb.thumb-completed {
  background: linear-gradient(135deg, #163a28, #1c3050);
}

/* —— 封面真图（方案 D/B）—— */
.cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.project-card:hover .cover-img { transform: scale(1.06); }

/* —— 渐变色卡首字（方案 A）—— */
.cover-initial {
  font-size: 44px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  letter-spacing: 0;
  user-select: none;
}

/* —— ✨ 生成/换封面按钮 —— */
.cover-gen-btn {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  cursor: pointer;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.22s var(--ease-apple), transform 0.22s var(--ease-apple), background 0.2s;
}
.project-card:hover .cover-gen-btn { opacity: 1; transform: translateY(0); }
.cover-gen-btn:hover { background: rgba(0, 122, 255, 0.85); }
.cover-gen-btn.is-loading { opacity: 1; transform: translateY(0); background: rgba(0, 122, 255, 0.85); cursor: progress; }
.cover-gen-btn .spin { animation: cover-spin 0.8s linear infinite; }
@keyframes cover-spin { to { transform: rotate(360deg); } }

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  gap: 8px;
}

.project-name {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 状态 badge：圆点 + 柔色底 —— */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
}
.status-badge .badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.badge-completed { background: rgba(52, 199, 89, 0.12); color: #248a3d; }
.badge-completed .badge-dot { background: var(--success); }
.badge-draft { background: rgba(255, 159, 10, 0.14); color: #b25e00; }
.badge-draft .badge-dot { background: var(--warning); }
.badge-generating { background: rgba(0, 122, 255, 0.12); color: #0062cc; }
.badge-generating .badge-dot { background: var(--primary); }
.badge-ready { background: rgba(52, 199, 89, 0.12); color: #248a3d; }
.badge-ready .badge-dot { background: var(--success); }
.badge-partial { background: rgba(255, 159, 10, 0.14); color: #b25e00; }
.badge-partial .badge-dot { background: var(--warning); }
.badge-failed { background: rgba(255, 59, 48, 0.12); color: #c4241d; }
.badge-failed .badge-dot { background: var(--danger); }

.card-body {
  flex: 1;
  margin-bottom: 12px;
}

.card-body p {
  margin: 5px 0;
  font-size: 13px;
  color: var(--text-second);
}

.asset-health {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin-top: 8px;
  padding: 4px 9px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--text-second);
  background: rgba(120, 120, 128, 0.1);
}

.advanced-collapse {
  margin-top: 4px;
  border: none;
}

.advanced-collapse :deep(.el-collapse-item__header) {
  height: 38px;
  background: transparent;
  border-bottom: 1px solid var(--separator);
  color: var(--text-second);
  font-size: 13px;
  font-weight: 600;
}

.advanced-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border-bottom: 0;
}

.advanced-collapse :deep(.el-collapse-item__content) {
  padding: 14px 0 0;
}

.series-loading {
  padding: 8px;
}

.series-panel {
  display: grid;
  gap: 16px;
}

.continue-dialog {
  display: grid;
  gap: 12px;
}

.continue-dialog :deep(.el-segmented) {
  width: 100%;
}

.series-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  background: var(--bg-base);
}

.series-hero h3 {
  margin: 0 0 6px;
  color: var(--text);
}

.series-hero p {
  margin: 0;
  color: var(--text-second);
  font-size: 13px;
  line-height: 1.6;
}

.series-episodes {
  display: grid;
  gap: 10px;
}

.series-episode {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 0.18s var(--ease-apple), background 0.18s var(--ease-apple);
}

.series-episode:hover {
  border-color: rgba(0, 122, 255, 0.25);
  background: var(--primary-soft);
}

.episode-index {
  font-size: 13px;
  font-weight: 800;
  color: var(--primary);
}

.episode-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.episode-main strong {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.episode-main span {
  color: var(--text-second);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.series-characters h4 {
  margin: 0 0 10px;
  color: var(--text);
}

.series-character {
  margin: 0 8px 8px 0;
}

.continuity-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin-top: 8px;
  margin-right: 6px;
  padding: 4px 9px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--primary);
  background: var(--primary-soft);
}

.asset-health span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: currentColor;
}

.asset-ok {
  color: var(--success);
  background: rgba(52, 199, 89, 0.1);
}

.asset-warn {
  color: var(--warning);
  background: rgba(255, 159, 10, 0.12);
}

.asset-error {
  color: var(--danger);
  background: rgba(255, 59, 48, 0.1);
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--separator);
  padding-top: 12px;
}

.time-info {
  font-size: 12px;
  color: var(--text-muted);
}

.card-actions {
  display: flex;
  gap: 4px;
}

.empty-state {
  grid-column: 1 / -1;
  padding: 60px 0;
}

/* —— 一键成片 主 CTA：蓝紫渐变 —— */
.cta-button {
  background: linear-gradient(135deg, var(--primary), var(--accent-purple));
  border: none;
  color: #fff;
  font-weight: 500;
  box-shadow: 0 2px 10px rgba(0, 122, 255, 0.28);
  transition: box-shadow 0.2s var(--ease-apple), transform 0.15s var(--ease-apple);
}
.cta-button:hover {
  background: linear-gradient(135deg, var(--primary), var(--accent-purple));
  color: #fff;
  box-shadow: 0 4px 16px rgba(0, 122, 255, 0.36);
}
.cta-button:active { transform: scale(0.97); }

:deep(.el-dialog) {
  border-radius: var(--radius-lg);
}

.duration-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-second);
  text-align: center;
}

.auto-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-second);
  line-height: 1.6;
}

.auto-progress {
  padding: 12px 4px;
}

.auto-msg {
  margin-top: 16px;
  text-align: center;
  font-size: 14px;
  color: var(--text-primary);
  min-height: 20px;
}

.auto-result {
  margin-top: 16px;
}

.auto-video {
  width: 100%;
  max-height: 280px;
  border-radius: 8px;
  background: #000;
}

.auto-success-text {
  margin-top: 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-second);
}

.auto-running-tip {
  font-size: 13px;
  color: var(--text-second);
}
</style>
