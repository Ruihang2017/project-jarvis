; Uninstalling the app removes the background task, but only if the app installed it: the terminal
; version (edward) uses the same task name, and its task must keep working. The launcher in the data
; folder names the program it starts, so check that it is this app's Edward.exe.
!macro customUnInstall
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -Command "$$f = Join-Path $$env:LOCALAPPDATA 'Edward\tick.vbs'; if ((Test-Path $$f) -and ((Get-Content $$f -Raw) -match 'Edward\.exe')) { schtasks /Delete /TN 'Edward\Tick' /F | Out-Null }"`
  Pop $0
!macroend
