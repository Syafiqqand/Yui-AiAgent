@echo off
setlocal

cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

if not exist "%~dp0local-tts\.venv\Scripts\Activate.ps1" (
  echo Kokoro venv was not found:
  echo %~dp0local-tts\.venv\Scripts\Activate.ps1
  echo.
  echo Start Yui without voice by running start-yui.bat.
  pause
  exit /b 1
)

echo Starting Kokoro TTS server in a separate PowerShell window...
start "Yui Kokoro TTS" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -Command "Set-Location -LiteralPath '%~dp0local-tts'; . '.\.venv\Scripts\Activate.ps1'; python server.py"

echo Waiting for Kokoro to boot...
timeout /t 8 /nobreak >nul

echo Starting Yui with optional voice mode...
call npm.cmd run dev

if errorlevel 1 (
  echo.
  echo Yui failed to start. Check the message above.
  pause
  exit /b 1
)
