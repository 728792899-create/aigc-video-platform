<template>
  <section class="publisher-trust" aria-labelledby="publisher-trust-title">
    <div class="publisher-trust__header">
      <div>
        <p class="eyebrow">PLUGIN TRUST</p>
        <h3 id="publisher-trust-title">发布者信任</h3>
      </div>
      <span>{{ publishers.filter((publisher) => publisher.state === 'trusted').length }} 个受信发布者</span>
    </div>
    <p class="publisher-trust__note">只接受 Ed25519 SPKI 公钥。信任发布者不会自动启用插件，沙箱测试与全局 enable 门禁仍然有效。</p>

    <ul v-if="publishers.length" class="publisher-list">
      <li v-for="publisher in publishers" :key="publisher.id">
        <span>
          <strong>{{ publisher.displayName }}</strong>
          <small>{{ publisher.keyId }} · {{ publisher.state === 'trusted' ? '已信任' : '已撤销' }} · {{ shortFingerprint(publisher.publicKeyFingerprint) }}</small>
        </span>
        <button
          v-if="publisher.state === 'trusted'"
          type="button"
          :disabled="busy"
          @click="revokePublisher(publisher)"
        >{{ revokeConfirm === publisher.id ? '再次点击撤销' : '撤销信任' }}</button>
      </li>
    </ul>
    <p v-else class="publisher-trust__empty">当前没有本地受信发布者。</p>

    <div class="publisher-form">
      <label>发布者 ID<input v-model.trim="draft.keyId" autocomplete="off" placeholder="publisher.example" /></label>
      <label>显示名称<input v-model.trim="draft.displayName" autocomplete="off" placeholder="发布者名称" /></label>
      <label class="publisher-form__key">Ed25519 SPKI PEM<textarea v-model.trim="draft.publicKeyPem" rows="4" autocomplete="off" spellcheck="false" placeholder="-----BEGIN PUBLIC KEY-----" /></label>
      <button type="button" :disabled="busy || !draftReady" @click="trustPublisher">
        {{ busy ? '正在校验…' : trustConfirm ? '再次点击信任发布者' : '准备信任发布者' }}
      </button>
    </div>
    <p v-if="error" class="runtime-card__error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { ProviderPublisherTrust } from '@aigc-director/contracts'
import { directorApi } from '../api/client.js'

const props = defineProps<{ active: boolean }>()
const publishers = ref<ProviderPublisherTrust[]>([])
const busy = ref(false)
const error = ref('')
const trustConfirm = ref(false)
const revokeConfirm = ref('')
const draft = reactive({ keyId: '', displayName: '', publicKeyPem: '' })
const draftReady = computed(() => /^[a-z][a-z0-9._-]{2,80}$/u.test(draft.keyId) && draft.displayName.length > 0 && draft.publicKeyPem.includes('BEGIN PUBLIC KEY'))
const shortFingerprint = (fingerprint: string): string => `${fingerprint.slice(0, 12)}…${fingerprint.slice(-8)}`

function replacePublisher(publisher: ProviderPublisherTrust): void {
  const index = publishers.value.findIndex((current) => current.id === publisher.id)
  if (index < 0) publishers.value = [publisher, ...publishers.value]
  else publishers.value = publishers.value.map((current) => current.id === publisher.id ? publisher : current)
}

async function trustPublisher(): Promise<void> {
  if (!trustConfirm.value) { trustConfirm.value = true; error.value = ''; return }
  busy.value = true
  error.value = ''
  try {
    replacePublisher(await directorApi.trustProviderPublisher({ ...draft }))
    draft.keyId = ''
    draft.displayName = ''
    draft.publicKeyPem = ''
    trustConfirm.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '发布者公钥校验失败。'
  } finally { busy.value = false }
}

async function revokePublisher(publisher: ProviderPublisherTrust): Promise<void> {
  if (revokeConfirm.value !== publisher.id) { revokeConfirm.value = publisher.id; error.value = ''; return }
  busy.value = true
  error.value = ''
  try {
    replacePublisher(await directorApi.revokeProviderPublisher(publisher.id, publisher.revision))
    revokeConfirm.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '发布者信任撤销失败。'
    publishers.value = await directorApi.listProviderPublishers().catch(() => publishers.value)
  } finally { busy.value = false }
}

watch(() => props.active, async (active) => {
  if (!active) return
  error.value = ''
  trustConfirm.value = false
  revokeConfirm.value = ''
  publishers.value = await directorApi.listProviderPublishers().catch((cause) => {
    error.value = cause instanceof Error ? cause.message : '发布者信任列表加载失败。'
    return []
  })
}, { immediate: true })
</script>
