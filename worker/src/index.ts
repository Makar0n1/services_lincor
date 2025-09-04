import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';

import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

// Импорт конфигурации
import { initDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { EmailService } from './services/emailService';
import { GoogleSheetsService } from './services/googleSheetsService';
import { SchedulerService } from './services/schedulerService';
import { QueueService } from './services/queueService';

// Импорт middleware
import { requestLogger, errorHandler } from './middleware/auth';

// Импорт маршрутов
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import manualLinksRoutes from './routes/manualLinks';
import googleSheetsRoutes from './routes/googleSheets';

// Загрузка переменных окружения из корня проекта
dotenv.config({ path: '../../.env' });

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env['FRONTEND_URL'] || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env['PORT'] || 3000;



// Middleware для безопасности
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS настройки
app.use(cors({
  origin: process.env['FRONTEND_URL'] || "http://localhost:3000",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Сжатие ответов
app.use(compression());

// Парсинг JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Логирование запросов
app.use(requestLogger);

// Статические файлы
app.use('/uploads', express.static('uploads'));
app.use('/test', express.static('public'));

// Root endpoint - redirect to test page
app.get('/', (_req, res) => {
  res.redirect('/test/test.html');
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env['NODE_ENV'] || 'development'
  });
});

// API маршруты
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', manualLinksRoutes);
app.use('/api/projects', googleSheetsRoutes);

// Обработка 404
app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Обработка ошибок
app.use(errorHandler);

// Socket.IO обработчики
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Подписка на обновления проекта
  socket.on('subscribe_project', (data) => {
    const { projectId } = data;
    socket.join(`project_${projectId}`);
    console.log(`Client ${socket.id} subscribed to project ${projectId}`);
  });

  // Отписка от проекта
  socket.on('unsubscribe_project', (data) => {
    const { projectId } = data;
    socket.leave(`project_${projectId}`);
    console.log(`Client ${socket.id} unsubscribed from project ${projectId}`);
  });

  // Обработка отключения
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Экспорт io для использования в других модулях
export { io };

// Функция инициализации сервера
async function startServer() {
  try {
    // Инициализация базы данных
    console.log('Initializing database...');
    await initDatabase();
    console.log('Database initialized successfully');

    // Подключение к Redis
    console.log('Connecting to Redis...');
    await connectRedis();
    console.log('Redis connected successfully');

    // Инициализация Email сервиса
    console.log('Initializing Email service...');
    await EmailService.initialize();
    console.log('Email service initialized successfully');

    // Инициализация Google Sheets сервиса
    console.log('Initializing Google Sheets service...');
    await GoogleSheetsService.initialize();
    console.log('Google Sheets service initialized successfully');

    // Инициализация планировщика
    console.log('Initializing Scheduler service...');
    await SchedulerService.initialize();
    console.log('Scheduler service initialized successfully');

    // Инициализация системы очередей
    console.log('Initializing Queue service...');
    await QueueService.initialize();
    console.log('Queue service initialized successfully');

    // Запуск сервера
    server.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env['NODE_ENV'] || 'development'}`);
      console.log(`🔗 API URL: http://localhost:${PORT}/api`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Обработка сигналов завершения
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Останавливаем сервисы
  await SchedulerService.shutdown();
  await QueueService.shutdown();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  
  // Останавливаем сервисы
  await SchedulerService.shutdown();
  await QueueService.shutdown();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Запуск сервера
startServer();
