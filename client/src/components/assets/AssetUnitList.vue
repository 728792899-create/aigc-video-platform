<template>
  <div class="asset-unit-list" role="listbox" :aria-label="$t('assets.library')">
    <button
      v-for="unit in units"
      :key="String(unit.id)"
      type="button"
      role="option"
      :aria-selected="String(unit.id) === activeId"
      :class="{ 'is-active': String(unit.id) === activeId }"
      @click="$emit('select', unit)"
    >
      <span class="asset-unit-list__type">{{ $t(`assets.type.${unit.asset_type}`) }}</span>
      <strong>{{ unit.name }}</strong>
      <small>
        {{ $t(`assets.scope.${unit.scope}`) }}
        · {{ $t('assets.variantCount', { count: unit.variants.length }) }}
      </small>
      <small v-if="unit.forked_from_unit_id" class="asset-unit-list__lineage">↳ {{ $t('assets.forkedFromSeries') }}</small>
      <span v-if="unit.selected_variant_id" class="asset-unit-list__ready" aria-hidden="true"></span>
    </button>
    <div v-if="!units.length" class="asset-unit-list__empty">
      <span>◇</span>
      <p>{{ $t('assets.noMatchingAssets') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AssetUnit } from '@aigc-video/contracts'

defineProps<{ units: AssetUnit[]; activeId: string }>()
defineEmits<{ select: [unit: AssetUnit] }>()
</script>

<style scoped>
.asset-unit-list { display: grid; align-content: start; gap: 8px; overflow: auto; }
.asset-unit-list > button { position: relative; display: grid; gap: 5px; padding: 13px 14px; border: 1px solid var(--asset-border); border-radius: 13px; color: var(--asset-text); background: var(--asset-surface); text-align: left; cursor: pointer; }
.asset-unit-list > button:hover { border-color: var(--asset-border-strong); background: var(--asset-surface-hover); }
.asset-unit-list > button:focus-visible { outline: 2px solid var(--asset-focus); outline-offset: 2px; }
.asset-unit-list > button.is-active { border-color: color-mix(in srgb, var(--asset-accent) 65%, transparent); background: color-mix(in srgb, var(--asset-accent) 8%, var(--asset-surface)); }
.asset-unit-list__type { color: var(--asset-accent); font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.asset-unit-list strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.asset-unit-list small { color: var(--asset-muted); font-size: 10px; }
.asset-unit-list__lineage { color: var(--asset-accent) !important; }
.asset-unit-list__ready { position: absolute; top: 13px; right: 13px; width: 7px; height: 7px; border-radius: 50%; background: var(--asset-success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--asset-success) 12%, transparent); }
.asset-unit-list__empty { min-height: 180px; display: grid; place-items: center; align-content: center; gap: 8px; color: var(--asset-muted); text-align: center; }
.asset-unit-list__empty span { font-size: 28px; color: var(--asset-accent); }
.asset-unit-list__empty p { margin: 0; font-size: 12px; }
</style>
