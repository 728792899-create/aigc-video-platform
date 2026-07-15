<template>
  <div class="skills-page">
    <div class="skills-header">
      <div>
        <h2 class="skills-title">{{ $t('skills.title') }}</h2>
        <p class="skills-sub">{{ $t('skills.subtitle') }}</p>
      </div>
      <div class="skills-actions">
        <el-button @click="exportAll">{{ $t('skills.export') }}</el-button>
        <el-button @click="triggerImport">{{ $t('skills.import') }}</el-button>
        <el-button @click="restoreDefaults">{{ $t('skills.restoreBuiltins') }}</el-button>
        <input ref="fileInput" type="file" accept="application/json" style="display:none" @change="onImportFile" />
        <el-button type="primary" @click="openCreate">{{ $t('skills.create') }}</el-button>
      </div>
    </div>

    <el-tabs v-model="filterStage" class="skills-tabs">
      <el-tab-pane :label="$t('skills.stageAll')" name="" />
      <el-tab-pane :label="$t('skills.stageScript')" name="script" />
      <el-tab-pane :label="$t('skills.stageImage')" name="image" />
      <el-tab-pane :label="$t('skills.stageVoice')" name="voice" />
    </el-tabs>

    <div v-loading="loading" class="skills-grid">
      <div v-for="s in filtered" :key="s.id" class="skill-card" :class="{ disabled: !s.enabled }">
        <div class="skill-card-head">
          <span class="skill-icon">{{ s.icon || '✨' }}</span>
          <span class="skill-name">{{ s.name }}</span>
          <el-tag size="small" :type="stageTagType(s.stage)">{{ stageLabel(s.stage) }}</el-tag>
          <el-tag v-if="s.auto_apply" size="small" type="danger" effect="dark">{{ $t('skills.autoTag') }}</el-tag>
          <el-tag v-if="s.is_builtin" size="small" type="info">{{ $t('skills.builtin') }}</el-tag>
        </div>
        <p class="skill-desc">{{ s.description || $t('skills.noDesc') }}</p>
        <p class="skill-prompt">{{ s.prompt }}</p>
        <div class="skill-card-foot">
          <div class="skill-switches">
            <el-switch v-model="s.enabled" @change="toggleEnabled(s, $event)" :active-text="$t('skills.enabled')" size="small" />
            <el-switch v-model="s.auto_apply" @change="toggleAuto(s, $event)" :active-text="$t('skills.autoApply')" size="small" />
          </div>
          <div>
            <el-button size="small" text @click="openEdit(s)">{{ $t('skills.edit') }}</el-button>
            <el-button size="small" text type="danger" @click="doDelete(s)">{{ $t('skills.del') }}</el-button>
          </div>
        </div>
      </div>
      <el-empty v-if="!loading && filtered.length === 0" :description="$t('skills.empty')" />
    </div>

    <el-dialog v-model="dialog.visible" :title="dialog.id ? $t('skills.editTitle') : $t('skills.createTitle')" width="560px">
      <el-form label-width="90px">
        <el-form-item :label="$t('skills.fieldIcon')">
          <el-input v-model="dialog.icon" maxlength="2" style="width:80px" />
          <span class="field-hint">{{ $t('skills.iconHint') }}</span>
        </el-form-item>
        <el-form-item :label="$t('skills.fieldName')">
          <el-input v-model="dialog.name" :placeholder="$t('skills.namePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('skills.fieldStage')">
          <el-select v-model="dialog.stage">
            <el-option :label="$t('skills.stageAllOpt')" value="all" />
            <el-option :label="$t('skills.stageScript')" value="script" />
            <el-option :label="$t('skills.stageImage')" value="image" />
            <el-option :label="$t('skills.stageVoice')" value="voice" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('skills.fieldAutoApply')">
          <el-switch v-model="dialog.auto_apply" :active-text="$t('skills.autoApplyHint')" />
        </el-form-item>
        <el-form-item :label="$t('skills.fieldDesc')">
          <el-input v-model="dialog.description" :placeholder="$t('skills.descPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('skills.fieldPrompt')">
          <el-input v-model="dialog.prompt" type="textarea" :rows="5" :placeholder="$t('skills.promptPlaceholder')" />
        </el-form-item>
        <el-alert
          v-if="dialog.is_builtin"
          type="info"
          :closable="false"
          :title="$t('skills.builtinEditHint')"
          style="margin-bottom:12px"
        />
        <el-form-item v-if="dialog.id" :label="$t('skills.versions')">
          <div class="version-list">
            <div v-if="versionsLoading" class="version-muted">{{ $t('skills.loadingVersions') }}</div>
            <div v-else-if="!versions.length" class="version-muted">{{ $t('skills.noVersions') }}</div>
            <div v-for="v in versions" :key="v.id" class="version-row">
              <span>{{ v.summary || $t('skills.versionSnapshot') }} · {{ fmtTime(v.created_at) }}</span>
              <el-button size="small" text @click="restoreVersion(v)">{{ $t('skills.restoreVersion') }}</el-button>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">{{ $t('skills.cancel') }}</el-button>
        <el-button type="primary" @click="saveSkill">{{ $t('skills.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import {
  listSkills, createSkill, updateSkill, deleteSkill, importSkills, restoreBuiltinSkills,
  listSkillVersions, restoreSkillVersion, type CreativeSkill, type SkillVersion,
} from '../api/skills'

type EntityId = string | number
type JsonObject = Record<string, unknown>
interface SkillDialog {
  visible: boolean
  id: EntityId | null
  name: string
  stage: string
  description: string
  prompt: string
  icon: string
  auto_apply: boolean
  is_builtin: boolean
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const { t } = useI18n()
const skills = ref<CreativeSkill[]>([])
const loading = ref(false)
const filterStage = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const dialog = ref<SkillDialog>({ visible: false, id: null, name: '', stage: 'all', description: '', prompt: '', icon: '✨', auto_apply: false, is_builtin: false })
const versions = ref<SkillVersion[]>([])
const versionsLoading = ref(false)

const filtered = computed(() => {
  if (!filterStage.value) return skills.value
  return skills.value.filter((s) => s.stage === filterStage.value || s.stage === 'all')
})

function stageLabel(stage: string): string {
  const labels: Record<string, string> = { script: t('skills.stageScript'), image: t('skills.stageImage'), voice: t('skills.stageVoice'), all: t('skills.stageAllOpt') }
  return labels[stage] || stage
}
function stageTagType(stage: string): 'success' | 'warning' | 'primary' | 'info' {
  const types: Record<string, 'success' | 'warning' | 'primary' | 'info'> = { script: 'success', image: 'warning', voice: 'primary', all: 'info' }
  return types[stage] || 'info'
}

async function load() {
  loading.value = true
  try { skills.value = await listSkills() } catch (e) { ElMessage.error(t('skills.loadFailed')) } finally { loading.value = false }
}

function openCreate() {
  versions.value = []
  dialog.value = { visible: true, id: null, name: '', stage: 'all', description: '', prompt: '', icon: '✨', auto_apply: false, is_builtin: false }
}
function openEdit(s: CreativeSkill) {
  dialog.value = { visible: true, id: s.id, name: s.name, stage: s.stage, description: s.description, prompt: s.prompt, icon: s.icon || '✨', auto_apply: !!s.auto_apply, is_builtin: !!s.is_builtin }
  loadVersions(s.id)
}

async function loadVersions(id: EntityId) {
  versionsLoading.value = true
  try { versions.value = await listSkillVersions(id) }
  catch { versions.value = [] }
  finally { versionsLoading.value = false }
}

async function saveSkill() {
  const d = dialog.value
  if (!d.name.trim()) { ElMessage.warning(t('skills.nameRequired')); return }
  if (!d.prompt.trim()) { ElMessage.warning(t('skills.promptRequired')); return }
  try {
    const payload = { name: d.name, stage: d.stage, description: d.description, prompt: d.prompt, icon: d.icon, auto_apply: d.auto_apply }
    if (d.id) await updateSkill(d.id, payload)
    else await createSkill(payload)
    ElMessage.success(t('skills.saved'))
    dialog.value.visible = false
    await load()
  } catch (cause) { ElMessage.error(errorMessage(cause, t('skills.saveFailed'))) }
}

async function toggleEnabled(skill: CreativeSkill, value: string | number | boolean) {
  const enabled = Boolean(value)
  try { await updateSkill(skill.id, { enabled }) } catch { skill.enabled = !enabled; ElMessage.error(t('skills.saveFailed')) }
}

async function toggleAuto(skill: CreativeSkill, value: string | number | boolean) {
  const autoApply = Boolean(value)
  try { await updateSkill(skill.id, { auto_apply: autoApply }) } catch { skill.auto_apply = !autoApply; ElMessage.error(t('skills.saveFailed')) }
}

async function doDelete(s: CreativeSkill) {
  try {
    await ElMessageBox.confirm(t('skills.delConfirm', { name: s.name }), t('skills.del'), { type: 'warning' })
    await deleteSkill(s.id)
    ElMessage.success(t('skills.deleted'))
    await load()
  } catch (e) { if (e !== 'cancel') ElMessage.error(t('skills.saveFailed')) }
}

async function restoreDefaults() {
  try {
    const r = await restoreBuiltinSkills()
    ElMessage.success(t('skills.restoredBuiltins', { n: r?.restored || 0 }))
    await load()
  } catch (cause) {
    ElMessage.error(errorMessage(cause, t('skills.saveFailed')))
  }
}

async function restoreVersion(version: SkillVersion) {
  const skillId = dialog.value.id
  if (skillId == null) return
  try {
    await ElMessageBox.confirm(t('skills.restoreVersionConfirm'), t('skills.restoreVersion'), { type: 'warning' })
    const updated = await restoreSkillVersion(skillId, version.id)
    ElMessage.success(t('skills.restoredVersion'))
    dialog.value = {
      ...dialog.value,
      name: updated.name,
      stage: updated.stage,
      description: updated.description,
      prompt: updated.prompt,
      icon: updated.icon || '✨',
      auto_apply: !!updated.auto_apply,
    }
    await loadVersions(skillId)
    await load()
  } catch (cause) {
    if (cause !== 'cancel') ElMessage.error(errorMessage(cause, t('skills.saveFailed')))
  }
}

function fmtTime(ts: string | number | null | undefined): string {
  if (!ts) return '—'
  return new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false })
}

function exportAll() {
  const data = skills.value.filter((s) => !s.is_builtin).map((s) => ({ name: s.name, stage: s.stage, description: s.description, prompt: s.prompt, icon: s.icon }))
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'skills.json'; a.click()
  URL.revokeObjectURL(url)
}

function triggerImport() { fileInput.value?.click() }
async function onImportFile(event: Event) {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  const file = input?.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const parsed: unknown = JSON.parse(text)
    const values = Array.isArray(parsed) ? parsed : [parsed]
    if (!values.every(isJsonObject)) throw new Error(t('skills.importFailed'))
    const r = await importSkills(values)
    ElMessage.success(t('skills.imported', { n: r?.imported || 0 }))
    await load()
  } catch { ElMessage.error(t('skills.importFailed')) }
  finally { if (input) input.value = '' }
}

onMounted(load)
</script>

<style scoped>
.skills-page { padding: 20px; color: var(--text); }
.skills-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 12px; }
.skills-title { font-size: 20px; font-weight: 700; margin: 0; }
.skills-sub { font-size: 13px; color: var(--text-second); margin: 4px 0 0; }
.skills-actions { display: flex; gap: 8px; flex-shrink: 0; }
.skills-tabs { margin-bottom: 8px; }
.skills-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.skill-card { background: var(--bg-surface); border: 1px solid var(--separator); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 8px; transition: border-color .2s; }
.skill-card:hover { border-color: var(--primary); }
.skill-card.disabled { opacity: 0.55; }
.skill-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.skill-icon { font-size: 20px; }
.skill-name { font-weight: 600; font-size: 15px; }
.skill-desc { font-size: 13px; color: var(--text-second); margin: 0; }
.skill-prompt { font-size: 12px; color: var(--text-second); margin: 0; max-height: 60px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; background: var(--bg-base); padding: 8px; border-radius: var(--radius-sm); }
.skill-card-foot { display: flex; justify-content: space-between; align-items: center; margin-top: auto; }
.skill-switches { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.field-hint { font-size: 12px; color: var(--text-second); margin-left: 8px; }
.version-list { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.version-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; color: var(--text-second); }
.version-muted { font-size: 12px; color: var(--text-second); }
</style>
