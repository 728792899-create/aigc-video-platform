<template>
  <transition name="np-fade">
    <div v-if="visible" class="nprogress-bar" :style="{ width: percent + '%' }">
      <div class="nprogress-peg"></div>
    </div>
  </transition>
</template>

<script setup>
import { ref } from 'vue'

const visible = ref(false)
const percent = ref(0)
let timer = null

function start() {
  clearInterval(timer)
  visible.value = true
  percent.value = 8
  // 缓动逼近 90%，但永不到顶，等 done() 收尾
  timer = setInterval(() => {
    const remain = 90 - percent.value
    if (remain > 0) percent.value += Math.max(0.4, remain * 0.08)
  }, 200)
}

function done() {
  clearInterval(timer)
  percent.value = 100
  setTimeout(() => {
    visible.value = false
    percent.value = 0
  }, 280)
}

defineExpose({ start, done })
</script>

<style scoped>
.nprogress-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  z-index: 3000;
  background: var(--gradient-brand);
  box-shadow: 0 0 10px rgba(0, 122, 255, 0.5);
  transition: width 0.2s var(--ease-apple);
}
.nprogress-peg {
  position: absolute;
  right: 0;
  width: 100px;
  height: 100%;
  box-shadow: 0 0 14px var(--primary), 0 0 6px var(--primary);
  opacity: 0.7;
  transform: rotate(3deg) translate(0, -2px);
}
.np-fade-leave-active { transition: opacity 0.3s var(--ease-apple); }
.np-fade-leave-to { opacity: 0; }
</style>
