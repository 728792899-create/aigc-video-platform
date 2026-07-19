# Prompt Pack 集成报告

> 完成日期：2026-07-17
> 模式：Demo/Fake Provider，Provider Key 为空，网络调用 0，计费请求 0。

## 结论

`@local/ai-video-director-prompt-pack@0.1.0` 已成为当前 2.0 运行时唯一 Prompt/Skill/Workflow Registry。首条 P1 纵向切片已从原著事件走到人工批准产物，并保存可对账、可恢复的全链路证据。

## 16 个可审计环节

| # | 环节 | Prompt / 执行 | 持久证据 |
| --- | --- | --- | --- |
| 1 | 需求归一 | `intent.normalize@1.0.0` | CreativeBrief |
| 2 | 故事扩展 | `story.expand@1.0.0` | StoryOutline |
| 3 | 剧本结构化 | `script.structure@1.0.0` | ScriptRevision |
| 4 | 实体提取 | `entity.extract@1.0.0` | EntityCandidates |
| 5 | 风格分析 | `style.analyze@1.0.0` | StyleAnalysis |
| 6 | 镜头规划 | `shot.plan@1.0.0` | ShotPlan |
| 7 | 角色细化 | `asset.character_refine@1.0.0` | CharacterVariants |
| 8 | 场景细化 | `asset.location_refine@1.0.0` | LocationVariants |
| 9 | 道具细化 | `asset.prop_refine@1.0.0` | PropVariants |
| 10 | 连续性快照 | `continuity.snapshot@1.0.0` | ContinuitySnapshot |
| 11 | 画面构图 | `frame.compose@1.0.0` | FramePlans |
| 12 | 图像 Prompt 编译 | `prompt.image_assemble@1.0.0` | ImagePromptRun |
| 13 | 候选生成 | Fake Adapter submit/poll | CandidateSet + receipt |
| 14 | 候选 Critic | `candidate.critic@1.0.0` | ImageReviewDecision + automatic ReviewDecision |
| 15 | 人工批准 | Graph `select_candidate` | human ReviewDecision |
| 16 | 批准产物 | 幂等选择命令 | ApprovedCandidate ArtifactVersion |

前 11 个阶段串联 Artifact 依赖；镜头 Prompt 依赖 FramePlans；CandidateSet 依赖实际 Prompt 产物；Critic 依赖 CandidateSet；ApprovedCandidate 依赖 Critic。每个产物均有稳定 ID、revision、content hash 和 scope。

## 任务与恢复

- 任务创建前固定 Prompt/Skill/Profile/Model capability。
- 每次执行产生 TaskAttempt；Provider 接收后立即保存脱敏 receipt。
- `timeout-after-accept` 通过幂等键 reconcile，不重复 submit。
- 服务重启后，已有 receipt 的 Demo 图像任务可重建缺失媒体和 Candidate。
- 自动 Critic 只能写 `pending`；必须由人工命令创建最终批准决策。

## Studio 可见证据

- Task Inspector：Prompt/Skill/Profile/compiled hash、receipt/reconcile、Artifact revision/hash/dependency。
- Candidate Inspector：媒体、Provider/Model、自动 Critic rubric/原因、人工决策、评审与批准 Artifact。
- Systems：Registry 的 Prompt/Skill/Workflow/阶段数，以及当前项目 PromptRun/Artifact/Critic 数量。

## 验证边界

- 已验证：精确版本编译、Schema 校验、双候选、人工选择、幂等、receipt、超时对账、重启恢复、有效 MP4 导出。
- 未验证：任何真实 Provider 的质量、费用、cancel/reconcile 线上语义。
- 发布门禁：Prompt Pack 是 private/UNLICENSED 用户提供输入；未确认对外许可前，不得将其作为可公开分发依赖发布。

## 执行记录

| 命令 | 2026-07-18 实际结果 |
| --- | --- |
| 知识库 Prompt Pack 隔离副本：`npm ci && npm run check && npm test && npm run build && npm audit --audit-level=moderate` | 通过；6 个 test file、19/19 测试、0 vulnerabilities；只在 `/tmp` 副本运行，知识库未修改 |
| `DEMO_MODE=1 PROVIDER_NETWORK_DISABLED=1 pnpm quality` | 通过；typecheck、lint、68 项 workspace test、clean-room、security、FFmpeg、production build 和 Smoke 全部完成 |
| `pnpm test:smoke` | 1/1 通过；16 环节、3 镜头/6 候选、人工批准、MP4/FFprobe 和重启恢复；付费请求 0 |
| `pnpm prepare:package` | 通过；离线 store 缺少 tarball 时复用直接依赖版本完全一致的既有本地 stage，并再次用 Electron 加载 native SQLite、运行 package preflight；该降级不等同于内容完整性证明，干净 CI 仍走标准 `pnpm deploy` |
| `pnpm electron:preflight` | 全部通过；隔离 server、Prompt Registry、Electron ABI、CSP/IPC 与发布资源均合格 |
| `git diff --check` | 通过 |

分项测试计数：Prompt Pack 19、contracts 6、desktop 5、studio 10、domain 4、providers 3、media 1、agents 6、server 14，共 68 项；另有 1 项完整 Smoke。Clean-room 扫描覆盖 50 个 runtime/public 文件，安全扫描覆盖 143 个源文件与 28 个构建文件。

Prompt Registry 的 SHA-256 在源包、Server build 和 package stage 中均为 `f8481ecfc4f7f2edebcc110c9515259080f2884b0c689acb11233bd55eda7920`；Skill Registry 在三处均为 `5139d11c78743974b63293e6f52ae089d8b5e0ef08b6523e71e1807bd356b974`。
