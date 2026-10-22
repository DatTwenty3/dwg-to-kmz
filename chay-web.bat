@echo off
rem Dung server dev (Next.js) va tu mo trinh duyet de test. Dong cua so nay de tat server.
setlocal
cd /d "%~dp0"
title LEDAT-GIS dev server

set PORT=3000

if not exist node_modules (
  echo Chua co node_modules, dang cai dat ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo npm install loi.
    pause
    exit /b 1
  )
)

rem Neu server da chay san thi chi mo trinh duyet.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo Server da chay o cong %PORT%, mo trinh duyet...
  start "" "http://localhost:%PORT%"
  exit /b 0
)

rem Cho server len roi moi mo trinh duyet (chay song song voi npm run dev).
start "" /b powershell -NoProfile -Command "$u='http://localhost:%PORT%'; for($i=0;$i -lt 120;$i++){ try { Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $u; break } catch { Start-Sleep -Seconds 1 } }"

echo Dang khoi dong server tai http://localhost:%PORT% ...
call npm run dev -- -p %PORT%
pause
