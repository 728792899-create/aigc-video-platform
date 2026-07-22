# 安全与隐私

- 本机 API：仅监听 127.0.0.1；Docker 只映射宿主回环地址。启动器生成独立 bootstrap/session token，bootstrap 只换取 HttpOnly SameSite Cookie，写操作继续要求 CSRF 边界。
- Electron：隔离上下文、禁用 Node integration、sandbox、静态 IPC、HTTPS 外链。
- 凭据：本机服务只使用 macOS Keychain/Windows Credential Manager/Linux Secret Service；Docker 只读 `/run/secrets`。Renderer、API、Socket、业务表、日志、项目包和诊断均不读取或返回明文。
- 上传：25 MB 上限、单文件、扩展/声明 MIME/magic bytes/解码一致性；图片在落盘前由 Sharp 解码、旋转并重新编码，剥离 EXIF/ICC/应用标记；动画、多页图片和总像素超限直接拒绝。
- 文本导入：仅 TXT/Markdown，6 MB/200 万字符上限；严格 UTF-8、控制字符和安全文件名检查；隔离预览不执行 Markdown/HTML，确认时再次校验 SHA-256，取消不落库。
- 边界帧：只接受同项目内部 `MediaReference`，在 Provider 调用前复核媒体类型、项目归属和 SHA-256；任务快照不保存临时 URL或本机绝对路径。
- 媒体：受控 locator 和文件名白名单，不接受任意路径。
- 生成策略：schema v12 在 Server 侧统一强制项目并发、候选批次、导出时长和用户自付预算。默认 `demo-only`/预算 0；启用外部 Provider 必须使用专用精确确认、通过连接测试并满足路由与剩余预算，UI 状态不能代替准入。
- 任务：公开 payload 递归遮蔽凭据字段与本机绝对路径；单任务 Diagnostic 只返回结果确定性、取消语义、correlation ID、Provider 引用 hash 和稳定代码。项目诊断包进一步排除项目名、用户原文、Prompt、媒体 locator、Task 输入/结果和 raw Provider payload，只输出哈希化引用、计数与固定完整性代码。未知 Provider 结果必须先对账，不能直接重提。
- 恢复中心：实际实体/任务 ID 只在受 session token 保护的本地 `/recovery` UI 接口返回，且不包含正文、Prompt、Provider payload 或路径；外发诊断包继续只包含 hash。批量操作只执行 reconcile，失效边界帧解除需要二次确认，任何 Provider retry 仍使用原独立门禁。
- 高风险审计：自 schema v11 引入后，schema v12 继续对项目级审阅、提交、发布、回滚、重试、取消、对账、导出批准和 destructive graph command 记录 append-only started/terminal 事件。目标只存 SHA-256 引用；拒绝只存稳定错误码；数据库禁止 UPDATE/DELETE。请求正文、原始 ID、密钥、用户路径和 Provider payload 不进入事件或前端响应。
- 导出：必须先执行不启动 FFmpeg 的短期预检，再使用精确确认消费一次性 token。token 仅存 hash，目标目录不进入预检响应；assembly 漂移会使未消费确认失效，幂等重放不会重复创建导出任务。
- Agent 记忆：自 schema v9 引入的运行 checkpoint 在 schema v12 中继续只持久化 memory ID/hash/revision/采用原因与 Artifact hash，不复制 title、summary、content，同一 run/plan 不可覆盖。
- Provider：Demo 网络关闭；外部连接只允许 OpenAI-compatible 或严格声明式 HTTPS manifest。连接、路由和成本账本只保存 `credentialRef`、稳定状态与脱敏证据。
- SSRF：只允许 HTTPS 和精确 host；每次 redirect 重新校验 DNS，拒绝 loopback、私网、link-local、metadata、carrier-grade NAT、文档/基准网段和 IPv6 特殊段，连接固定已验证 IP。
- Broker 输入：客户端和 manifest 不得提供 Authorization、Cookie、API Key、Host、Content-Length 或 Transfer-Encoding；凭据只由宿主 secret resolver 注入。响应流、MIME、大小和整个请求生命周期都有硬上限。
- Broker 审计：仅保存 request/correlation ID、channel、policy ID、host/path hash、状态、字节数和稳定错误码；不保存 URL、query、header、body 或 secret。
- 可执行适配器：任意 JavaScript、Python 或 Deno Provider 代码均被封存。Server 不初始化旧插件运行时；所有旧插件与发布者 HTTP 路径返回 410 `EXECUTABLE_PROVIDER_ADAPTERS_DISABLED`。历史数据库表只为可逆迁移保留，不构成可达攻击面。
- 数据删除：精确确认、realpath containment、符号链接拒绝、tombstone 幂等。
- 项目包：100 MB 压缩/解压上限、50 MB 单文件上限、Zip Slip/符号链接/加密/重复入口/异常压缩率拒绝、SHA-256 和事务回滚。

安全扫描是门禁，不替代人工数据流审计。静态命中在确认可利用条件前不应描述为已确认漏洞。
