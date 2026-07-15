@echo off
REM ============================================================
REM Date-Tool stop script - kill process listening on port 3000
REM ============================================================

setlocal EnableDelayedExpansion

echo.
echo ============================================================
echo    Stopping Date-Tool Dev Server (port 3000)
echo ============================================================
echo.

set KILLED=0
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo [INFO] Killing PID %%a
    taskkill /PID %%a /F >nul 2>&1
    if not errorlevel 1 (
        set KILLED=1
    )
)

if "!KILLED!"=="0" (
    echo [INFO] No process listening on port 3000. Nothing to stop.
) else (
    echo [INFO] Stopped.
)

echo.
ping -n 2 127.0.0.1 >nul
endlocal
