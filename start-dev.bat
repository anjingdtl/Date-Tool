@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ════════════════════════════════════════════
echo    Date-Tool · 一键启动开发服务器
echo ════════════════════════════════════════════

:: 检查 3000 端口是否被占用，若占用则结束旧进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo [INFO] 发现 3000 端口被占用 (PID: %%a)，正在结束旧进程...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 2 /nobreak >nul
)

echo [INFO] 正在启动 Next.js 开发服务器...
echo [INFO] 启动成功后，请访问 http://localhost:3000
echo.

npm run dev

pause
