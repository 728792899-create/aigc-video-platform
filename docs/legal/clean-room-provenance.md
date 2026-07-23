# Clean-room Provenance

本文件是工程溯源记录，不是营销文案或法律意见。

## Reference boundary

- 行为研究参考：`HBAI-Ltd/Toonflow-app`
- 固定研究快照：`bc61ec7a1b5df31293b286981a5f4ad4635464ee`
- 只记录公开可观察行为、模块存在性与依赖拓扑。
- 未复制其源码、Prompt、CSS、品牌、图像、媒体、编译前端或资源 hash。

## Independent design

本项目独立定义 Story/Production/Delivery 三张领域图、Zod 契约、schema v12、Series/Episode 连续性、Prompt/Skill 发布门禁、CandidateBatch、Model Catalog、MediaResolver、可追溯分层记忆与脱敏 AgentRun checkpoint、项目级零付费生成策略、append-only 高风险审计、三通道 Egress Broker、签名 Provider manifest、可撤销 Ed25519 发布者信任、Agent Approval、GraphCommand、Fake Provider、任务恢复和 Electron 边界。界面颜色、组件层级、文案、图标和应用标识均由本项目重新设计。

2026-07-18 的全库对照使用 `open-source-feature-knowledge-base@1425238f35b16f23b8a63aee1a109113a164e4a9`。`.aigcproj` 的 manifest/checksum/quarantine/ID-remap 需求参考了 `xuanyustudio/LocalMiniDrama@92c66dd75688d83aac3ccc31bb51378613122cbc` 的 MIT 功能证据，但 ZIP 编解码、数据契约、事务恢复和 UI 均在本项目中独立编写，没有复制上游源码或资源。其余无许可、自定义许可或限制性项目仅用于抽象验收条件。

## Contributor isolation

贡献者不得把参考仓库的 Prompt 正文、实现片段、样式或素材粘贴到 issue、测试 fixture、注释或提交。行为需求应先转写为抽象验收标准，再由未接触目标实现文本的代码独立完成。

参考项目的许可证或公开可读状态不自动授予品牌、Prompt、素材、模型、服务条款或生成内容的使用权。
