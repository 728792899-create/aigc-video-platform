# 史努比大王 v1.6.16 更新日志

**发布日期**: 2025-06-05  
**安装包**: `史努比大王 Setup 1.6.16.exe` (106 MB)  
**类型**: 软件质量提升（企业级规范自查修复）

---

## 🔧 修复内容

依据《企业级 AI 辅助全栈开发约束与规范 v2.0》进行自查，修复 3 项问题：

### P1-1：一键成片支持手动技能选择 ✅

**原状态**：一键成片（auto-produce）只能应用内置必用技能（🎣黄金3秒钩子 / ⚡完播率节奏等），用户手动勾选的技能无法透传，限制创意灵活性。

**修复后**：
- 一键成片对话框新增「文案技能」和「画面技能」两个多选框
- 必用技能自动生效（⚡ 图标提示），可选技能手动勾选
- 后端完整透传 `scriptSkillIds` / `imageSkillIds` 到生成流水线
- 失败重试自动继承技能选择（复用 `prev.meta.params`）

**改动文件**：
- `server/routes/ai.js` — auto-produce 解构+传递技能字段
- `server/services/validation.js` — autoProduce schema 补 `scriptSkillIds` / `imageSkillIds` 数组校验
- `client/src/views/Projects.vue` — 对话框加技能选择器 + `loadAutoSkills()` 函数

### P2-1：技能参数纳入 schema 校验 ✅

**原状态**：`/api/ai/generate-script` 和 `/api/ai/generate-image` 接口的 `skill_ids` 参数未被 Zod schema 校验，可传任意值/类型（格式错误 or 超量攻击绕过保护）。

**修复后**：
- `generateScript` / `generateImage` / `autoProduce` 三个 schema 全部加入 `skill_ids` / `scriptSkillIds` / `imageSkillIds` 校验
- 类型：`z.array(z.union([z.string(), z.number()]))` —— 兼容数值 ID + 字符串名
- 数量上限：20 个（`max(20, '技能选择数量过多（上限 20 个）')`）
- 非法请求响应示例：
  ```json
  {"code": 400, "message": "参数「skill_ids」：技能选择数量过多（上限 20 个）"}
  {"code": 400, "message": "参数「scriptSkillIds」：Invalid input: expected array, received string"}
  ```

**改动文件**：
- `server/services/validation.js` — 3 个 schema 补技能字段校验

### P2-2：LLM 调用加入重试/退避机制 ✅

**原状态**：`llmProvider.chat` 只有超时保护（AbortController 60s），无重试逻辑。中转站瞬时抖动/超时/5xx 直接失败，而图片生成有完整的 4 次指数退避重试 + 占位图兜底。违反约束文档「I/O 必须有超时+重试+退避+最大次数+错误分类」要求。

**修复后**：
- **重试策略**：最多 3 次（`MAX_RETRIES=3`），基础退避 1.5s，上限 10s
- **指数退避 + 抖动**：`delay = min((1500 * 2^(attempt-1)) * jitter, 10000)`，jitter ∈ [0.75, 1.25]，避免多任务并发重试形成请求尖峰
- **错误分类（智能重试）**：
  - **自动重试**：超时（AbortError）、网络故障（ECONNRESET/ETIMEDOUT）、5xx 服务端临时故障
  - **立即抛出，不重试**：4xx（认证失败/quota 耗尽/格式错误）—— 不浪费时间
- **透明封装**：内部重构为 `chatOnce()` + `chat()` 包装器，调用方（deepseek.js / expand-dialog / 一键成片等）无需改代码
- **日志**：每次重试会 `console.warn` 记录（便于排查中转站稳定性）

**验证**：
- 新增 `test/llm-retry.test.js`（4 个单元测试，mock fetch，无需网络）：
  - ✅ 5xx 瞬时错误：第 1 次 503 → 重试 1393ms → 第 2 次成功
  - ✅ 超时 AbortError：第 1 次超时 → 重试 1128ms → 第 2 次成功
  - ✅ 4xx 客户端错误：立即抛出，只调用 1 次（0.5ms）
  - ✅ 持续 5xx：重试 1→2→3 次（1305ms、2776ms 退避），最后抛出
- 回归测试：`node --test test/**/*.test.js` → **33/33 全过**（29 原有 + 4 新增）

**改动文件**：
- `server/services/providers/llmProvider.js` — 加重试常量 + `isRetryableError()` + `chatOnce()` + `chat()` 重试包装器
- `server/test/llm-retry.test.js` — **新增**：4 个重试行为单元测试

---

## ✅ 质量保证

### 测试覆盖
- **后端**：33 个测试全过（`node --test test/**/*.test.js`）
  - 29 个原有测试（smoke + security）
  - 4 个新增重试测试
- **前端**：构建成功（`npm run build`）
  - 1726 模块转换
  - vite v8.0.14 + rolldown
  - 无编译错误（vueuse `/* #__PURE__ */` 注解警告属无害）
- **集成验证**：
  - schema 校验：合法数组✅、超量拒绝✅、非数组拒绝✅
  - 重试行为：5xx 重试✅、超时重试✅、4xx 不重试✅、持续失败抛出✅

### 零破坏保证
- 所有修复均为**纯加法、零破坏**
- `npm run dev` 前后端正常运行
- 已有功能无回归（33/33 测试全过）
- 调用方无需改代码（透明升级）

---

## 📦 打包信息

- **构建流程**：`scripts/secure-build.sh`（前端构建 → 混淆 → 后端字节码编译 → NSIS 打包）
- **前端混淆**：19 个业务 chunk（跳过 element-plus / vue-core）
- **后端字节码**：50 个 .js → .jsc（bytenode + Electron node v20）
- **签名状态**：自签名证书（`UnknownError` 属预期，安装时 Windows Defender 会拦截，右键「仍要运行」即可）
- **安装包大小**：110,952,776 字节（106 MB）
- **产物位置**：`dist-electron/史努比大王 Setup 1.6.16.exe`

---

## 🔗 相关文档

- 企业级规范自查报告：见前序对话记录
- P1-1 + P2-1 修复报告：第 2250 项
- P2-2 修复报告：本次发布
- 测试日志：`/tmp/build-1.6.16.log`

---

## 🎓 学生信息

- **学生**：完颜瑞辰
- **学号**：522413590128
- **专业**：数字媒体技术 24-01
- **学校**：郑州轻工业大学
- **论文**：《AIGC 辅助的短视频创意生成与制作平台的设计与实现》
- **署名**：王从天降 / 王文通

---

## 📝 版本对比

| 版本 | 大小 | 发布日期 | 主要变更 |
|------|------|----------|----------|
| 1.6.15 | 106 MB | 2025-06-05 | 创作技能库集成（16 个内置技能） |
| **1.6.16** | **106 MB** | **2025-06-05** | **软件质量提升（P1-1/P2-1/P2-2 修复）** |

---

**安装提示**：
1. 双击 `史努比大王 Setup 1.6.16.exe`
2. 如遇 Windows Defender 拦截（自签名证书），点击「更多信息」→「仍要运行」
3. 建议卸载旧版本后重新安装（避免文件冲突）
4. 首次启动需配置 DeepSeek API Key（设置 → 文案服务）

**技术支持**：完颜瑞辰（王文通）
