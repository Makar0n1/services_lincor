import { Request, Response, NextFunction } from 'express';
import { JWTUtils, JWTPayload } from '../utils/jwt';
import { SessionModel } from '../models/Session';
import { UserModel } from '../models/User';

// Расширение интерфейса Request для добавления пользователя
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
      session?: any;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user: JWTPayload;
  session: any;
}

// Middleware для проверки JWT токена
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = JWTUtils.extractTokenFromHeader(authHeader);

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
      return;
    }

    // Верификация токена
    const payload = JWTUtils.verifyAccessToken(token);
    if (!payload) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired access token'
      });
      return;
    }

    // Проверка существования сессии
    const session = await SessionModel.findBySessionToken(payload.sessionId);
    if (!session || !SessionModel.isActive(session)) {
      res.status(401).json({
        success: false,
        message: 'Session is invalid or expired'
      });
      return;
    }

    // Обновление времени последней активности
    await SessionModel.updateLastActivity(session.id);

    // Добавление пользователя и сессии к запросу
    req.user = payload;
    req.session = session;

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Middleware для опциональной аутентификации (не блокирует запрос)
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = JWTUtils.extractTokenFromHeader(authHeader);

    if (token) {
      const payload = JWTUtils.verifyAccessToken(token);
      if (payload) {
        const session = await SessionModel.findBySessionToken(payload.sessionId);
        if (session && SessionModel.isActive(session)) {
          await SessionModel.updateLastActivity(session.id);
          req.user = payload;
          req.session = session;
        }
      }
    }

    next();
  } catch (error) {
    console.error('Optional authentication error:', error);
    next(); // Продолжаем выполнение даже при ошибке
  }
};

// Middleware для проверки роли пользователя
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    if (!allowedRoles.includes(req.user.subscriptionPlan)) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
      return;
    }

    next();
  };
};

// Middleware для проверки плана подписки
export const requirePlan = (minPlan: 'free' | 'starter' | 'pro' | 'enterprise') => {
  const planHierarchy = {
    free: 0,
    starter: 1,
    pro: 2,
    enterprise: 3
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const userPlanLevel = planHierarchy[req.user.subscriptionPlan as keyof typeof planHierarchy] || 0;
    const requiredPlanLevel = planHierarchy[minPlan];

    if (userPlanLevel < requiredPlanLevel) {
      res.status(403).json({
        success: false,
        message: `This feature requires ${minPlan} plan or higher`
      });
      return;
    }

    next();
  };
};

// Middleware для проверки лимитов плана
export const checkProjectLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const canCreate = await UserModel.canCreateProject(req.user.userId);
    if (!canCreate) {
      const limits = UserModel.getPlanLimits(req.user.subscriptionPlan);
      res.status(403).json({
        success: false,
        message: `Project limit reached. Your plan allows ${limits.projects} projects.`
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Project limit check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check project limits'
    });
  }
};

// Middleware для проверки лимитов ссылок
export const checkLinkLimit = (linkCount: number = 1) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const canAdd = await UserModel.canAddLinks(req.user.userId, linkCount);
      if (!canAdd) {
        const limits = UserModel.getPlanLimits(req.user.subscriptionPlan);
        res.status(403).json({
          success: false,
          message: `Link limit reached. Your plan allows ${limits.linksPerMonth} links per month.`
        });
        return;
      }

      next();
    } catch (error) {
      console.error('Link limit check error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check link limits'
      });
    }
  };
};

// Middleware для проверки владельца ресурса
export const requireOwnership = (resourceType: 'project' | 'link' | 'sheet') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const resourceId = req.params['id'] || req.params['projectId'] || req.params['linkId'] || req.params['sheetId'];
      if (!resourceId) {
        res.status(400).json({
          success: false,
          message: 'Resource ID is required'
        });
        return;
      }

      // Валидация UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(resourceId)) {
        res.status(400).json({
          success: false,
          message: 'Invalid resource ID format'
        });
        return;
      }

      // Проверка владельца в зависимости от типа ресурса
      let isOwner = false;
      
      switch (resourceType) {
        case 'project':
          const projectResult = await require('../config/database').query(
            'SELECT user_id FROM projects WHERE id = $1',
            [resourceId]
          );
          isOwner = projectResult.rows[0]?.user_id === req.user.userId;
          break;

        case 'link':
          const linkResult = await require('../config/database').query(
            `SELECT p.user_id FROM manual_links ml
             JOIN projects p ON ml.project_id = p.id
             WHERE ml.id = $1`,
            [resourceId]
          );
          isOwner = linkResult.rows[0]?.user_id === req.user.userId;
          break;

        case 'sheet':
          // Для Google Sheets проверяем владение проектом, а не листом
          const sheetResult = await require('../config/database').query(
            'SELECT user_id FROM projects WHERE id = $1',
            [resourceId]
          );
          isOwner = sheetResult.rows[0]?.user_id === req.user.userId;
          break;
      }

      if (!isOwner) {
        res.status(403).json({
          success: false,
          message: 'Access denied. You do not own this resource.'
        });
        return;
      }

      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check resource ownership'
      });
    }
  };
};

// Middleware для rate limiting (базовая реализация)
export const rateLimit = (maxRequests: number = 100, windowMs: number = 900000) => {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    const userRequests = requests.get(ip);
    
    if (!userRequests || now > userRequests.resetTime) {
      requests.set(ip, {
        count: 1,
        resetTime: now + windowMs
      });
    } else {
      userRequests.count++;
      
      if (userRequests.count > maxRequests) {
        res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.'
        });
        return;
      }
    }

    next();
  };
};

// Middleware для логирования запросов
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId = req.user?.userId || 'anonymous';
    
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms - User: ${userId}`);
  });

  next();
};

// Middleware для обработки ошибок
export const errorHandler = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('Error:', error);

  if (error.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.message
    });
    return;
  }

  if (error.name === 'UnauthorizedError') {
    res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
    return;
  }

  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
};
