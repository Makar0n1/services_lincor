import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Публичные маршруты (не требуют аутентификации)
router.post('/register', AuthController.register);
router.post('/verify-email', AuthController.verifyEmail);
router.post('/login', AuthController.login);
router.post('/refresh', AuthController.refreshToken);
router.get('/check', AuthController.checkAuthStatus);

// Защищенные маршруты (требуют аутентификации)
router.post('/logout', authenticateToken, AuthController.logout);
router.get('/me', authenticateToken, AuthController.getCurrentUser);
router.get('/sessions', authenticateToken, AuthController.getUserSessions);
router.delete('/sessions/:sessionId', authenticateToken, AuthController.deleteSession);
router.delete('/sessions', authenticateToken, AuthController.deleteAllSessions);

export default router;
