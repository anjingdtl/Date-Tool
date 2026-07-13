' ============================================================
' Date-Tool 静默启动器（双击即用）
'
' 时序：
'   1. 切到脚本目录，杀 3000 端口旧进程
'   2. 隐藏窗口 + 后台启动 start-dev.bat（日志进 logs\dev-server.log）
'   3. 轮询 localhost:3000 直到就绪（最多 90 秒）
'   4. 就绪后用默认浏览器打开 WebUI
'   5. 进入"等待关闭"循环 —— 浏览器关闭 → 前端 sendBeacon → 服务端退出 → bat 退出 → 端口释放
'   6. 弹"服务已关闭"提示框
' ============================================================

Option Explicit

Const PORT = 3000
Const URL  = "http://localhost:3000"
Const MAX_WAIT_SEC = 90

Dim shell, fso, scriptDir, batPath, logDir, logPath
Dim http, ready, i, status, errNum

Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir
batPath = scriptDir & "\start-dev.bat"
logDir  = scriptDir & "\logs"
logPath = logDir & "\dev-server.log"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

' —— 杀旧进程 ——
shell.Run "cmd /c for /f ""tokens=5"" %a in " _
  & "( 'netstat -ano ^| findstr "":" & PORT & """ ^| findstr LISTENING' ) " _
  & "do taskkill /PID %a /F >nul 2>&1", 0, True

If Not fso.FileExists(batPath) Then
  MsgBox "找不到 start-dev.bat，请确认与 .vbs 在同一目录。", 48, "启动失败"
  WScript.Quit 1
End If

' —— 后台启动 bat（隐藏窗口，fire-and-forget） ——
shell.Run "cmd /c """ & batPath & """ > """ & logPath & """ 2>&1", 0, False

' —— 轮询服务器就绪 ——
Set http = CreateObject("MSXML2.XMLHTTP")
ready = False
For i = 1 To MAX_WAIT_SEC
  WScript.Sleep 1000
  errNum = 0
  status = 0
  On Error Resume Next
  http.open "GET", URL, False
  http.send
  If Err.Number = 0 Then status = http.status
  errNum = Err.Number
  On Error Goto 0
  If errNum = 0 And status = 200 Then
    ready = True
    Exit For
  End If
Next

' —— 就绪失败 ——
If Not ready Then
  MsgBox "启动超时（" & MAX_WAIT_SEC & " 秒内未就绪）。" & vbCrLf _
    & "请查看日志：" & logPath & vbCrLf & vbCrLf _
    & "常见原因：依赖未装 / 端口被占 / LLM Key 无效。", _
    48, "启动失败"
  WScript.Quit 1
End If

' —— 打开浏览器，弹"启动成功"提示 ——
shell.Run URL, 1, False
MsgBox "Date-Tool 已启动，浏览器已自动打开。" & vbCrLf & vbCrLf _
  & "访问地址：" & URL & vbCrLf _
  & "关闭浏览器后服务会自动停止。", _
  64, "启动成功"

' —— 等待浏览器关闭 → 服务退出 → 端口释放 ——
Do
  WScript.Sleep 2000
  If Not isPortListening(PORT) Then Exit Do
  ' 兜底超时：30 分钟无活动也提示一下（防止误判死锁）
  i = i + 1
  If i > 900 Then Exit Do  ' 900 * 2s = 30min
Loop

MsgBox "Date-Tool 服务已停止。" & vbCrLf & vbCrLf _
  & "退出原因：浏览器已关闭（自动回收）" & vbCrLf _
  & "再次启动：双击 start-dev.vbs", _
  64, "服务已关闭"
WScript.Quit 0

' ============================================================
' 工具函数：检测端口是否在监听
' ============================================================
Function isPortListening(port)
  Dim r
  On Error Resume Next
  Set r = shell.Exec("netstat -ano ^| findstr "":" & port & """ ^| findstr LISTENING")
  If Err.Number <> 0 Then
    isPortListening = False
    On Error Goto 0
    Exit Function
  End If
  Dim out
  out = r.StdOut.ReadAll()
  On Error Goto 0
  isPortListening = (Len(out) > 0)
End Function