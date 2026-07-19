# AI Video Director Prompt Pack

这是面向 AI 短视频和 AI 漫剧的独立、可复制 TypeScript 运行包。它把创作提示词、Skill、模型能力、Provider 协议、可恢复工作流和评测收敛为固定版本契约，不依赖知识库其余目录运行。

## 交付清单

- 26 个 `PromptDefinition`：运行时真相见 [`registry/prompts.json`](./registry/prompts.json)，人工运营稿见 [`registry/PROMPTS.md`](./registry/PROMPTS.md)。
- 31 个 `SkillManifest`：运行时真相见 [`registry/skills.json`](./registry/skills.json)，人工运营稿见 [`registry/SKILLS.md`](./registry/SKILLS.md)。
- 两套混合检查点工作流：短视频与漫剧共用剧本、资产、连续性、候选和审阅真相。
- 10 个原生 Provider family + OpenAI-compatible、声明式 HTTP、所有者脚本三类中转协议。
- 26 个原创黄金样例、Schema-aware Fake 输出、故障脚本和自动化测试。

所有 Prompt 和 Skill 均为 clean-room 独立撰写。固定源码仅用于确认功能语义、变量契约和验收目标；详见 [`PROVENANCE.md`](./PROVENANCE.md)。

## 安装和验证

要求 Node.js `>=22.13`：

```bash
npm install --ignore-scripts
npm run check
npm test
npm run build
```

包被标记为 `private` / `UNLICENSED`，用于复制到自有项目。对外分发前请由项目所有者选择自己的许可证并保留来源台账。

## 快速接入

```ts
import {
  compilePrompt,
  loadPromptPack,
  PromptVersionStore
} from "@local/ai-video-director-prompt-pack";

const registry = await loadPromptPack("/absolute/path/to/ai-video-director-prompt-pack");

const compiled = compilePrompt(registry, {
  prompt: { id: "story.expand", version: "1.0.0" },
  variables: {
    input: {
      logline: "雨夜，快递员归还一台装着未来照片的旧相机。",
      durationSec: 45,
      aspectRatio: "9:16"
    }
  },
  skills: [
    { id: "story.genre.mystery", version: "1.0.0" },
    { id: "production.vertical-short", version: "1.0.0" }
  ],
  providerProfileId: "anthropic",
  policy: {
    safetyRules: ["不得生成未授权真实人物肖像。"],
    identityLocks: [],
    continuityLocks: [],
    approvedFacts: ["45秒竖屏", "雨夜", "照片来自未来"],
    userRequirements: ["前三秒建立悬念"]
  }
});

const versions = new PromptVersionStore();
const run = versions.createRun(compiled);
// 任务只保存 run.id 和 fixed provenance，绝不能在提交时解析 latest。
```

编译结果包含：

- `system`：不可由用户或 Skill 覆盖的安全与结构化输出约束。
- `canonical`：按固定优先级合成的完整语义。
- `zhReview` / `enExecution`：中文人工审阅与英文模型执行入口。
- `outputSchema`：模型输出的 JSON Schema。
- `provenance`：Prompt、Skill、Provider、变量和最终文本 hash。

## 固定编译优先级

```text
安全策略
→ 输出 Schema
→ 身份与连续性锁
→ 已批准项目事实
→ 用户要求
→ Skill 软策略
→ Provider 渲染
```

Skill 只能追加软策略、rubric 和首选模块。它不能覆盖 `system-safety`、`output-schema`、`identity-locks`、`continuity-locks`、`approved-facts`、`tool-permissions` 或 `network-policy`。

每次最多激活一个主要 `story.genre` 和一个主要 `art.style`；冲突会返回 `SKILL_CONFLICT`，不会按加载顺序静默覆盖。

## 模型能力与 Provider

`ModelCatalog.resolve()` 只在配置模型中匹配输入模态和能力。首尾帧、多参考图、多节拍、音频、取消和对账都必须由 `ModelCapability` 显式声明；不允许根据品牌名称猜测。

内置 family：

| Profile | 主要模态 | 说明 |
|---|---|---|
| `openai` | 文本、图像、视频 | 按具体 endpoint 和模型能力配置 |
| `google-gemini` | 文本、图像、视频 | 长任务按 operation 恢复 |
| `anthropic` | 文本 | 剧本、导演计划、润色与评审 |
| `runway` | 图像、视频、音频 | 统一为异步任务 |
| `volcengine-ark` | 文本、图像、视频 | endpoint/region/model 属于能力快照 |
| `alibaba-model-studio` | 文本、图像、视频、音频 | region/workspace/key 必须匹配 |
| `kling` | 图像、视频 | 仅开放项目明确配置的 API 能力 |
| `minimax` | 文本、图像、视频、音频 | 创建、查询、文件获取分阶段 |
| `tencent-hunyuan` | 文本、图像 | 首版不默认声明视频能力 |
| `fal-ai` | 图像、视频、音频 | 每个模型单独声明输入输出 Schema |

原生 family factory 与声明式 Adapter 共享 `submit/poll/cancel/reconcile`。若 Provider 不支持取消或对账，必须返回 `unsupported` / `outcome_unknown`，不能伪造成功。

### OpenAI-compatible

适合文本协议相容的中转站。普通用户只配置 base URL、secret reference 和模型能力；媒体、异步和首尾帧能力必须另行声明。示例见 [`examples/openai-compatible-relay.json`](./examples/openai-compatible-relay.json)。

### Declarative HTTP

通过 JSON 描述 submit/poll/cancel/reconcile endpoint、请求模板、JSON Pointer 和状态映射。完整异步示例见 [`examples/replicate-async.json`](./examples/replicate-async.json)。精确占位符保留对象类型，嵌入字符串的占位符才转成文本。

### Owner script

所有者脚本只做协议转换：`buildSubmit/parseSubmit/buildPoll/parsePoll/buildCancel/parseCancel/buildReconcile/parseReconcile`。它不能直接联网、读取环境变量或任意文件；所有 HTTP 和密钥注入都由宿主完成。

安装规则：

1. manifest 固定脚本相对路径、SHA-256、允许 host、secret references、能力、时限和输出大小。
2. 脚本在独立 Node 子进程与无 import 的 VM context 中运行；无 shell、空环境、无网络和无文件写入。
3. 宿主再次校验请求 host 与 secretRef，然后交给 `createSafeJsonHttpExecutor()`。
4. HTTP 执行器逐跳校验协议、host、DNS 结果、私网地址、重定向、时限和最大响应体。

示例见 [`examples/owner-relay-adapter.mjs`](./examples/owner-relay-adapter.mjs) 与 [`examples/owner-relay-manifest.json`](./examples/owner-relay-manifest.json)。该机制只面向项目所有者可信代码，不是第三方恶意代码沙箱。

## 工作流接线

[`registry/workflows.json`](./registry/workflows.json) 中每个 step 只引用固定 Prompt ID；运行时应把 step 输出保存为不可变 ArtifactVersion。默认检查点：

- 剧本批准。
- 新人物身份或身份变化批准。
- 分镜批准。
- 付费视频前预算/策略批准。
- 候选批准。
- 导出前终审。

遇到 `rights-risk`、`capability-downgrade`、`budget-exceeded`、`all-candidates-failed`、`provider-outcome-unknown` 或 `identity-conflict` 必须暂停。未知 Provider 结果先 `reconcile`，禁止直接创建新 attempt。

## 输出解析与评测

`parsePromptOutput()` 先剥离至多一层 JSON fence，再校验 Schema，并提供稳定错误码：

- `MODEL_FORMAT_JSON_PARSE`
- `MODEL_FORMAT_MISSING_KEYS`
- `MODEL_ECHO`
- `MODEL_SEMANTIC_DRIFT`

`createDeterministicSchemaFixture()` 为任何 Prompt 生成可重复的 Schema 合法 Fake 输出。`evaluateCase()` 要求每个硬断言都有证据与通过结论；任何硬断言失败都会 `releaseBlocked=true`。

黄金用例位于 [`registry/evals.json`](./registry/evals.json)，覆盖人物身份、空间、道具左右手、尾帧传递、多节拍、双语最小修改、引用顺序、能力降级、Prompt injection、候选全部失败、漫剧阅读顺序和最终发布门。

## 复制到自有项目

1. 整体复制本目录并保留 `registry/`、`PROVENANCE.md` 和 lockfile。
2. 把自有项目的剧本、镜头、资产和任务 ID 映射到 `variables.input/context`，不要先改模板。
3. 把现有模型写成 `ModelCapability`，再配置对应 Provider Profile。
4. 将现有散落 Prompt 导入为新的 exact version，补 provenance 和 eval；不要覆盖本包历史版本。
5. 先用 Fake Provider 跑通任务、恢复和候选审阅，再启用真实密钥。
6. 真实 API smoke test必须设置费用上限、沙箱数据和明确区域，默认不在测试中执行。

## 已知边界

- 本包不含真实密钥，不执行任何真实 Provider 调用。
- 原生 family 提供统一能力/Profile/factory；具体模型 endpoint 和字段必须以项目当时固定的官方文档生成版本化配置。
- 不提供持久数据库或队列实现；它定义 PromptRun、ProviderAdapter 和 workflow 契约，宿主项目负责事务、队列、lease 与 Artifact 持久化。
- 所有者脚本不是第三方插件市场。第三方代码需要独立 OS 用户、容器或同等级系统隔离。
