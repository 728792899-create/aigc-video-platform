# 桌面发布指南

## Windows

目标为 NSIS x64、按用户安装、不请求管理员权限。`deleteAppDataOnUninstall=false`，卸载不会静默删除项目和素材；用户可在卸载后手动删除 `%APPDATA%/AIGC 视频工作台`。

正式签名需要受信任 CA 的代码签名证书。在 CI 配置 `WIN_CSC_LINK`（PFX 路径、URL 或 base64）和 `WIN_CSC_KEY_PASSWORD`。`scripts/sign-app.ps1` 的自签名模式仅用于开发验证，密码必须来自 `WINDOWS_PFX_PASSWORD`，不能用于公开发行。

人工验证：安装/覆盖安装、`Get-AuthenticodeSignature` 与 SmartScreen 签名信息、启动、目录选择、Demo 生成、预览、导出、卸载后数据保留、重新安装恢复。

## macOS

目标为 arm64/x64 的 DMG 和 ZIP。正式发布需要 Developer ID Application 证书、hardened runtime、Apple 公证和 stapling。在 CI 配置 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`，以及：

- App Store Connect API：`APPLE_API_KEY_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`；或
- Apple ID：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

人工验证：`codesign --verify --deep --strict --verbose=2 <app>`、`spctl --assess --type execute --verbose=4 <app>`、`xcrun stapler validate <app>`，再在一台未信任开发证书的 Mac 上安装测试。`npm run pack` 会把 ad-hoc 预检包写入日志显示的系统临时目录，避免同步盘或 Documents 目录附加 Finder 元数据破坏签名；可用 `ELECTRON_PREFLIGHT_OUTPUT` 覆盖该位置。手动触发 Release workflow 时默认只做 ad-hoc 签名预检（可校验完整性，但不受 Gatekeeper 信任、不得公开发布）；只有关闭 `unsigned_preflight` 且凭据齐全才允许走正式签名。Tag 构建强制校验签名与公证凭据。

## 自动更新

electron-builder 生成 GitHub 更新元数据，`electron-updater` 只在 packaged build 中检查。当前默认不自动下载，避免长任务期间强制更新；发布者确认 draft release、安装包、blockmap 和 YAML 全部上传后再转为正式 release。

## 数据迁移、备份与恢复

- SQLite 使用 `PRAGMA user_version`。迁移旧 schema 前，在用户数据目录 `data/backups` 创建原数据库副本并轮换保留五份。
- 产品更名后首次启动会复制旧版数据目录，保留原目录作为回退，不主动删除。
- 设置页备份包含数据库和非敏感配置，不包含 Keychain/DPAPI 密钥。媒体目录应在应用关闭后与备份文件一起复制。
- 恢复前自动创建 `restore-point-*.sqlite`，并执行 SQLite `integrity_check` 和必要表校验。
- 崩溃后任务恢复依赖数据库与媒体目录必须来自同一备份时间点；缺少媒体会在资产健康检查中报告并提供单阶段修复入口。

## 崩溃日志与隐私

后端日志位于用户数据目录 `logs/backend.log`，Electron crash dump 位于系统 crash dump 目录。提交日志前必须清理项目名称、路径和 Provider 响应。Sentry 默认关闭，配置见 [observability.md](observability.md)。
