@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not installed or not on PATH.
  exit /b 1
)

if not exist "node_modules" (
  echo Installing server dependencies...
  call npm ci
  if errorlevel 1 exit /b 1
)

if not exist "admin\node_modules" (
  echo Installing admin dependencies...
  call npm --prefix admin ci
  if errorlevel 1 exit /b 1
)

start "Dheera Creatives API" cmd /k "npm run start:dev"
start "Dheera Creatives Admin" cmd /k "npm --prefix admin run dev"

echo.
echo API:   http://localhost:3000
echo Admin: http://localhost:5173
echo Close the two terminal windows to stop the application.
endlocal
