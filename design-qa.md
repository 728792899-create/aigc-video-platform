# Figma v2 → Runtime 视觉 QA 台账

更新日期：2026-07-22
设计事实源：[Cloud Production Prototype v2](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn)
当前结论：**整改进行中；不作为正式发布通过证明**

## 已确认的产品结构

- 运行时采用单一可折叠主侧栏；不存在旧版 Rail + Workspace 双层左侧导航。
- 项目内横向阶段为：简报 → 剧本 → 资产 → 分镜 → 生成 → 审阅 → 时间线 → 导出。
- 16 个 Workspace 共用同一 canonical snapshot；Story、Production、Delivery 只作为画布局部投影。
- 当前视觉系统为 Obsidian Atelier：墨黑画布、鼠尾草品牌色、蓝灰信息色、金色警告、酒红危险。
- 当前本地产品无需登录或云端数据库；Figma 中云端组织、成员、Presence、RBAC 与结算均属于 Archived Research / External Gate。

## 本轮实机审查范围

已采集并检查项目中心、剧本、生成、候选审阅和任务中心；此前工作区台账覆盖资产、分镜、连续性、Prompt/Skill、Provider、本地治理、时间线与导出。审查使用零 Key Demo，真实 Provider 请求为 0。

## 已落地整改

- 主侧栏增加稳定的 Lucide 领域图标、分组和简短职责说明。
- 阶段导航同时使用完成/锁定图标、文字和顺序，不再只依赖颜色。
- 项目中心加强恢复现场、Demo、新建/导入的主次层级与状态信息。
- 所有未实现后端契约的操作继续显示 Planned 或 External Gate，不保留无响应假按钮。
- 交互目标、焦点、Reduced Motion 和 1440/1180/760 响应式规则继续由自动化与 Browser QA 共同约束。

## 尚待关闭

1. 对最新样式重新完成 1440、1180、760 三档逐页截图比对。
2. 检查长文本、缩放、键盘焦点、Dialog 焦点返回和所有 Empty/Partial/Unknown 状态。
3. 清理剩余非组件化的局部样式，并核对 Figma Token 与 CSS 变量映射。
4. 完成内部产品、设计、前端、后端、测试和安全六角色人工签字。

本文件只记录当前视觉审查状态。自动化、运行时和发布状态以 [`docs/current-status.md`](docs/current-status.md) 为准；完成全部截图和可访问性复测前，不宣称 Figma v2 已像素级交付通过。
