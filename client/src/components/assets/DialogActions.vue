<template>
  <div class="dialog-actions">
    <button type="button" @click="$emit('cancel')">{{ $t('assets.cancel') }}</button>
    <button type="submit" :class="{ 'is-danger': danger }" :disabled="busy || disabled" @click="emitConfirm">
      <span v-if="busy">…</span><template v-else>{{ confirmLabel }}</template>
    </button>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ confirmLabel: string; busy?: boolean; disabled?: boolean; danger?: boolean }>(), {
  busy: false, disabled: false, danger: false,
})
const emit = defineEmits<{ cancel: []; confirm: [] }>()
function emitConfirm(event: MouseEvent): void {
  if (!props.disabled && !props.busy) emit('confirm')
  if (event.currentTarget instanceof HTMLButtonElement && event.currentTarget.form) return
}
</script>

<style scoped>
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.dialog-actions button { min-height: 36px; padding: 0 13px; border: 1px solid var(--asset-border); border-radius: 9px; color: var(--asset-soft); background: transparent; font-size: 10px; font-weight: 750; cursor: pointer; }
.dialog-actions button[type="submit"] { color: #06231c; border-color: transparent; background: var(--asset-accent); }
.dialog-actions button[type="submit"].is-danger { color: white; background: var(--asset-danger); }
.dialog-actions button:disabled { opacity: .45; cursor: default; }
</style>
