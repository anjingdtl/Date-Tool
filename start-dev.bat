@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set LOG_FILE=%~dp0logs\dev-server.log

echo ============================================================ >  "%LOG_FILE%"
echo    Date-Tool Dev Server - %date% %time% >> "%LOG_FILE%"
echo    Log: %LOG_FILE% >> "%LOG_FILE%"
echo ============================================================ >> "%LOG_FILE%"

REM Check if npm is available in PATH
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm not found in PATH. >> "%LOG_FILE%"
    echo [ERROR] Please install Node.js or add npm to your PATH. >> "%LOG_FILE%"
    exit /b 1
)

REM Check if node_modules exists; warn if not
if not exist "node_modules" (
    echo [WARN] node_modules not found. Running npm install first... >> "%LOG_FILE%"
    call npm install >> "%LOG_FILE%" 2>&1
    if !errorlevel! neq 0 (
        echo [ERROR] npm install failed. See log for details. >> "%LOG_FILE%"
        exit /b 1
    )
)

REM Kill any process listening on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo [INFO] Killing old process on port 3000 - PID: %%a >> "%LOG_FILE%"
    taskkill /PID %%a /F >nul 2>&1
    ping -n 3 127.0.0.1 >nul
)

echo [INFO] Starting Next.js development server... >> "%LOG_FILE%"
echo [INFO] Open http://localhost:3000 once the server is ready. >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

call npm run dev >> "%LOG_FILE%" 2>&1

if %errorlevel% neq 0 (
    echo. >> "%LOG_FILE%"
    echo [ERROR] Dev server exited with an error. >> "%LOG_FILE%"
    exit /b 1
)