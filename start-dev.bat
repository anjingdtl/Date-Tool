@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ============================================================
echo    Date-Tool Dev Server Launcher
echo ============================================================
echo.

REM Check if npm is available in PATH
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm not found in PATH.
    echo [ERROR] Please install Node.js or add npm to your PATH.
    echo.
    pause
    exit /b 1
)

REM Check if node_modules exists; warn if not
if not exist "node_modules" (
    echo [WARN] node_modules not found. Running npm install first...
    npm install
    if !errorlevel! neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

REM Kill any process listening on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo [INFO] Killing old process on port 3000 - PID: %%a
    taskkill /PID %%a /F >nul 2>&1
    ping -n 3 127.0.0.1 >nul
)

echo [INFO] Starting Next.js development server...
echo [INFO] Open http://localhost:3000 once the server is ready.
echo.

npm run dev

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Dev server exited with an error.
    pause
)
