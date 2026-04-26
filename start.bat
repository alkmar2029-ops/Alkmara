@echo off
REM Double-click this file to launch the ZKTeco attendance app.
REM It runs start.ps1 with ExecutionPolicy bypass so PowerShell won't block it.
title ZKTeco Attendance
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
echo.
echo --- توقف التطبيق ---
pause
