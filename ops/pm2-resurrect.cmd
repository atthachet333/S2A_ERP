@echo off
setlocal
set "PM2_HOME=C:\Users\This PC\.pm2"
call "C:\Users\This PC\AppData\Roaming\npm\pm2.cmd" resurrect
exit /b %ERRORLEVEL%
