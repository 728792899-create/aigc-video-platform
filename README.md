# AIGC 辅助的短视频创意生成与制作平台

> 项目定位：本地优先的 AIGC 短视频创作 MVP。项目重点展示“主题输入 → 脚本 → 分镜 → 配图 → 配音 → 字幕 → 合成/预览”的工程闭环，而不是生产级 SaaS。

## 10 分钟运行路径

```bash
npm run install:all
npm run demo
```

打开 `http://127.0.0.1:5173`，输入一个主题即可体验 demo 流程。`DEMO_MODE=1` 下不会调用真实付费模型：脚本生成使用稳定样例，图片走占位图兜底，配音使用本地静音音频，便于在无 API Key 的机器上确认主流程。

常用验收命令：

```bash
npm run test:smoke
npm run quality
npm run security:audit       # 生产依赖审计；发现漏洞时返回非零状态
npm run security:audit:all   # 含开发依赖的完整审计
npm --prefix client run build
```

公开版本不会提交 `.env`、数据库、上传素材、日志、安装包和本机运行数据。

> 输入一句创意主题，自动完成 **文案 → 配图 → 配音 → 字幕 → 合成**，1-3 分钟产出一条带字幕的短视频。
>
> 郑州轻工业大学 软件学院 · 数字媒体技术 · 毕业设计

一个面向短视频创作的全流程 AIGC 平台：以一键成片为核心，串联大语言模型写脚本、文生图配画面、TTS 配音、FFmpeg 合成，并提供分镜编辑、多模型路由、成片库、回收站、备份还原等完整的工程化能力。

---

## ✨ 核心功能

- **一键成片**：一句主题自动生成脚本、逐分镜配图配音、合成带字幕成片，全程进度可视化。
- **分镜工作台**：脚本分镜化编辑，支持配图、配音、运镜、转场、字幕样式、智能时长建议、时间轴可视化编辑。
- **多模型接入**：文案 / 配图 / 配音 / 视频 四个阶段可分别路由到不同 Provider（DeepSeek、CogView、CogVideoX、Kling、OpenAI 等），缺密钥自动降级到免费 Provider，主流程不中断。
- **成片输出**：多画幅比例（16:9 / 9:16 / 1:1 / 4:5 / 4:3）、背景音乐混音、软/硬字幕、卡拉OK 逐词高亮、Ken Burns 运镜。
- **资产管理**：成片库、文件管理器、历史记录、回收站（软删除 7 天可还原）、整体备份/还原、存储统计。
- **项目封面**：每个项目自带名称哈希渐变色卡，配图后自动复用首张分镜图，也可一键 AI 生成封面。
- **运维友好**：PM2 进程守护、健康检查接口、操作日志、启动自检、接口冒烟测试套件。

---

## 🧱 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + Element Plus + Pinia + Vue Router |
| 后端 | Node.js + Express |
| 数据库 | SQLite（通过 sql.js 内存加载 + 节流写盘，零原生编译依赖） |
| 视频合成 | FFmpeg |
| AI 文案 | DeepSeek（默认）/ OpenAI / 智谱 / 通义 / Kimi 等（OpenAI 兼容） |
| AI 配图 | Pollinations（默认免费）/ 智谱 CogView / 通义万相 / OpenAI Images |
| AI 视频 | 静图运镜（默认免费）/ 智谱 CogVideoX / 可灵 Kling |
| 配音 | Edge TTS（默认免费）/ OpenAI TTS |
| 进程守护 | PM2 |

---

## 📦 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 18（推荐 ≥ 20） | 用到原生 fetch / node:test |
| FFmpeg | 任意近期版本 | 视频合成必需，需在 PATH 中或在系统设置里指定路径 |
| PM2 | 任意 | 可选，用于后端进程守护；不装也可用 `npm start` 直接跑 |

> 数据库无需额外安装，sql.js 随后端依赖自动就位。

---

## 🚀 快速开始

### 1. 安装依赖

```bash
# 后端
cd server
npm install

# 前端
cd ../client
npm install
```

### 2. 启动自检（可选，推荐演示前跑一遍）

```bash
cd server
npm run preflight
```

会检查 Node 版本、FFmpeg、后端端口、上传目录可写、数据库可加载、各阶段 Provider 凭证，全部就绪才放行。

### 3. 启动后端

```bash
cd server

# 方式一：PM2 守护（推荐，崩溃自动重启）
pm2 start ecosystem.config.js
pm2 logs aigc-backend     # 看日志
pm2 status                # 看状态

# 方式二：直接运行
npm start
```

后端默认监听 **http://localhost:3000**。

### 4. 启动前端

```bash
cd client
npm run dev
```

前端默认运行在 **http://localhost:5173**，已配置好 `/api` 与 `/uploads` 到后端的代理。

浏览器打开 http://localhost:5173 即可使用。

### 5. 一键启动（可选）

项目根目录提供了一键启动脚本，自动跑自检 + 拉起后端（PM2）+ 前端：

```bash
# Windows
start-all.bat

# macOS / Linux / Git Bash
bash start-all.sh
```

---

## ⚙️ 配置 AI 模型（可选）

平台**开箱即用**：默认全部走免费 Provider（DeepSeek 文案需配 Key，配图 Pollinations / 配音 Edge TTS / 视频静图运镜均免费免配）。

如需接入更多模型，进入页面左侧 **系统设置 → 模型路由**：

1. 在「凭证」区填入对应平台的 API Key（如智谱、OpenAI），保存。
2. 在「阶段路由」为 文案 / 配图 / 配音 / 视频 分别选择 Provider 与模型。
3. 点「测试连接」确认连通。

> 凭证保存在 `server/db/settings.json`（前端只回显后 4 位脱敏值）。该文件含明文密钥，请勿外传或提交到版本库。
> 某阶段所选 Provider 缺密钥或调用失败时，会自动降级到对应免费 Provider，主流程不中断。
> 公开源码与默认分发包不包含任何内置共享密钥；首次使用需在「设置 → 模型路由」配置自己的模型凭证。`DEMO_MODE=1` 不需要真实 Key。

---

## 🧪 测试与质量

### 接口冒烟测试

覆盖健康检查、项目 CRUD 生命周期、分镜、Provider 路由、安全头、CORS、错误处理等核心链路，**自建自删、零依赖、不触发计费 AI**。

```bash
# 前提：后端已启动
cd server
npm test
```

22 个用例全程序化断言，可重复运行，作为回归保障与系统测试素材。

### 启动自检

```bash
cd server
npm run preflight
```

---

## 📁 目录结构

```
aigc-video-platform/
├── server/                 # 后端
│   ├── app.js              # Express 入口（端口 3000）
│   ├── routes/             # 各业务路由（projects/storyboards/ai/video/...）
│   ├── services/           # 核心服务（pipeline 一键成片 / providers 多模型 / tts / ...）
│   ├── db/                 # sql.js 数据库封装 + database.sqlite
│   ├── middleware/         # 安全头 / 限流
│   ├── scripts/preflight.js# 启动自检
│   ├── test/smoke.test.js  # 接口冒烟测试
│   └── ecosystem.config.js # PM2 配置
├── client/                 # 前端
│   ├── src/views/          # 页面（Projects/Preview/Library/Settings/...）
│   ├── src/components/      # 组件（TaskDock/TimelineEditor/...）
│   ├── src/api/            # 接口封装
│   └── vite.config.js      # Vite 配置（端口 5173 + API 代理）
└── README.md
```

---

## 🔒 安全说明

- 后端默认仅监听本地，CORS 白名单限制为本地前端来源。
- 已启用基础安全响应头（nosniff / SAMEORIGIN / Referrer-Policy 等）并移除 X-Powered-By。
- AI 生成端点有按 IP 的速率限制（60 次/分钟）。
- 该平台为本地单机使用设计，不含账号体系；受控的远程/桌面客户端可设置 `API_TOKEN` 启用统一 Bearer Token 保护，并仍应在前置网关配置 HTTPS。公开网页不能把共享 Token 当作用户认证方案。
- `server/db/settings.json` 含明文 API 密钥，不要提交到版本库或公开分享。
- 图片生成真实成功率可通过 `GET /api/system/image-success-rate` 或 `node server/scripts/report-image-success.mjs` 查看；占位图不计真实成功。

---

## 📄 许可

本项目为毕业设计作品，仅供学习与答辩演示使用。
