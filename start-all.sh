#!/usr/bin/env bash
# ============================================================
#  AIGC 短视频平台 - 一键启动脚本 (macOS / Linux / Git Bash)
#  自动：启动自检 -> 后端(PM2) -> 前端(Vite)
# ============================================================
set -u
cd "$(dirname "$0")"

echo
echo "======== [1/3] 启动自检 ========"
( cd server && node scripts/preflight.js )
if [ $? -ne 0 ]; then
  echo
  echo "[!] 自检发现错误项，已中止启动。请按上面提示解决后重试。"
  exit 1
fi

echo
echo "======== [2/3] 启动后端 (PM2) ========"
if command -v pm2 >/dev/null 2>&1; then
  ( cd server && pm2 start ecosystem.config.js && pm2 save >/dev/null 2>&1 )
  echo "[OK] 后端已由 PM2 守护启动 (端口 3000)。查看日志: pm2 logs aigc-backend"
else
  echo "[!] 未检测到 PM2，改用后台 nohup 运行后端 (npm start)。日志: server/logs/manual.log"
  mkdir -p server/logs
  ( cd server && nohup npm start > logs/manual.log 2>&1 & )
  echo "[OK] 后端已后台启动 (端口 3000)。"
fi

echo
echo "======== [3/3] 启动前端 (Vite) ========"
echo "前端将在前台运行，按 Ctrl+C 可停止前端 (后端仍由 PM2/后台守护)。"
echo
echo "============================================================"
echo "  后端:  http://localhost:3000"
echo "  前端:  http://localhost:5173   (浏览器打开这个)"
echo "============================================================"
echo
( cd client && npm run dev )
