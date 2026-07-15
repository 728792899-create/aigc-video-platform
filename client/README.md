# AIGC 视频工作台前端

Vue 3 + Vite 客户端，为浏览器 Demo 和 Electron renderer 提供同一套创作工作台。

## 开发

从仓库根目录安装依赖：

~~~bash
npm ci
npm --prefix server ci
npm --prefix client ci
~~~

推荐直接启动无 Key Demo：

~~~bash
npm run demo
~~~

也可以分别启动服务端和客户端：

~~~bash
npm --prefix server start
npm --prefix client run dev
~~~

开发服务器将 `/api` 和 `/uploads` 代理到本地后端。不要把 Provider Key 写进 `client/.env`、前端常量或浏览器存储。

## 测试与构建

~~~bash
npm --prefix client test
npm --prefix client run build
~~~

完整仓库门禁使用：

~~~bash
npm run quality
~~~

## 页面结构

| 路由 | 作用 |
| --- | --- |
| `/` | 创作工作台 |
| `/projects` | 项目管理 |
| `/projects/:id/script` | 脚本和分镜 |
| `/projects/:id/images` | 图片候选和批任务 |
| `/projects/:id/audio` | 配音与字幕 |
| `/projects/:id/preview` | 时间线、预览与导出 |
| `/history` | 任务历史 |
| `/files` | 文件和存储管理 |
| `/library` | 成片库 |
| `/skills` | 创作技能 |
| `/trash` | 回收站和操作记录 |
| `/settings` | Provider、存储、备份与诊断 |

页面容器负责数据编排，复用组件承载步骤导航、任务浮层、分镜编辑、时间线和导出状态。新增长任务必须接入统一 task store，不要把轮询状态只保存在单个页面。

完整产品、API 和贡献说明见根目录 [README](../README.md)、[创作者手册](../docs/user-guide.md)与[参与贡献](../CONTRIBUTING.md)。
