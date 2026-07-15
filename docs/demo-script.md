# Demo Mode 演示脚本

目标时长约 7 分钟。演示前不配置任何真实 Provider Key，先用自动化验收证明导出、阶段重试和重启恢复都在隔离环境中工作。

## 演示前准备

~~~bash
env \
  OPENAI_API_KEY= \
  DEEPSEEK_API_KEY= \
  DASHSCOPE_API_KEY= \
  GEMINI_API_KEY= \
  RUNWAY_API_KEY= \
  KLING_API_KEY= \
  ARK_API_KEY= \
  VOLCANO_API_KEY= \
  npm run test:demo
~~~

确认输出包含：

- `Demo restart recovery passed`；
- `Demo stage retry passed`；
- 进程正常退出；
- 没有真实网络 Provider 调用。

然后启动：

~~~bash
npm run demo
~~~

## 0:00–0:45 工作台定位

![创作工作台](screenshots/dashboard-overview.jpg)

讲解：

- 这是本地优先的桌面创作工作台，不是多租户 SaaS；
- 左侧是全局导航，中间是当前创作上下文，右下角是跨页面任务；
- Demo Mode 没有 Key，成本标签为 0；
- 最终导出仍是真实 FFmpeg MP4。

## 0:45–2:00 从主题到分镜

从模板或新项目开始，输入：

> 用十秒解释可恢复的 AI 视频工作流

展示项目设置、脚本和分镜。强调每条分镜拥有稳定 id；修改一个镜头不会销毁其他镜头的图片和音频。

![脚本与分镜](screenshots/script-storyboard.jpg)

## 2:00–3:00 图片、配音与字幕

进入图片页，展示候选资产、选中状态和“只重试失败项”。再进入配音字幕页，说明无旁白镜头、音色、情感、字幕文本和样式。

| 图片 | 配音与字幕 |
| --- | --- |
| ![图片](screenshots/image-workbench.jpg) | ![配音与字幕](screenshots/audio-subtitle.jpg) |

讲解：

- 批任务允许部分成功；
- 成功项保留，失败项单独修复；
- 占位素材有明确标记，不冒充真实模型结果。

## 3:00–4:00 任务进度和失败修复

展开任务浮层：

![运行中任务](screenshots/task-running.jpg)

展示一次受控失败：

![失败与重试](screenshots/task-retry.jpg)

说明：

- 每个阶段有进度、尝试次数、输出和诊断；
- 取消在安全边界生效；
- “重试当前阶段”保留上游检查点；
- 服务重启后 recovery runner 会从数据库重建任务。

## 4:00–5:15 时间线和导出

![时间线](screenshots/preview-timeline.jpg)

打开导出设置：

![导出设置](screenshots/export-settings.jpg)

选择画幅、分辨率、格式、帧率和字幕方式。桌面演示时使用系统目录选择器，Web 演示可以保留默认成片库目录。

导出完成后确认：

- 预览可播放；
- 成片库出现记录；
- 字幕状态明确；
- 文件路径已隐藏操作系统账户名。

## 5:15–6:00 文件与恢复

快速展示文件管理、成片库和回收站：

| 文件管理 | 成片库 | 回收站 |
| --- | --- | --- |
| ![文件管理](screenshots/files-manager.jpg) | ![成片库](screenshots/library-exports.jpg) | ![回收站](screenshots/trash-restore.jpg) |

强调普通删除先进入回收站，彻底删除才不可恢复。

## 6:00–6:40 Provider 与安全

![Provider 路由](screenshots/provider-settings.jpg)

说明：

- 桌面密钥进入系统安全存储；
- 设置接口只返回掩码；
- 配置导出和备份不包含 Key；
- 日志和 Sentry 事件执行脱敏；
- Sentry 默认关闭。

## 6:40–7:00 发布状态

收尾说明：

- CI 覆盖测试、安全、FFmpeg、生产构建和桌面预检；
- unsigned/ad-hoc 包只能内部测试；
- Windows 公开发布仍需要受信任证书；
- macOS 公开发布仍需要 Developer ID、公证和 stapling；
- 人工门禁见 [Release Checklist](release-checklist.md)。

## 演示禁区

- 不在屏幕共享中打开真实 `.env`、`settings.json`、`credentials.vault` 或数据库；
- 不展示真实用户名绝对路径；
- 不输入或测试真实云端 Key；
- 不把占位画面称为某个云端模型输出；
- 不把未签名安装包称为正式发行版；
- 不为演示临时关闭 Electron 安全配置。
