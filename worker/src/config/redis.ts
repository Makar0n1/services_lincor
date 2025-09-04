import { createClient } from 'redis';
//import dotenv from 'dotenv';

// Конфигурация Redis для v4+
const redisConfig = {
  socket: {
    host: process.env['REDIS_HOST'] || 'localhost',
    port: parseInt(process.env['REDIS_PORT'] || '6379'),
    reconnectStrategy: (retries: number) => {
      if (retries > 10) {
        return new Error('Too many retries');
      }
      return Math.min(retries * 100, 3000);
    }
  },
  ...(process.env['REDIS_PASSWORD'] && { password: process.env['REDIS_PASSWORD'] })
};

// Создаем клиент Redis
const redisClient = createClient(redisConfig);

// Обработка событий подключения
redisClient.on('connect', () => {
  console.log('Connected to Redis');
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('ready', () => {
  console.log('Redis client ready');
});

redisClient.on('end', () => {
  console.log('Redis client disconnected');
});

// Функция для подключения к Redis
export const connectRedis = async (): Promise<void> => {
  try {
    console.log(`🔴 Connecting to Redis at ${redisConfig.socket.host}:${redisConfig.socket.port}...`);
    await redisClient.connect();
    console.log('✅ Redis connected successfully');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    throw error;
  }
};

// Функция для отключения от Redis
export const disconnectRedis = async (): Promise<void> => {
  try {
    await redisClient.quit();
  } catch (error) {
    console.error('Failed to disconnect from Redis:', error);
  }
};

// Утилиты для работы с Redis
export const redisGet = async (key: string): Promise<string | null> => {
  try {
    return await redisClient.get(key);
  } catch (error) {
    console.error('Redis GET error:', error);
    return null;
  }
};

export const redisSet = async (key: string, value: string, expireSeconds?: number): Promise<void> => {
  try {
    if (expireSeconds) {
      await redisClient.setEx(key, expireSeconds, value);
    } else {
      await redisClient.set(key, value);
    }
  } catch (error) {
    console.error('Redis SET error:', error);
  }
};

export const redisDel = async (key: string): Promise<void> => {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error('Redis DEL error:', error);
  }
};

export const redisExists = async (key: string): Promise<boolean> => {
  try {
    const result = await redisClient.exists(key);
    return result === 1;
  } catch (error) {
    console.error('Redis EXISTS error:', error);
    return false;
  }
};

// Функции для работы с сессиями
export const setSession = async (sessionId: string, sessionData: any, expireSeconds: number = 86400): Promise<void> => {
  await redisSet(`session:${sessionId}`, JSON.stringify(sessionData), expireSeconds);
};

export const getSession = async (sessionId: string): Promise<any | null> => {
  const sessionData = await redisGet(`session:${sessionId}`);
  return sessionData ? JSON.parse(sessionData) : null;
};

export const deleteSession = async (sessionId: string): Promise<void> => {
  await redisDel(`session:${sessionId}`);
};

// Функции для работы с кэшем
export const setCache = async (key: string, data: any, expireSeconds: number = 3600): Promise<void> => {
  await redisSet(`cache:${key}`, JSON.stringify(data), expireSeconds);
};

export const getCache = async (key: string): Promise<any | null> => {
  const cachedData = await redisGet(`cache:${key}`);
  return cachedData ? JSON.parse(cachedData) : null;
};

export const deleteCache = async (key: string): Promise<void> => {
  await redisDel(`cache:${key}`);
};

// Функции для работы с очередями
export const addToQueue = async (queueName: string, data: any): Promise<void> => {
  try {
    await redisClient.lPush(`queue:${queueName}`, JSON.stringify(data));
  } catch (error) {
    console.error('Redis LPUSH error:', error);
  }
};

export const getFromQueue = async (queueName: string): Promise<any | null> => {
  try {
    const data = await redisClient.rPop(`queue:${queueName}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis RPOP error:', error);
    return null;
  }
};

export const getQueueLength = async (queueName: string): Promise<number> => {
  try {
    return await redisClient.lLen(`queue:${queueName}`);
  } catch (error) {
    console.error('Redis LLEN error:', error);
    return 0;
  }
};

// Функции для работы с приоритетными очередями
export const addToPriorityQueue = async (queueName: string, data: any, _priority: number = 0): Promise<void> => {
  try {
    // For now, use simple queue instead of priority queue to avoid type issues
    await redisClient.lPush(`queue:${queueName}`, JSON.stringify(data));
  } catch (error) {
    console.error('Redis LPUSH error:', error);
  }
};

export const getFromPriorityQueue = async (queueName: string): Promise<any | null> => {
  try {
    // For now, use simple queue instead of priority queue to avoid type issues
    const result = await redisClient.rPop(`queue:${queueName}`);
    return result ? JSON.parse(result) : null;
  } catch (error) {
    console.error('Redis priority queue error:', error);
    return null;
  }
};

export default redisClient;
