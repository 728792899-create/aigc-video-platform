<template>
  <section class="cred-row">
    <div class="cred-head">
      <strong>{{ provider.label }}</strong>
      <el-tag v-if="provider.userConfigured" type="success" size="small" effect="plain">已存入系统凭证库</el-tag>
      <el-tag v-else-if="provider.configured" type="primary" size="small" effect="plain">运行时可用</el-tag>
      <el-tag v-else type="info" size="small" effect="plain">未配置</el-tag>
      <span v-if="provider.free" class="free-tag">有免费档</span>
    </div>
    <div class="cred-inputs">
      <template v-if="provider.auth === 'access_secret'">
        <el-input :model-value="credential.accessKey" placeholder="Access Key" size="small" show-password @update:model-value="update('accessKey', $event)" />
        <el-input :model-value="credential.secretKey" placeholder="Secret Key" size="small" show-password @update:model-value="update('secretKey', $event)" />
      </template>
      <template v-else-if="provider.key?.startsWith('volcano_tts')">
        <el-input :model-value="credential.appId" placeholder="AppID" size="small" @update:model-value="update('appId', $event)" />
        <el-input :model-value="credential.apiKey" placeholder="Access Token" size="small" show-password @update:model-value="update('apiKey', $event)" />
        <el-input :model-value="credential.cluster" placeholder="Cluster" size="small" @update:model-value="update('cluster', $event)" />
      </template>
      <template v-else>
        <el-input :model-value="credential.apiKey" placeholder="API Key" size="small" show-password @update:model-value="update('apiKey', $event)" />
        <el-input :model-value="credential.baseUrl" :placeholder="provider.baseUrl || 'Base URL'" size="small" @update:model-value="update('baseUrl', $event)" />
      </template>
      <el-button size="small" type="primary" @click="$emit('save')">保存</el-button>
      <el-button size="small" text type="danger" @click="$emit('clear')">清除</el-button>
      <el-button size="small" :loading="testing" @click="$emit('test')">测试</el-button>
      <span v-if="result" :class="['test-res', result.ok ? 'ok' : 'fail']">
        {{ result.ok ? `已连接 · ${result.latency_ms || 0}ms` : result.error }}
      </span>
    </div>
    <p class="vault-hint">密钥不会写入 settings.json、备份或日志；桌面版由系统安全存储加密保管。</p>
  </section>
</template>

<script setup>
defineProps({
  provider: { type: Object, required: true },
  credential: { type: Object, default: () => ({}) },
  testing: { type: Boolean, default: false },
  result: { type: Object, default: null },
})
const emit = defineEmits(['update-field', 'save', 'clear', 'test'])
function update(field, value) { emit('update-field', { field, value }) }
</script>

<style scoped>
.cred-row { padding:14px 0; border-bottom:1px solid var(--separator); }
.cred-row:last-child { border-bottom:0; }
.cred-head { display:flex; align-items:center; gap:8px; margin-bottom:9px; }
.cred-inputs { display:grid; grid-template-columns:repeat(2,minmax(180px,240px)) repeat(3,auto) minmax(120px,1fr); align-items:center; gap:8px; }
.free-tag { color:var(--success); font-size:12px; }
.test-res { font-size:12px; }
.test-res.ok { color:var(--success); }
.test-res.fail { color:var(--danger); }
.vault-hint { margin:8px 0 0; color:var(--text-muted); font-size:12px; }
@media(max-width:1050px){.cred-inputs{grid-template-columns:1fr 1fr}.vault-hint{grid-column:1/-1}}
</style>
