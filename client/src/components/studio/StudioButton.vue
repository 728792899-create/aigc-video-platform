<template>
  <button
    class="studio-button"
    :class="[`studio-button--${variant}`, { 'is-icon': iconOnly, 'is-active': pressed }]"
    :type="type"
    :disabled="disabled || loading"
    :aria-pressed="pressed === undefined ? undefined : pressed"
  >
    <span v-if="loading" class="studio-button__spinner" aria-hidden="true"></span>
    <StudioIcon v-else-if="icon" :name="icon" :size="iconOnly ? 19 : 17" />
    <span v-if="!iconOnly" class="studio-button__label"><slot /></span>
  </button>
</template>

<script setup lang="ts">
import StudioIcon, { type StudioIconName } from './StudioIcon.vue'

withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: StudioIconName
  iconOnly?: boolean
  loading?: boolean
  disabled?: boolean
  pressed?: boolean
  type?: 'button' | 'submit' | 'reset'
}>(), {
  variant: 'secondary',
  icon: undefined,
  iconOnly: false,
  loading: false,
  disabled: false,
  pressed: undefined,
  type: 'button',
})
</script>

<style scoped>
.studio-button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 11px;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  color: var(--studio-text);
  background: transparent;
  cursor: pointer;
  transition: 150ms ease;
}
.studio-button:hover:not(:disabled) { transform: translateY(-1px); }
.studio-button:active:not(:disabled) { transform: translateY(0) scale(.98); }
.studio-button:focus-visible { outline: 2px solid var(--studio-focus); outline-offset: 2px; }
.studio-button:disabled { cursor: not-allowed; opacity: .45; }
.studio-button--primary { color: #061019; background: var(--studio-accent); box-shadow: 0 8px 24px color-mix(in srgb, var(--studio-accent) 24%, transparent); }
.studio-button--primary:hover:not(:disabled) { background: var(--studio-accent-strong); }
.studio-button--secondary { border-color: var(--studio-border); background: var(--studio-surface-strong); }
.studio-button--secondary:hover:not(:disabled), .studio-button--secondary.is-active { border-color: var(--studio-border-strong); background: var(--studio-surface-hover); }
.studio-button--ghost:hover:not(:disabled), .studio-button--ghost.is-active { background: var(--studio-surface-hover); }
.studio-button--danger { color: var(--studio-danger); border-color: color-mix(in srgb, var(--studio-danger) 35%, transparent); }
.studio-button.is-icon { width: 38px; padding: 0; }
.studio-button__spinner { width: 15px; height: 15px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: studio-spin .8s linear infinite; }
@keyframes studio-spin { to { transform: rotate(360deg); } }
</style>
