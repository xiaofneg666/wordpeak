@echo off
setlocal
title WordVerse Dev Launcher
cd /d "%~dp0"
rem Prefer Windows system tools even if a POSIX PATH (Git Bash) leaked into cmd
set "PATH=%SystemRoot%\System32;%PATH%"

echo.
echo  ============================================
echo    WordVerse - DEV MODE (hot reload)
echo    Vite dev server + backend on :8000
echo  ============================================
echo.

rem Clear any previous production or dev instance before starting
node server.mjs --stop >nul 2>&1
call :killports
ping -n 3 127.0.0.1 >nul

start "WordVerse-Backend" /D "%~dp0backend-node" cmd /k node server.js
start "WordVerse-Frontend" /D "%~dp0frontend" cmd /k npm run dev

rem Open the browser only after both services are ready (MySQL may be slow)
set /a WV_WAIT=0
:waitloop
curl -s -o nul -m 2 http://127.0.0.1:8000/api/ && curl -s -o nul -m 2 http://localhost:5173/ && goto ready
set /a WV_WAIT+=1
if %WV_WAIT% GEQ 60 goto failed
ping -n 3 127.0.0.1 >nul
goto waitloop

:ready
start "" "http://localhost:5173"
echo.
echo  [OK] Dev mode running
echo       Frontend  http://localhost:5173 (hot reload)
echo       Backend   http://localhost:8000
echo       Daily use: double-click the production start script
echo.
exit /b 0

:failed
echo.
echo  [ERROR] Dev services not ready within 120 seconds.
echo          Check the WordVerse-Backend / WordVerse-Frontend windows.
echo.
pause
exit /b 1

:killports
for %%p in (8000 5173 5174 5175 5176 5177 5178 5179 5180 5181 5182 5183) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr LISTENING') do taskkill /pid %%a /f >nul 2>&1
)
exit /b 0
