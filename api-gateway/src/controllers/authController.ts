import { Request, Response } from 'express';
import Joi from 'joi';
import { UserModel, CreateUserData } from '../models/User';
import { SessionModel, CreateSessionData } from '../models/Session';
import { JWTUtils } from '../utils/jwt';
import { EmailService } from '../services/emailService';
import { redisSet, redisGet, redisDel } from '../config/redis';

// Схемы валидации
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).required(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
  agreeToTerms: Joi.boolean().valid(true).required()
});

const verifyEmailSchema = Joi.object({
  email: Joi.string().email().required(),
  verificationCode: Joi.string().length(6).pattern(/^[0-9]+$/).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  rememberMe: Joi.boolean().default(false)
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
});

export class AuthController {
  // Регистрация нового пользователя (отправка кода верификации)
  static async register(req: Request, res: Response): Promise<void> {
    try {
      // Валидация входных данных
      const { error, value } = registerSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      const { email, username, password } = value;

      // Проверка существования пользователя
      const existingUserByEmail = await UserModel.findByEmail(email);
      if (existingUserByEmail) {
        res.status(409).json({
          success: false,
          message: 'User with this email already exists'
        });
        return;
      }

      const existingUserByUsername = await UserModel.findByUsername(username);
      if (existingUserByUsername) {
        res.status(409).json({
          success: false,
          message: 'Username is already taken'
        });
        return;
      }

      // Генерация кода верификации
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Сохранение данных регистрации в Redis на 15 минут
      const registrationData = {
        email,
        username,
        password,
        verificationCode,
        timestamp: Date.now()
      };

      await redisSet(
        `registration:${email}`, 
        JSON.stringify(registrationData), 
        900 // 15 минут
      );

      // Отправка email с кодом верификации
      await EmailService.sendVerificationEmail(email, username, verificationCode);

      res.status(200).json({
        success: true,
        message: 'Verification code sent to your email. Please check your inbox and enter the code to complete registration.',
        data: {
          email,
          username
        }
      });

    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to register user'
      });
    }
  }

  // Подтверждение email и завершение регистрации
  static async verifyEmail(req: Request, res: Response): Promise<void> {
    try {
      // Валидация входных данных
      const { error, value } = verifyEmailSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      const { email, verificationCode } = value;

      // Получение данных регистрации из Redis
      const registrationDataStr = await redisGet(`registration:${email}`);
      if (!registrationDataStr) {
        res.status(400).json({
          success: false,
          message: 'Registration data not found or expired. Please register again.'
        });
        return;
      }

      const registrationData = JSON.parse(registrationDataStr);

      // Проверка кода верификации
      if (registrationData.verificationCode !== verificationCode) {
        res.status(400).json({
          success: false,
          message: 'Invalid verification code'
        });
        return;
      }

      // Создание пользователя
      const userData: CreateUserData = {
        email: registrationData.email,
        username: registrationData.username,
        password: registrationData.password
      };

      const user = await UserModel.create(userData);

      // Создание сессии
      const deviceInfo = SessionModel.parseDeviceInfo(
        req.headers['user-agent'] || '',
        req.ip || req.connection.remoteAddress || 'unknown'
      );

      const sessionData: CreateSessionData = {
        user_id: user.id,
        device_info: deviceInfo,
        ip_address: req.ip || req.connection.remoteAddress || 'unknown',
        remember_me: false
      };

      const session = await SessionModel.createWithCleanup(sessionData);

      // Генерация токенов
      const tokens = JWTUtils.generateTokenPair({
        userId: user.id,
        sessionId: session.session_token,
        email: user.email,
        username: user.username,
        subscriptionPlan: user.subscription_plan
      });

      // Удаление данных регистрации из Redis
      await redisDel(`registration:${email}`);

      // Отправка ответа
      res.status(201).json({
        success: true,
        message: 'Email verified and user registered successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            subscriptionPlan: user.subscription_plan,
            createdAt: user.created_at
          },
          tokens: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn
          }
        }
      });

    } catch (error) {
      console.error('Email verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to verify email'
      });
    }
  }

  // Логин пользователя
  static async login(req: Request, res: Response): Promise<void> {
    try {
      // Валидация входных данных
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      const { email, password, rememberMe } = value;

      // Поиск пользователя
      const user = await UserModel.findByEmail(email);
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
        return;
      }

      // Проверка пароля
      const isPasswordValid = await UserModel.verifyPassword(user, password);
      if (!isPasswordValid) {
        res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
        return;
      }

      // Создание сессии
      const deviceInfo = SessionModel.parseDeviceInfo(
        req.headers['user-agent'] || '',
        req.ip || req.connection.remoteAddress || 'unknown'
      );

      const sessionData: CreateSessionData = {
        user_id: user.id,
        device_info: deviceInfo,
        ip_address: req.ip || req.connection.remoteAddress || 'unknown',
        remember_me: rememberMe
      };

      const session = await SessionModel.createWithCleanup(sessionData);

      // Генерация токенов
      const tokens = JWTUtils.generateTokenPair({
        userId: user.id,
        sessionId: session.session_token,
        email: user.email,
        username: user.username,
        subscriptionPlan: user.subscription_plan
      });

      // Отправка ответа
      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            subscriptionPlan: user.subscription_plan,
            createdAt: user.created_at
          },
          tokens: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn
          }
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to login'
      });
    }
  }

  // Логаут пользователя
  static async logout(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.session?.id;
      
      if (sessionId) {
        await SessionModel.deactivate(sessionId);
      }

      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to logout'
      });
    }
  }

  // Обновление access token
  static async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      // Валидация входных данных
      const { error, value } = refreshTokenSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      const { refreshToken } = value;

      // Верификация refresh token
      const payload = JWTUtils.verifyRefreshToken(refreshToken);
      if (!payload) {
        res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
        return;
      }

      // Проверка существования сессии
      const session = await SessionModel.findByRefreshToken(refreshToken);
      if (!session || !SessionModel.isActive(session)) {
        res.status(401).json({
          success: false,
          message: 'Session is invalid or expired'
        });
        return;
      }

      // Получение данных пользователя
      const user = await UserModel.findById(payload.userId);
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      // Генерация нового access token
      const newAccessToken = JWTUtils.generateAccessToken({
        userId: user.id,
        sessionId: session.session_token,
        email: user.email,
        username: user.username,
        subscriptionPlan: user.subscription_plan
      });

      // Обновление времени последней активности
      await SessionModel.updateLastActivity(session.id);

      // Отправка ответа
      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: newAccessToken,
          expiresIn: JWTUtils.getTimeUntilExpiration(newAccessToken)
        }
      });

    } catch (error) {
      console.error('Token refresh error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to refresh token'
      });
    }
  }

  // Получение информации о текущем пользователе
  static async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const user = await UserModel.findById(req.user.userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      // Получение статистики пользователя
      const stats = await UserModel.getUserStats(user.id);

      res.status(200).json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            subscriptionPlan: user.subscription_plan,
            subscriptionExpires: user.subscription_expires,
            createdAt: user.created_at,
            updatedAt: user.updated_at
          },
          stats: stats?.stats
        }
      });

    } catch (error) {
      console.error('Get current user error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user information'
      });
    }
  }

  // Получение активных сессий пользователя
  static async getUserSessions(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const sessions = await SessionModel.findByUserId(req.user.userId);

      const sessionData = sessions.map(session => ({
        id: session.id,
        deviceInfo: session.device_info,
        ipAddress: session.ip_address,
        isActive: SessionModel.isActive(session),
        createdAt: session.created_at,
        lastActivity: session.last_activity,
        expiresAt: session.expires_at
      }));

      res.status(200).json({
        success: true,
        data: {
          sessions: sessionData
        }
      });

    } catch (error) {
      console.error('Get user sessions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user sessions'
      });
    }
  }

  // Удаление конкретной сессии
  static async deleteSession(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const { sessionId } = req.params;

      if (!sessionId) {
        res.status(400).json({
          success: false,
          message: 'Session ID is required'
        });
        return;
      }

      // Проверка, что сессия принадлежит пользователю
      const session = await SessionModel.findById(sessionId);
      if (!session || session.user_id !== req.user.userId) {
        res.status(404).json({
          success: false,
          message: 'Session not found'
        });
        return;
      }

      // Удаление сессии
      await SessionModel.deactivate(sessionId);

      res.status(200).json({
        success: true,
        message: 'Session deleted successfully'
      });

    } catch (error) {
      console.error('Delete session error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete session'
      });
    }
  }

  // Удаление всех сессий пользователя (кроме текущей)
  static async deleteAllSessions(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const currentSessionId = req.session?.id;

      // Получение всех сессий пользователя
      const sessions = await SessionModel.findByUserId(req.user.userId);

      // Деактивация всех сессий, кроме текущей
      for (const session of sessions) {
        if (session.id !== currentSessionId) {
          await SessionModel.deactivate(session.id);
        }
      }

      res.status(200).json({
        success: true,
        message: 'All other sessions deleted successfully'
      });

    } catch (error) {
      console.error('Delete all sessions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete sessions'
      });
    }
  }

  // Проверка статуса аутентификации
  static async checkAuthStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          authenticated: false
        });
        return;
      }

      const user = await UserModel.findById(req.user.userId);
      if (!user) {
        res.status(401).json({
          success: false,
          authenticated: false
        });
        return;
      }

      res.status(200).json({
        success: true,
        authenticated: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            subscriptionPlan: user.subscription_plan
          }
        }
      });

    } catch (error) {
      console.error('Check auth status error:', error);
      res.status(500).json({
        success: false,
        authenticated: false,
        message: 'Failed to check authentication status'
      });
    }
  }
}
