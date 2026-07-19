# Release Checklist 2.0

- [x] `pnpm quality`
- [x] `pnpm prepare:package && pnpm electron:preflight`
- [x] `pnpm run pack`
- [x] Browser 验证三张图、列表替代、键盘、窄屏，以及默认关闭的 Egress/Deno 运行时状态；审批、错误与恢复由组件、Server 和 Smoke 测试覆盖
- [x] Computer Use 验证 Electron、原生目录选择、导出、QuickTime 完整播放和重启恢复
- [x] Git tree 无数据库、日志、媒体、凭据、源码映射和用户路径
- [x] `pnpm licenses list --prod` 已核对，LICENSE 与 THIRD_PARTY_NOTICES 已纳入桌面包
- [x] `pnpm audit --prod --audit-level=high` 通过，Registry 返回 0 个已知漏洞
- [ ] Windows x64、macOS Intel/Apple Silicon 干净 Runner 通过
- [ ] macOS codesign/notarization/stapling/Gatekeeper 通过
- [ ] Windows Authenticode 与时间戳验证通过
- [ ] 两个连续签名版本完成真实自动更新
- [ ] 真实 Provider 查询/取消/账单测试有单独授权且未提交生成
