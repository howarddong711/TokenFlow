@echo off
setlocal

cd /d "%~dp0"

if "%~1"=="" (
  echo Usage: release.bat ^<version^>
  echo Example: release.bat 0.1.2
  exit /b 1
)

set "RAW_VERSION=%~1"
set "VERSION=%RAW_VERSION%"

if /i "%VERSION:~0,1%"=="v" (
  set "VERSION=%VERSION:~1%"
)

if "%TOKENFLOW_ANTIGRAVITY_CLIENT_ID%"=="" (
  echo.
  echo [TokenFlow] Missing TOKENFLOW_ANTIGRAVITY_CLIENT_ID.
  echo [TokenFlow] Set Anti-Gravity OAuth credentials in this shell before running release.bat.
  exit /b 1
)

if "%TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET%"=="" (
  echo.
  echo [TokenFlow] Missing TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET.
  echo [TokenFlow] Set Anti-Gravity OAuth credentials in this shell before running release.bat.
  exit /b 1
)

if "%TAURI_SIGNING_PRIVATE_KEY%"=="" if "%TAURI_SIGNING_PRIVATE_KEY_PATH%"=="" (
  echo.
  echo [TokenFlow] Missing TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH.
  echo [TokenFlow] Set Tauri updater signing credentials in this shell before running release.bat.
  exit /b 1
)

echo [TokenFlow] Syncing version to %VERSION%...
call node scripts\sync-version.mjs "%VERSION%"
if errorlevel 1 (
  echo.
  echo [TokenFlow] Version sync failed.
  exit /b 1
)

echo.
echo [TokenFlow] Building frontend bundle...
call npm run build
if errorlevel 1 (
  echo.
  echo [TokenFlow] Frontend build failed.
  exit /b 1
)

echo.
echo [TokenFlow] Running Rust validation...
call cargo check --manifest-path src-tauri\Cargo.toml
if errorlevel 1 (
  echo.
  echo [TokenFlow] Rust validation failed.
  exit /b 1
)

echo.
echo [TokenFlow] Building Tauri release installer...
call npm run tauri build
if errorlevel 1 (
  echo.
  echo [TokenFlow] Tauri release build failed.
  exit /b 1
)

echo.
echo [TokenFlow] Release build completed for v%VERSION%.
echo [TokenFlow] Build artifacts should now be under src-tauri\target\release\bundle\
echo [TokenFlow] Source remains secret-free; this installer contains the build-time Anti-Gravity OAuth credentials.

exit /b 0
