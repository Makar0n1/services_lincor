import { Queue, Worker, Job, QueueEvents } from 'bullmq';
// Redis connection будет настроен в BullMQ
import { LinkAnalyzer } from './linkAnalyzer';
import { LinkAnalysisResult } from '../models/ManualLink';
import { ManualLinkModel } from '../models/ManualLink';
import { SocketService } from './socketService';

// Интерфейсы для задач
export interface LinkAnalysisJobData {
  id: string;
  type: 'manual' | 'google_sheets';
  userId: string;
  projectId: string;
  linkId?: string;
  sheetId?: string;
  url: string;
  targetDomain: string;
  priority: number; // 1 = highest (enterprise), 4 = lowest (free)
  attempts?: number;
}

export interface AnalysisJobResult {
  success: boolean;
  result?: LinkAnalysisResult;
  error?: string;
  processedAt: Date;
}

export class BullMQService {
  private static linkAnalysisQueue: Queue<LinkAnalysisJobData> | null = null;
  private static linkAnalysisWorker: Worker<LinkAnalysisJobData, AnalysisJobResult> | null = null;
  private static queueEvents: QueueEvents | null = null;
  private static isInitialized = false;

  // Конфигурация очереди
  private static readonly QUEUE_NAME = 'link-analysis';
  private static readonly MAX_WORKERS = parseInt(process.env['WORKER_CONCURRENT_LINKS'] || '5');
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly BACKOFF_DELAY = 2000; // 2 секунды

  /**
   * Инициализация BullMQ сервиса
   */
  static async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('🔄 BullMQ Service already initialized');
      return;
    }

    try {
      console.log('🚀 Initializing BullMQ Service...');

      // Создаем очередь
      this.linkAnalysisQueue = new Queue<LinkAnalysisJobData>(this.QUEUE_NAME, {
        connection: {
          host: process.env['REDIS_HOST'] || 'localhost',
          port: parseInt(process.env['REDIS_PORT'] || '6379'),
          ...(process.env['REDIS_PASSWORD'] ? { password: process.env['REDIS_PASSWORD'] } : {}),
        },
        defaultJobOptions: {
          removeOnComplete: 100, // Храним последние 100 завершенных задач
          removeOnFail: 50, // Храним последние 50 неудачных задач
          attempts: this.MAX_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: this.BACKOFF_DELAY,
          },
        },
      });

      // Создаем воркер
      this.linkAnalysisWorker = new Worker<LinkAnalysisJobData, AnalysisJobResult>(
        this.QUEUE_NAME,
        this.processLinkAnalysisJob.bind(this),
        {
          connection: {
            host: process.env['REDIS_HOST'] || 'localhost',
            port: parseInt(process.env['REDIS_PORT'] || '6379'),
            ...(process.env['REDIS_PASSWORD'] ? { password: process.env['REDIS_PASSWORD'] } : {}),
          },
          concurrency: this.MAX_WORKERS,
        }
      );

      // Создаем события очереди для мониторинга
      this.queueEvents = new QueueEvents(this.QUEUE_NAME, {
        connection: {
          host: process.env['REDIS_HOST'] || 'localhost',
          port: parseInt(process.env['REDIS_PORT'] || '6379'),
          ...(process.env['REDIS_PASSWORD'] ? { password: process.env['REDIS_PASSWORD'] } : {}),
        },
      });

      // Настраиваем обработчики событий
      this.setupEventHandlers();

      // Очищаем старые задачи при запуске
      await this.cleanupOldJobs();

      this.isInitialized = true;
      console.log('✅ BullMQ Service initialized successfully');
      console.log(`👷 Max workers: ${this.MAX_WORKERS}`);
      console.log(`🔄 Max attempts: ${this.MAX_ATTEMPTS}`);

    } catch (error) {
      console.error('❌ Failed to initialize BullMQ Service:', error);
      throw error;
    }
  }

  /**
   * Добавление задачи в очередь
   */
  static async addLinkAnalysisJob(
    type: 'manual' | 'google_sheets',
    userId: string,
    projectId: string,
    url: string,
    targetDomain: string,
    linkId?: string,
    sheetId?: string
  ): Promise<void> {
    if (!this.linkAnalysisQueue) {
      throw new Error('BullMQ Service not initialized');
    }

    try {
      // Получаем приоритет пользователя
      const priority = await this.getUserPriority(userId);
      
      const jobData: LinkAnalysisJobData = {
        id: `${type}:${url}`,
        type,
        userId,
        projectId,
        ...(linkId && { linkId }),
        ...(sheetId && { sheetId }),
        url,
        targetDomain,
        priority,
        attempts: 0,
      };

      // Добавляем задачу с приоритетом
      await this.linkAnalysisQueue.add(
        'analyze-link',
        jobData,
        {
          priority: priority, // BullMQ: 1 = highest, 4 = lowest
          jobId: jobData.id, // Уникальный ID для предотвращения дубликатов
        }
      );

      console.log(`📥 Added job to BullMQ queue: ${jobData.id} (priority: ${priority})`);
      console.log(`📊 Queue size: ${await this.linkAnalysisQueue.getWaiting()}`);

    } catch (error) {
      console.error('❌ Failed to add job to BullMQ queue:', error);
      throw error;
    }
  }

  /**
   * Обработка задачи анализа ссылки
   */
  private static async processLinkAnalysisJob(
    job: Job<LinkAnalysisJobData>
  ): Promise<AnalysisJobResult> {
    const { id, type, userId, projectId, linkId, sheetId, url, targetDomain } = job.data;

    console.log(`🎯 Worker processing job: ${id} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);

    try {
      // Анализируем ссылку
      const result = await LinkAnalyzer.analyzeLink(url, targetDomain);

      // Сохраняем результат в БД
      if (type === 'manual' && linkId) {
        await ManualLinkModel.update(linkId, {
          status: result.status,
          response_code: result.responseCode,
          indexable: result.indexable,
          link_type: result.linkType,
          ...(result.canonicalUrl && { canonical_url: result.canonicalUrl }),
          load_time: result.loadTime,
          ...(result.fullATag && { full_a_tag: result.fullATag }),
          ...(result.nonIndexableReason && { non_indexable_reason: result.nonIndexableReason }),
          checked_at: new Date(),
        });
      }

      // Отправляем real-time обновление
      await this.sendRealTimeUpdate({
        type,
        userId,
        projectId,
        ...(linkId && { linkId }),
        ...(sheetId && { sheetId }),
        result,
        success: true,
        processedAt: new Date(),
      });

      console.log(`✅ Job completed successfully: ${id}`);

      return {
        success: true,
        result,
        processedAt: new Date(),
      };

    } catch (error) {
      console.error(`❌ Job failed: ${id}`, error);

      // Отправляем обновление об ошибке
      await this.sendRealTimeUpdate({
        type,
        userId,
        projectId,
        ...(linkId && { linkId }),
        ...(sheetId && { sheetId }),
        result: null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processedAt: new Date(),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processedAt: new Date(),
      };
    }
  }

  /**
   * Отправка real-time обновлений
   */
  private static async sendRealTimeUpdate(data: {
    type: 'manual' | 'google_sheets';
    userId: string;
    projectId: string;
    linkId?: string;
    sheetId?: string;
    result: LinkAnalysisResult | null;
    success: boolean;
    error?: string;
    processedAt: Date;
  }): Promise<void> {
    try {
      if (data.type === 'manual' && data.linkId) {
        SocketService.emitToProject(data.projectId, 'link_updated', {
          linkId: data.linkId,
          status: data.result?.status || 'Problem',
          responseCode: data.result?.responseCode || 0,
          indexable: data.result?.indexable || false,
          linkType: data.result?.linkType || 'not_found',
          canonicalUrl: data.result?.canonicalUrl,
          loadTime: data.result?.loadTime || 0,
          nonIndexableReason: data.result?.nonIndexableReason,
          checkedAt: data.processedAt,
        });
      }

      // Проверяем завершение анализа проекта
      await this.checkProjectAnalysisCompletion(data.projectId, data.type);

    } catch (error) {
      console.error('❌ Failed to send real-time update:', error);
    }
  }

  /**
   * Проверка завершения анализа проекта
   */
  private static async checkProjectAnalysisCompletion(
    projectId: string,
    type: 'manual' | 'google_sheets'
  ): Promise<void> {
    try {
      // Проверяем, есть ли еще задачи в очереди для этого проекта
      const waitingJobs = await this.linkAnalysisQueue?.getWaiting();
      const activeJobs = await this.linkAnalysisQueue?.getActive();
      
      const projectJobs = [...(waitingJobs || []), ...(activeJobs || [])]
        .filter(job => job.data.projectId === projectId && job.data.type === type);

      if (projectJobs.length === 0) {
        // Проверяем, есть ли еще pending/checking ссылки в БД
        const pendingLinks = await ManualLinkModel.findByProjectIdAndType(projectId, type);
        const hasPendingLinks = pendingLinks.some(link => 
          link.status === 'pending' || link.status === 'checking'
        );

        if (!hasPendingLinks) {
          console.log(`🎉 Analysis completed for project ${projectId} (${type})`);
          SocketService.emitToProject(projectId, 'analysis_completed', {
            projectId,
            type,
            total: pendingLinks.length,
            processed: pendingLinks.length,
          });
        }
      }
    } catch (error) {
      console.error('❌ Failed to check project analysis completion:', error);
    }
  }

  /**
   * Получение приоритета пользователя
   */
  private static async getUserPriority(_userId: string): Promise<number> {
    try {
      // Здесь можно добавить запрос к БД для получения плана пользователя
      // Пока используем статическую логику
      return 1; // Enterprise по умолчанию
    } catch (error) {
      console.error('❌ Failed to get user priority:', error);
      return 4; // Free по умолчанию при ошибке
    }
  }

  /**
   * Настройка обработчиков событий
   */
  private static setupEventHandlers(): void {
    if (!this.queueEvents) return;

    this.queueEvents.on('completed', (jobId, _result) => {
      console.log(`✅ Job completed: ${jobId}`);
    });

    this.queueEvents.on('failed', (jobId, err) => {
      console.error(`❌ Job failed: ${jobId}`, err);
    });

    this.queueEvents.on('stalled', (jobId) => {
      console.warn(`⚠️ Job stalled: ${jobId}`);
    });

    this.queueEvents.on('progress', (jobId, progress) => {
      console.log(`📊 Job progress: ${jobId} - ${progress}%`);
    });
  }

  /**
   * Очистка старых задач
   */
  private static async cleanupOldJobs(): Promise<void> {
    if (!this.linkAnalysisQueue) return;

    try {
      // Очищаем старые завершенные и неудачные задачи
      await this.linkAnalysisQueue.clean(24 * 60 * 60 * 1000, 100, 'completed'); // 24 часа
      await this.linkAnalysisQueue.clean(7 * 24 * 60 * 60 * 1000, 50, 'failed'); // 7 дней
      
      console.log('🧹 Cleaned up old jobs');
    } catch (error) {
      console.error('❌ Failed to cleanup old jobs:', error);
    }
  }

  /**
   * Получение статистики очереди
   */
  static async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    if (!this.linkAnalysisQueue) {
      throw new Error('BullMQ Service not initialized');
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.linkAnalysisQueue.getWaiting(),
      this.linkAnalysisQueue.getActive(),
      this.linkAnalysisQueue.getCompleted(),
      this.linkAnalysisQueue.getFailed(),
      this.linkAnalysisQueue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Получение информации о задачах проекта
   */
  static async getProjectQueueInfo(projectId: string): Promise<{
    waiting: number;
    active: number;
    jobs: Array<{
      id: string;
      type: string;
      url: string;
      priority: number;
      attempts: number;
    }>;
  }> {
    if (!this.linkAnalysisQueue) {
      throw new Error('BullMQ Service not initialized');
    }

    const [waiting, active] = await Promise.all([
      this.linkAnalysisQueue.getWaiting(),
      this.linkAnalysisQueue.getActive(),
    ]);

    const projectJobs = [...waiting, ...active]
      .filter(job => job.data.projectId === projectId)
      .map(job => ({
        id: job.id as string,
        type: job.data.type,
        url: job.data.url,
        priority: job.data.priority,
        attempts: job.attemptsMade,
      }));

    return {
      waiting: waiting.filter(job => job.data.projectId === projectId).length,
      active: active.filter(job => job.data.projectId === projectId).length,
      jobs: projectJobs,
    };
  }

  /**
   * Остановка сервиса
   */
  static async shutdown(): Promise<void> {
    console.log('🛑 Shutting down BullMQ Service...');

    try {
      if (this.linkAnalysisWorker) {
        await this.linkAnalysisWorker.close();
        this.linkAnalysisWorker = null;
      }

      if (this.linkAnalysisQueue) {
        await this.linkAnalysisQueue.close();
        this.linkAnalysisQueue = null;
      }

      if (this.queueEvents) {
        await this.queueEvents.close();
        this.queueEvents = null;
      }

      this.isInitialized = false;
      console.log('✅ BullMQ Service shutdown complete');

    } catch (error) {
      console.error('❌ Error during BullMQ Service shutdown:', error);
    }
  }
}
