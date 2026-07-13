const base = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const token = process.env.API_TOKEN || '';

const response = await fetch(`${base}/api/system/image-success-rate`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const payload = await response.json().catch(() => ({}));
if (!response.ok || !payload.data) {
  throw new Error(`读取统计失败：HTTP ${response.status} ${payload.message || ''}`.trim());
}

const data = payload.data;
console.log('=== 图片生成成功率报告 ===');
console.log(`样本总数: ${data.total}`);
console.log(`首次出图成功率（未降级直接成功）: ${data.first_attempt_rate}%  (${data.first_attempt_success}/${data.total})`);
console.log(`最终真实出图率（排除占位图）: ${data.final_real_rate}%  (${data.final_real_success}/${data.total})`);
console.log(`占位兜底占比: ${data.placeholder_rate}%  (${data.placeholder_count}/${data.total})`);
console.table(data.by_model);
console.log('按最终 Provider 汇总：');
console.table(data.by_provider || []);
