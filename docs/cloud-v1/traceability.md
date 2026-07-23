# Cloud v1 双向追踪矩阵

状态：RC2。任何 Proposed 能力进入实现前，必须同时拥有决策 ID、Figma node、领域/API 契约、Vue owner 和自动化测试 ID。

## 决策 → 设计 → 研发 → 测试

| 决策 | 能力 | Figma node | API / Event | Vue 责任组件 | Test ID |
|---|---|---|---|---|---|
| D01 | 组织与固定角色 | `13:2` `13:20` `24:100` | Identity & Tenant API | TeamGovernance、ProjectHub | AUTH-001..005 |
| D03 | Presence | `22:70` `18:40` | `presence.updated`、GET presence | PresenceAvatar、OnlineBadge | AUTH-005 |
| D04 | Soft Lock + CAS | `14:63` `18:40` | locks API、`lock.updated` | SoftLockBanner、RevisionConflictDialog | LOCK-001、CAS-001 |
| D05 | 异步审阅 | `22:70` | review threads/comments/decisions | ReviewThread、ReviewDecision | AUTH-002、CAS-001、REVIEW-E2E-001 |
| D06 | 个人/团队 Provider | `24:2` | provider-connections/share-requests | ProviderConnectionCard | PROV-001、PROV-003 |
| D07 | RelayApproval / ModelBinding | `24:2` `24:100` | relay-approvals/model-bindings | RelayApproval、ModelBinding | PROV-002、PROV-004 |
| D08 | 成本与预算 | `23:2` `22:192` | cost-ledger/budget、`cost.updated` | CostBadge、CostGate | COST-001、BUDGET-001 |
| D09 | Prompt/Skill 治理 | `23:111` | 当前 prompt/skill revision API | RevisionDiff、EvalResult | PROMPT-001、ROLLBACK-001 |
| D10 | 备份与恢复 | `24:100` `22:192` | 当前 recovery/project-package | BackupCard、RestoreConfirmation | BACKUP-001 |
| D11 | 不采用 CRDT | `14:63`、Responsive | 无新增 API，显式 Deferred | LockedStageExplanation | UX-NOCRDT-001 |
| D12 | 禁止任意 JS Provider | `24:2` | egress/plugin policy | ProviderTrustWarning | PROV-004 |
| Core | 任务恢复 | `23:2` | 当前 tasks/reconcile/retry-failed | TaskCard、DiagnosticPanel | TASK-001、TASK-002 |

Figma 文件：[Cloud Production Prototype v2](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn)。P8 范围冻结 node `39:2`，P9 契约包 node `57:2`。

## 九条原型流程 → E2E

| Flow ID | 原型起点 | 验收任务 | Test ID |
|---|---|---|---|
| FLOW-01 | First Team | 创建团队、邀请、接受、修改角色、撤销访问 | AUTH-001..005 |
| FLOW-02 | Full Production | 简报→剧本→资产→分镜→生成→审阅→时间线→导出 | CORE-E2E-001 |
| FLOW-03 | Async Review | 评论、提及、指派、Presence、批准和 stale | REVIEW-E2E-001 |
| FLOW-04 | Relay Provider | 个人连接、脱敏测试、SSRF、团队审批和撤销 | PROV-001..004 |
| FLOW-05 | Partial Retry | 部分成功后只重试失败候选 | TASK-002 |
| FLOW-06 | Unknown Reconcile | 未知结果先对账，再决定是否重试 | TASK-001 |
| FLOW-07 | Prompt Release | revision、diff、评测、发布、LKG 和回滚 | PROMPT-001、ROLLBACK-001 |
| FLOW-08 | Export & Backup | 预检、导出、项目包、备份验证和恢复确认 | EXPORT-001、BACKUP-001 |
| FLOW-09 | Reviewer 768 | 窄屏审阅、键盘焦点、Reduced Motion | A11Y-768-001 |

## 前端状态追踪

| 领域状态 | 组件 | 唯一或主要动作 | 数据来源 |
|---|---|---|---|
| `ready` | StatusPill + Primary Button | 前往具体下一阶段 | canonical prerequisite |
| `saving` | SaveIndicator | 等待保存完成或取消离开 | local dirty + pending request |
| `locked` | LockedStageExplanation | 查看缺少条件 / 前往上一阶段 | canonical snapshot |
| `stale` | InlineAlert + RevisionDiff | 检查变化并重新确认 | entity revision drift |
| `partial` | TaskCard + CandidateGrid | 仅重试失败项 | task status |
| `unknown` | DiagnosticPanel | 对账结果 | task status |
| `failed` | ErrorSummary | 打开诊断 / 安全重试 | stable error code |
| `conflict` | RevisionConflictDialog | 比较版本 / 复制草稿 | 409 revision conflict |
| `offline` | OfflineBanner + LocalDraft | 重连并检查变化 | network state |
| `no_permission` | PermissionNotice | 申请访问 / 返回项目中心 | 403 + membership |
| `credential_missing` | ProviderConnectionCard | 配置个人连接 / 使用 Demo | policy + credentialRef absent |
| `budget_gate` | CostGate | 确认预算 / 选择降级模型 | project budget |

## 实现状态变更规则

`Planned` 只能在以下证据全部存在后改为 `Implemented`：

1. 机器可读契约已合并并通过 `pnpm contracts:cloud:validate`。
2. 对应 P0 测试先失败、实现后通过。
3. API、数据库、Vue 和 Figma 的稳定名称一致。
4. Browser/Electron 或适用客户端流程有复测记录。
5. 安全、权限、弱网、冲突和恢复路径均可从 UI 到日志追踪。
6. Demo Mode 真实付费请求为 0。

只完成静态页面、隐藏按钮或前端 Mock 不足以更改实现状态。
