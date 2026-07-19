# 来源、许可证与 clean-room 台账

## 本包内容

`registry/prompts.json`、`registry/skills.json`、TypeScript 运行时、测试、示例和本文档均为本次任务独立撰写。没有从八个参考项目复制 Prompt、Skill、源码、编译 bundle、图片、音视频或示例素材。

本包当前设置为 `private: true` 和 `license: UNLICENSED`。这表示没有替项目所有者决定对外许可证，不表示引用项目对本包拥有权利。复制到自有项目后，应按自有项目的发布策略选择许可证。

## 行为证据

| 项目与固定 commit | 许可证边界 | 只保留的行为语义 | 复制状态 |
|---|---|---|---|
| BigBanana `4a61f6c91964819ed2d4e46911c399811c5545d7` | BigBanana Community License 1.0 | 分区出口、域名/私网/超时控制的验收目标；容器内部未验证 | 未复制；本包网络实现独立撰写 |
| CineGen `e0f620bfd3c1e212b8e3ca2374577f4b0d70a053` | AniKuku Community License v1.0 | 结构化拆解、参考顺序、人物变体、首尾帧 | 未复制文本、代码或素材 |
| LumenX `743683387384fb1d9fff72038933e7249d416076` | MIT；第三方资产另审 | 双语润色、反馈、资产作用域、模型目录、媒体和任务语义 | 模板与实现仍独立撰写 |
| PrintFilm `b5ed4b840b048a921e801accc253a0d4549137df` | 根目录无明确许可证 | Prompt 工作台、能力目录、场景优先引用 | 未复制文本、代码或资源 |
| Director AI `dd812c756f0ee0533cd7d36042a16144ab1b1202` | 根目录无明确许可证 | 模块化影视语言、导入分析、反馈确认 | 未复制函数或 Skill 文本 |
| LocalMiniDrama `92c66dd75688d83aac3ccc31bb51378613122cbc` | MIT；FFmpeg/素材/Provider另审 | 故事扩写、角色场景道具、帧、多节拍、连续性 | 模板与实现仍独立撰写 |
| openOii `79e652c23cd1c4807611c6aad7254a68cc9da092` | 根目录无明确许可证 | 结构化角色、评审路由、checkpoint、Fake Provider目标 | 未复制 Prompt、Skill、测试或源码 |
| Toonflow `bc61ec7a1b5df31293b286981a5f4ad4635464ee` | Apache文本与补充协议冲突 | manifest-first Skill、specialist、模型匹配、候选语义 | 未复制183个Skill、4个模型Prompt、bundle或素材 |

每个 Prompt/Skill 的 `provenance` 只使用 `behavioral-reference` 描述上述功能来源，并强制 `copied: false`。BigBanana 没有公开可审计产品 Prompt，因此没有被写成任何模板的 Prompt 来源。

## 第三方 npm 依赖

| 依赖 | 用途 | 许可证检查 |
|---|---|---|
| `ajv` | JSON Schema Draft 2020-12 运行时校验 | 安装/分发时保留依赖自身许可证 |
| `typescript` | 开发与构建 | 仅开发依赖，保留依赖自身许可证 |
| `vitest` | 自动测试 | 仅开发依赖，保留依赖自身许可证 |
| `@types/node` | TypeScript 类型 | 仅开发依赖，保留依赖自身许可证 |

`package-lock.json` 固定依赖树。复制或发布前仍应运行 SBOM、漏洞和许可证扫描；本台账不替代法律意见。

## 内容与模型权利

本包代码或模板许可不覆盖：字体、图标、图片、音视频、FFmpeg、模型权重、数据集、Provider 服务、用户素材、人物肖像/声音、商标或生成内容。宿主项目必须分别记录来源、地域、商用、署名、再分发、保留期和删除要求。
