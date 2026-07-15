# AIGC 视频工作台

<p align="center">
  <img src="resources/icon.png" width="112" alt="AIGC 视频工作台图标">
</p>

<p align="center">
  <strong>本地优先、阶段可恢复、可以真正导出 MP4 的 AIGC 视频桌面创作工作台</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-38bdf8"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/Node.js-22%2B-22c55e">
  <img alt="Vue 3" src="https://img.shields.io/badge/Vue-3-42b883">
  <img alt="Electron 43" src="https://img.shields.io/badge/Electron-43-8b5cf6">
  <img alt="Demo no paid API" src="https://img.shields.io/badge/Demo-0%20paid%20API-f97316">
</p>

<p align="center">
  <a href="README.en.md">English quick guide</a> ·
  <a href="docs/README.md">文档中心</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

![AIGC 视频工作台产品主视觉](docs/images/product-hero.jpg)

AIGC 视频工作台把容易中断、难以复现的模型调用，整理为一条明确的桌面生产线：

> **主题 → 脚本 → 分镜 → 图片 → 配音 → 字幕 → 时间线 → 导出**

每个阶段都有独立状态、检查点、尝试次数、进度、输出和诊断信息。模型超时、限流或程序退出时，已经完成的素材不会被丢弃；重新启动后可以从最近检查点继续。没有任何 API Key 时，Demo Mode 仍会用本地实现走完整流程并生成真实可播放的 MP4。

> 当前定位是单机、单用户的桌面创作产品与可公开演示的工程样板，不是多租户 SaaS。仓库和安装包不包含共享模型密钥、数据库、日志或用户素材。

## 快速导航

- [五分钟开始](#五分钟开始)
- [产品工作流](#产品工作流)
- [界面与创作体验](#界面与创作体验)
- [可靠性与恢复](#可靠性与恢复)
- [Provider 与 Demo Mode](#provider-与-demo-mode)
- [安全与隐私](#安全与隐私)
- [测试与质量门禁](#测试与质量门禁)
- [桌面打包与发布](#桌面打包与发布)
- [完整文档地图](#完整文档地图)

## 一分钟产品导览

| 时间 | 你会看到什么 | 为什么重要 |
| --- | --- | --- |
| 0–15 秒 | 无 Key 启动 Demo，从模板或主题创建项目 | 首次体验不依赖任何付费模型 |
| 15–30 秒 | 脚本、分镜和逐镜素材进入八阶段工作流 | 每一步都可编辑、保存和追踪 |
| 30–45 秒 | 后台任务展示 Provider、进度、成本和失败诊断 | 长任务离开页面后仍可观察 |
| 45–60 秒 | 预览时间线，选择系统目录并导出真实 MP4 | Demo 不是静态原型，而是完整媒体闭环 |

![无 Key Demo 正在执行八阶段任务](docs/screenshots/task-running.jpg)

想按创作者视角完整走一遍，请看 [创作操作手册](docs/user-guide.md)；想现场演示，请直接使用 [五分钟 Demo 脚本](docs/demo-script.md)。

## 为什么做这个项目

一条 AIGC 视频通常不是一次模型调用，而是一系列持续数分钟的异构任务。真实使用中更常见的情况是：

- 文案成功了，但第三张图限流；
- 图片已生成，配音服务超时；
- 时间线已经排好，FFmpeg 在导出时失败；
- 应用关闭后，前端找不到原来的任务；
- 某个 Provider 返回了错误格式，却只显示“生成失败”；
- API Key、绝对路径或模型响应被写进日志和截图。

本项目的核心不是再做一个“输入一句话、等待一个结果”的按钮，而是把长链路创作变成可观察、可编辑、可重试、可恢复的桌面工作流。

## 能力全景

| 领域 | 已实现能力 | 用户可见结果 |
| --- | --- | --- |
| 创作流程 | 八阶段状态机、阶段解锁、检查点 | 清楚知道当前在哪一步、下一步是什么 |
| 脚本与分镜 | 模板、脚本生成、逐镜编辑、稳定 storyboard id | 改一条分镜时不会重建全部资产 |
| 图片与配音 | Provider 切换、批量任务、部分成功、占位降级 | 成功项保留，失败项可单独修复 |
| 字幕与时间线 | 字幕预设、时长、运镜、音轨、画幅 | 在导出前实时检查最终结构 |
| 导出 | FFmpeg 合成、自定义目录、成片库 | 生成真实 MP4，而不是静态页面演示 |
| 任务系统 | 进度、取消、诊断、重试、重启恢复 | 长任务离开页面后仍可追踪 |
| 数据可靠性 | SQLite 检查点、迁移备份、恢复点、完整性检查 | 更新与恢复时不静默破坏项目 |
| 桌面安全 | safeStorage、IPC 白名单、CSP、路径校验 | 密钥不作为普通明文设置长期保存 |
| 发布工程 | Linux 质量 CI、Win/macOS 预检、签名工作流 | 可以从源码走到可验签的桌面包 |

## 五分钟开始

### 环境要求

- Node.js 22 或更高版本；
- npm 10 或更高版本；
- macOS、Windows 或常见 Linux 开发环境；
- 不要求安装系统 FFmpeg，项目默认使用 `ffmpeg-static`。

### 无 Key Demo

```bash
git clone https://github.com/728792899-create/aigc-video-platform.git
cd aigc-video-platform

npm ci
npm --prefix server ci
npm --prefix client ci
npm run demo
```

浏览器打开 `http://127.0.0.1:5173`。如果该端口被占用，启动器会选择可用端口并打印准确地址。

Demo Mode 的边界非常明确：

- 脚本：本地模板生成；
- 图片：原创本地占位画面；
- 配音：本地静音/占位音轨；
- 字幕：根据分镜和旁白本地生成；
- 时间线与导出：真实执行；
- FFmpeg：真实合成有效 MP4；
- 付费 Provider：不会调用。

### 先验收再体验

```bash
npm run test:smoke
```

它会在临时目录完成三项关键验收：正常导出、导出阶段失败后的局部重试、服务终止后的自动恢复。测试主动清空常见 Provider Key 环境变量，执行结束后删除临时数据库和媒体。

## 产品工作流

```mermaid
flowchart LR
  T["1 主题\n明确方向"] --> S["2 脚本\n生成与编辑"]
  S --> B["3 分镜\n拆解镜头"]
  B --> I["4 图片\n生成或上传"]
  I --> V["5 配音\n音色与旁白"]
  V --> C["6 字幕\n样式与节奏"]
  C --> L["7 时间线\n画面与音轨"]
  L --> E["8 导出\nFFmpeg MP4"]

  classDef done fill:#0f766e,color:#fff,stroke:#5eead4;
  classDef media fill:#4c1d95,color:#fff,stroke:#c4b5fd;
  classDef output fill:#9a3412,color:#fff,stroke:#fdba74;
  class T,S,B done;
  class I,V,C,L media;
  class E output;
```

| 阶段 | 输入 | 主要输出 | 常见失败 | 恢复策略 |
| --- | --- | --- | --- | --- |
| 主题 | 用户主题、模板 | 项目与创作约束 | 输入为空 | 留在当前阶段补充 |
| 脚本 | 主题、语言、结构 | 标题、正文、旁白 | 无 Key、超时、格式异常 | Provider 降级或本地模板 |
| 分镜 | 脚本 | 稳定分镜记录 | JSON 不完整、局部修改 | 校验格式并只更新变化镜头 |
| 图片 | 分镜提示词 | 每镜头候选资产 | 限流、部分图片失败 | 保留成功图片，只重试失败项 |
| 配音 | 旁白、音色 | 音频资产与时长 | 网络/音色不可用 | 降级 Provider 或本地占位 |
| 字幕 | 旁白、音频时长 | SRT/字幕片段 | 时间轴不合法 | 重新计算当前阶段 |
| 时间线 | 图片、音频、字幕 | 合成计划 | 缺失资产 | 资产健康检查给出修复入口 |
| 导出 | 合成计划、输出目录 | MP4 与成片记录 | FFmpeg、磁盘或路径错误 | 清理临时文件，只重试导出 |

详细字段、事件和幂等约束见 [工作流与崩溃恢复](docs/workflow-recovery.md)。

## 界面与创作体验

### Web 创作工作台

![Web 创作工作台验收截图](docs/screenshots/dashboard-overview.jpg)

工作台不是传统的表单向导，而是围绕一条正在生产的视频组织：

- 左侧步骤导航显示八阶段状态；
- 主画布承载编辑、预览与关键操作；
- 分镜列表按稳定 id 追踪逐镜资产；
- 后台任务浮层跨页面展示进度、Provider 和诊断；
- 成本/Provider 标签区分 Demo、本地和云端能力；
- 失败项目集中进入“待修复”，避免错误被藏在历史记录里；
- 空状态、长任务、取消边界和误操作确认都有独立反馈。

### Electron 桌面端

| 隔离 Demo 启动 | 系统目录选择 | 导出成功 |
| --- | --- | --- |
| ![Electron 隔离 Demo 启动](docs/screenshots/electron-startup.jpg) | ![macOS 原生目录选择器](docs/screenshots/electron-folder-picker.jpg) | ![Electron 导出成功](docs/screenshots/electron-export-success.jpg) |

桌面端复用相同的 Vue 工作台与 Express API，并增加系统目录选择、安全凭证库、应用数据目录、崩溃日志和打包更新能力。UI 中展示路径时会隐藏操作系统账户名，截图可以安全用于公开文档。

更多页面说明、典型用户路径和键盘操作见 [产品导览](docs/product-tour.md)。

### 页面画廊

| 项目管理 | 脚本与分镜 |
| --- | --- |
| ![项目管理](docs/screenshots/projects-overview.jpg) | ![脚本与分镜](docs/screenshots/script-storyboard.jpg) |

| 画面素材 | 配音与字幕 |
| --- | --- |
| ![画面素材](docs/screenshots/image-workbench.jpg) | ![配音与字幕](docs/screenshots/audio-subtitle.jpg) |

| 预览时间线 | Provider 路由 |
| --- | --- |
| ![预览时间线](docs/screenshots/preview-timeline.jpg) | ![Provider 路由](docs/screenshots/provider-settings.jpg) |

### 管理与恢复画廊

| 历史任务 | 文件管理 |
| --- | --- |
| ![历史任务与尝试链](docs/screenshots/history-jobs.jpg) | ![分类文件管理](docs/screenshots/files-manager.jpg) |

| 成片库 | 创作技能 |
| --- | --- |
| ![成片库](docs/screenshots/library-exports.jpg) | ![创作技能库](docs/screenshots/skills-library.jpg) |

| 回收站恢复 | 备份与恢复 |
| --- | --- |
| ![回收站与恢复入口](docs/screenshots/trash-restore.jpg) | ![备份与恢复设置](docs/screenshots/settings-backup.jpg) |

| 空状态修复 | 单阶段重试 |
| --- | --- |
| ![空状态与修复入口](docs/screenshots/empty-repair.jpg) | ![失败诊断和单阶段重试](docs/screenshots/task-retry.jpg) |

## 可靠性与恢复

![检查点与可恢复创作流程概念视觉](docs/images/workflow-recovery-concept.jpg)

> 上图是使用内置 ImageGen 生成的原创概念视觉，不是产品界面截图。它表达“八阶段资产围绕检查点持续保存，并可从失败点回到导出”的设计意图。

### 阶段状态

```mermaid
stateDiagram-v2
  [*] --> ready
  ready --> running: START
  running --> running: PROGRESS / 保存检查点
  running --> succeeded: SUCCEED
  running --> partial: PARTIAL
  running --> failed: FAIL
  running --> canceled: CANCEL
  partial --> ready: RETRY
  failed --> ready: RETRY
  canceled --> ready: RETRY
  succeeded --> [*]
```

### 程序退出后的安全恢复

```mermaid
sequenceDiagram
  participant UI as Vue 工作台
  participant API as Express API
  participant DB as SQLite
  participant Runner as 恢复执行器

  UI->>API: 启动图片/导出任务
  API->>DB: 保存任务 + workflow 检查点
  API--xUI: 应用或服务进程退出
  Note over DB: 已完成资产与当前阶段仍在磁盘
  API->>DB: 下次启动加载 pending/running/interrupted
  alt Demo/local 且 safe-auto
    API->>Runner: 按 recovery.kind 重建执行器
    Runner->>DB: 从最近检查点继续并增加恢复次数
    Runner-->>UI: 返回恢复进度、结果或诊断
  else 云 Provider 或结果未知
    API->>DB: 标记 orphaned，不自动重复提交
    API-->>UI: 展示核对、诊断和人工重试入口
  end
```

明确安全的 Demo/local 任务默认最多自动尝试三次；超过上限会进入可诊断失败终态。云任务若在结果不确定时退出，会进入 `orphaned`，避免静默重提和重复计费。用户核对后可确认重试某阶段，并保留上游成功资产。

## Provider 与 Demo Mode

```mermaid
flowchart TD
  Stage["工作流阶段"] --> Contract["Provider 契约层"]
  Contract --> Primary["首选 Provider"]
  Primary -->|成功| Validate["格式校验"]
  Primary -->|超时 / 429 / 5xx| Retry["指数退避重试"]
  Retry --> Fallback["降级 Provider"]
  Fallback -->|全部失败| Placeholder["明确标记的占位素材"]
  Validate --> Result["统一结果 + attempts 记录"]
  Placeholder --> Result
```

Provider 注册表按能力分为：

- LLM：DeepSeek、OpenAI 兼容、Claude 兼容、Qwen、Kimi、GLM、SiliconFlow、豆包；
- 文生图：CogView、OpenAI Image、通义万相；
- 文生视频：CogVideoX、Kling；
- 配音：Edge 本地能力、OpenAI TTS、火山语音系列；
- 本地降级：Demo 脚本、占位画面、静音音轨、静图视频与 FFmpeg。

仓库只描述接入方式，不提供共享 Key。云端能力的价格、配额、服务条款和可用模型由各 Provider 决定。完整契约和扩展步骤见 [Provider 与 Demo 指南](docs/provider-guide.md)。

## 安全与隐私

```mermaid
flowchart LR
  User["用户输入 Key"] --> Main["Electron Main"]
  Main --> Safe["safeStorage\nKeychain / DPAPI"]
  Safe -->|启动时解密| Memory["后端运行时内存"]
  Memory --> Provider["用户选择的 Provider"]

  Renderer["Vue Renderer"] -. 不直接读取 .-> Safe
  Settings["settings.json"] -. 不保存明文 .-> Safe
  Logs["日志 / Sentry"] -. redact .-> Memory
```

主要安全边界：

- `contextIsolation=true`、`nodeIntegration=false`、renderer sandbox；
- preload 只暴露语言切换与系统目录选择两个静态接口；
- IPC 校验来源、参数类型和返回路径；
- CSP、本地 CORS 白名单、请求 ID、生成限流、请求体大小限制；
- 上传文件同时校验 MIME 和文件魔数；
- API Key 不进入普通设置、备份、日志或前端响应；
- 旧版明文 Key 首次启动时迁移并从配置删除；
- 外部链接只允许系统浏览器打开 HTTPS；
- Sentry 默认关闭，显式配置 DSN 后仍执行事件脱敏。

威胁模型、数据位置、备份边界和日志处理见 [安全与数据边界](docs/security-and-data.md)及 [SECURITY.md](SECURITY.md)。

## 测试与质量门禁

```bash
npm run quality              # 服务端预检、测试、Demo 恢复验收、客户端测试与构建
npm run test:smoke           # 公共 API + MP4 + 单阶段重试 + 重启恢复
npm run security:audit:all   # root / server / client 完整依赖审计
node scripts/security-check.mjs
node scripts/ffmpeg-smoke.mjs
npm run electron:preflight
```

测试不会使用真实 Provider Key。Provider 契约测试用受控替身覆盖：

- 无密钥时在发起网络请求前失败；
- 超时、429、5xx、鉴权失败和异常 JSON；
- 首选 Provider 失败后降级；
- 全部失败时产出明确占位素材；
- 批任务的成功、失败与 `partial` 聚合；
- 重启扫描、恢复次数上限和 runner 缺失诊断。

CI 在 Ubuntu 执行质量与安全门禁，在 macOS/Windows 进行桌面包预检。详细测试分层和排障方法见 [测试与 CI 指南](docs/testing-ci.md)。

## 桌面打包与发布

```bash
npm run prepare:desktop      # 客户端构建 + Electron 匹配的后端字节码
npm run electron:preflight   # Electron 配置和包内容白名单
npm run pack                 # 当前平台 unpacked 预检包
npm run dist                 # 当前平台安装包
```

| 平台 | 目标 | 本地预检 | 正式发布要求 |
| --- | --- | --- | --- |
| Windows x64 | NSIS 安装包 | 无证书构建与文件检查 | 受信任代码签名证书、时间戳、SmartScreen 验证 |
| macOS arm64/x64 | DMG + ZIP | ad-hoc 签名与严格 `codesign` 校验 | Developer ID、hardened runtime、公证与 stapling |

预检包不等于公开发行包。完整的签名、公证、自动更新、数据库迁移、卸载残留和干净机器检查见 [桌面发布指南](docs/desktop-release.md)与 [Release Checklist](docs/release-checklist.md)。

## 代码结构

```text
client/
  src/components/            工作流步骤条、分镜编辑器、任务与导出状态
  src/views/                 页面路由容器与创作区编排
  src/styles/                从大型页面拆出的局部样式

server/
  routes/                    保持兼容的 REST API
  services/                  状态机、恢复、Provider、媒体与凭证服务
  test/                      契约、恢复、状态机与公共 API 测试

electron/                    主进程、受限 preload、Sentry 适配
scripts/                     Demo 验收、FFmpeg、安全和桌面打包门禁
resources/                   图标、macOS entitlement
.github/workflows/           CI 与签名发布工作流
docs/                        产品、架构、安全、测试与发布文档
```

```mermaid
flowchart LR
  E["Electron Main"] --> P["受限 Preload"]
  P --> V["Vue 工作台"]
  V -->|同源 REST| A["Express API"]
  A --> Q["Task Manager"]
  Q --> W["Workflow State Machine"]
  W --> R["Provider Contract"]
  W --> M["Media / FFmpeg"]
  W --> D["SQLite Checkpoints"]
  E --> K["系统安全存储"]
  K -->|运行时注入| R
```

## 完整文档地图

| 想了解什么 | 文档 |
| --- | --- |
| 英文快速介绍与 Demo Quick Start | [English quick guide](README.en.md) |
| 从主题到导出的完整用户操作 | [创作操作手册](docs/user-guide.md) |
| 从页面和用户任务理解产品 | [产品导览](docs/product-tour.md) |
| 当前内部兼容 API、幂等和错误格式 | [API 参考](docs/api-reference.md) |
| schema v6、阶段 revision/stale、Candidate/Variant、持久化幂等、ERD 和迁移 | [数据模型](docs/data-model.md) |
| 数据库、媒体和恢复验证 | [备份与恢复手册](docs/backup-restore.md) |
| 状态机、检查点、幂等和重启恢复 | [工作流与崩溃恢复](docs/workflow-recovery.md) |
| Provider、降级、Demo Mode 和扩展方式 | [Provider 与 Demo 指南](docs/provider-guide.md) |
| Electron、凭证、数据目录和隐私 | [安全与数据边界](docs/security-and-data.md) |
| 测试分层、CI、无付费请求保证 | [测试与 CI 指南](docs/testing-ci.md) |
| 常见启动、媒体、恢复和打包问题 | [故障排查](docs/troubleshooting.md) |
| 模块和运行边界 | [架构说明](docs/architecture.md) |
| 现场演示顺序 | [Demo 脚本](docs/demo-script.md) |
| 安装包、签名、公证和更新 | [桌面发布指南](docs/desktop-release.md) |
| 发布前逐项确认 | [Release Checklist](docs/release-checklist.md) |
| 素材和第三方授权 | [素材与第三方许可](docs/assets-and-licenses.md) |
| 当前明确边界 | [已知限制](docs/known-limitations.md) |

也可以从 [docs/README.md](docs/README.md) 进入按角色组织的文档中心。

## 常见问题

<details>
<summary><strong>Demo Mode 会不会偷偷调用我的云端 Provider？</strong></summary>

不会。Demo 入口在脚本、图片和配音阶段先短路为本地实现；自动化测试还会清空常见 Provider Key。FFmpeg 导出会真实执行，因为它是本地媒体边界。
</details>

<details>
<summary><strong>为什么任务显示部分成功而不是直接失败？</strong></summary>

批量图片或配音任务可能只失败少数镜头。系统保留成功资产并记录失败项，让你只修复缺失镜头，避免重复成本和等待时间。
</details>

<details>
<summary><strong>关闭应用后任务会怎样？</strong></summary>

任务和工作流检查点同步写入 SQLite。下次启动会扫描未完成任务：Demo/local 安全任务按 `recovery.kind` 续跑；云任务若结果无法确认则进入“结果待核对”，不会自动重复提交。超过恢复上限会给出明确诊断。
</details>

<details>
<summary><strong>可以把安装包直接发给别人吗？</strong></summary>

只有完成受信任签名和平台验证的正式包才适合公开分发。ad-hoc 或 unsigned 包只用于内部预检。
</details>

<details>
<summary><strong>API Key 会进入项目备份吗？</strong></summary>

不会。桌面版凭证存储与数据库/设置备份分离；备份只包含项目数据和非敏感配置。
</details>

## 参与开发

完整的环境准备、分支约定、TDD、无 Key 测试和提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

提交代码前请至少执行：

```bash
npm run quality
npm run security:audit:all
node scripts/security-check.mjs
```

涉及媒体流水线时增加 `node scripts/ffmpeg-smoke.mjs`；涉及 Electron 时增加 `npm run prepare:desktop && npm run electron:preflight`。新 Provider 必须补齐无密钥、超时、限流、异常格式、降级和部分失败契约测试。

## 许可与素材

源码采用 [MIT License](LICENSE)。Inter 字体使用 SIL Open Font License 1.1。README 主视觉由 OpenAI ImageGen 为本项目原创生成；产品截图来自本仓库 Demo Mode，不包含真实密钥或用户路径。完整分发规则见 [素材与第三方许可](docs/assets-and-licenses.md)。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 issue 中披露可利用细节。
