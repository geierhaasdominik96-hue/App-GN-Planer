@echo off
setlocal
chcp 65001 >nul
title App Planner 2 Server
cd /d "%~dp0"

set "START_PARAMETER="
if /I "%~1"=="--local" set "START_PARAMETER=-LocalOnly"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-server.ps1" %START_PARAMETER%
set "START_RESULT=%ERRORLEVEL%"

echo.
if not "%START_RESULT%"=="0" (
  echo Der App Planner 2 konnte nicht gestartet werden.
) else (
  echo Der Server laeuft im Hintergrund weiter. Dieses Fenster darf geschlossen werden.
)
pause
exit /b %START_RESULT%
