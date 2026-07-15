<template>
  <div class="images-page">
    <div class="left-panel">
      <h3 class="panel-title">分镜列表</h3>
      <el-select v-if="chapterOptions.length > 1" v-model="selectedChapter" class="chapter-filter" size="small">
        <el-option v-for="chapter in chapterOptions" :key="chapter.value" :label="chapter.label" :value="chapter.value" />
      </el-select>
      <div class="storyboard-list">
        <div
          v-for="(sb, index) in visibleStoryboards"
          :key="sb.id"
          class="storyboard-item"
          :class="{ active: selectedStoryboard?.id === sb.id }"
          role="button"
          tabindex="0"
          :aria-pressed="selectedStoryboard?.id === sb.id"
          :aria-label="`选择镜头 ${index + 1}：${sb.description || '未命名分镜'}`"
          @click="selectStoryboard(sb)"
          @keydown.enter.prevent="selectStoryboard(sb)"
          @keydown.space.prevent="selectStoryboard(sb)"
        >
          <div class="scene-number">镜头 {{ index + 1 }}</div>
          <el-tag v-if="sb.assets_stale" class="storyboard-stale-tag" size="small" type="warning" effect="plain">待复查</el-tag>
          <div class="thumbnail">
            <img v-if="sb.selected_image_url" :src="sb.selected_image_url" alt="thumbnail" />
            <el-icon v-else :size="32"><Picture /></el-icon>
          </div>
          <div class="scene-desc">{{ sb.description?.slice(0, 30) }}...</div>
        </div>
      </div>
    </div>

    <div class="right-panel" v-if="selectedStoryboard">
      <WorkbenchGuide
        :guide="workbenchStatus"
        :repairing="repairingWorkbench"
        title="画面工作台"
        @refresh="loadWorkbenchStatus"
        @repair="handleWorkbenchRepair"
        @primary="handleGuidePrimary"
      />

      <h3 class="panel-title">{{ selectedStoryboard.description }}</h3>

      <el-alert
        v-if="selectedStoryboard.assets_stale"
        class="stale-alert"
        type="warning"
        :closable="false"
        show-icon
        title="脚本内容已变化，旧画面仍保留"
        description="你可以继续比较或明确选用旧候选；重新生成会新增候选，不会覆盖当前选择。"
      />

      <div class="prompt-section">
        <label class="section-label">画面生成提示词</label>
        <div v-if="selectedStoryboardCharacters.length" class="character-strip">
          <div v-for="c in selectedStoryboardCharacters" :key="c.id" class="character-variant-row">
            <div class="character-variant-label">
              <el-tag size="small" :type="c.locked ? 'success' : 'warning'">
                {{ c.name }} · {{ c.locked ? $t('script.locked') : $t('script.unlocked') }}
              </el-tag>
              <el-tag size="small" effect="plain">{{ assetUnitFor(c.id)?.scope === 'series' ? '系列共享' : '本集' }}</el-tag>
            </div>
            <el-select
              v-if="assetUnitFor(c.id)?.variants?.length"
              :model-value="boundVariantId(c.id) || assetUnitFor(c.id)?.selected_variant_id"
              size="small"
              class="variant-select"
              aria-label="选择镜头角色 Variant"
              @change="bindExistingVariant(c, $event)"
            >
              <el-option
                v-for="variant in activeVariantsFor(c.id)"
                :key="variant.id"
                :value="variant.id"
                :label="`R${variant.revision} · ${variant.label || '参考图'}${variant.selected ? ' · 默认' : ''}`"
              />
            </el-select>
            <span v-else class="variant-empty">暂无 Variant，可从下方候选设为参考</span>
          </div>
        </div>
        <el-input
          v-model="editablePrompt"
          type="textarea"
          :rows="4"
          :placeholder="$t('images.promptPlaceholder')"
        />
        <div class="prompt-actions">
          <el-button type="primary" @click="copyPrompt">
            <el-icon><CopyDocument /></el-icon> 复制提示词
          </el-button>
          <el-button type="warning" @click="rebuildPrompt">
            <el-icon><MagicStick /></el-icon> {{ $t('images.autoGenPrompt') }}
          </el-button>
        </div>
        <div class="negative-hint">
          <span class="hint-label">{{ $t('images.negativeLabel') }}</span>
          <span class="hint-text">{{ negativePrompt }}</span>
        </div>
      </div>

      <div class="ai-gen-section">
        <label class="section-label">{{ $t('images.aiGenTitle') }}</label>
        <div class="ai-gen-controls">
          <el-select v-model="selectedRatio" :placeholder="$t('images.ratioPlaceholder')" style="width: 130px">
            <el-option label="16:9 (横屏)" value="16:9" />
            <el-option label="9:16 (竖屏)" value="9:16" />
            <el-option label="1:1 (方形)" value="1:1" />
            <el-option label="4:5 (竖图)" value="4:5" />
            <el-option label="4:3" value="4:3" />
            <el-option label="3:4" value="3:4" />
          </el-select>
          <el-button
            type="primary"
            :loading="generating"
            @click="generateAIImage"
          >
            <el-icon><MagicStick /></el-icon>
            {{ generating ? $t('images.generating') : '生成本镜画面' }}
          </el-button>
          <el-button plain :disabled="!selectedStoryboardCharacters.length" @click="autoLockCurrentCharacter">
            一键定妆
          </el-button>
          <el-button plain :loading="batchGenerating" @click="openBatchImageDialog('missing')">
            {{ $t('images.generateAllImages') }}
          </el-button>
        </div>
        <el-collapse class="advanced-collapse">
          <el-collapse-item title="高级设置" name="advanced">
            <div class="ai-gen-controls advanced-controls">
              <el-select v-model="selectedModel" :placeholder="$t('images.selectModelPlaceholder')" style="width: 240px">
                <el-option
                  v-for="m in availableModels"
                  :key="m.key"
                  :label="m.label"
                  :value="m.key"
                />
              </el-select>
              <el-select v-model="batchSize" :placeholder="$t('images.batchPlaceholder')" style="width: 110px">
                <el-option :label="$t('images.batchCount', { n: 1 })" :value="1" />
                <el-option :label="$t('images.batchCount', { n: 2 })" :value="2" />
                <el-option :label="$t('images.batchCount', { n: 3 })" :value="3" />
                <el-option :label="$t('images.batchCount', { n: 4 })" :value="4" />
              </el-select>
              <el-select v-model="skillIds" multiple collapse-tags collapse-tags-tooltip :placeholder="$t('images.skillNone')" clearable style="width: 220px">
                <el-option v-for="s in imageSkills" :key="s.id" :label="`${s.icon} ${s.name}`" :value="s.id" />
              </el-select>
              <el-select v-model="consistencyMode" :placeholder="$t('images.consistencyMode')" style="width: 150px">
                <el-option :label="$t('images.consistencyStandard')" value="standard" />
                <el-option :label="$t('images.consistencyStrict')" value="strict" />
              </el-select>
              <el-switch v-model="reuseCache" active-text="复用缓存" />
            </div>
          </el-collapse-item>
        </el-collapse>
        <div v-if="continuityWarnings.length" class="continuity-warnings">
          <div v-for="w in continuityWarnings" :key="w">· {{ w }}</div>
        </div>
        <div v-if="autoSkills.length" class="auto-skills-bar">
          <span class="auto-skills-label">⚡ {{ $t('script.autoSkillsLabel') }}</span>
          <el-tag v-for="s in autoSkills" :key="s.id" size="small" type="danger" effect="plain">{{ s.icon }} {{ s.name }}</el-tag>
        </div>
        <div v-if="generating" class="gen-progress">
          <el-progress :percentage="genProgress" :stroke-width="14" :text-inside="true" status="success" />
          <div class="gen-message">{{ genMessage }}</div>
        </div>
        <div v-if="creditInfo" class="credit-hint">
          {{ $t('images.creditLeft', { n: creditInfo.total_credit }) }}
        </div>
      </div>

      <div class="upload-section">
        <label class="section-label">{{ $t('images.manualUpload') }}</label>
        <el-upload
          :action="uploadUrl"
          :data="{ storyboard_id: selectedStoryboard.id }"
          :on-success="handleUploadSuccess"
          :on-error="handleUploadError"
          :show-file-list="false"
          accept="image/*"
        >
          <el-button type="success">{{ $t('images.clickUpload') }}</el-button>
        </el-upload>
      </div>

      <div class="gallery-section">
        <div class="gallery-heading">
          <label class="section-label">画面候选</label>
          <el-switch v-model="includeArchived" size="small" active-text="显示已归档" />
        </div>
        <div class="image-gallery" v-if="images.length">
          <div
            v-for="img in images"
            :key="img.id"
            class="gallery-item"
            :class="{ selected: selectedStoryboard.selected_image_id === img.id, archived: img.archived_at }"
            role="option"
            tabindex="0"
            :aria-selected="selectedStoryboard.selected_image_id === img.id"
            :aria-label="`候选 ${img.id}${img.favorite ? '，已收藏' : ''}${img.archived_at ? '，已归档' : ''}`"
            @keydown.enter.prevent="selectImage(img)"
            @keydown.f.prevent="toggleFavorite(img)"
          >
            <el-image
              :src="img.url"
              :alt="img.filename"
              fit="contain"
              :preview-src-list="images.map(i => i.url)"
              :initial-index="images.findIndex(i => i.id === img.id)"
              :preview-teleported="true"
              hide-on-click-modal
            />
            <div v-if="selectedStoryboard.selected_image_id === img.id" class="selected-badge">
              {{ $t('images.selectedBadge') }}
            </div>
            <div v-if="img.favorite" class="favorite-badge">★ 收藏</div>
            <div v-if="img.archived_at" class="archived-badge">已归档</div>
            <div v-if="imageQualityLabel(img)" class="quality-badge" :class="'quality-' + imageQualityType(img)">
              {{ imageQualityLabel(img) }}
            </div>
            <div class="candidate-meta">
              <span>{{ img.provider || (img.gen_status === 'success' ? 'local' : '待生成') }}</span>
              <span v-if="img.model">· {{ img.model }}</span>
              <span v-if="img.task_id" :title="img.task_id">· Task {{ shortId(img.task_id) }}</span>
            </div>
            <div class="gallery-actions">
              <el-button size="small" type="primary" @click="selectImage(img)" :disabled="selectedStoryboard.selected_image_id === img.id || !!img.archived_at">
                {{ selectedStoryboard.selected_image_id === img.id ? $t('images.current') : $t('images.use') }}
              </el-button>
              <el-button size="small" @click="bindReferenceImage(img)" :disabled="!selectedStoryboardCharacters.length || !!img.archived_at">
                {{ $t('images.useAsReference') }}
              </el-button>
              <el-button size="small" @click="toggleFavorite(img)">{{ img.favorite ? '取消收藏' : '收藏' }}</el-button>
              <el-button size="small" @click="toggleArchive(img)" :disabled="selectedStoryboard.selected_image_id === img.id">
                {{ img.archived_at ? '恢复' : '归档' }}
              </el-button>
              <el-button size="small" type="danger" plain @click="deleteImage(img)" :disabled="!!img.archived_at">彻底删除</el-button>
            </div>
          </div>
        </div>
        <el-empty v-else description="还没有画面素材，可使用 Demo 本地占位画面或生成新图片" />
      </div>

      <ProjectStageFooter
        current-stage="画面生成"
        next-stage="配音字幕"
        :ready="imagesStageReady"
        :blocked-reason="imagesStageBlockedReason"
        action-label="进入配音字幕"
        ready-hint="已有画面素材，可以继续处理配音和字幕。"
        @go-next="goNextStage"
      />
    </div>

    <div class="right-panel empty-state" v-else>
      <el-empty description="Select a storyboard to manage images" />
      <ProjectStageFooter
        current-stage="画面生成"
        next-stage="配音字幕"
        :ready="imagesStageReady"
        :blocked-reason="imagesStageBlockedReason"
        action-label="进入配音字幕"
        ready-hint="已有画面素材，可以继续处理配音和字幕。"
        @go-next="goNextStage"
      />
    </div>

    <el-dialog
      v-model="batchDialogVisible"
      :title="$t('images.batchDialogTitle')"
      width="520px"
      append-to-body
      :close-on-click-modal="!batchGenerating"
      :show-close="!batchGenerating"
    >
      <div class="batch-dialog-body">
        <el-segmented
          v-model="batchForm.mode"
          :options="batchModeOptions"
          :disabled="batchGenerating"
        />
        <p class="batch-hint">{{ batchModeHint }}</p>
        <el-collapse class="advanced-collapse">
          <el-collapse-item :title="$t('images.advancedSettings')" name="advanced">
            <div class="batch-advanced">
              <el-select v-model="batchForm.model" :placeholder="$t('images.selectModelPlaceholder')" style="width: 100%">
                <el-option label="跟随设置（推荐）" value="auto" />
                <el-option v-for="m in availableModels" :key="m.key" :label="m.label" :value="m.key" />
              </el-select>
              <el-select v-model="batchForm.batchSize" :placeholder="$t('images.batchPlaceholder')" style="width: 100%">
                <el-option :label="$t('images.batchCount', { n: 1 })" :value="1" />
                <el-option :label="$t('images.batchCount', { n: 2 })" :value="2" />
                <el-option :label="$t('images.batchCount', { n: 3 })" :value="3" />
                <el-option :label="$t('images.batchCount', { n: 4 })" :value="4" />
              </el-select>
              <el-select v-model="batchForm.consistencyMode" :placeholder="$t('images.consistencyMode')" style="width: 100%">
                <el-option :label="$t('images.consistencyStandard')" value="standard" />
                <el-option :label="$t('images.consistencyStrict')" value="strict" />
              </el-select>
              <el-switch v-model="batchForm.reuseCache" :active-text="$t('images.reuseCache')" />
            </div>
          </el-collapse-item>
        </el-collapse>
        <div v-if="batchGenerating" class="gen-progress">
          <el-progress :percentage="batchProgress" :stroke-width="14" :text-inside="true" status="success" />
          <div class="gen-message">{{ batchMessage }}</div>
        </div>
        <div v-if="batchResult" class="batch-result">
          <el-tag type="success" effect="plain">{{ $t('images.batchSuccessCount', { n: batchResult.successes?.length || 0 }) }}</el-tag>
          <el-tag v-if="batchResult.failures?.length" type="danger" effect="plain">
            {{ $t('images.batchFailedCount', { n: batchResult.failures.length }) }}
          </el-tag>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="batchGenerating" @click="batchDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          v-if="batchResult?.failures?.length"
          :loading="batchGenerating"
          @click="retryBatchFailed"
        >
          {{ $t('images.retryFailedOnly') }}
        </el-button>
        <el-button type="primary" :loading="batchGenerating" @click="startBatchImageGeneration">
          {{ $t('images.startBatchGenerate') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import type { Project } from '@aigc-video/contracts'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { Picture, CopyDocument, MagicStick } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { retryFailedTask, trackTask } from '../api/tasks'
import { mediaUrl, API_URL } from '../api/config'
import { listSkills, listActiveSkills, type CreativeSkill } from '../api/skills'
import {
  listCharacters, addCharacterReference, checkContinuity, autoLockCharacters, lockCharacter,
  type ContinuityRecord,
} from '../api/continuity'
import { getProject, repairWorkbench } from '../api/projects'
import { getScriptWorkbenchStatus, listStoryboards, type EditableStoryboard, type WorkbenchAction, type WorkbenchStatus } from '../api/script'
import {
  deleteImageCandidate,
  BatchImageResultSchema,
  getDreaminaCredit,
  listStoryboardImages,
  parseBatchImageResult,
  parseBatchSubmission,
  parseImageGenerationResult,
  submitBatchImageGeneration,
  submitImageGeneration,
  type BatchImageResult,
  type CreditInfo,
  type ImageCandidate,
} from '../api/images'
import { getImageModels, type ImageModelOption } from '../api/providers'
import { getAssetLibrary, bindAssetVariant, selectCandidate, reviewCandidate, type AssetLibraryView } from '../api/assets'
import WorkbenchGuide from '../components/WorkbenchGuide.vue'
import ProjectStageFooter from '../components/ProjectStageFooter.vue'

const { t } = useI18n()
const uploadUrl = `${API_URL}/images/upload`

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function diagnosisReason(value: unknown): string {
  return isRecord(value) && typeof value.reason === 'string' ? value.reason : ''
}

// 任务进度跟踪停止函数（卸载时关闭 SSE，防泄漏）
let stopTracking: (() => void) | null = null

const route = useRoute()
const router = useRouter()
const projectId = String(route.params.id || '')

const storyboards = ref<EditableStoryboard[]>([])
const selectedStoryboard = ref<EditableStoryboard | null>(null)
const selectedChapter = ref('all')
const editablePrompt = ref('')
const images = ref<ImageCandidate[]>([])
const project = ref<Project | null>(null)
const characters = ref<ContinuityRecord[]>([])
const continuityWarnings = ref<string[]>([])
const workbenchStatus = ref<WorkbenchStatus | null>(null)
const assetLibrary = ref<AssetLibraryView>({ units: [], bindings: [], supported_asset_types: [], resolution_order: [] })
const includeArchived = ref(false)
const repairingWorkbench = ref(false)

// AI 生成相关
const availableModels = ref<ImageModelOption[]>([])
const selectedModel = ref('flux')
const selectedRatio = ref('16:9')
// ⑦ 图片生成创作技能
const skillIds = ref<Array<string | number>>([])
const imageSkills = ref<CreativeSkill[]>([])
const autoSkills = ref<CreativeSkill[]>([])
const batchSize = ref(1)
const consistencyMode = ref('standard')
const reuseCache = ref(true)
const generating = ref(false)
const genProgress = ref(0)
const genMessage = ref('')
const creditInfo = ref<CreditInfo | null>(null)
const negativePrompt = ref('low quality, blurry, distorted, watermark')
const batchDialogVisible = ref(false)
const batchGenerating = ref(false)
const batchProgress = ref(0)
const batchMessage = ref('')
const batchResult = ref<BatchImageResult | null>(null)
const batchTaskId = ref('')
type BatchMode = 'missing' | 'all' | 'failed' | 'low_score'
interface BatchForm { mode: BatchMode; model: string; batchSize: number; consistencyMode: string; reuseCache: boolean }
const batchForm = ref<BatchForm>({ mode: 'missing', model: 'auto', batchSize: 2, consistencyMode: 'standard', reuseCache: true })
const batchModeOptions = computed(() => [
  { label: t('images.batchModeMissing'), value: 'missing' },
  { label: t('images.batchModeAll'), value: 'all' },
  { label: t('images.batchModeFailed'), value: 'failed' },
  { label: t('images.batchModeLowScore'), value: 'low_score' },
])
const batchModeHint = computed(() => ({
  missing: t('images.batchHintMissing'),
  all: t('images.batchHintAll'),
  failed: t('images.batchHintFailed'),
  low_score: t('images.batchHintLowScore'),
}[batchForm.value.mode] || t('images.batchHintMissing')))
const chapterOptions = computed(() => {
  const map = new Map<number, { value: string; label: string; count: number }>()
  storyboards.value.forEach((sb) => {
    const idx = Number(sb.chapter_index || 0)
    if (!idx) return
    if (!map.has(idx)) map.set(idx, {
      value: String(idx),
      label: sb.chapter_title || `第 ${idx} 章`,
      count: 0,
    })
    const chapter = map.get(idx)
    if (chapter) chapter.count += 1
  })
  const list = [...map.values()]
    .sort((a, b) => Number(a.value) - Number(b.value))
    .map((item) => ({ ...item, label: `${item.label}（${item.count} 镜）` }))
  return list.length ? [{ value: 'all', label: `全部章节（${storyboards.value.length} 镜）` }, ...list] : []
})
const visibleStoryboards = computed(() => {
  if (selectedChapter.value === 'all') return storyboards.value
  return storyboards.value.filter((sb) => String(sb.chapter_index || 1) === selectedChapter.value)
})
const imagesStageReady = computed(() => storyboards.value.some((s) => s.selected_image_id || s.selected_image_url))
const imagesStageBlockedReason = computed(() => {
  if (!storyboards.value.length) return '请先在文案创作中生成并保存分镜。'
  if (generating.value || batchGenerating.value) return '正在生成画面，请等待任务完成。'
  return '请至少为一个分镜生成或选择画面后，再进入配音字幕。'
})

function goNextStage(): void {
  router.push(`/projects/${projectId}/audio`)
}

// 风格关键词映射（与后端 imageGen.js 保持一致）
const STYLE_KEYWORDS: Record<string, string> = {
  realistic: 'photorealistic, ultra detailed, 8K, cinematic lighting, sharp focus',
  animation: 'anime style, cel shading, vibrant colors, studio ghibli inspired',
  cyberpunk: 'cyberpunk, neon lights, futuristic city, blade runner aesthetic, dystopian',
  'ink-wash': 'Chinese ink wash painting, sumi-e, traditional, monochrome, minimal',
  minimal: 'minimalist, clean composition, negative space, simple, elegant',
  retro: 'retro 80s aesthetic, vintage film, grain, pastel colors, nostalgic',
}
const QUALITY_PREFIX = 'masterpiece, best quality, highly detailed'

const fetchProject = async () => {
  try {
    project.value = await getProject(projectId)
    // ③ 配图画幅默认跟随项目比例，保证「项目=配图=预览=导出」比例一致
    if (project.value?.ratio) selectedRatio.value = project.value.ratio
  } catch {}
}

const fetchCharacters = async () => {
  try {
    characters.value = await listCharacters(projectId) || []
  } catch {
    characters.value = []
  }
}

const fetchAssetLibrary = async () => {
  try {
    assetLibrary.value = await getAssetLibrary(projectId)
  } catch {
    assetLibrary.value = { units: [], bindings: [], supported_asset_types: [], resolution_order: [] }
  }
}

const assetUnitFor = (characterId: string | number) => assetLibrary.value.units.find(
  (unit) => unit.asset_type === 'character' && Number(unit.id) === Number(characterId)
)

const activeVariantsFor = (characterId: string | number) => (
  assetUnitFor(characterId)?.variants.filter((variant) => !variant.archived_at) || []
)

const bindingFor = (characterId: string | number) => assetLibrary.value.bindings.find(
  (binding) => Number(binding.storyboard_id) === Number(selectedStoryboard.value?.id)
    && binding.asset_type === 'character'
    && Number(binding.asset_id) === Number(characterId)
)

const boundVariantId = (characterId: string | number): string | null => {
  const value = bindingFor(characterId)?.variant_id
  return value == null ? null : String(value)
}

const bindExistingVariant = async (character: ContinuityRecord, variantId: string): Promise<void> => {
  const storyboardId = selectedStoryboard.value?.id
  if (storyboardId === undefined) return
  try {
    await bindAssetVariant(storyboardId, {
      project_id: Number(projectId),
      asset_type: 'character',
      asset_id: character.id,
      variant_id: variantId,
      source_scope: assetUnitFor(character.id)?.scope || 'episode',
    })
    await fetchAssetLibrary()
    ElMessage.success(`已将 ${character.name} 的 Variant 绑定到当前镜头`)
  } catch (cause: unknown) {
    ElMessage.error(errorMessage(cause, '镜头资产绑定失败'))
  }
}

const loadWorkbenchStatus = async () => {
  try {
    workbenchStatus.value = await getScriptWorkbenchStatus(projectId)
  } catch {
    workbenchStatus.value = null
  }
}

const fetchModels = async () => {
  try {
    availableModels.value = await getImageModels()
  } catch {
    availableModels.value = [{ key: 'dreamina', label: '即梦 4.0' }]
  }
}

const fetchCredit = async () => {
  try {
    creditInfo.value = await getDreaminaCredit()
  } catch {}
}

const fetchStoryboards = async () => {
  try {
    const list = await listStoryboards(projectId)
    // selected_image_url 已由后端 JOIN 返回，无需对每个分镜再请求一次（消除 N+1）
    storyboards.value = list.map((storyboard) => ({
      ...storyboard,
      selected_image_url: storyboard.selected_image_url ? mediaUrl(storyboard.selected_image_url) : '',
    }))
    if (selectedStoryboard.value) {
      const selectedId = selectedStoryboard.value.id
      const fresh = storyboards.value.find((s) => Number(s.id) === Number(selectedId))
      selectedStoryboard.value = fresh || visibleStoryboards.value[0] || null
    }
  } catch {
    ElMessage.error('Failed to load storyboards')
  }
}

watch(selectedChapter, () => {
  selectedStoryboard.value = visibleStoryboards.value[0] || null
  if (selectedStoryboard.value) selectStoryboard(selectedStoryboard.value)
})

watch(includeArchived, () => {
  const id = selectedStoryboard.value?.id
  if (id !== undefined) void fetchImages(id)
})

const fetchImages = async (storyboardId: string | number): Promise<void> => {
  try {
    const list = await listStoryboardImages(storyboardId, includeArchived.value)
    images.value = list.map((image) => ({
      ...image,
      url: image.file_url ? mediaUrl(image.file_url) : '',
    }))
  } catch {
    ElMessage.error('Failed to load images')
  }
}

const handleWorkbenchRepair = async (type = 'auto'): Promise<void> => {
  if (type === 'missing_images') return runBatchImages({ mode: 'missing', silentDialog: true })
  if (type === 'low_score_images') return runBatchImages({ mode: 'low_score', silentDialog: true })
  repairingWorkbench.value = true
  try {
    await repairWorkbench(projectId, {
      type,
      model: selectedModel.value,
      ratio: selectedRatio.value,
      consistencyMode: consistencyMode.value,
    })
    ElMessage.success('已完成画面修复')
    await Promise.all([fetchStoryboards(), fetchCharacters(), fetchAssetLibrary(), loadWorkbenchStatus()])
    if (selectedStoryboard.value) {
      const selectedId = selectedStoryboard.value.id
      const fresh = storyboards.value.find((s) => s.id === selectedId)
      if (fresh) selectedStoryboard.value = fresh
      const id = selectedStoryboard.value?.id
      if (id !== undefined) await fetchImages(id)
    }
  } catch (cause: unknown) {
    ElMessage.error(errorMessage(cause, '修复失败'))
  } finally {
    repairingWorkbench.value = false
  }
}

const handleGuidePrimary = async (action: WorkbenchAction): Promise<void> => {
  if (!action) return
  if (action.type === 'repair_missing_images') return runBatchImages({ mode: 'missing', silentDialog: true })
  if (action.type === 'repair_low_score_images') return runBatchImages({ mode: 'low_score', silentDialog: true })
  if (action.type === 'auto_lock') return autoLockCurrentCharacter()
}

const selectStoryboard = (sb: EditableStoryboard): void => {
  selectedStoryboard.value = sb
  editablePrompt.value = sb.prompt || ''
  continuityWarnings.value = []
  if (sb.id !== undefined) void fetchImages(sb.id)
}

// 前端构建提示词（用于预览/手动复用）
const buildLocalPrompt = (sb: EditableStoryboard): string => {
  const base = (sb.description || sb.dialog || '').trim()
  const styleSuffix = STYLE_KEYWORDS[project.value?.style || ''] || ''
  const visualAnchor = (project.value?.visual_anchor || '').trim()
  const charAnchor = selectedStoryboardCharacters.value
    .map((c) => c.prompt_anchor)
    .filter(Boolean)
    .join(', ')
  return [QUALITY_PREFIX, visualAnchor, charAnchor, base, styleSuffix].filter(Boolean).join(', ')
}

const selectedStoryboardCharacters = computed(() => {
  if (!selectedStoryboard.value) return []
  let refs: unknown = []
  try {
    refs = typeof selectedStoryboard.value.characters_in_scene === 'string'
      ? JSON.parse(selectedStoryboard.value.characters_in_scene || '[]')
      : (selectedStoryboard.value.characters_in_scene || [])
  } catch { refs = [] }
  const ids = Array.isArray(refs)
    ? refs.map((item) => Number(isRecord(item) ? item.character_id : 0)).filter(Boolean)
    : []
  if (!ids.length && characters.value[0]) return [characters.value[0]]
  return characters.value.filter((c) => ids.includes(Number(c.id)))
})

const rebuildPrompt = (): void => {
  if (!selectedStoryboard.value) return
  editablePrompt.value = buildLocalPrompt(selectedStoryboard.value)
  ElMessage.success(t('images.promptRebuilt'))
}

const copyPrompt = async () => {
  try {
    await navigator.clipboard.writeText(editablePrompt.value)
    ElMessage.success('Prompt copied to clipboard')
  } catch {
    ElMessage.error('Failed to copy prompt')
  }
}

const generateAIImage = async () => {
  if (!selectedStoryboard.value) return
  const storyboardId = selectedStoryboard.value.id
  if (storyboardId === undefined) {
    ElMessage.error(t('images.submitFailed'))
    return
  }
  generating.value = true
  genProgress.value = 0
  genMessage.value = t('images.submittingTask')
  try {
    const submission = await submitImageGeneration({
      storyboard_id: storyboardId,
      prompt: editablePrompt.value || undefined,
      ratio: selectedRatio.value,
      model: selectedModel.value,
      batch_size: batchSize.value,
      skill_ids: skillIds.value?.length ? skillIds.value : undefined,
      character_ids: selectedStoryboardCharacters.value.map((c) => c.id),
      reference_image_ids: selectedStoryboardCharacters.value.flatMap((c) => (c.assets || [])
        .filter((a) => !a.archived_at && a.status !== 'archived')
        .map((a) => a.id)),
      consistency_mode: consistencyMode.value,
      auto_select_best: true,
      reuse_cache: reuseCache.value,
      async: true,
    })
    const taskId = submission.task_id

    await new Promise<void>((resolve, reject) => {
      stopTracking = trackTask(taskId, {
        onProgress: (task) => {
          genProgress.value = task.progress
          genMessage.value = task.message
        },
        onSuccess: async (task) => {
          try {
            const data = parseImageGenerationResult(task.result)
            // v1.6.4：透明提示模型切换/占位图兜底情况
            if (data.is_placeholder) {
              ElMessage({ type: 'warning', duration: 8000, showClose: true,
                message: data.notice || '所有生图模型都失败了，已用占位图代替。建议到「设置 → 模型路由 → 备用生图模型」多配置几个模型。' })
            } else if (data.downgraded && data.notice) {
              ElMessage({ type: 'warning', duration: 6000, showClose: true, message: data.notice })
            } else {
              ElMessage.success(t('images.genSuccess', { n: data.image_count }))
            }
            // data.prompt 是实际发送给 Provider 的 compiled prompt，只用于 Candidate/
            // 任务诊断。编辑框继续保留用户原始输入，避免再次生成时重复注入上下文。
            continuityWarnings.value = data.continuity?.warnings || []
            await fetchImages(storyboardId)
            await Promise.all([fetchCharacters(), fetchAssetLibrary()])
            await fetchStoryboards()
            await loadWorkbenchStatus()
            void fetchCredit()
            resolve()
          } catch (cause: unknown) {
            reject(cause)
          }
        },
        onError: (err) => {
          ElMessage.error(err.message || t('images.aiGenFailed'))
          reject(err)
        },
      })
    })
  } catch (cause: unknown) {
    ElMessage.error(errorMessage(cause, t('images.aiGenFailed')))
  } finally {
    generating.value = false
    genProgress.value = 0
    genMessage.value = ''
  }
}

function openBatchImageDialog(mode: BatchMode = 'missing'): void {
  batchForm.value = {
    ...batchForm.value,
    mode,
    model: selectedModel.value || 'auto',
    batchSize: Math.max(1, Number(batchSize.value) || 2),
    consistencyMode: consistencyMode.value || 'standard',
    reuseCache: reuseCache.value !== false,
  }
  batchResult.value = null
  batchMessage.value = ''
  batchProgress.value = 0
  batchDialogVisible.value = true
}

async function refreshAfterBatch(): Promise<void> {
  await Promise.all([fetchStoryboards(), fetchCharacters(), fetchAssetLibrary(), loadWorkbenchStatus()])
  if (selectedStoryboard.value) {
    const selectedId = selectedStoryboard.value.id
    const fresh = storyboards.value.find((s) => Number(s.id) === Number(selectedId))
    if (fresh) selectedStoryboard.value = fresh
    const id = selectedStoryboard.value?.id
    if (id !== undefined) await fetchImages(id)
  }
  void fetchCredit()
}

async function handleBatchComplete(result: unknown, partial = false): Promise<void> {
  batchResult.value = parseBatchImageResult(result)
  await refreshAfterBatch()
  const ok = batchResult.value?.successes?.length || 0
  const fail = batchResult.value?.failures?.length || 0
  if (partial || fail) {
    ElMessage.warning(t('images.batchPartialDone', { ok, fail }))
  } else {
    ElMessage.success(t('images.batchDone', { n: ok }))
  }
}

async function watchBatchTask(taskId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (stopTracking) { stopTracking(); stopTracking = null }
    stopTracking = trackTask(taskId, {
      onProgress: (task) => {
        batchProgress.value = task.progress || 0
        batchMessage.value = task.message || ''
      },
      onSuccess: async (task) => {
        try {
          await handleBatchComplete(task.result, false)
          resolve()
        } catch (cause: unknown) {
          reject(cause)
        }
      },
      onError: async (err) => {
        const task = err.task
        if (task?.status === 'partial') {
          await handleBatchComplete(task.result, true)
          resolve()
          return
        }
        const parsed = BatchImageResultSchema.safeParse(task?.result)
        batchResult.value = parsed.success ? parsed.data : null
        const diagnosis = diagnosisReason(err.diagnosis)
          || diagnosisReason(task?.meta?.diagnosis)
          || batchResult.value?.failures[0]?.diagnosis?.reason
        const msg = diagnosis || err.message || t('images.batchFailed')
        ElMessage.error(msg)
        await refreshAfterBatch()
        reject(err)
      },
    })
  })
}

async function runBatchImages(
  options: { mode?: BatchMode; silentDialog?: boolean } = {},
): Promise<void> {
  const { mode, silentDialog = false } = options
  if (batchGenerating.value) return
  if (mode) batchForm.value.mode = mode
  if (!silentDialog) batchDialogVisible.value = true
  batchGenerating.value = true
  batchProgress.value = 0
  batchMessage.value = t('images.submittingTask')
  batchResult.value = null
  try {
    const data = await submitBatchImageGeneration(projectId, {
      mode: batchForm.value.mode,
      model: batchForm.value.model || selectedModel.value || 'auto',
      ratio: selectedRatio.value,
      batch_size_per_scene: batchForm.value.batchSize || 2,
      consistencyMode: batchForm.value.consistencyMode || consistencyMode.value || 'standard',
      reuse_cache: batchForm.value.reuseCache !== false,
      auto_select_best: true,
    })
    batchTaskId.value = data.task_id
    batchDialogVisible.value = true
    if (!data.target_count) {
      batchResult.value = { successes: [], failures: [] }
      ElMessage.info(t('images.batchNoTargets'))
      await refreshAfterBatch()
      return
    }
    await watchBatchTask(data.task_id)
  } catch (cause: unknown) {
    ElMessage.error(errorMessage(cause, t('images.batchFailed')))
  } finally {
    batchGenerating.value = false
    batchProgress.value = 0
    batchMessage.value = ''
  }
}

async function startBatchImageGeneration(): Promise<void> {
  await runBatchImages()
}

async function retryBatchFailed() {
  if (!batchTaskId.value || batchGenerating.value) return
  batchGenerating.value = true
  batchProgress.value = 0
  batchMessage.value = t('images.submittingTask')
  try {
    const raw = await retryFailedTask(batchTaskId.value, {
      model: batchForm.value.model || selectedModel.value || 'auto',
      ratio: selectedRatio.value,
      batch_size_per_scene: batchForm.value.batchSize || 2,
      consistencyMode: batchForm.value.consistencyMode || consistencyMode.value || 'standard',
      reuse_cache: batchForm.value.reuseCache !== false,
    })
    const data = parseBatchSubmission(raw)
    batchTaskId.value = data.task_id
    await watchBatchTask(data.task_id)
  } catch (cause: unknown) {
    ElMessage.error(errorMessage(cause, t('images.batchFailed')))
  } finally {
    batchGenerating.value = false
    batchProgress.value = 0
    batchMessage.value = ''
  }
}

const autoLockCurrentCharacter = async (): Promise<void> => {
  try {
    await autoLockCharacters(projectId)
    await Promise.all([fetchCharacters(), fetchAssetLibrary(), loadWorkbenchStatus()])
    ElMessage.success('已把当前稳定图设为角色参考')
  } catch (cause: unknown) {
    ElMessage.error(errorMessage(cause, '一键定妆失败'))
  }
}

const bindReferenceImage = async (img: ImageCandidate): Promise<void> => {
  const character = selectedStoryboardCharacters.value[0]
  if (!character) {
    ElMessage.warning(t('images.noCharacterForReference'))
    return
  }
  try {
    const variant = await addCharacterReference(character.id, {
      project_id: Number(projectId),
      image_id: img.id,
      file_url: img.file_url,
      file_path: img.file_path,
      label: `${selectedStoryboard.value?.scene_number || ''} ${t('images.referenceImage')}`,
    })
    await lockCharacter(character.id, true)
    const storyboard = selectedStoryboard.value
    if (!storyboard?.id) throw new Error('当前分镜尚未保存')
    await bindAssetVariant(storyboard.id, {
      project_id: Number(projectId),
      asset_type: 'character',
      asset_id: character.id,
      variant_id: variant.id,
      source_scope: assetUnitFor(character.id)?.scope || 'episode',
    })
    await Promise.all([fetchCharacters(), fetchAssetLibrary()])
    await loadWorkbenchStatus()
    if (selectedStoryboard.value) {
      await checkContinuity(projectId, { storyboard_id: selectedStoryboard.value.id, image_id: img.id })
    }
    ElMessage.success(t('images.referenceBound'))
  } catch (cause: unknown) {
    ElMessage.error(errorMessage(cause, t('images.referenceBindFailed')))
  }
}

const handleUploadSuccess = (): void => {
  ElMessage.success('Image uploaded successfully')
  if (selectedStoryboard.value?.id) void fetchImages(selectedStoryboard.value.id)
}

const handleUploadError = (): void => {
  ElMessage.error('Image upload failed')
}

const selectImage = async (img: ImageCandidate): Promise<void> => {
  const storyboard = selectedStoryboard.value
  if (!storyboard?.id) return
  try {
    if (img.stale) {
      await ElMessageBox.confirm(
        '这张候选来自修改前的脚本版本。仍要明确选用它吗？',
        '选用旧版本候选',
        { confirmButtonText: '仍然选用', cancelButtonText: '返回比较', type: 'warning' }
      )
    }
    await selectCandidate(img.id, storyboard.id)
    storyboard.selected_image_id = img.id
    storyboard.selected_image_url = img.url || img.file_url
    ElMessage.success('Image selected')
    await loadWorkbenchStatus()
  } catch (cause: unknown) {
    if (cause !== 'cancel' && cause !== 'close') ElMessage.error(errorMessage(cause, 'Failed to select image'))
  }
}

const shortId = (value: unknown): string => String(value || '').slice(0, 8)

const toggleFavorite = async (img: ImageCandidate): Promise<void> => {
  try {
    const updated = await reviewCandidate(img.id, { favorite: !img.favorite })
    Object.assign(img, updated)
    ElMessage.success(updated.favorite ? '已收藏候选' : '已取消收藏')
  } catch (cause: unknown) {
    ElMessage.error(errorMessage(cause, '收藏状态保存失败'))
  }
}

const toggleArchive = async (img: ImageCandidate): Promise<void> => {
  try {
    if (!img.archived_at) {
      await ElMessageBox.confirm(
        '归档后默认不在候选区显示，但历史和文件会保留。',
        '归档候选',
        { confirmButtonText: '归档', cancelButtonText: '取消', type: 'warning' },
      )
    }
    const restoring = !!img.archived_at
    await reviewCandidate(img.id, { archived: !restoring })
    if (selectedStoryboard.value?.id) await fetchImages(selectedStoryboard.value.id)
    ElMessage.success(restoring ? '候选已恢复' : '候选已归档')
  } catch (cause: unknown) {
    if (cause !== 'cancel' && cause !== 'close') ElMessage.error(errorMessage(cause, '归档操作失败'))
  }
}

const latestCheckForImage = (img: ImageCandidate) => {
  const checks = workbenchStatus.value?.continuity_checks || []
  return checks.find((c) => Number(c.image_id) === Number(img.id))
}

const imageQualityType = (img: ImageCandidate): '' | 'stable' | 'review' | 'risk' => {
  if (img.stale) return 'review'
  const check = latestCheckForImage(img)
  if (!check) return selectedStoryboard.value?.selected_image_id === img.id ? 'stable' : ''
  if (check.status === 'ok') return 'stable'
  if (check.status === 'warn') return 'review'
  return 'risk'
}

const imageQualityLabel = (img: ImageCandidate): string => {
  if (img.stale) return '旧版本'
  const type = imageQualityType(img)
  if (type === 'stable') return '稳定'
  if (type === 'review') return '需复查'
  if (type === 'risk') return '疑似不一致'
  return ''
}

const deleteImage = async (img: ImageCandidate): Promise<void> => {
  try {
    await ElMessageBox.confirm('此操作会删除候选记录和本地文件，不可撤销。优先使用“归档”。', '彻底删除', {
      confirmButtonText: '彻底删除', cancelButtonText: '取消', type: 'error',
    })
    await deleteImageCandidate(img.id)
    ElMessage.success('Image deleted')
    if (selectedStoryboard.value?.id) void fetchImages(selectedStoryboard.value.id)
  } catch (cause: unknown) {
    if (cause !== 'cancel' && cause !== 'close') ElMessage.error(errorMessage(cause, 'Failed to delete image'))
  }
}

onMounted(() => {
  fetchProject()
  fetchStoryboards()
  fetchModels()
  fetchCredit()
  fetchCharacters()
  fetchAssetLibrary()
  loadWorkbenchStatus()
  listSkills('image', true).then((list) => { imageSkills.value = list.filter(s => !s.auto_apply) }).catch(() => {})
  listActiveSkills('image').then((list) => { autoSkills.value = list }).catch(() => {})
})

onUnmounted(() => {
  // 路由切走/组件卸载时关闭仍在运行的任务进度 SSE 连接
  if (stopTracking) { stopTracking(); stopTracking = null }
})
</script>

<style scoped>
.images-page {
  display: flex;
  height: 100vh;
  background-color: var(--bg-base);
  color: var(--text);
}

.left-panel {
  width: 260px;
  border-right: 1px solid var(--separator);
  padding: 16px;
  overflow-y: auto;
  background-color: var(--bg-surface);
}

.right-panel {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  background-color: var(--bg-base);
}

.right-panel.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-title {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: var(--text);
  font-weight: 600;
}

.chapter-filter {
  width: 100%;
  margin-bottom: 12px;
}

.storyboard-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.storyboard-item {
  padding: 10px;
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  border: 2px solid var(--separator);
  cursor: pointer;
  transition: all 0.2s var(--ease-apple);
}

.storyboard-item:hover {
  border-color: var(--primary);
}

.storyboard-item:focus-visible {
  outline: 3px solid var(--primary-soft);
  outline-offset: 2px;
  border-color: var(--primary);
}

.storyboard-item.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.scene-number {
  font-size: 12px;
  font-weight: bold;
  color: var(--primary);
  margin-bottom: 6px;
}

.thumbnail {
  width: 100%;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: 6px;
}

.thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.scene-desc {
  font-size: 11px;
  color: var(--text-second);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.section-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}

.prompt-section {
  margin-bottom: 24px;
}

.character-strip {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.character-variant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
}

.character-variant-label {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.variant-select { width: min(280px, 45%); }
.variant-empty { font-size: 12px; color: var(--text-second); }

.prompt-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.negative-hint {
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(255, 159, 10, 0.08);
  border-left: 3px solid var(--warning);
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.5;
}

.hint-label {
  color: var(--warning);
  font-weight: 600;
  margin-right: 6px;
}

.hint-text {
  color: var(--text-second);
}

.ai-gen-section {
  margin-bottom: 24px;
  padding: 16px;
  background: var(--bg-surface);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
}

.ai-gen-controls {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.advanced-collapse {
  margin-top: 10px;
  border: none;
}

.advanced-collapse :deep(.el-collapse-item__header) {
  height: 34px;
  background: transparent;
  border-bottom: 1px solid var(--separator);
  color: var(--text-second);
  font-size: 12px;
  font-weight: 600;
}

.advanced-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 0;
  background: transparent;
}

.advanced-collapse :deep(.el-collapse-item__content) {
  padding: 12px 0 2px;
}

.advanced-controls {
  padding: 2px 0;
}

.batch-dialog-body {
  display: grid;
  gap: 14px;
}

.batch-dialog-body :deep(.el-segmented) {
  width: 100%;
}

.batch-hint {
  margin: 0;
  color: var(--text-second);
  font-size: 13px;
  line-height: 1.6;
}

.batch-advanced {
  display: grid;
  gap: 10px;
}

.batch-result {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: var(--bg-base);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
}

.auto-skills-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  padding: 6px 10px; margin-top: 8px;
  background: var(--bg-base); border: 1px dashed var(--separator); border-radius: var(--radius-sm);
}
.auto-skills-label { font-size: 11px; color: var(--text-second); font-weight: 600; }

.credit-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-second);
}

.continuity-warnings {
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(255, 159, 10, 0.08);
  border: 1px solid rgba(255, 159, 10, 0.22);
  border-radius: var(--radius-sm);
  color: var(--warning);
  font-size: 12px;
  line-height: 1.5;
}

.stale-alert {
  margin: -6px 0 18px;
}

.storyboard-stale-tag {
  margin-bottom: 6px;
}

.gen-progress {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  border: 1px solid var(--separator);
}

.gen-message {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-second);
}

.upload-section {
  margin-bottom: 24px;
}

.gallery-section {
  margin-bottom: 24px;
}

.gallery-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.gallery-heading .section-label { margin-bottom: 0; }

.image-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}

.gallery-item {
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-surface);
  border: 2px solid var(--separator);
  transition: all 0.2s var(--ease-apple);
  position: relative;
}

.gallery-item.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.gallery-item.archived { opacity: 0.66; }
.gallery-item:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}

.gallery-item img,
.gallery-item :deep(.el-image),
.gallery-item :deep(.el-image__inner) {
  width: 100%;
  height: 140px;
  object-fit: contain;
  background: var(--bg-base);
  cursor: zoom-in;
}

.selected-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 3px 8px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  border-radius: var(--radius-sm);
  z-index: 1;
}

.favorite-badge,
.archived-badge {
  position: absolute;
  right: 6px;
  top: 34px;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: rgba(18, 18, 20, 0.82);
  color: #fff;
  font-size: 11px;
  z-index: 1;
}

.archived-badge { top: 62px; }

.candidate-meta {
  min-height: 34px;
  padding: 7px 10px 0;
  color: var(--text-second);
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.quality-badge {
  position: absolute;
  left: 6px;
  top: 6px;
  padding: 3px 8px;
  font-size: 11px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--separator);
  color: var(--text-second);
  z-index: 1;
  backdrop-filter: blur(12px);
}

.quality-stable {
  color: var(--success);
  border-color: rgba(52, 199, 89, 0.25);
}

.quality-review {
  color: var(--warning);
  border-color: rgba(255, 159, 10, 0.28);
}

.quality-risk {
  color: var(--danger);
  border-color: rgba(255, 59, 48, 0.28);
}

.gallery-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
}

@media (max-width: 760px) {
  .images-page { display: block; height: auto; min-height: 100vh; }
  .left-panel { width: auto; max-height: 260px; border-right: 0; border-bottom: 1px solid var(--separator); }
  .right-panel { padding: 16px; }
  .storyboard-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
  .character-variant-row { align-items: stretch; flex-direction: column; }
  .variant-select { width: 100%; }
  .image-gallery { grid-template-columns: 1fr; }
}
</style>
