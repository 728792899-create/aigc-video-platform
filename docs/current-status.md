# 当前项目状态

更新日期：2026-07-23
适用分支：`codex/director-platform-spec-upgrade`
状态：本地优先开发预览版；零 Key Demo 可运行；正式公开发布仍有外部门禁

本文是仓库内产品形态、实现范围、验证状态和剩余风险的单一当前事实源。历史测试数量、旧 schema 或已归档 Cloud 研究不覆盖本文。

## 当前产品形态

- 用户首选入口是 `pnpm start`：构建 Studio 与 Server，在 `127.0.0.1:33100` 启动单一服务并打开浏览器。
- Docker Compose 提供一键本地部署，只把端口映射到宿主回环地址。
- Electron 40 复用同一 Studio 与本地数据源，当前用于开发模式与桌面流程验证；安装包签名、公证和自动更新尚未完成。
- 产品不要求登录、账号、组织或云端数据库。项目、媒体、任务、检查点和恢复证据保存在本机。
- 当前数据事实源是 SQLite schema v12；HTTP 接口是 `/api/v2`，任务实时通道是 Socket.IO `/studio-v2`。

## 当前界面与工作流

- 固定使用 Obsidian Atelier 低饱和暗色体系。
- 只有一层可折叠主侧栏，项目内使用横向八阶段导航。
- 桌面侧栏可收起为 72px；≤768px 时转为单层底部导航。项目中心的项目列表与指标区已修正为无横向溢出网格，窄屏主操作占满内容宽度。
- 16 个可深链接 Workspace 在 `/studio/:projectId?` 内切换；Story、Production、Delivery 是制作画布的局部投影，不是第二层导航。
- 主流程覆盖项目/Demo、简报、剧本、资产、分镜、连续性、生成、审阅、时间线、画布、Prompt/Skill、任务、Provider 连接、导出设置与本地治理。
- 未具备后端契约的自由剪辑、多人协作、云端 RBAC 与真实结算必须显示 Planned 或 External Gate，不伪装为可用功能。

## 安全与 Provider 边界

- 默认 `DEMO_MODE=1`、`PROVIDER_NETWORK_DISABLED=1`，Demo 任务固定记录 `provider=demo-local`、`billed=false`。
- 本机服务使用一次性 bootstrap token、HttpOnly session Cookie 与 Origin 校验；服务重启后旧会话明确失效，用户数据不丢失。
- 凭据进入系统 Keychain/Credential Manager 或 Docker 只读 Secret，不进入 API 响应、日志、项目包、诊断包或成本账本。
- `unknown` 任务只能先对账；`partial` 只重试失败项。所有危险写操作使用 revision/CAS、幂等键、二次确认和 append-only 安全审计。

## 当前验证门禁

发布前必须在显式无 Key 环境运行：

```bash
DEMO_MODE=1 PROVIDER_NETWORK_DISABLED=1 pnpm quality
DEMO_MODE=1 PROVIDER_NETWORK_DISABLED=1 pnpm test:smoke
```

`pnpm quality` 覆盖 workspace tests、TypeScript strict、ESLint、生产构建、安全扫描、clean-room 检查、Cloud 归档契约校验、FFmpeg 有效 MP4、局部失败重试与服务重启恢复。准确测试数量和最新结果以本次 GitHub 提交的 CI 输出及[开发预览验收报告](development-preview-acceptance.md)为准，不在本文复制易过期的数字。

## 已知剩余门禁

- 正式 Provider 的真实线上协议、限流、计费与取消语义尚未进行付费 live verification。
- macOS/Windows 安装包签名、Apple 公证、Windows 干净机、真实更新服务尚未完成。
- 六角色内部联合评审和真实创作者可用性观察仍需人工签字。
- Product Design 运行时审计已关闭项目中心溢出、双层窄屏导航和桌面启动探针三类问题，1440/1180/≤768 实机度量通过。Figma 节点级像素对比仍受文件 MCP 访问权限阻塞，不宣称一比一像素验收完成。

以上门禁不影响零 Key Demo、本地 Web、Docker、开发模式 Electron 与自动化恢复测试；它们会影响“正式公开发布”声明。
