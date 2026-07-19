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
| Candidates | `GET /api/v2/projects/:id/candidates|candidate-batches` | 候选及持久批次 lineage |
| Candidates | `PATCH /api/v2/candidates/:id` | 独立更新 label、tags 与 favorite，不改变最终选择 |
| Prompt Pack | `GET /api/v2/projects/:id/prompts|skills|workflows` | 固定版本定义清单 |
| Prompt Pack | `GET /api/v2/systems/prompt-pack` | 运行时版本、数量与内容 hash 摘要 |
| Prompt operations | `GET/POST /api/v2/prompt-definitions` | 列出或追加项目/Global Prompt revision |
| Prompt operations | `GET /api/v2/prompt-revisions/:id/diff` | 字段级版本 diff |
| Prompt operations | `POST /api/v2/prompt-revisions/:id/compile|evaluations|publish|restore` | 变量编译、Fake 黄金样例、发布和追加式恢复 |
| Prompt operations | `POST /api/v2/projects/:id/scoped-regenerations` | 固定已发布 Prompt revision，对单个 Event/Scene/Shot 追加局部产物 |
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
| Tasks | `GET /api/v2/tasks/:id` | 持久任务诊断 |
| Tasks | `POST /api/v2/tasks/:id/cancel` | 请求取消 |
| Export | `POST /api/v2/exports` | 启动本地 MP4 导出 |
| Systems | `GET /api/v2/providers/catalog` | Provider 与账单边界 |
| Systems | `GET /api/v2/models/catalog` | 确定性静态模型能力目录 |
| Systems | `GET /api/v2/systems/egress/status` | 只读返回三通道网络门禁、allowlist 计数和凭据配置状态 |
| Provider plugins | `GET /api/v2/provider-plugins/runtime` | 返回固定 Deno 版本、平台支持、下载体积、受限安装进度与本地校验状态，不返回路径 |
| Provider plugins | `POST /api/v2/provider-plugins/runtime/install` | 精确确认后安装固定 Deno；默认网络门禁关闭时在下载前拒绝 |
| Provider plugins | `POST /api/v2/provider-plugins/runtime/install/cancel` | 精确确认后取消当前安装；无进行中安装时返回稳定 409，不伪造成功 |
| Provider plugins | `GET/POST /api/v2/provider-plugin-publishers` | 列出脱敏指纹或精确确认信任 Ed25519 SPKI 公钥 |
| Provider plugins | `POST /api/v2/provider-plugin-publishers/:id/revoke` | expected revision + 精确确认撤销；仍有 enabled 插件时拒绝 |
| Provider plugins | `GET/POST /api/v2/provider-plugins` | 列出或安装受信 Ed25519 签名包；响应不返回 bundle 或绝对路径 |
| Provider plugins | `POST /api/v2/provider-plugins/:id/test` | 精确确认后在无权限 Deno 进程中测试；只保存脱敏证据 hash |
| Provider plugins | `POST /api/v2/provider-plugins/:id/enable|disable` | expected revision 状态转换；enable 还要求全局功能门禁与精确确认 |

旧 `/api/*` 有意返回 404，不提供 1.x 兼容层。

`/systems/egress/status` 不返回 secret reference、DNS 结果、原始审计或任意请求入口。当前三条策略均 `enabled=false`、`allowedHosts=[]`；没有对外的 Broker execute 接口，真实 Provider 仍不可用。

运行时安装请求必须是 `{ "confirmation": "INSTALL_DENO_2.9.2" }`，取消请求必须是 `{ "confirmation": "CANCEL_DENO_2.9.2_INSTALL" }`。Server 只接受固定官方资产目录，校验压缩大小、SHA-256、单文件 ZIP、二进制 hash 和精确版本后原子发布；失败或取消不留下可执行目录。`installing` 状态只暴露 downloading/verifying/extracting/probing/publishing、已接收字节和固定总字节，不含 URL 或临时路径。响应只返回脱敏状态和 hash，不含 URL token、本机安装目录或可执行路径。插件测试与启用分别要求 `TEST_SIGNED_PROVIDER_PLUGIN` 与 `ENABLE_SIGNED_PROVIDER_PLUGIN`，且携带 `expectedRevision`。

发布者信任请求需要 `TRUST_PROVIDER_PLUGIN_PUBLISHER`，撤销需要 `REVOKE_PROVIDER_PLUGIN_PUBLISHER`。Server 会解析公钥并强制 Ed25519，持久规范化 SPKI PEM，但 API 只返回 SHA-256 指纹。相同 key ID 不能静默替换指纹；由启动配置管理的信任不能被 UI 改写。

## Prompt / Skill / Artifact 版本契约

Prompt 与 Skill 的 create、publish、restore 和 rollback 都返回新 ID/版本，不修改旧记录。Prompt 发布前必须满足变量 Schema 并存在通过的 Fake Provider `GoldenEvaluation`；Skill 还必须只包含白名单资源类型。内置 Skill 不能原地修改，fork 后的来源标记为 `user-fork`/`original-clean-room`。

Artifact rollback 要求客户端传入 `expectedHeadRevision`。Server 会先校验当前 head，再在单一事务中追加 ArtifactVersion 并使用 CAS 更新 `ArtifactHead`；竞争修改返回稳定冲突错误，不会覆盖他人新版本。

局部重生成只接受 `published` Prompt revision。请求必须携带目标类型、稳定目标 ID、变量和幂等键；任务输入快照会固定 Prompt revision/content hash、目标 revision 与发起时 graph revision。Event/Scene 只追加作用域 Artifact，Shot 只追加 Candidate，均不改写 canonical Event/Scene/Shot，也不覆盖 `selectedCandidateId`。相同幂等键与相同输入返回原任务；复用该键改换目标会返回 409。

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
