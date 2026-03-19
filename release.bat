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

echo [TokenFlow] Syncing version to %VERSION%...
call node scripts\sync-version.mjs "%VERSION%"
if errorlevel 1 (
  echo.
  echo [TokenFlow] Version sync failed.
  exit /b 1
)

echo.
echo [TokenFlow] Version files updated to %VERSION%.
echo [TokenFlow] Recommended next commands:
echo   npm run build
echo   cargo test --manifest-path src-tauri\Cargo.toml
echo   git add .
echo   git commit -m "Release v%VERSION%"
echo   git push origin main
echo   git tag v%VERSION%
echo   git push origin v%VERSION%

exit /b 0
