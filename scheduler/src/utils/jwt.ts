import jwt, { Secret, SignOptions, JwtPayload } from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const ISSUER = 'linkchecker' as const;
const AUD_USERS = 'linkchecker-users' as const;
const AUD_REFRESH = 'linkchecker-refresh' as const;
const AUD_API = 'linkchecker-api' as const;
const AUD_TEMP = 'linkchecker-temp' as const;

// Явно типизируем секрет и сроки жизни токенов под SignOptions['expiresIn']
const JWT_SECRET: Secret =
  (process.env['JWT_SECRET'] ?? 'your_super_secret_jwt_key_here') as Secret;

const ACCESS_EXPIRES_IN = (process.env['JWT_EXPIRES_IN'] ?? '7d') as SignOptions['expiresIn'];
const REFRESH_EXPIRES_IN = (process.env['JWT_REFRESH_EXPIRES_IN'] ?? '30d') as SignOptions['expiresIn'];

export interface JWTPayload extends JwtPayload {
  userId: string;
  sessionId: string;
  email: string;
  username: string;
  subscriptionPlan: string;
}

export interface RefreshTokenPayload extends JwtPayload {
  userId: string;
  sessionId: string;
  tokenId: string;
}

export class JWTUtils {
  // Генерация access token
  static generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    const options: SignOptions = {
      ...(ACCESS_EXPIRES_IN && { expiresIn: ACCESS_EXPIRES_IN }),
      issuer: ISSUER,
      audience: AUD_USERS,
      algorithm: 'HS256',
    };
    return jwt.sign(payload, JWT_SECRET, options);
  }

  // Генерация refresh token
  static generateRefreshToken(
    payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>
  ): string {
    const options: SignOptions = {
      ...(REFRESH_EXPIRES_IN && { expiresIn: REFRESH_EXPIRES_IN }),
      issuer: ISSUER,
      audience: AUD_REFRESH,
      algorithm: 'HS256',
    };
    return jwt.sign(payload, JWT_SECRET, options);
  }

  // Верификация access token
  static verifyAccessToken(token: string): JWTPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, {
        issuer: ISSUER,
        audience: AUD_USERS,
        algorithms: ['HS256'],
      }) as JWTPayload;
      return decoded;
    } catch (error) {
      console.error('JWT verification error:', error);
      return null;
    }
  }

  // Верификация refresh token
  static verifyRefreshToken(token: string): RefreshTokenPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, {
        issuer: ISSUER,
        audience: AUD_REFRESH,
        algorithms: ['HS256'],
      }) as RefreshTokenPayload;
      return decoded;
    } catch (error) {
      console.error('JWT refresh verification error:', error);
      return null;
    }
  }

  // Декодирование токена без верификации (для отладки)
  static decodeToken<T extends JwtPayload = JwtPayload>(token: string): T | null {
    try {
      return jwt.decode(token) as T | null;
    } catch (error) {
      console.error('JWT decode error:', error);
      return null;
    }
  }

  // Получение времени истечения токена
  static getTokenExpiration(token: string): Date | null {
    const decoded = this.decodeToken<JwtPayload>(token);
    if (decoded?.exp) {
      return new Date(decoded.exp * 1000);
    }
    return null;
  }

  // Проверка, истек ли токен
  static isTokenExpired(token: string): boolean {
    const expiration = this.getTokenExpiration(token);
    if (!expiration) return true;
    return Date.now() > expiration.getTime();
  }

  // Получение времени до истечения токена (в секундах)
  static getTimeUntilExpiration(token: string): number {
    const expiration = this.getTokenExpiration(token);
    if (!expiration) return 0;
    const diff = expiration.getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 1000));
  }

  // Создание пары токенов (access + refresh)
  static generateTokenPair(userData: {
    userId: string;
    sessionId: string;
    email: string;
    username: string;
    subscriptionPlan: string;
  }) {
    const accessToken = this.generateAccessToken({
      userId: userData.userId,
      sessionId: userData.sessionId,
      email: userData.email,
      username: userData.username,
      subscriptionPlan: userData.subscriptionPlan,
    });

    const refreshToken = this.generateRefreshToken({
      userId: userData.userId,
      sessionId: userData.sessionId,
      tokenId: userData.sessionId, // используем sessionId как tokenId
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.getTimeUntilExpiration(accessToken),
    };
  }

  // Обновление access token с помощью refresh token
  static refreshAccessToken(
    refreshToken: string,
    userData: { email: string; username: string; subscriptionPlan: string }
  ): string | null {
    const decoded = this.verifyRefreshToken(refreshToken);
    if (!decoded) return null;

    return this.generateAccessToken({
      userId: decoded.userId,
      sessionId: decoded.sessionId,
      email: userData.email,
      username: userData.username,
      subscriptionPlan: userData.subscriptionPlan,
    });
  }

  // Извлечение токена из заголовка Authorization
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) return null;
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    return token;
    }

  // Создание безопасного токена для API ключей
  static generateApiToken(userId: string, permissions: string[] = []): string {
    type ApiPayload = { userId: string; permissions: string[]; type: 'api' };
    const payload: ApiPayload = { userId, permissions, type: 'api' };

    const options: SignOptions = {
      expiresIn: '1y',
      issuer: ISSUER,
      audience: AUD_API,
      algorithm: 'HS256',
    };

    return jwt.sign(payload, JWT_SECRET, options);
  }

  // Верификация API токена
  static verifyApiToken(
    token: string
  ): { userId: string; permissions: string[] } | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, {
        issuer: ISSUER,
        audience: AUD_API,
        algorithms: ['HS256'],
      }) as JwtPayload & {
        userId?: string;
        permissions?: string[];
        type?: string;
      };

      if (decoded?.type !== 'api' || !decoded.userId) return null;

      return {
        userId: decoded.userId,
        permissions: decoded.permissions ?? [],
      };
    } catch (error) {
      console.error('API token verification error:', error);
      return null;
    }
  }

  // Создание временного токена для одноразовых операций
  static generateTemporaryToken(
    payload: Record<string, unknown>,
    expiresIn: SignOptions['expiresIn'] = '1h'
  ): string {
    const options: SignOptions = {
      expiresIn,
      issuer: ISSUER,
      audience: AUD_TEMP,
      algorithm: 'HS256',
    };
    return jwt.sign(payload, JWT_SECRET, options);
  }

  // Верификация временного токена
  static verifyTemporaryToken<T extends JwtPayload = JwtPayload>(
    token: string
  ): T | null {
    try {
      return jwt.verify(token, JWT_SECRET, {
        issuer: ISSUER,
        audience: AUD_TEMP,
        algorithms: ['HS256'],
      }) as T;
    } catch (error) {
      console.error('Temporary token verification error:', error);
      return null;
    }
  }
}
