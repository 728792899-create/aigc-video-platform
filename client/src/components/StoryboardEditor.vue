<template>
  <el-collapse :model-value="active" class="storyboard-collapse" @update:model-value="$emit('update:active', $event)">
    <el-collapse-item v-for="(scene, index) in scenes" :key="scene.id || index" :name="index">
      <template #title><span class="scene-title">{{ t('script.scene') }} {{ scene.scene_number }}</span><span class="scene-preview">{{ scene.description?.slice(0, 48) }}{{ scene.description?.length > 48 ? '…' : '' }}</span></template>
      <div class="scene-form">
        <div class="form-group"><label>{{ t('script.sceneNumber') }}</label><el-input-number v-model="scene.scene_number" :min="1" /></div>
        <div class="form-group"><label>{{ t('script.sceneDescription') }}</label><el-input v-model="scene.description" type="textarea" :rows="3" /></div>
        <div class="form-group">
          <label>{{ t('script.dialog') }}<el-button size="small" text type="primary" :loading="scene._expanding" @click="$emit('expand', scene)">✨ {{ t('script.expandDialog') }}</el-button></label>
          <el-input v-model="scene.dialog" type="textarea" :rows="2" />
        </div>
        <div class="form-group"><label>{{ t('script.durationSec') }}</label><el-input-number v-model="scene.duration" :min="1" :max="120" /></div>
      </div>
    </el-collapse-item>
  </el-collapse>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
defineProps({ scenes:{type:Array,default:()=>[]}, active:{type:Array,default:()=>[]} })
defineEmits(['update:active','expand'])
</script>

<style scoped>
.storyboard-collapse{border:0}.scene-title{font-weight:700;color:var(--primary);margin-right:12px}.scene-preview{color:var(--text-second);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.scene-form{padding:12px 0}.form-group{margin-bottom:12px}.form-group label{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-weight:600;color:var(--text-second)}
</style>
