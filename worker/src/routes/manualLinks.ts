import { Router } from 'express';
import { authenticateToken, requireOwnership } from '../middleware/auth';
import { ManualLinksController } from '../controllers/manualLinksController';
import { upload } from '../config/multer';

const router = Router();

// Все маршруты требуют аутентификации
router.use(authenticateToken);

// Добавление ссылок в проект
router.post('/:id/links', requireOwnership('project'), ManualLinksController.addLinks);

// Получение ссылок проекта
router.get('/:id/links', requireOwnership('project'), ManualLinksController.getLinks);

// Запуск анализа ссылок
router.post('/:id/check', requireOwnership('project'), ManualLinksController.checkLinks);

// Удаление конкретной ссылки
router.delete('/:id/links/:linkId', requireOwnership('project'), ManualLinksController.deleteLink);

// Удаление всех ссылок проекта
router.delete('/:id/links', requireOwnership('project'), ManualLinksController.deleteAllLinks);

// Экспорт ссылок в CSV
router.get('/:id/export', requireOwnership('project'), ManualLinksController.exportLinks);

// Получение статистики проекта
router.get('/:id/stats', requireOwnership('project'), ManualLinksController.getProjectStats);

// Импорт ссылок из файла
router.post('/:id/links/import', requireOwnership('project'), upload.single('file'), ManualLinksController.importLinks);

// Мониторинг очереди для проекта
router.get('/:id/queue', requireOwnership('project'), ManualLinksController.getProjectQueueInfo);

export default router;
