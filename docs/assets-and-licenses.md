# 素材与第三方许可

这份清单是发布资产的来源账本。新增图片、字体、音乐或示例视频时，必须在合并前补充“来源、用途、采集/生成方式和授权状态”；来源不明的素材不得进入安装包、商店页或公开演示。

## 产品名称与标识

“AIGC 视频工作台”是当前描述性产品名，不代表已完成商标注册或全球名称冲突检索。公开商用前仍需在目标发行地区进行商标、应用商店和域名检索。

| 文件 | 来源 | 用途 | 生成/处理方式 | 授权状态 |
| --- | --- | --- | --- | --- |
| `resources/icon.png` | 本项目原创 | 应用图标源图 | 内置 OpenAI ImageGen 生成的帧/播放/时间线抽象图形，无文字、角色或第三方 Logo | 可用于本仓库与产品发布 |
| `resources/icon.icns` | `icon.png` 派生 | macOS 包图标 | 本地格式转换 | 同源可用 |
| `resources/icon.ico` | `icon.png` 派生 | Windows 包图标 | 本地格式转换 | 同源可用 |
| `docs/images/product-hero.jpg` | 本项目原创 | README 产品主视觉 | 内置 OpenAI ImageGen 生成并本地压缩；无人像、文字、角色和品牌 | 可用于本仓库说明与宣传 |
| `docs/images/workflow-recovery-concept.jpg` | 本项目原创 | 检查点/恢复概念视觉 | 内置 OpenAI ImageGen 生成并二次编辑，1600×900 JPEG；无文字、Logo 或伪产品 UI | 可用于本仓库说明与宣传 |

恢复概念图的生成意图是：宽幅 16:9、八个模块化视频阶段围绕中心时间线/检查点数据库、失败后回环并继续到最终成片、深蓝/青色/紫色、无人物、无文字、无 Logo、无水印。它必须标注为“概念视觉”，不能表述为真实产品截图。

## Web 实机截图

以下截图均来自本仓库、隔离临时数据库和无 Key Demo Mode，通过内置 Browser 实机采集。页面只使用项目生成的 Demo 文案与本地占位素材；截图不包含真实凭证、私人项目、上传文件或账户路径。除特别注明外均为 1280×720 JPEG。

| 文件 | 用途 | 采集方式 | 授权状态 |
| --- | --- | --- | --- |
| `docs/screenshots/dashboard-overview.jpg` | 工作台首页 | Browser，隔离 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/projects-overview.jpg` | 项目管理 | Browser，隔离 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/script-storyboard.jpg` | 脚本与分镜 | Browser，隔离 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/image-workbench.jpg` | 图片工作区 | Browser，隔离 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/audio-subtitle.jpg` | 配音与字幕 | Browser，隔离 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/preview-timeline.jpg` | 预览、时间线与导出设置 | Browser 重新采集，临时目录 | 项目自有 UI，可公开 |
| `docs/screenshots/provider-settings.jpg` | Provider 路由与凭证状态 | Browser，所有 Key 为空 | 项目自有 UI，可公开 |
| `docs/screenshots/history-jobs.jpg` | 历史任务与尝试链 | Browser，隔离 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/files-manager.jpg` | 文件分类与引用 | Browser，隔离 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/library-exports.jpg` | 成片库 | Browser，本地 Demo MP4 | 项目自有 UI，可公开 |
| `docs/screenshots/skills-library.jpg` | 创作技能库 | Browser，内置技能数据 | 项目自有 UI，可公开 |
| `docs/screenshots/trash-restore.jpg` | 回收站与恢复 | Browser，受控软删除 Demo 项目 | 项目自有 UI，可公开 |
| `docs/screenshots/settings-backup.jpg` | 备份恢复设置 | Browser，临时目录 | 项目自有 UI，可公开 |
| `docs/screenshots/export-settings.jpg` | 导出设置 | Browser，临时目录 | 项目自有 UI，可公开 |
| `docs/screenshots/task-running.jpg` | 八阶段运行中任务 | Browser，本地延迟 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/task-retry.jpg` | 导出失败诊断与阶段重试 | Browser，`DEMO_INJECTED_FAILURE` | 项目自有 UI，可公开 |
| `docs/screenshots/empty-repair.jpg` | 空状态和修复入口 | Browser，隔离 Demo | 项目自有 UI，可公开 |
| `docs/screenshots/03-generated-storyboard.jpg` | README 旧版编号兼容图 | Browser 重新采集，替换含本机路径的旧图 | 项目自有 UI，可公开 |

以下是历史验收图，保留用于版本对照，不作为主文档截图：

| 文件 | 来源/用途 | 状态 |
| --- | --- | --- |
| `docs/screenshots/01-workbench.jpg` | 早期无 Key Demo 工作台 | 可公开，历史归档 |
| `docs/screenshots/02-script-workbench.jpg` | 旧文件名兼容，内容已替换为隔离脚本/分镜工作区 | 可公开，历史归档 |
| `docs/screenshots/04-image-workbench.jpg` | 旧文件名兼容，内容已替换为隔离图片工作区 | 可公开，历史归档 |
| `docs/screenshots/web-workbench-acceptance.png` | 旧文件名兼容，内容已替换为隔离 Web Demo 导出设置 | 已移除旧本机路径并修正为真实 PNG MIME；可公开，历史归档 |

## Electron 实机截图

三张主图通过 Computer Use 在独立 `--user-data-dir`、临时数据库、空 Provider Key 和 Demo Mode 中采集。目录选择器先进入空的 `/tmp/aigc-docs-export`，再隐藏侧边栏，避免暴露用户名和私人文件。三张图均为 1280×720 JPEG。

| 文件 | 用途 | 采集方式 | 授权状态 |
| --- | --- | --- | --- |
| `docs/screenshots/electron-startup.jpg` | 桌面启动与空工作台 | Computer Use，隔离 Electron Demo | 项目自有 UI，可公开 |
| `docs/screenshots/electron-folder-picker.jpg` | macOS 原生目录选择 | Computer Use，空临时目录、隐藏侧边栏 | 系统标准控件 + 项目调用场景，可用于产品说明 |
| `docs/screenshots/electron-export-success.jpg` | 预览、成片库和自定义目录导出成功 | Computer Use，本地 FFmpeg 与临时目录 | 项目自有 UI，可公开 |
| `docs/screenshots/electron-desktop-acceptance.png` | 旧文件名兼容，内容已替换为隔离桌面导出成功状态 | 已移除旧路径并修正为真实 PNG MIME | 可公开，历史归档 |

## 字体和模板资产

| 文件/组件 | 来源 | 许可与发布要求 |
| --- | --- | --- |
| `client/src/assets/fonts/Inter-*.ttf` | [The Inter Project](https://github.com/rsms/inter) | SIL Open Font License 1.1；发行包保留 `client/src/assets/fonts/LICENSE.txt`，不得违反 Reserved Font Name 条款 |
| `client/src/assets/vite.svg` | Vite starter | 上游项目标识；当前仅被未使用的 `HelloWorld.vue` 引用，不进入实际页面。不得作为产品品牌 |
| `client/src/assets/vue.svg` | Vue starter | Vue 商标/品牌资产；当前仅被未使用的 `HelloWorld.vue` 引用，不得作为产品品牌 |
| `client/src/assets/hero.png` | 旧 starter 示例，原始来源未充分记录 | 当前仅被未使用的 `HelloWorld.vue` 引用；授权状态待确认，禁止重新接入运行时或宣传材料，启用前必须替换为已登记原创资产 |

## 音乐、视频与 Provider 输出

- 仓库和安装包不分发示例音乐；用户导入的 BGM、字体、图片和视频由用户负责获得授权。
- Demo 画面由本地占位渲染器生成，Demo 音轨为本地静音/占位音轨，Demo 导出由 FFmpeg 在本机完成，不冒充云端模型输出。
- AI Provider 输出是否允许商用、是否需要标注及保存期限由对应服务条款决定；本项目不会自动授予用户超出 Provider 条款的权利。
- 截图中的 Demo 文案、项目名和占位素材是为本项目生成的虚构数据，不代表真实客户、人物或商业案例。

## 依赖与 FFmpeg

Node/Electron 依赖的许可证以各包内 LICENSE 为准。发布前必须生成或复核 SBOM，并运行依赖许可证扫描。`ffmpeg-static` 所含 FFmpeg 构建的义务取决于启用的编解码器和实际分发方式；商业发行前由发布者确认 LGPL/GPL、源码提供和 notice 要求。

## 新增素材检查清单

- [ ] 文件名、MIME、扩展名、像素尺寸和体积一致；
- [ ] 记录来源、作者/工具、用途、日期和授权状态；
- [ ] 截图只使用隔离 Demo 数据并检查路径、通知、侧边栏和最近文件；
- [ ] 不包含 API Key、用户目录、上传素材、日志、数据库或私人项目；
- [ ] AI 生成概念图明确标注，不伪造成真实界面或真实案例；
- [ ] 第三方 Logo、字体、音乐、人物和商标均有可验证许可；
- [ ] 发布包中的 LICENSE、NOTICE、字体许可和依赖清单已同步更新。
