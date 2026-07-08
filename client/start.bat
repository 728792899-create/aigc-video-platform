@echo off
title AIGC-Frontend
cd /d "%~dp0"
:loop
echo [%date% %time%] Starting Vite dev server...
call npm run dev
echo [%date% %time%] Frontend crashed! Restarting in 2 seconds...
timeout /t 2 /nobreak >nul
goto loop
