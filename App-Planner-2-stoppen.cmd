@echo off
setlocal
chcp 65001 >nul
title App Planner 2 stoppen
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-server.ps1"
set "STOP_RESULT=%ERRORLEVEL%"
echo.
if "%STOP_RESULT%"=="0" (
  echo App Planner 2 wurde beendet. Datenbank und Sicherungen bleiben erhalten.
) else (
  echo App Planner 2 konnte nicht sauber beendet werden.
)
pause
exit /b %STOP_RESULT%
