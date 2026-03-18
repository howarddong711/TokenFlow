@echo off
setlocal

cd /d "%~dp0"

echo [TokenFlow] Starting Tauri development mode...
echo [TokenFlow] Press Ctrl+C to stop.

npx tauri dev
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [TokenFlow] dev.bat failed with exit code %EXIT_CODE%.
)

exit /b %EXIT_CODE%
