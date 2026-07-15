<template>
  <div class="asset-workbench" @keydown.esc="closeDialogs">
    <aside class="asset-rail" aria-label="Asset workspace navigation">
      <button type="button" :title="$t('assets.backStudio')" @click="router.push(`/studio/${projectId}`)">←</button>
      <div class="asset-rail__mark">A</div>
      <button type="button" :title="$t('nav.images')" @click="router.push(`/projects/${projectId}/images`)">▧</button>
      <button type="button" :title="$t('nav.files')" @click="router.push('/files')">⌁</button>
      <span></span>
      <small>ASSETS</small>
    </aside>

    <main class="asset-main">
      <header class="asset-header">
        <div>
          <span class="asset-kicker">Director / Assets</span>
          <h1>{{ $t('assets.title') }}</h1>
          <p>{{ $t('assets.subtitle') }}</p>
        </div>
        <div class="asset-header__actions">
          <button type="button" class="is-secondary" :disabled="loading" @click="load">{{ $t('assets.refresh') }}</button>
          <button v-if="selectedUnit?.scope === 'series'" type="button" class="is-secondary" @click="openDialog('fork')">{{ $t('assets.forkToEpisode') }}</button>
          <button type="button" @click="openCreateDialog">＋ {{ $t('assets.createAsset') }}</button>
          <button type="button" :disabled="!selectedUnit" @click="openVariantDialog">＋ {{ $t('assets.addVariant') }}</button>
        </div>
      </header>

      <div v-if="errorMessage" class="asset-notice is-error" role="alert">
        <span>{{ errorMessage }}</span>
        <button type="button" @click="load">{{ $t('assets.retry') }}</button>
      </div>
      <div v-else-if="toast" class="asset-notice is-success" role="status">{{ toast }}</div>

      <section v-if="loading" class="asset-state">
        <div class="asset-loader">◇</div>
        <p>{{ $t('assets.loading') }}</p>
      </section>
      <section v-else class="asset-workspace">
        <aside class="asset-library-pane">
          <div class="asset-filter" role="tablist" :aria-label="$t('assets.assetType')">
            <button
              v-for="item in filters"
              :key="item"
              type="button"
              role="tab"
              :aria-selected="filter === item"
              :class="{ 'is-active': filter === item }"
              @click="filter = item"
            >{{ item === 'all' ? $t('assets.all') : $t(`assets.type.${item}`) }}</button>
          </div>
          <AssetUnitList :units="filteredUnits" :active-id="selectedUnitId" @select="selectUnit" />
          <p class="asset-shortcuts">{{ $t('assets.shortcuts') }}</p>
        </aside>

        <article class="asset-detail-pane">
          <template v-if="selectedUnit">
            <header class="asset-detail-header">
              <div>
                <span>{{ $t(`assets.type.${selectedUnit.asset_type}`) }} · {{ $t(`assets.scope.${selectedUnit.scope}`) }}</span>
                <h2>{{ selectedUnit.name }}</h2>
                <p>{{ $t('assets.scopeImpact', { scope: $t(`assets.scope.${selectedUnit.scope}`), count: unitBindingCount }) }}</p>
              </div>
              <button type="button" @click="openVariantDialog">＋ {{ $t('assets.addVariant') }}</button>
            </header>
            <AssetVariantGrid
              :unit="selectedUnit"
              :bindings="library?.bindings ?? []"
              @select="selectVariant"
              @bind="openBindDialog"
              @archive="openArchiveDialog"
            />
          </template>
          <div v-else class="asset-state">
            <div class="asset-loader">A</div>
            <p>{{ $t('assets.noAssets') }}</p>
            <button type="button" @click="openCreateDialog">＋ {{ $t('assets.createAsset') }}</button>
          </div>
        </article>
      </section>
    </main>

    <div v-if="dialog" class="asset-dialog-backdrop" @mousedown.self="closeDialogs">
      <section class="asset-dialog" role="dialog" aria-modal="true" :aria-labelledby="`${dialog}-dialog-title`">
        <template v-if="dialog === 'create'">
          <h2 id="create-dialog-title">{{ $t('assets.createAsset') }}</h2>
          <form @submit.prevent="createUnit">
            <label>{{ $t('assets.assetName') }}<input ref="dialogFocus" v-model.trim="unitForm.name" maxlength="200" required :placeholder="$t('assets.assetNamePlaceholder')" /></label>
            <label>{{ $t('assets.assetType') }}
              <select v-model="unitForm.asset_type">
                <option value="scene">{{ $t('assets.type.scene') }}</option>
                <option value="prop">{{ $t('assets.type.prop') }}</option>
                <option value="style">{{ $t('assets.type.style') }}</option>
                <option value="voice">{{ $t('assets.type.voice') }}</option>
                <option value="music">{{ $t('assets.type.music') }}</option>
              </select>
            </label>
            <label>{{ $t('assets.assetScope') }}
              <select v-model="unitForm.scope">
                <option value="episode">{{ $t('assets.scope.episode') }}</option>
                <option value="series" :disabled="!project?.series_id">{{ $t('assets.scope.series') }}</option>
                <option value="global">{{ $t('assets.scope.global') }}</option>
              </select>
            </label>
            <template v-if="unitForm.asset_type === 'voice'">
              <label>{{ $t('assets.voiceLanguage') }}<input v-model.trim="unitForm.language" maxlength="40" /></label>
              <label>{{ $t('assets.voiceId') }}<input v-model.trim="unitForm.voice_id" maxlength="160" /></label>
              <label>{{ $t('assets.emotion') }}<input v-model.trim="unitForm.emotion" maxlength="80" /></label>
            </template>
            <template v-else-if="unitForm.asset_type === 'music'">
              <label>{{ $t('assets.musicMood') }}<input v-model.trim="unitForm.mood" maxlength="120" /></label>
              <label>{{ $t('assets.musicBpm') }}<input v-model.number="unitForm.bpm" type="number" min="20" max="300" /></label>
              <label>{{ $t('assets.musicLicense') }}<input v-model.trim="unitForm.license" maxlength="300" /></label>
            </template>
            <p v-if="unitForm.scope === 'series' && !project?.series_id" class="asset-form-error">{{ $t('assets.seriesUnavailable') }}</p>
            <DialogActions :busy="mutating" :confirm-label="$t('assets.create')" @cancel="closeDialogs" />
          </form>
        </template>

        <template v-else-if="dialog === 'variant' && selectedUnit">
          <h2 id="variant-dialog-title">{{ $t('assets.addVariant') }} · {{ selectedUnit.name }}</h2>
          <form @submit.prevent="createVariant">
            <label>{{ $t('assets.variantLabel') }}<input ref="dialogFocus" v-model.trim="variantForm.label" maxlength="200" :placeholder="$t('assets.variantLabelPlaceholder')" /></label>
            <label>{{ $t('assets.chooseMedia') }}
              <select v-model="variantForm.mediaUrl" required :disabled="!variantMedia.length">
                <option value="" disabled>{{ $t('assets.chooseMedia') }}</option>
                <option v-for="file in variantMedia" :key="file.url" :value="file.url">{{ file.display_name || file.name }}</option>
              </select>
            </label>
            <div v-if="!variantMedia.length" class="asset-media-empty">
              <p>{{ selectedUnit.asset_type === 'voice' || selectedUnit.asset_type === 'music' ? $t('assets.noManagedAudio') : $t('assets.noManagedImages') }}</p>
              <button type="button" @click="router.push(selectedUnit.asset_type === 'voice' || selectedUnit.asset_type === 'music' ? '/files' : `/projects/${projectId}/images`)">{{ $t('assets.openMedia') }}</button>
            </div>
            <label>{{ $t('assets.variantPrompt') }}<textarea v-model.trim="variantForm.prompt" rows="4" maxlength="12000" :placeholder="$t('assets.variantPromptPlaceholder')"></textarea></label>
            <DialogActions :busy="mutating" :disabled="!variantForm.mediaUrl" :confirm-label="$t('assets.saveVariant')" @cancel="closeDialogs" />
          </form>
        </template>

        <template v-else-if="dialog === 'bind' && pendingVariant">
          <h2 id="bind-dialog-title">{{ $t('assets.bindTitle') }}</h2>
          <form @submit.prevent="bindVariant">
            <label>{{ $t('assets.chooseShot') }}
              <select ref="dialogFocus" v-model="targetStoryboardIds" required multiple size="8">
                <option v-for="shot in storyboards" :key="String(shot.id)" :value="String(shot.id)">
                  #{{ shot.scene_number }} · {{ shot.description || shot.dialog || `Shot ${shot.scene_number}` }}
                </option>
              </select>
            </label>
            <p class="asset-dialog__hint">{{ $t('assets.bindSnapshotHint') }}</p>
            <DialogActions :busy="mutating" :disabled="!targetStoryboardIds.length" :confirm-label="$t('assets.bindSelected', { count: targetStoryboardIds.length })" @cancel="closeDialogs" />
          </form>
        </template>

        <template v-else-if="dialog === 'fork' && selectedUnit">
          <h2 id="fork-dialog-title">{{ $t('assets.forkTitle') }}</h2>
          <p class="asset-dialog__hint">{{ $t('assets.forkHint') }}</p>
          <DialogActions :busy="mutating" :confirm-label="$t('assets.forkConfirm')" @confirm="forkUnit" @cancel="closeDialogs" />
        </template>

        <template v-else-if="dialog === 'archive' && pendingVariant">
          <h2 id="archive-dialog-title">{{ $t('assets.archiveTitle') }}</h2>
          <p class="asset-dialog__hint">{{ $t('assets.archiveHint') }}</p>
          <DialogActions :busy="mutating" danger :confirm-label="$t('assets.confirmArchive')" @confirm="archiveVariant" @cancel="closeDialogs" />
        </template>

        <p v-if="mutationError" class="asset-form-error" role="alert">{{ mutationError }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AssetScope, AssetType, AssetUnit, AssetVariant, Project } from '@aigc-video/contracts'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import {
  addAssetVariant,
  addCharacterAssetVariant,
  archiveAssetVariant,
  batchBindAssetVariant,
  bindAssetVariant,
  createAssetUnit,
  forkAssetUnit,
  getAssetLibrary,
  selectAssetVariant,
  selectUnitVariant,
  type AssetLibraryView,
} from '../api/assets'
import { listFiles, type ManagedFile } from '../api/files'
import { getProject } from '../api/projects'
import { listStoryboards, type EditableStoryboard } from '../api/script'
import AssetUnitList from '../components/assets/AssetUnitList.vue'
import AssetVariantGrid from '../components/assets/AssetVariantGrid.vue'
import DialogActions from '../components/assets/DialogActions.vue'

type FilterType = 'all' | AssetType
type DialogType = '' | 'create' | 'variant' | 'bind' | 'archive' | 'fork'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const filters: FilterType[] = ['all', 'character', 'scene', 'prop', 'style', 'voice', 'music']
const projectId = computed(() => String(Array.isArray(route.params.id) ? route.params.id[0] || '' : route.params.id || ''))
const project = ref<Project | null>(null)
const library = ref<AssetLibraryView | null>(null)
const storyboards = ref<EditableStoryboard[]>([])
const managedImages = ref<ManagedFile[]>([])
const managedAudio = ref<ManagedFile[]>([])
const selectedUnitId = ref('')
const filter = ref<FilterType>('all')
const loading = ref(true)
const mutating = ref(false)
const errorMessage = ref('')
const mutationError = ref('')
const toast = ref('')
const dialog = ref<DialogType>('')
const dialogFocus = ref<HTMLInputElement | HTMLSelectElement | null>(null)
const pendingVariant = ref<AssetVariant | null>(null)
const targetStoryboardIds = ref<string[]>([])
const unitForm = reactive({
  name: '', asset_type: 'scene' as Exclude<AssetType, 'character'>, scope: 'episode' as AssetScope,
  language: 'zh-CN', voice_id: '', emotion: 'neutral', mood: '', bpm: null as number | null, license: '',
})
const variantForm = reactive({ label: '', prompt: '', mediaUrl: '' })
let loadSequence = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

const filteredUnits = computed(() => (library.value?.units ?? []).filter((unit) => filter.value === 'all' || unit.asset_type === filter.value))
// Keep the detail pane consistent with the active filter. A previously selected
// character must not remain actionable when the user switches to an empty Voice
// or Music collection.
const selectedUnit = computed(() => filteredUnits.value.find((unit) => String(unit.id) === selectedUnitId.value) ?? null)
const variantMedia = computed(() => (selectedUnit.value?.asset_type === 'voice' || selectedUnit.value?.asset_type === 'music')
  ? managedAudio.value : managedImages.value)
const unitBindingCount = computed(() => library.value?.bindings.filter((binding) => (
  selectedUnit.value && binding.asset_type === selectedUnit.value.asset_type && String(binding.asset_id) === String(selectedUnit.value.id)
)).length ?? 0)

function selectUnit(unit: AssetUnit): void {
  selectedUnitId.value = String(unit.id)
}

function showToast(message: string): void {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2400)
}

async function load(): Promise<void> {
  const sequence = ++loadSequence
  loading.value = true
  errorMessage.value = ''
  try {
    const [nextProject, nextLibrary, nextShots, imageFiles, audioFiles] = await Promise.all([
      getProject(projectId.value),
      getAssetLibrary(projectId.value),
      listStoryboards(projectId.value),
      listFiles('image'),
      listFiles('audio'),
    ])
    if (sequence !== loadSequence) return
    project.value = nextProject
    library.value = nextLibrary
    storyboards.value = nextShots.filter((shot): shot is EditableStoryboard & { id: string | number } => shot.id != null)
    managedImages.value = [...imageFiles.list].sort((left, right) => {
      const leftOwn = String(left.project_id ?? '') === projectId.value ? 1 : 0
      const rightOwn = String(right.project_id ?? '') === projectId.value ? 1 : 0
      return rightOwn - leftOwn || Number(right.mtime || 0) - Number(left.mtime || 0)
    })
    managedAudio.value = [...audioFiles.list].sort((left, right) => Number(right.mtime || 0) - Number(left.mtime || 0))
    if (!nextLibrary.units.some((unit) => String(unit.id) === selectedUnitId.value)) {
      selectedUnitId.value = String(nextLibrary.units[0]?.id ?? '')
    }
  } catch (cause) {
    if (sequence === loadSequence) errorMessage.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function openDialog(type: DialogType): void {
  mutationError.value = ''
  dialog.value = type
  void nextTick(() => dialogFocus.value?.focus())
}

function openCreateDialog(): void {
  Object.assign(unitForm, { name: '', asset_type: 'scene', scope: 'episode', language: 'zh-CN', voice_id: '', emotion: 'neutral', mood: '', bpm: null, license: '' })
  openDialog('create')
}

function openVariantDialog(): void {
  if (!selectedUnit.value) return
  const owned = variantMedia.value.find((file) => String(file.project_id ?? '') === projectId.value)
  Object.assign(variantForm, { label: '', prompt: '', mediaUrl: owned?.url || variantMedia.value[0]?.url || '' })
  openDialog('variant')
}

function openBindDialog(variant: AssetVariant): void {
  pendingVariant.value = variant
  targetStoryboardIds.value = storyboards.value[0]?.id == null ? [] : [String(storyboards.value[0].id)]
  openDialog('bind')
}

function openArchiveDialog(variant: AssetVariant): void {
  pendingVariant.value = variant
  openDialog('archive')
}

function closeDialogs(): void {
  if (mutating.value) return
  dialog.value = ''
  pendingVariant.value = null
  mutationError.value = ''
}

async function mutate(operation: () => Promise<unknown>): Promise<boolean> {
  mutating.value = true
  mutationError.value = ''
  try {
    await operation()
    await load()
    dialog.value = ''
    pendingVariant.value = null
    mutationError.value = ''
    showToast(t('assets.saved'))
    return true
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause.message : String(cause)
    return false
  } finally {
    mutating.value = false
  }
}

async function createUnit(): Promise<void> {
  if (unitForm.scope === 'series' && !project.value?.series_id) {
    mutationError.value = '当前项目不属于系列'
    return
  }
  await mutate(async () => {
    const metadata = unitForm.asset_type === 'voice'
      ? { language: unitForm.language, voice_id: unitForm.voice_id, emotion: unitForm.emotion, role: 'narrator', speed: 1, pitch: 0, provider: '', model: '' }
      : unitForm.asset_type === 'music'
        ? { mood: unitForm.mood, bpm: unitForm.bpm, license: unitForm.license, musical_key: '', duration_seconds: null, loop_start: null, loop_end: null, source: '' }
        : {}
    const created = await createAssetUnit(projectId.value, { name: unitForm.name, asset_type: unitForm.asset_type, scope: unitForm.scope, metadata })
    selectedUnitId.value = String(created.id)
  })
}

function mimeFor(url: string): string {
  const extension = url.split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'mp3') return 'audio/mpeg'
  if (extension === 'wav') return 'audio/wav'
  if (extension === 'm4a') return 'audio/mp4'
  return 'image/jpeg'
}

async function createVariant(): Promise<void> {
  const unit = selectedUnit.value
  if (!unit || !variantForm.mediaUrl) return
  await mutate(async () => {
    const payload = {
      label: variantForm.label,
      provider: 'local-library',
      model: 'managed-media',
      prompt: variantForm.prompt,
      parent_variant_id: unit.selected_variant_id ?? null,
      content_hash: '',
      media_reference: {
        kind: 'project_media' as const,
        media_id: null,
        object_key: '',
        url: variantForm.mediaUrl,
        mime: mimeFor(variantForm.mediaUrl),
        content_hash: '',
      },
    }
    if (unit.asset_type === 'character') await addCharacterAssetVariant(unit.id, projectId.value, payload)
    else await addAssetVariant(unit.id, payload)
  })
}

async function selectVariant(variant: AssetVariant): Promise<void> {
  const unit = selectedUnit.value
  if (!unit || variant.selected) return
  await mutate(async () => {
    if (unit.asset_type === 'character') await selectAssetVariant(unit.id, variant.id)
    else await selectUnitVariant(unit.id, variant.id)
  })
}

async function bindVariant(): Promise<void> {
  const unit = selectedUnit.value
  const variant = pendingVariant.value
  if (!unit || !variant || !targetStoryboardIds.value.length) return
  if (targetStoryboardIds.value.length > 1) {
    await mutate(() => batchBindAssetVariant({
      storyboard_ids: targetStoryboardIds.value.map(Number), project_id: Number(projectId.value),
      asset_type: unit.asset_type, asset_id: unit.id, variant_id: variant.id, source_scope: unit.scope,
    }))
    return
  }
  await mutate(() => bindAssetVariant(targetStoryboardIds.value[0]!, {
    project_id: Number(projectId.value),
    asset_type: unit.asset_type,
    asset_id: unit.id,
    variant_id: variant.id,
    source_scope: unit.scope,
  }))
}

async function forkUnit(): Promise<void> {
  const unit = selectedUnit.value
  if (!unit || unit.scope !== 'series' || !project.value?.series_id) return
  await mutate(async () => {
    const result = await forkAssetUnit(unit.id, {
      project_id: Number(projectId.value), series_id: Number(project.value?.series_id),
      variant_id: unit.selected_variant_id ?? undefined,
    })
    selectedUnitId.value = String(result.unit.id)
  })
}

async function archiveVariant(): Promise<void> {
  const variant = pendingVariant.value
  if (!variant) return
  await mutate(() => archiveAssetVariant(variant.id))
}

watch(projectId, () => { selectedUnitId.value = ''; void load() })
onMounted(load)
onBeforeUnmount(() => {
  loadSequence += 1
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<style scoped>
.asset-workbench {
  --asset-canvas: #070b12; --asset-surface: #0e151f; --asset-surface-hover: #172230;
  --asset-border: rgba(178, 203, 226, .13); --asset-border-strong: rgba(178, 203, 226, .29);
  --asset-text: #eff6fb; --asset-soft: #a7b6c6; --asset-muted: #718295;
  --asset-accent: #77e6cf; --asset-success: #66d99b; --asset-danger: #ff7a86; --asset-focus: #82d9ff;
  width: 100%; height: 100vh; display: flex; overflow: hidden; color: var(--asset-text); background: var(--asset-canvas);
}
:global([data-theme="light"]) .asset-workbench { --asset-canvas: #eef3f5; --asset-surface: #fff; --asset-surface-hover: #e8f0f2; --asset-border: rgba(25,54,67,.13); --asset-border-strong: rgba(25,54,67,.28); --asset-text: #12222b; --asset-soft: #526874; --asset-muted: #7a8d96; --asset-accent: #1db592; --asset-focus: #188fb9; }
.asset-rail { width: 64px; flex: 0 0 auto; display: grid; grid-template-rows: 42px 46px 42px 42px 1fr auto; justify-items: center; gap: 10px; padding: 14px 8px; border-right: 1px solid var(--asset-border); background: var(--asset-surface); }
.asset-rail button, .asset-rail__mark { width: 40px; height: 40px; display: grid; place-items: center; border: 1px solid var(--asset-border); border-radius: 12px; color: var(--asset-soft); background: transparent; cursor: pointer; }
.asset-rail button:hover { color: var(--asset-accent); background: var(--asset-surface-hover); }
.asset-rail__mark { color: #06231c; border-color: transparent; background: var(--asset-accent); font-weight: 900; }
.asset-rail small { writing-mode: vertical-rl; color: var(--asset-muted); font: 800 8px/1 ui-monospace, monospace; letter-spacing: .17em; }
.asset-main { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.asset-header { min-height: 108px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 24px; border-bottom: 1px solid var(--asset-border); background: color-mix(in srgb, var(--asset-surface) 88%, transparent); }
.asset-kicker { color: var(--asset-accent); font-size: 9px; font-weight: 850; letter-spacing: .16em; text-transform: uppercase; }
.asset-header h1 { margin: 5px 0 3px; font-size: 25px; letter-spacing: -.035em; }
.asset-header p { margin: 0; color: var(--asset-soft); font-size: 11px; }
.asset-header__actions { display: flex; gap: 7px; }
.asset-header button, .asset-detail-header button, .asset-state button, .asset-media-empty button { min-height: 38px; padding: 0 13px; border: 1px solid color-mix(in srgb, var(--asset-accent) 35%, transparent); border-radius: 10px; color: #06231c; background: var(--asset-accent); font-size: 10px; font-weight: 750; cursor: pointer; }
.asset-header button.is-secondary { color: var(--asset-soft); border-color: var(--asset-border); background: transparent; }
.asset-header button:disabled { opacity: .4; cursor: default; }
.asset-workspace { min-height: 0; flex: 1; display: grid; grid-template-columns: 270px minmax(0, 1fr); }
.asset-library-pane { min-height: 0; display: grid; grid-template-rows: auto minmax(0,1fr) auto; gap: 12px; padding: 14px; border-right: 1px solid var(--asset-border); }
.asset-filter { display: flex; flex-wrap: wrap; gap: 4px; }
.asset-filter button { min-height: 28px; padding: 0 8px; border: 1px solid transparent; border-radius: 8px; color: var(--asset-muted); background: transparent; font-size: 9px; cursor: pointer; }
.asset-filter button:hover, .asset-filter button.is-active { color: var(--asset-text); border-color: var(--asset-border); background: var(--asset-surface-hover); }
.asset-shortcuts { margin: 0; color: var(--asset-muted); font-size: 8px; line-height: 1.45; }
.asset-detail-pane { min-width: 0; overflow: auto; padding: 20px; background: radial-gradient(circle at 45% 15%, color-mix(in srgb, var(--asset-accent) 5%, transparent), transparent 32%); }
.asset-detail-header { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 17px; }
.asset-detail-header span { color: var(--asset-accent); font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.asset-detail-header h2 { margin: 5px 0 2px; font-size: 20px; }
.asset-detail-header p { margin: 0; color: var(--asset-muted); font-size: 10px; }
.asset-state { min-height: 0; flex: 1; display: grid; place-items: center; align-content: center; gap: 12px; padding: 30px; color: var(--asset-soft); text-align: center; }
.asset-loader { width: 62px; height: 62px; display: grid; place-items: center; border: 1px solid var(--asset-border); border-radius: 20px; color: var(--asset-accent); background: var(--asset-surface); font-size: 24px; animation: asset-breathe 1.8s ease-in-out infinite; }
@keyframes asset-breathe { 50% { opacity: .55; transform: scale(.94); } }
.asset-notice { position: fixed; top: 14px; left: 50%; z-index: 50; max-width: min(620px, calc(100% - 30px)); display: flex; align-items: center; gap: 12px; padding: 9px 12px; border: 1px solid var(--asset-border); border-radius: 10px; background: var(--asset-surface); box-shadow: 0 16px 46px rgba(0,0,0,.24); font-size: 10px; transform: translateX(-50%); }
.asset-notice.is-error { color: var(--asset-danger); }.asset-notice.is-success { color: var(--asset-success); }.asset-notice button { border: 0; color: inherit; background: transparent; cursor: pointer; text-decoration: underline; }
.asset-dialog-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 18px; background: rgba(2, 6, 11, .7); backdrop-filter: blur(8px); }
.asset-dialog { width: min(520px, 100%); max-height: calc(100vh - 36px); overflow: auto; padding: 21px; border: 1px solid var(--asset-border-strong); border-radius: 18px; background: var(--asset-surface); box-shadow: 0 30px 90px rgba(0,0,0,.45); }
.asset-dialog h2 { margin: 0 0 18px; font-size: 18px; }
.asset-dialog form { display: grid; gap: 13px; }
.asset-dialog label { display: grid; gap: 6px; color: var(--asset-soft); font-size: 10px; font-weight: 700; }
.asset-dialog input, .asset-dialog select, .asset-dialog textarea { width: 100%; box-sizing: border-box; padding: 10px 11px; border: 1px solid var(--asset-border); border-radius: 10px; color: var(--asset-text); background: var(--asset-canvas); font: inherit; font-size: 12px; resize: vertical; }
.asset-dialog input:focus, .asset-dialog select:focus, .asset-dialog textarea:focus { outline: 2px solid var(--asset-focus); outline-offset: 2px; }
.asset-dialog__hint, .asset-media-empty p { color: var(--asset-soft); font-size: 11px; line-height: 1.6; }
.asset-media-empty { padding: 12px; border: 1px dashed var(--asset-border); border-radius: 10px; text-align: center; }.asset-media-empty p { margin: 0 0 8px; }
.asset-form-error { margin: 10px 0 0; color: var(--asset-danger); font-size: 10px; }
@media (max-width: 850px) { .asset-header { align-items: flex-start; flex-direction: column; }.asset-workspace { grid-template-columns: 220px minmax(0,1fr); } }
@media (max-width: 680px) { .asset-rail { width: 52px; padding-inline: 5px; }.asset-header { min-height: 134px; padding: 13px; }.asset-header p { display: none; }.asset-header__actions { width: 100%; overflow-x: auto; }.asset-workspace { grid-template-columns: 1fr; overflow: auto; }.asset-library-pane { min-height: 230px; border-right: 0; border-bottom: 1px solid var(--asset-border); }.asset-detail-pane { overflow: visible; padding: 14px; }.asset-shortcuts { display: none; } }
@media (prefers-reduced-motion: reduce) { .asset-workbench * { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
</style>
