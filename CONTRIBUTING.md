# 参与贡献

感谢参与 AIGC 视频工作台。这个仓库最重要的工程约束是：长任务必须可诊断、可恢复，测试必须默认离线，任何凭证和用户资产都不能进入提交。

## 开始之前

推荐环境：

- Node.js 22 或更高版本；
- npm 10 或更高版本；
- Git；
- macOS、Windows 或常见 Linux 开发环境。

安装三个工作区的锁定依赖：

~~~bash
npm ci
npm --prefix server ci
npm --prefix client ci
~~~

启动不调用付费模型的演示环境：

~~~bash
npm run demo
~~~

不要为了运行测试创建真实 `.env` 或粘贴 API Key。需要验证 Provider 时使用受控替身和契约测试。

## 分支与提交

- 从最新目标分支创建短生命周期分支；
- Codex 生成的工作分支使用 `codex/` 前缀；
- 一个提交只表达一个可审查的意图；
- 不混入数据库、日志、上传素材、构建目录或编辑器临时文件；
- 行为变更、恢复语义和发布边界必须同步更新文档。

建议提交格式：

~~~text
feat: add resumable image batch
fix: preserve completed assets during stage retry
test: cover provider timeout fallback
docs: explain desktop backup recovery
~~~

## 开发流程

1. 先用测试或最小复现锁定预期行为。
2. 只修改完成该行为所需的模块。
3. 保持现有 REST 路径和响应结构兼容；破坏性变化必须先设计迁移。
4. 长任务写入阶段检查点，并明确取消、局部失败和恢复语义。
5. 日志必须经过凭证脱敏，错误响应不得回传原始 Provider 内容。
6. 运行与风险相称的测试，再执行完整质量门禁。

## TDD 最低要求

下列变化必须先补测试：

| 变更 | 必须覆盖 |
| --- | --- |
| 新 Provider | 无密钥、超时、429、5xx、异常格式、降级和全部失败 |
| 批量媒体任务 | 全成功、部分成功、只重试失败项、取消 |
| 状态机 | 合法转换、非法越级、检查点保留、下游失效 |
| 恢复逻辑 | 重启续跑、恢复上限、runner 缺失、重复启动幂等 |
| 上传或路径 | MIME 与魔数、目录穿越、越界路径、对象不存在 |
| Electron IPC | 来源校验、参数校验、取消和异常路径 |
| 数据迁移 | 升级前备份、旧 schema、新 schema、完整性失败 |

测试不得访问真实收费端点。测试用的假 Key 必须明显不可用，例如 `sk-test-fake`，并只指向受控假服务。

## 常用门禁

~~~bash
npm run quality
npm run test:smoke
npm run security:audit:all
node scripts/security-check.mjs
node scripts/ffmpeg-smoke.mjs
~~~

涉及桌面代码或打包配置时再运行：

~~~bash
npm run prepare:desktop
npm run electron:preflight
~~~

`npm run quality` 已覆盖服务端测试、Demo 恢复验收、客户端测试和生产构建。`npm run test:smoke` 会在临时目录验证真实 MP4、单阶段重试和服务重启恢复。

## Provider 扩展检查

新增 Provider 时：

- 在注册表中声明能力类型、模型、凭证来源和是否本地；
- 使用统一契约归一化错误，保留 attempts 记录；
- 明确哪些错误可重试，哪些错误应立即失败；
- 不在日志、配置导出或 HTTP 响应中回显密钥；
- 为全部失败设计占位或可操作诊断；
- 在设置页标明 Provider、成本属性和降级链；
- 更新 [Provider 指南](docs/provider-guide.md)和[内部 API 参考](docs/api-reference.md)。

## 工作流与媒体修改

每个阶段都要回答：

- 输入是否可以重复提交；
- 成功输出写在哪里；
- 中途退出后从哪里继续；
- 上游变化后哪些下游资产失效；
- 部分成功如何呈现；
- 临时文件何时清理；
- 用户取消时保留哪些已完成结果。

不要用“重新跑完整流程”掩盖幂等或恢复问题。参考[工作流与崩溃恢复](docs/workflow-recovery.md)。

## 前端与桌面修改

- Vue 页面需要空状态、加载、弱网、长任务和可操作错误；
- 键盘操作不能破坏文本输入和可访问性；
- 危险操作必须确认，确认文案要说明影响范围；
- Electron 保持 `contextIsolation=true`、`nodeIntegration=false` 和 sandbox；
- preload 只增加静态、最小、可校验的接口；
- 外部 URL 只能通过系统浏览器打开 HTTPS；
- 路径选择、备份与恢复必须验证 IPC 来源和参数。

## 文档与截图

- 截图只使用无 Key Demo 数据；
- 不显示操作系统账户名、绝对用户路径、真实项目或 Provider Key；
- 实机截图和概念视觉必须明确区分；
- 图片扩展名必须与实际 MIME 一致；
- 新素材记录到[素材与第三方许可](docs/assets-and-licenses.md)；
- Markdown 使用相对链接，保证分支和合并后的默认分支都可渲染。

## 提交前自检

~~~bash
git diff --check
node scripts/security-check.mjs
npm run quality
git status --short
~~~

逐项确认：

- [ ] 没有真实凭证、数据库、日志、上传素材或签名文件；
- [ ] 新行为有自动化测试；
- [ ] Demo Mode 仍能无 Key 完成；
- [ ] 错误信息可诊断且已脱敏；
- [ ] 文档和截图与当前行为一致；
- [ ] 没有无关格式化或用户工作区修改。

安全漏洞不要提交公开 Issue，请按 [SECURITY.md](SECURITY.md) 私下报告。
