# AIGC 导演工作室 2.0 文档

当前文档对应 schema v12 与 `/api/v2`。本机服务和 Docker 均无需登录或云数据库；Demo 付费请求固定为 0。Browser 已验证 1440/1180/760 工作台，顶层 Smoke 覆盖局部失败重试、有效 MP4 和服务重启恢复。正式 Provider live verification、签名、公证与线上更新仍未验收。

- [架构与能力边界](architecture-v2.md)
- [当前项目状态（2026-07-22 单一事实源）](current-status.md)
- [API v2](api-v2.md)
- [Schema v12 数据模型](data-model-v2.md)
- [Prompt Pack 集成审计](PROMPT_PACK_INTEGRATION_AUDIT.md)
- [Prompt Pack 迁移映射](PROMPT_PACK_MIGRATION_MAP.md)
- [Prompt Pack 集成报告](PROMPT_PACK_INTEGRATION_REPORT.md)
- [开源功能知识库对照与升级](knowledge-base-upgrade.md)
- [《AIGC升级文档》实施台账与差距矩阵](AIGC-UPGRADE-EXECUTION.md)
- [Studio Workspace 交付矩阵](studio-workspace-delivery-matrix.md)
- [产品术语与内容规范](product-language-and-content.md)
- [开发预览内部联合评审](internal-review-candidate.md)
- [开发预览验收报告](development-preview-acceptance.md)
- [Local v1 产品范围（当前事实源）](local-v1/README.md)
- [Local v1 最终 Figma 研发交付说明](local-v1/final-handoff.md)
- [本地 Web 与 Docker 部署指南](local-web-deployment.md)
- [Cloud v1 历史研究契约包（已归档）](cloud-v1/README.md)
- [零 Key Demo](demo-v2.md)
- [安全与隐私](security-v2.md)
- [测试与 CI](testing-ci-v2.md)
- [桌面发布](desktop-release-v2.md)
- [故障排查](troubleshooting-v2.md)
- [Release Checklist](release-checklist-v2.md)
- [Clean-room 法律溯源](legal/clean-room-provenance.md)

除明确标注为“历史记录”或“已归档研究”的章节外，这些文档只描述 2.0 当前树。旧 Dashboard、固定阶段页面、1.x API/数据库、旧截图和旧 CHANGELOG 已从当前文件树删除；Git 历史仍保留审计证据。若文档间出现状态冲突，以[当前项目状态](current-status.md)为准。
