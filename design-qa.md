# Figma v2 → Runtime 视觉 QA 台账

更新日期：2026-07-23
设计事实源：[Cloud Production Prototype v2](https://www.figma.com/design/o39ROHVJYio8OzBBWT43Bn)
当前结论：**运行时结构与响应式整改通过；Figma 节点级像素对比受访问权限阻塞**

## 已确认的产品结构

- 运行时采用单一可折叠主侧栏；不存在旧版 Rail + Workspace 双层左侧导航。
- 项目内横向阶段为：简报 → 剧本 → 资产 → 分镜 → 生成 → 审阅 → 时间线 → 导出。
- 16 个 Workspace 共用同一 canonical snapshot；Story、Production、Delivery 只作为画布局部投影。
- 当前视觉系统为 Obsidian Atelier：墨黑画布、鼠尾草品牌色、蓝灰信息色、金色警告、酒红危险。
- 当前本地产品无需登录或云端数据库；Figma 中云端组织、成员、Presence、RBAC 与结算均属于 Archived Research / External Gate。

## 本轮实机审查范围

已采集并度量 1440、1180 和 767px 项目中心、72px 侧栏收起、窄屏底部导航、任务中心与 Electron 候选审阅。审查使用零 Key Demo，真实 Provider 请求为 0。

## 已落地整改

- 主侧栏增加明确的收起/展开操作，桌面收起宽度固定为 72px，图标点击区不小于 48px。
- 项目中心清理了两套相互覆盖的 CSS，项目列表与指标卡改为有边界的自适应网格，水平滚动已消失。
- ≤768px 时品牌栏不再重复显示，底部只保留一层导航；“新建项目”占满内容宽度。
- Electron 启动冒烟不再依赖首个 `h1` 文案，改用稳定的工作台 ready marker。
- 阶段导航同时使用完成/锁定图标、文字和顺序，不再只依赖颜色。
- 项目中心加强恢复现场、Demo、新建/导入的主次层级与状态信息。
- 所有未实现后端契约的操作继续显示 Planned 或 External Gate，不保留无响应假按钮。
- 交互目标、焦点、Reduced Motion 和 1440/1180/≤768 响应式规则继续由自动化与 Browser QA 共同约束。

## 验证结果与阻塞

- 1440：页面宽度与 `scrollWidth` 同为 1440，侧栏 240px；收起后为 72px，无横向溢出。
- 1180：指标区自动收敛，页面宽度与 `scrollWidth` 一致。
- 767：品牌区 `display:none`，底部导航高度 64px，项目主操作宽度与内容区一致，无水平溢出。
- 页面 console 0 error；Browser 外壳自身的 Statsig 网络超时不来自产品页面。
- Figma MCP 对文件 `o39ROHVJYio8OzBBWT43Bn` 返回无编辑访问，因此不能诚实宣称节点级一比一像素对比通过。这不是学生版席位数量问题，而是当前文件与 MCP 身份的所有权/共享同步问题。
- 仍需产品、设计、前端、后端、测试和安全六角色人工签字。

截图、度量与修改清单见 [`docs/product-design-audit-2026-07-23.md`](docs/product-design-audit-2026-07-23.md)。自动化、运行时和发布状态以 [`docs/current-status.md`](docs/current-status.md) 为准。
