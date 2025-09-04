import redisClient from '../config/redis';
import { UserModel } from '../models/User';
import { ManualLinkModel } from '../models/ManualLink';
import { LinkAnalyzer } from './linkAnalyzer';
import { SocketService } from './socketService';

export interface QueueItem {
  id: string;
  type: 'manual' | 'google_sheets';
  userId: string;
  projectId: string;
  linkId?: string | undefined;
  sheetId?: string | undefined;
  url: string;
  targetDomain: string;
  priority: number; // 1 = highest (enterprise), 4 = lowest (free)
  createdAt: Date;
  attempts: number;
  maxAttempts: number;
}

export interface AnalysisResult {
  id: string;
  type: 'manual' | 'google_sheets';
  userId: string;
  projectId: string;
  linkId?: string | undefined;
  sheetId?: string | undefined;
  result: any;
  success: boolean;
  error?: string;
  processedAt: Date;
}

export class QueueService {
  private static readonly PROCESSING_KEY = 'link_analysis_processing';
  private static readonly RESULTS_KEY = 'link_analysis_results';
  private static readonly PRIORITY_QUEUE_KEY = 'link_analysis_priority_queue';
  
  private static workers: Map<string, boolean> = new Map();
  private static readonly MAX_WORKERS = parseInt(process.env['WORKER_CONCURRENT_LINKS'] || '5');

  /**
   * Инициализация сервиса очередей (полная версия с воркерами)
   */
  static async initialize(): Promise<void> {
    console.log('🔄 Initializing Queue Service...');
    
    try {
      // Проверяем подключение к Redis
      const ping = await redisClient.ping();
      console.log('Redis PING:', ping);
      
      // Очищаем старые задачи в обработке (на случай перезапуска)
      await this.clearProcessingQueue();
      
      console.log(`👥 Starting ${this.MAX_WORKERS} workers for link analysis`);
      
      // Запускаем воркеры
      for (let i = 0; i < this.MAX_WORKERS; i++) {
        this.startWorker(`worker_${i}`);
      }
      
      console.log('✅ Queue Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Queue Service:', error);
      throw error;
    }
  }

  /**
   * Инициализация только клиентской части (для API Gateway)
   */
  static async initializeClient(): Promise<void> {
    console.log('🔄 Initializing Queue Service (Client Mode)...');
    
    try {
      // В клиентском режиме нам не нужно очищать очередь обработки
      // Это делают воркеры при инициализации
      console.log('✅ Queue Service (Client Mode) initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing Queue Service (Client Mode):', error);
      throw error;
    }
  }

  /**
   * Добавление ссылки в очередь анализа
   */
  static async addToQueue(
    type: 'manual' | 'google_sheets',
    userId: string,
    projectId: string,
    url: string,
    targetDomain: string,
    linkId?: string,
    sheetId?: string
  ): Promise<void> {
    try {
      // Получаем приоритет пользователя
      const user = await UserModel.findById(userId);
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      const priority = this.getUserPriority(user.subscription_plan);
      
      const queueItem: QueueItem = {
        id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type,
        userId,
        projectId,
        linkId,
        sheetId,
        url,
        targetDomain,
        priority,
        createdAt: new Date(),
        attempts: 0,
        maxAttempts: 3
      };

      // Добавляем в приоритетную очередь Redis
      const score = this.calculateScore(priority, queueItem.createdAt);
      const member = { score, value: JSON.stringify(queueItem) };
      const added = await redisClient.zAdd(this.PRIORITY_QUEUE_KEY, [member]);
      console.log('zAdd added count:', added);

      // Проверяем, что элемент действительно добавлен
      const queueSize = await redisClient.zCard(this.PRIORITY_QUEUE_KEY);
      console.log(`📥 Added ${type} link to queue: ${url} (priority: ${priority}, userId: ${userId})`);
      console.log(`📊 Queue size after adding: ${queueSize}`);
      
      // Проверяем содержимое очереди
      const queueItems = await redisClient.zRange(this.PRIORITY_QUEUE_KEY, 0, -1);
      console.log(`📋 Queue items: ${queueItems.length}`, queueItems.map(item => {
        const parsed = JSON.parse(item);
        return `${parsed.type}:${parsed.url}`;
      }));
      
      // Проверяем через 1 секунду, что элемент все еще в очереди
      setTimeout(async () => {
        try {
          const delayedQueueSize = await redisClient.zCard(this.PRIORITY_QUEUE_KEY);
          const delayedQueueItems = await redisClient.zRange(this.PRIORITY_QUEUE_KEY, 0, -1);
          const processingSize = await redisClient.lLen(this.PROCESSING_KEY);
          const processingItems = await redisClient.lRange(this.PROCESSING_KEY, 0, -1);
          
          console.log(`⏰ Queue size after 1s: ${delayedQueueSize}`);
          console.log(`⏰ Queue items after 1s: ${delayedQueueItems.length}`, delayedQueueItems.map(item => {
            const parsed = JSON.parse(item);
            return `${parsed.type}:${parsed.url}`;
          }));
          console.log(`⏰ Processing size after 1s: ${processingSize}`);
          console.log(`⏰ Processing items after 1s: ${processingItems.length}`, processingItems.map(item => {
            const parsed = JSON.parse(item);
            return `${parsed.type}:${parsed.url}`;
          }));
        } catch (error) {
          console.error('❌ Error checking delayed queue:', error);
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error adding item to queue:', error);
      throw error;
    }
  }

  /**
   * Запуск воркера
   */
  private static startWorker(workerId: string): void {
    this.workers.set(workerId, true);
    
    const processQueue = async () => {
      console.log(`👷 Worker ${workerId} started`);
      while (this.workers.get(workerId)) {
        try {
          await this.processNextItem(workerId);
          // Небольшая задержка между обработкой элементов
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`❌ Worker ${workerId} error:`, error);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Задержка при ошибке
        }
      }
    };

    processQueue();
    console.log(`👷 Worker ${workerId} started`);
  }

  /**
   * Обработка следующего элемента из очереди
   */
  private static async processNextItem(workerId: string): Promise<void> {
    try {
      // Получаем элемент с наивысшим приоритетом
      const result = await redisClient.zPopMax(this.PRIORITY_QUEUE_KEY);
      
      if (!result || !Array.isArray(result) || result.length === 0) {
        // Логируем только каждые 10 секунд, чтобы не засорять логи
        if (Math.random() < 0.01) { // 1% вероятность
          console.log(`👷 Worker ${workerId} checking queue - empty`);
        }
        return; // Очередь пуста
      }

      console.log(`🎯 Worker ${workerId} FOUND TASK! Result:`, result);

      console.log(`👷 Worker ${workerId} got task from queue:`, result);

      const queueItem: QueueItem = JSON.parse(result[0].value as string);
      
      // Перемещаем в очередь обработки
      await redisClient.lPush(this.PROCESSING_KEY, JSON.stringify(queueItem));
      
      console.log(`🔄 Worker ${workerId} processing: ${queueItem.url} (${queueItem.type})`);
      
      // Анализируем ссылку
      const analysisResult = await this.analyzeLink(queueItem);
      
      // Удаляем из очереди обработки
      await redisClient.lRem(this.PROCESSING_KEY, 1, JSON.stringify(queueItem));
      
      // Сохраняем результат
      await this.saveResult(analysisResult);
      
      // Отправляем real-time обновление
      await this.sendRealTimeUpdate(analysisResult);
      
      console.log(`✅ Worker ${workerId} completed: ${queueItem.url}`);
      
    } catch (error) {
      console.error(`❌ Worker ${workerId} processing error:`, error);
    }
  }

  /**
   * Анализ ссылки
   */
  private static async analyzeLink(queueItem: QueueItem): Promise<AnalysisResult> {
    try {
      let result: any;
      
      if (queueItem.type === 'manual') {
        // Анализ для manual links
        result = await LinkAnalyzer.analyzeLink(queueItem.url, queueItem.targetDomain);
      } else {
        // Для Google Sheets анализ происходит в GoogleSheetsService
        // Здесь мы просто возвращаем успешный результат
        result = { status: 'OK', message: 'Google Sheets analysis handled separately' };
      }
      
      return {
        id: queueItem.id,
        type: queueItem.type,
        userId: queueItem.userId,
        projectId: queueItem.projectId,
        linkId: queueItem.linkId,
        sheetId: queueItem.sheetId,
        result,
        success: true,
        processedAt: new Date()
      };
      
    } catch (error) {
      return {
        id: queueItem.id,
        type: queueItem.type,
        userId: queueItem.userId,
        projectId: queueItem.projectId,
        linkId: queueItem.linkId,
        sheetId: queueItem.sheetId,
        result: null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processedAt: new Date()
      };
    }
  }

  /**
   * Сохранение результата анализа
   */
  private static async saveResult(result: AnalysisResult): Promise<void> {
    try {
      if (result.type === 'manual' && result.linkId) {
        // Обновляем manual link
        await ManualLinkModel.update(result.linkId, {
          status: result.success ? 'OK' : 'Problem',
          response_code: result.result?.responseCode,
          indexable: result.result?.indexable,
          link_type: result.result?.linkType,
          canonical_url: result.result?.canonicalUrl,
          load_time: result.result?.loadTime,
          full_a_tag: result.result?.fullATag,
          non_indexable_reason: result.result?.nonIndexableReason,
          checked_at: result.processedAt
        });
      }
      
      // Сохраняем результат в Redis для истории
      await redisClient.lPush(this.RESULTS_KEY, JSON.stringify(result));
      
      // Ограничиваем размер истории (последние 1000 результатов)
      await redisClient.lTrim(this.RESULTS_KEY, 0, 999);
      
    } catch (error) {
      console.error('❌ Error saving analysis result:', error);
    }
  }

  /**
   * Отправка real-time обновления
   */
  private static async sendRealTimeUpdate(result: AnalysisResult): Promise<void> {
    try {
      if (result.type === 'manual') {
        SocketService.emitToProject(result.projectId, 'link_updated', {
          projectId: result.projectId,
          linkId: result.linkId,
          status: result.success ? result.result?.status : 'Problem',
          response_code: result.result?.responseCode,
          indexable: result.result?.indexable,
          link_type: result.result?.linkType,
          canonical_url: result.result?.canonicalUrl,
          load_time: result.result?.loadTime,
          full_a_tag: result.result?.fullATag,
          non_indexable_reason: result.result?.nonIndexableReason,
          checked_at: result.processedAt
        });

        // Проверяем, завершен ли анализ всех ссылок проекта
        await this.checkProjectAnalysisCompletion(result.projectId, 'manual');
      } else if (result.type === 'google_sheets') {
        SocketService.emitToProject(result.projectId, 'sheets_link_updated', {
          projectId: result.projectId,
          sheetId: result.sheetId,
          status: result.success ? 'OK' : 'Problem',
          message: result.success ? 'Link analyzed successfully' : result.error
        });

        // Проверяем, завершен ли анализ всех ссылок Google Sheets
        await this.checkProjectAnalysisCompletion(result.projectId, 'google_sheets');
      }
      
    } catch (error) {
      console.error('❌ Error sending real-time update:', error);
    }
  }

  /**
   * Проверка завершения анализа всех ссылок проекта
   */
  private static async checkProjectAnalysisCompletion(projectId: string, type: 'manual' | 'google_sheets'): Promise<void> {
    try {
      // Проверяем, есть ли еще ссылки в очереди для этого проекта
      const queueItems = await redisClient.zRange(this.PRIORITY_QUEUE_KEY, 0, -1);
      const processingItems = await redisClient.lRange(this.PROCESSING_KEY, 0, -1);
      
      const projectQueueItems = queueItems.filter(item => {
        const queueItem = JSON.parse(item);
        return queueItem.projectId === projectId && queueItem.type === type;
      });
      
      const projectProcessingItems = processingItems.filter(item => {
        const queueItem = JSON.parse(item);
        return queueItem.projectId === projectId && queueItem.type === type;
      });

      // Если нет ссылок в очереди и в обработке для этого проекта
      if (projectQueueItems.length === 0 && projectProcessingItems.length === 0) {
        // Проверяем, есть ли еще необработанные ссылки в БД
        const { ManualLinkModel } = await import('../models/ManualLink');
        const pendingLinks = await ManualLinkModel.findByProjectIdAndType(projectId, type);
        const unprocessedLinks = pendingLinks.filter(link => 
          link.status === 'pending' || link.status === 'checking'
        );

        if (unprocessedLinks.length === 0) {
          // Все ссылки обработаны - отправляем событие завершения
          const eventName = type === 'manual' ? 'analysis_completed' : 'sheets_analysis_completed';
          SocketService.emitToProject(projectId, eventName, {
            projectId,
            total: pendingLinks.length,
            processed: pendingLinks.length,
            message: `All ${type} links analysis completed`
          });
          
          console.log(`✅ ${type} analysis completed for project ${projectId}`);
        }
      }
      
    } catch (error) {
      console.error('❌ Error checking project analysis completion:', error);
    }
  }

  /**
   * Получение приоритета пользователя
   */
  private static getUserPriority(plan: string): number {
    switch (plan) {
      case 'enterprise':
        return 1; // Наивысший приоритет
      case 'pro':
        return 2;
      case 'starter':
        return 3;
      case 'free':
      default:
        return 4; // Наименьший приоритет
    }
  }

  /**
   * Вычисление score для приоритетной очереди
   */
  private static calculateScore(priority: number, createdAt: Date | string): number {
    const ts = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
    // БОльший score = выше приоритет и более ранняя задача
    // priority=1 (enterprise) должен быть выше priority=4 (free)
    return -priority * 1e13 - ts;
  }

  /**
   * Очистка очереди обработки (при перезапуске)
   */
  private static async clearProcessingQueue(): Promise<void> {
    try {
      const processingItems = await redisClient.lRange(this.PROCESSING_KEY, 0, -1);
      
      for (const item of processingItems) {
        const queueItem: QueueItem = JSON.parse(item);
        
        // Возвращаем в основную очередь
        const score = this.calculateScore(queueItem.priority, queueItem.createdAt);
        const member = { score, value: item };
        await redisClient.zAdd(this.PRIORITY_QUEUE_KEY, [member]);
      }
      
      // Очищаем очередь обработки
      await redisClient.del(this.PROCESSING_KEY);
      
      console.log(`🔄 Restored ${processingItems.length} items from processing queue`);
      
    } catch (error) {
      console.error('❌ Error clearing processing queue:', error);
    }
  }

  /**
   * Получение статистики очереди
   */
  static async getQueueStats(): Promise<{
    totalItems: number;
    processingItems: number;
    activeWorkers: number;
    priorityDistribution: Record<string, number>;
  }> {
    try {
      const totalItems = await redisClient.zCard(this.PRIORITY_QUEUE_KEY);
      const processingItems = await redisClient.lLen(this.PROCESSING_KEY);
      const activeWorkers = Array.from(this.workers.values()).filter(Boolean).length;
      
      // Получаем распределение по приоритетам
      const priorityDistribution: Record<string, number> = {};
      const allItems = await redisClient.zRange(this.PRIORITY_QUEUE_KEY, 0, -1);
      
      for (const item of allItems) {
        const queueItem: QueueItem = JSON.parse(item);
        const priorityName = this.getPriorityName(queueItem.priority);
        priorityDistribution[priorityName] = (priorityDistribution[priorityName] || 0) + 1;
      }
      
      return {
        totalItems,
        processingItems,
        activeWorkers,
        priorityDistribution
      };
      
    } catch (error) {
      console.error('❌ Error getting queue stats:', error);
      return {
        totalItems: 0,
        processingItems: 0,
        activeWorkers: 0,
        priorityDistribution: {}
      };
    }
  }

  /**
   * Получение детальной информации о проекте в очереди
   */
  static async getProjectQueueInfo(projectId: string): Promise<{
    queueItems: number;
    processingItems: number;
    items: Array<{
      id: string;
      type: string;
      url: string;
      priority: number;
      createdAt: string;
    }>;
  }> {
    try {
      const allQueueItems = await redisClient.zRange(this.PRIORITY_QUEUE_KEY, 0, -1);
      const allProcessingItems = await redisClient.lRange(this.PROCESSING_KEY, 0, -1);
      
      const projectQueueItems = allQueueItems.filter(item => {
        const queueItem = JSON.parse(item);
        return queueItem.projectId === projectId;
      });
      
      const projectProcessingItems = allProcessingItems.filter(item => {
        const queueItem = JSON.parse(item);
        return queueItem.projectId === projectId;
      });
      
      const items = [...projectQueueItems, ...projectProcessingItems].map(item => {
        const queueItem = JSON.parse(item);
        return {
          id: queueItem.id,
          type: queueItem.type,
          url: queueItem.url,
          priority: queueItem.priority,
          createdAt: queueItem.createdAt
        };
      });
      
      return {
        queueItems: projectQueueItems.length,
        processingItems: projectProcessingItems.length,
        items
      };
      
    } catch (error) {
      console.error('❌ Error getting project queue info:', error);
      return {
        queueItems: 0,
        processingItems: 0,
        items: []
      };
    }
  }

  /**
   * Получение имени приоритета
   */
  private static getPriorityName(priority: number): string {
    switch (priority) {
      case 1: return 'enterprise';
      case 2: return 'pro';
      case 3: return 'starter';
      case 4: return 'free';
      default: return 'unknown';
    }
  }

  /**
   * Остановка всех воркеров
   */
  static async shutdown(): Promise<void> {
    console.log('🛑 Shutting down Queue Service...');
    
    // Останавливаем всех воркеров
    for (const workerId of this.workers.keys()) {
      this.workers.set(workerId, false);
    }
    
    this.workers.clear();
    
    console.log('✅ Queue Service shutdown completed');
  }
}
