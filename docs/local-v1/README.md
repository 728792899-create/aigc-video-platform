# Local v1 产品范围（Final）

状态：**当前产品、设计与研发事实源；已通过 Figma 最终清扫**
决策日期：2026-07-21
产品边界：单用户、本地优先、无需账号、无需登录、无需云端数据库

Local v1 启动后直接进入本地项目中心。项目、媒体、任务、检查点和恢复证据保存在用户设备上；当前 schema v12、`/api/v2`、任务状态机和 `.aigcproj` 继续作为实现基线。

## 当前包含

- 本地项目创建、导入、备份、恢复与项目包迁移。
- 主题、简报、剧本、资产、分镜、生成、候选审阅、时间线和导出。
- Demo Mode 零 Key 全流程，以及任务失败、部分成功、取消、重试和重启恢复。
- 本地 SQLite 数据库、项目媒体目录和用户选择的导出/备份目录。
- Provider 官方端点、OpenAI-compatible 端点和声明式 HTTPS 端点的本地适配、按模态降级路由与成本账本。
- API Key 通过 macOS Keychain 或 Windows Credential Manager 保存；前端、日志、项目包和诊断包只允许出现不可逆指纹或 `credentialRef`。
- Demo 默认禁用 Provider 网络；真实 Provider 联网必须由用户显式配置并触发。
- 本机生产服务使用 `pnpm start` 一键构建并在 `127.0.0.1:33100` 启动，随后自动打开默认浏览器；`pnpm local` 保留为兼容别名。Docker 使用 `pnpm start:docker` 一键构建、健康检查并打开浏览器中的工作台。

## 当前明确不包含

- 登录、注册、邀请、账号找回和多因素认证。
- 组织、成员、团队角色、RBAC、Presence 和 Soft Lock。
- 云端 PostgreSQL、对象存储、Redis、云同步和远程备份。
- 在线评论、远程审片、站内通知、邮件通知和企业 IM。
- 云端余额、订阅、税务、采购与团队成本结算。
- SSO、OIDC、SCIM 和跨设备身份体系。

上述能力不得出现在当前产品主流程、开发排期或验收清单中。此前的 [`docs/cloud-v1`](../cloud-v1/README.md) 仅保留为历史研究，不是当前实现目标。

## 启动与导航

```text
运行 pnpm start / pnpm start:docker
  → 服务健康检查
  → 默认浏览器打开本地项目中心
  → 恢复现场 / 新建项目 / 导入项目包 / 打开零 Key Demo
  → 简报 → 剧本 → 资产 → 分镜 → 生成 → 审阅 → 时间线 → 导出
```

产品不得显示登录拦截页。没有项目时显示项目中心空状态，而不是账号注册页。

## 本地数据边界

| 数据 | 保存位置 | 备份/迁移 |
|---|---|---|
| 项目事实、任务、检查点 | 本地 SQLite | 项目包与本地备份 |
| 图片、视频、音频、字幕 | 项目媒体目录 | 项目包按清单复制并校验 hash |
| Provider 凭证 | 系统 Keychain/Credential Manager；Docker Secret | 不进入项目包、数据库业务表或日志 |
| 用户界面偏好、引导状态 | Electron/浏览器本地偏好 | 不属于项目事实 |
| 导出文件 | 用户选择目录 | 用户自行管理 |

## Figma 事实源

- [Local v1 最终研发交付板 P12](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=95-2)
- [Local v1 范围决策板 P11](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=76-631)
- [Local-first 信息架构](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=76-2)
- [本地项目中心](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=76-126)
- [本地完整制作流程](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=26-1183)

最终 Figma 交付包含 16 个主界面、2 个响应式变体、66 个 Component Sets、198 个 variants 和 93 个 Variables。活动原型仅保留 6 个 Starting Points；共验证 66 条交互连线，断链为 0，指向归档 Cloud 节点的活动连线为 0。完整索引与归档边界见[最终研发交付说明](final-handoff.md)。

## 验收原则

- 无账号、无登录、无云数据库也能完成全流程。
- `DEMO_MODE=1`、`PROVIDER_NETWORK_DISABLED=1` 下付费请求为 0。
- 关闭应用或本地服务后，未完成任务可恢复或进入可诊断状态。
- 任何凭证不得出现在前端响应、日志、数据库、项目包或诊断导出中。
- 用户始终知道数据保存位置、备份位置和导出目标。
