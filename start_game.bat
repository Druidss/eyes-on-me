@echo off
setlocal

:: Get the directory where this batch file is located (includes trailing backslash)
set "PROJECT_DIR=%~dp0"

echo ====================================================
echo   EYES ON ME - PROJECT STARTER (Backend + Frontend)
echo ====================================================
echo.

:: Launch Backend
echo [1/2] Starting Backend API Server (Uvicorn)...
start "Backend API Server" cmd /k "cd /d %PROJECT_DIR%backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

:: Launch Frontend
echo [2/2] Starting Frontend Vite Server...
start "Frontend Dev Server" cmd /k "cd /d %PROJECT_DIR%frontend && set PATH=%PROJECT_DIR%temp\node-v22.23.1-win-x64;%%PATH%% && npm run dev"

echo.
echo ====================================================
echo  Servers have been launched in separate windows!
echo.
echo  For testing (with debug/bounding boxes):
echo  http://localhost:5173/?p1demo
echo.
echo  For participants (clean user study):
echo  http://localhost:5173/
echo ====================================================
echo.
pause
