# Local v1 开发预览验收报告

验收快照：2026-07-23
分支：`codex/director-platform-spec-upgrade`
范围：Figma Cloud Production Prototype v2 结构目标、Vue `/studio/:projectId?`、本机 Web 服务、Docker、Electron 开发模式、schema v12 与 `/api/v2`
安全边界：所有自动化均保持 `DEMO_MODE=1`、`PROVIDER_NETWORK_DISABLED=1`、Provider Key 全空，付费请求为 0

本报告记录本轮可复现证据，不代替产品、设计、研发、测试和安全负责人的人工签字。正式安装包、代码签名、公证、自动更新、Windows 实机和真实 Provider 仍属于外部门禁。

## 结论

当前版本达到“可内部联合评审、可运行零 Key 完整 Demo、可继续研发”的开发预览门槛：16 个本地工作区已经落地；本机一键服务和 Docker 一键部署均通过健康检查；失败候选可只重试失败项并幂等复用；重启后原失败证据、重试子任务和成功结果均可恢复；FFmpeg 能生成可探测的 MP4。

本轮没有把“真实 Provider 联网”“正式签名发行”或“未在已解锁 macOS 中重跑的原生目录选择”标记为完成。

## Figma 门禁

- 文件：[AIGC 导演工作室 · Local v1](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn)
- 最终交付板：[P12 / LOCAL-V1-FINAL-HANDOFF](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=95-2)
- 16 个活动主界面、2 个响应式变体、66 个 Component Sets、198 个 variants、93 个 Variables。
- 6 个活动 Starting Points、66 条交互连线、0 断链、0 条活动连线进入归档 Cloud 节点。
- Current、Planned、External Gate 和 `ARCHIVE/*` 边界明确；登录、团队协作和云数据库不属于 Local v1。
- 详见[最终研发交付说明](local-v1/final-handoff.md)与[工作区交付矩阵](studio-workspace-delivery-matrix.md)。

## 自动化门禁

| 门禁 | 结果 | 本轮证据 |
| --- | --- | --- |
| `pnpm quality` | 通过 | strict typecheck、ESLint、257 项 workspace tests、clean-room、安全扫描、FFmpeg、Server/Studio/Desktop 生产构建与 Smoke |
| `pnpm test:smoke` | 通过 | 零 Key 全链路、有效 MP4、partial retry、幂等重放和重启恢复 |
| `pnpm local:smoke` | 通过 | 随机 loopback 端口启动、健康检查、Demo 网络关闭与安全退出 |
| `pnpm docker:smoke` | 通过 | 干净镜像构建、非 root/只读根文件系统、Docker Secret 边界、健康检查和停止清理 |
| `pnpm electron:preflight` | 通过 | ASAR、原生 ABI、CSP、`contextIsolation`、sandbox、IPC 白名单、ATS、图标/entitlement 与启动恢复 probe |
| `pnpm audit --prod --audit-level=high` | 通过 | 0 个已知 high 级生产依赖漏洞 |
| 安全扫描 | 通过 | 239 个源文件、51 个构建文件；未发现密钥、运行数据库、日志或用户文件 |
| FFmpeg 冒烟 | 通过 | 1.000 秒有效 MP4，输出 3,671 bytes，可由 FFprobe 读取 |

Studio 生产构建只保留已登记的 chunk-size 提示：主 chunk 514.94 kB（gzip 156.77 kB）、Vue Flow chunk 217.31 kB（gzip 70.95 kB），不影响本轮功能验收，但继续进入性能台账。

## 可靠性验收

Smoke 在确定性 Demo Provider 上注入一个失败候选并形成 `partial` 批次，然后执行精确确认的“仅重试失败项”：

1. 新批次只包含一个失败项，保留父批次与父任务 lineage。
2. 原失败任务和诊断证据不被覆盖。
3. 相同 idempotency key 重放复用同一批次、任务与候选，不产生重复付费或重复资产。
4. 服务重启后，原失败父任务、成功重试子任务、候选计数和批次计数与重启前完全一致。
5. `outcome_unknown` 仍只能先对账，不允许直接重复提交。

## Browser 实测

| 场景 | 结果 |
| --- | --- |
| 1440 / 1180 / ≤768 | 单一可折叠侧栏，无双层导航；无横向溢出或阶段栏/任务托盘重叠 |
| Workspace 导航 | 16 个入口可识别；横向阶段栏固定为简报→剧本→资产→分镜→生成→审阅→时间线→导出 |
| URL 兼容 | `workspace` 与旧 `view` 参数兼容；浏览器前进/后退恢复工作区 |
| 引导 | 8 步 CoachMark 绑定真实 DOM；目标缺失时回退 Help；支持暂停、恢复、跳过与重开 |
| Provider / 治理 | 连接、路由、成本、备份、审计和可执行适配器关闭边界可见 |
| 响应式与控制台 | 三种视口无裁切；稳态页面 console 0 error |

## Electron 开发模式

- 已在隔离临时 userData 中启动并目视确认 Obsidian Atelier、单侧栏、无登录的 Local v1 首屏。
- 2026-07-23 重新采集 Electron 候选审阅工作区，截图中 Provider 为 `demo-local`、费用为 `¥0`、`billed=false`，不含凭据、用户路径或真实素材。
- 自动化 `pnpm electron:preflight` 已完整通过桌面安全配置与启动恢复检查。
- 本轮准备重跑原生导出目录选择时 macOS 进入锁屏，Computer Use 无法自动解锁，因此**没有**把本轮原生选择器、预览和人工导出复核写成已完成。
- 补测条件：用户解锁 Mac 后，在隔离 userData 中依次验证目录选择、零 Key 生成、预览、导出、退出和重启恢复；不得触碰真实用户项目。

## Provider 与凭证边界

- Demo、OpenAI-compatible 和声明式 HTTPS manifest 是唯一可达的 Provider 类型。
- 任意 JavaScript、Python 或 Deno 可执行适配器已封存；旧插件/发布者 HTTP 路径稳定返回 410 `EXECUTABLE_PROVIDER_ADAPTERS_DISABLED`。
- 本机凭证进入系统 Keychain/Credential Manager；Docker 只从 `/run/secrets` 读取。前端、日志、SQLite 业务表、项目包和诊断包不返回 secret。
- 用户直接向 Provider 付费；产品只执行显式确认、预算门禁、路由和不可变本地成本账本，不提供余额充值或代扣。
- 真实 Provider 仍需独立测试账户完成 submit/poll/cancel/reconcile 与账单核对，当前不属于零 Key验收。

## 数据与仓库卫生

- 测试数据库、媒体和导出仅位于系统临时目录或被忽略的 Docker 数据卷，不加入 Git。
- 安全扫描发现的仓库内运行目录已原样移到仓库外实施备份，不执行删除或 reset。
- 实施前 HEAD、tracked/index diff、未跟踪文件清单与 Git bundle 均已保存在仓库外。
- 当前 GitHub 交付只包含源码、测试、CI、配置、文档和 16 张原创 Demo 资产；本地旧版 `启动说明 3.md`、数据库、日志、上传、导出和用户文件均被排除。

## 尚需人工完成

1. 在发布候选包上完成原生目录选择与人工导出复核；本轮只重新验证了隔离 Electron 启动与当前审阅界面。
2. 产品、设计、前端、后端、测试与安全负责人完成 Local v1 Review Candidate 签字。
3. 用 3–5 名真实创作者完成 30–45 分钟无主持任务测试并记录完成率、误操作和术语理解。
4. 为 500/1000 节点图谱建立性能预算并在目标设备实测。
5. 使用隔离、低额度测试账户完成真实 Provider 联调；不得在 CI 或 Demo 使用真实 Key。
6. 若进入公开桌面发行，再补 Windows 实机、macOS/Windows 签名、公证、stapling 与真实更新服务。
