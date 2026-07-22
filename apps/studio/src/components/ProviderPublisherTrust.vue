<template>
  <section class="publisher-trust" aria-labelledby="publisher-trust-title">
    <div class="publisher-trust__header">
      <div>
        <p class="eyebrow">SAFE PROVIDER CONTRACT</p>
        <h3 id="publisher-trust-title">可执行插件已封存</h3>
      </div>
      <span>不可启用</span>
    </div>
    <p class="publisher-trust__note">
      工作台不上传或执行第三方 JavaScript/Python。扩展 Provider 只能使用内置适配器，
      或在固定 HTTPS 端点与严格字段映射范围内创建声明式连接。
    </p>
    <div class="publisher-trust__replacement" role="note">
      <strong>推荐替代路径</strong>
      <span>前往 Provider 市场创建 OpenAI-compatible 或声明式 HTTP 连接，并先完成脱敏连通性测试。</span>
    </div>
  </section>
</template>

<style scoped>
.publisher-trust { display: grid; gap: 14px; padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.publisher-trust__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.publisher-trust__header h3 { margin: 2px 0 0; }
.publisher-trust__header > span { padding: 5px 9px; border-radius: 999px; color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); font-size: 12px; font-weight: 700; }
.publisher-trust__note { margin: 0; color: var(--muted); line-height: 1.6; }
.publisher-trust__replacement { display: grid; gap: 5px; padding: 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--panel-soft); }
.publisher-trust__replacement span { color: var(--muted); line-height: 1.55; }
</style>
