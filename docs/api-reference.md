# 内部 API 参考

本页记录 Vue Web 工作台与 Electron 桌面客户端当前使用的 HTTP 接口，方便调试、测试和扩展 Provider。它是**内部兼容接口**，当前没有独立版本号，也不承诺作为第三方公共 SDK 长期稳定。行为变更仍应保持现有客户端兼容并补迁移说明。

## 基础地址

开发模式默认：

~~~text
http://127.0.0.1:3000/api
~~~

`npm run demo` 会自动选择可用后端端口，并通过 Vite 代理暴露同源 `/api`。Electron 也会探测空闲端口，但 renderer 只访问主进程启动的本地服务。

## 通用响应

大部分 JSON 接口使用：

~~~json
{
  "code": 200,
  "data": {},
  "message": "success"
}
~~~

错误通常返回相同结构，HTTP 状态和 `code` 保持一致：

~~~json
{
  "code": 400,
  "data": null,
  "message": "可操作且已脱敏的错误说明"
}
~~~

二进制下载、静态 `/uploads/*` 和任务 SSE 不使用这个信封。

## 请求 ID

服务端为每个请求生成或透传 `X-Request-Id`，并在响应头返回。提交问题时应提供该值，而不是上传整份日志。

~~~bash
curl -i http://127.0.0.1:3000/api/health \
  -H 'X-Request-Id: local-debug-001'
~~~

## 可选 API Token

本地默认不设置 `API_TOKEN`，保持单机兼容。设置后，除健康检查和预检请求外，所有 `/api/*` 都需要：

~~~http
Authorization: Bearer <token>
~~~

或：

~~~http
X-API-Token: <token>
~~~

Token 只用于本地 API 边界，不替代 Provider 凭证，也不应写进前端源码。

## 幂等请求

`POST /api/ai/generate-image` 和 `POST /api/ai/auto-produce` 支持：

~~~http
Idempotency-Key: <UUID>
~~~

也接受 body 中的 `idempotencyKey`。缓存当前只存在于进程内，默认 TTL 为 5 分钟；进程重启后的幂等仍依赖数据库检查点和资产一致性，而不是这段内存缓存。

## 核心创作调用链

~~~mermaid
sequenceDiagram
  participant UI as Vue / Electron Renderer
  participant API as Express API
  participant Task as Task Manager
  participant Flow as Workflow Runner
  participant DB as SQLite
  participant Media as Provider / FFmpeg

  UI->>API: POST /projects
  API->>DB: 创建项目
  UI->>API: POST /ai/auto-produce
  API->>Task: 创建持久化任务
  Task-->>UI: task_id
  UI->>API: GET /tasks/:id/stream
  Flow->>DB: 保存阶段检查点
  Flow->>Media: 本地或云端能力
  Media-->>Flow: 统一结果 / 诊断
  Flow->>DB: 保存素材与任务终态
  Task-->>UI: progress / partial / success
~~~

## 项目

基础路径：`/api/projects`

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/` | 项目列表；支持 `keyword` |
| POST | `/` | 创建项目 |
| GET | `/:id` | 项目详情 |
| PUT | `/:id` | PATCH 语义更新，只修改传入字段 |
| DELETE | `/:id` | 默认软删除；`permanent=true` 永久删除 |
| GET | `/:id/assets/health` | 检查缺图、缺音频、悬空引用和导出阻塞 |
| GET | `/:id/workbench-status` | 返回当前步骤、缺失项和建议动作 |
| POST | `/:id/workbench/repair` | 执行受支持的增量修复 |
| POST | `/:id/images/generate-all` | 创建项目级批量生图任务 |
| POST | `/:id/complete-check` | 刷新项目完成状态和资产健康 |
| GET/PUT | `/:id/story-bible` | 读取或更新系列设定 |
| GET | `/:id/characters` | 角色列表 |
| POST | `/:id/characters/extract` | 从内容提取角色 |
| POST | `/:id/characters/auto-lock` | 自动锁定角色锚点 |
| POST | `/:id/continue` | 创建续写项目 |
| POST | `/:id/continuity/check` | 连续性检查 |
| POST | `/:id/continuity/repair` | 连续性增量修复 |
| GET | `/:id/series` | 当前系列信息 |
| GET | `/:id/timeline` | 获取时间线 |
| POST | `/:id/timeline/rebuild` | 从当前资产重建时间线 |
| POST | `/:id/cover` | 更新项目封面 |

最小创建请求：

~~~json
{
  "name": "Demo 项目",
  "theme": "解释可恢复工作流",
  "style": "简洁科技",
  "duration_min": 8,
  "duration_max": 12,
  "ratio": "16:9"
}
~~~

## 分镜和图片

分镜基础路径：`/api/storyboards`

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/project/:projectId` | 项目分镜列表 |
| GET | `/:id` | 单条分镜 |
| POST | `/batch` | 批量保存分镜 |
| POST | `/reconcile` | 增量对账并保留未变化镜头资产 |
| PUT | `/:id` | 更新单条分镜 |
| PUT | `/reorder/:projectId` | 调整顺序 |
| POST | `/batch-update` | 批量更新可编辑属性 |
| GET | `/suggest-duration/:projectId` | 建议时长 |
| DELETE | `/:id` | 删除分镜及关联资产 |

图片基础路径：`/api/images`

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/storyboard/:storyboardId` | 获取候选图片 |
| POST | `/` | 创建图片记录 |
| PUT | `/:id` | 更新图片记录 |
| POST | `/upload` | 上传图片；同时校验 MIME 与魔数 |
| DELETE | `/:id` | 删除文件和记录并清理 selected_image_id |

不要直接修改数据库中的 `selected_image_id`。删除或替换图片必须走服务层，避免留下悬空引用。

## AI 与自动生产

基础路径：`/api/ai`

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/generate-script` | 生成脚本 |
| POST | `/expand-dialog` | 扩展旁白 |
| POST | `/optimize-theme` | 优化主题 |
| GET | `/image-models` | 可用图像模型 |
| POST | `/generate-image` | 单图生成；支持幂等键 |
| POST | `/auto-produce` | 创建八阶段自动生产任务 |
| POST | `/auto-produce/:taskId/retry` | 兼容重试入口 |
| POST | `/generate-tts` | 生成语音 |
| GET | `/voices` | 音色和情感列表 |
| POST | `/voice-preview` | 音色预览 |
| GET | `/podcast/speakers` | 播客角色列表 |
| POST | `/podcast/generate` | 播客式语音生成 |

Demo 验收可使用仅在 `DEMO_MODE=1` 生效的测试字段：

~~~json
{
  "theme": "Demo 单阶段重试",
  "duration": "8-12",
  "ratio": "16:9",
  "motion": "none",
  "demoFailStageOnce": "export"
}
~~~

它只用于本地受控测试，不应出现在正式产品请求。

## 任务

基础路径：`/api/tasks`

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/` | 按 `type`、`status` 查询任务 |
| GET | `/:id` | 查询任务状态 |
| GET | `/:id/stream` | SSE 实时状态；15 秒心跳 |
| POST | `/:id/cancel` | 请求取消 |
| POST | `/:id/retry-failed` | 批量生图只重试失败分镜 |
| POST | `/:id/retry-stage` | 自动生产任务重试指定阶段 |

任务终态包括 `success`、`failed`、`partial`、`canceled` 和 `interrupted`。工作流阶段使用 `succeeded`、`failed`、`partial`、`canceled`、`skipped` 等更细粒度状态。

阶段重试请求：

~~~json
{
  "stage": "export"
}
~~~

返回的 `workflow` 会保留目标阶段之前的成功检查点，并把下游阶段重置为 pending。

## 音频、字幕和视频

| 基础路径 | 主要接口 |
| --- | --- |
| `/api/audio` | `GET /project/:projectId` |
| `/api/subtitle` | 下载 SRT、生成 SRT、逐镜字幕更新、自动填充和预览 |
| `/api/media` | BGM 管理、画幅、字幕预设、运镜列表 |
| `/api/video` | 合成、快速预览、导出位置、项目导出记录、成片库、转场 |

视频核心接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/video/export-location` | 返回成片库和默认副本目录 |
| POST | `/api/video/compose` | 创建真实 FFmpeg 合成任务 |
| POST | `/api/video/preview-compose` | 创建快速预览 |
| GET | `/api/video/exports/:projectId` | 项目导出历史 |
| GET | `/api/video/library` | 成片库 |
| DELETE | `/api/video/exports/:id` | 删除导出记录和受管文件 |
| GET | `/api/video/transitions` | 转场定义 |

导出目录必须经过服务端路径和可写性验证。Electron 中优先使用受限 IPC 打开系统目录选择器。

## Provider

基础路径：`/api/providers`

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/` | 按能力分类返回 Provider 注册表 |
| GET | `/health` | 启动自检和配置来源摘要 |
| GET/POST | `/stage-models` | 读取或保存阶段模型路由 |
| POST | `/credentials` | 保存或清除凭证；响应只返回掩码 |
| POST | `/test` | 用户主动连接测试 |
| GET | `/usage` | 本地使用统计 |
| POST | `/usage/reset` | 重置统计 |

Demo Mode 不会因为保存了凭证就自动访问收费 Provider。自动测试仍会清空运行环境中的常见 Key。

## 设置、备份与系统

设置基础路径：`/api/settings`

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET/POST | `/` | 读取脱敏设置或保存非敏感配置 |
| GET | `/presets` | 设置预设 |
| GET | `/runtime` | 运行时设置来源 |
| PUT | `/defaults` | 默认模型和创作参数 |
| POST | `/keys/clear` | 显式清除凭证 |
| POST | `/test-api` | 兼容连接测试 |
| POST | `/check-dir` | 验证或创建目录 |
| POST | `/pick-dir` | 非 Electron 环境尝试系统目录选择 |
| GET | `/storage-stats` | 媒体占用 |
| POST | `/clean-temp` | 清理临时媒体 |
| GET/POST | `/export-config`、`/import-config` | 非敏感配置导入导出 |
| GET | `/backup` | 下载 AIGC_BACKUP 信封 |
| POST | `/restore` | 校验并热恢复备份 |

系统基础路径：`/api/system`，提供版本、脱敏诊断、更新检查和图片成功率。`GET /api/health` 返回 overall 和 checks。

## 文件、历史、回收站和快照

- `/api/history`：生成历史查询、重新发起和删除；
- `/api/files`：分类文件、脚本导出、定位、规范命名和软删除；
- `/api/trash`：分类列表、详情、整组或选中内容恢复、彻底删除；
- `/api/snapshots`：项目草稿快照创建、列表、恢复和删除；
- `/api/logs`：脱敏操作日志；
- `/api/skills`：技能增删改、启停、导入、版本和回滚；
- `/api/presets`：创作预设；
- `/api/characters`：角色约束和参考图。

## 常见状态码

| HTTP | 含义 |
| --- | --- |
| 200 | 成功或任务已创建 |
| 400 | 参数、状态或操作边界不合法 |
| 401 | API_TOKEN 缺失或错误 |
| 403 | CORS 来源被拒绝 |
| 404 | 对象或路由不存在 |
| 409 | 状态冲突，例如阶段当前不可重试 |
| 429 | 限流 |
| 500 | 已脱敏的内部错误 |

调试时同时记录 HTTP 状态、`message`、`X-Request-Id`、任务 id 和失败阶段。不要记录请求中的凭证或完整 Provider 原始响应。
