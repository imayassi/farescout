@echo off
rem Desktop-shortcut target: starts ExecOS and opens the app window.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*
if errorlevel 1 pause
