@echo off
setlocal

cd /d "%~dp0"

title TokenFlow Dev

set "RUST_BACKTRACE=1"
set "RUST_LOG=info"
set "TAURI_DEBUG=1"
set "BROWSER=none"

echo [TokenFlow] Starting local debug session...
echo [TokenFlow] Working directory: %CD%
echo [TokenFlow] RUST_BACKTRACE=%RUST_BACKTRACE%
echo [TokenFlow] RUST_LOG=%RUST_LOG%
echo.
echo [TokenFlow] Press Ctrl+C to stop.
echo.

call npm run tauri -- dev
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [TokenFlow] dev.bat exited with code %EXIT_CODE%.
)

exit /b %EXIT_CODE%
