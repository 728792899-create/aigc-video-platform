# Local v1 最终研发交付说明

日期：2026-07-21
Figma 文件：[`AIGC 导演工作室 · Local v1`](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn)
最终交付板：[`P12/LOCAL-V1-FINAL-HANDOFF`](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn?node-id=95-2)

## 当前交付范围

Local v1 是单用户、本地优先的桌面创作产品。应用启动后直接进入本地项目中心，不设计登录、注册、邀请、组织、成员、在线状态或云端数据库。

16 个活动主界面：

1. 本地项目中心
2. 新建项目向导
3. 创作简报
4. 剧本编辑室
5. 资产圣经
6. 分镜导演工作区
7. 连续性实验室
8. 图像与视频生成
9. 可视化制作画布
10. 候选审阅
11. 音频字幕时间线
12. 导出与交付
13. 任务中心与诊断
14. Prompt / Skill Registry
15. Provider 与模型连接
16. 本地安全、备份与恢复

响应式交付包括 1180px 紧凑制作工作区和 768px 本地审阅工作区。768px 版本不依赖远程审片、账号或协作者身份。

## 活动原型入口

| Starting Point | 目标 |
|---|---|
| `START/local_first_production` | 项目中心到本地导出的完整制作流程 |
| `START/relay_connection` | 本机 Provider 连接、脱敏检查与 Keychain 保存 |
| `START/partial_retry` | 部分失败后仅重试失败项 |
| `START/unknown_reconcile` | 未知任务先对账再决定后续动作 |
| `START/prompt_release` | Prompt revision、评测、发布与回滚 |
| `START/export_backup` | 导出、项目包、本地备份与恢复验证 |

最终验证结果：6 个活动入口、66 条交互连线、0 断链、0 条活动连线进入 `ARCHIVE/*` 节点。

## 设计系统交付

- 66 个 Component Sets、198 个 variants。
- 93 个 Variables，覆盖颜色、语义、间距、圆角、视口、密度、动效和原型状态。
- Obsidian Atelier 暗色体系提供 Default 与 High Contrast 语义。
- 关键操作目标不小于 44×44；状态同时使用文字、图标与颜色。
- 1440、1180、768 三种视口均有明确降级规则。
- P12 包含 3 条研发 Annotations：交付契约、交互契约和归档边界。

## 数据与安全契约

- 项目事实使用 schema v12 本地 SQLite；媒体保存在项目目录。
- 保留当前 `/api/v2`、任务状态机、检查点、恢复和 `.aigcproj` 兼容性。
- Provider 凭证只进入 macOS Keychain 或 Windows Credential Manager。
- Docker 部署只从 `/run/secrets` 读取凭据；容器内凭据库只读。
- Provider 仅允许内置、OpenAI-compatible 或声明式 HTTP manifest；任意可执行适配器被封存。
- 前端、日志、数据库、项目包和诊断导出不得包含密钥值。
- Demo Mode 显式保持 `PROVIDER_NETWORK_DISABLED=1`，付费请求为 0。

## 归档边界

`ARCHIVE/*`、P8、P9、P10 和 Cloud RC2 内容仅用于保存历史研究与决策证据。登录、团队协作、远程评论、Presence、Soft Lock、RBAC、云数据库、云同步和远程备份不进入 Local v1 的产品范围、研发排期或验收。

研发实现和评审应从 P12、6 个活动 Starting Points 和本目录文档进入，不应从历史 Cloud 页面开始。

## 最终 Figma QA

- 活动主界面中的 Cloud、Team、Personal、团队、组织、成员、在线、邀请、权限与远程协作文案残留：0。
- P12 占位文案、默认图层名、零尺寸文本、缺失字体和画板重叠：0。
- Provider 页面已统一为本机私有、项目绑定与自托管语义。
- 候选审阅使用本机审阅备注，不再暗示远程评论人或团队审批。
- 历史 Cloud 页面保留但均明确命名为归档或历史交付阶段。
