# 桌面发布指南

本指南覆盖 Windows/macOS 打包、签名、公证、自动更新、数据迁移、卸载和崩溃日志。unsigned 或 ad-hoc 包只能用于内部预检。

## 发布流水线

~~~mermaid
flowchart LR
  Tag["版本 / Tag"] --> Quality["测试、安全、FFmpeg"]
  Quality --> Prepare["prepare:desktop"]
  Prepare --> Preflight["electron:preflight"]
  Preflight --> Build["Win / macOS 构建"]
  Build --> Sign["平台签名"]
  Sign --> Verify["签名与安装验证"]
  Verify --> Draft["GitHub Draft Release"]
  Draft --> Manual["干净机器人工验收"]
  Manual --> Publish["正式发布"]
~~~

## 本地命令

~~~bash
npm run prepare:desktop
npm run electron:preflight
npm run pack
npm run dist
~~~

- `prepare:desktop` 构建客户端并准备 Electron 匹配的后端；
- `electron:preflight` 检查安全配置、preload、CSP 和打包白名单；
- `pack` 生成当前平台 unpacked 预检包；
- `dist` 生成安装包。

## 包内容边界

安装包应包含：

- Electron 主进程和受限 preload；
- 生产客户端；
- 后端运行文件和生产依赖；
- ffmpeg-static；
- 图标、entitlement 和许可证。

安装包不得包含：

- `.env` 或真实 Key；
- 开发数据库；
- uploads；
- 日志和 crash dump；
- 用户备份；
- PFX、p12、p8 或 provisioning profile；
- 测试生成媒体；
- 无关源码缓存。

## Windows

目标：NSIS x64、按用户安装、不请求管理员权限。`deleteAppDataOnUninstall=false`，卸载不会静默删除项目和素材。

用户数据通常位于：

~~~text
%APPDATA%\AIGC 视频工作台
~~~

### 正式签名

CI secrets：

- `WIN_CSC_LINK`：受信任 PFX 的路径、URL 或 base64；
- `WIN_CSC_KEY_PASSWORD`：证书密码。

`scripts/sign-app.ps1` 的自签名模式只验证链路，不建立公开信任，不能用于公开发行。

签名后检查：

~~~powershell
Get-AuthenticodeSignature ".\AIGC 视频工作台 Setup.exe"
~~~

预期：

- Status 为 Valid；
- 证书主题正确；
- 时间戳存在；
- 安装程序和主可执行文件都签名；
- 干净 Windows 机器能看到正确发布者。

### Windows 人工验收

- 全新安装；
- 覆盖升级；
- Demo 创建、生成、预览和导出；
- 系统目录选择器；
- 关闭后重启恢复；
- 卸载后数据保留；
- 重装后项目可恢复；
- SmartScreen 和签名信息；
- 非管理员账户运行。

## macOS

目标：arm64/x64 的 DMG 和 ZIP，启用 hardened runtime。

### 正式凭据

代码签名：

- `MAC_CSC_LINK`；
- `MAC_CSC_KEY_PASSWORD`。

公证优先使用 App Store Connect API：

- `APPLE_API_KEY_BASE64`；
- `APPLE_API_KEY_ID`；
- `APPLE_API_ISSUER`。

也可使用 Apple ID：

- `APPLE_ID`；
- `APPLE_APP_SPECIFIC_PASSWORD`；
- `APPLE_TEAM_ID`。

CI 把 API Key 写入 runner 临时目录，任务结束后不保留。

### 验证

~~~bash
codesign --verify --deep --strict --verbose=2 "/Applications/AIGC 视频工作台.app"
spctl --assess --type execute --verbose=4 "/Applications/AIGC 视频工作台.app"
xcrun stapler validate "/Applications/AIGC 视频工作台.app"
~~~

ad-hoc 包只应通过 `codesign --verify`；`spctl` 拒绝属于预期，因为它没有受信任 Developer ID。

`npm run pack` 默认将预检包写入系统临时目录，避免 Documents、网盘或 Finder metadata 破坏签名。可用 `ELECTRON_PREFLIGHT_OUTPUT` 覆盖。

### macOS 人工验收

- Intel 与 Apple Silicon 中至少覆盖实际发布架构；
- 从 DMG 拖入 Applications；
- 首次启动 Gatekeeper 通过；
- 目录选择、Demo、预览、导出；
- 退出后恢复；
- 覆盖安装和数据迁移；
- ZIP 与 DMG 中的 app 签名一致；
- 公证 ticket 已 stapled；
- 未信任开发证书的干净机器验证。

## 自动更新

electron-builder 生成 blockmap 和 `latest*.yml`。`electron-updater` 只在 packaged build 中检查，默认不自动下载，避免在长任务中强制更新。

发布顺序：

1. 创建 Draft Release；
2. 上传安装包、DMG/ZIP、blockmap 和 YAML；
3. 校验文件名、版本和校验和；
4. 在上一正式版本测试更新检查；
5. 确认签名、公证和安装；
6. 再把 Draft 转为正式 release。

不要先发布 YAML 再补安装包，否则客户端可能看到不可用更新。

## 数据迁移、备份与恢复

- SQLite 使用 `PRAGMA user_version`；
- schema 升级前自动创建数据库副本；
- 自动迁移备份保留五份；
- 产品更名时复制旧数据目录并保留原目录；
- 设置页备份不含系统凭证；
- 恢复前创建 restore point 并执行完整性检查；
- 数据库和媒体必须来自同一备份批次。

详细操作见[备份与恢复手册](backup-restore.md)。

## 卸载残留

为避免静默销毁创作数据，卸载默认保留用户数据。发布说明必须明确：

- 应用程序文件由卸载器删除；
- 项目、媒体、备份和日志默认保留；
- 用户可在确认备份后手动删除用户数据目录；
- 重装相同产品名会重新发现原数据；
- 产品更名迁移不会自动删除旧目录。

## 崩溃日志与隐私

- 后端日志：用户数据目录 `logs/backend.log`；
- Electron crash dump：系统 crash dump 目录；
- Sentry：默认关闭，显式 DSN 后启用；
- 日志不得包含 Key、完整提示词、数据库或媒体；
- 提交问题前只提供请求 ID、任务 id 和脱敏摘要。

详见[可观测性与异常监控](observability.md)。

## GitHub Actions

`.github/workflows/ci.yml` 在 Ubuntu 运行质量和安全门禁，在 Windows/macOS 运行桌面包预检。`release.yml`：

- 手动触发默认构建 unsigned/ad-hoc 内部预检包；
- 关闭 `unsigned_preflight` 时要求正式凭据；
- tag 构建强制检查签名/公证 secrets；
- 成功后创建 GitHub Draft Release；
- 不自动把未经人工验收的 Draft 发布。

## 发布记录

每个 release 应保存：

- commit 和 tag；
- Node/Electron 版本；
- CI run URL；
- 安装包名称与 SHA-256；
- 签名证书主体和有效期；
- macOS 公证 id；
- schema 版本；
- 恢复演练结果；
- 干净机器验收人和日期；
- 已知限制。
