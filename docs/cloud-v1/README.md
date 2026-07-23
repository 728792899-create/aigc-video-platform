# Cloud v1 历史研究契约包（RC2）

状态：**已归档的未来研究，不属于当前产品范围或研发排期**
事实基线：当前 schema v12、既有 `/api/v2`、任务状态机和 `.aigcproj` 继续有效
安全边界：全部示例使用 Mock / Demo，真实 Provider Key 与付费请求为 0

> 2026-07-21 产品决策：当前版本采用 [`Local v1`](../local-v1/README.md)，不设计登录、账号、组织、成员或云端数据库。本目录仅保留历史设计与安全研究，不得作为当前实现任务。

这组文件把 Figma Cloud Production Prototype v2 中已经冻结的产品决策转换为机器可读契约。它只描述未来云端协作能力，不修改当前本地优先桌面版的数据库、接口或运行时行为。

## 交付物

| 文件 | 用途 | 当前状态 |
|---|---|---|
| [`openapi.json`](openapi.json) | Cloud v1 拟议 REST 接口、权限、幂等、revision 与错误格式 | Proposed RC2 |
| [`schemas/domain.schema.json`](schemas/domain.schema.json) | 组织、成员、审阅、Provider、预算与成本领域对象 | Proposed RC2 |
| [`schemas/events.schema.json`](schemas/events.schema.json) | Presence、Soft Lock、审阅、任务、成本与权限事件 | Proposed RC2 |
| [`permissions.json`](permissions.json) | 六个固定角色的服务端授权矩阵 | Proposed RC2 |
| [`migration-design.md`](migration-design.md) | schema v12 向云端持久化扩展的可回滚迁移设计 | Review required |
| [`security-contract-tests.md`](security-contract-tests.md) | 15 项 P0 越权、并发、凭证、计费和恢复测试 | Required before merge |
| [`traceability.md`](traceability.md) | P8 决策 → Figma → API → Vue → 自动化测试 | Review required |

离线校验：

```bash
pnpm contracts:cloud:validate
```

校验只解析本地 JSON、引用和安全规则，不访问网络，也不会调用 Provider。

## Figma 事实源

- [Local v1 当前范围](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=76-631)
- [P8 范围与契约冻结](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=39-2)
- [P9 研发契约包](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=57-2)
- [Cloud Production Prototype v2](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn)

Figma 中 `Current` 只指当前 schema v12 / API v2 能力；`Proposed`、`Deferred`、`External Gate` 和 `Forbidden` 不得被研发或评审者理解为已上线。

## 已冻结的首版原则

1. 六个固定角色：Owner、Admin、Editor、Reviewer、Operator、Viewer。自定义角色、SSO 和 SCIM 不在首版。
2. 多人协作使用 Presence、建议性 Soft Lock、评论和 revision/CAS；不承诺 CRDT 字符级共同编辑。
3. 项目事实只有一份 canonical snapshot。清单、阶段、stale、partial、unknown 和恢复入口都从事实与任务推导。
4. 个人 Provider 连接默认私有；项目/团队共享必须经过管理员审批。
5. 凭证进入服务端 Vault/KMS，领域对象和响应只暴露 `credentialRef` 与不可逆指纹。
6. 中转站必须经过 HTTPS、DNS、SSRF、协议与脱敏连通性检查；云端禁止任意 JavaScript 适配器。
7. `unknown` 结果只能先对账；`partial` 只重试失败项；所有重试保持幂等和资产一致性。
8. 成本台账只记录 receipt、估算、实际成本、币种与项目预算；真实余额、税务和采购属于 External Gate。

## 仍阻断生产实现的确认

| ID | 确认项 | 建议 |
|---|---|---|
| P8-Q01 | OIDC 身份供应商、账号找回和 MFA | 应用仅保存 external subject，不自建密码 |
| P8-Q02 | 数据驻留、保留和删除 SLA | 在选择云区域与对象存储前关闭 |
| P8-Q03 | 云端持久化 | PostgreSQL + S3-compatible object storage；Redis 只存临时 lease |
| P8-Q04 | 币种、税务、采购与真实结算 | 首版可先保留成本台账，不接真实余额 |
| P8-Q05 | 通知通道 | 首版仅站内；邮件、推送、企业 IM 后续评估 |
| P8-Q06 | RPO、RTO 与恢复审批 | 当前建议 7 个日备份 + 4 个周备份 |

## 若未来重新启动云端版本

- 产品、设计、架构、后端、前端、测试、安全和运维完成签字。
- 六个开放确认均有结论、责任人和验收条件。
- OpenAPI、领域 Schema、事件 Schema、权限矩阵和测试 ID 能双向追踪。
- 15 项 P0 安全契约测试先失败、实现后全部通过。
- `DEMO_MODE=1`、`PROVIDER_NETWORK_DISABLED=1` 下完整流程通过，真实付费请求为 0。
- 任何接口实现不得破坏当前 `/api/v2`、schema v12、本地项目包或桌面 Demo。

## 版本策略

Cloud v1 端点是 `/api/v2` 的 **additive surface**。现有字段或语义若需要破坏性修改，必须进入 `/api/v3`，不能在 v2 中静默改变。数据库迁移从 v12 基线扩展，但具体版本号在合并时分配，避免与并行开发冲突。
