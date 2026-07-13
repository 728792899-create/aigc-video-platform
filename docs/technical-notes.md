# 技术说明（简版）

AIGC 视频工作台是一个 Vue + Express + Electron + SQLite/sql.js + FFmpeg 的本地优先应用。核心设计是把模型调用和媒体处理纳入持久化状态机，而不是把所有逻辑堆在页面按钮回调里。

## 关键决策

- 八阶段协议保持稳定，内部实现可以继续拆分；
- REST API 保持兼容，复杂逻辑下沉到领域服务；
- 项目结构进数据库，大媒体进文件系统；
- 每个长任务同步持久化，并带 recovery metadata；
- Provider 通过契约层归一化错误与降级；
- Demo 在网络适配器前短路，但真实运行字幕、时间线和 FFmpeg；
- renderer 无 Node 权限，系统能力集中在 Electron Main；
- 凭证与普通配置/备份分离；
- 打包前自动检查安全配置与禁止文件。

## 深入阅读

- [架构说明](architecture.md)
- [工作流与崩溃恢复](workflow-recovery.md)
- [Provider 与 Demo 指南](provider-guide.md)
- [安全与数据边界](security-and-data.md)
- [测试与 CI 指南](testing-ci.md)

## 当前技术债

- 继续拆分较大的页面脚本和 `server/routes/video.js`；
- 对 Element Plus 做更细的按需加载与 chunk 优化；
- 在真实 Windows 和 Intel Mac 上补全平台实机验证；
- 用真实签名凭据验证自动更新和公证链路；
- 为更多 Provider 建立可选、用户显式触发的 live integration test。
