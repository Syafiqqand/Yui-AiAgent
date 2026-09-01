@echo off
setlocal

cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

echo Starting Yui (text-only mode)...
call npm.cmd run dev

if errorlevel 1 (
  echo.
  echo Yui failed to start. Check the message above.
  pause
  exit /b 1
)