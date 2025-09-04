@echo off
REM LinkChecker Production Deployment Script for Windows
REM Для поддомена lincor.repsdeltsgear.store

echo 🚀 Starting LinkChecker deployment...

REM Проверка Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not installed. Please install Docker first.
    pause
    exit /b 1
)

docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Compose is not installed. Please install Docker Compose first.
    pause
    exit /b 1
)

REM Создание .env файла если его нет
if not exist .env (
    echo 📝 Creating .env file from template...
    copy env.production .env
    echo ⚠️  Please edit .env file with your production values before continuing!
    echo    Especially: JWT_SECRET, SMTP credentials, Google Service Account
    pause
)

REM Создание папки для SSL сертификатов
if not exist nginx\ssl mkdir nginx\ssl

REM Остановка существующих контейнеров
echo 🛑 Stopping existing containers...
docker-compose down

REM Сборка образов
echo 🔨 Building Docker images...
docker-compose build --no-cache

REM Запуск сервисов
echo 🚀 Starting services...
docker-compose up -d

REM Ожидание запуска сервисов
echo ⏳ Waiting for services to start...
timeout /t 30 /nobreak >nul

REM Проверка статуса
echo 📊 Checking service status...
docker-compose ps

REM Проверка health check
echo 🏥 Checking health status...
curl -f http://localhost:3004/health || echo ❌ Health check failed

echo ✅ Deployment completed!
echo 🌐 API Gateway: http://localhost:3004
echo 🔍 Health Check: http://localhost:3004/health
echo 📊 Monitor logs: docker-compose logs -f
echo 🛑 Stop services: docker-compose down
pause