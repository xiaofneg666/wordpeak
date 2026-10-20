@echo off
setlocal
title WordVerse Launcher
cd /d "%~dp0"
rem Prefer Windows system tools even if a POSIX PATH (Git Bash) leaked into cmd
set "PATH=%SystemRoot%\System32;%PATH%"

echo.
echo  ============================================
echo    WordVerse - 3D English Learning Universe
echo    Production mode (single process)
echo  ============================================
echo.

rem Stop the previous server.mjs precisely via .server.pid (works on drifted ports)
node server.mjs --stop >nul 2>&1

rem Fallback: clear leftover listeners on 5173-5183 (prod) and 8000 (dev)
call :killports

rem Give the OS a moment to release the ports
ping -n 3 127.0.0.1 >nul

rem Single process: builds frontend/dist and serves UI + API on one port.
rem --no-open: this script opens the browser once, after reading the real port.
start "WordVerse-Server" cmd /k node server.mjs --no-open

rem Wait for .server.pid, then read the actual port (can be 5174+ if 5173 is busy)
set "WV_PORT="
set /a WV_WAIT=0
:waitloop
if not defined WV_PORT if exist ".server.pid" (
  for /f "delims=" %%a in ('node --input-type=commonjs -e "const fs=require('fs');process.stdout.write(String(JSON.parse(fs.readFileSync('.server.pid','utf8')).port))" 2^>nul') do set "WV_PORT=%%a"
)
if defined WV_PORT (
  curl -s -o nul -m 2 http://127.0.0.1:%WV_PORT%/ && goto ready
)
set /a WV_WAIT+=1
if %WV_WAIT% GEQ 90 goto failed
ping -n 3 127.0.0.1 >nul
goto waitloop

:ready
start "" "http://localhost:%WV_PORT%"
echo.
echo  [OK] WordVerse is open in your browser
echo       App + API   http://localhost:%WV_PORT%  (single process)
echo       Stop:       double-click the stop script
echo       Dev mode:   double-click the dev script
echo.
exit /b 0

:failed
echo.
echo  [ERROR] Server not ready within 180 seconds.
echo          Check the WordVerse-Server window for errors.
echo          Common causes: MySQL not running / frontend build failed.
echo.
pause
exit /b 1

:killports
for %%p in (8000 5173 5174 5175 5176 5177 5178 5179 5180 5181 5182 5183) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING') do taskkill /pid %%a /f >nul 2>&1
)
exit /b 0
