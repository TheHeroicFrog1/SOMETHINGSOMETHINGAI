@echo off
echo ========================================
echo    BIFROST - Unified Launcher
echo ========================================
echo.

:: Start Backend in background
echo [1/2] Starting Bifrost Backend Server...
start /B "" ".venv\Scripts\python.exe" "backend\main.py"

:: Wait for backend to be ready
echo       Waiting for backend (port 8000)...
:wait_loop
timeout /t 1 /nobreak >nul
powershell -Command "try { $tcp = New-Object System.Net.Sockets.TcpClient; $tcp.Connect('127.0.0.1', 8000); $tcp.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_loop
echo       Backend is ready!

:: Start Frontend
echo [2/2] Starting Bifrost Frontend...
cd frontend
start /B "" npm run dev
cd ..

echo.
echo ========================================
echo   Bifrost is running!
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:8000
echo   Press Ctrl+C to stop all services.
echo ========================================

:: Keep the window alive so both processes run
pause >nul
