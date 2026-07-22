# 开发预览内部联合评审

候选：`Review Candidate 2`
评审范围：Figma Target/Current、14 Workspace、零 Key Demo、恢复/诊断、安全边界、1440/1180/760
说明：本页记录代码与原型侧的联合走查证据；业务负责人和真实同事的签字仍需由项目团队完成，不以自动化检查冒充人工确认。

## RC1 → RC2 问题关闭

| 级别 | RC1 问题 | RC2 处理 | 复测 |
| --- | --- | --- | --- |
| P0 | MVP 点击流缺少独立起点，部分动作无 destination | 新增 `START / MVP Unmoderated / 1440`；主路径动作全部连接 | Figma：8 起点、0 missing destination、0 dead action |
| P0 | 按钮使用“下一步/继续/确定/重试” | 改为对象明确的结果式文案 | Figma 主路径通用占位文案 0 |
| P0 | Runtime 只有三张领域图，14 Target 页面无法深链接 | 新增 14 Workspace Registry 与 `workspace` 查询参数，保留旧 `view` | 单元测试与 Browser 前进/后退通过 |
| P0 | 锁定功能像无响应按钮 | 显示原因、完成条件和真实替代路径 | 锁定契约测试通过 |
| P0 | 引导指向性差、目标缺失时浮空 | CoachMark 绑定 `data-onboarding-target`；缺失时回退帮助 | Browser 可定位 8 个目标；缺失逻辑有回退 |
| P0 | 760px 阶段条与任务托盘重叠 | 分配 58px Rail、54px Stage、42px Task 安全区 | Browser 760：无横向溢出，矩形边界无重叠 |
| P0 | `导出与设置` 主操作误开系统面板 | 将主操作显式路由到真实 Delivery 预检，并增加源码契约测试 | Electron 原生目录选择、预检、确认、导出与重启复测通过 |
| P1 | Project Center / Task / Canvas / Systems 职责重叠 | Figma 和交付矩阵明确“导航/执行/诊断/治理”边界 | 交付矩阵已记录 |
| P1 | 开发预览行为记录可能泄露项目内容 | 默认关闭、session ring buffer、字段白名单、无网络上传 | 单元测试验证只保留 6 个允许字段 |

## 六角色走查清单

| 角色 | 本轮检查 | 当前结果 | 仍需人工确认 |
| --- | --- | --- | --- |
| 产品 | MVP 范围、14 Workspace 职责、主任务、Planned/External Gate | 代码/规格一致；无新增 API 承诺 | 业务优先级与术语最终签字 |
| 设计 | 8 流程、按钮文案、44px、Obsidian Atelier、响应式 | Figma P0 门禁通过；Browser 三档复测 | 真实创作者 30–45 分钟可用性观察 |
| 前端 | Registry 单源、URL 兼容、Shell/Host、引导本地化 | 类型检查、单元与生产构建门禁 | 长项目 500/1000 节点性能预算 |
| 后端 | 复用 `/api/v2`、snapshot、revision/幂等/任务状态 | 未修改服务端接口与 schema | 真实 Provider 的 cancel/reconcile 语义 |
| 测试 | 状态、unknown/partial、浏览器、Electron、重启 | 自动化用例已定义；完整门禁见验收记录 | Windows 实机与正式签名包不在本轮 |
| 安全 | 凭证、路径、媒体、诊断与记录器脱敏 | 记录器白名单；零 Key 网络门禁 | 正式 Provider 取证与第三方渗透测试 |

## 五项任务走查

1. 创建零 Key Demo 项目并导入原著。
2. 批准简报/制作计划并生成候选。
3. 为全部镜头选择候选。
4. 处理一次 unknown 对账或 partial failure。
5. 完成预检与本地导出。

技术走查判定：五项任务均有自动化或实机证据；危险操作确认遗漏 0；付费请求 0；敏感信息泄露 0；已发现 P0 问题全部关闭。自动化和工具复测结果记录在 [开发预览验收报告](development-preview-acceptance.md)。六角色负责人签字与真实用户测试仍需项目团队完成。

## P1/P2 台账

| 问题 | 责任域 | 目标阶段 | 验收 |
| --- | --- | --- | --- |
| 1000 节点图谱的持续性能预算 | 前端/测试 | P1 | 交互帧率、内存、列表替代路径 |
| 自由时间线剪辑与保存契约缺失 | 产品/后端 | P2 | 新 RFC，不修改现有 assembly |
| 正式 RBAC 与团队协作 | 产品/安全/后端 | External Gate | 权限模型、审计和迁移方案 |
| 真实 Provider 成本、取消和余额 | 后端/安全 | External Gate | 独立测试凭据、契约与计费对账 |
| 安装包、签名、公证、自动更新 | 桌面/发布 | 下一发布轮 | Windows/macOS 干净机发布门禁 |
