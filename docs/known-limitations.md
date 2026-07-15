# 已知限制

## 产品边界

- 当前是本地优先的单用户桌面产品，不提供账号体系、多租户隔离、团队协作、云端同步和计费系统。
- 没有替用户完成素材版权审核、声音权利确认或模型输出内容合规审核。
- Demo Mode 验证工作流与媒体边界，不代表真实模型的画面或声音质量。
- 真实 Provider 的模型、价格、配额和服务可用性可能变化，需要用户自行确认。

## 工作流边界

- 自动恢复只用于明确标记为 `safe-auto` 的 Demo/local 任务，并有默认三次上限；云端或未知任务重启后进入 `orphaned`，需核对远端任务和已有素材后手动继续。
- 取消在安全检查点生效，不保证立刻终止正在完成的单个网络请求或媒体文件写入。
- 部分成功会保留成功资产；用户仍需对失败镜头执行重试或替换。
- 数据库和媒体目录是共同备份边界，只恢复数据库可能产生缺失资产。
- Character/Scene/Prop/Style/Voice/Music 的 Variant/Revision/Binding、Episode > Series > Global 解析、Series→Episode fork、批量改绑和字段级 stale 传播已落地。仍需在大量真实系列项目中验证跨集批量操作的可理解性和性能。
- Prompt revision、行级 diff、恢复为新版本和逐场景 Demo 重生成已落地；真实 Provider 的局部重生成仍受各 Provider 能力、费用确认和远端幂等语义约束。

## 媒体边界

- 静态图片视频主要依赖预设运镜和 FFmpeg，不是完整非线性视频编辑器。
- 超长视频、复杂转场、多机位、专业调色和高阶音频混音不在当前 MVP 范围。
- Element Plus 已改为组件直达入口和 shell/workbench 分包：最大相关 JS chunk 从约 1,026 KB 降至约 250 KB，CSS 从约 356 KB 降至约 199 KB；`Preview.vue` 等旧页面自身仍偏大，后续应继续按时间线、导出和播放器领域拆分。
- FFmpeg 能力受当前静态二进制编译选项和平台支持影响。

## 桌面发布边界

- macOS arm64 已实际完成 ad-hoc 打包、严格验签和启动验收；受信任签名与公证需要发布者凭据。
- Windows x64 和 macOS Intel 已配置干净 runner 的安装、启动、Demo MP4、退出与卸载验收，但本轮未推送，因此不能声称远端 Actions 已执行；覆盖升级、重装发现旧数据仍需发布候选复验。
- typed 自动更新状态、用户确认、元数据/blockmap 校验已完成；真实 E2E 仍需要两个连续的正式签名版本和非 Draft GitHub Release。Draft 对 `electron-updater` 不可见。
- Sentry 为 opt-in 方案，未配置真实 DSN 时只使用本地日志和 crash dump。
- 2026-07-15 的本地验收中，Computer Use 已覆盖最新 Electron 40 ad-hoc 包启动、项目恢复、完成态九阶段画布、真实预览、macOS 原生目录选择，以及在同一隔离 userData 中点击“开始导出”。外部目录得到 378,108 bytes、带 `ftyp` 签名的 MP4；失败后单阶段重试和重启恢复由同次隔离 Demo acceptance 验证。导出框已限制为视口高度并保持 footer 可见。Browser Control 已覆盖 Demo 剧本/分镜、Prompt revision/diff、逐场景任务、Voice 空状态和 640px 窄屏，最终控制台没有 Vue warning/error。Windows/macOS x64 干净机安装与受信任签名发布仍未验证。

## Provider 测试边界

- 自动化测试禁止使用真实 Key，因此只验证 Provider 契约和受控错误，不验证付费服务的实时质量。
- 智谱与可灵的 reconcile/cancel/billing 能力按已核验官方边界声明，并提供只查询已有 task ID 的零计费 CLI；没有测试凭据和已有任务 ID，因此线上状态与账户侧账单仍未验证。
- 外部 Provider 的协议或模型名变化可能需要更新注册表与适配器。
- 项目不内置共享 Key，也不对第三方中转站的安全性负责。

这些限制是明确的产品取舍，不应通过隐藏错误或自动跳过检查来规避。准备公开发布时请逐项复核 [Release Checklist](release-checklist.md)。
