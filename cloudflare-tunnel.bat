@echo off
title Cloudflare Tunnel - ecom-dashboard
color 0A

echo =============================================
echo   Cloudflare Tunnel - ecom-dashboard
echo   ecom-dashboard.wejlc.com -> localhost:8088
echo   Protocol: HTTP/2 (Stable)
echo   Press Ctrl+C to stop
echo =============================================
echo.

:: Create logs directory if not exists
if not exist "%~dp0logs" mkdir "%~dp0logs"

set RETRY_COUNT=0
set CONFIG_DIR=%USERPROFILE%\.cloudflared

:LOOP
set /a RETRY_COUNT+=1

:: Get timestamp
for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value') do set DT=%%a
set TIMESTAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2% %DT:~8,2%:%DT:~10,2%:%DT:~12,2%

echo [%TIMESTAMP%] Starting Tunnel ecom-dashboard (attempt #%RETRY_COUNT%)...
echo [%TIMESTAMP%] Starting Tunnel ecom-dashboard (attempt #%RETRY_COUNT%) >> "%~dp0logs\tunnel.log"

:: Run Named Tunnel using existing config
::   --config       : Use the ecom-dashboard.yml config
::   --protocol http2 : More stable than QUIC on Windows
::   --no-autoupdate  : Prevent update conflicts
::   --grace-period   : Allow graceful shutdown
cloudflared tunnel --config "%~dp0config.yml" --protocol http2 --no-autoupdate --grace-period 30s run ecom-dashboard 2>&1 | powershell -Command "$input | ForEach-Object { $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; \"[$ts] $_\" | Tee-Object -FilePath '%~dp0logs\tunnel.log' -Append }"

echo.

for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value') do set DT=%%a
set TIMESTAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2% %DT:~8,2%:%DT:~10,2%:%DT:~12,2%

echo [%TIMESTAMP%] Tunnel disconnected! Restarting in a moment...
echo [%TIMESTAMP%] Tunnel disconnected! Restarting... >> "%~dp0logs\tunnel.log"

:: Exponential backoff: 5s, 7s, 9s, ... max 30s
set /a WAIT_TIME=5 + (%RETRY_COUNT% * 2)
if %WAIT_TIME% GTR 30 set WAIT_TIME=30
echo [%TIMESTAMP%] Waiting %WAIT_TIME%s before retry...
timeout /t %WAIT_TIME% /noq

:: Reset retry count after 10 attempts
if %RETRY_COUNT% GEQ 10 set RETRY_COUNT=0

goto LOOP
