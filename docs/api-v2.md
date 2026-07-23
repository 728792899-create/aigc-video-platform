# API v2

所有业务接口位于 `/api/v2`，使用 `Authorization: Bearer <session-token>`。健康检查例外。响应统一为：

```json
{ "ok": true, "data": {}, "correlationId": "uuid" }
```

错误包含稳定 `code`、可行动 `userMessage`、`retryable`、`correlationId` 和时间戳，不返回原始 Provider 响应、凭据或本机路径。

| Group | Endpoint | Purpose |
| --- | --- | --- |
| Health | `GET /api/v2/health` | Demo、网络门禁与 schema 状态 |
| Projects | `GET/POST /api/v2/projects` | 列表与创建 |
| Projects | `GET/PUT /api/v2/projects/:id/generation-policy` | 读取或用 revision/CAS 与精确确认更新并发、批次、导出和用户自付预算边界 |
| Series | `GET/POST /api/v2/series` | 系列列表与创建 |
| Series | `POST /api/v2/series/:id/episodes` | 将 Project 作为有序 Episode 加入 Series |
| Series | `GET /api/v2/episodes/:id/context` | 前后集、默认配置与分层资产上下文 |
| Series package | `GET /api/v2/series/:id/package` | 导出 Series `.aigcproj` v2 |
| Project package | `GET /api/v2/projects/:id/package` | 导出自包含 `.aigcproj` |
| Project package | `POST /api/v2/project-packages/import` | 隔离校验、ID remap 和事务导入 |
| Sources | `POST /api/v2/projects/:id/sources` | 导入文本并提取事件 |
| Source import | `POST /api/v2/projects/:id/source-imports/preview` | 隔离检查 TXT/Markdown 并返回受限预览 |
| Source import | `POST /api/v2/projects/:id/source-imports/:importId/commit` | 校验 hash 后事务写入 Source/Chapter/Event |
| Source import | `DELETE /api/v2/projects/:id/source-imports/:importId` | 取消并移除未提交隔离内容 |
| Graph | `GET /api/v2/projects/:id/graph?view=` | 三种领域投影 |
| Graph | `POST /api/v2/projects/:id/graph/commands` | 幂等领域命令 |
| Agents | `POST /api/v2/projects/:id/agent-plans` | 创建待审批计划 |
| Agents | `GET /api/v2/agent-runs/:id/checkpoint` | 读取计划签发时的脱敏记忆/Artifact provenance |
| Agents | `POST /api/v2/plans/:id/approve` | 消费一次性审批 token |
| Production | `POST /api/v2/projects/:id/demo-production` | 零付费 Candidate 生产 |
| Production | `POST /api/v2/shots/:id/provider-candidates` | 使用项目路由提交外部候选；要求用户自付专用确认、路由/策略 revision、最大成本和幂等键 |
| Candidates | `GET /api/v2/projects/:id/candidates|candidate-batches` | 候选及持久批次 lineage |
| Candidates | `PATCH /api/v2/candidates/:id` | 独立更新 label、tags 与 favorite，不改变最终选择 |
| Candidates | `POST /api/v2/candidate-batches/:id/retry-failed` | 精确确认后仅重跑失败项；创建新 batch/new attempt，保留原批次和候选 |
| Continuity | `GET /api/v2/episodes/:id/continuity` | 返回本集与上一集摘要、固定 Source revision/hash 和动态 stale 原因 |
| Continuity | `POST /api/v2/episodes/:id/continuity-summary` | 精确确认后创建不可变跨集摘要，并更新相邻 Episode 引用 |
| Prompt Pack | `GET /api/v2/projects/:id/prompts|skills|workflows` | 固定版本定义清单 |
| Prompt Pack | `GET /api/v2/systems/prompt-pack` | 运行时版本、数量与内容 hash 摘要 |
| Prompt operations | `GET/POST /api/v2/prompt-definitions` | 列出或追加项目/Global Prompt revision |
| Prompt operations | `GET /api/v2/prompt-revisions/:id/diff` | 字段级版本 diff |
| Prompt operations | `POST /api/v2/prompt-revisions/:id/polish` | 对项目 Prompt 追加确定性 Demo 润色 revision，返回 diff 与 last-known-good |
| Prompt operations | `POST /api/v2/prompt-revisions/:id/compile|evaluations|publish|restore` | 变量编译、Fake 黄金样例、发布和追加式恢复 |
| Prompt operations | `POST /api/v2/projects/:id/scoped-regenerations` | 固定已发布 Prompt revision，对单个 Event/Scene/Shot 追加局部产物 |
| Creative brief | `GET/PUT /api/v2/projects/:id/brief` | 读取或使用 expected revision 保存不可变 Brief Artifact，按字段标记下游 stale |
| Creative brief | `POST /api/v2/projects/:id/brief/candidates` | 使用本地确定性运行生成 2–3 个 draft 候选；锁定字段保持不变，当前批准稿不移动 |
| Creative brief | `POST /api/v2/projects/:id/brief/candidates/:artifactId/review` | 精确确认批准或拒绝候选；批准才追加当前 Brief revision，拒绝不污染下游 |
| Scene patch | `POST /api/v2/projects/:id/scene-patches/:artifactId/apply` | 审阅后显式应用 Scene/Shot 字段 patch；需项目/场景/镜头 CAS、精确确认与幂等键，整批冲突时全部回滚 |
| Skill operations | `GET/POST /api/v2/skills` | 列出或创建受限 Skill package version |
| Skill operations | `POST /api/v2/skills/:id/fork|evaluations|publish|rollback` | 安全 fork、Fake 黄金样例、发布和追加式回滚 |
| Skill operations | `GET /api/v2/skills/:id/validate` | 资源类型、路径与黄金样例门禁 |
| Artifacts | `GET /api/v2/artifacts/:scopeType/:scopeId/versions` | 按 `projectId`/`artifactType` query 列出不可变版本与 head |
| Artifacts | `GET/POST /api/v2/artifacts/:scopeType/:scopeId/diff|rollback` | 内容 diff 与 CAS 追加式回滚 |
| Assets | `GET/POST /api/v2/projects/:id/assets` | 通用资产契约 |
| Shared assets | `GET/POST /api/v2/assets/shared` | Global/Series 资产与 Variant |
| Shared assets | `POST /api/v2/assets/fork|promote` | Episode fork 与共享 promote，复制受管媒体 |
| Shared assets | `GET /api/v2/assets/resolve` | Episode→Series→Global 确定性解析 |
| Shared assets | `GET /api/v2/assets/:id/impact` | 删除前反向引用影响 |
| Reconcile | `POST /api/v2/episodes/:id/reconcile/preview|apply` | 预览并用一次性审批事务应用 |
| Binding | `POST /api/v2/assets/batch-bind/preview|apply` | 批量镜头改绑的 changed/skipped/conflict |
| Media | `POST /api/v2/projects/:id/media` | 受控图片上传 |
| Media | `POST /api/v2/media/resolve/preview` | 按模型能力验证有序媒体并返回脱敏 receipt |
| Boundary | `POST /api/v2/shots/:id/boundary/extract` | 持久化提取视频最后可解码帧 |
| Memory | `GET /api/v2/projects/:id/memory` | 列出项目可追溯 Episode/Series/Global 记忆 |
| Memory | `POST /api/v2/memory/rebuild` | 从 canonical source 重建可检索索引 |
| Memory | `GET /api/v2/memory/search` | 关键词检索，返回 scope、revision 和采用原因 |
| Memory | `PATCH/DELETE /api/v2/memory/:id` | 禁用召回或删除可重建索引，不删 canonical source |
| Memory | `GET /api/v2/memory/model-status` | 关键词降级与按需 ONNX 状态 |
| Tasks | `GET /api/v2/tasks/:id` | 脱敏后的持久任务 |
| Tasks | `GET /api/v2/projects/:id/task-admission` | 返回当前并发、策略 revision、候选/导出边界、零预算与稳定拒绝原因 |
| Tasks | `GET /api/v2/tasks/:id/diagnostic` | 结果确定性、取消语义和建议动作 |
| Tasks | `POST /api/v2/tasks/:id/reconcile` | 对账已有任务；永不提交新任务 |
| Tasks | `POST /api/v2/tasks/:id/retry` | 显式确认后创建新的幂等 attempt |
| Tasks | `POST /api/v2/tasks/:id/cancel` | 请求取消 |
| Security audit | `GET /api/v2/projects/:id/security-audit?limit=` | 返回项目高风险动作的 append-only started/terminal 证据；只含固定动作、哈希引用、correlation ID 和稳定错误码 |
| Diagnostics | `GET /api/v2/projects/:id/diagnostic-bundle` | 返回项目计数、哈希化任务证据与引用完整性问题；排除原文、Prompt、凭据、Provider payload 和本机路径 |
| Recovery | `GET /api/v2/projects/:id/recovery` | authenticated 本地 UI 报告：实际实体/任务 ID、可定位引用与允许的恢复动作；不包含正文、Prompt、Provider payload 或路径 |
| Export | `POST /api/v2/exports/preflight` | 冻结镜头 revision 与已选 Candidate/Media hash，返回不含目标目录的短期预检和一次性 token，不启动 FFmpeg |
| Export | `POST /api/v2/exports` | 消费 `START_LOCAL_EXPORT` 精确确认；assembly 变化时拒绝，幂等重放复用同一任务 |
| Systems | `GET /api/v2/providers/catalog` | Provider 与账单边界 |
| Systems | `GET /api/v2/models/catalog` | 确定性静态模型能力目录 |
| Systems | `GET /api/v2/systems/egress/status` | 只读返回三通道网络门禁、allowlist 计数和凭据配置状态 |
| Provider connections | `GET/POST /api/v2/provider-connections` | 列出连接或用精确确认创建 OpenAI-compatible/声明式 HTTPS 连接；响应只含 `credentialRef` |
| Provider connections | `PUT /api/v2/provider-connections/:id/credential` | 用 expected revision 与专用确认替换系统凭证库中的秘密；响应不回显秘密 |
| Provider connections | `POST /api/v2/provider-connections/:id/test` | 执行受限 `/v1/models` 脱敏探测；返回 ready/timeout/rate-limited/invalid-response 等稳定结果 |
| Provider route | `GET/PUT /api/v2/projects/:id/provider-route` | 按模态配置主连接、降级链、模型、最大尝试数、超时和预算；revision/CAS 更新 |
| Provider costs | `GET /api/v2/projects/:id/provider-costs` | 返回不可变本地成本账本，不含付款信息或 Provider payload |
| Executable adapters | `/api/v2/provider-plugins*`, `/api/v2/provider-plugin-publishers*` | 已封存；所有方法稳定返回 HTTP 410 `EXECUTABLE_PROVIDER_ADAPTERS_DISABLED` |

旧 `/api/*` 有意返回 404，不提供 1.x 兼容层。

安全审计只覆盖可归属到项目的高风险操作，包括 Creative Brief 审阅、Scene patch 应用、原著提交、边界帧解除、失败批次重试、导出批准、生成策略更新、任务取消/重试/对账，以及项目级 Prompt、Skill、Artifact 的发布或回滚。每次操作先追加 `started`，成功或拒绝后再追加 terminal 事件；进程在两者之间异常退出时会保留 started-only 证据。响应从不包含目标原始 ID、请求 body、用户正文、Prompt、凭据、Provider payload 或路径。Global Prompt/Skill 没有项目归属，因此当前不写入项目审计流。

Creative Brief 读取只接受 `status=approved` 且完整通过 `CreativeBriefSchema` 的 Artifact。旧版本中缺字段或夹带未声明字段的产物会列入 `invalidArtifactIds`，不会被 UI 默认值伪装成当前事实。候选生成要求独立 idempotency key；批准使用 `APPROVE_CREATIVE_BRIEF`，拒绝使用 `REJECT_CREATIVE_BRIEF`，两种确认不可互换。

导出采用两阶段协议。Preflight 保存服务端私有的目标目录与不可变装配快照，公开响应只包含文件名、镜头/时长/规格、`assemblyHash`、已验证的 Demo 零成本、过期时间和一次性 approval token。正式请求必须提交 `START_LOCAL_EXPORT`；token 只保存 hash，未消费的预检在 Shot/Candidate/Media 发生变化后返回 `EXPORT_PREFLIGHT_STALE`。已成功消费的同一确认可安全重放并返回原任务，不重复启动 FFmpeg。

项目诊断包不是项目备份，也不包含可恢复业务内容。Task ID 与 Provider task ID 均只以 SHA-256 引用出现；任务输入、结果 payload、原始错误、项目名称、用户文本、Prompt、媒体 locator 和绝对路径均不会进入响应。

`/projects/:id/recovery` 与可下载诊断包用途不同。它只对持有本地 session token 的 Studio 返回实际 Shot/Candidate/Task ID，使 UI 能定位断裂引用、批量执行只读 reconcile，或在二次确认后解除引用不存在媒体的边界帧。它不会自动选择新候选、删除历史 Candidate、重新提交 Provider 任务或返回任何用户正文/Prompt/Provider payload/媒体路径；给外部支持人员的文件仍必须使用只含 hash 的 diagnostic bundle。

## 项目生成策略与任务准入

`GET /projects/:id/generation-policy` 返回持久化的项目策略；尚未保存过的项目返回 revision 0 的确定性默认值。`PUT` 只接受以下严格请求，额外字段会被拒绝：

```json
{
  "expectedRevision": 0,
  "maxConcurrentTasks": 4,
  "maxCandidatesPerBatch": 4,
  "maxExportDurationMs": 3600000,
  "billingMode": "demo-only",
  "dailyPaidBudgetMicros": 0,
  "confirmation": "UPDATE_GENERATION_POLICY"
}
```

默认响应为 `billingMode=demo-only`、`paidProviders=blocked`、`dailyPaidBudgetMicros=0`。切换 `user-funded` 或设置正预算时，确认必须改为 `ENABLE_USER_FUNDED_PROVIDERS`；并发仍不能超过 Server 启动时的运行时安全上限。过期 revision 返回 `GENERATION_POLICY_REVISION_CONFLICT`，而不是覆盖另一窗口的修改。

`GET /projects/:id/task-admission` 是只读快照，返回 active/max concurrency、单批候选与导出时长边界、policy revision、三个值均为 0 的 paid budget facts，以及 `concurrency_limit / candidate_limit / export_duration_limit / paid_budget_exceeded / paid_provider_disabled / provider_network_disabled` 中实际命中的原因。Demo production、失败批次重试、任务 retry 和导出都会在 Server 内再次执行同一准入，因此该 GET 不能被当作预授权 token。

`/systems/egress/status` 不返回 secret reference、DNS 结果、原始审计或任意请求入口。全局三通道仍默认关闭；外部 Provider 只能通过 `ProviderConnectionService` 为精确 HTTPS origin 创建受限单连接策略，没有对外的 Broker execute 接口。

创建连接必须使用 `CREATE_LOCAL_PROVIDER_CONNECTION`；替换凭据使用 `REPLACE_PROVIDER_CREDENTIAL`；测试使用 `TEST_PROVIDER_CONNECTION`；更新路由使用 `UPDATE_PROVIDER_ROUTE_POLICY`。声明式 manifest 只接受固定 submit/poll/cancel 路径和终态映射，拒绝脚本、任意 header 与额外字段。旧插件 API 不接受任何安装、信任、测试或启用操作。

## Prompt / Skill / Artifact 版本契约

Prompt 与 Skill 的 create、publish、restore 和 rollback 都返回新 ID/版本，不修改旧记录。Prompt 发布前必须满足变量 Schema 并存在通过的 Fake Provider `GoldenEvaluation`；Skill 还必须只包含白名单资源类型。内置 Skill 不能原地修改，fork 后的来源标记为 `user-fork`/`original-clean-room`。

`polish` 只接受当前最新的项目级 Prompt revision、`expectedRevision`、用户反馈、方向和幂等键。Demo Mode 使用确定性本地规则生成中文审阅稿和英文执行稿，不调用 Provider；响应携带字段 diff、`lastKnownGoodRevisionId` 和请求 hash。相同键/相同输入返回原 revision，相同键更换输入或对过期 revision 操作返回 409，旧 draft 和已发布兜底均不会被覆盖。

Artifact rollback 要求客户端传入 `expectedHeadRevision`。Server 会先校验当前 head，再在单一事务中追加 ArtifactVersion 并使用 CAS 更新 `ArtifactHead`；竞争修改返回稳定冲突错误，不会覆盖他人新版本。

局部重生成只接受 `published` Prompt revision。请求必须携带目标类型、稳定目标 ID、变量和幂等键；任务输入快照会固定 Prompt revision/content hash、目标 revision 与发起时 graph revision。Event/Scene 生成阶段只追加作用域 Artifact，Shot 只追加 Candidate，均不会在生成响应中直接改写 canonical 数据或覆盖 `selectedCandidateId`。Scene Artifact 可以保存受 Schema 约束的 `changes` 与 `shotPatches`；只有后续调用 apply、携带 `APPLY_SCENE_PATCH`、通过 project/scene/每个 shot revision CAS 后，才在一个事务内更新 canonical Scene/Shot 并批准 Artifact。任一镜头不属于场景、revision 过期，或 duration/Beat 组合不合法时整批不落库。相同幂等键与相同输入返回原任务；复用该键改换目标会返回 409。

字段级 stale 由 Server 计算并随 `changedFields` 返回：`dialogue` 仅影响 voice/subtitle/timeline/export，`videoPrompt` 不污染 image，`durationMs` 影响 subtitle/timeline/export，`beats` 影响 image/video/voice/subtitle/timeline/export；Scene title/synopsis 只传播给所属镜头。旧 Candidate、人工选择、媒体和 Artifact 历史不会被删除。

## 项目包契约

`GET .../package` 返回 `application/vnd.aigc-director.project+zip`；导入使用 `multipart/form-data`，字段名为 `file`，扩展名必须为 `.aigcproj`。v2 Project 包只允许 `manifest.json`、`project.json` 与 `media/<uuid>.<ext>`；Series 包使用 `series.json`、`media/<project-id>/<uuid>.<ext>` 与 `shared-media/<uuid>.<ext>`。

导入成功返回新 Project 或 Series、文件/媒体数、总字节数、ID remap 数和警告。Project 包中的共享资产会转为 Episode pinned 副本；Series 包中的 Global 依赖会转为 Series pinned 副本，绝不静默写入目标 Global。完整性、路径、版本或配额校验失败时不留下半成品。

## TXT / Markdown 导入契约

文件导入采用两阶段协议。Preview 接收字段名为 `file` 的 `multipart/form-data`，只允许 `.txt`、`.md`、`.markdown`，最大 6 MB、200 万字符且必须是无危险控制字符的 UTF-8。响应只包含 20,000 字符以内纯文本预览、内容 hash、识别章节、格式、大小和过期时间；Markdown 永不作为 HTML 执行。

Commit 必须回传 `expectedContentHash`、标题和语言。Server 重新读取隔离内容并校验 hash 后，才在同一数据库事务内创建 Source、Chapter、Event、Edge 和 graph revision。`source-import:<uuid>` 幂等记录与领域写入处于同一事务，崩溃后的相同确认不会创建重复 Source；不同参数重放返回 409。Cancel 删除未提交隔离内容，过期预览不能提交。

## 镜头节拍与边界命令

`POST .../graph/commands?view=production` 支持 `update_shot_beats`、`link_previous_boundary` 和 `clear_boundary_frame`。所有命令必须携带 `expectedRevision` 和至少 16 字符的 `idempotencyKey`。

- `update_shot_beats`：提交完整有序 Beat；Server 重新验证 ordinal、start、最小时长和精确总和。
- `link_previous_boundary`：只接受当前项目中上一镜头的已持久化尾帧，并创建独立首帧引用快照。
- `clear_boundary_frame`：解除 `start` 或 `end` 绑定，不删除来源 Candidate 或 Media。

生成任务的 `inputSnapshot.boundaryFrames` 和 `mediaInputOrder` 保存实际引用顺序；Candidate 另外保存 Provider 确认收到的 `providerMediaOrder`。能力不匹配、媒体 hash 变化或跨项目引用会拒绝执行。

## CandidateBatch、Model Catalog 与尾帧

Demo production 为每个 Shot 创建一个 `CandidateBatch`，并用稳定 `batchId` 关联所有 Candidate。批次完成状态来自实际 Candidate 和任务证据，不伪造进度。Candidate 的收藏、比较和 `selectedCandidateId` 相互独立；PATCH 标注不会静默改变 Shot 的最终选择。

`GET /models/catalog` 只返回静态能力、输入形式、限制和内容 hash；Provider 健康与账单状态保留在独立接口。未知模型或不支持的能力组合立即返回稳定错误。`media/resolve/preview` 不执行上传或付费请求，只返回输入角色、顺序、源 hash、传输类型与 locator 的脱敏 hash。

尾帧提取只接受当前 Project/Shot 的 video Candidate。任务成功后返回新的 MediaReference 和 `extracted_video` BoundaryFrame；结果不包含本机路径。FFprobe/FFmpeg、PNG 校验或数据库发布任一步失败都不会替换原边界帧。

## 分层记忆

`POST /memory/rebuild` 只接收 `projectId`，从已批准 Event、Artifact、Series Bible、SharedAsset、用户反馈和已选 Candidate 摘要生成可重建索引。密钥、signed URL、Provider 原始响应、二进制内容和本机私密路径会被拒绝，并仅在 report 中计数。

`GET /memory/search?projectId=<uuid>&q=<text>&limit=<n>` 默认使用不联网的关键词检索，按 Episode → Series → Global 排序。每条结果带 `matchedKeywords` 和 `reasons`；stale、disabled 或敏感记录不参与召回。`DELETE` 只删除派生记忆及 chunk，原 Event/Artifact/Asset/Candidate 保留，后续可重建。ONNX 当前只暴露固定 model/revision/hash 状态，不会自动下载。

`POST /projects/:id/agent-plans` 会先从安全、非 stale 记忆生成召回快照，并把 checkpoint 与 plan 一起返回。`GET /agent-runs/:id/checkpoint` 只返回 memory ID、scope、source key/revision、content hash、命中关键词、采用原因和已批准 Artifact hash；不返回 MemoryRecord 正文。同一 run/plan 的 checkpoint 不可覆盖，审批时会校验 graph revision 与 context hash。
