# 异常监控方案

桌面主进程集成 `@sentry/electron`，但只有设置 `SENTRY_DSN` 才启用。默认 `sendDefaultPii=false`、性能采样为 0；`beforeSend` 清理 Bearer token、URL 中的 key/token/secret 和常见 JSON 凭证字段。后端子进程异常退出会由主进程上报退出码、信号和恢复次数，不附加数据库、媒体、完整日志或用户提示词。

建议在 Sentry 项目中设置 30–90 天保留期、按 release 建版本、为 crash-free sessions 和后端连续重启建立告警。正式启用前必须更新隐私说明并在测试组织中验证事件脱敏。

无 DSN 时仍保留本地 crash dump、后端日志、请求 ID、Provider 健康摘要和任务 diagnosis，产品功能不依赖监控服务。
