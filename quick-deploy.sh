#!/bin/bash

# LinkChecker Quick Deploy Script
# Быстрый деплой для lincor.repsdeltsgear.store

set -e  # Остановка при ошибке

echo "🚀 LinkChecker Quick Deploy for lincor.repsdeltsgear.store"
echo "=================================================="

# Проверка Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен. Установите Docker сначала."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose не установлен. Установите Docker Compose сначала."
    exit 1
fi

# Проверка .env файла
if [ ! -f .env ]; then
    echo "📝 Создание .env файла..."
    cp env.production .env
    echo "⚠️  ВАЖНО: Отредактируйте .env файл с вашими настройками!"
    echo "   Особенно: JWT_SECRET, SMTP, Google Service Account"
    read -p "Нажмите Enter после редактирования .env файла..."
fi

# Проверка service-account.json
if [ ! -f service-account.json ]; then
    echo "❌ Файл service-account.json не найден!"
    echo "   Добавьте файл service-account.json для Google API"
    exit 1
fi

echo "🔨 Сборка Docker образов..."
docker-compose build --no-cache

echo "🛑 Остановка существующих контейнеров..."
docker-compose down

echo "🚀 Запуск сервисов..."
docker-compose up -d

echo "⏳ Ожидание запуска сервисов (30 секунд)..."
sleep 30

echo "📊 Проверка статуса сервисов..."
docker-compose ps

echo "🏥 Проверка health check..."
if curl -f http://localhost:3004/health > /dev/null 2>&1; then
    echo "✅ Health check прошел успешно!"
else
    echo "❌ Health check не прошел. Проверьте логи:"
    echo "   docker-compose logs api-gateway"
fi

echo ""
echo "🎉 Деплой завершен!"
echo "🌐 API Gateway: http://localhost:3004"
echo "🌐 Nginx: http://localhost:8080"
echo "🔍 Health Check: http://localhost:3004/health"
echo "📊 Логи: docker-compose logs -f"
echo "🛑 Остановка: docker-compose down"
echo ""
echo "📋 Следующие шаги:"
echo "1. Настройте Nginx: sudo cp nginx/lincor.repsdeltsgear.store.conf /etc/nginx/sites-available/"
echo "2. Включите сайт: sudo ln -s /etc/nginx/sites-available/lincor.repsdeltsgear.store.conf /etc/nginx/sites-enabled/"
echo "3. Перезагрузите Nginx: sudo systemctl reload nginx"
echo "4. Настройте CloudFlare: добавьте поддомен lincor.repsdeltsgear.store с A-записью на IP сервера"