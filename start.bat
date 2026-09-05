@echo off
rem Starts Studio as software. Double-click this, or run it from any shell.
rem The real work is in start.ps1, next to this file.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
