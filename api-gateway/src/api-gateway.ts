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
import { SocketService } from './services/socketService';
import { BullMQService } from './services/bullmqService';

// Импорт middleware
import { requestLogger, errorHandler } from './middleware/auth';

// Импорт маршрутов
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import manualLinksRoutes from './routes/manualLinks';
import googleSheetsRoutes from './routes/googleSheets';

// Загрузка переменных окружения
dotenv.config({ path: '../../.env' });

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env['FRONTEND_URL'] || "https://lincor.repsdeltsgear.store",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env['PORT'] || 3004

// Middleware для безопасности
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// CORS настройки
app.use(cors({
  origin: process.env['FRONTEND_URL'] || "https://lincor.repsdeltsgear.store",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статические файлы (должны быть первыми)
app.use(express.static('public'));

// Request logging
app.use(requestLogger);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
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

// Инициализация Socket Service
SocketService.initialize(io);

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

// Функция инициализации сервера
async function startServer() {
  try {
    console.log('🚀 Starting API Gateway...');

    // Инициализация базы данных
    console.log('📊 Initializing database...');
    await initDatabase();
    console.log('✅ Database initialized successfully');

    // Подключение к Redis
    console.log('🔴 Connecting to Redis...');
    await connectRedis();
    console.log('✅ Redis connected successfully');

    // Инициализация Email Service
    console.log('📧 Initializing Email Service...');
    await EmailService.initialize();
    console.log('✅ Email Service initialized successfully');

    // Инициализация BullMQ Service (Client Mode)
    console.log('🔄 Initializing BullMQ Service...');
    try {
      await BullMQService.initialize();
      console.log('✅ BullMQ Service initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing BullMQ Service:', error);
      console.error('❌ Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
      // Продолжаем работу без BullMQ Service для отладки
    }

    // Запуск сервера
    server.listen(PORT, () => {
      console.log(`🌐 API Gateway running on port ${PORT}`);
      console.log(`📡 Socket.IO server ready for connections`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 SIGTERM received, shutting down gracefully...');
      server.close(() => {
        console.log('✅ API Gateway shut down successfully');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('🛑 SIGINT received, shutting down gracefully...');
      server.close(() => {
        console.log('✅ API Gateway shut down successfully');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start API Gateway:', error);
    process.exit(1);
  }
}

// Запуск сервера
startServer();
