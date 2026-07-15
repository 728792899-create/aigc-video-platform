# Release Checklist

复制本页到 release issue，记录执行人、日期、CI URL 和证据。任何自动门禁失败都不应通过人工勾选绕过。

## 版本与范围

- [ ] 版本号、tag、CHANGELOG 和安装包名称一致
- [ ] 候选 commit 已冻结
- [ ] 已知限制已更新
- [ ] 数据库 schema 版本和迁移说明已确认
- [ ] 截图、Demo 脚本和英文入口与当前界面一致

## 自动门禁

- [ ] `npm ci`、`npm --prefix server ci`、`npm --prefix client ci`
- [ ] `npm run security:audit:all`
- [ ] `node scripts/security-check.mjs`
- [ ] `node scripts/ffmpeg-smoke.mjs`
- [ ] `npm run quality`
- [ ] `npm run prepare:desktop`
- [ ] `npm run electron:preflight`
- [ ] Windows unsigned package preflight
- [ ] macOS ad-hoc package preflight
- [ ] macOS ad-hoc 包通过严格 `codesign --verify`
- [ ] ad-hoc 包被 `spctl` 拒绝已记录为预期

## 无 Key Demo

- [ ] 所有常见 Provider Key 环境变量为空
- [ ] 主题到导出八阶段完成
- [ ] 输出文件包含有效 MP4 `ftyp`
- [ ] Demo 画面和音轨有明确 placeholder 标识
- [ ] 未观察到付费 Provider 网络请求
- [ ] Demo 临时数据库和媒体已清理

## 恢复与失败

- [ ] export 注入失败后只重试 export
- [ ] 上游分镜、图片、音频检查点未被重跑
- [ ] Demo/local `safe-auto` 任务在生成中停止服务，重启后自动续跑
- [ ] 云/未知任务重启后进入 `orphaned`，未自动重复提交
- [ ] recovery attempts 正确增加
- [ ] 超过恢复上限时进入可诊断终态
- [ ] 批量媒体任务保留成功项并报告 partial
- [ ] 取消在安全边界生效
- [ ] 缺失 runner、磁盘错误和不可写目录有明确诊断

## Browser 验收

> 最近一次本地证据（2026-07-14）：隔离 Demo 数据下已覆盖空状态、结构化脚本、两候选选择保护、`F` 收藏、Variant 绑定、服务重启恢复、归档/恢复和 700px 窄屏入口，控制台 0 error。下面仍作为每个发布候选都要重新执行的清单。

- [ ] 工作台、项目、脚本、图片、音频、预览可打开
- [ ] 历史、文件、成片库、技能、回收站和设置可打开
- [ ] 空状态、运行中任务、失败任务和修复入口可见
- [ ] 导出设置和路径脱敏正确
- [ ] 键盘导航和危险操作确认可用
- [ ] 控制台无未处理 error
- [ ] 截图不含真实用户信息或凭证

## Electron 验收

> 最近一次本地证据（2026-07-14）：隔离 userData 下已覆盖应用启动、Demo 全流程、重启恢复、Preview、系统目录选择和成功导出有效 MP4；正式签名、公证与跨平台安装仍需发布机复验。

- [ ] 安全配置：contextIsolation、sandbox 开启，nodeIntegration 关闭
- [ ] preload 只暴露白名单接口
- [ ] 应用启动和退出正常
- [ ] 系统目录选择器可打开、取消和选择
- [ ] Demo 生成、预览和导出成功
- [ ] 关闭后重启恢复
- [ ] 外部 HTTPS 链接进入系统浏览器
- [ ] 非 HTTPS 和越界导航被阻止
- [ ] 用户路径在 renderer 中脱敏
- [ ] 后端异常退出按上限恢复

## 备份、迁移和卸载

- [ ] 创建 `.aigcbak` 且 `secretsIncluded=false`
- [ ] 备份中没有 Keychain/DPAPI 凭证
- [ ] 恢复前创建 restore point
- [ ] 运行 SQLite integrity check
- [ ] 数据库和媒体使用同一时间点备份
- [ ] 旧 schema 升级前自动备份
- [ ] 换机或恢复演练后成功导出 MP4
- [ ] 卸载保留用户数据
- [ ] 重装可以发现原项目

## 安全与隐私

- [ ] 无密钥、数据库、上传目录、日志或用户文件进入 Git
- [ ] 上传 MIME、魔数和路径校验通过
- [ ] CORS、API_TOKEN 和请求 ID 测试通过
- [ ] 设置与 Provider 响应只返回掩码
- [ ] 日志和错误信息完成凭证脱敏
- [ ] Sentry 默认关闭
- [ ] 若启用 Sentry，测试事件不含 PII、Key、路径或提示词
- [ ] crash dump 和日志提交流程已说明

## 素材与法务

- [ ] LICENSE 与 SECURITY.md 已检查
- [ ] Inter OFL 随包分发
- [ ] 图片来源记录完整
- [ ] 实机截图与概念视觉标注清楚
- [ ] 无第三方角色、商标或未授权素材
- [ ] 无示例音乐随包分发
- [ ] Provider 输出授权和服务条款风险已说明
- [ ] FFmpeg 编解码器许可由发布者复核

## Windows 正式发布

- [ ] 使用受信任证书签名
- [ ] 安装器和主程序都包含时间戳
- [ ] `Get-AuthenticodeSignature` 为 Valid
- [ ] 干净机器显示正确发布者
- [ ] SmartScreen 行为已记录
- [ ] 非管理员用户完成安装、运行和卸载

## macOS 正式发布

- [ ] Developer ID Application 签名
- [ ] hardened runtime 与 entitlement 正确
- [ ] `codesign --verify --deep --strict` 通过
- [ ] `spctl --assess --type execute` 通过
- [ ] Apple 公证成功
- [ ] stapling 验证通过
- [ ] DMG 和 ZIP 内 app 签名一致
- [ ] 未信任开发环境的干净 Mac 可启动

## GitHub Release

- [ ] Draft 包含 Windows 安装包
- [ ] Draft 包含 macOS DMG/ZIP
- [ ] blockmap 与 `latest*.yml` 齐全
- [ ] SHA-256 已记录
- [ ] 更新检查从上一版本验证
- [ ] 安装包先于更新元数据可用
- [ ] Release notes 包含迁移、备份、限制和人工签名状态
- [ ] 所有干净机器验收完成后才发布 Draft

## 发布后

- [ ] 监控 crash-free sessions 和后端重启
- [ ] 验证更新源返回正确版本
- [ ] 保留上一稳定安装包和数据库恢复说明
- [ ] 发现高风险问题时停止分发并回退更新元数据
- [ ] 安全问题转入私密 Security Advisory
