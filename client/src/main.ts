import {
  CircleCheck, CircleClose, Clock, Close, CopyDocument, Delete, DeleteFilled, Document, Edit,
  EditPen, Expand, Files, Film, FolderOpened, Loading, MagicStick, Microphone, Moon, Picture,
  PictureFilled, Plus, Setting, Sunny, VideoCamera, VideoPause, VideoPlay, Warning,
} from '@element-plus/icons-vue'
import ElementPlus, { ElMessage } from 'element-plus'
import 'element-plus/dist/index.css'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import './assets/fonts/inter.css'
import { initTheme } from './composables/useTheme'
import i18n from './locales'
import router from './router'
import './style.css'

initTheme()

const app = createApp(App)
const icons = {
  Clock, DeleteFilled, EditPen, Expand, Files, Film, FolderOpened,
  Microphone, PictureFilled, Setting, VideoPlay, VideoPause, Moon, Sunny,
  CircleCheck, Close, Loading, Document, CopyDocument, MagicStick,
  Picture, Delete, Edit, Plus, VideoCamera, CircleClose, Warning,
}
for (const [key, component] of Object.entries(icons)) app.component(key, component)

app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.use(i18n)

app.config.errorHandler = (cause, _instance, info) => {
  console.error('[全局错误]', info, cause)
  try { ElMessage.error('页面出现了一点小问题，请刷新重试') } catch { /* UI may already be unmounted */ }
}

app.mount('#app')
