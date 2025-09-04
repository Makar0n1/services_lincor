import { Request, Response } from 'express';
import Joi from 'joi';
import { ManualLinkModel, CreateManualLinkData } from '../models/ManualLink';
import { UserModel } from '../models/User';
import { LinkAnalyzer } from '../services/linkAnalyzer';
import { FileProcessor } from '../services/fileProcessor';
import { BullMQService } from '../services/bullmqService';
import { SocketService } from '../services/socketService';

// Схемы валидации
const addLinksSchema = Joi.object({
  links: Joi.array().items(
    Joi.object({
      url: Joi.string().uri().required(),
      target_domain: Joi.string().required()
    })
  ).min(1).max(100).required()
});

const checkLinksSchema = Joi.object({
  // Пустая схема, так как мы не принимаем параметры
});

export class ManualLinksController {
  // Валидация ID
  private static validateId(id: string | undefined, res: Response, name: string = 'ID'): id is string {
    if (!id) {
      res.status(400).json({
        success: false,
        message: `${name} is required`
      });
      return false;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(400).json({
        success: false,
        message: `Invalid ${name} format`
      });
      return false;
    }

    return true;
  }

  // Добавление ссылок
  static async addLinks(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;

      // Валидация входных данных
      const { error, value } = addLinksSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      const { links } = value;

      // Проверка лимитов пользователя
      const canAdd = await UserModel.canAddLinks(req.user!.userId, links.length);
      if (!canAdd) {
        const limits = UserModel.getPlanLimits(req.user!.subscriptionPlan);
        res.status(403).json({
          success: false,
          message: `Link limit reached. Your plan allows ${limits.linksPerMonth} links per month.`
        });
        return;
      }

      // Подготовка данных для создания ссылок
      const linksToCreate: CreateManualLinkData[] = links.map((link: any) => ({
        project_id: projectId,
        url: link.url,
        target_domain: LinkAnalyzer.normalizeTargetDomain(link.target_domain),
        original_target_domain: link.target_domain,
        type: 'manual' as const
      }));

      // Создание ссылок
      const createdLinks = await ManualLinkModel.createMany(linksToCreate);

      res.status(201).json({
        success: true,
        message: `Successfully added ${createdLinks.length} links`,
        data: {
          links: createdLinks.map(link => ({
            id: link.id,
            url: link.url,
            target_domain: link.original_target_domain || link.target_domain,
            type: link.type,
            status: link.status,
            created_at: link.created_at
          }))
        }
      });

    } catch (error) {
      console.error('Add links error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add links'
      });
    }
  }

  // Получение ссылок проекта
  static async getLinks(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;

      const page = parseInt(req.query['page'] as string) || 1;
      const limit = parseInt(req.query['limit'] as string) || 50;
      const status = req.query['status'] as string;
      const linkType = req.query['linkType'] as string;
      const responseCode = req.query['responseCode'] ? parseInt(req.query['responseCode'] as string) : undefined;

      const filters = {
        ...(status && { status }),
        ...(linkType && { linkType }),
        ...(responseCode && { responseCode })
      };

      const result = await ManualLinkModel.findByProjectIdPaginated(
        projectId,
        page,
        limit,
        Object.keys(filters).length > 0 ? filters : undefined
      );

      res.status(200).json({
        success: true,
        data: {
          links: result.links,
          pagination: {
            page: result.pages,
            limit,
            total: result.total,
            pages: result.pages
          }
        }
      });

    } catch (error) {
      console.error('Get links error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get links'
      });
    }
  }

  // Запуск анализа ссылок
  static async checkLinks(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;

      // Валидация входных данных
      const { error } = checkLinksSchema.validate(req.body || {});
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      // Получаем все ссылки проекта для анализа
      const links = await ManualLinkModel.findByProjectId(projectId);
      
      if (links.length === 0) {
        res.status(400).json({
          success: false,
          message: 'No links found for analysis'
        });
        return;
      }

      // Запускаем анализ асинхронно
      ManualLinksController.startLinkAnalysis(projectId, links, req.user!.userId);

      res.status(200).json({
        success: true,
        message: `Analysis started for ${links.length} links`,
        data: {
          totalLinks: links.length,
          status: 'started'
        }
      });

    } catch (error) {
      console.error('Check links error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start analysis'
      });
    }
  }

  // Удаление ссылки
  static async deleteLink(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      const linkId = req.params['linkId'];
      
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;
      if (!ManualLinksController.validateId(linkId, res, 'Link ID')) return;

      const deleted = await ManualLinkModel.delete(linkId);
      
      if (!deleted) {
        res.status(404).json({
          success: false,
          message: 'Link not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Link deleted successfully'
      });

    } catch (error) {
      console.error('Delete link error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete link'
      });
    }
  }

  // Удаление всех ссылок проекта
  static async deleteAllLinks(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;

      const deletedCount = await ManualLinkModel.deleteByProjectId(projectId);

      res.status(200).json({
        success: true,
        message: `Successfully deleted ${deletedCount} links`,
        data: {
          deletedCount
        }
      });

    } catch (error) {
      console.error('Delete all links error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete links'
      });
    }
  }

  // Экспорт ссылок в CSV
  static async exportLinks(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;

      // Проверяем, есть ли результаты анализа
      const stats = await ManualLinkModel.getProjectLinkStats(projectId);
      if (stats.analyzedLinks === 0) {
        res.status(400).json({
          success: false,
          message: 'No analysis results found. Please run analysis first.'
        });
        return;
      }

      const csvContent = await ManualLinkModel.exportToCSV(projectId);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="project-${projectId}-links.csv"`);
      res.status(200).send(csvContent);

    } catch (error) {
      console.error('Export links error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export links'
      });
    }
  }

  // Получение статистики проекта
  static async getProjectStats(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;

      const stats = await ManualLinkModel.getProjectLinkStats(projectId);

      res.status(200).json({
        success: true,
        data: {
          stats
        }
      });

    } catch (error) {
      console.error('Get project stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get project stats'
      });
    }
  }

  // Импорт ссылок из файла
  static async importLinks(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;

      if (!req.file) {
        res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
        return;
      }

      console.log('Processing file:', req.file.filename, 'Type:', req.file.mimetype);

      // Обрабатываем файл
      const importedLinks = await FileProcessor.processFile(req.file.path, req.file.mimetype);
      
      if (importedLinks.length === 0) {
        res.status(400).json({
          success: false,
          message: 'No valid links found in file. Please check file format.'
        });
        return;
      }

      // Проверяем лимиты пользователя
      const canAdd = await UserModel.canAddLinks(req.user!.userId, importedLinks.length);
      if (!canAdd) {
        const limits = UserModel.getPlanLimits(req.user!.subscriptionPlan);
        res.status(403).json({
          success: false,
          message: `Link limit reached. Your plan allows ${limits.linksPerMonth} links per month.`
        });
        return;
      }

      // Подготавливаем данные для создания ссылок
      const linksToCreate: CreateManualLinkData[] = importedLinks.map(link => ({
        project_id: projectId,
        url: link.url,
        target_domain: LinkAnalyzer.normalizeTargetDomain(link.target_domain),
        original_target_domain: link.target_domain,
        type: 'manual' as const
      }));

      // Создаем ссылки
      const createdLinks = await ManualLinkModel.createMany(linksToCreate);

      // Очищаем временный файл
      await FileProcessor.cleanupFile(req.file.path);

      res.status(201).json({
        success: true,
        message: `Successfully imported ${createdLinks.length} links from file`,
        data: {
          imported: createdLinks.length,
          links: createdLinks.map(link => ({
            id: link.id,
            url: link.url,
            target_domain: link.original_target_domain || link.target_domain,
            type: link.type,
            status: link.status,
            created_at: link.created_at
          }))
        }
      });

    } catch (error) {
      console.error('Import links error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to import links'
      });
    }
  }

  // Получение информации о очереди проекта
  static async getProjectQueueInfo(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params['id'];
      if (!ManualLinksController.validateId(projectId, res, 'Project ID')) return;

      const queueInfo = await BullMQService.getProjectQueueInfo(projectId);

      res.status(200).json({
        success: true,
        data: {
          projectId,
          queueInfo
        }
      });

    } catch (error) {
      console.error('Get project queue info error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get project queue info'
      });
    }
  }

  // Запуск анализа ссылок (приватный метод)
  private static async startLinkAnalysis(projectId: string, links: any[], userId: string): Promise<void> {
    try {
      console.log(`🔍 Starting analysis for ${links.length} links in project ${projectId}`);

      // Сбрасываем только результаты анализа, но не сами ссылки
      await ManualLinkModel.resetAnalysisStatus(projectId, 'manual');

      // Отправляем событие о начале анализа
      SocketService.emitToProject(projectId, 'analysis_started', {
        projectId,
        total: links.length,
        processed: 0
      });

      // Добавляем все ссылки в очередь анализа BullMQ
      for (const link of links) {
        await BullMQService.addLinkAnalysisJob(
          'manual',
          userId,
          projectId,
          link.url,
          link.target_domain,
          link.id
        );
      }

      console.log(`📥 Added ${links.length} manual links to analysis queue`);

      // НЕ отправляем analysis_completed здесь - это будет сделано воркерами
      // когда они завершат обработку всех ссылок
      console.log(`✅ Manual links analysis queued for project ${projectId}`);



    } catch (error) {
      console.error('Link analysis error:', error);
      SocketService.emitToProject(projectId, 'analysis_error', {
        projectId,
        error: 'Analysis failed'
      });
    }
  }
}
