<template>
  <div class="settings-page">
    <h1 class="text-gradient">{{ $t('settings.title') }}</h1>
    <el-alert
      v-if="health.needs_setup"
      type="warning"
      :closable="false"
      show-icon
      class="first-setup-alert"
      :title="health.setup_message || '首次使用请在「模型路由」中配置至少一个文案模型和一个生图模型的 API Key。'"
    />
    <el-tabs v-model="activeTab" class="settings-tabs">
      <!-- 常规 -->
      <el-tab-pane :label="$t('settings.tabGeneral')" name="general">
        <el-form label-width="120px" class="set-form">
          <el-form-item :label="$t('settings.language')">
            <el-select :model-value="locale" style="width: 220px" @change="changeLocale">
              <el-option :label="$t('settings.langZh')" value="zh" />
              <el-option :label="$t('settings.langEn')" value="en" />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('settings.defaultStyle')">
            <el-select v-model="form.defaultStyle" style="width: 220px">
              <el-option v-for="s in STYLES" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('settings.defaultVoice')">
            <el-select v-model="form.defaultVoice" style="width: 220px">
              <el-option v-for="v in VOICES" :key="v.value" :label="v.label" :value="v.value" />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('settings.defaultDuration')">
            <el-input v-model="form.defaultDuration" style="width: 220px" :placeholder="$t('settings.durationPlaceholder')" />
          </el-form-item>
          <el-form-item :label="$t('settings.defaultImageModel')">
            <el-select v-model="form.defaultImageModel" style="width: 220px">
              <el-option label="自动（智能推荐）" value="auto" />
              <el-option v-for="m in imageModelOptions" :key="m.key" :label="m.label" :value="m.key" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="save">{{ $t('settings.saveGeneral') }}</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- API 接口 -->
      <el-tab-pane :label="$t('settings.tabApi')" name="api">
        <el-card class="api-card" shadow="never">
          <template #header><span class="card-title">{{ $t('settings.apiUnifiedTitle') }}</span></template>
          <el-alert type="info" :closable="false" show-icon :title="$t('settings.apiUnifiedHint')" />
          <div class="api-shortcuts">
            <el-button type="primary" @click="activeTab = 'models'">{{ $t('settings.goModelCredentials') }}</el-button>
            <el-button :loading="testing.deepseek" @click="test('deepseek')">{{ $t('settings.testDeepseekStored') }}</el-button>
            <el-button :loading="testing.pollinations" @click="test('pollinations')">{{ $t('settings.testPollinations') }}</el-button>
          </div>
          <div class="api-test-results">
            <el-tag v-if="testResult.deepseek" :type="testResult.deepseek.ok ? 'success' : 'danger'">
              DeepSeek：{{ testResult.deepseek.message }}
            </el-tag>
            <el-tag v-if="testResult.pollinations" :type="testResult.pollinations.ok ? 'success' : 'danger'">
              Pollinations：{{ testResult.pollinations.message }}
            </el-tag>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- 存储 -->
      <el-tab-pane :label="$t('settings.tabStorage')" name="storage">
        <el-form label-width="120px" class="set-form">
          <el-form-item :label="$t('settings.storageDir')">
            <el-input v-model="form.uploadDir" style="width: 420px"
              :placeholder="$t('settings.storageDirPlaceholder')" />
            <el-button :loading="checkingDir" style="margin-left: 8px" @click="checkDirNow">{{ $t('settings.verify') }}</el-button>
          </el-form-item>
          <el-form-item v-if="dirCheckResult">
            <el-tag :type="dirCheckResult.ok ? 'success' : 'danger'">{{ dirCheckResult.message }}</el-tag>
          </el-form-item>
          <el-form-item>
            <el-alert type="warning" :closable="false" show-icon
              :title="$t('settings.storageWarning')" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="save">{{ $t('settings.saveStorage') }}</el-button>
          </el-form-item>
        </el-form>

        <el-divider />
        <h3>{{ $t('settings.storageStats') }}</h3>
        <div v-if="storage" class="storage-stats">
          <p class="hint">{{ $t('settings.rootDir') }}：{{ storage.root }}</p>
          <el-table :data="storageRows" size="small" style="max-width: 520px">
            <el-table-column prop="label" :label="$t('settings.colType')" width="120" />
            <el-table-column prop="count" :label="$t('settings.colCount')" width="100" />
            <el-table-column prop="sizeText" :label="$t('settings.colSize')" />
          </el-table>
          <p class="total">{{ $t('settings.totalLine', { size: fmtSize(storage.totalSize), count: storage.totalFiles }) }}</p>
          <el-button size="small" :loading="cleaning" @click="doCleanTemp">{{ $t('settings.cleanTemp') }}</el-button>
          <el-button size="small" text @click="loadStorage">{{ $t('settings.refresh') }}</el-button>
        </div>
      </el-tab-pane>

      <!-- 引擎 -->
      <el-tab-pane :label="$t('settings.tabEngine')" name="engine">
        <el-form label-width="140px" class="set-form">
          <el-form-item :label="$t('settings.ffmpegPath')">
            <el-input v-model="form.ffmpegPath" style="width: 420px"
              :placeholder="$t('settings.ffmpegPlaceholder')" />
          </el-form-item>
          <el-form-item :label="$t('settings.pollTimeout')">
            <el-input-number v-model="form.pollinations.timeout" :min="5000" :max="60000" :step="1000" />
          </el-form-item>
          <el-form-item :label="$t('settings.pollRetries')">
            <el-input-number v-model="form.pollinations.retries" :min="1" :max="6" />
          </el-form-item>
          <el-form-item label="旁白衔接节奏">
            <el-switch v-model="form.pacing.tightPace" active-text="紧凑（推荐）" inactive-text="标准" />
            <p class="hint" style="margin:6px 0 0">紧凑：每句旁白之间只留极短停顿（{{ form.pacing.tightTail }}s），消除"明显停顿才下一句"的拖沓感。标准：保留较长呼吸停顿（{{ form.pacing.standardTail }}s，旧版本行为）。设置对一键成片与「智能时长建议」同时生效。</p>
          </el-form-item>
          <el-form-item>
            <el-alert type="info" :closable="false" show-icon
              :title="$t('settings.ffmpegRestartHint')" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="save">{{ $t('settings.saveEngine') }}</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 健康检查 -->
      <el-tab-pane :label="$t('settings.tabHealth')" name="health">
        <div class="health-box">
          <div class="health-head">
            <el-tag :type="overallTagType" size="large" effect="dark">
              {{ overallText }}
            </el-tag>
            <span v-if="health.checked_at" class="health-time">
              {{ $t('settings.checkedAt', { time: new Date(health.checked_at).toLocaleTimeString() }) }}
            </span>
            <el-button size="small" :loading="healthLoading" @click="loadHealth">
              {{ $t('settings.recheck') }}
            </el-button>
          </div>
          <el-table :data="health.checks || []" style="width:100%;margin-top:12px">
            <el-table-column label="" width="56">
              <template #default="{ row }">
                <el-icon v-if="row.status==='ok'" color="#34c759"><CircleCheck /></el-icon>
                <el-icon v-else-if="row.status==='warn'" color="#ff9f0a"><Warning /></el-icon>
                <el-icon v-else color="#ff3b30"><CircleClose /></el-icon>
              </template>
            </el-table-column>
            <el-table-column prop="label" :label="$t('settings.colCheckItem')" width="220" />
            <el-table-column prop="message" :label="$t('settings.colStatus')" />
          </el-table>
          <el-alert v-if="overall==='ok'" type="success" :closable="false" show-icon
            style="margin-top:12px" :title="$t('settings.allOk')" />
          <el-alert v-else-if="overall==='warn'" type="warning" :closable="false" show-icon
            style="margin-top:12px" :title="$t('settings.partialWarn')" />
          <el-alert v-else type="error" :closable="false" show-icon
            style="margin-top:12px" :title="$t('settings.hasError')" />

          <!-- AI 服务接入明细（第四期）：各 provider 配置/用量 -->
          <template v-if="providerItems.length">
            <el-divider content-position="left">{{ $t('settings.providerDetail') }}</el-divider>
            <div style="margin-bottom:8px">
              <el-button size="small" @click="doResetUsage">{{ $t('settings.resetUsage') }}</el-button>
            </div>
            <el-table :data="providerItems" style="width:100%" size="small">
              <el-table-column label="" width="44">
                <template #default="{ row }">
                  <el-icon v-if="row.status==='ok'" color="#34c759"><CircleCheck /></el-icon>
                  <el-icon v-else-if="row.status==='warn'" color="#ff9f0a"><Warning /></el-icon>
                  <el-icon v-else color="#ff3b30"><CircleClose /></el-icon>
                </template>
              </el-table-column>
              <el-table-column prop="kindLabel" :label="$t('settings.colCapability')" width="80" />
              <el-table-column prop="label" :label="$t('settings.colService')" width="170" />
              <el-table-column :label="$t('settings.colConfig')" width="90">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.configured ? 'success' : 'info'" effect="plain">
                    {{ row.configured ? $t('settings.configured') : $t('settings.notConfigured') }}
                  </el-tag>
                  <el-tag v-if="row.free" size="small" type="success" effect="plain" style="margin-left:4px">{{ $t('settings.free') }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="$t('settings.colUsage')" width="130">
                <template #default="{ row }">
                  <span v-if="row.usage">{{ row.usage.ok }} / {{ row.usage.fail }}
                    <span v-if="row.usage.success_rate!=null" style="color:#9ca3af">（{{ row.usage.success_rate }}%）</span>
                  </span>
                  <span v-else style="color:#9ca3af">—</span>
                </template>
              </el-table-column>
              <el-table-column :label="$t('settings.colDesc')">
                <template #default="{ row }">
                  <span>{{ row.message }}</span>
                  <span v-if="row.last_error" class="history-error">
                    {{ $t('settings.lastFailure') }}：{{ row.last_error }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </div>
      </el-tab-pane>

      <!-- 模型路由 -->
      <el-tab-pane :label="$t('settings.tabModels')" name="models">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px"
          :title="$t('settings.modelRouteHint')" />

        <el-collapse class="guide-collapse" style="margin-bottom:16px">
          <el-collapse-item :title="$t('settings.guideTitle')" name="guide">
            <p class="hint" style="margin:0 0 10px">{{ $t('settings.guideIntro') }}</p>
            <div v-for="g in guideKinds" :key="g.kind" class="guide-block">
              <div class="guide-kind">{{ g.label }}</div>
              <div v-for="p in g.items" :key="p.key" class="guide-item">
                <span class="guide-name">{{ p.label }}</span>
                <el-tag v-if="p.free" size="small" type="success" effect="plain">{{ $t('settings.free') }}</el-tag>
                <el-tag v-else size="small" type="warning" effect="plain">{{ $t('settings.guidePaid') }}</el-tag>
                <el-tag v-if="p.configured" size="small" type="primary" effect="plain">{{ $t('settings.guideConfigured') }}</el-tag>
                <span class="guide-note">{{ p.note }}</span>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>

        <el-divider content-position="left">{{ $t('settings.stageRoute') }}</el-divider>
        <el-form label-width="110px" class="stage-form">
          <el-form-item :label="$t('settings.stageScript')">
            <div class="stage-row">
              <el-select v-model="stage.script.provider" style="width:160px" @change="onStageProviderChange('script')">
                <el-option v-for="p in llmProviders" :key="p.key" :label="p.label + (p.configured ? '' : $t('settings.notConfiguredParen'))" :value="p.key" />
              </el-select>
              <el-select v-model="stage.script.model" style="width:200px" :placeholder="$t('settings.modelPlaceholder')">
                <el-option v-for="m in modelsOf('script')" :key="m" :label="m" :value="m" />
              </el-select>
              <el-button size="small" @click="doSaveStage">{{ $t('settings.saveRoute') }}</el-button>
              <span class="capability-hint">{{ capabilitySummary('script') }}</span>
            </div>
          </el-form-item>
          <el-form-item :label="$t('settings.stageImage')">
            <div class="stage-row">
              <el-select v-model="stage.image.provider" style="width:160px" @change="onImageProviderChange">
                <el-option v-for="p in imageProviders" :key="p.key" :label="p.label" :value="p.key" />
              </el-select>
              <el-select v-model="stage.image.model" style="width:200px" :placeholder="$t('settings.modelPlaceholder')">
                <el-option v-for="m in imageModelsOf()" :key="m" :label="m" :value="m" />
              </el-select>
              <el-button size="small" @click="doSaveStage">{{ $t('settings.saveRoute') }}</el-button>
              <span class="capability-hint">{{ capabilitySummary('image') }}</span>
            </div>
          </el-form-item>
          <el-form-item label="备用生图模型">
            <div class="stage-row" style="flex-wrap:wrap">
              <el-select v-model="imageChain" multiple filterable style="min-width:360px;flex:1"
                placeholder="可多选；主模型失败时按顺序自动切换，任一可用即成图">
                <el-option v-for="o in allImageModelOptions" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
              <el-button size="small" @click="doSaveStage">{{ $t('settings.saveRoute') }}</el-button>
            </div>
            <p class="hint" style="margin:6px 0 0">主模型生成失败（如免费额度用尽 HTTP 402、超时）会自动切到这里配置的备用模型，全部失败才用占位图。强烈建议至少配 2 个不同来源的模型（如 Pollinations Turbo + 智谱 CogView），换电脑也能稳定出图。</p>
          </el-form-item>
          <el-form-item :label="$t('settings.stageVideo')">
            <div class="stage-row">
              <el-select v-model="stage.video.provider" style="width:160px" @change="onVideoProviderChange">
                <el-option v-for="p in videoProviders" :key="p.key" :label="p.label" :value="p.key" />
              </el-select>
              <el-select v-model="stage.video.model" style="width:200px" :placeholder="$t('settings.modelPlaceholder')" :disabled="stage.video.provider === 'static'">
                <el-option v-for="m in videoModelsOf()" :key="m" :label="m" :value="m" />
              </el-select>
              <el-button size="small" @click="doSaveStage">{{ $t('settings.saveRoute') }}</el-button>
              <span class="capability-hint">{{ capabilitySummary('video') }}</span>
            </div>
          </el-form-item>
          <el-form-item :label="$t('settings.stageVoice')">
            <div class="stage-row">
              <el-select v-model="stage.voice.provider" style="width:160px" @change="onVoiceProviderChange">
                <el-option v-for="p in voiceProviders" :key="p.key" :label="p.label" :value="p.key" />
              </el-select>
              <el-select v-model="stage.voice.model" style="width:200px" :placeholder="$t('settings.modelPlaceholder')" :disabled="stage.voice.provider === 'edge'">
                <el-option v-for="m in voiceModelsOf()" :key="m" :label="m" :value="m" />
              </el-select>
              <el-button size="small" @click="doSaveStage">{{ $t('settings.saveRoute') }}</el-button>
              <span class="capability-hint">{{ capabilitySummary('voice') }}</span>
            </div>
          </el-form-item>
          <p class="hint" style="margin-left:110px">{{ $t('settings.routeFootHint') }}</p>
        </el-form>

        <el-divider content-position="left">{{ $t('settings.platformCred') }}</el-divider>
        <div class="cred-box">
          <ProviderCredentialRow
            v-for="p in credentialProviders"
            :key="p.key"
            :provider="p"
            :credential="cred[p.key] || {}"
            :testing="!!provTesting[p.key]"
            :result="provTestResult[p.key] || null"
            @update-field="updateCredentialField(p.key, $event)"
            @save="doSaveCred(p.key)"
            @clear="doClearCred(p.key)"
            @test="doTest(p.key)"
          />
        </div>
      </el-tab-pane>

      <!-- 关于 -->
      <el-tab-pane :label="$t('settings.tabAbout')" name="about">
        <div class="about-box">
          <p><strong>{{ $t('settings.appName') }}</strong></p>
          <p class="hint">{{ $t('settings.techStack') }}</p>
          <p class="hint">{{ $t('settings.aiServices') }}</p>
          <p class="hint">{{ $t('settings.configFile') }}：{{ runtimeSettingsFile || '-' }}</p>
        </div>

        <el-divider content-position="left">{{ $t('settings.appInfo') }}</el-divider>
        <div class="about-info">
          <div class="info-line">
            <span class="info-key">{{ $t('settings.currentVersion') }}</span>
            <span class="info-val">v{{ appVersion }}</span>
          </div>
          <div class="info-line">
            <span class="info-key">{{ $t('settings.author') }}</span>
            <span class="info-val">{{ $t('settings.authorName') }}</span>
          </div>
          <div class="about-actions">
            <el-button size="small" @click="doCheckUpdate" :loading="updateChecking">{{ $t('settings.checkUpdate') }}</el-button>
            <el-button size="small" @click="showDiagnostics">{{ $t('settings.diagnostics') }}</el-button>
            <el-button size="small" @click="showFeedback">{{ $t('settings.feedback') }}</el-button>
            <el-button size="small" text @click="showAgreement">{{ $t('settings.userAgreement') }}</el-button>
            <el-button size="small" text @click="showPrivacy">{{ $t('settings.privacyPolicy') }}</el-button>
          </div>
        </div>

        <el-divider content-position="left">{{ $t('settings.backupMigration') }}</el-divider>
        <div class="backup-box">
          <div class="backup-row">
            <div class="backup-label">
              <strong>{{ $t('settings.fullBackup') }}</strong>
              <span class="hint">{{ $t('settings.fullBackupDesc') }}</span>
            </div>
            <div class="backup-actions">
              <el-button size="small" type="primary" :loading="backupLoading" @click="doBackup">{{ $t('settings.exportBackup') }}</el-button>
              <el-button size="small" :loading="restoreLoading" @click="pickRestore">{{ $t('settings.restoreBackup') }}</el-button>
            </div>
          </div>
          <div class="backup-row">
            <div class="backup-label">
              <strong>{{ $t('settings.configOnly') }}</strong>
              <span class="hint">{{ $t('settings.configOnlyDesc') }}</span>
            </div>
            <div class="backup-actions">
              <el-tag size="small" type="success" effect="plain">{{ $t('settings.maskKeys') }}</el-tag>
              <el-button size="small" @click="doExportConfig">{{ $t('settings.exportConfig') }}</el-button>
              <el-button size="small" @click="pickImportConfig">{{ $t('settings.importConfig') }}</el-button>
            </div>
          </div>
          <p class="warn-hint">{{ $t('settings.restoreWarn') }}</p>
        </div>
        <input ref="fileInput" type="file" accept=".aigcbak,.json" style="display:none" @change="onFilePicked" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import type { ModelDescriptor } from '@aigc-video/contracts'
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { useI18n } from 'vue-i18n'
import { persistLocale, type SupportedLocale } from '../locales'
import { CircleCheck, Warning, CircleClose } from '@element-plus/icons-vue'
import ProviderCredentialRow from '../components/ProviderCredentialRow.vue'
import {
  getSettings, getPresets, saveDefaults, saveSettings, clearProviderKey, testApi,
  checkDir, getStorageStats, cleanTemp,
  exportConfig, importConfig, getBackup, restoreBackup, getHealth,
  getVersion, getDiagnostics, checkUpdate,
  BackupEnvelopeSchema, ProviderHealthItemSchema,
  type ApiTestResult, type DeepseekPreset, type DirectoryCheckResult,
  type HealthData, type JsonObject, type SettingsData, type StorageStats,
} from '../api/settings'
import {
  getProviders, getModelCatalog, getImageModels, getStageModels, saveStageModels, saveCredentials,
  testProvider, resetUsage, type ImageModelOption, type ProviderGroups, type ProviderTestResult,
  type ProviderView, type StageSelection,
} from '../api/providers'

type StageKey = 'script' | 'image' | 'video' | 'voice'
type GuideKind = 'llm' | 't2i' | 't2v' | 'tts'
type StageRoutes = Record<StageKey, StageSelection>
type CredentialField = 'apiKey' | 'baseUrl' | 'accessKey' | 'secretKey' | 'appId' | 'cluster'
type CredentialDraft = Partial<Record<CredentialField, string>>

interface SelectOption { value: string; label: string }
interface ImageModelSelectOption { key: string; label: string }

function errorMessage(cause: unknown, fallback = ''): string {
  return cause instanceof Error ? cause.message : fallback || String(cause)
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const STYLES = computed(() => [
  { label: t('settings.styleRealistic'), value: '写实' },
  { label: t('settings.styleAnime'), value: '动漫' },
  { label: t('settings.styleCyberpunk'), value: 'cyberpunk' },
  { label: t('settings.styleInk'), value: 'ink-wash' },
  { label: t('settings.styleMinimal'), value: 'minimal' },
  { label: t('settings.styleRetro'), value: 'retro' },
])
const VOICES = computed(() => [
  { label: t('settings.voiceXiaoxiao'), value: 'xiaoxiao' },
  { label: t('settings.voiceYunyang'), value: 'yunyang' },
  { label: t('settings.voiceYunxi'), value: 'yunxi' },
  { label: t('settings.voiceXiaomo'), value: 'xiaomo' },
  { label: t('settings.voiceXiaohan'), value: 'xiaohan' },
  { label: t('settings.voiceYunfeng'), value: 'yunfeng' },
])

const activeTab = ref('general')
const saving = ref(false)

// ⑥ 关于页：版本 / 检查更新
const appVersion = ref('1.0.0')
const updateChecking = ref(false)

// —— 界面语言切换 ——
const { t, locale } = useI18n()
function changeLocale(val: SupportedLocale): void {
  locale.value = val
  persistLocale(val)
  ElMessage.success(t('settings.langSwitched'))
  // 重新构建依赖 t() 的 provider 下拉标签（这些标签在 loadModels 中一次性生成并缓存）
  loadModels()
}
const checkingDir = ref(false)
const cleaning = ref(false)
const presetIdx = ref(0)
const presets = ref<DeepseekPreset[]>([])
const storage = ref<StorageStats | null>(null)
const runtimeSettingsFile = ref('')

// —— 健康检查 ——
const health = ref<HealthData>({ overall: 'ok', checks: [], checked_at: 0 })
const healthLoading = ref(false)
const overall = computed(() => health.value.overall || 'ok')
const overallText = computed(() => ({ ok: t('settings.statusOk'), warn: t('settings.statusWarn'), error: t('settings.statusError') })[overall.value])
const overallTagType = computed(() => ({ ok: 'success', warn: 'warning', error: 'danger' } as const)[overall.value])

async function loadHealth() {
  healthLoading.value = true
  try {
    health.value = await getHealth()
  } catch (cause: unknown) {
    ElMessage.error(t('settings.healthFailed', { msg: errorMessage(cause, t('settings.backendUnreachable')) }))
  } finally {
    healthLoading.value = false
  }
}

// AI 服务接入明细（第四期）：从 health 的 providers 检查项取 items
const providerItems = computed(() => {
  const p = (health.value.checks || []).find((c) => c.key === 'providers')
  const rawItems = isJsonObject(p?.metrics) ? p.metrics.items : undefined
  const parsed = ProviderHealthItemSchema.array().safeParse(rawItems)
  return parsed.success ? parsed.data : []
})
async function doResetUsage() {
  try {
    await resetUsage()
    ElMessage.success(t('settings.usageReset'))
    await loadHealth()
  } catch (cause: unknown) { ElMessage.error(t('settings.resetFailed', { msg: errorMessage(cause) })) }
}

// —— 模型路由（升级方案 v3 第一期 LLM + 第二期 配图）——
const llmProviders = ref<ProviderView[]>([])
const imageProviders = ref<ProviderView[]>([]) // 配图阶段可选 provider（本地 + 云端 t2i）
const imageModelOptions = ref<ImageModelSelectOption[]>([]) // 常规设置「默认图片模型」下拉：与一键成片同源（/ai/image-models）
const videoProviders = ref<ProviderView[]>([]) // 视频阶段可选 provider（静图运镜 + 云端 t2v）
const voiceProviders = ref<ProviderView[]>([]) // 配音阶段可选 provider（Edge 本地 + 云端 tts）
const volcanoTtsProviders = ref<ProviderView[]>([]) // 火山豆包语音（需 AppID+Token+Cluster 独立凭证）
const klingProviders = ref<ProviderView[]>([]) // 可灵视频（需 Access Key + Secret Key 独立 JWT 鉴权）
const credentialProviders = computed(() => {
  const seen = new Set<string>()
  return [...llmProviders.value, ...volcanoTtsProviders.value, ...klingProviders.value]
    .filter((provider) => provider?.key && !seen.has(provider.key) && seen.add(provider.key))
})
const guideGroups = ref<ProviderGroups>({ llm: [], t2i: [], t2v: [], tts: [] }) // 选型指南原始分组数据（含 free/note），供分级展示
const modelCatalog = ref<ModelDescriptor[]>([]) // 静态能力；运行时可用性继续由 Provider health 单独表达
const stage = reactive<StageRoutes>({ script: { provider: 'deepseek', model: '' }, image: { provider: 'pollinations', model: 'flux' }, video: { provider: 'static', model: '' }, voice: { provider: 'edge', model: '' } })
// 备用生图模型链（v1.6.4）：本地 key（flux/turbo…）或 'provider__model' 云端规格
const imageChain = ref<string[]>([])
// 所有可选生图模型（本地 + 云端 t2i），供备用链多选
const allImageModelOptions = computed(() => {
  const opts: SelectOption[] = []
  // 档位标签：帮助用户一眼区分推荐主力与最后保底（v1.6.5）
  const tierOf = (key: string, m: string): string => {
    if (key === 'cogview' && m === 'cogview-3-flash') return '⭐推荐'
    if (key === 'cogview') return '次选'
    if (key === 'pollinations' && (m === 'flux' || m === 'turbo' || m === 'flux-realism')) return '保底'
    return ''
  }
  for (const p of imageProviders.value) {
    for (const m of (p.models || [])) {
      const value = p.key === 'pollinations' ? m : `${p.key}__${m}`
      const tier = tierOf(p.key, m)
      opts.push({ value, label: `${p.label} · ${m}${tier ? ` （${tier}）` : ''}` })
    }
  }
  return opts
})

// 模型选型指南：把 4 类 provider 整理成分级清单（免费档优先排前，便于用户按需选型）
const guideKinds = computed(() => {
  const kindLabels: Record<GuideKind, string> = {
    llm: t('settings.guideKindLlm'),
    t2i: t('settings.guideKindT2i'),
    t2v: t('settings.guideKindT2v'),
    tts: t('settings.guideKindTts'),
  }
  const order: GuideKind[] = ['llm', 't2i', 't2v', 'tts']
  return order.map((kind) => {
    const list = (guideGroups.value[kind] || []).slice()
    // 免费档排前，已配置次之
    list.sort((a, b) => (b.free ? 1 : 0) - (a.free ? 1 : 0) || (b.configured ? 1 : 0) - (a.configured ? 1 : 0))
    return { kind, label: kindLabels[kind] || kind, items: list }
  }).filter((g) => g.items.length)
})
const cred = reactive<Record<string, CredentialDraft>>({})
const provTesting = reactive<Record<string, boolean>>({})
const provTestResult = reactive<Record<string, ProviderTestResult | undefined>>({})

function updateCredentialField(key: string, { field, value }: { field: CredentialField; value: string }): void {
  credentialOf(key)[field] = value
}

function modelsOf(stageKey: StageKey): string[] {
  const sel = stage[stageKey]
  if (!sel) return []
  const p = llmProviders.value.find((x) => x.key === sel.provider)
  return p ? p.models : []
}
function onStageProviderChange(stageKey: StageKey): void {
  const list = modelsOf(stageKey)
  const first = list[0]
  if (first && !list.includes(stage[stageKey].model)) stage[stageKey].model = first
}
// 配图阶段：provider → 模型列表
function imageModelsOf(): string[] {
  const p = imageProviders.value.find((x) => x.key === stage.image.provider)
  return p ? p.models : []
}
function onImageProviderChange(): void {
  const list = imageModelsOf()
  const first = list[0]
  if (first && !list.includes(stage.image.model)) stage.image.model = first
}
// 视频阶段：provider → 模型列表（static 无模型）
function videoModelsOf(): string[] {
  const p = videoProviders.value.find((x) => x.key === stage.video.provider)
  return p ? (p.models || []) : []
}
function onVideoProviderChange(): void {
  const list = videoModelsOf()
  if (stage.video.provider === 'static') { stage.video.model = ''; return }
  const first = list[0]
  if (first && !list.includes(stage.video.model)) stage.video.model = first
}
// 配音阶段：provider → 模型列表（edge 无模型）
function voiceModelsOf(): string[] {
  const p = voiceProviders.value.find((x) => x.key === stage.voice.provider)
  return p ? (p.models || []) : []
}
function onVoiceProviderChange(): void {
  const list = voiceModelsOf()
  if (stage.voice.provider === 'edge') { stage.voice.model = ''; return }
  const first = list[0]
  if (first && !list.includes(stage.voice.model)) stage.voice.model = first
}

function selectedCatalogModel(stageKey: StageKey): ModelDescriptor | null {
  const selected = stage[stageKey]
  if (!selected?.provider) return null
  return modelCatalog.value.find((item) => item.provider === selected.provider && (
    item.model === selected.model
    || (!selected.model && ((selected.provider === 'static' && item.model === 'static') || (selected.provider === 'edge' && item.model === 'edge')))
  )) || null
}

function capabilitySummary(stageKey: StageKey): string {
  const selected = selectedCatalogModel(stageKey)
  if (!selected) return t('settings.capUnknown')
  const caps = selected.capabilities || {}
  const labels = []
  if (caps.structured_output) labels.push(t('settings.capStructured'))
  if (caps.image_to_video) labels.push(t('settings.capI2v'))
  if (caps.negative_prompt) labels.push(t('settings.capNegative'))
  if (caps.seed) labels.push(t('settings.capSeed'))
  if (caps.async) labels.push(t('settings.capAsync'))
  if (stageKey === 'image' && caps.reference_image !== true) labels.push(t('settings.capReferenceText'))
  return labels.length ? labels.join(' · ') : t('settings.capBasic')
}

async function loadModels() {
  try {
    const [groups, catalog, sm, imgModels] = await Promise.all([
      getProviders(), getModelCatalog(), getStageModels(), getImageModels(),
    ])
    modelCatalog.value = catalog
    // 选型指南：保留原始分组（含 free/note），供「模型选型指南」面板分级展示
    guideGroups.value = groups
    llmProviders.value = groups.llm
    // 常规设置「默认图片模型」下拉：加载实际后端可用模型（与一键成片同源）
    imageModelOptions.value = imgModels
      .filter((model: ImageModelOption) => model.cloud !== true || model.configured) // 过滤掉未配置的云端模型
      .map((model) => ({ key: model.key, label: model.label }))
    for (const p of llmProviders.value) {
      const draft = credentialOf(p.key, { apiKey: '', baseUrl: '' })
      if (!draft.baseUrl && p.runtimeBaseUrl) draft.baseUrl = p.runtimeBaseUrl
      if (!(p.key in provTesting)) provTesting[p.key] = false
    }
    // 配图 provider：Pollinations（本地免费）+ 全部云端 t2i（含未配置，未配置加标记提示去填 Key）
    const t2i = groups.t2i || []
    imageProviders.value = [
      { key: 'pollinations', label: t('settings.pollinationsLabel'), models: ['flux', 'flux-realism', 'turbo'], configured: true },
      ...t2i.map((p) => ({ key: p.key, label: p.label + (p.free ? t('settings.freeTierParen') : t('settings.paidTierParen')) + (p.configured ? '' : t('settings.notConfiguredParen')), models: p.models, configured: p.configured })),
    ]
    // 视频 provider：静图运镜（本地默认）+ 全部云端 t2v（含未配置）
    const t2v = groups.t2v || []
    videoProviders.value = [
      { key: 'static', label: t('settings.staticLabel'), models: [], configured: true },
      ...t2v.map((p) => ({ key: p.key, label: t('settings.aiVideoPrefix') + p.label + (p.free ? t('settings.freeTierParen') : t('settings.paidTierParen')) + (p.configured ? '' : t('settings.notConfiguredParen')), models: p.models, configured: p.configured })),
    ]
    // 可灵 Kling 需独立凭证（Access Key + Secret Key，JWT 签名鉴权），单独列出供「视频凭证」区配置
    klingProviders.value = t2v.filter((p) => p.auth === 'access_secret')
    for (const p of klingProviders.value) {
      const draft = credentialOf(p.key, { accessKey: '', secretKey: '', baseUrl: '' })
      if (!draft.baseUrl && p.runtimeBaseUrl) draft.baseUrl = p.runtimeBaseUrl
      if (!(p.key in provTesting)) provTesting[p.key] = false
    }
    // 配音 provider：Edge（本地默认免费）+ 全部云端 tts（含未配置）
    const tts = groups.tts || []
    voiceProviders.value = [
      { key: 'edge', label: t('settings.edgeLabel'), models: [], configured: true },
      ...tts.map((p) => ({ key: p.key, label: p.label + (p.free ? t('settings.freeTierParen') : t('settings.paidTierParen')) + (p.configured ? '' : t('settings.notConfiguredParen')), models: p.models, configured: p.configured })),
    ]
    // 火山豆包语音需独立凭证（AppID+Token+Cluster），单独列出供「配音凭证」区配置
    volcanoTtsProviders.value = tts.filter((p) => p.key === 'volcano_tts')
    for (const p of volcanoTtsProviders.value) {
      const draft = credentialOf(p.key, { apiKey: '', baseUrl: '', appId: '', cluster: '' })
      if (!draft.baseUrl && p.runtimeBaseUrl) draft.baseUrl = p.runtimeBaseUrl
      if (!(p.key in provTesting)) provTesting[p.key] = false
    }
    if (sm.script) Object.assign(stage.script, sm.script)
    if (sm.image) Object.assign(stage.image, sm.image)
    if (sm.video && sm.video.provider) Object.assign(stage.video, sm.video)
    if (sm.voice && sm.voice.provider) Object.assign(stage.voice, sm.voice)
    // 备用生图模型链：字符串数组 或 {provider,model} 对象数组，统一成 value 串
    if (Array.isArray(sm.imageChain)) {
      imageChain.value = sm.imageChain.map((it) =>
        typeof it === 'string' ? it : (it && it.provider ? (it.provider === 'pollinations' ? it.model : `${it.provider}__${it.model}`) : '')
      ).filter((item): item is string => typeof item === 'string' && item.length > 0)
    }
  } catch (cause: unknown) {
    ElMessage.error(t('settings.loadModelsFailed', { msg: errorMessage(cause) }))
  }
}
async function doSaveStage() {
  try {
    await saveStageModels({
      script: { provider: stage.script.provider, model: stage.script.model },
      image: { provider: stage.image.provider, model: stage.image.model },
      video: { provider: stage.video.provider, model: stage.video.model },
      voice: { provider: stage.voice.provider, model: stage.voice.model },
      imageChain: imageChain.value.slice(),
    })
    ElMessage.success(t('settings.routeSaved'))
  } catch (cause: unknown) { ElMessage.error(t('settings.saveFailed', { msg: errorMessage(cause) })) }
}
async function doSaveCred(key: string): Promise<void> {
  try {
    const draft = credentialOf(key)
    const payload: JsonObject = { provider: key }
    if (draft.apiKey !== undefined) payload.apiKey = draft.apiKey
    if (draft.baseUrl !== undefined) payload.baseUrl = draft.baseUrl
    // 火山 TTS：额外提交 AppID + Cluster
    if (draft.appId !== undefined) payload.appId = draft.appId
    if (draft.cluster !== undefined) payload.cluster = draft.cluster
    // 可灵 Kling：JWT 鉴权，提交 Access Key + Secret Key（无 apiKey 字段）
    if (draft.accessKey !== undefined) payload.accessKey = draft.accessKey
    if (draft.secretKey !== undefined) payload.secretKey = draft.secretKey
    await saveCredentials(payload)
    ElMessage.success(t('settings.credSaved'))
    draft.apiKey = ''
    if (draft.secretKey !== undefined) draft.secretKey = ''
    if (draft.accessKey !== undefined) draft.accessKey = ''
    await loadModels()
    await loadHealth()
  } catch (cause: unknown) { ElMessage.error(t('settings.saveFailed', { msg: errorMessage(cause) })) }
}
async function doClearCred(key: string): Promise<void> {
  try {
    await ElMessageBox.confirm(t('settings.clearSecretConfirm'), t('settings.dangerOp'), { type: 'warning' })
    await clearProviderKey(key)
    const draft = credentialOf(key)
    if (draft.apiKey !== undefined) draft.apiKey = ''
    if (draft.accessKey !== undefined) draft.accessKey = ''
    if (draft.secretKey !== undefined) draft.secretKey = ''
    ElMessage.success(t('settings.secretCleared'))
    await loadModels()
    await loadHealth()
  } catch (cause: unknown) {
    if (cause !== 'cancel') ElMessage.error(t('settings.saveFailed', { msg: errorMessage(cause) }))
  }
}
async function doTest(key: string): Promise<void> {
  provTesting[key] = true
  try {
    const r = await testProvider({ provider: key, model: stage.script.provider === key ? stage.script.model : undefined })
    provTestResult[key] = r
    ElMessage[r.ok ? 'success' : 'error'](r.ok ? t('settings.connOk', { ms: r.latency_ms }) : t('settings.connFail', { msg: r.error }))
  } catch (cause: unknown) {
    provTestResult[key] = { ok: false, error: errorMessage(cause, t('settings.reqFailed')) }
  } finally {
    provTesting[key] = false
  }
}
const dirCheckResult = ref<DirectoryCheckResult | null>(null)
const testing = reactive<Record<'deepseek' | 'pollinations', boolean>>({ deepseek: false, pollinations: false })
const testResult = reactive<Record<'deepseek' | 'pollinations', ApiTestResult | null>>({ deepseek: null, pollinations: null })

function credentialOf(key: string, defaults: CredentialDraft = {}): CredentialDraft {
  if (!cred[key]) cred[key] = { ...defaults }
  return cred[key]
}

interface SettingsForm {
  uploadDir: string
  ffmpegPath: string
  defaultImageModel: string
  defaultStyle: string
  defaultVoice: string
  defaultDuration: string
  deepseek: { apiKey: string; baseUrl: string; model: string }
  pollinations: { timeout: number; retries: number }
  pacing: { tightPace: boolean; tightTail: number; standardTail: number; noVoiceTail: number }
}

// 表单：与后端配置结构一致，含嵌套对象
const form = reactive<SettingsForm>({
  uploadDir: './uploads',
  ffmpegPath: 'ffmpeg',
  defaultImageModel: 'flux',
  defaultStyle: '写实',
  defaultVoice: 'xiaoxiao',
  defaultDuration: '150-210',
  deepseek: { apiKey: '', baseUrl: '', model: 'deepseek-chat' },
  pollinations: { timeout: 20000, retries: 3 },
  // v1.6.5 节奏控制：分镜配音之间的尾镜留白，越小衔接越紧凑
  pacing: { tightPace: true, tightTail: 0.12, standardTail: 0.3, noVoiceTail: 0.6 },
})

// 存储统计表格行
const STORAGE_LABELS = computed<Record<string, string>>(() => ({ images: t('settings.catImages'), audio: t('settings.catAudio'), videos: t('settings.catVideos'), subtitles: t('settings.catSubtitles'), temp: t('settings.catTemp') }))
const storageRows = computed(() => {
  if (!storage.value) return []
  return Object.entries(storage.value.breakdown).map(([k, v]) => ({
    label: STORAGE_LABELS.value[k] || k,
    count: v.count,
    sizeText: fmtSize(v.size),
  }))
})

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0, n = bytes
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`
}

// 把后端配置填入表单（深合并，保留嵌套结构）
function fillForm(data: SettingsData): void {
  runtimeSettingsFile.value = data?._runtime?.settingsFile || runtimeSettingsFile.value
  form.uploadDir = data.uploadDir ?? form.uploadDir
  form.ffmpegPath = data.ffmpegPath ?? form.ffmpegPath
  form.defaultImageModel = data.defaultImageModel ?? form.defaultImageModel
  form.defaultStyle = data.defaultStyle ?? form.defaultStyle
  form.defaultVoice = data.defaultVoice ?? form.defaultVoice
  form.defaultDuration = data.defaultDuration ?? form.defaultDuration
  if (data.deepseek) Object.assign(form.deepseek, data.deepseek)
  if (data.pollinations) Object.assign(form.pollinations, data.pollinations)
  if (data.pacing) Object.assign(form.pacing, data.pacing)
}

function applyPreset(i: number): void {
  const p = presets.value[i]
  if (!p) return
  if (p.baseUrl) form.deepseek.baseUrl = p.baseUrl
  if (p.model) form.deepseek.model = p.model
}

async function save() {
  saving.value = true
  try {
    // 脱敏占位密钥（**** 开头）不回传，避免覆盖真实值
    const deepseek: CredentialDraft & { model: string } = { ...form.deepseek }
    if (deepseek.apiKey?.startsWith('****')) {
      delete deepseek.apiKey
    }
    const payload: JsonObject = {
      ...form,
      deepseek,
      pollinations: { ...form.pollinations },
      pacing: { ...form.pacing },
    }
    const res = activeTab.value === 'general'
      ? await saveDefaults({
        defaultImageModel: form.defaultImageModel,
        defaultStyle: form.defaultStyle,
        defaultVoice: form.defaultVoice,
        defaultDuration: form.defaultDuration,
      })
      : await saveSettings(payload)
    if (res.needRestart) {
      ElMessage.warning(res.message || t('settings.savedNeedRestart'))
    } else {
      ElMessage.success(t('settings.settingsSaved'))
    }
    // 重新拉取脱敏后的最新值
    fillForm(await getSettings())
  } catch (cause: unknown) {
    ElMessage.error(t('settings.saveFailed', { msg: errorMessage(cause) }))
  } finally {
    saving.value = false
  }
}

async function test(type: 'deepseek' | 'pollinations'): Promise<void> {
  testing[type] = true
  testResult[type] = null
  try {
    const payload = { type }
    if (type === 'deepseek') {
      // 统一入口后，API 页只测试已保存 DeepSeek 凭证，避免临时输入与落盘配置混淆。
    }
    testResult[type] = await testApi(payload)
  } catch (cause: unknown) {
    testResult[type] = { ok: false, message: errorMessage(cause) }
  } finally {
    testing[type] = false
  }
}

async function checkDirNow() {
  checkingDir.value = true
  dirCheckResult.value = null
  try {
    let r = await checkDir(form.uploadDir, false)
    if (!r.ok && r.exists === false) {
      // 目录不存在，询问是否创建
      try {
        await ElMessageBox.confirm(t('settings.dirNotExist'), t('settings.tip'), { type: 'warning' })
        r = await checkDir(form.uploadDir, true)
      } catch { /* 用户取消 */ }
    }
    dirCheckResult.value = r
  } catch (cause: unknown) {
    dirCheckResult.value = { ok: false, message: errorMessage(cause) }
  } finally {
    checkingDir.value = false
  }
}

async function loadStorage() {
  try { storage.value = await getStorageStats() } catch { /* ignore */ }
}

async function doCleanTemp() {
  cleaning.value = true
  try {
    const res = await cleanTemp()
    ElMessage.success(res.message || t('settings.cleaned'))
    await loadStorage()
  } catch (cause: unknown) {
    ElMessage.error(t('settings.cleanFailed', { msg: errorMessage(cause) }))
  } finally {
    cleaning.value = false
  }
}

onMounted(async () => {
  try {
    const [cfg, ps] = await Promise.all([getSettings(), getPresets()])
    fillForm(cfg)
    presets.value = ps.deepseek || []
    await loadStorage()
    loadHealth()
    loadModels()
    getVersion().then(v => { if (v && v.version) appVersion.value = v.version }).catch(() => {})
  } catch (cause: unknown) {
    ElMessage.error(t('settings.loadSettingsFailed', { msg: errorMessage(cause) }))
  }
})

// ===== ⑥ 关于页：检查更新 / 诊断日志 / 意见反馈 / 用户协议 / 隐私政策 =====
async function doCheckUpdate() {
  updateChecking.value = true
  try {
    const r = await checkUpdate()
    if (r && r.has_update) {
      ElMessageBox.confirm(
        t('settings.updateAvailable', { v: r.latest }),
        t('settings.checkUpdate'),
        { confirmButtonText: t('settings.download'), cancelButtonText: t('preview.cancel'), type: 'info' }
      ).then(() => { if (r.download_url) window.open(r.download_url, '_blank') }).catch(() => {})
    } else {
      ElMessage.success(t('settings.upToDate', { v: (r && r.current) || appVersion.value }))
    }
  } catch {
    ElMessage.error(t('settings.checkUpdateFailed'))
  } finally {
    updateChecking.value = false
  }
}

async function showDiagnostics() {
  try {
    const d = await getDiagnostics()
    const lines = [
      `版本/Version: ${d.version}`,
      `Node: ${d.node}  Platform: ${d.platform}`,
      `运行时长/Uptime: ${d.uptime_sec}s   内存/Memory: ${d.memory_mb}MB`,
      `生成时间/Generated: ${d.generated_at}`,
      '',
      '=== 运行日志 / Runtime log (tail) ===',
      ...(d.out_log || []).slice(-40),
      '',
      '=== 错误日志 / Error log (tail) ===',
      ...(d.error_log || []).slice(-40),
    ]
    const text = lines.join('\n')
    ElMessageBox.alert(
      `<pre style="max-height:50vh;overflow:auto;white-space:pre-wrap;font-size:12px;line-height:1.5">${escapeHtml(text)}</pre>`,
      t('settings.diagnostics'),
      { dangerouslyUseHTMLString: true, confirmButtonText: t('settings.copyLog'), callback: () => copyText(text) }
    )
  } catch {
    ElMessage.error(t('settings.diagnosticsFailed'))
  }
}

function escapeHtml(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function copyText(text: string): void {
  try {
    navigator.clipboard.writeText(text)
    ElMessage.success(t('settings.copied'))
  } catch { /* 剪贴板不可用时静默 */ }
}

function showFeedback() {
  ElMessageBox.alert(
    `<div style="line-height:2">
       <p>${escapeHtml(t('settings.feedbackDesc'))}</p>
       <p style="font-size:18px;font-weight:600;color:var(--el-color-primary)">${t('settings.feedbackWechat')}：18922105290</p>
     </div>`,
    t('settings.feedback'),
    { dangerouslyUseHTMLString: true, confirmButtonText: t('settings.copyWechat'), callback: () => copyText('18922105290') }
  )
}

function showAgreement() {
  ElMessageBox.alert(
    `<div style="max-height:55vh;overflow:auto;white-space:pre-wrap;line-height:1.7;font-size:13px">${escapeHtml(t('settings.agreementText'))}</div>`,
    t('settings.userAgreement'),
    { dangerouslyUseHTMLString: true, confirmButtonText: t('settings.iKnow') }
  )
}

function showPrivacy() {
  ElMessageBox.alert(
    `<div style="max-height:55vh;overflow:auto;white-space:pre-wrap;line-height:1.7;font-size:13px">${escapeHtml(t('settings.privacyText'))}</div>`,
    t('settings.privacyPolicy'),
    { dangerouslyUseHTMLString: true, confirmButtonText: t('settings.iKnow') }
  )
}

// ===== F8 备份与迁移 =====
const backupLoading = ref(false)
const restoreLoading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
let pickMode: 'restore' | 'import' | '' = ''

function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function doBackup() {
  backupLoading.value = true
  try {
    const env = await getBackup()
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadJson(env, `aigc-backup-${stamp}.aigcbak`)
    ElMessage.success(t('settings.backupExported'))
  } catch (cause: unknown) {
    ElMessage.error(t('settings.backupFailed', { msg: errorMessage(cause) }))
  } finally {
    backupLoading.value = false
  }
}

async function doExportConfig() {
  try {
    const data = await exportConfig()
    const stamp = new Date().toISOString().slice(0, 10)
    downloadJson(data, `aigc-config-${stamp}.json`)
    ElMessage.success(t('settings.configExported'))
  } catch (cause: unknown) {
    ElMessage.error(t('settings.exportFailed', { msg: errorMessage(cause) }))
  }
}

function pickRestore(): void { pickMode = 'restore'; fileInput.value?.click() }
function pickImportConfig(): void { pickMode = 'import'; fileInput.value?.click() }

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  const file = input?.files?.[0]
  if (input) input.value = '' // 允许重复选同一文件
  if (!file) return
  let obj: unknown
  try {
    obj = JSON.parse(await file.text())
  } catch {
    ElMessage.error(t('settings.invalidJson'))
    return
  }
  if (pickMode === 'restore') {
    try {
      await ElMessageBox.confirm(t('settings.restoreConfirm'), t('settings.dangerOp'), { type: 'warning' })
    } catch { return }
    restoreLoading.value = true
    try {
      const parsed = BackupEnvelopeSchema.safeParse(obj)
      if (!parsed.success) {
        ElMessage.error(t('settings.invalidJson'))
        return
      }
      const r = await restoreBackup(parsed.data)
      ElMessage.success(r.message || t('settings.restored'))
      const [cfg] = await Promise.all([getSettings()])
      fillForm(cfg)
      await loadStorage()
    } catch (cause: unknown) {
      ElMessage.error(t('settings.restoreFailed', { msg: errorMessage(cause) }))
    } finally {
      restoreLoading.value = false
    }
  } else {
    const cfg = isJsonObject(obj) && isJsonObject(obj.config) ? obj.config : obj
    if (!isJsonObject(cfg)) {
      ElMessage.error(t('settings.invalidJson'))
      return
    }
    try {
      await importConfig(cfg)
      ElMessage.success(t('settings.configImported'))
      const [fresh] = await Promise.all([getSettings()])
      fillForm(fresh)
    } catch (cause: unknown) {
      ElMessage.error(t('settings.importFailed', { msg: errorMessage(cause) }))
    }
  }
}
</script>

<style scoped src="../styles/settings.css"></style>
