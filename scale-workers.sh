#!/bin/bash

# LinkChecker Worker Scaling Script
# Масштабирование воркеров для обработки больших нагрузок

echo "🔧 Scaling LinkChecker workers..."

# Проверка аргументов
if [ $# -eq 0 ]; then
    echo "Usage: $0 <number_of_workers>"
    echo "Example: $0 5"
    exit 1
fi

WORKERS=$1

# Проверка что число больше 0
if [ $WORKERS -lt 1 ]; then
    echo "❌ Number of workers must be at least 1"
    exit 1
fi

echo "🚀 Scaling to $WORKERS workers..."

# Масштабирование воркеров
docker-compose up -d --scale worker=$WORKERS

# Ожидание запуска
echo "⏳ Waiting for workers to start..."
sleep 10

# Проверка статуса
echo "📊 Current worker status:"
docker-compose ps worker

echo "✅ Scaling completed!"
echo "📊 Monitor logs: docker-compose logs -f worker"
echo "🛑 Scale down: docker-compose up -d --scale worker=1"
