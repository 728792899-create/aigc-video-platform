# 《AIGC升级文档》实施台账

本文把用户提供的《AIGC升级文档》映射到当前 AIGC 导演工作室 2.0 的真实源码。它既是差距矩阵，也是后续实施与验收台账；“已完成”只表示已有源码和测试证据，不表示真实付费 Provider、正式签名或线上发布已经验收。

## 基线

- 实施分支：`codex/director-platform-spec-upgrade`
- 参考知识库：`open-source-feature-knowledge-base@1425238f35b16f23b8a63aee1a109113a164e4a9`
- 技术栈：Vue 3 + TypeScript、Pinia、Vue Flow、Express 5、Socket.IO、better-sqlite3、Electron 40、pnpm monorepo
- 数据/API：schema v12、`/api/v2`
- 安全测试：`DEMO_MODE=1`、`PROVIDER_NETWORK_DISABLED=1`，不配置 Provider Key，不调用付费模型
- 事实源：Project、Source、Event、Scene、Shot、Asset、Candidate、Task、Artifact 均只由 Server/database 持有；画布是领域投影
- 变更保护：实施前已在仓库外保存 HEAD、repository bundle、状态与文件清单；不处理本地 `* 2.*` 和其他用户副本

## 差距矩阵

| 能力 | 当前真实实现 | 动作 | 优先级 | 验收 |
| --- | --- | --- | --- | --- |
| 主任务未知结果 | Attempt 原有 `outcome_unknown`，主任务曾缺失 | harden：主任务增加 `outcome_unknown / needs_attention` | P0 | 未知结果不能直接 retry；对账不 submit |
| 幂等重试 | 创建任务有幂等，任务中心无 retry API | harden：显式确认、新 child attempt、父任务保留 | P0 | 重放同一 retry key 返回同一 child |
| 任务诊断 | 仅错误 hash 与 Task 状态 | extract：公开脱敏 Diagnostic envelope | P0 | 无 Prompt、密钥、路径和 raw response |
| 取消语义 | 本地 AbortController | harden：区分本地请求、Provider 请求/确认、不支持 | P0 | UI 不把本地停止关注伪装成远端取消 |
| 权限与预算 | 本地单用户 bootstrap session；项目级策略支持默认 `demo-only` 与显式 `user-funded`，强制并发/候选/导出/每日预算边界 | harden；多用户 RBAC 不进入 Local v1 | P0/P2 | 策略 CAS、二次确认、成本账本、服务端准入、重启持久化 |
| 上传与外部媒体 | 导入、项目包、媒体引用已有类型/大小/hash/路径校验 | harden | P0 | MIME/magic/Zip Slip/bomb/SSRF 回归 |
| 项目包与迁移 | `.aigcproj` v1/v2、schema v3–v12、restore point | keep/harden | P0 | 重复迁移、未来版本拒绝、失败无残留 |
| 结构化剧本 | Source→Chapter→Event→Scene→Shot 已有 | harden：局部失败、字段 patch、覆盖率诊断 | P1 | 单事件/场景重生成不污染其他节点 |
| Series/Episode | Series、Episode、分层共享资产已存在 | harden：跨集摘要与连续性冲突修复 | P1/P2 | Episode→Series→Global 稳定解析 |
| 资产一致性 | Asset/Variant/Binding、fork/promote/reconcile 已有 | harden | P1 | revision drift、影响预览、引用删除保护 |
| Prompt/Skill | 固定 Registry + 不可变用户 revision、黄金样例 | harden | P1/P2 | diff、last-known-good、发布/回滚证据 |
| Artifact | 不可变版本、head、CAS rollback 已有 | harden | P2 | rollback 追加新版本并传播字段级 stale |
| Candidate | batch、收藏、比较、选定结果已分离 | harden | P1 | 失败项局部 retry、100+ 虚拟化 |
| Model Catalog | 确定性静态目录已有 | harden | P1 | 健康/余额不混入静态能力；未知组合 fail fast |
| MediaResolver | preview 与 ProviderMediaReceipt 已有 | extract/harden | P1 | 有序输入、MIME/size/hash/locator 脱敏 |
| 首尾帧连续性 | Beat、BoundaryFrame、真实尾帧提取已有 | harden | P1 | FFprobe/FFmpeg 失败不替换旧帧 |
| Agent 协作 | 结构化计划、checkpoint、一次性审批已有 | harden | P2 | 防重放、stale checkpoint、重启恢复 |
| 分层记忆 | Episode→Series→Global 关键词检索已有 | harden/defer ONNX | P2/P3 | 敏感排除、来源/revision/采用原因可见 |
| 安全 Provider | 内置 Demo、OpenAI-compatible 与声明式 HTTPS manifest；系统 Keychain/Docker Secret；按模态路由、降级和成本账本 | harden | P1/P2 | HTTPS/SSRF/secret 隔离；unknown 先对账；可执行适配器固定 410 |
| 桌面发行 | arm64 内部包和 preflight 已有 | harden | P3/外部门禁 | x64、签名、公证、真实更新需外部条件 |

## 已完成的首个 P0 垂直切片

### Canonical 状态与转换

`GenerationTask` 现在明确表达：

```text
running -> outcome_unknown -> reconciling
reconciling -> running | succeeded | failed | outcome_unknown | needs_attention
needs_attention -> retrying（仅经显式用户操作）
```

`outcome_unknown` 不能直接转成 `retrying`。Provider 可能已经接受任务时，系统先保存未知证据，再要求 reconcile；不会把网络超时当成普通失败。

### 新增接口

- `GET /api/v2/tasks/:id/diagnostic`
- `POST /api/v2/tasks/:id/reconcile`
- `POST /api/v2/tasks/:id/retry`

Retry 请求必须携带精确确认值 `RETRY_FAILED_TASK` 和至少 16 字符的 idempotency key。当前任务中心安全重放确定性的本地 `export` 与 `boundary_extract`；其他任务返回稳定 `TASK_RETRY_UNSUPPORTED`，要求从对应领域工作区执行局部重生成，避免绕开 Artifact/Candidate 发布事务。

### 诊断与隐私

公开诊断只包含确定性、是否需要对账、是否允许重试、取消语义、关联 ID、脱敏 Provider 引用 hash、建议动作与耗时。公开 Task payload 会递归遮蔽凭据字段和本机绝对路径；不会返回 raw Provider 响应。

项目级脱敏诊断包已经接入 Task Tray。它只包含实体计数、任务状态、哈希化 Task/Provider 引用和固定引用完整性代码；项目名、原著、Prompt、Task 输入/结果、凭据、媒体 locator 与本机路径均不进入文件。

### UI

Task Tray 现在显示中文状态、人工关注原因和取消语义，并提供诊断、对账、取消、重试入口。未知结果只显示“对账”，不显示“重试”；失败重试要求二次点击“确认新 attempt”。

## 已完成的第二个 P0 垂直切片：生成策略与用户自付门禁

- schema v10 新增独立 `project_generation_policies`；schema v12 将策略明确为默认 `demo-only` 与用户显式开启的 `user-funded`。默认付费 Provider 仍为 `blocked`、每日预算为 0。
- `TaskAdmission` 同时返回 policy revision、活跃任务、三个安全上限、账单模式、剩余用户预算和稳定拒绝原因；不伪造 Provider 余额或平台代扣能力。
- 更新策略必须提供 `expectedRevision` 与 `UPDATE_GENERATION_POLICY`，超过运行时并发上限或使用过期 revision 会稳定失败。
- Demo 批次、Provider 候选、失败项重试、任务 retry、导出预检和正式导出均在服务端创建任务前执行准入。CI、Smoke 和 Demo 始终保持付费请求为 0。
- Provider 工作区提供连接、路由与成本边界；策略保存和真实 Provider 提交都要求精确确认。服务重启后 revision、限制和不可变成本账本保持不变。
- 隔离 Browser 实测已将 `4/4/3600` 调整为 `2/3/120`，验证第一次只进入确认态、第二次写入 r1、页面刷新恢复和 Task Tray 同源展示；console 0 warning/error。

## 已完成的第三个 P0 垂直切片：恢复与完整性中心

- Server 从 canonical snapshot 统一检查 Shot→Candidate、Candidate→Media/Task 与 BoundaryFrame→Media，authenticated `/recovery` 返回可定位实体和严格动作枚举；可下载 diagnostic bundle 复用同一检查器但只暴露 hash。
- Systems 工作区新增 Recovery Center，展示 error/warning/recoverable task 计数、断裂引用与任务恢复动作；未知任务可批量 reconcile，绝不自动 submit。
- 缺失媒体的边界帧可以在二次确认后通过现有 `clear_boundary_frame` GraphCommand 解除，历史媒体、Candidate 和任务证据不被删除；其他引用问题只定位到画布，由用户选择新候选或局部重生成。
- API/组件测试覆盖实际 ID 只在本地恢复报告出现、外发诊断包不泄露 ID、批量对账和边界帧二次确认。
- 隔离 Browser 实测确认空项目扫描结果为 error 0 / warning 0 / recoverable 0，批量对账在无任务时不可执行，诊断包入口可用且 console 0 warning/error。该面板只由用户打开 Systems 时显示，正式 `/studio` 启动不会自动进入恢复或证据视图。

## 已完成的第四个 P0 垂直切片：高风险审计与媒体上传边界

- schema v11 新增 `security_audit_events`。项目级 Creative Brief 审阅、Scene patch 应用、原著提交、边界帧解除、失败批次重试、导出批准、生成策略更新、任务取消/重试/对账，以及 Prompt、Skill、Artifact 的项目级发布/回滚都会先追加 `started`，再追加 `succeeded` 或 `rejected`。
- 审计事件只包含固定动作、状态、目标类型、目标 ID 的 SHA-256、correlation ID 和稳定错误码；不复制请求 body、用户正文、Prompt、凭据、Provider payload、媒体 locator 或本机路径。数据库 trigger 拒绝 UPDATE/DELETE，服务重启后证据仍可查询。
- Studio Systems 工作区新增安全审计面板，只渲染契约允许的脱敏字段。Global Prompt/Skill 暂无 project scope，因此不写入某个项目的审计流。
- 图片上传在落盘和计算最终 hash 之前先解码并重新编码，剥离 EXIF、ICC 与应用标记；多页/动画图片以及超限像素直接以稳定错误拒绝。测试使用本地生成 fixture，不读取用户素材、不联网。
- 隔离 Browser 实测完成生成策略二次确认、两条审计事件显示和整页刷新恢复，console 0 warning/error；Computer Use 在隔离 Electron userData 中确认桌面壳与 Studio 首屏可启动。
- 该阶段的 `DEMO_MODE=1 PROVIDER_NETWORK_DISABLED=1 pnpm quality` 曾通过 198/198 workspace tests；当前 schema v12 最终门禁已提升为 257 项，两个阶段均保持付费请求 0。

## 已完成的 schema v12 本地 Provider 垂直切片

- 新增 `provider_connections`、`provider_route_policies` 与 `provider_cost_ledger`，分别保存脱敏连接元数据、按模态路由/降级策略和追加式本地成本证据。
- 本机 secret 进入系统 Keychain/Credential Manager；Docker 只从 `/run/secrets` 读取。API 只返回 `credentialConfigured`、引用和不可逆指纹。
- 仅允许内置 Demo、OpenAI-compatible 与受限声明式 HTTPS manifest。提交、轮询和取消都有超时、异常格式、限流和未知结果契约；未知结果不能自动切换 Provider 或重复扣费重试。
- 任意 JavaScript、Python 或 Deno 可执行 Provider 适配器已从生产 HTTP 应用封存；旧插件和发布者路径固定返回 410 `EXECUTABLE_PROVIDER_ADAPTERS_DISABLED`。
- 用户直接向 Provider 付费；产品只执行预算门禁、显式确认、路由与成本记录，不提供充值、余额托管或代扣。
- 当前最终门禁为 257 项 workspace tests，另通过 `pnpm local:smoke`、`pnpm docker:smoke`、`pnpm electron:preflight` 和零 high 漏洞生产依赖审计。

## 已完成的 P1 创作合同切片

- `CreativeBrief` 已成为严格 Zod 契约与 project-scope Artifact；不符合 Schema 的历史产物被隔离，绝不再用 UI 默认值伪装成批准证据。
- Inspector 可生成 3 个本地确定性 Brief 候选、锁定字段、载入对比，并以二次确认批准/拒绝；批准才移动当前 revision，拒绝不污染下游。
- Brief 修改按字段传播 `brief.<field>` 及 image/video/voice/subtitle/timeline/export stale，原候选、已选结果和旧 Artifact 都保留。
- 局部 Scene 重生成不直接改写核心数据；它先生成 draft `SceneRevisionPatch`，支持 Scene 与所属 Shot 的受限字段 patch。用户看到当前值/建议值/预计影响 diff 后，再使用 project/scene/逐镜头 revision CAS、精确确认和幂等键事务应用；任一冲突或非法 duration/Beat 会整批回滚。
- 字段依赖已精确到 Shot：`dialogue` 只污染 voice/subtitle/timeline/export，`negativePrompt` 只污染 image/video/timeline/export，`beats` 才同时影响画面、视频、声音、字幕、时间线和导出；其他场景、历史 Candidate 与已选结果保持不变。
- Voice/Music 元数据现在验证语言、用途、语速、情绪、BPM、循环点、来源和权利状态；资产绑定与 shared revision drift 按槽位传播 stale，不再让声音变更触发无关图像重生成。
- CandidateBatch 支持“只重试失败项”：创建带 parent lineage 的新 batch/new attempt，精确确认与幂等重放均有契约和 API 测试，原失败任务、原候选和已选结果不被覆盖。
- 导出先生成不启动 FFmpeg 的短期预检，再用 `START_LOCAL_EXPORT` 精确确认；目标目录不进入公开预检，assembly 变化使确认安全失效，重复确认只复用同一任务。正式任务冻结 Shot/Candidate/Media 快照，真实已选媒体进入 FFmpeg，成片同时原子归档到项目媒体库并使用真实文件 SHA-256。
- Episode 跨集摘要固定 Source/Event revision，更新相邻 Episode 的稳定 Artifact 指针；来源修订后返回明确 stale 原因但保留旧摘要。

## 分阶段实施顺序

1. **P0 可靠性与安全**：任务未知结果、项目级零付费准入、恢复中心、媒体边界回归和单用户高风险动作审计已完成。多用户 RBAC 不是本地桌面 2.0 的当前前提。
2. **P1 创作闭环**：Brief/结构化剧本字段 patch、资产连续性、候选局部失败、时间线证据。
3. **P2 可运营生产**：跨集摘要、Artifact/stale 修复、Prompt/Skill last-known-good、Agent 审批审计。

已完成的 P2 增量：项目 Prompt 支持确定性 Demo 润色、双语字段 diff、`expectedRevision` 乐观锁、幂等复用与 last-known-good 指针；无论润色成功或失败都不会覆盖已发布 revision，也不会发起付费请求。
4. **P3 扩展与发行**：真实 Provider 隔离联调、ONNX 可选下载、跨平台签名与更新。可执行 Provider 插件不再是产品路线。

每一阶段必须先增加失败测试，再实现，再运行局部 typecheck/lint/test/build，最后运行完整 `pnpm quality`、security、audit、FFmpeg smoke、Electron preflight/package 与 `git diff --check`。真实 Provider、证书、Release 和外部账号仍是显式授权门禁。

## 许可证与 clean-room 边界

- LumenX、LocalMiniDrama 仅在许可证与资源清单允许范围内适配领域模式。
- CineGen、Director AI、openOii、PrintFilm、Toonflow 只独立实现行为契约，不复制 Prompt、CSS、品牌、截图或资源。
- BigBanana 只作为隔离出口思想来源。
- 模型、字体、图标、FFmpeg、音视频 fixture 和 Provider SDK 均需独立记录许可证/服务条款。

本文是工程实施记录，不替代正式法律意见。
