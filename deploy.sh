#!/bin/bash

# LinkChecker Production Deployment Script
# Для поддомена lincor.repsdeltsgear.store

echo "🚀 Starting LinkChecker deployment..."

# Проверка Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Создание .env файла если его нет
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.production .env
    echo "⚠️  Please edit .env file with your production values before continuing!"
    echo "   Especially: JWT_SECRET, SMTP credentials, Google Service Account"
    read -p "Press Enter after editing .env file..."
fi

# Создание папки для SSL сертификатов
mkdir -p nginx/ssl

# Остановка существующих контейнеров
echo "🛑 Stopping existing containers..."
docker-compose down

# Сборка образов
echo "🔨 Building Docker images..."
docker-compose build --no-cache

# Запуск сервисов
echo "🚀 Starting services..."
docker-compose up -d

# Ожидание запуска сервисов
echo "⏳ Waiting for services to start..."
sleep 30

# Проверка статуса
echo "📊 Checking service status..."
docker-compose ps

# Проверка health check
echo "🏥 Checking health status..."
curl -f http://localhost:3000/health || echo "❌ Health check failed"

echo "✅ Deployment completed!"
echo "🌐 API Gateway: http://localhost:3000"
echo "🔍 Health Check: http://localhost:3000/health"
echo "📊 Monitor logs: docker-compose logs -f"
echo "🛑 Stop services: docker-compose down"
