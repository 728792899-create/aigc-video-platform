# 素材与第三方许可

## 产品标识

当前产品名“AIGC 视频工作台”是描述性名称。`resources/icon.png`、`icon.icns`、`icon.ico` 是本次审查期间使用 OpenAI ImageGen 生成的原创帧/播放/时间线图形，不含文字、角色或既有品牌标识。旧版名称和犬类形象不作为当前发行标识；历史 CHANGELOG 仅作为版本记录，不应复用于商店页、安装包、截图或宣传物。

## 字体

客户端内嵌 Inter 字体，来源为 [The Inter Project](https://github.com/rsms/inter)，使用 SIL Open Font License 1.1。发行包必须保留 `client/src/assets/fonts/LICENSE.txt`。不要修改字体后继续使用 Reserved Font Name。

## 图片、音乐与视频

- 仓库截图只能使用 Demo 数据和无个人信息的本地占位素材；
- 不随包分发示例音乐。用户导入的 BGM、字体、图片和视频由用户负责授权；
- AI Provider 输出受对应服务条款约束，产品不自动授予商用权；
- ImageGen 生成的原创应用图标和本地 FFmpeg 生成的 Demo 占位画面只用于产品界面/演示，不冒充真实 Provider 输出；
- Vite/Vue starter 资产没有被运行时代码引用，不进入生产构建。

## 依赖

Node/Electron 依赖的许可证以各包内 LICENSE 为准。发布前用 SBOM/依赖许可证扫描复核；FFmpeg 的实际许可取决于所分发构建启用的编解码器，商业发行前必须由发布者确认 LGPL/GPL 合规方案。
