# 测试与 CI

## 测试层级

- contracts：外部 API、任务和图命令 Schema。
- domain：事件提取、循环校验、投影和状态转换。
- agents：Prompt provenance、审批 token 与计划。
- providers：Fake Provider、网络 URL 和无权限插件协议。
- media：系统 FFmpeg 生成并用 FFprobe 验证 MP4。
- server：鉴权、精确 CORS、HTTP 契约、MIME 欺骗、并发冲突、16 环节闭环、对账和恢复。
- studio：唯一路由、节点可访问性、媒体失败、Prompt Pack 证据和 Critic/人工批准。
- desktop：旧数据删除边界、Server ready 解析、诊断脱敏和启动恢复 probe。
- smoke：完整 Demo、有效 MP4、付费请求 0 和服务重启恢复。

## 2026-07-19 本地自动化结果

| 门禁 | 结果 |
| --- | --- |
| `DEMO_MODE=1 PROVIDER_NETWORK_DISABLED=1 pnpm quality` | 通过 |
| Workspace tests | 148/148 通过 |
| 完整 Smoke | 1/1 通过 |
| clean-room | 65 个 runtime/public 文件通过 |
| security scan | 168 个源文件、29 个构建文件通过 |
| Server/DB/Prompt Pack Electron startup probe | 通过 |
| `better-sqlite3` Electron ABI | 通过 |
| macOS arm64 ad-hoc 目录包生成与严格验签 | 通过 |
| 本会话 Computer Use | 同一隔离项目中完成导入、事件图谱、审批、候选选择、原生目录选择、MP4 导出与重启恢复；真实旧数据清理已取消 |
| 本会话 LaunchServices GUI smoke | 通过；隔离数据、Studio 首屏和安全退出 |
| Browser Control | 三图切换、列表替代、`⌘K` / `Esc`、390×844 窄屏通过；真实 `.aigcproj` 往返；Series/Episode 创建、Series 共享资产、镜头绑定审批、revision drift 和字段级 stale；真实 Markdown 选择→2 章隔离预览→取消不落库→重新选择→确认生成事件；Shot Beat、首尾帧与 Provider 有序快照；console 0 error |
| Production license inventory | `pnpm licenses list --prod` 通过；LICENSE 与 THIRD_PARTY_NOTICES 已纳入桌面包 |
| Registry vulnerability audit | `pnpm audit --prod --audit-level high` 通过；0 个已知漏洞。审计发现的旧 `ini <1.3.6` 传递依赖已通过 workspace override 固定为 `ini@1.3.8`，同时将已从 registry 撤回的 `ignore@7.0.6` 固定为兼容的 `7.0.5`，确保干净安装可复现 |

手工桌面验收产生的 MP4 为 1280×720、24 fps、MPEG-4 video + AAC、15.000 秒、480,483 bytes，已用 FFprobe 校验，并在 QuickTime Player 中完整播放到 15 秒结束。应用退出后在同一隔离数据目录重启，项目、事件图谱、Agent 计划、候选选择与导出记录均保留。

项目包 Browser 验收使用临时 Demo 数据且显式禁用 Provider 网络：在真实 Vue UI 创建项目，点击“备份当前项目”生成 `.aigcproj`，再由浏览器文件选择器导入。导入项目使用新 project ID，原项目不被覆盖；API 与单元测试另外覆盖带 Source、Event、媒体、Artifact hash 的完整往返、Zip Slip、校验和不匹配和失败不落库。

Phase 1 单元/API 验收另外覆盖 schema v2→v3、standalone Episode 回填、Series 顺序、Episode→Series→Global resolver、fork/promote 媒体复制、引用删除保护、一次性 reconcile/batch-bind 审批、revision drift、Project/Series `.aigcproj` v2、共享媒体 hash 与 Global→Series pinned 导入。Browser 在隔离数据库中真实完成 Series 创建、Series 资产创建、Agent 计划批准、镜头绑定确认和远端 revision 模拟更新；390×844 下页面宽度与视口同为 390，console 0 error。

Phase 2 单元/API 验收覆盖 schema v3→v4、Prompt 双语 diff/变量缺失/发布门禁/追加恢复、ArtifactHead CAS 冲突和追加回滚、Skill 内置 fork/资源白名单/黄金样例/发布/回滚，以及同一时间戳下按最高 semver 确定性递增。Studio Inspector 可读取 Artifact 版本历史和字段 diff；错误 scope 返回 404，回滚要求二次确认并且只追加新 revision。Browser 早期实测 Prompt/Skill 工作台付费请求 0，console 0 error，390×844 无横向溢出。

局部重生成验收覆盖严格 `ScopedPromptBinding`、仅已发布 Prompt 可执行、跨项目与错误目标拒绝、Prompt/目标 revision 固定、相同输入幂等返回、相同键更换目标冲突、Event/Scene 只追加 Artifact、Shot 只追加 Candidate，以及其他场景和 `selectedCandidateId` 保持不变。Studio 组件测试验证目标选择、生产门禁和追加结果反馈。

Phase 3 单元/API/Smoke 验收覆盖 schema v4→v5、CandidateBatch 幂等 lineage、Candidate 标注与选择隔离、确定性 Model Catalog hash、未知能力 fail fast、MediaResolver 项目/MIME/大小/顺序校验和脱敏 receipt。媒体测试用系统 FFmpeg 生成视频并提取最后可解码帧，校验 PNG magic、尺寸、SHA-256、失败清理和原 BoundaryFrame 不覆盖；Smoke 在重启前后验证批次、尾帧任务、有效 MP4 和付费请求 0。Studio 组件测试覆盖批次筛选、收藏、比较、批准以及方向键、Enter 和空格操作。

Phase 4 单元/API/Smoke 验收覆盖 schema v5→v6、Episode→Series→Global 作用域顺序、来源 revision stale、重建复用、敏感文本排除、禁用与删除、服务重启和不联网关键词降级。Studio 组件测试确认检索会展示命中关键词与采用原因，删除要求二次点击，且仅删可重建索引。

Phase 5 安全验收覆盖 Broker 默认关闭、HTTPS/精确 host、IPv4/IPv6 私网与 metadata 拒绝、redirect DNS 重绑防护、流式容量和全生命周期超时、外部 AbortSignal 到 transport 的取消传递、宿主凭据注入与审计脱敏。Provider 插件另外覆盖 bundle hash、Ed25519 受信发布者、Deno 无 I/O 启动参数、64 KiB JSON-RPC、请求超时、异常退出、输出上限、工具调用上限与 `quarantined` 状态。反向 RPC 只允许 `broker.execute`，未授权方法、重复 ID 和次数超限会隔离；Broker 拒绝或超时只返回稳定脱敏错误。运行时安装测试覆盖官方资产目录、大小/hash、单文件 ZIP、版本探测、已有安装复核、冲突和取消清理；测试使用生成的 ZIP、内存下载和注入探测器，未下载 Deno、未执行任何第三方 bundle。

进度验收覆盖 downloading/verifying/extracting/probing/publishing 有限阶段、单调已接收字节、总字节上限和 Server `installing` 状态；前端只轮询脱敏状态，不获取下载 URL、staging 路径或可执行路径。

安装取消 API 另外通过真实并发 HTTP 请求验证：安装请求停在注入式安装器，第二个精确确认请求触发 AbortSignal；原请求返回 `DENO_RUNTIME_ABORTED`，取消请求返回未安装状态，重复取消返回 `DENO_RUNTIME_INSTALL_NOT_RUNNING`。Studio 组件同时覆盖取消后恢复安装按钮且不将用户取消显示为错误。

schema v7 持久插件验收另外覆盖幂等签名安装、512 KiB 上限、相对 bundle locator、文件篡改隔离、revision 冲突、默认禁止 enable 和精确确认 API。这些用例使用注入式假生命周期 runner，未启动 Deno 或第三方代码。

schema v8 发布者信任验收覆盖 Ed25519 类型校验、SPKI 规范化、只返回 SHA-256 指纹、相同 key ID 换钥拒绝、revision 冲突、已启用插件的撤销保护、撤销后安装/enable fail closed、恢复同一指纹和 UI 二次确认。

schema v9 Agent checkpoint 验收覆盖 v8→v9 事务迁移与 restore point、同一 run/plan 不可覆盖、幂等计划重签、graph/context hash 审批校验、Episode→Series→Global 引用来源，以及 API/UI 只展示 memory ID/hash/revision/采用原因、不复制记忆正文。

Phase 5 Browser 验收在隔离 Server 和真实 Vue 工作台打开系统面板，确认出口状态为“网络门禁关闭 · 3 通道 · 0 个授权主机”，运行时为“Deno 2.9.2 · 未安装 · 36.2 MB”，并显示固定大小/SHA-256/版本校验说明。安装按钮在默认门禁下禁用，未发生下载。390×844 下 document/body 宽度均为 390px、对话框 354px，console 0 error。

2026-07-19 实际执行 `git diff --check && DEMO_MODE=1 PROVIDER_NETWORK_DISABLED=1 pnpm quality`，148/148 workspace tests、Smoke、FFmpeg、clean-room、security scan 与生产构建全部通过，付费请求 0。Studio 主入口 gzip 73.64 KB，低于 110 KB 门禁。

Phase 4 Browser 验收在真实 Vue 工作台中重建了 5 条记忆，以“红色围巾”检索得到 2 条 Episode 结果，可见 source revision、完整短语/关键词命中和作用域优先原因。禁用召回后可原状启用；首次删除只进入“再次确认删除”，没有实际删除记录。390×844 下 document/body 宽度均为 390px，对话框 354px，console 0 error。

多格式导入 Browser 验收使用 201-byte UTF-8 Markdown：第一次预览识别“第一章 雨夜”“第二章 留影”，取消后 Source 节点仍为 0；第二次确认后 Story Graph 展示 1 个 Source、2 个 Chapter 和 4 个 Event。文件控件可见且可键盘聚焦，390×844 下 document/body width 都为 390。

镜头连续性 Browser 验收在隔离数据目录与 `PROVIDER_NETWORK_DISABLED=1` 下完成。镜头 2 的两个 Beat 从 `1500 + 1500` 修改为非法的 `1500 + 1300` 时，界面显示 2800/3000 校验并禁用保存；修改为 `1300 + 1700` 后保存成功。首帧解除后可重新沿用上一镜头尾帧，来源 revision 与媒体 hash 保持可诊断。候选证据面板展示 Fake Provider 实际接收的 `first-frame` 有序媒体快照。验收过程中发现并修复自动生成边界帧误传播 stale 以及 390×844 下 Inspector 约 446px 溢出；修复后的全新项目完成 5 镜头、10 候选生产后，所有镜头均保持 `ready`，Inspector 宽度为 390px，页面无横向溢出。

## CI

CI 使用 Node 24、pnpm lockfile、系统 FFmpeg 和最小 `.desktop-stage`：

- Ubuntu：audit、quality、package stage、Electron preflight。
- macOS Intel/Apple Silicon：未签名目录包和启动 smoke。
- Windows x64：未签名目录包和启动 smoke。
- Signed Release：只有 Secrets 齐全时才进行 Developer ID、公证或 Authenticode。

尚未在远端运行当前 dirty worktree 的新矩阵；不应把本地配置存在描述成 GitHub Runner 已通过。
