@echo off
echo Checking dependencies...
if not exist node_modules (
    echo node_modules not found. Installing dependencies...
    call npm install
) else (
    echo node_modules found. Skipping install.
)

echo Starting application...
call npm start

echo.
echo Application finished.
pause
