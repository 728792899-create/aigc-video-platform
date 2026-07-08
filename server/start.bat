@echo off
title AIGC-Backend
cd /d "%~dp0"
:loop
echo [%date% %time%] Starting server...
node app.js
echo [%date% %time%] Server crashed! Restarting in 2 seconds...
timeout /t 2 /nobreak >nul
goto loop
