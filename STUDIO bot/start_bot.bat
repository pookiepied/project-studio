@echo off

echo STUDIO Discord Bot
echo Built by pookiepied
echo.

if not exist ".venv\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found
    echo Please create it: python -m venv .venv
    echo Then install dependencies: .venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

if not exist ".env" (
    echo ERROR: .env file not found
    echo Create .env file with:
    echo   DISCORD_BOT_TOKEN=your_token
    echo   API_KEY=your_key
    echo   API_BASE_URL=https://api.pookiepied.dev
    pause
    exit /b 1
)

echo Activating virtual environment...
call .venv\Scripts\activate.bat

if errorlevel 1 (
    echo ERROR: Failed to activate virtual environment
    pause
    exit /b 1
)

echo Checking dependencies...
python -c "import discord" 2>nul
if errorlevel 1 (
    echo Installing dependencies...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

echo Starting bot...
echo.
python main.py

echo.
echo Bot stopped
pause
