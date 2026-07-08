import axios from 'axios'
import { API_URL } from './config'

const api = axios.create({
  baseURL: API_URL,
  timeout: 120000, // 2 分钟（AI 图片生成可能耗时较久）
})

// 请求拦截器：为幂等接口自动注入 Idempotency-Key（UUID v4）
// 防止用户双击/网络重放导致重复扣 AI 配额、创建重复项目。
api.interceptors.request.use(config => {
  // 仅对 POST /ai/auto-produce 和 /ai/generate-image 加幂等 key
  if (config.method === 'post' &&
      (config.url === '/ai/auto-produce' || config.url === '/ai/generate-image')) {
    // 使用浏览器原生 UUID（所有现代浏览器均支持）
    config.headers['Idempotency-Key'] = crypto.randomUUID()
  }
  return config
}, error => Promise.reject(error))

// 不解包 response，让上层用 res.data 访问后端 {code, data, message} 结构
// 统一错误归一化：把底层网络/超时/HTTP 状态翻译成友好中文，
// 交由各页面的 catch(e) => ElMessage.error(e.message) 展示（不在此处弹窗，避免重复）。
api.interceptors.response.use(
  response => response,
  error => {
    let msg
    if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
      msg = '请求超时，服务器响应较慢，请稍后重试'
    } else if (error.message === 'Network Error' || !error.response) {
      msg = '无法连接到服务器，请确认后端服务是否已启动'
    } else {
      const status = error.response.status
      const backendMsg = error.response.data?.message
      if (status === 404) msg = backendMsg || '请求的资源不存在'
      else if (status === 413) msg = '上传内容过大，请压缩后重试'
      else if (status === 429) msg = backendMsg || '请求过于频繁，请稍后再试'
      else if (status >= 500) msg = backendMsg || '服务器内部错误，请稍后重试'
      else msg = backendMsg || error.message
    }
    return Promise.reject(new Error(msg))
  }
)

export default api
