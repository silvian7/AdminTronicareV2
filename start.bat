@echo off
pushd "%~dp0" || exit /b 1
docker compose up --build
set "TRONICARE_START_EXIT=%ERRORLEVEL%"
popd
exit /b %TRONICARE_START_EXIT%
