@echo off
setlocal

title Rino Software Preview
cd /d "%~dp0"

where corepack >nul 2>nul
if errorlevel 1 (
  echo Corepack was not found. Install the project-required Node.js version first.
  pause
  exit /b 1
)

echo Starting the Rino desktop preview...
corepack pnpm@11.9.0 --filter @rino/desktop tauri dev
set "RINO_PREVIEW_EXIT_CODE=%ERRORLEVEL%"

if not "%RINO_PREVIEW_EXIT_CODE%"=="0" (
  echo.
  echo Rino desktop preview failed with exit code %RINO_PREVIEW_EXIT_CODE%.
  pause
)

exit /b %RINO_PREVIEW_EXIT_CODE%
