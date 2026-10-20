@echo off
setlocal
title WordVerse Stopper
cd /d "%~dp0"
rem Prefer Windows system tools even if a POSIX PATH (Git Bash) leaked into cmd
set "PATH=%SystemRoot%\System32;%PATH%"

echo.
echo  Stopping WordVerse services...
echo.

rem 1) Production server: stop by PID so drifted ports (5174+) are handled too
node server.mjs --stop >nul 2>&1
del /q ".server.pid" >nul 2>&1

rem 2) Fallback: clear leftover listeners on 5173-5183 (prod) and 8000 (dev)
call :killports

echo  [OK] All services stopped.
echo.
pause
exit /b 0

:killports
for %%p in (8000 5173 5174 5175 5176 5177 5178 5179 5180 5181 5182 5183) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING') do taskkill /pid %%a /f >nul 2>&1
)
exit /b 0
