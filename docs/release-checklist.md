# Release Checklist

## 自动门禁

- [ ] `npm ci`、`npm --prefix server ci`、`npm --prefix client ci`
- [ ] `npm run security:audit:all`
- [ ] `node scripts/security-check.mjs`
- [ ] `node scripts/ffmpeg-smoke.mjs`
- [ ] `npm run quality`
- [ ] `npm run prepare:desktop && npm run electron:preflight`
- [ ] Windows unsigned / macOS ad-hoc package preflight 通过
- [ ] macOS 预检包通过 `codesign --verify --deep --strict`；ad-hoc 包的 `spctl` 拒绝已记录为预期结果

## 功能验收

- [ ] 无 Key 的 Demo Mode 成功导出有效 MP4
- [ ] 单阶段失败后只重试该阶段
- [ ] 生成中关闭进程，重启后任务自动续跑
- [ ] Browser：步骤导航、项目创建、工作台、任务状态、预览与空/错状态
- [ ] Electron：启动、系统目录选择、生成、预览、导出和退出恢复
- [ ] 弱网/超时/429/异常格式/Provider 降级契约通过

## 发布与法务

- [ ] 更新版本、CHANGELOG、截图和 Demo 脚本
- [ ] 检查 LICENSE、SECURITY.md、Inter OFL 和第三方依赖通知
- [ ] 确认无第三方角色、未授权图片/音乐/字体或用户素材
- [ ] Windows 受信任证书签名与时间戳验证
- [ ] macOS Developer ID 签名、公证、staple、Gatekeeper 验证
- [ ] GitHub draft release 含安装包、ZIP/DMG、blockmap、更新 YAML
- [ ] 干净机器安装/升级/卸载/重装与数据恢复测试
- [ ] 备份数据库和媒体目录，并验证一次恢复
