import dotenv from 'dotenv';
import { initDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { BullMQService } from './services/bullmqService';
import { LinkAnalyzer } from './services/linkAnalyzer';

// Загрузка переменных окружения
dotenv.config({ path: '../../.env' });

// Функция инициализации Worker
async function startWorker() {
  try {
    console.log('👷 Starting Link Analysis Worker...');

    // Инициализация базы данных
    console.log('📊 Initializing database...');
    await initDatabase();
    console.log('✅ Database initialized successfully');

    // Подключение к Redis
    console.log('🔴 Connecting to Redis...');
    await connectRedis();
    console.log('✅ Redis connected successfully');

    // Инициализация Link Analyzer
    console.log('🔍 Initializing Link Analyzer...');
    await LinkAnalyzer.initialize();
    console.log('✅ Link Analyzer initialized successfully');

    // Инициализация BullMQ Service
    console.log('📋 Initializing BullMQ Service...');
    await BullMQService.initialize();
    console.log('✅ BullMQ Service initialized successfully');

    console.log('🚀 Worker is ready to process link analysis tasks!');
    console.log(`⚙️  Worker configuration:`);
    console.log(`   - Concurrent links: ${process.env['WORKER_CONCURRENT_LINKS'] || '5'}`);
    console.log(`   - Browser instances: ${process.env['WORKER_BROWSER_INSTANCES'] || '5'}`);
    console.log(`   - Queue processing interval: ${process.env['WORKER_QUEUE_PROCESSING_INTERVAL'] || '1000'}ms`);

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 SIGTERM received, shutting down worker gracefully...');
      await BullMQService.shutdown();
      await LinkAnalyzer.close();
      console.log('✅ Worker shut down successfully');
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('🛑 SIGINT received, shutting down worker gracefully...');
      await BullMQService.shutdown();
      await LinkAnalyzer.close();
      console.log('✅ Worker shut down successfully');
      process.exit(0);
    });

    // Обработка необработанных ошибок
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Failed to start Worker:', error);
    process.exit(1);
  }
}

// Запуск Worker
startWorker();
