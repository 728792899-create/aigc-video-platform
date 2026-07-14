# 可观测性与异常监控

产品默认依赖本地诊断，Sentry 仅在发布者显式配置 `SENTRY_DSN` 时启用。监控不能成为创作和恢复流程的单点依赖。

## 信号分层

~~~mermaid
flowchart TD
  Request["HTTP 请求"] --> Rid["X-Request-Id"]
  Rid --> Backend["backend.log 脱敏日志"]
  Task["长任务"] --> State["tasks + workflow 检查点"]
  State --> Diagnosis["diagnosis / attempts / provider"]
  Electron["Electron 主进程"] --> Crash["crashReporter / 子进程退出"]
  Crash --> Local["本地 crash dump"]
  Crash -. opt-in .-> Sentry["Sentry"]
  Backend -. 摘要 .-> Sentry
~~~

| 信号 | 用途 | 是否默认本地 |
| --- | --- | --- |
| 请求 ID | 关联 HTTP 错误和服务日志 | 是 |
| 任务状态 | 进度、失败阶段、恢复次数 | 是 |
| Provider 尝试 | 降级链、延迟、错误分类 | 是 |
| 资产健康 | 缺图、缺音频、悬空引用 | 是 |
| backend.log | 主进程与后端诊断 | 是 |
| crash dump | Electron 原生崩溃 | 是 |
| Sentry 事件 | 发布版本聚合和告警 | 否，显式启用 |

## 本地日志

Electron 后端日志位于用户数据目录 `logs/backend.log`。renderer 只记录 warning/error，主进程记录后端启动、退出和恢复摘要。

日志允许包含：

- 时间；
- release；
- 请求 ID；
- 任务 id 和类型；
- 阶段名；
- Provider 名称和错误分类；
- 退出码、信号和恢复次数。

日志禁止包含：

- Bearer Token 或 API Key；
- 完整 Provider 请求/响应；
- 用户脚本和提示词正文；
- 数据库内容；
- 媒体二进制；
- 未脱敏绝对路径。

## 任务诊断

失败任务至少应回答：

1. 哪个阶段失败；
2. 使用哪个 Provider；
3. 错误属于无密钥、鉴权、超时、限流、异常格式、媒体还是路径；
4. 是否可重试；
5. 上游成功资产是否保留；
6. 建议执行重试、切换 Provider、补资产还是检查目录。

只有“生成失败”而没有阶段和建议，视为不可诊断。

## Sentry opt-in

桌面主进程集成 `@sentry/electron`。仅设置 `SENTRY_DSN` 后启用：

- `sendDefaultPii=false`；
- 性能采样率为 0；
- beforeSend 清理 Bearer Token、URL key/token/secret 和常见 JSON 凭证字段；
- 后端子进程退出只上报退出码、信号和恢复次数；
- 不附加数据库、媒体、完整日志或用户提示词。

~~~mermaid
sequenceDiagram
  participant App as Electron
  participant Redact as beforeSend
  participant Sentry as Sentry Project

  App->>Redact: exception + safe tags
  Redact->>Redact: 清理 token / key / 路径
  Redact-->>Sentry: 最小事件
  Note over App,Sentry: 无 DSN 时不发送
~~~

## 建议标签

- `release`：应用版本和 commit；
- `platform`：win32、darwin；
- `arch`：x64、arm64；
- `feature`：backend-start、renderer-load、export、recovery；
- `task_type`：auto-produce、image-batch、video；
- `stage`：script、image、voice、export 等；
- `provider`：名称，不含模型输入；
- `recovery_attempt`：整数。

不要用项目名、提示词、用户路径或邮箱作为 tag。

## 告警建议

| 告警 | 建议条件 |
| --- | --- |
| crash-free sessions | 低于发布基线 |
| 后端连续重启 | 同一 session 短时间超过恢复阈值 |
| 导出失败率 | 新 release 显著高于上一版本 |
| 数据库完整性 | 出现任何 integrity check 失败 |
| 恢复耗尽 | recovery attempts 达到上限 |
| renderer 空白页 | did-fail-load 或连续 chunk load 错误 |

初始保留期建议 30–90 天。正式启用前必须更新隐私说明，并在测试组织中验证脱敏。

## 发布验证

1. 不设置 DSN，确认功能和恢复不受影响；
2. 在测试 Sentry 项目配置 DSN；
3. 触发一个不含用户内容的受控异常；
4. 检查事件没有 Key、路径、脚本、数据库或媒体；
5. 验证 release 和 feature 标签；
6. 删除测试事件并记录验证日期；
7. 正式发布前再次审查 retention 和成员权限。

## 用户提交诊断

只请求：

- 应用版本、平台和架构；
- 复现步骤；
- 请求 ID；
- 任务 id；
- 失败阶段和脱敏错误；
- Provider 名称，不含 Key；
- 资产健康摘要。

不要请求用户公开上传 `backend.log`。确需日志时先提供脱敏步骤并使用私密渠道。
