@echo off
setlocal EnableExtensions DisableDelayedExpansion

REM Direct double-clicks use the hidden VBS launcher, which waits for the
REM server, opens the browser, and keeps the server lifecycle out of this
REM console window. The VBS launcher passes /from-vbs to run this file.
if /I not "%~1"=="/from-vbs" (
    if exist "%~dp0start-dev.vbs" (
        start "" /b wscript.exe "%~dp0start-dev.vbs"
        exit /b 0
    )
)

setlocal EnableDelayedExpansion

REM ============================================================
REM Date-Tool dev server launcher
REM - Double-click delegates to start-dev.vbs (hidden window + browser)
REM - Called with /from-vbs for the actual server process
REM IMPORTANT: Do NOT outer-redirect this bat to the same log file.
REM The bat writes logs\dev-server.log itself; double redirect locks
REM the file on Windows and the server never starts.
REM ============================================================

REM The hidden launcher enables automatic shutdown after all WebUI sessions close.
REM Normal npm run dev leaves this variable unset to avoid accidental exits.
set "AUTO_SHUTDOWN_ENABLED=true"

cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set "LOG_FILE=%~dp0logs\dev-server.log"

REM Rotate previous log
if exist "%LOG_FILE%" (
    if exist "%LOG_FILE%.prev" del /f /q "%LOG_FILE%.prev" >nul 2>&1
    move /y "%LOG_FILE%" "%LOG_FILE%.prev" >nul 2>&1
)

call :log "============================================================"
call :log "   Date-Tool Dev Server - %date% %time%"
call :log "   Log: %LOG_FILE%"
call :log "============================================================"

REM Ensure common Node.js install paths are on PATH
if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"

where npm >nul 2>&1
if errorlevel 1 (
    call :log "[ERROR] npm not found in PATH. Please install Node.js."
    echo [ERROR] npm not found in PATH. Please install Node.js.
    exit /b 1
)

if not exist "node_modules\" (
    call :log "[WARN] node_modules not found. Running npm install..."
    echo [WARN] node_modules not found. Running npm install...
    call npm install >> "%LOG_FILE%" 2>&1
    if errorlevel 1 (
        call :log "[ERROR] npm install failed. See log for details."
        exit /b 1
    )
)

REM Kill anything already listening on port 3000
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do (
    call :log "[INFO] Killing old process on port 3000 - PID: %%a"
    taskkill /PID %%a /F >nul 2>&1
)
ping -n 2 127.0.0.1 >nul

call :log "[INFO] Starting Next.js development server..."
call :log "[INFO] Open http://127.0.0.1:3000 once the server is ready."
call :log ""

REM Only this script should write the log file
call npm run dev >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=!errorlevel!"

if not "!EXIT_CODE!"=="0" (
    call :log ""
    call :log "[ERROR] Dev server exited with code !EXIT_CODE!."
    exit /b !EXIT_CODE!
)
exit /b 0

:log
echo(%~1
echo(%~1>>"%LOG_FILE%"
goto :eof
