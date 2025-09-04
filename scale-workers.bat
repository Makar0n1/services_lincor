@echo off
REM LinkChecker Worker Scaling Script for Windows
REM Масштабирование воркеров для обработки больших нагрузок

echo 🔧 Scaling LinkChecker workers...

REM Проверка аргументов
if "%1"=="" (
    echo Usage: %0 ^<number_of_workers^>
    echo Example: %0 5
    pause
    exit /b 1
)

set WORKERS=%1

REM Проверка что число больше 0
if %WORKERS% LSS 1 (
    echo ❌ Number of workers must be at least 1
    pause
    exit /b 1
)

echo 🚀 Scaling to %WORKERS% workers...

REM Масштабирование воркеров
docker-compose up -d --scale worker=%WORKERS%

REM Ожидание запуска
echo ⏳ Waiting for workers to start...
timeout /t 10 /nobreak >nul

REM Проверка статуса
echo 📊 Current worker status:
docker-compose ps worker

echo ✅ Scaling completed!
echo 📊 Monitor logs: docker-compose logs -f worker
echo 🛑 Scale down: docker-compose up -d --scale worker=1
pause
