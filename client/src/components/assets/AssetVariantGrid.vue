<template>
  <div v-if="unit" class="asset-variant-grid" role="list" :aria-label="$t('assets.variants')">
    <article
      v-for="variant in visibleVariants"
      :key="String(variant.id)"
      role="listitem"
      tabindex="0"
      :class="{ 'is-selected': variant.selected, 'is-bound': bindingCount(variant.id) > 0 }"
      :aria-label="variantAriaLabel(variant)"
      @keydown.enter.prevent="$emit('select', variant)"
      @keydown.b.prevent="$emit('bind', variant)"
      @keydown.delete.prevent="$emit('archive', variant)"
    >
      <div class="asset-variant-grid__media">
        <audio v-if="isAudio && previewUrl(variant)" :src="previewUrl(variant)" controls preload="metadata" @error="markBroken(variant.id)"></audio>
        <img v-else-if="previewUrl(variant)" :src="previewUrl(variant)" alt="" loading="lazy" @error="markBroken(variant.id)" />
        <div v-else class="asset-variant-grid__fallback" aria-hidden="true">{{ unit.asset_type.slice(0, 2).toUpperCase() }}</div>
        <span v-if="variant.selected" class="asset-variant-grid__selected">{{ $t('assets.selected') }}</span>
        <span v-if="bindingCount(variant.id)" class="asset-variant-grid__bindings">
          {{ $t('assets.boundShots', { count: bindingCount(variant.id) }) }}
        </span>
      </div>
      <div class="asset-variant-grid__body">
        <div>
          <strong>{{ variant.label || `Revision ${variant.revision}` }}</strong>
          <span>R{{ variant.revision }}</span>
        </div>
        <p>{{ variant.prompt || $t('assets.noPrompt') }}</p>
        <small>{{ variant.provider || $t('assets.localMedia') }}<template v-if="variant.model"> · {{ variant.model }}</template></small>
      </div>
      <div class="asset-variant-grid__actions">
        <button type="button" :disabled="variant.selected" @click="$emit('select', variant)">{{ $t('assets.useVariant') }}</button>
        <button type="button" @click="$emit('bind', variant)">{{ $t('assets.bindShot') }}</button>
        <button type="button" class="is-danger" @click="$emit('archive', variant)">{{ $t('assets.archive') }}</button>
      </div>
    </article>
    <div v-if="!visibleVariants.length" class="asset-variant-grid__empty">
      <span>▧</span>
      <h3>{{ $t('assets.noVariants') }}</h3>
      <p>{{ $t(isAudio ? 'assets.noAudioVariantsHint' : 'assets.noVariantsHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AssetBinding, AssetUnit, AssetVariant } from '@aigc-video/contracts'
import { computed, ref } from 'vue'

const props = defineProps<{ unit: AssetUnit | null; bindings: AssetBinding[] }>()
defineEmits<{
  select: [variant: AssetVariant]
  bind: [variant: AssetVariant]
  archive: [variant: AssetVariant]
}>()

const broken = ref(new Set<string>())
const visibleVariants = computed(() => props.unit?.variants.filter((variant) => variant.status !== 'archived') ?? [])
const isAudio = computed(() => props.unit?.asset_type === 'voice' || props.unit?.asset_type === 'music')

function bindingCount(id: string | number): number {
  return props.bindings.filter((binding) => String(binding.variant_id) === String(id)).length
}

function variantAriaLabel(variant: AssetVariant): string {
  return `${variant.label || 'Variant'}, revision ${variant.revision}${variant.selected ? ', selected' : ''}`
}

function previewUrl(variant: AssetVariant): string {
  if (broken.value.has(String(variant.id))) return ''
  return variant.media_reference.url || ''
}

function markBroken(id: string | number): void {
  broken.value = new Set([...broken.value, String(id)])
}
</script>

<style scoped>
.asset-variant-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); align-content: start; gap: 13px; padding: 2px; }
.asset-variant-grid article { min-width: 0; overflow: hidden; border: 1px solid var(--asset-border); border-radius: 15px; background: var(--asset-surface); transition: border-color .15s ease, transform .15s ease; }
.asset-variant-grid article:hover { border-color: var(--asset-border-strong); transform: translateY(-1px); }
.asset-variant-grid article:focus-visible { outline: 2px solid var(--asset-focus); outline-offset: 2px; }
.asset-variant-grid article.is-selected { border-color: color-mix(in srgb, var(--asset-accent) 65%, transparent); }
.asset-variant-grid__media { position: relative; aspect-ratio: 16 / 10; display: grid; place-items: center; overflow: hidden; background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--asset-accent) 18%, transparent), transparent 45%), #080d14; }
.asset-variant-grid__media img { width: 100%; height: 100%; object-fit: cover; }
.asset-variant-grid__media audio { width: calc(100% - 24px); }
.asset-variant-grid__fallback { color: color-mix(in srgb, var(--asset-accent) 75%, transparent); font: 800 30px/1 ui-monospace, monospace; letter-spacing: -.08em; }
.asset-variant-grid__selected, .asset-variant-grid__bindings { position: absolute; top: 9px; padding: 4px 7px; border-radius: 999px; font-size: 9px; font-weight: 800; backdrop-filter: blur(12px); }
.asset-variant-grid__selected { left: 9px; color: #06231c; background: var(--asset-accent); }
.asset-variant-grid__bindings { right: 9px; color: var(--asset-text); background: rgba(7, 12, 18, .72); }
.asset-variant-grid__body { display: grid; gap: 7px; padding: 12px 13px; }
.asset-variant-grid__body > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.asset-variant-grid__body strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.asset-variant-grid__body span { flex: 0 0 auto; color: var(--asset-accent); font: 750 9px/1 ui-monospace, monospace; }
.asset-variant-grid__body p { min-height: 29px; display: -webkit-box; overflow: hidden; margin: 0; color: var(--asset-soft); font-size: 10px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.asset-variant-grid__body small { color: var(--asset-muted); font-size: 9px; }
.asset-variant-grid__actions { display: grid; grid-template-columns: 1fr 1fr auto; gap: 5px; padding: 0 10px 10px; }
.asset-variant-grid__actions button { min-height: 31px; padding: 0 8px; border: 1px solid var(--asset-border); border-radius: 8px; color: var(--asset-soft); background: transparent; font-size: 9px; cursor: pointer; }
.asset-variant-grid__actions button:hover:not(:disabled) { color: var(--asset-text); background: var(--asset-surface-hover); }
.asset-variant-grid__actions button:disabled { opacity: .42; cursor: default; }
.asset-variant-grid__actions .is-danger { color: var(--asset-danger); }
.asset-variant-grid__empty { grid-column: 1 / -1; min-height: 260px; display: grid; place-items: center; align-content: center; gap: 8px; color: var(--asset-muted); text-align: center; }
.asset-variant-grid__empty span { color: var(--asset-accent); font-size: 34px; }
.asset-variant-grid__empty h3, .asset-variant-grid__empty p { margin: 0; }
.asset-variant-grid__empty h3 { color: var(--asset-text); font-size: 15px; }
.asset-variant-grid__empty p { font-size: 11px; }
@media (max-width: 680px) { .asset-variant-grid { grid-template-columns: 1fr; } }
</style>
