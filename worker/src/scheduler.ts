import dotenv from 'dotenv';
import { initDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { SchedulerService } from './services/schedulerService';
import { GoogleSheetsService } from './services/googleSheetsService';

// Загрузка переменных окружения
dotenv.config({ path: '../../.env' });

// Функция инициализации Scheduler
async function startScheduler() {
  try {
    console.log('⏰ Starting Google Sheets Scheduler...');

    // Инициализация базы данных
    console.log('📊 Initializing database...');
    await initDatabase();
    console.log('✅ Database initialized successfully');

    // Подключение к Redis
    console.log('🔴 Connecting to Redis...');
    await connectRedis();
    console.log('✅ Redis connected successfully');

    // Инициализация Google Sheets Service
    console.log('📊 Initializing Google Sheets Service...');
    await GoogleSheetsService.initialize();
    console.log('✅ Google Sheets Service initialized successfully');

    // Инициализация Scheduler Service
    console.log('⏰ Initializing Scheduler Service...');
    await SchedulerService.initialize();
    console.log('✅ Scheduler Service initialized successfully');

    console.log('🚀 Scheduler is ready to manage Google Sheets analysis!');
    
    // Периодический вывод статистики
    setInterval(() => {
      const status = SchedulerService.getStatus();
      console.log(`📊 Scheduler Status: ${status.activeTasks} active tasks`);
    }, 60000); // Каждую минуту

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 SIGTERM received, shutting down scheduler gracefully...');
      await SchedulerService.shutdown();
      console.log('✅ Scheduler shut down successfully');
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('🛑 SIGINT received, shutting down scheduler gracefully...');
      await SchedulerService.shutdown();
      console.log('✅ Scheduler shut down successfully');
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
    console.error('❌ Failed to start Scheduler:', error);
    process.exit(1);
  }
}

// Запуск Scheduler
startScheduler();
