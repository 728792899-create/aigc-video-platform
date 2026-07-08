import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import { ElMessage } from 'element-plus'
import 'element-plus/dist/index.css'
import i18n from './locales'
// 按需注册实际用到的图标（替代全量约 1000 个图标注册，显著瘦身主包）
import {
  Clock, DeleteFilled, EditPen, Expand, Files, Film, FolderOpened,
  Microphone, PictureFilled, Setting, VideoPlay, VideoPause, Moon, Sunny,
  CircleCheck, Close, Loading, Document, CopyDocument, MagicStick,
  Picture, Delete, Edit, Plus, VideoCamera, CircleClose, Warning,
} from '@element-plus/icons-vue'
import router from './router'
import App from './App.vue'
import './assets/fonts/inter.css'
import './style.css'
import { initTheme } from './composables/useTheme'

// 在挂载前应用主题，避免首屏闪烁
initTheme()

const app = createApp(App)

// 注册按需导入的图标
const icons = {
  Clock, DeleteFilled, EditPen, Expand, Files, Film, FolderOpened,
  Microphone, PictureFilled, Setting, VideoPlay, VideoPause, Moon, Sunny,
  CircleCheck, Close, Loading, Document, CopyDocument, MagicStick,
  Picture, Delete, Edit, Plus, VideoCamera, CircleClose, Warning,
}
for (const [key, component] of Object.entries(icons)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.use(i18n)

// 全局错误兜底：未被组件捕获的渲染/异步错误不再静默白屏，
// 控制台留痕便于排查，同时给用户一个温和的提示。
app.config.errorHandler = (err, instance, info) => {
  console.error('[全局错误]', info, err)
  try {
    ElMessage.error('页面出现了一点小问题，请刷新重试')
  } catch (_) { /* ElMessage 不可用时忽略 */ }
}

app.mount('#app')
