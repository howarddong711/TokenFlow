@echo off
setlocal

cd /d "%~dp0"

echo [TokenFlow] Building frontend...
call npm run build
if errorlevel 1 (
  echo.
  echo [TokenFlow] Frontend build failed.
  exit /b 1
)

echo [TokenFlow] Building Tauri release executable...
cargo build --release --manifest-path src-tauri\Cargo.toml
if errorlevel 1 (
  echo.
  echo [TokenFlow] Tauri release build failed.
  exit /b 1
)

set "EXE_PATH=src-tauri\target\release\tokenflow.exe"
if not exist "%EXE_PATH%" (
  echo.
  echo [TokenFlow] Release executable not found: %EXE_PATH%
  exit /b 1
)

echo [TokenFlow] Launching %EXE_PATH% ...
start "TokenFlow" "%EXE_PATH%"

exit /b 0
