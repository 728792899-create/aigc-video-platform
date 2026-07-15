# Provider 与 Demo 指南

Provider 层的目标不是隐藏所有厂商差异，而是把业务最关心的行为统一：凭证检查、超时、限流、重试、降级、格式校验、占位兜底和尝试记录。

## 能力分类

| kind | 作用 | 示例协议 |
| --- | --- | --- |
| `llm` | 主题扩写、脚本与分镜结构 | OpenAI-compatible chat |
| `t2i` | 文生图 | Zhipu Image、OpenAI Image、DashScope Image |
| `t2v` | 文生视频 | Zhipu Video、Kling async |
| `tts` | 旁白配音 | Edge、本地、OpenAI TTS、Volcano TTS |

Provider 注册表位于 `server/services/providers/index.js`。注册项描述能力和协议，不应包含任何真实 Key。

`server/services/modelCatalog.js` 从这份注册表派生稳定模型 ID、modality、输入输出类型和 adapter 已实现的能力。静态目录通过 `GET /api/providers/catalog` 返回，运行时凭证/健康仍只由 `/api/providers/health` 表达。目录中的能力表示“当前代码适配器会正确处理什么”，不是对第三方模型价格、质量或长期 API 行为的承诺。

阶段路由和 LLM/T2I/T2V 适配器在网络请求前执行 fail-fast：未知模型、阶段 modality 错配或请求未实现的参考图能力都不会默默改用另一模型。OpenAI-compatible LLM 仍允许自定义 endpoint model ID，以兼容中转站与豆包接入点。

## 调用链

```mermaid
sequenceDiagram
  participant Stage as Workflow Stage
  participant Contract as Provider Contract
  participant P1 as Primary Provider
  participant P2 as Fallback Provider
  participant Media as RemoteMediaFetcher
  participant Local as Placeholder/Local

  Stage->>Contract: providers + execute + validate
  Contract->>P1: 请求（timeout + AbortSignal）
  alt 成功且格式有效
    P1-->>Contract: value
  else 可重试错误
    Contract->>P1: 退避后重试
  else Provider 不可用
    Contract->>P2: 降级请求
  end
  opt 全部失败且允许占位
    Contract->>Local: 生成明确标记的本地素材
  end
  Contract->>Media: 校验并落盘远程输出
  Media-->>Contract: 受管本地引用
  Contract-->>Stage: value + provider + downgraded + attempts
```

## 统一错误

| code | 典型来源 | 是否可重试 |
| --- | --- | --- |
| `MISSING_CREDENTIALS` | 未配置 Key/双密钥 | 否 |
| `TIMEOUT` | AbortError、请求超时 | 是 |
| `RATE_LIMITED` | HTTP 429、rate limit | 是 |
| `INVALID_RESPONSE` | JSON/字段格式错误 | 否 |
| `UPSTREAM_UNAVAILABLE` | HTTP 5xx | 是 |
| `AUTH_FAILED` | HTTP 401/403 | 否 |
| `PROVIDER_FAILED` | 其他已知失败 | 否 |
| `ALL_PROVIDERS_FAILED` | 所有候选均失败 | 否 |
| `MODEL_NOT_FOUND` | 未登记且不允许自定义的模型 | 否 |
| `MODEL_MODALITY_MISMATCH` | 模型与阶段类型不匹配 | 否 |
| `MODEL_CAPABILITY_UNSUPPORTED` | 请求了 adapter 未实现的能力 | 否 |

对前端返回 `safeMessage`，原始响应不得包含 Key、Authorization、完整请求体或 Provider 的敏感调试信息。

## 尝试记录

每次调用保留安全的尝试链：

```json
[
  {
    "provider": "primary",
    "attempt": 1,
    "ok": false,
    "code": "RATE_LIMITED",
    "status": 429,
    "retryable": true
  },
  {
    "provider": "fallback",
    "attempt": 1,
    "ok": true
  }
]
```

它用于任务诊断、Provider 标签和失败修复，不应记录提示词全文或凭证。

## 凭证来源

```mermaid
flowchart TD
  UI["设置页"] --> Electron["Electron credential vault"]
  Electron --> Safe["safeStorage"]
  Safe --> Runtime["一次性启动注入"]
  Runtime --> Store["后端内存 credentialStore"]
  Store --> Resolver["resolveCredentials"]
  Resolver --> Adapter["协议适配器"]

  Env["显式环境变量"] --> Resolver
  Config["非敏感 baseUrl/model 配置"] --> Resolver
```

桌面版优先使用系统安全存储。纯 server 开发模式可以从显式环境变量读取凭证，但不得把真实值提交到 `.env`、测试夹具或文档。

## Demo Mode

Demo Mode 是产品能力，不是测试 mock 的别名。它需要满足：

- 无 Key 可以创建项目、脚本和分镜；
- 图片输出为本地生成且带 Demo/placeholder 标记；
- 配音不访问云端；
- 字幕、时间线和 FFmpeg 仍走真实代码；
- UI 显示 Provider 为 Demo/local，成本为 0；
- 测试环境主动清空常见 Key；
- Dreamina 等外部 CLI 探测在 Demo 下不会启动。

```mermaid
flowchart LR
  Demo["DEMO_MODE=1"] --> Script["本地脚本"]
  Demo --> Image["本地占位图"]
  Demo --> Voice["本地静音音轨"]
  Script --> Timeline["真实字幕/时间线"]
  Image --> Timeline
  Voice --> Timeline
  Timeline --> FFmpeg["真实 FFmpeg"]
  FFmpeg --> MP4["有效 MP4"]
```

## 批任务与部分成功

`executeBatch` 对每个输入独立捕获错误。三张图片成功、一张失败时，整体状态是 `partial`，不是 `failed`。业务层应把失败项与 storyboard id 关联，允许精确重试。

## 新增 Provider

推荐顺序：

1. 在注册表添加 provider 定义；
2. 选择已有协议或新增窄适配器；
3. 定义凭证字段和 `credentialFrom`；
4. 给输出写明确 `validate`；
5. 确保超时支持 AbortSignal；
6. 通过契约层返回统一 attempts；
7. 在 UI 标明能力、是否本地、是否可能计费；
8. 补齐测试；
9. 更新本文档和设置页说明。

远程输出 URL 不得直接返回前端。图片/视频 adapter 必须复用 `RemoteMediaFetcher`，并明确 kind、最大字节数、超时和允许格式；签名 URL 与原始 Provider 响应只能存在于 adapter 调用期间。

T2V 首帧输入必须经过 `MediaAdapter`：只读取受管 `/uploads/` 文件，拒绝路径穿越、缺失文件、超过 9 MB 的输入和 magic bytes 不匹配；发往 Provider 的 data URL 只存在于请求期间，任务/日志只保存媒体 ID、受管相对 URL、MIME、字节数和 content hash。对象存储解析器尚未配置时明确返回 `MEDIA_DELIVERY_UNSUPPORTED`。

最低测试矩阵：

- [ ] 无密钥时不发网络请求；
- [ ] 超时可诊断且按策略重试；
- [ ] 429 可重试；
- [ ] 401/403 不盲目重试；
- [ ] 5xx 可降级；
- [ ] 异常 JSON 被拒绝；
- [ ] 全部失败时行为明确；
- [ ] 批量调用产生正确 `partial`；
- [ ] 错误和日志不泄露凭证。
- [ ] 远程输出逐跳执行 SSRF、大小、MIME 与 magic bytes 校验，前端只得到本地媒体引用。

## 成本与授权提醒

本项目不会替 Provider 承诺价格或版权。启用真实模型前，用户需要自行确认当前模型与账号的计费规则、生成内容的商业使用条款、输入素材是否有上传授权、音色是否涉及声音权利，以及输出是否需要水印或人工审核。
