# 开源功能知识库对照与升级记录

> 当前产品结论（2026-07-21）：知识库中的“隔离可执行插件运行时”只保留为历史安全研究。Local v1 采用 schema v12 的内置 Demo、OpenAI-compatible 和受限声明式 HTTPS Provider；Server 不加载任意 JavaScript、Python 或 Deno 适配器，旧插件路径固定返回 HTTP 410。下文 schema v7/v8 与 Deno 内容是历史实现证据，不是当前产品入口或后续承诺。

## 参考基线

- 本次实际读取：`open-source-feature-knowledge-base@1425238f35b16f23b8a63aee1a109113a164e4a9`。
- 核对日期：2026-07-18。
- 知识库工作区存在用户未提交文件，因此只执行了 `git fetch origin --prune`，没有使用 `pull/reset/clean`。
- 已逐份读取 8 个项目档案、8 份许可证审计、6 份对比研究、10 个通用模式和 24 张正式功能卡。
- 不运行上游项目的脚本、安装器、编译 bundle 或二进制；不调用付费 Provider。

## 项目与许可边界

| 固定项目 | 知识库证据 | 工程采用方式 |
| --- | --- | --- |
| `alibaba/lumenx@7436833` | MIT | 可审计适配模型目录、分层资产、候选和任务模式；素材单独审计 |
| `xuanyustudio/LocalMiniDrama@92c66dd` | MIT | 可审计适配项目包、持久任务、节拍和首尾帧模式 |
| `HBAI-Ltd/Toonflow-app@bc61ec7` | Apache 文本 + 限制性补充协议 | 仅 clean-room 行为研究，不复制源码、Prompt、CSS、品牌或资源 |
| `UllrAI/CineGen-ShortDrama@e0f620b` | 自定义许可 | 仅独立重实现结构化剧本和分阶段交互 |
| `freestylefly/director_ai@dd812c7` | 未发现根许可 | 仅独立重实现导入和计划审阅思想 |
| `Xeron2000/openOii@79e652c` | 未发现根许可 | 仅独立重实现 Artifact 版本、Fake Provider 和画布投影思想 |
| `yuanzhongqiao/printfilm@b5ed4b8` | 未发现根许可 | 仅独立重实现 Prompt 运营和边界帧交互思想 |
| `shuyu-labs/BigBanana-AI-Director@4a61f6c` | 非 OSI、非商业 | 仅 inspiration-only 的出口隔离与媒体边界 |

## 24 项能力差距矩阵

| 知识库能力 | 2.0 真实现状态 | 动作 | 优先级 / 验收 |
| --- | --- | --- | --- |
| structured-script-breakdown | 已实现 Source→Chapter→Event→Scene→Shot，Zod 校验 | harden | P1，单事件失败不污染其他产物 |
| reference-guided-visual-consistency | 已有 Asset/Variant、reference order 和 Prompt provenance；真实 Provider 未验证 | harden | P2，引用快照与绑定契约测试 |
| interactive-prompt-polish | 双语稿、字段 diff、变量编译、last-known-good、发布门禁和局部重生成已实现 | reimplement | **P2 Phase 2 已完成**，生产任务固定 Prompt/目标 revision，旧产物不覆盖 |
| editable-creative-skill-library | 固定 Skill 与用户 fork 并存，支持验证、黄金样例、发布与 rollback | reimplement | **P2 Phase 2 已完成**，内置版本不原地编辑 |
| unified-prompt-operations-workspace | Studio 系统面板已提供版本、编译预览、黄金样例和发布门禁 | harden | **P2 Phase 2 已完成**，Browser 零付费实测 |
| capability-driven-model-catalog | 独立确定性 Model Catalog 已构建；静态能力与 Provider 健康/账单分离 | extract | **P2 Phase 3 已完成**，未知模型/能力 fail fast |
| provider-aware-media-resolution | MediaResolver 校验项目、MIME、大小、顺序和 locator，只返回脱敏 receipt | harden | **P2 Phase 3 已完成**，无 signed URL/Authorization 持久化 |
| checkpointed-hitl-agent-orchestration | ExecutionPlan + 一次性审批 + checkpoint revision + 脱敏记忆 provenance 已实现 | keep | **schema v9 已完成**，已通过防重放与不可覆盖测试 |
| sandboxed-vendor-adapter-runtime | 历史研究代码和表结构保留用于可逆迁移；生产 HTTP 应用不初始化运行时 | avoid | **已关闭**：任意 JS/Python/Deno 适配器固定 410；只允许声明式连接 |
| artifact-version-rollback | ArtifactVersion 不可变依赖链、字段 diff、ArtifactHead CAS、追加式回滚和 Inspector 二次确认已实现 | harden | **P2 Phase 2 已完成**，错误 scope fail closed，历史不覆盖 |
| layered-shared-asset-library | Episode→Series→Global resolver、fork/promote、媒体快照、引用保护与审批式批量改绑已实现 | reimplement | **P2 Phase 1 已完成**，revision drift 不覆盖历史 |
| local-first-project-persistence | SQLite WAL、schema 迁移、任务恢复已实现 | keep | P0 已通过重启恢复 |
| multi-format-story-import | TXT/Markdown sniff→quarantine→preview→commit 已实现 | reimplement | **P2 已完成**，严格 UTF-8/hash/幂等/取消 |
| portable-versioned-project-package | `.aigcproj` v1 永久导入，v2 支持 Project/Series 和共享媒体 | adapt | **P1/P2 已完成**，见下文 |
| fake-provider-test-harness | 确定性 Fake Provider、receipt/reconcile 和零网络 E2E 已实现 | keep | P0 已通过 |
| isolated-egress-proxies | 默认关闭的三通道 Broker、逐跳 DNS/IP、固定地址运输、流式上限与脱敏审计已实现 | harden | **P3 Phase 5 基础完成**，allowlist 为空且无 execute API |
| multi-candidate-shot-review | CandidateBatch、累积候选、收藏、双项比较、分页、Critic 与人工选择已实现 | harden | **P2 Phase 3 已完成**，状态相互独立 |
| visual-production-canvas | Story/Production/Delivery 领域投影已实现 | keep | P1，画布不是 canonical DB |
| conversational-plan-review-execution | 结构化计划、影响预览、审批和执行证据已实现 | keep | P0，未批准不能写生产产物 |
| durable-video-task-lifecycle | Task/Attempt/Receipt/reconcile/orphan/restart 已实现 | keep | P0，未知结果不自动重提 |
| multi-beat-shot-timeline | ShotBeat 稳定 ID、连续 start、最小时长和精确总和已实现 | adapt | **P2 已完成**，property-style test 与 Inspector 编辑 |
| phased-ai-director-workspace | 线性页面已收敛为三张领域图与 Artifact 契约 | keep | P1，行为等价但不恢复旧 UI |
| series-episode-continuity | Project 作为 Episode，Series 顺序、上下文、共享资产与 reconcile 已实现；跨集摘要 Artifact 待 Phase 2 | adapt | **P2 Phase 1 已完成**，摘要 stale 继续推进 |
| shot-boundary-frame-continuity | 显式 BoundaryFrame、相邻传递、hash/revision、有序输入与视频真实尾帧已实现 | reimplement | **P2 Phase 3 已完成**，失败不覆盖原尾帧 |

## 已实现：Series/Episode、分层资产与 `.aigcproj` v2

Project 继续是可独立生产和导出的 Episode 工作单元；旧项目迁移后获得 standalone Episode。Series 提供有序 Episode、艺术方向和共享资产容器。资产解析固定为 Episode local → Series → Global；fork/promote 会复制受管媒体，不依赖来源 Project 路径。批量改绑与 reconcile 先返回 changed/skipped/conflict，随后消费一次性审批 token，在一个事务内更新绑定、反向引用和字段级 stale。

项目切换器可导出 Project 或整个 Series 的自包含项目包。v2 包含 `manifest.json`、`project.json` 或 `series.json`、项目媒体与共享媒体。

- 每个文件记录 size 和 SHA-256，导入前逐个校验。
- 拒绝绝对路径、`..`、反斜杠、重复文件、符号链接、加密/未支持压缩、异常压缩率和解压超额。
- 凭据、Provider secret、日志和本机绝对路径不入包。
- 导入为所有内部实体、计划 step 和关联引用生成新 UUID；Artifact content hash 与依赖 hash 随重映射重算。
- 数据库写入使用单一事务；媒体先进 staging，发布失败时补偿删除新项目，不留半个导入。
- 未完成任务转为 `orphaned`，保留证据但禁止自动重复提交。
- v1 永久可导入；v2 支持 Project/Series。Project 包把实际使用的共享 revision 固定为本地副本；Series 包保留排序和共享资产，但把 Global 依赖固定为 Series 副本，不污染导入端 Global。

## 本次已实现：Shot Beat 与 BoundaryFrame

- 每个 `ShotBeat` 保存稳定 UUID、ordinal、start/duration、动作、运镜、台词和引用；服务端契约要求 Beat 连续且总和精确等于 `Shot.durationMs`。
- 归一算法保留每个 Beat ID，为每拍预留 100 ms 后按权重分配剩余时长，最后一拍只吸收整数舍入差。
- `BoundaryFrame` 保存角色、内部 MediaReference、SHA-256、来源镜头/候选/边界、来源 revision 和 provenance；不保存临时 URL。
- Demo 顺序生产时，上一镜头尾帧会创建为下一镜头首帧的独立绑定快照。Provider Adapter 接收真实、有序媒体对象；模型不支持引用时 fail fast，不静默丢弃。
- Inspector 可编辑 Beat、平均分配、沿用上一尾帧或解除绑定。命令携带 expected graph revision 和 idempotency key，并传播 image/video/timeline/export stale。
- `.aigcproj` 导入会同时重映射 Beat、BoundaryFrame、Media、Shot 与 Candidate ID，保持 hash 和引用关系。
- Browser 在全新隔离 Demo 项目中验证了非法 Beat 总时长阻止保存、合法重新分配、首帧解除/重新沿用、Provider `first-frame` 有序快照和窄屏 Inspector；自动生产 5 个镜头、10 个候选后所有镜头保持 `ready`，console 0 error。

## 本次已实现：Prompt、Artifact 与 Skill 运营

- schema v4 新增 `PromptRevision`、`ArtifactHead`、`SkillPackageVersion` 和 `GoldenEvaluation`，v3→v4 使用独立事务且可重复执行。
- Prompt 同时保存 original、中文审阅稿、英文执行稿、变量/Output Schema、feedback、模型策略和 hash；缺变量时 fail fast。
- Prompt publish/restore、Skill publish/rollback 都追加新 revision/version；内置 Skill 只能 fork，非白名单资源不得发布。
- 黄金样例使用 Fake Provider 结构输出，未通过时发布门禁明确失败，不请求外部模型。
- Artifact rollback 先校验 expected head revision，再在事务中追加版本并 CAS 更新 head；竞争更新不会覆盖新产物。
- Browser 实测 Prompt r1 编译、黄金样例、发布 r2，Skill 1.0.0 fork、黄金样例和发布 1.0.1；付费请求 0，console 0 error，390×844 无横向溢出。

## 本次已实现：CandidateBatch、Model Catalog、MediaResolver 与真实尾帧

- schema v5 新增 `CandidateBatch` 和 `ProviderMediaReceipt`。每个 Demo Shot 创建独立批次，Candidate 固定 batch lineage、参数快照、label、tags 与 favorite；批次状态由实际任务和结果计算。
- `packages/model-catalog` 构建确定性 runtime artifact，模型稳定 ID、modality、capability、输入形式、限制、默认参数和 content hash 经 Zod 校验。静态能力与 Provider 健康/账单分离，未知组合 fail fast。
- MediaResolver 按模型校验 project、MIME、size、引用数、顺序和 locator containment。长期状态只保存内部 MediaReference 与脱敏 receipt，不写 signed URL、Authorization、API Key 或本机路径。
- Studio 候选评审支持收藏、最多两项比较、稳定批准、全部/收藏筛选、每页 50 项和方向键/Enter/空格；这些状态不会互相覆盖。
- `boundary_extract` 是可取消、可重启恢复的本地任务。FFprobe 校验视频，FFmpeg 提取最后可解码帧，校验 PNG magic/尺寸/hash 后原子发布；失败保留原 BoundaryFrame。
- 阶段门禁通过 99 项 workspace test、typecheck 与 lint；Smoke 真实覆盖 CandidateBatch、媒体 receipt、视频尾帧、有效 MP4 与服务重启，付费请求为 0。

## 本次已实现：可追溯分层记忆

- schema v6 新增独立 `memory_documents`/`memory_chunks`，不复用旧的通用 payload 作为 Agent 事实源。
- schema v7 新增 `provider_plugin_versions`，持久受验签名版本、相对 bundle locator、revision 和脱敏测试证据；schema v8 新增 `provider_publishers`，持久可撤销 Ed25519 信任、公钥指纹和 revision。信任列表与 enable 门禁仍默认为空/关闭。
- 重建只索引已批准 Event/Artifact、Series Bible、SharedAsset、用户反馈和选定 Candidate 摘要；来源 revision 变更会使旧记忆 stale，不删除审计历史。
- 检索固定 Episode → Series → Global scope 优先级，并返回 matched keywords 和采用原因。禁用/删除只影响召回索引，不改写 canonical source。
- 敏感扫描拒绝 credential、signed URL、Provider 原始响应、二进制内容与本机私密路径。默认为零网络关键词检索；ONNX 固定模型/revision/hash 已记录，不会自动下载。
- Browser 实测重建、来源解释、禁用/恢复与删除二次确认；390×844 无横向溢出，console 0 error。

## 本次最终实现：声明式 Provider 与可执行适配器关闭

- schema v12 新增 Provider connection、按模态 route policy 与追加式 cost ledger；Demo、OpenAI-compatible 和声明式 HTTPS manifest 共用超时、限流、异常格式、取消、对账和降级契约。
- 连接创建和测试强制 HTTPS、安全 origin 与受限协议能力。secret 由系统 Keychain/Credential Manager 或 Docker Secret 解析，API、日志、项目包和诊断包均不返回 secret。
- 用户自付模式必须显式启用 Provider、设置每日预算并确认实际提交；产品不托管余额、不代扣。未知 Provider 结果只能先 reconcile，不允许直接 fallback 或重复扣费重试。
- 历史 Broker、签名 bundle、Deno 安装器与插件监督器保留为安全研究和迁移证据，但不再进入 HTTP 应用依赖图。所有 `/api/v2/provider-plugins*` 与 `/api/v2/provider-plugin-publishers*` 路径固定返回 410 `EXECUTABLE_PROVIDER_ADAPTERS_DISABLED`。
- 最终 `pnpm quality` 通过 235 项 workspace tests、Smoke、FFmpeg、clean-room、安全扫描与 Server/Studio/Desktop 生产构建；`pnpm local:smoke`、`pnpm docker:smoke`、Electron preflight 和生产依赖审计均通过，付费请求 0。

## 后续路线

本轮新增的 TXT/Markdown 垂直切片不会执行 Markdown/HTML；取消时数据库保持不变，确认时再次校验 SHA-256，并以数据库幂等记录防止崩溃重放创建重复 Source。Browser 已实测选择、预览、取消、重新选择和确认生成 2 章/4 事件。

1. P2：跨集摘要 Artifact 已固定来源 revision；逐场景/逐镜头字段 patch、事务 CAS 和字段级 stale 已完成，继续补充可视化冲突修复与长剧本部分失败重跑。
2. P2：候选失败项 retry API、批量比较性能和真实视频尾帧恢复诊断。
3. 外部门禁：真实 Provider live verification、桌面签名/公证与线上更新只在明确授权和凭据齐备后验收；Deno/任意可执行适配器不再是产品路线。

本文的许可证结论是工程风险提示，不替代正式法律意见。
