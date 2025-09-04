import { Router } from 'express';
import { ProjectController } from '../controllers/projectController';
import { authenticateToken, requireOwnership, checkProjectLimit } from '../middleware/auth';

const router = Router();

// Все маршруты требуют аутентификации
router.use(authenticateToken);

// Маршруты проектов
router.post('/', checkProjectLimit, ProjectController.createProject);
router.get('/', ProjectController.getProjects);
router.get('/:id', requireOwnership('project'), ProjectController.getProject);
router.put('/:id', requireOwnership('project'), ProjectController.updateProject);
router.delete('/:id', requireOwnership('project'), ProjectController.deleteProject);

export default router;
