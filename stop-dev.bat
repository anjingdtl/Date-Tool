@echo off
REM ============================================================
REM Date-Tool 停止脚本 —— 杀掉 3000 端口上的 Next.js dev server
REM ============================================================

setlocal EnableDelayedExpansion

echo.
echo ============================================================
echo    Stopping Date-Tool Dev Server (port 3000)
echo ============================================================
echo.

set KILLED=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo [INFO] Killing PID %%a
    taskkill /PID %%a /F >nul 2>&1
    if !errorlevel! == 0 (
        set KILLED=1
    )
)

if !KILLED! == 0 (
    echo [INFO] No process listening on port 3000. Nothing to stop.
)

echo.
ping -n 3 127.0.0.1 >nul