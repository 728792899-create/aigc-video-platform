# 安全与隐私

- 本地 API：仅监听 127.0.0.1，每次桌面启动生成 256-bit session token。
- Electron：隔离上下文、禁用 Node integration、sandbox、静态 IPC、HTTPS 外链。
- 凭据：只在 main process 使用 safeStorage 加密，Renderer 不读取明文。
- 上传：25 MB 上限、单文件、扩展/声明 MIME/magic bytes/解码一致性。
- 文本导入：仅 TXT/Markdown，6 MB/200 万字符上限；严格 UTF-8、控制字符和安全文件名检查；隔离预览不执行 Markdown/HTML，确认时再次校验 SHA-256，取消不落库。
- 边界帧：只接受同项目内部 `MediaReference`，在 Provider 调用前复核媒体类型、项目归属和 SHA-256；任务快照不保存临时 URL或本机绝对路径。
- 媒体：受控 locator 和文件名白名单，不接受任意路径。
- 任务：公开 payload 脱敏导出路径；错误只返回 correlation ID 和稳定代码。
- Agent 记忆：schema v9 的运行 checkpoint 只持久化 memory ID/hash/revision/采用原因与 Artifact hash，不复制 title、summary、content，同一 run/plan 不可覆盖。
- Provider：Demo 网络关闭；Egress Broker 已分成 media-fetch/model-api/temporary-upload 三通道，全部默认关闭且 allowlist 为空。
- SSRF：只允许 HTTPS 和精确 host；每次 redirect 重新校验 DNS，拒绝 loopback、私网、link-local、metadata、carrier-grade NAT、文档/基准网段和 IPv6 特殊段，连接固定已验证 IP。
- Broker 输入：插件/客户端不得提供 Authorization、Cookie、API Key、Host、Content-Length 或 Transfer-Encoding；凭据只由宿主 secret resolver 注入。响应流、MIME、大小和整个请求生命周期都有硬上限。
- Broker 审计：仅保存 request/correlation ID、channel、policy ID、host/path hash、状态、字节数和稳定错误码；不保存 URL、query、header、body 或 secret。
- Provider 插件：manifest 锁定 Deno 2.9.2、bundle SHA-256 与受信 Ed25519 签名；Deno 命令禁止 read/write/net/env/run/sys/ffi/import 并关闭 permission prompt。宿主进程监督器仅接受限长 JSON-RPC，不继承宿主环境；插件只能发起 `broker.execute`，不能直接联网或获取 secret。超时、异常退出、输出超限、重复 ID 或协议违规会终止进程并标记 `quarantined`。
- Deno 运行时：可选安装核心只接受固定官方 2.9.2 GitHub HTTPS 资产，校验压缩大小、SHA-256、单文件 ZIP 结构、二进制 hash 和精确版本，使用 staging + 原子发布，失败/取消不留下可执行目录。状态响应只提供有限阶段与字节进度，不暴露 URL、临时目录或本机可执行路径；安装与取消都必须精确确认，默认网络门禁关闭时 API 在下载前拒绝。当前包不携带 Deno，测试不下载或执行真实二进制。
- 插件持久化：schema v7 保存受验 manifest、相对 bundle locator、revision、脱敏测试 hash 和 installed/tested/enabled/quarantined 状态；schema v8 增加可撤销发布者信任。bundle 限制 512 KiB，原子写入受控目录并在每次测试和 enable 前重验 hash、manifest 签名与当前发布者信任。信任只接受 Ed25519 SPKI PEM，对外只返回 SHA-256 指纹；静默换钥被拒绝，有已启用插件时不允许撤销。发布者信任列表与全局 enable 门禁默认为空/关闭；信任、撤销、插件测试和启用均需独立精确确认与 revision 门禁。
- 数据删除：精确确认、realpath containment、符号链接拒绝、tombstone 幂等。
- 项目包：100 MB 压缩/解压上限、50 MB 单文件上限、Zip Slip/符号链接/加密/重复入口/异常压缩率拒绝、SHA-256 和事务回滚。

安全扫描是门禁，不替代人工数据流审计。静态命中在确认可利用条件前不应描述为已确认漏洞。
