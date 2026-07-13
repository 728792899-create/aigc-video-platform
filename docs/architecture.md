# 架构说明

## 运行边界

```mermaid
flowchart LR
  E["Electron Main"] --> P["受限 Preload"]
  P --> V["Vue 创作工作台"]
  V -->|"同源 REST / SSE"| A["Express API"]
  A --> T["Task Manager + Queue"]
  T --> W["八阶段状态机"]
  W --> R["Provider 契约层"]
  W --> M["媒体任务 / FFmpeg"]
  W --> D["sql.js / SQLite 检查点"]
  M --> F["本地媒体资产"]
  E --> K["系统安全存储"]
  K -->|"启动时一次性内存注入"| R
```

Electron 只负责系统能力、后端子进程、窗口、安全存储、更新与崩溃边界。Vue 不接触 Node API；Express 默认仅绑定回环地址。数据库保存项目、资产引用和任务检查点，大文件保存在用户数据目录。

## 八阶段状态机

固定阶段为 `topic → script → storyboard → image → voice → subtitle → timeline → export`。每阶段保存 `status / attempts / progress / output / error / timestamps`，状态包括 `pending / ready / running / succeeded / partial / failed / canceled / skipped`。

```mermaid
stateDiagram-v2
  [*] --> ready
  ready --> running: START
  running --> succeeded: SUCCEED
  running --> partial: PARTIAL
  running --> failed: FAIL
  running --> canceled: CANCEL
  failed --> ready: RETRY
  partial --> ready: RETRY
  canceled --> ready: RETRY
  succeeded --> [*]
```

阶段完成会解锁下一阶段。重试目标阶段时仅清空其下游检查点；上游输出、已有图片和配音继续复用。非法越级被状态机拒绝。

## 崩溃恢复与幂等

任务与完整 `meta.workflow` 同步写入 SQLite。启动时恢复器扫描 `pending / waiting / running / composing / interrupted`，按 `recovery.kind` 重建 runner 并增加恢复次数。超过上限进入可诊断失败终态。

流水线的幂等策略：

- 脚本直接读取阶段输出；
- 分镜阶段成功后不再批量删除/重建 storyboard；
- 图片和配音检查已选资产与现有文件并跳过；
- 导出使用新的 export 记录与唯一文件名，失败临时文件会清理；
- 数据库写盘采用临时文件加原子 rename；schema 变更前保留最多五个迁移备份。

## Provider 与部分成功

Provider 契约把无密钥、超时、限流、异常响应和未知错误归一化，记录尝试链而不泄露凭证。主 Provider 失败可降级，全部失败可以产出明确标记的 placeholder。批任务使用 `Promise.allSettled` 语义保留成功项，失败项可单独重试。

Demo Mode 在脚本、图片和配音入口先短路为本地实现，保证测试不会触达付费 Provider。FFmpeg 仍真实执行，以覆盖最终媒体边界。

## Electron 安全模型

- `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`、`webSecurity=true`；
- 默认拒绝 renderer 权限请求；外链只允许交给系统浏览器打开 HTTPS；
- preload 只暴露两个静态方法，IPC 校验来源端口、参数类型和返回路径；
- CSP、CORS、请求体限制、生成限流和请求 ID 在后端统一执行；
- API Key 由 `safeStorage` 加密，明文只存在于 Electron/后端进程内存；
- 日志、错误响应、任务错误和 Sentry 事件都经过凭证清理。

## 发布与可观测性

GitHub Actions 在 Linux 执行全质量门禁，在 Windows 生成 unsigned 预检包、在 macOS 生成可校验但不受 Gatekeeper 信任的 ad-hoc 预检包。正式 tag 工作流从 GitHub Secrets 注入签名/公证凭据，输出安装包、blockmap 和更新清单。Sentry 是显式 opt-in；本地 crash dump 与 `logs/backend.log` 在无 DSN 时仍可用于离线诊断。
