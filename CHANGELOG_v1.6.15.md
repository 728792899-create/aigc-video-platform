# v1.6.15 「创作技能库 - 必用自动 + 可选按需」更新日志

**发布时间**: 2026-06-05  
**安装包**: `史努比大王 Setup 1.6.15.exe`（106MB）  
**核心目标**: 把短视频创作技能集成进平台自带的创作技能库，实现「必须技能自动调用增强 + 非必须技能用户按需勾选」

---

## 📊 原状态 vs 修正后对比表

### 1. 数据库 schema

| 项目 | 原状态 | 修正后 | 说明 |
|------|--------|--------|------|
| skills 表列数 | 7 列 | **9 列** | 新增 auto_apply / source |
| auto_apply 列 | ❌ 不存在 | ✅ INTEGER DEFAULT 0 | 1=必用技能自动应用 |
| source 列 | ❌ 不存在 | ✅ TEXT DEFAULT 'custom' | builtin/skillhub/custom 来源标记 |
| 迁移方式 | - | ALTER TABLE 加列 | 老用户 DB 自动平滑升级 |

### 2. 内置技能

| 项目 | 原状态 | 修正后 | 说明 |
|------|--------|--------|------|
| 内置技能数量 | 6 个 | **16 个** | script 8个 / image 6个 / voice 2个 |
| 技能来源模块 | 路由文件内联 | 独立模块 `services/builtinSkills.js` | 8554 字节，便于维护 |
| 必用技能机制 | ❌ 不存在 | ✅ 4 个 auto_apply=1 | 黄金3秒钩子/完播率节奏/电影级运镜/画风统一锁定 |
| 技能分类 | stage 字段存在但功能单一 | stage 完整利用 + auto_apply 双维度 | script/image/voice + 必用/可选 |

**原 6 个内置技能**（旧版，功能单一）：
- 爆款标题钩子
- 电影级运镜
- 口语化改写
- 情绪感染力
- SEO关键词植入
- 高级感配色

**新 16 个内置技能**（v1.6.15）：

| stage | 技能名 | auto_apply | 说明 |
|-------|--------|-----------|------|
| script | 🎣 黄金3秒钩子 | ✅ 1 | 反问/悬念/冲突开场 |
| script | ⚡ 完播率节奏 | ✅ 1 | 节奏控制、转折埋点 |
| script | 爆款标题钩子 | ❌ 0 | 数字/对比/悬念标题 |
| script | 口语化改写 | ❌ 0 | 去书面化、加口语 |
| script | 情绪感染力 | ❌ 0 | 情绪词、细节、共鸣 |
| script | SEO关键词植入 | ❌ 0 | 平台算法关键词融入 |
| script | 平台违禁词规避 | ❌ 0 | 敏感词同义替换 |
| script | 反转结构 | ❌ 0 | 预期打破、情绪张力 |
| image | 🎬 电影级运镜 | ✅ 1 | cinematic composition |
| image | 🎨 画风统一锁定 | ✅ 1 | consistent art style |
| image | 高级感配色 | ❌ 0 | 高级灰、莫兰迪 |
| image | 竖屏构图优化 | ❌ 0 | 9:16 构图、主体居中偏上 |
| image | 高清写实质感 | ❌ 0 | photorealistic, 8K |
| image | 吸睛封面构图 | ❌ 0 | 视觉冲击力 |
| voice | 口播节奏感 | ❌ 0 | 停顿、重音、语速标记 |
| voice | 情绪化配音脚本 | ❌ 0 | cheerful/sad 情绪标签 |

### 3. 后端接口

| 接口 | 原状态 | 修正后 | 说明 |
|------|--------|--------|------|
| `POST /api/ai/generate-script` | 接受 skill_id 单选 | ✅ 接受 skill_ids 数组（兼容旧 skill_id） | 多技能叠加 |
| | 返回 script/storyboards | ✅ 返回 + `_skills:{auto:N, manual:M}` | 前端核对技能计数 |
| | ❌ 不自动应用必用技能 | ✅ 自动注入 auto_apply=1 技能 | 用户不勾选也生效 |
| `POST /api/ai/expand-dialog` | 同上 | 同上 | 对白扩写也支持技能 |
| `POST /api/ai/generate-image` | 同上 | 同上 | 配图支持技能 |
| `GET /api/skills/active?stage=xxx` | ❌ 不存在 | ✅ 新增接口 | 返回当前生效必用技能清单 |
| `POST /api/skills` | 创建技能 | ✅ 支持 auto_apply 字段 | 用户自建技能也可标必用 |
| `PUT /api/skills/:id` | 可改所有字段 | ✅ 内置技能仅允许改 enabled/auto_apply | 保护内置技能核心内容 |

### 4. 自动生产流水线（关键修复）

| 阶段 | 原状态 | 修正后 | 说明 |
|------|--------|--------|------|
| 脚本生成 | ❌ 不接技能 | ✅ getEffectiveSkillPrompt('script', opts.scriptSkillIds) 注入 | 必用+手动合并 |
| 配图生成 | ❌ 不接技能 | ✅ getEffectiveSkillPrompt('image', opts.imageSkillIds) 注入 | 叠加到每镜 prompt |
| 进度提示 | 无技能提示 | ✅ "已自动应用N个必用文案技能" | 用户感知透明 |

**影响**: 之前用自动生产（"一键生成"）完全不享受技能增强，现已修复。

### 5. 前端 UI

#### Skills 管理页（`/skills`）

| 元素 | 原状态 | 修正后 | 说明 |
|------|--------|--------|------|
| 技能卡片头部 | 仅显示名称 | ✅ 必用技能加"必用"红标签 | el-tag type="danger" |
| 技能卡片底部 | 单个"启用"开关 | ✅ 双开关（启用+必用） | 独立控制 auto_apply |
| 编辑对话框 | 无 auto_apply 选项 | ✅ 加"标记为必用技能"开关 | el-switch |
| 必用开关逻辑 | - | ✅ 启用关闭时必用开关灰显 | 逻辑约束 |

#### Script 文案创作页（`/script`）

| 元素 | 原状态 | 修正后 | 说明 |
|------|--------|--------|------|
| 创作技能选择器 | 单选下拉（skill_id） | ✅ 多选下拉（skill_ids，collapse-tags） | 可叠加多个技能 |
| 必用技能提示 | ❌ 不存在 | ✅ "⚡ 已自动应用的必用技能"提示条 | 黄色 chip + "?" 帮助图标 |
| 下拉列表内容 | 所有技能 | ✅ 过滤掉 auto_apply=1 的技能 | 避免重复勾选 |
| 提交字段 | skill_id 单值 | ✅ skill_ids 数组 | 向后兼容 |

#### Images 画面生成页（`/images`）

| 元素 | 原状态 | 修正后 | 说明 |
|------|--------|--------|------|
| 同 Script 页改动 | 单选 skill_id | ✅ 多选 skill_ids + 必用提示条 | 画面技能独立管理 |
| Prompt 文本框 | 用户手写 | ✅ 自动注入必用技能 prompt | 可见"cinematic composition..." |

### 6. 国际化 i18n

| 模块 | 原状态 | 修正后 | 说明 |
|------|--------|--------|------|
| `locales/modules/skills.js` | 7 个 key | ✅ 14 个 key | +7: autoApply/autoTag/source* 等 |
| `locales/modules/script.js` | 无技能相关 | ✅ +2: autoSkillsLabel/autoSkillsHint | 提示条文案 |

---

## 🔧 核心实现细节

### 后端新增函数（`routes/skills.js`）

```javascript
// 三个核心函数，module.exports 已导出
getSkillPromptsByIds(ids)              // 多选去重保序取 prompt
getAutoSkillPrompts(stage)             // 取该 stage 所有必用技能 prompt
getEffectiveSkillPrompt(stage, manualIds) // 必用+手动合并去重，返回 {text, autoCount, manualCount}
```

### 注入接入点

1. **DeepSeek 文案生成** (`services/deepseek.js`)
   - `buildSystemPrompt(style, detailLevel, skillPrompt)` 拼成 `【创作技能增强】` block

2. **AI 接口三大入口** (`routes/ai.js`)
   - generate-script / expand-dialog / generate-image
   - 支持 skill_ids 数组，调 getEffectiveSkillPrompt 注入
   - 返回 `_skills:{auto, manual}` 供前端核对

3. **自动生产流水线** (`services/pipeline.js`)
   - 脚本阶段：getEffectiveSkillPrompt('script', opts.scriptSkillIds)
   - 配图阶段：getEffectiveSkillPrompt('image', opts.imageSkillIds)

---

## ✅ 验证结果

### 语法检查
```bash
node --check skills.js ai.js pipeline.js builtinSkills.js db/index.js  # ALL OK
cd client && npm run build  # ✓ built in 448ms
```

### 接口实测（隔离沙箱后端）
- ✅ 16 技能自动灌库，auto_apply 标记正确
- ✅ `/api/skills/active?stage=script` 返回 2 个文案必用（黄金3秒钩子/完播率节奏）
- ✅ `/api/skills/active?stage=image` 返回 2 个画面必用（电影级运镜/画风统一锁定）
- ✅ generate-script（无 skill_ids）返回 `_skills:{auto:2, manual:0}`
- ✅ generate-script（带 skill_ids=[5,8]）返回 `_skills:{auto:2, manual:2}`
- ✅ generate-script（skill_ids=[1黄金3秒,5爆款]）返回 `_skills:{auto:2, manual:1}`（去重正确）
- ✅ generate-image 实际 prompt 含 `cinematic composition...` + `consistent art style...`

### 浏览器端到端（http://localhost:5173/）
- ✅ Skills 管理页：16 技能全渲染，4 个带"必用"红标签，双开关真实可用
- ✅ 点击"必用"开关 → vite 代理 → PUT /skills/:id → DB 持久化全链路打通
- ✅ Script 页：必用提示条显示 2 个文案技能，多选下拉 6 个可选（排除必用）
- ✅ Images 页：必用提示条显示 2 个画面技能，Prompt 文本框可见注入效果

---

## ⚠️ 重要坑位记录

### 1. CORS 白名单
**现象**: 测试用 5174 端口时前端 fetch 被 403 拒绝（后端白名单只有 5173/4173）  
**解法**: 测试 dev server 必须用 5173 端口。生产 Electron 同源托管无此问题。

### 2. 打包配置
**问题**: root `package.json` 被精简掉 scripts/build 块（10 行）  
**解法**: 从 `_backup_20260531_165706_encrypt/package.json` 恢复（67 行）并适配字节码流程  
**关键**: `build.extraResources from: dist-server-jsc, to: server`（不是原始 server 目录）

### 3. 路由注册顺序
`GET /api/skills/active` 必须在 `GET /:id` **之前**注册，否则被 /:id 捕获成 404。

---

## 🎯 用户使用指南

### 如何使用必用技能？
1. 打开「创作技能」页（左侧菜单）
2. 看到带「必用」红标签的技能（默认 4 个）
3. 这些技能会**自动应用到所有创作**，无需手动勾选
4. 可以点击卡片底部的「必用」开关临时关闭（不推荐）

### 如何使用可选技能？
1. 进入「文案创作」或「画面生成」页
2. 顶部看到「⚡ 已自动应用的必用技能」提示条（黄色 chip）
3. 下方「创作技能」下拉框选择额外的可选技能（可多选）
4. 生成时，必用技能 + 手动勾选技能会一起生效

### 如何自建技能？
1. 打开「创作技能」页，点击右上角「创建技能」
2. 填写名称、描述、选择 stage（文案/画面/配音）
3. 填写 prompt（技能增强指令）
4. 可选：勾选「标记为必用技能」（自建必用技能会自动应用）

### 如何查看技能是否真的生效？
1. **文案创作**：生成脚本后，看开头是否有反问/悬念（黄金3秒钩子效果）
2. **画面生成**：点击分镜，查看 Prompt 文本框，看是否包含 `cinematic composition` / `consistent art style` 等技能 prompt
3. **接口返回**：浏览器控制台查看 API 响应，`_skills:{auto:N, manual:M}` 显示实际应用的技能数

---

## 📝 技术要点

### 向后兼容
- 旧 DB 自动平滑升级（ALTER TABLE 加列）
- 旧接口 skill_id 单选仍可用（与 skill_ids 互斥兼容）
- 旧技能数据（无 auto_apply/source 列）迁移时补默认值

### 技能本质
- **prompt 注入式增强**：把技能的 prompt 文本拼进 AI 调用的 system/user prompt
- 多技能用换行拼接，去重保序
- 不改变 AI 调用参数（model/temperature 等），纯 prompt 层增强

### 性能影响
- DB 查询增加 2 次（listActiveSkills 前端 mount 时调用）
- prompt 长度增加约 100-500 字符/技能（AI 调用 token 小幅增加）
- 前端 bundle 增加约 5KB（Skills/Script/Images 组件扩展）

---

## 🔄 升级指南

### 从 v1.6.14 升级到 v1.6.15
1. **备份数据**（重要）：
   - 复制 `%APPDATA%/snoopy-king/db/` 目录
   - 复制 `%APPDATA%/snoopy-king/uploads/` 目录

2. **安装新版本**：
   - 运行 `史努比大王 Setup 1.6.15.exe`
   - 选择覆盖安装（或卸载旧版后重装）

3. **首次启动**：
   - DB 自动迁移（加 auto_apply/source 列）
   - 16 个内置技能自动灌库
   - 旧自建技能自动补 auto_apply=0 / source='custom'

4. **验证**：
   - 打开「创作技能」页，看到 16 个技能
   - 4 个带「必用」红标签
   - 进入「文案创作」，看到顶部黄色提示条（已自动应用 2 个必用技能）

### 注意事项
- ✅ 数据向后兼容，老项目/分镜/素材无损
- ✅ 老用户自建技能保留（auto_apply 默认 0）
- ⚠️ 如需回滚到 v1.6.14，需手动恢复备份 DB（新版 DB 有额外列，旧版读不了）

---

## 📦 产物清单

- `史努比大王 Setup 1.6.15.exe`（106MB，2026-06-05 09:36）
- `dist-electron/win-unpacked/`（解压版，约 300MB）
- 源码改动：13 个文件（DB schema / 后端 4 文件 / 前端 6 文件 / i18n 2 文件）

---

**完成时间**: 2026-06-05  
**开发者**: 王从天降  
**毕业设计**: AIGC 辅助的短视频创意生成与制作平台（完颜瑞辰，郑州轻工业大学，数字媒体技术 24-01）
