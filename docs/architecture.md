# 架构说明

## 1. 本地优先运行结构

```mermaid
flowchart TB
  subgraph DESKTOP["桌面与交互层"]
    ELECTRON["Electron Main Process"]
    VUE["Vue 3 / Pinia / Element Plus"]
    ROUTER["创作工作台 / 项目 / 成片库 / 设置"]
  end

  subgraph SERVICE["本地服务层"]
    EXPRESS["Express API"]
    WORKBENCH["Workbench Orchestrator"]
    PIPELINE["One-click Pipeline"]
    TASKS["Task Manager"]
    PROVIDERS["Provider Adapters"]
  end

  subgraph MEDIA["媒体处理层"]
    IMAGE["Text-to-Image / Placeholder"]
    TTS["Edge / Cloud TTS / Demo Audio"]
    SUBTITLE["Subtitle / Timeline"]
    FFMPEG["FFmpeg Compose / Export"]
  end

  subgraph DATA["本地数据层"]
    SQLJS["sql.js In-memory DB"]
    SQLITE["SQLite File Persistence"]
    ASSETS["Uploads / Audio / Images / Videos"]
    SETTINGS["Local Provider Settings"]
  end

  ELECTRON --> VUE
  VUE --> ROUTER --> EXPRESS
  EXPRESS --> WORKBENCH
  EXPRESS --> PIPELINE
  WORKBENCH --> TASKS
  PIPELINE --> TASKS
  PIPELINE --> PROVIDERS
  PROVIDERS --> IMAGE
  PROVIDERS --> TTS
  PIPELINE --> SUBTITLE --> FFMPEG
  EXPRESS --> SQLJS --> SQLITE
  IMAGE --> ASSETS
  TTS --> ASSETS
  FFMPEG --> ASSETS
  PROVIDERS --> SETTINGS
```

后端不是远程 SaaS 中台，而是面向单机桌面应用的本地服务。`sql.js` 在内存中执行数据库操作，再节流写回 SQLite 文件；大型图片、音频和视频保留为文件资产，数据库只维护业务状态与路径。

## 2. 从主题到成片的流水线

```mermaid
flowchart LR
  THEME["主题 / 模板"] --> SCRIPT["脚本生成"]
  SCRIPT --> EDIT1["人工编辑与保存"]
  EDIT1 --> STORY["分镜拆分"]
  STORY --> EDIT2["画面描述 / 旁白 / 时长"]
  EDIT2 --> IMAGE["逐镜配图"]
  IMAGE --> VOICE["逐镜配音"]
  VOICE --> SUB["字幕与时间线"]
  SUB --> COMPOSE["FFmpeg 合成"]
  COMPOSE --> PREVIEW["预览 / 导出 / 成片库"]

  SCRIPT -. "单阶段重试" .-> SCRIPT
  IMAGE -. "单镜重试" .-> IMAGE
  VOICE -. "单镜重试" .-> VOICE
  COMPOSE -. "保留已就绪素材" .-> COMPOSE
```

把链路拆成可保存、可回退的阶段，是为了避免某一步失败后整条视频从头生成。分镜是核心中间态：画面、配音、字幕和合成都围绕稳定的 storyboard id 工作。

## 3. 任务、降级与可观测性

```mermaid
flowchart TB
  REQUEST["生成请求"] --> IDEM["参数校验 / 幂等入口"]
  IDEM --> TASK["Task Manager"]
  TASK --> QUEUE["Auto Produce Queue / Stage Runner"]
  QUEUE --> PRIMARY["首选 Provider"]
  PRIMARY -->|"成功"| REAL["真实生成资产"]
  PRIMARY -->|"缺密钥 / 超时 / 调用失败"| FALLBACK["免费或本地 Provider"]
  FALLBACK -->|"成功"| REAL
  FALLBACK -->|"仍失败"| PLACEHOLDER["显式 Placeholder / Demo Audio"]
  REAL --> STATS["Usage + Image Success Stats"]
  PLACEHOLDER --> STATS
  STATS --> STATUS["进度 / 部分成功 / 失败建议"]
  STATUS --> UI["Task Dock / Workbench Status"]

  UI -->|"取消"| TASK
  TASK -->|"启动恢复"| HISTORY["DB Task History"]
```

- 占位图不计入真实生图成功率，接口和报告会区分 `success` 与 `placeholder`。
- 批量任务允许部分成功；已完成素材保留，失败镜头可以单独重试。
- Task Manager 将历史状态写入数据库，启动时恢复记录，并限制历史与操作日志数量，避免本地数据库无限膨胀。
- `DEMO_MODE` 的目标是可复现验收，不代表外部模型真实质量。

## 4. 模型路由与媒体处理

```mermaid
flowchart LR
  CONFIG["阶段路由配置"] --> LLM["Script Provider"]
  CONFIG --> T2I["Image Provider"]
  CONFIG --> TTS["TTS Provider"]
  CONFIG --> T2V["Video Provider"]

  LLM --> STORYBOARD["Script / Storyboard JSON"]
  T2I --> IMAGE["Image Asset"]
  TTS --> AUDIO["Audio + Timing"]
  T2V --> MOTION["Generated Video or Ken Burns Motion"]

  STORYBOARD --> TIMELINE["Timeline"]
  IMAGE --> TIMELINE
  AUDIO --> TIMELINE
  MOTION --> TIMELINE
  TIMELINE --> FFMPEG["FFmpeg"]
  FFMPEG --> OUTPUT["MP4 + Subtitle + Library Record"]
```

各阶段 Provider 使用统一适配层，便于按成本、可用性和质量分别路由。FFmpeg 是最终确定性媒体处理边界，负责探测、音画拼接、字幕、转场、混音与导出。

## 5. 安全边界与取舍

```mermaid
flowchart LR
  LOCAL["127.0.0.1 Client"] --> CORS["Local Origin Allowlist"]
  REMOTE["受控远程客户端"] --> TOKEN["Optional API_TOKEN"]
  TOKEN --> CORS
  CORS --> HEADERS["Security Headers"]
  HEADERS --> LIMIT["AI Generate Rate Limit"]
  LIMIT --> API["Express API"]
  API --> KEYS["Local settings.json"]
```

当前产品没有多用户账号体系，默认只监听本地。`API_TOKEN` 适合受控桌面或远程客户端的统一保护，但不能替代公网多租户身份认证；如需公网部署，仍需要 HTTPS、网关鉴权、用户与权限模型以及集中式任务队列。
