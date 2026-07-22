# Cloud v1 P0 安全契约测试

以下 15 项全部是合并门禁。测试环境必须显式设置：

```text
DEMO_MODE=1
PROVIDER_NETWORK_DISABLED=1
```

使用隔离数据库、临时媒体目录、Mock Provider 和可重复时钟。禁止真实 API Key、真实中转站和付费请求。

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| AUTH-001 | 跨租户 IDOR | Org A 成员读取或修改 Org B 的项目 ID | `404 NOT_FOUND`，0 数据、0 写入，并记录脱敏安全事件 |
| AUTH-002 | 同租户越权 | Viewer 调用任意写接口 | `403 FORBIDDEN`；服务端拒绝，不能只依靠前端隐藏按钮 |
| AUTH-003 | 所有权保护 | Admin 删除组织或转移 Owner | `403 OWNER_REQUIRED`，无状态变化，审计记录稳定拒绝原因 |
| AUTH-004 | 邀请重放 | 过期或已使用 token 再次接受 | `410 INVITATION_EXPIRED` 或 `409 ALREADY_USED`；数据库只有 token hash |
| AUTH-005 | 撤销访问 | 成员仍有 REST/Socket 会话时被停用 | 60 秒内断开订阅；后续 API 为 403；本地未提交草稿不丢失 |
| LOCK-001 | 并发编辑 | Editor B 获取 Editor A 持有的 lease | `409 LOCK_HELD`；展示持有者和到期时间，允许复制本地草稿 |
| CAS-001 | 陈旧保存 | `baseRevision` 小于 canonical revision | `409 REVISION_CONFLICT`；0 数据库写入，返回可比较的版本摘要 |
| PROV-001 | 凭证脱敏 | 创建、读取、测试、审计、项目包和诊断 Provider | 0 明文凭证；只允许 `credentialRef` 和不可逆指纹 |
| PROV-002 | SSRF | 端点指向 metadata、loopback 或未授权私网 | `422 ENDPOINT_BLOCKED`；不发起网络请求，返回稳定规则 ID |
| PROV-003 | 共享审批 | Editor 分享个人连接到团队 | `202 pending`；管理员批准前，其他成员不能发现或使用连接 |
| TASK-001 | 未知结果 | unknown 任务直接重试或重复提交 | `409 RECONCILIATION_REQUIRED`；不产生新 attempt 或费用 |
| TASK-002 | 部分失败 | 10 项中 2 项失败后重试 | 只创建 2 个失败项 attempt；8 个成功资产 ID/hash 不变 |
| COST-001 | 重复回执 | 重放相同 `providerReceiptRef` | 只有一笔台账；幂等返回已有记录；预算不重复扣减 |
| BACKUP-001 | 高风险恢复 | Operator 未获 Owner/Admin 确认直接恢复 | `403 CONFIRMATION_REQUIRED`；可以生成验证报告，但不能切换数据 |
| AUDIT-001 | 审计不可变 | 任意角色尝试 UPDATE/DELETE 安全审计 | 数据库拒绝；只允许 append 和受控归档；顺序/hash 校验通过 |

## 额外功能测试 ID

| ID | 目标 |
|---|---|
| PROV-004 | 拒绝上传或执行任意 JavaScript Provider 适配器 |
| BUDGET-001 | 预算阈值、硬停、币种和 revision/CAS |
| PROMPT-001 | Prompt/Skill 发布固定 revision、评测与证据 |
| ROLLBACK-001 | 回滚只追加新 revision，保留 LKG 和完整审计 |
| CORE-E2E-001 | 从团队/项目到导出的完整 Mock 流程 |
| REVIEW-E2E-001 | 评论、指派、批准、stale 与返回路径 |
| EXPORT-001 | 预检、授权、选择完整性、本地导出和 hash |
| A11Y-768-001 | 768px Reviewer 流程、键盘、焦点和 Reduced Motion |
| UX-NOCRDT-001 | 界面不暗示字符级实时共同编辑 |

## 全局断言

- Provider 请求总数为 0，或仅命中进程内 Mock；`billed=false`。
- 日志、响应、事件、审计、项目包和诊断包不包含：密钥、Authorization header、正文、Prompt、完整 Provider payload、signed URL、本机绝对路径。
- 重复提交必须由 Idempotency-Key 收敛；并发修改必须由 revision/CAS 收敛。
- `unknown` 只有“对账结果”主操作；`partial` 只重试失败项。
- 安全错误使用稳定 code 和可理解 `userMessage`，但不泄露跨租户对象是否存在。
- 测试失败时保留 correlation ID 和脱敏诊断，不保留用户内容。

## 测试分层

1. **Schema**：JSON Schema 和 OpenAPI 静态检查。
2. **Unit**：授权器、SSRF 规则、状态转换、幂等与 revision。
3. **API contract**：不同角色、租户和错误 envelope。
4. **Database**：唯一约束、append-only audit、迁移和 rollback。
5. **Browser**：1440/1180/768、弱网、冲突、帮助与恢复入口。
6. **Recovery**：服务重启、Socket 重连、unknown 对账、备份恢复和导出。

只有全部 P0 测试通过，Cloud 写路径才允许从 `Planned` 改为 `Implemented`。
