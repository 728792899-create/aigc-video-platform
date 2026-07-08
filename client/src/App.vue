<template>
  <el-config-provider :locale="elLocale">
  <div class="app-container">
    <!-- 窄屏汉堡按钮（仅移动端显示） -->
    <button class="mobile-menu-btn" @click="sidebarOpen = true" :title="$t('nav.menu')">
      <el-icon :size="20"><Expand /></el-icon>
    </button>
    <!-- 窄屏遮罩：点击关闭抽屉 -->
    <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>
    <el-container class="main-container">
      <!-- 左侧导航 -->
      <el-aside v-if="showSidebar" width="220px" class="sidebar" :class="{ 'is-open': sidebarOpen }">
        <div class="logo">
          <svg class="logo-mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-label="logo">
            <!-- 左垂耳 -->
            <path d="M22 22 C9 19 5 35 10 47 C15 48 21 39 24 29 Z" fill="currentColor"/>
            <!-- 右垂耳 -->
            <path d="M42 22 C55 19 59 35 54 47 C49 48 43 39 40 29 Z" fill="currentColor"/>
            <!-- 头部 -->
            <ellipse cx="32" cy="30" rx="15.5" ry="14" fill="var(--bg-surface)" stroke="currentColor" stroke-width="2.4"/>
            <!-- 口鼻部 -->
            <ellipse cx="32" cy="38" rx="8.5" ry="6.8" fill="var(--bg-surface)" stroke="currentColor" stroke-width="2"/>
            <!-- 鼻子 -->
            <ellipse cx="32" cy="34.5" rx="3.6" ry="2.9" fill="currentColor"/>
            <!-- 眼睛 -->
            <circle cx="26.5" cy="26" r="1.7" fill="currentColor"/>
            <circle cx="37.5" cy="26" r="1.7" fill="currentColor"/>
            <!-- 嘴 -->
            <path d="M32 37.2 C32 41.5 28.5 43 26 41.8 M32 37.2 C32 41.5 35.5 43 38 41.8"
                  fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>{{ $t('nav.brand') }}</span>
          <button class="theme-toggle" :title="theme === 'dark' ? $t('nav.toLight') : $t('nav.toDark')" @click="toggle">
            <el-icon :size="17"><Moon v-if="theme === 'light'" /><Sunny v-else /></el-icon>
          </button>
        </div>
        <el-menu
          :default-active="activeMenu"
          class="side-menu"
          router
          @select="sidebarOpen = false"
        >
          <el-menu-item index="/">
            <el-icon><HomeFilled /></el-icon>
            <span>{{ $t('nav.dashboard') }}</span>
          </el-menu-item>
          <el-menu-item index="/projects">
            <el-icon><FolderOpened /></el-icon>
            <span>{{ $t('nav.projects') }}</span>
          </el-menu-item>
          <div v-if="currentProjectId" class="project-nav-group">
            <div class="project-nav-title">{{ $t('nav.currentProject') }}</div>
            <el-menu-item class="project-menu-item" :index="`/projects/${currentProjectId}/script`">
              <el-icon><EditPen /></el-icon>
              <span>{{ $t('nav.script') }}</span>
            </el-menu-item>
            <el-menu-item class="project-menu-item" :index="`/projects/${currentProjectId}/images`">
              <el-icon><PictureFilled /></el-icon>
              <span>{{ $t('nav.images') }}</span>
            </el-menu-item>
            <el-menu-item class="project-menu-item" :index="`/projects/${currentProjectId}/audio`">
              <el-icon><Microphone /></el-icon>
              <span>{{ $t('nav.audio') }}</span>
            </el-menu-item>
            <el-menu-item class="project-menu-item" :index="`/projects/${currentProjectId}/preview`">
              <el-icon><VideoPlay /></el-icon>
              <span>{{ $t('nav.preview') }}</span>
            </el-menu-item>
          </div>
          <el-menu-item index="/history">
            <el-icon><Clock /></el-icon>
            <span>{{ $t('nav.history') }}</span>
          </el-menu-item>
          <el-menu-item index="/files">
            <el-icon><Files /></el-icon>
            <span>{{ $t('nav.files') }}</span>
          </el-menu-item>
          <el-menu-item index="/library">
            <el-icon><Film /></el-icon>
            <span>{{ $t('nav.library') }}</span>
          </el-menu-item>
          <el-menu-item index="/skills">
            <el-icon><MagicStick /></el-icon>
            <span>{{ $t('nav.skills') }}</span>
          </el-menu-item>
          <el-menu-item index="/trash">
            <el-icon><DeleteFilled /></el-icon>
            <span>{{ $t('nav.trash') }}</span>
          </el-menu-item>
          <el-menu-item index="/settings">
            <el-icon><Setting /></el-icon>
            <span>{{ $t('nav.settings') }}</span>
          </el-menu-item>
        </el-menu>
      </el-aside>
      <!-- 右侧内容 -->
      <el-main class="content-area">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
    <!-- 全局后台任务进度浮窗（配图/合成/一键成片） -->
    <TaskDock />
    <!-- 顶部路由切换进度条 -->
    <TopProgress ref="topProgress" />
  </div>
  </el-config-provider>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import enLocale from 'element-plus/es/locale/lang/en'
// 显式导入模板用到的图标（虽然 main.js 已全局注册，显式导入让组件自包含、可 tree-shaking）
import {
  FolderOpened, EditPen,
  PictureFilled, VideoPlay, Microphone, Setting,
  Clock, Files, DeleteFilled, Moon, Sunny, Expand, Film, MagicStick, HomeFilled
} from '@element-plus/icons-vue'
import TaskDock from './components/TaskDock.vue'
import TopProgress from './components/TopProgress.vue'
import { useTheme } from './composables/useTheme'

const route = useRoute()
const router = useRouter()
const { locale } = useI18n()
// Element Plus 内置组件（分页/日期/确认框等）跟随界面语言
const elLocale = computed(() => (locale.value === 'en' ? enLocale : zhCn))
const { theme, toggle } = useTheme()
const sidebarOpen = ref(false)
const topProgress = ref(null)

// 路由切换时驱动顶部进度条
router.beforeEach((to, from, next) => {
  if (to.path !== from.path) topProgress.value?.start()
  next()
})
router.afterEach(() => {
  topProgress.value?.done()
})

const currentProjectId = computed(() => route.params.id || '')
const showSidebar = computed(() => true)
const activeMenu = computed(() => route.path)
</script>

<style scoped>
.main-container {
  height: 100vh;
}
.sidebar {
  background: var(--bg-sidebar);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-right: 1px solid var(--separator);
  overflow-y: auto;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.logo span {
  flex: 1;
}
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-second);
  cursor: pointer;
  transition: background 0.15s var(--ease-apple), color 0.15s var(--ease-apple), transform 0.2s var(--ease-apple);
}
.theme-toggle:hover {
  background: var(--primary-soft);
  color: var(--primary);
}
.theme-toggle:active {
  transform: scale(0.88) rotate(-18deg);
}
.logo-mark {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: 50% 60%;
}
.logo:hover .logo-mark {
  transform: rotate(-12deg) scale(1.12);
}
.content-area {
  background: var(--bg-primary);
  padding: 24px;
  overflow-y: auto;
}

/* —— Apple 风格侧边菜单 —— */
.side-menu {
  background: transparent;
  border-right: none;
  padding: 8px;
}
.side-menu :deep(.el-menu-item) {
  height: 42px;
  line-height: 42px;
  margin: 2px 0;
  border-radius: 9px;
  color: var(--text-second);
  font-size: 14px;
  transition: background 0.15s, color 0.15s;
}
.side-menu :deep(.el-menu-item:hover) {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text);
}
.side-menu :deep(.el-menu-item.is-active) {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 500;
}
.side-menu :deep(.el-menu-item.is-active .el-icon) {
  color: var(--primary);
}

.project-nav-group {
  margin: 4px 0 8px 12px;
  padding: 8px 0 8px 10px;
  border-left: 1px solid var(--separator);
}

.project-nav-title {
  margin: 0 0 4px 10px;
  color: var(--text-muted, var(--text-second));
  font-size: 11px;
  font-weight: 700;
}

.side-menu :deep(.project-menu-item.el-menu-item) {
  height: 36px;
  line-height: 36px;
  margin: 2px 8px 2px 0;
  padding-left: 12px !important;
  font-size: 13px;
}

/* 暗色下菜单 hover 用浅色叠加 */
:global([data-theme="dark"]) .side-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.06);
}

/* —— 汉堡按钮 + 遮罩（默认隐藏，仅窄屏显示）—— */
.mobile-menu-btn {
  display: none;
  position: fixed;
  top: 14px;
  left: 14px;
  z-index: 1001;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-glass);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  color: var(--text);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}
.sidebar-overlay {
  display: none;
}

/* —— 响应式：窄屏侧栏抽屉化 —— */
@media (max-width: 768px) {
  .mobile-menu-btn {
    display: flex;
  }
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    z-index: 1002;
    transform: translateX(-100%);
    transition: transform 0.28s var(--ease-apple);
    box-shadow: var(--shadow-lg);
  }
  .sidebar.is-open {
    transform: translateX(0);
  }
  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1001;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
  }
  .content-area {
    padding: 64px 16px 16px;
  }
}
</style>
