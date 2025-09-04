import { Router } from 'express';
import { authenticateToken, requireOwnership } from '../middleware/auth';
import { GoogleSheetsController } from '../controllers/googleSheetsController';

const router = Router();

// Все маршруты требуют аутентификации
router.use(authenticateToken);

// Создание Google Sheet записи
router.post('/:id/sheets', requireOwnership('project'), GoogleSheetsController.createGoogleSheet);

// Получение всех Google Sheets проекта
router.get('/:id/sheets', requireOwnership('project'), GoogleSheetsController.getGoogleSheets);

// Получение конкретной Google Sheet
router.get('/:id/sheets/:sheetId', requireOwnership('project'), GoogleSheetsController.getGoogleSheet);

// Обновление Google Sheet
router.put('/:id/sheets/:sheetId', requireOwnership('project'), GoogleSheetsController.updateGoogleSheet);

// Удаление Google Sheet
router.delete('/:id/sheets/:sheetId', requireOwnership('project'), GoogleSheetsController.deleteGoogleSheet);

// Запуск анализа Google Sheet
router.post('/:id/sheets/:sheetId/analyze', requireOwnership('project'), GoogleSheetsController.analyzeGoogleSheet);

// Отмена анализа Google Sheet
router.post('/:id/sheets/:sheetId/cancel', requireOwnership('project'), GoogleSheetsController.cancelAnalysis);

// Возобновление анализа Google Sheet
router.post('/:id/sheets/:sheetId/resume', requireOwnership('project'), GoogleSheetsController.resumeAnalysis);

// Получение статистики Google Sheet
router.get('/:id/sheets/:sheetId/stats', requireOwnership('project'), GoogleSheetsController.getGoogleSheetStats);

// Получение статуса планировщика (для отладки)
router.get('/:id/scheduler/status', requireOwnership('project'), GoogleSheetsController.getSchedulerStatus);

export default router;
