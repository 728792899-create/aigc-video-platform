@echo off
REM ============================================================
REM  AIGC 短视频平台 - 一键启动脚本 (Windows)
REM  自动：启动自检 -> 后端(PM2) -> 前端(Vite)
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ======== [1/3] 启动自检 ========
cd server
call node scripts\preflight.js
if errorlevel 1 (
  echo.
  echo [!] 自检发现错误项，已中止启动。请按上面提示解决后重试。
  cd ..
  pause
  exit /b 1
)

echo.
echo ======== [2/3] 启动后端 (PM2) ========
where pm2 >nul 2>nul
if %errorlevel%==0 (
  call pm2 start ecosystem.config.js
  call pm2 save >nul 2>nul
  echo [OK] 后端已由 PM2 守护启动 ^(端口 3000^)。查看日志: pm2 logs aigc-backend
) else (
  echo [!] 未检测到 PM2，改用新窗口直接运行后端 ^(npm start^)。
  start "AIGC 后端" cmd /k "npm start"
)
cd ..

echo.
echo ======== [3/3] 启动前端 (Vite) ========
cd client
start "AIGC 前端" cmd /k "npm run dev"
cd ..

echo.
echo ============================================================
echo  全部启动完成！
echo    后端:  http://localhost:3000
echo    前端:  http://localhost:5173   ^(浏览器打开这个^)
echo ============================================================
echo.
pause
endlocal
