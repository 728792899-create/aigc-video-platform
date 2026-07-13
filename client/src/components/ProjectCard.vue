<template>
  <article class="project-card" tabindex="0" @click="$emit('open')" @keydown.enter="$emit('open')">
    <div class="card-thumb" :class="`thumb-${project.status}`" :style="!project.cover_url ? coverStyle : null">
      <img v-if="project.cover_url" :src="mediaUrl(project.cover_url)" class="cover-img" loading="lazy" :alt="project.name" @error="$emit('cover-error')" />
      <span v-else class="cover-initial">{{ initial }}</span>
      <button class="cover-gen-btn" :class="{ 'is-loading': coverLoading }" @click.stop="$emit('generate-cover')">
        <el-icon v-if="coverLoading" class="spin"><Loading /></el-icon><el-icon v-else><MagicStick /></el-icon>
        {{ coverLoading ? '生成中' : project.cover_url ? '换封面' : '生成封面' }}
      </button>
    </div>
    <div class="card-header"><span class="project-name">{{ project.name }}</span><span class="status-badge" :class="`badge-${project.status}`"><span class="badge-dot"></span>{{ statusText }}</span></div>
    <div class="card-body">
      <p>主题：{{ project.theme || '未设置' }}</p><p>风格：{{ project.style || '未设置' }}</p><p>时长：{{ durationText }}</p>
      <div v-if="project.series_id" class="continuity-chip"><span class="asset-dot"></span>系列第 {{ project.episode_index || 1 }} 集</div>
      <div v-if="project.asset_health" class="asset-health" :class="`asset-${healthStatus}`" :title="healthTitle"><span class="asset-dot"></span>{{ healthText }}</div>
    </div>
    <div class="card-footer">
      <span class="time-info">{{ relativeTime }}</span>
      <div class="card-actions" @click.stop>
        <el-button size="small" text @click="$emit('edit')"><el-icon><Edit /></el-icon></el-button>
        <el-button size="small" text type="success" @click="$emit('complete-check')">检查</el-button>
        <el-button size="small" text type="primary" @click="$emit('continue')">续写</el-button>
        <el-button size="small" text @click="$emit('series')">系列</el-button>
        <el-button size="small" text type="danger" @click="$emit('delete')"><el-icon><Delete /></el-icon></el-button>
      </div>
    </div>
  </article>
</template>

<script setup>
import { Loading, MagicStick, Edit, Delete } from '@element-plus/icons-vue'
import { mediaUrl } from '../api/config'
defineProps({ project:{type:Object,required:true}, coverStyle:{type:Object,default:null}, initial:{type:String,default:''}, coverLoading:Boolean, statusText:String, durationText:String, relativeTime:String, healthStatus:String, healthText:String, healthTitle:String })
defineEmits(['open','cover-error','generate-cover','edit','complete-check','continue','series','delete'])
</script>

<style scoped>
.project-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;cursor:pointer;display:flex;flex-direction:column;box-shadow:var(--shadow-sm);transition:.25s}.project-card:hover,.project-card:focus{transform:translateY(-4px);box-shadow:var(--shadow-lg);outline:none}.card-thumb{position:relative;overflow:hidden;height:110px;border-radius:var(--radius-md);margin-bottom:14px;display:grid;place-items:center;background:linear-gradient(135deg,#e3effe,#f3e8ff)}.cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:.3s}.project-card:hover .cover-img{transform:scale(1.06)}.cover-initial{font-size:44px;font-weight:800;color:#fff;text-shadow:0 2px 8px #0003}.cover-gen-btn{position:absolute;right:8px;bottom:8px;display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;border:1px solid #fff5;background:#0007;color:#fff;opacity:0;cursor:pointer}.project-card:hover .cover-gen-btn,.cover-gen-btn.is-loading,.project-card:focus .cover-gen-btn{opacity:1}.spin{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.card-header,.card-footer{display:flex;justify-content:space-between;align-items:center;gap:8px}.project-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status-badge,.continuity-chip,.asset-health{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:3px 9px;border-radius:999px}.badge-dot,.asset-dot{width:6px;height:6px;border-radius:50%;background:currentColor}.badge-completed,.badge-ready,.asset-ok{color:var(--success);background:#34c7591a}.badge-draft,.badge-partial,.asset-warn{color:var(--warning);background:#ff9f0a1f}.badge-generating{color:var(--primary);background:var(--primary-soft)}.badge-failed,.asset-error{color:var(--danger);background:#ff3b301a}.card-body{flex:1;margin:10px 0 12px}.card-body p{margin:5px 0;font-size:13px;color:var(--text-second)}.continuity-chip{color:var(--primary);background:var(--primary-soft);margin-top:7px}.asset-health{margin-top:7px}.card-footer{border-top:1px solid var(--separator);padding-top:12px}.time-info{font-size:12px;color:var(--text-muted)}.card-actions{display:flex;gap:2px}
</style>
