#!/usr/bin/env bash
# ============================================================
#  史努比大王 - 安全打包流水线（一键加密打包）
#  顺序：前端构建 → 前端混淆 → 后端字节码编译 → electron-builder 打包
#  关键：后端字节码必须用 Electron 内置 node v20 编译（jsc 版本绑定）
# ============================================================
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
unset PORT
export NODE_ENV=development   # 确保 vite/electron-builder devDeps 可用

echo "==> [1/4] 前端构建"
( cd client && npm run build )

echo "==> [2/4] 前端混淆（business chunks）"
node scripts/obfuscate.js

echo "==> [3/4] 后端字节码编译（Electron node v20）"
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/compile-backend.js

echo "==> [4/5] electron-builder 打包 NSIS"
# 直接调 electron-builder，跳过 package.json 里 dist 脚本的 build:secure（已手动完成上面步骤）
# 透传参数（如 --dir 仅打 win-unpacked 不生成安装包）
./node_modules/.bin/electron-builder "$@"

echo "==> [5/5] 代码签名（自签名证书，可选）"
# 仅当证书存在且本次生成了安装包(.exe)时才签名；--dir 模式无安装包则跳过
PFX="build/codesign/snoopy-codesign.pfx"
if [ -f "$PFX" ]; then
  LATEST_EXE="$(ls -t dist-electron/*Setup*.exe 2>/dev/null | head -1)"
  if [ -n "$LATEST_EXE" ]; then
    echo "    签名: $LATEST_EXE"
    powershell.exe -NoProfile -ExecutionPolicy Bypass \
      -File "scripts\\sign-app.ps1" -Action sign -File "$LATEST_EXE" || \
      echo "    [warn] 签名失败（自签名 UnknownError 属预期，不阻断构建）"
  else
    echo "    跳过（未生成安装包，可能是 --dir 模式）"
  fi
else
  echo "    跳过（未找到证书，先运行: powershell -File scripts/sign-app.ps1 -Action gencert）"
fi

echo "==> 完成。产物在 dist-electron/"
ls -la dist-electron/*.exe 2>/dev/null | tail -3
