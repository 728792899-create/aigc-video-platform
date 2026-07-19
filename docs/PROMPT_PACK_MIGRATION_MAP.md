# Prompt Pack 迁移映射

> 唯一正式 Prompt/Skill 定义来源：集成后的 `packages/ai-video-director-prompt-pack/registry`。宿主数据库只保存固定运行快照、版本引用和项目 override，不维护第二套内置模板。

| 个人项目概念 | 统一概念 | 数据所有者 | 转换函数/适配边界 | 持久化位置 | 迁移策略 |
| --- | --- | --- | --- | --- | --- |
| Project | ProjectContext | `projects` | `mapProjectContext` | 现有 projects + PromptRun input hash | 保留稳定 UUID，不复制项目实体 |
| SourceDocument/Chapter/Event | variables.input/context | 现有 story tables | `mapStoryContext` | 现有表；PromptRun 固定 hash | 只传选择范围与已批准事实 |
| Scene/Shot | Script/Scene/Shot/Beat variables | 现有 scenes/shots | `mapShotContext` | 现有表 | Shot ID、revision、ordinal 保持不变 |
| Asset/Variant/Media | identity/continuity/reference context | 现有 asset/media tables | `mapAssetBindings` | 现有表 + PromptRun media order | Provider 不得自行重排引用 |
| Skill package/风格预设 | SkillManifest exact version | Prompt Pack Registry | `resolveSkillRefs` | PromptRun 固定 id/version/hash | 默认 manifest-first；按工作流/项目选择激活 |
| FakeProvider | ProviderAdapter | Prompt Pack Provider contract | `PromptPackProviderBridge` | TaskAttempt + ProviderReceipt | 首个纵向切片只启用 Fake scenario |
| Model capability | ModelCapability snapshot | Prompt Pack ModelCatalog | `resolveModel` | PromptRun/Task snapshot hash | 不根据品牌猜能力；不支持即 fail fast |
| GenerationTask | GenerationTask | 现有 task service | `createPromptBoundTask` | generation_tasks | 新生成任务必须包含 promptRunId |
| Task attempt | TaskAttempt | task service | `executePromptPackFakeTask` | task_attempts | 每个逻辑 attempt 独立建档；同一记录保存该 attempt 的状态演进 |
| Provider receipt | ProviderReceipt | task service | `recordReceipt` | provider_receipts | 远端/假远端 ID 与幂等键可对账 |
| Candidate | Candidate Artifact | 现有 candidates | `materializeDemoCandidate` + `runDemoCandidateCritics` | candidates + artifact_versions + review_decisions | 每镜头两个候选；新候选不覆盖已选候选 |
| Stage output | ArtifactVersion | DirectorService | `persistArtifactVersion` | artifact_versions | 固定 workflow/stage/scope/revision/hash/parent/dependencies；相同内容幂等复用 |
| Human selection | ApprovedCandidate | graph command service | `select_candidate` | review_decisions + artifact_versions | 人工批准创建新产物，不改写自动 Critic 证据 |
| Agent Approval | Workflow gate | 现有 approvals | 保留现有一次性 token | agent_approvals | Prompt Pack workflow gate 映射，不建第二套审批 |
| GraphProjection | UI projection | domain projection | 现有 `projectGraph` | graph_layouts 仅保存布局 | 禁止画布保存 Prompt/Task 第二真相 |

## 编译优先级

```text
Prompt Pack system safety
→ output schema
→ 资产身份与连续性锁
→ 已批准项目事实
→ 用户本轮要求
→ exact Skill 软策略
→ exact Provider Profile 渲染约束
```

宿主只通过 `packages/agents` 的集成边界调用 Pack；Vue 页面、Route 和数据库 repository 不直接读取 Registry JSON 内部结构。
