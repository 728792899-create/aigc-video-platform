# 桌面发布 2.0

## 构建边界

发布链固定为：

```text
packages / server / studio / desktop build
→ .package-stage（隔离 Server 生产依赖）
→ Electron ABI 与 Server 启动恢复预检
→ .desktop-stage（最小、无依赖收集的打包工程）
→ electron-builder
```

`.desktop-stage` 只包含 Electron 编译产物、Studio 静态资源、隔离 Server、发布图标、LICENSE、THIRD_PARTY_NOTICES、entitlements 和 notarization hook。它不包含 TypeScript、sourcemap、数据库、日志、上传、媒体、用户路径、FFmpeg 或带编号的本地副本。

本地 `pnpm run pack` 在系统临时目录完成 macOS bundle 组装、扩展属性清理、专用 ad-hoc entitlements 签名和 `codesign --deep --strict` 验证。ad-hoc entitlements 仅为内部 hardened-runtime 包增加 library-validation 例外，正式 Developer ID 包不使用该例外。仓库位于同步目录时，直接把 app 写到工作树可能重新附加 Finder metadata 并破坏签名，因此命令会打印最终临时产物路径，并把同一路径写入被忽略的 `.desktop-stage/local-package-output.json`。只有新包通过严格签名验证后，`pack` 才会清理工作树中可能已损坏的旧 `dist-electron`，避免 Finder 误打开过期包。本地人工验收应使用 `pnpm desktop:open:demo`，它会再次验签并以隔离数据目录打开最新包。

桌面启动不再先“探测再复用”端口。Server 监听端口 `0`，由操作系统原子分配端口后把实际端口返回给 Electron；CORS 随后只放行该精确 Origin。启动失败会把已脱敏、限长诊断写入本地 `logs/desktop-startup.log`，弹窗只显示稳定错误码。

## 当前 macOS 诊断

2026-07-18 的最新崩溃报告定位到一个过期的工作树 `dist-electron` 包：主进程与 `Electron Framework` 的 ad-hoc Team ID/library validation 不兼容，且同步目录为 bundle 重新附加了 `com.apple.FinderInfo`。这两个问题都发生在 Electron JavaScript、preload 和本地 Server 启动前，不是 `SERVER_EXITED`。当前 `pack` 只在系统临时目录组装本地包，使用专用 ad-hoc entitlement，严格验签成功后才清理旧工作树输出。

代码侧已完成：

- 随机端口、精确 CORS、256-bit 会话 token；
- Server/DB/Prompt Pack 的 Electron Node 启动恢复 probe；
- `better-sqlite3` Electron ABI 加载；
- 最小隔离目录包生成；
- unsigned macOS arm64 bundle 的结构、可执行文件和签名预检。

修复后，Computer Use 已在同一隔离项目中完成导入、事件提取、Agent 计划与审批、候选生成和人工选择、原生目录选择、MP4 导出、应用退出与原数据库重启恢复。导出 MP4 已通过 FFprobe，并在 QuickTime Player 中完整播放至 15 秒结束。真实旧数据删除按安全策略取消，未触碰用户数据。

2026-07-19 再次执行 `pnpm run pack` 产生系统临时目录内的 macOS arm64 ad-hoc 包，`codesign --deep --strict`、Electron preflight 与实际可执行文件 launch smoke 均通过。Staging 扫描没有 TypeScript、sourcemap、数据库、日志、tarball 或带编号的本地副本。该包仍只是内部预检包，不具备 Developer ID 或公证资格。

## macOS 正式发布

需要 Developer ID Application、hardened runtime、Apple API key、公证和 stapling：

1. 将证书导入临时 Keychain。
2. 设置 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER` 与 API key。
3. 运行 `pnpm dist` 或 Signed Desktop Release workflow。
4. 执行 `codesign --verify --deep --strict`。
5. 执行 `xcrun stapler validate` 与 `spctl --assess --type execute`。

Secrets 缺失时正式发行门禁必须失败。ad-hoc 或 unsigned 包只能用于内部预检。

## Windows 正式发布

需要受信任的 PFX/硬件证书、密码和 RFC3161 时间戳。CI 在 Windows x64 构建后必须用 `signtool verify /pa /v` 验证安装器。当前未持有正式证书，不能声称 Windows 发行包已签名。

## 自动更新

Release workflow 会生成更新清单、blockmap 和安装包，但真实更新仍需要两个连续、已签名、非 Draft 版本。当前没有创建 Release，也没有完成线上自动更新 E2E。
