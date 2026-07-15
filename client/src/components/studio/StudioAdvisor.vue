<template>
  <aside class="studio-advisor" aria-live="polite" aria-label="Director Advisor">
    <header class="studio-advisor__header">
      <span><StudioIcon name="advisor" :size="22" /></span>
      <div>
        <p>Local Director</p>
        <h2>{{ $t('studio.advisor.title') }}</h2>
      </div>
      <button type="button" :aria-label="$t('common.close')" @click="$emit('close')"><StudioIcon name="close" :size="17" /></button>
    </header>

    <div v-if="loading" class="studio-advisor__state" role="status">
      <span class="studio-advisor__loader"></span>{{ $t('studio.advisor.loading') }}
    </div>
    <div v-else-if="error" class="studio-advisor__error" role="alert">
      <StudioIcon name="warning" :size="17" />
      <p>{{ error }}</p>
      <StudioButton variant="secondary" icon="refresh" @click="$emit('refresh')">{{ $t('studio.refresh') }}</StudioButton>
    </div>
    <template v-else-if="plan">
      <div class="studio-advisor__score">
        <div><strong>{{ plan.health_score }}</strong><small>/100</small></div>
        <span><i :style="{ width: `${plan.health_score}%` }"></i></span>
        <p>{{ plan.summary }}</p>
      </div>

      <dl class="studio-advisor__facts">
        <div><dt>{{ $t('studio.advisor.shots') }}</dt><dd>{{ plan.evidence.shots }}</dd></div>
        <div><dt>{{ $t('studio.advisor.skills') }}</dt><dd>{{ plan.evidence.active_skills }}</dd></div>
        <div><dt>{{ $t('studio.advisor.tasks') }}</dt><dd>{{ plan.evidence.running_tasks }}/{{ plan.evidence.failed_tasks }}</dd></div>
      </dl>

      <section class="studio-advisor__actions">
        <div class="studio-advisor__section-title">
          <h3>{{ $t('studio.advisor.actions') }}</h3>
          <button v-if="plan.actions.length > 3" type="button" @click="expanded = !expanded">
            {{ expanded ? $t('studio.advisor.less') : $t('studio.advisor.more', { count: plan.actions.length }) }}
          </button>
        </div>
        <ol>
          <li v-for="item in visibleActions" :key="item.id" :class="`risk-${item.risk}`">
            <div class="studio-advisor__action-title">
              <span>{{ item.priority }}</span>
              <strong>{{ item.title }}</strong>
              <small v-if="item.risk !== 'none'">{{ $t(`studio.advisor.risk.${item.risk}`) }}</small>
            </div>
            <p>{{ item.reason }}</p>
            <div v-if="pendingActionId === item.id" class="studio-advisor__confirm" role="alert">
              <p>{{ $t('studio.advisor.confirm') }}</p>
              <button type="button" @click="pendingActionId = ''">{{ $t('common.cancel') }}</button>
              <button type="button" @click="openConfirmed(item)">{{ $t('studio.advisor.continue') }}</button>
            </div>
            <StudioButton v-else variant="secondary" icon="chevron" @click="open(item)">
              {{ $t('studio.advisor.open') }}
            </StudioButton>
          </li>
        </ol>
        <p v-if="!plan.actions.length" class="studio-advisor__complete"><StudioIcon name="check" :size="17" />{{ $t('studio.advisor.complete') }}</p>
      </section>

      <footer>
        <span>{{ plan.plan_id }}</span>
        <button type="button" @click="$emit('open', '/skills')">{{ $t('studio.advisor.manageSkills') }}</button>
      </footer>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DirectorAdviceAction, DirectorAdvicePlan } from '@aigc-video/contracts'

import StudioButton from './StudioButton.vue'
import StudioIcon from './StudioIcon.vue'

const props = defineProps<{
  plan: DirectorAdvicePlan | null
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  refresh: []
  open: [route: string]
}>()

const expanded = ref(false)
const pendingActionId = ref('')
const visibleActions = computed(() => props.plan?.actions.slice(0, expanded.value ? undefined : 3) ?? [])

function open(item: DirectorAdviceAction): void {
  if (item.requires_confirmation) {
    pendingActionId.value = item.id
    return
  }
  emit('open', item.route)
}

function openConfirmed(item: DirectorAdviceAction): void {
  pendingActionId.value = ''
  emit('open', item.route)
}
</script>

<style scoped>
.studio-advisor { width: 340px; height: 100%; flex: 0 0 auto; padding: 20px; overflow-y: auto; border-left: 1px solid var(--studio-border); color: var(--studio-text); background: color-mix(in srgb, var(--studio-surface) 95%, transparent); }
.studio-advisor__header { display: grid; grid-template-columns: 42px 1fr 30px; align-items: center; gap: 10px; }
.studio-advisor__header > span { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 14px; color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 12%, transparent); }
.studio-advisor__header p, .studio-advisor__header h2 { margin: 0; }
.studio-advisor__header p { color: var(--studio-text-muted); font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.studio-advisor__header h2 { margin-top: 3px; font-size: 17px; }
.studio-advisor__header button { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 9px; color: var(--studio-text-muted); background: transparent; cursor: pointer; }
.studio-advisor__state { display: flex; align-items: center; gap: 9px; margin-top: 28px; color: var(--studio-text-soft); font-size: 12px; }
.studio-advisor__loader { width: 14px; height: 14px; border: 2px solid var(--studio-border-strong); border-right-color: var(--studio-accent); border-radius: 50%; animation: advisor-spin .8s linear infinite; }
@keyframes advisor-spin { to { transform: rotate(360deg); } }
.studio-advisor__error { display: grid; gap: 12px; margin-top: 22px; padding: 14px; border: 1px solid color-mix(in srgb, var(--studio-danger) 35%, transparent); border-radius: 13px; color: var(--studio-danger); }
.studio-advisor__error p { margin: 0; color: var(--studio-text-soft); font-size: 12px; line-height: 1.55; }
.studio-advisor__score { margin-top: 22px; padding: 15px; border: 1px solid var(--studio-border); border-radius: 14px; background: var(--studio-surface-strong); }
.studio-advisor__score > div { display: flex; align-items: baseline; gap: 3px; }
.studio-advisor__score strong { font-size: 28px; letter-spacing: -.05em; }
.studio-advisor__score small { color: var(--studio-text-muted); }
.studio-advisor__score > span { height: 5px; display: block; margin: 9px 0 12px; overflow: hidden; border-radius: 999px; background: var(--studio-border); }
.studio-advisor__score i { height: 100%; display: block; border-radius: inherit; background: var(--studio-accent); }
.studio-advisor__score p { margin: 0; color: var(--studio-text-soft); font-size: 11px; line-height: 1.55; }
.studio-advisor__facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 10px 0 0; }
.studio-advisor__facts div { padding: 9px; border: 1px solid var(--studio-border); border-radius: 10px; background: var(--studio-surface); }
.studio-advisor__facts dt { color: var(--studio-text-muted); font-size: 9px; }
.studio-advisor__facts dd { margin: 4px 0 0; font-size: 12px; font-weight: 750; }
.studio-advisor__section-title { display: flex; align-items: center; justify-content: space-between; margin: 22px 0 10px; }
.studio-advisor__section-title h3 { margin: 0; font-size: 12px; }
.studio-advisor__section-title button, .studio-advisor footer button { border: 0; color: var(--studio-accent); background: transparent; font-size: 10px; cursor: pointer; }
.studio-advisor__actions ol { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.studio-advisor__actions li { padding: 12px; border: 1px solid var(--studio-border); border-radius: 12px; background: var(--studio-surface-strong); }
.studio-advisor__actions li.risk-cost { border-color: color-mix(in srgb, var(--studio-warning) 30%, var(--studio-border)); }
.studio-advisor__action-title { display: grid; grid-template-columns: 26px 1fr auto; align-items: center; gap: 7px; }
.studio-advisor__action-title > span { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; color: var(--studio-accent); background: color-mix(in srgb, var(--studio-accent) 10%, transparent); font: 700 9px/1 ui-monospace, monospace; }
.studio-advisor__action-title strong { font-size: 12px; }
.studio-advisor__action-title small { color: var(--studio-warning); font-size: 8px; }
.studio-advisor__actions li > p { margin: 9px 0 11px; color: var(--studio-text-muted); font-size: 10px; line-height: 1.55; }
.studio-advisor__actions :deep(.studio-button) { width: 100%; min-height: 33px; font-size: 10px; }
.studio-advisor__confirm { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 9px; border-radius: 9px; background: color-mix(in srgb, var(--studio-warning) 9%, transparent); }
.studio-advisor__confirm p { grid-column: 1 / -1; margin: 0 0 3px; color: var(--studio-text-soft); font-size: 9px; line-height: 1.45; }
.studio-advisor__confirm button { min-height: 29px; border: 1px solid var(--studio-border); border-radius: 8px; color: var(--studio-text); background: transparent; cursor: pointer; }
.studio-advisor__confirm button:last-child { color: #061019; border-color: var(--studio-accent); background: var(--studio-accent); }
.studio-advisor__complete { display: flex; gap: 8px; color: var(--studio-success); font-size: 11px; }
.studio-advisor footer { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; color: var(--studio-text-muted); font: 9px/1.4 ui-monospace, monospace; }
</style>
