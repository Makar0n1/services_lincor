import { Request, Response } from 'express';
import Joi from 'joi';
import { GoogleSheetModel } from '../models/GoogleSheet';
import { ProjectModel } from '../models/Project';
import { GoogleSheetsService } from '../services/googleSheetsService';

// Схемы валидации
const createGoogleSheetSchema = Joi.object({
  spreadsheet_url: Joi.string().uri().required().messages({
    'string.uri': 'Spreadsheet URL must be a valid URI',
    'any.required': 'Spreadsheet URL is required'
  }),
  target_domain: Joi.string().min(1).max(255).required().messages({
    'string.min': 'Target domain must be at least 1 character',
    'string.max': 'Target domain must not exceed 255 characters',
    'any.required': 'Target domain is required'
  }),
  url_column: Joi.string().pattern(/^[A-Z]+$/).required().messages({
    'string.pattern.base': 'URL column must be a valid column letter (A, B, C, etc.)',
    'any.required': 'URL column is required'
  }),
  target_column: Joi.string().pattern(/^[A-Z]+$/).required().messages({
    'string.pattern.base': 'Target column must be a valid column letter (A, B, C, etc.)',
    'any.required': 'Target column is required'
  }),
  result_range_start: Joi.string().pattern(/^[A-Z]+$/).required().messages({
    'string.pattern.base': 'Result range start must be a valid column letter (A, B, C, etc.)',
    'any.required': 'Result range start is required'
  }),
  result_range_end: Joi.string().pattern(/^[A-Z]+$/).required().messages({
    'string.pattern.base': 'Result range end must be a valid column letter (A, B, C, etc.)',
    'any.required': 'Result range end is required'
  }),
  schedule_interval: Joi.string().valid(
    'manual', '5m', '30m', '1h', '4h', '8h', '12h', '1d', '3d', '1w', '1M'
  ).required().messages({
    'any.only': 'Schedule interval must be one of: manual, 5m, 30m, 1h, 4h, 8h, 12h, 1d, 3d, 1w, 1M',
    'any.required': 'Schedule interval is required'
  })
});

const updateGoogleSheetSchema = Joi.object({
  target_domain: Joi.string().min(1).max(255).optional(),
  url_column: Joi.string().pattern(/^[A-Z]+$/).optional(),
  target_column: Joi.string().pattern(/^[A-Z]+$/).optional(),
  result_range_start: Joi.string().pattern(/^[A-Z]+$/).optional(),
  result_range_end: Joi.string().pattern(/^[A-Z]+$/).optional(),
  schedule_interval: Joi.string().valid(
    'manual', '5m', '30m', '1h', '4h', '8h', '12h', '1d', '3d', '1w', '1M'
  ).optional()
});

export class GoogleSheetsController {
  // Валидация ID
  private static validateId(id: string | undefined, res: Response, name: string = 'ID'): id is string {
    if (!id) {
      res.status(400).json({
        success: false,
        message: `${name} is required`
      });
      return false;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(400).json({
        success: false,
        message: `Invalid ${name} format`
      });
      return false;
    }

    return true;
  }

  // Создание Google Sheet записи
  static async createGoogleSheet(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const { error, value } = createGoogleSheetSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      const projectId = req.params['id'];
      if (!GoogleSheetsController.validateId(projectId, res, 'Project ID')) return;

      // Проверяем, что проект принадлежит пользователю
      const project = await ProjectModel.findByIdAndOwner(projectId, req.user.userId);
      if (!project) {
        res.status(404).json({
          success: false,
          message: 'Project not found or access denied'
        });
        return;
      }

      // Валидируем диапазон результатов (должен быть ровно 5 столбцов)
      if (!GoogleSheetModel.validateResultRange(value.result_range_start, value.result_range_end)) {
        res.status(400).json({
          success: false,
          message: 'Result range must contain exactly 5 columns'
        });
        return;
      }

      // Парсим URL Google Sheets
      const urlData = GoogleSheetModel.parseSpreadsheetUrl(value.spreadsheet_url);
      if (!urlData) {
        res.status(400).json({
          success: false,
          message: 'Invalid Google Sheets URL format'
        });
        return;
      }

      console.log('Parsed Google Sheets URL:', {
        originalUrl: value.spreadsheet_url,
        spreadsheetId: urlData.spreadsheetId,
        gid: urlData.gid
      });

      // Проверяем доступность таблицы и читаем данные
      let sheetData;
      let warningMessage = '';
      
      try {
        sheetData = await GoogleSheetsService.readSheetData(
          urlData.spreadsheetId,
          urlData.gid,
          value.url_column,
          value.target_column,
          value.result_range_start,
          value.result_range_end,
          value.target_domain
        );

        if (sheetData.hasExistingData) {
          warningMessage = 'Warning: Existing data found in result range. It will be overwritten during analysis.';
        }

        if (sheetData.totalRows === 0) {
          res.status(400).json({
            success: false,
            message: 'No valid URLs found in the specified columns'
          });
          return;
        }

      } catch (error) {
        res.status(400).json({
          success: false,
          message: `Failed to access Google Sheet: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
        return;
      }

      // Создаем запись в базе данных
      const sheetData_create: any = {
        project_id: projectId,
        user_id: req.user.userId,
        ...value
      };

      const createdSheet = await GoogleSheetModel.create(sheetData_create);

      res.status(201).json({
        success: true,
        message: 'Google Sheet added successfully',
        data: {
          sheet: createdSheet,
          stats: {
            totalLinks: sheetData.totalRows,
            uniqueDomains: sheetData.uniqueUrls,
            hasExistingData: sheetData.hasExistingData
          },
          warning: warningMessage || undefined
        }
      });

    } catch (error) {
      console.error('Create Google Sheet error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create Google Sheet'
      });
    }
  }

  // Получение Google Sheets проекта
  static async getGoogleSheets(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const projectId = req.params['id'];
      if (!GoogleSheetsController.validateId(projectId, res, 'Project ID')) return;

      const sheets = await GoogleSheetModel.findByProjectIdWithStats(projectId);

      res.json({
        success: true,
        data: {
          sheets,
          total: sheets.length
        }
      });

    } catch (error) {
      console.error('Get Google Sheets error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get Google Sheets'
      });
    }
  }

  // Получение конкретной Google Sheet
  static async getGoogleSheet(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const sheetId = req.params['sheetId'];
      if (!GoogleSheetsController.validateId(sheetId, res, 'Sheet ID')) return;

      const sheet = await GoogleSheetModel.findByIdAndOwner(sheetId, req.user.userId);
      if (!sheet) {
        res.status(404).json({
          success: false,
          message: 'Google Sheet not found'
        });
        return;
      }

      res.json({
        success: true,
        data: { sheet }
      });

    } catch (error) {
      console.error('Get Google Sheet error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get Google Sheet'
      });
    }
  }

  // Обновление Google Sheet
  static async updateGoogleSheet(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const { error, value } = updateGoogleSheetSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      const sheetId = req.params['sheetId'];
      if (!GoogleSheetsController.validateId(sheetId, res, 'Sheet ID')) return;

      // Проверяем, что Google Sheet принадлежит пользователю
      const existingSheet = await GoogleSheetModel.findByIdAndOwner(sheetId, req.user.userId);
      if (!existingSheet) {
        res.status(404).json({
          success: false,
          message: 'Google Sheet not found'
        });
        return;
      }

      // Валидируем диапазон результатов если он обновляется
      if (value.result_range_start && value.result_range_end) {
        if (!GoogleSheetModel.validateResultRange(value.result_range_start, value.result_range_end)) {
          res.status(400).json({
            success: false,
            message: 'Result range must contain exactly 5 columns'
          });
          return;
        }
      }

      const updatedSheet = await GoogleSheetModel.update(sheetId, value);

      res.json({
        success: true,
        message: 'Google Sheet updated successfully',
        data: { sheet: updatedSheet }
      });

    } catch (error) {
      console.error('Update Google Sheet error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update Google Sheet'
      });
    }
  }

  // Удаление Google Sheet
  static async deleteGoogleSheet(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const sheetId = req.params['sheetId'];
      if (!GoogleSheetsController.validateId(sheetId, res, 'Sheet ID')) return;

      // Проверяем, что Google Sheet принадлежит пользователю
      const sheet = await GoogleSheetModel.findByIdAndOwner(sheetId, req.user.userId);
      if (!sheet) {
        res.status(404).json({
          success: false,
          message: 'Google Sheet not found'
        });
        return;
      }

      const deleted = await GoogleSheetModel.delete(sheetId);
      if (!deleted) {
        res.status(500).json({
          success: false,
          message: 'Failed to delete Google Sheet'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Google Sheet deleted successfully'
      });

    } catch (error) {
      console.error('Delete Google Sheet error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete Google Sheet'
      });
    }
  }

  // Запуск анализа Google Sheet
  static async analyzeGoogleSheet(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const sheetId = req.params['sheetId'];
      if (!GoogleSheetsController.validateId(sheetId, res, 'Sheet ID')) return;

      // Проверяем, что Google Sheet принадлежит пользователю
      const sheet = await GoogleSheetModel.findByIdAndOwner(sheetId, req.user.userId);
      if (!sheet) {
        res.status(404).json({
          success: false,
          message: 'Google Sheet not found'
        });
        return;
      }

      // Проверяем, что анализ не запущен
      if (sheet.status === 'analyzing') {
        res.status(400).json({
          success: false,
          message: 'Analysis is already in progress'
        });
        return;
      }

      // Запускаем анализ асинхронно
      GoogleSheetsService.analyzeGoogleSheet(sheetId).catch(error => {
        console.error(`Background analysis error for sheet ${sheetId}:`, error);
      });

      res.json({
        success: true,
        message: 'Analysis started successfully',
        data: {
          sheetId,
          status: 'analyzing'
        }
      });

    } catch (error) {
      console.error('Analyze Google Sheet error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start analysis'
      });
    }
  }

  // Отмена анализа Google Sheet
  static async cancelAnalysis(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const sheetId = req.params['sheetId'];
      if (!GoogleSheetsController.validateId(sheetId, res, 'Sheet ID')) return;

      // Проверяем, что Google Sheet принадлежит пользователю
      const sheet = await GoogleSheetModel.findByIdAndOwner(sheetId, req.user.userId);
      if (!sheet) {
        res.status(404).json({
          success: false,
          message: 'Google Sheet not found'
        });
        return;
      }

      // Обновляем статус на inactive
      await GoogleSheetModel.update(sheetId, { status: 'inactive' });

      res.json({
        success: true,
        message: 'Analysis cancelled successfully',
        data: {
          sheetId,
          status: 'inactive'
        }
      });

    } catch (error) {
      console.error('Cancel analysis error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel analysis'
      });
    }
  }

  // Возобновление анализа Google Sheet
  static async resumeAnalysis(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const sheetId = req.params['sheetId'];
      if (!GoogleSheetsController.validateId(sheetId, res, 'Sheet ID')) return;

      // Проверяем, что Google Sheet принадлежит пользователю
      const sheet = await GoogleSheetModel.findByIdAndOwner(sheetId, req.user.userId);
      if (!sheet) {
        res.status(404).json({
          success: false,
          message: 'Google Sheet not found'
        });
        return;
      }

      // Проверяем, что анализ можно возобновить
      if (sheet.status === 'analyzing') {
        res.status(400).json({
          success: false,
          message: 'Analysis is already in progress'
        });
        return;
      }

      // Запускаем анализ асинхронно
      GoogleSheetsService.analyzeGoogleSheet(sheetId).catch(error => {
        console.error(`Background analysis error for sheet ${sheetId}:`, error);
      });

      res.json({
        success: true,
        message: 'Analysis resumed successfully',
        data: {
          sheetId,
          status: 'analyzing'
        }
      });

    } catch (error) {
      console.error('Resume analysis error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to resume analysis'
      });
    }
  }

  // Получение статистики Google Sheet
  static async getSchedulerStatus(_req: Request, res: Response): Promise<void> {
    try {
      const { SchedulerService } = await import('../services/schedulerService');
      const status = SchedulerService.getStatus();
      
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      console.error('Error getting scheduler status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get scheduler status'
      });
    }
  }

  static async getGoogleSheetStats(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const sheetId = req.params['sheetId'];
      if (!GoogleSheetsController.validateId(sheetId, res, 'Sheet ID')) return;

      // Проверяем, что Google Sheet принадлежит пользователю
      const sheet = await GoogleSheetModel.findByIdAndOwner(sheetId, req.user.userId);
      if (!sheet) {
        res.status(404).json({
          success: false,
          message: 'Google Sheet not found'
        });
        return;
      }

      const stats = await GoogleSheetModel.getSheetStats(sheetId);

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      console.error('Get Google Sheet stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get Google Sheet statistics'
      });
    }
  }
}
