import { GoogleSheetModel } from '../models/GoogleSheet';
import { GoogleSheetsService } from './googleSheetsService';
import { SocketService } from './socketService';

export interface ScheduledTask {
  id: string;
  sheetId: string;
  projectId: string;
  userId: string;
  interval: string;
  nextRun: Date;
  isActive: boolean;
  lastRun?: Date | undefined;
  runCount: number;
  timerId?: NodeJS.Timeout; // ID таймера для отмены
}

export class SchedulerService {
  private static tasks: Map<string, ScheduledTask> = new Map();
  private static isInitialized = false;
  private static isShuttingDown = false;

  /**
   * Инициализация планировщика
   */
  static async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('🕐 Scheduler Service already initialized');
      return;
    }

    console.log('🕐 Initializing Scheduler Service...');
    
    try {
      // Загружаем активные Google Sheets из БД
      const activeSheets = await GoogleSheetModel.getActiveSheets();
      console.log(`📋 Found ${activeSheets.length} active Google Sheets to schedule`);
      
      // Создаем задачи для каждого листа
      for (const sheet of activeSheets) {
        if (sheet.schedule_interval && sheet.schedule_interval !== 'manual') {
          await this.scheduleSheet(
            sheet.id, 
            sheet.project_id, 
            sheet.schedule_interval, 
            sheet.next_scan instanceof Date ? sheet.next_scan : undefined
          );
        }
      }
      
      this.isInitialized = true;
      console.log('✅ Scheduler Service initialized successfully');
      
    } catch (error) {
      console.error('❌ Error initializing Scheduler Service:', error);
      throw error;
    }
  }

  /**
   * Планирование Google Sheet для автоматического анализа
   */
  static async scheduleSheet(
    sheetId: string, 
    projectId: string, 
    interval: string, 
    nextRun?: Date
  ): Promise<void> {
    try {
      // Отменяем существующую задачу если есть
      await this.cancelSheet(sheetId);
      
      // Вычисляем время следующего запуска
      let nextRunTime: Date;
      
      if (nextRun && nextRun instanceof Date && !isNaN(nextRun.getTime())) {
        // Используем переданное время
        nextRunTime = nextRun;
      } else {
        // Вычисляем новое время на основе интервала
        nextRunTime = this.calculateNextRun(interval);
      }
      
      // Создаем задачу
      const task: ScheduledTask = {
        id: `task_${sheetId}`,
        sheetId,
        projectId,
        userId: '', // Будет заполнено при выполнении
        interval,
        nextRun: nextRunTime,
        isActive: true,
        runCount: 0
      };
      
      // Сохраняем задачу
      this.tasks.set(sheetId, task);
      
      // Создаем таймер
      const timeUntilRun = nextRunTime.getTime() - Date.now();
      
      console.log(`🕐 Current time: ${new Date().toISOString()}`);
      console.log(`🕐 Next run time: ${nextRunTime.toISOString()}`);
      console.log(`🕐 Time until run: ${timeUntilRun}ms (${Math.round(timeUntilRun / 1000)}s)`);
      
      if (timeUntilRun > 0) {
        console.log(`⏰ Creating timer for Google Sheet ${sheetId} (${Math.round(timeUntilRun / 1000)}s from now)`);
        
        const timerId = setTimeout(async () => {
          console.log(`🔔 Timer triggered for Google Sheet ${sheetId}`);
          await this.executeScheduledAnalysis(sheetId);
        }, timeUntilRun);
        
        task.timerId = timerId;
        console.log(`✅ Timer created with ID: ${timerId}`);
        
        // Обновляем next_scan в БД
        await GoogleSheetModel.update(sheetId, { next_scan: nextRunTime });
        
        console.log(`✅ Scheduled Google Sheet ${sheetId} successfully`);
      } else {
        console.log(`⚠️ Google Sheet ${sheetId} scheduled time is in the past, running immediately`);
        await this.executeScheduledAnalysis(sheetId);
      }
      
    } catch (error) {
      console.error(`❌ Error scheduling Google Sheet ${sheetId}:`, error);
      throw error;
    }
  }

  /**
   * Отмена планирования Google Sheet
   */
  static async cancelSheet(sheetId: string): Promise<void> {
    try {
      const task = this.tasks.get(sheetId);
      
      if (task) {
        // Отменяем таймер
        if (task.timerId) {
          clearTimeout(task.timerId);
        }
        
        // Удаляем задачу
        this.tasks.delete(sheetId);
        
        // Обновляем статус в БД
        await GoogleSheetModel.update(sheetId, { 
          status: 'inactive'
        });
        
        console.log(`🚫 Cancelled scheduling for Google Sheet ${sheetId}`);
      }
      
    } catch (error) {
      console.error(`❌ Error cancelling Google Sheet ${sheetId}:`, error);
      throw error;
    }
  }

  /**
   * Выполнение запланированного анализа
   */
  private static async executeScheduledAnalysis(sheetId: string): Promise<void> {
    try {
      console.log(`🚀 Starting scheduled analysis for Google Sheet: ${sheetId}`);
      
      const task = this.tasks.get(sheetId);
      
      if (!task || !task.isActive) {
        console.log(`⚠️ Task for Google Sheet ${sheetId} not found or inactive`);
        return;
      }
      
      console.log(`🕐 Scheduled task triggered for sheet: ${sheetId}`);
      
      // Обновляем счетчик запусков
      task.runCount++;
      task.lastRun = new Date();
      
      // Выполняем анализ через GoogleSheetsService
      await GoogleSheetsService.analyzeGoogleSheet(sheetId);
      
      // Планируем следующий запуск
      const nextRunTime = this.calculateNextRun(task.interval);
      task.nextRun = nextRunTime;
      
      // Создаем новый таймер для следующего запуска
      const timeUntilNextRun = nextRunTime.getTime() - Date.now();
      
      if (timeUntilNextRun > 0) {
        console.log(`⏰ Next run scheduled for ${nextRunTime.toISOString()} (in ${Math.round(timeUntilNextRun / 1000)}s)`);
        
        const timerId = setTimeout(async () => {
          await this.executeScheduledAnalysis(sheetId);
        }, timeUntilNextRun);
        
        task.timerId = timerId;
        
        // Обновляем next_scan в БД
        await GoogleSheetModel.update(sheetId, { next_scan: nextRunTime });
      }
      
    } catch (error) {
      console.error(`❌ Error executing scheduled analysis for sheet ${sheetId}:`, error);
      
      // Отправляем ошибку через Socket.IO
      const task = this.tasks.get(sheetId);
      if (task) {
        SocketService.emitToProject(task.projectId, 'sheets_analysis_error', {
          sheetId,
          error: (error as Error).message
        });
      }
    }
  }

  /**
   * Вычисление времени следующего запуска
   */
  private static calculateNextRun(interval: string): Date {
    const now = new Date();
    
    switch (interval) {
      case '5m':
        return new Date(now.getTime() + 5 * 60 * 1000);
      case '30m':
        return new Date(now.getTime() + 30 * 60 * 1000);
      case '1h':
        return new Date(now.getTime() + 60 * 60 * 1000);
      case '4h':
        return new Date(now.getTime() + 4 * 60 * 60 * 1000);
      case '8h':
        return new Date(now.getTime() + 8 * 60 * 60 * 1000);
      case '12h':
        return new Date(now.getTime() + 12 * 60 * 60 * 1000);
      case '1d':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case '3d':
        return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      case '1w':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case '1M':
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        return nextMonth;
      default:
        return new Date(now.getTime() + 60 * 60 * 1000); // По умолчанию 1 час
    }
  }

  /**
   * Получение всех запланированных задач
   */
  static getScheduledTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Получение конкретной задачи
   */
  static getTask(sheetId: string): ScheduledTask | undefined {
    return this.tasks.get(sheetId);
  }

  /**
   * Получение статуса планировщика
   */
  static getStatus(): { isInitialized: boolean; activeTasks: number; tasks: ScheduledTask[] } {
    return {
      isInitialized: this.isInitialized,
      activeTasks: this.tasks.size,
      tasks: Array.from(this.tasks.values())
    };
  }

  /**
   * Graceful shutdown
   */
  static async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    console.log('🕐 Shutting down Scheduler Service...');
    
    // Отменяем все таймеры
    for (const [, task] of this.tasks) {
      if (task.timerId) {
        clearTimeout(task.timerId);
      }
    }
    
    // Очищаем задачи
    this.tasks.clear();
    
    this.isInitialized = false;
    console.log('✅ Scheduler Service shut down successfully');
  }
}