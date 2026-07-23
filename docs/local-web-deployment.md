# 本地 Web 与 Docker 部署指南

AIGC 导演工作室的首选交付形态是“一体化本地 Web 服务”：Studio 生产静态资源由同一个 Express 服务提供，用户启动服务后直接在默认浏览器使用产品。无需单独部署前端、启动 Electron、注册账号或连接云端数据库。

## 选择启动方式

| 方式 | 命令 | 运行方式 | 数据位置 | 适用场景 |
| --- | --- | --- | --- | --- |
| 本机服务 | `pnpm start` | 前台运行，自动打开浏览器 | 操作系统应用数据目录 | 普通本机使用、开发预览 |
| Docker | `pnpm start:docker` | 后台容器，自动打开浏览器 | `director-data` 命名卷 | 隔离部署、长期运行 |
| 开发模式 | `pnpm dev` | Vite 与 Server 开发进程 | 开发数据目录 | 仅源码开发 |
| Electron | `pnpm electron:dev` | 可选桌面壳 | 隔离 userData | 桌面安全与兼容验证，不是首选交付 |

## 本机一键启动

要求 Node.js 22.20+（推荐 24）、pnpm 11、`ffmpeg` 与 `ffprobe`：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start
```

启动器会依次完成生产构建、FFmpeg 检查、一次性本机会话生成、服务健康启动和浏览器打开。默认地址为 `http://127.0.0.1:33100/studio`，实际浏览器会先经过一次性 bootstrap 路径写入 HttpOnly 会话 Cookie，再进入项目中心。

终端必须保持运行；按 `Ctrl+C` 会把关闭信号传递给 Server 并安全退出。若系统无法调用默认浏览器，服务会保持运行并显示不含 bootstrap token 的脱敏地址；修复默认浏览器设置后重启即可重新建立一次性会话。

端口被占用时可显式指定其他端口：

```bash
AIGC_DIRECTOR_PORT=33101 pnpm start
```

PowerShell：

```powershell
$env:AIGC_DIRECTOR_PORT = "33101"
pnpm start
```

## Docker 一键部署

要求 Docker Engine 和 Compose v2：

```bash
pnpm start:docker
pnpm docker:logs
pnpm stop:docker
```

`pnpm start:docker` 会生成权限为 `0600` 的本地运行配置、构建镜像、启动容器、等待 `/api/v2/health` 通过，再打开 `http://127.0.0.1:33100`。容器停止后数据卷默认保留。

如需改变宿主端口：

```bash
AIGC_DIRECTOR_PUBLIC_PORT=33101 pnpm start:docker
```

Compose 默认只绑定宿主回环地址，不向局域网或公网暴露。容器以非 root 用户运行，根文件系统只读，Linux capabilities 全部移除，Provider 凭据只读挂载到 `/run/secrets`。

## Demo 与真实 Provider

首次启动固定使用安全默认值：

```text
DEMO_MODE=1
PROVIDER_NETWORK_DISABLED=1
```

用户可直接打开零 Key Demo 完成创作、重试、恢复和导出。真实 Provider 必须在工作台中显式创建连接、保存系统凭证、测试连接、设置路由与用户自付预算；测试和 CI 不会读取真实 Key。

## 数据和备份

- 本机服务：macOS 使用 Application Support，Windows 使用 Local AppData，Linux 使用 XDG data 目录。
- Docker：项目数据库和媒体保存在 `director-data` 命名卷；`.local/docker` 只保存被 Git 忽略的运行配置与 Docker Secret 源文件。
- `.aigcproj` 用于项目级迁移；Provider secret、日志、本机绝对路径和临时任务响应不会进入项目包。
- 删除容器不等于删除数据卷；只有用户明确执行卷删除操作才会移除 Docker 持久数据。

## 远程服务器说明

当前 Local v1 的安全默认值是仅绑定 `127.0.0.1`。在远程 Linux 主机执行启动命令时，自动打开浏览器可能不可用，启动器会保留服务并输出访问提示。不要直接把端口暴露到公网；远程访问应由用户自行配置 HTTPS 反向代理、访问控制、备份和防火墙，本轮不把公网多用户部署标记为已支持。
