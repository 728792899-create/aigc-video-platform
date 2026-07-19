# 2.0 故障排查

## 启动显示 `SERVER_EXITED`

1. 运行 `pnpm build && pnpm prepare:package && pnpm electron:preflight`。
2. 检查应用数据目录中的 `logs/desktop-startup.log`。日志会脱敏 token、API Key 和用户路径。
3. 确认系统磁盘可写、没有把应用放在损坏的同步占位目录中。
4. 不要把真实 Key 粘贴进 issue；只提供稳定错误码和已脱敏日志。

2.0 使用操作系统分配的随机本地端口，不需要手工设置端口，也不会复用探测后关闭的端口。

## macOS 提示“意外退出”

不要从仓库的 `dist-electron` 打开历史本地包。同步目录可能为 app bundle 重新附加 `com.apple.FinderInfo` 或 resource fork，从而破坏嵌套签名；旧 ad-hoc 包也可能因缺少 `disable-library-validation` 而被 dyld 以“different Team IDs”拒绝。

重新运行 `pnpm run pack`，然后使用 `pnpm desktop:open:demo` 打开系统临时目录中已经严格验签的包。如果 crash report 的故障栈停在 AppKit 或 dyld，说明应用尚未进入 Electron JavaScript；这不是 `SERVER_EXITED`。

正式分发包必须完成 Developer ID 签名、公证和 stapling。未签名目录包只适合内部预检。

## Demo 不应联网

确认环境为：

```text
DEMO_MODE=1
PROVIDER_NETWORK_DISABLED=1
```

任务证据应显示 `provider=demo-local` 和 `billed=false`。若不满足，立即取消任务并保留诊断。
