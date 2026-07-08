<template>
  <el-dialog
    v-model="visible"
    :title="t('preview.exportSettings')"
    width="600px"
    :close-on-click-modal="false"
    class="export-dialog"
  >
    <!-- 平台快捷预设 -->
    <div class="platform-presets">
      <el-button
        v-for="preset in platformPresets"
        :key="preset.value"
        :type="selectedPlatform === preset.value ? 'primary' : 'default'"
        size="small"
        round
        @click="applyPlatformPreset(preset.value)"
      >
        {{ t(`preview.platform.${preset.value}`) }}
      </el-button>
    </div>

    <el-divider>{{ t('preview.customSettings') }}</el-divider>

    <!-- 手动调整区 -->
    <el-form :model="settings" label-width="110px" label-position="left" class="export-form">
      <el-form-item :label="t('preview.aspectRatio')">
        <el-select v-model="settings.ratio" style="width: 100%" @change="onManualChange">
          <el-option v-for="r in ratioOptions" :key="r.value" :value="r.value" :label="r.label" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('preview.resolution')">
        <el-select v-model="settings.resolution" style="width: 100%" @change="onManualChange">
          <el-option value="720p" label="720P (HD)" />
          <el-option value="1080p" label="1080P (Full HD)" />
          <el-option value="2k" label="2K (QHD)" />
          <el-option value="4k" label="4K (UHD)" />
        </el-select>
        <div class="field-hint">{{ resolutionHint }}</div>
      </el-form-item>

      <el-form-item :label="t('preview.format')">
        <el-select v-model="settings.format" style="width: 100%" @change="onManualChange">
          <el-option value="mp4" label="MP4 (推荐 · 兼容性最好)" />
          <el-option value="mov" label="MOV (苹果生态)" />
          <el-option value="webm" label="WebM (开源 · 体积小)" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('preview.fps')">
        <el-select v-model="settings.fps" style="width: 100%" @change="onManualChange">
          <el-option :value="24" label="24 fps (电影感)" />
          <el-option :value="30" label="30 fps (标准)" />
          <el-option :value="60" label="60 fps (高帧率丝滑)" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('preview.quality')">
        <el-select v-model="settings.quality" style="width: 100%">
          <el-option value="standard" :label="t('preview.qualityStandard')" />
          <el-option value="high" :label="t('preview.qualityHigh')" />
          <el-option value="ultra" :label="t('preview.qualityUltra')" />
        </el-select>
        <div class="field-hint">{{ qualityHint }}</div>
      </el-form-item>
    </el-form>

    <el-divider>导出位置</el-divider>
    <div class="export-location-box">
      <div class="location-row">
        <span class="location-label">成片库默认位置</span>
        <code>{{ exportLocation.library_directory || 'uploads/videos' }}</code>
      </div>
      <p class="field-hint">软件始终会保存一份到成片库，页面和成片库使用 <code>/uploads/videos/...</code> 播放、下载。</p>

      <el-checkbox v-model="settings.copyToCustomDir">
        同时复制一份到本机目录
      </el-checkbox>

      <div class="directory-line" :class="{ disabled: !settings.copyToCustomDir }">
        <el-input
          v-model="settings.exportDirectory"
          :disabled="!settings.copyToCustomDir"
          clearable
          placeholder="例如：~/Desktop/导出视频"
        />
        <el-button :loading="pickingDir" :disabled="!settings.copyToCustomDir" @click="chooseExportDirectory">选择目录</el-button>
        <el-button :loading="checkingDir" :disabled="!settings.copyToCustomDir" @click="verifyExportDirectory">验证/创建</el-button>
      </div>

      <div class="location-options">
        <el-checkbox v-model="settings.setAsDefaultExportDirectory" :disabled="!settings.copyToCustomDir">
          设为以后默认导出副本目录
        </el-checkbox>
        <span v-if="exportLocation.default_directory" class="default-copy">
          当前默认副本目录：{{ exportLocation.default_directory }}
        </span>
      </div>

      <el-alert
        v-if="directoryCheck"
        :type="directoryCheck.ok ? 'success' : 'warning'"
        :closable="false"
        show-icon
        :title="directoryCheck.message || (directoryCheck.ok ? '目录可用' : '目录不可用')"
      />
    </div>

    <div class="estimate-info">
      <el-icon><InfoFilled /></el-icon>
      <span>{{ t('preview.exportFullUnlock') }}</span>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="checkingDir" @click="handleConfirm">{{ t('preview.startExport') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { InfoFilled } from '@element-plus/icons-vue'
import { checkDir, pickDir } from '../api/settings'

const { t } = useI18n()

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  initialRatio: { type: String, default: '16:9' },
  initialFps: { type: Number, default: 30 },
  exportLocation: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const ratioOptions = [
  { value: '16:9', label: '16:9 (横屏)' },
  { value: '9:16', label: '9:16 (竖屏)' },
  { value: '1:1', label: '1:1 (方形)' },
  { value: '4:5', label: '4:5 (竖图)' },
  { value: '4:3', label: '4:3' },
]

// 平台预设：点击自动填充 ratio/resolution/fps/format
const platformPresets = [
  { value: 'custom', ratio: null, resolution: null, fps: null, format: null },
  { value: 'douyin', ratio: '9:16', resolution: '1080p', fps: 30, format: 'mp4' },
  { value: 'wechat', ratio: '9:16', resolution: '1080p', fps: 30, format: 'mp4' },
  { value: 'bilibili', ratio: '16:9', resolution: '1080p', fps: 30, format: 'mp4' },
  { value: 'youtube', ratio: '16:9', resolution: '1080p', fps: 30, format: 'mp4' },
]

const selectedPlatform = ref('custom')

const settings = reactive({
  ratio: props.initialRatio || '16:9',
  resolution: '1080p',
  format: 'mp4',
  fps: props.initialFps || 30,
  quality: 'high',
  copyToCustomDir: false,
  exportDirectory: '',
  setAsDefaultExportDirectory: false,
})

const pickingDir = ref(false)
const checkingDir = ref(false)
const directoryCheck = ref(null)

function initExportDirectory() {
  const saved = props.exportLocation?.default_directory || ''
  settings.copyToCustomDir = !!saved
  settings.exportDirectory = saved
  settings.setAsDefaultExportDirectory = false
  directoryCheck.value = null
}

// 弹窗打开时用最新的项目比例/帧率初始化
watch(() => props.modelValue, (open) => {
  if (open) {
    settings.ratio = props.initialRatio || '16:9'
    settings.fps = props.initialFps || 30
    selectedPlatform.value = 'custom'
    initExportDirectory()
  }
})

function applyPlatformPreset(value) {
  selectedPlatform.value = value
  const p = platformPresets.find((x) => x.value === value)
  if (!p || value === 'custom') return
  if (p.ratio) settings.ratio = p.ratio
  if (p.resolution) settings.resolution = p.resolution
  if (p.fps) settings.fps = p.fps
  if (p.format) settings.format = p.format
}

// 手动改任意字段 → 取消平台高亮（变为自定义）
function onManualChange() {
  selectedPlatform.value = 'custom'
}

// 分辨率档位 → 实际像素提示（与后端 resolveResolutionByTier 算法一致）
const TIER_BASE = { '720p': 1280, '1080p': 1920, '2k': 2560, '4k': 3840 }
const resolutionHint = computed(() => {
  const base = TIER_BASE[settings.resolution] || 1920
  const parts = String(settings.ratio).split(':')
  const wr = parseFloat(parts[0]) || 16
  const hr = parseFloat(parts[1]) || 9
  const even = (n) => { n = Math.round(n); return n % 2 === 0 ? n : n + 1 }
  let w, h
  if (Math.abs(wr - hr) < 0.01) { w = h = even(base * 0.5625) }
  else if (wr > hr) { w = even(base); h = even(base * (hr / wr)) }
  else { w = even(base * (wr / hr)); h = even(base) }
  return t('preview.resolutionHint', { w, h })
})

const qualityHint = computed(() => {
  const map = {
    standard: t('preview.qualityStandardHint'),
    high: t('preview.qualityHighHint'),
    ultra: t('preview.qualityUltraHint'),
  }
  return map[settings.quality] || ''
})

async function chooseExportDirectory() {
  if (!settings.copyToCustomDir) return
  pickingDir.value = true
  try {
    const picked = await pickDir()
    if (picked?.path) {
      settings.exportDirectory = picked.path
      directoryCheck.value = { ok: true, message: '目录已选择并可写', path: picked.path }
      ElMessage.success('已选择导出目录')
    }
  } catch (e) {
    ElMessage.warning(e?.response?.data?.message || e.message || '无法打开目录选择器，请手动输入目录路径')
  } finally {
    pickingDir.value = false
  }
}

async function verifyExportDirectory({ silent = false } = {}) {
  if (!settings.copyToCustomDir) {
    directoryCheck.value = null
    return true
  }
  const dir = String(settings.exportDirectory || '').trim()
  if (!dir) {
    directoryCheck.value = { ok: false, message: '请先填写或选择导出目录' }
    if (!silent) ElMessage.warning('请先填写或选择导出目录')
    return false
  }
  checkingDir.value = true
  try {
    const result = await checkDir(dir, true)
    directoryCheck.value = result
    if (result?.ok && result.path) settings.exportDirectory = result.path
    if (!result?.ok) {
      if (!silent) ElMessage.warning(result?.message || '目录不可用')
      return false
    }
    if (!silent) ElMessage.success('目录可用')
    return true
  } catch (e) {
    directoryCheck.value = { ok: false, message: e?.response?.data?.message || e.message || '目录验证失败' }
    if (!silent) ElMessage.error(directoryCheck.value.message)
    return false
  } finally {
    checkingDir.value = false
  }
}

async function handleConfirm() {
  const directoryOk = await verifyExportDirectory({ silent: true })
  if (!directoryOk) return
  // 传出导出设置（与后端 options 字段对齐）。架构预留付费门控：
  // 以后在此处或父组件按 plan 校验 resolution/format 上限，本期全解锁。
  emit('confirm', {
    ratio: settings.ratio,
    resolution: settings.resolution,
    format: settings.format,
    fps: settings.fps,
    quality: settings.quality,
    skipExternalExportCopy: !settings.copyToCustomDir,
    exportDirectory: settings.copyToCustomDir ? settings.exportDirectory : '',
    setAsDefaultExportDirectory: settings.copyToCustomDir && settings.setAsDefaultExportDirectory,
  })
  visible.value = false
}
</script>

<style scoped>
.platform-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}
.export-form {
  margin-top: 4px;
}
.field-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  margin-top: 2px;
}
.export-location-box {
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-extra-light);
}
.location-row {
  display: grid;
  gap: 5px;
}
.location-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.export-location-box code {
  padding: 5px 7px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.directory-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
}
.directory-line.disabled {
  opacity: 0.68;
}
.location-options {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.default-copy {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.estimate-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--el-color-primary-light-9);
  border-radius: 6px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
@media (max-width: 640px) {
  .directory-line {
    grid-template-columns: 1fr;
  }
}
</style>
